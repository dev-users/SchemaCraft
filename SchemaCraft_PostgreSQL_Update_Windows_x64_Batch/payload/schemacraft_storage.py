"""Lossless PostgreSQL persistence for SchemaCraft's existing record contract.

Relational keys protect record/child ownership and JSONB makes dynamic values
queryable. Authoritative JSON text also preserves Python JSON number types and
negative zero, which PostgreSQL's JSONB numeric representation can normalize.
No workbook, attachment, or user-data path is read by this module.
"""
from __future__ import annotations

import json
import logging
import math
import threading
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

FORMAT_VERSION = 1
_WRITE_LOCK = 2072409279001


class StorageError(ValueError):
    """A persistence or integrity failure safe for the application's error path."""


class StorageConflict(StorageError):
    """The dataset changed after the caller obtained its revision signature."""


def _validate_json(value: Any, path: str = "payload", ancestors: set[int] | None = None) -> None:
    if value is None or type(value) in (bool, int):
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise StorageError(f"{path}: non-finite numbers cannot be stored")
        return
    if type(value) is str:
        if "\x00" in value:
            raise StorageError(f"{path}: NUL characters cannot be stored")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise StorageError(f"{path}: invalid Unicode cannot be stored") from exc
        return
    if type(value) not in (dict, list):
        raise StorageError(f"{path}: unsupported JSON value type {type(value).__name__}")
    ancestors = set() if ancestors is None else ancestors
    if id(value) in ancestors:
        raise StorageError(f"{path}: circular JSON value")
    ancestors.add(id(value))
    try:
        if type(value) is dict:
            for key, child in value.items():
                if type(key) is not str:
                    raise StorageError(f"{path}: JSON object keys must be strings")
                _validate_json(key, f"{path}.key", ancestors)
                _validate_json(child, f"{path}.{key}", ancestors)
        else:
            for index, child in enumerate(value):
                _validate_json(child, f"{path}[{index}]", ancestors)
    finally:
        ancestors.remove(id(value))


def _encode(value: Any, path: str = "payload") -> str:
    try:
        _validate_json(value, path)
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (ValueError, OverflowError, RecursionError) as exc:
        raise StorageError(f"{path}: cannot encode JSON: {exc}") from exc


def _identifier(value: Any, label: str) -> str:
    if type(value) is not str or not value:
        raise StorageError(f"{label} must be a nonempty string")
    _validate_json(value, label)
    return value


def _prepare_dataset(schema_id: str, schema: Any, records: Any) -> dict[str, Any]:
    _identifier(schema_id, "schema_id")
    if type(schema) is not dict or type(records) is not list:
        raise StorageError("A dataset requires a schema object and record array")
    schema_text = _encode(schema, f"schema[{schema_id}]")
    definitions = schema.get("categories", [])
    if type(definitions) is not list or any(type(category) is not dict for category in definitions):
        raise StorageError("schema.categories must be an array of objects")
    for category in definitions:
        _identifier(category.get("id"), "category.id")
        parent = category.get("parent_category_id")
        if parent is not None and parent != "":
            _identifier(parent, "category.parent_category_id")
    if len({category["id"] for category in definitions}) != len(definitions):
        raise StorageError("Schema category IDs must be unique")
    category_parents = {category.get("id"): category.get("parent_category_id") for category in definitions}
    known_categories = {category.get("id"): category for category in definitions}
    record_rows, child_rows = [], []
    record_ids, record_codes, children = set(), set(), {}
    for ordinal, record in enumerate(records):
        if type(record) is not dict:
            raise StorageError("Every record must be an object")
        payload_text = _encode(record, f"records[{ordinal}]")
        record_id = _identifier(record.get("_record_id"), "record._record_id")
        code = _identifier(record.get("record_code"), "record.record_code")
        if record_id in record_ids or code in record_codes:
            raise StorageError(f"Duplicate record ID or code in schema {schema_id}")
        record_ids.add(record_id)
        record_codes.add(code)
        values = record.get("values", {})
        related = record.get("related", {})
        if type(values) is not dict or type(related) is not dict:
            raise StorageError("record.values and record.related must be objects")
        record_rows.append((schema_id, record_id, code, ordinal, _encode(values), payload_text, payload_text))
        for category_id, rows in related.items():
            _identifier(category_id, "related category ID")
            if type(rows) is not list:
                raise StorageError("Every related category must contain an array")
            for row_order, child in enumerate(rows):
                if type(child) is not dict:
                    raise StorageError("Every related row must be an object")
                child_id = _identifier(child.get("_child_id"), "child._child_id")
                if child_id in children:
                    raise StorageError(f"Duplicate child ID in schema {schema_id}")
                child_values = child.get("values", {})
                if type(child_values) is not dict:
                    raise StorageError("child.values must be an object")
                parent_id = child.get("parent_child_id", "")
                if type(parent_id) is not str:
                    raise StorageError("child.parent_child_id must be a string")
                if parent_id == child_id:
                    raise StorageError("A child cannot own itself")
                children[child_id] = (record_id, category_id, parent_id)
                child_text = _encode(child)
                child_rows.append((schema_id, record_id, child_id, category_id, row_order, parent_id or None,
                                   _encode(child_values), child_text, child_text))
    for child_id, (record_id, category_id, parent_id) in children.items():
        parent_category = category_parents.get(category_id)
        parent_definition = known_categories.get(parent_category, {})
        expects_parent = parent_definition.get("kind") == "repeatable"
        if expects_parent and not parent_id:
            raise StorageError(f"Child {child_id} has no parent in repeatable category {parent_category}")
        if parent_id:
            target = children.get(parent_id)
            if target is None or target[0] != record_id:
                raise StorageError(f"Child {child_id} has a parent outside its owning record")
            if expects_parent and target[1] != parent_category:
                raise StorageError(f"Child {child_id} has a parent in the wrong category")
            # Catch malformed cycles even when an old/custom category has no definition.
            visited = {child_id}
            current = parent_id
            while current:
                if current in visited:
                    raise StorageError("Related row ownership contains a cycle")
                visited.add(current)
                ancestor = children.get(current)
                if ancestor is None or ancestor[0] != record_id:
                    raise StorageError(f"Child {child_id} has a parent outside its owning record")
                current = ancestor[2]
    return {"schema_text": schema_text, "records": record_rows, "children": child_rows}


_DDL = """
CREATE SCHEMA IF NOT EXISTS schemacraft;
CREATE SEQUENCE IF NOT EXISTS schemacraft.revision_seq;
CREATE TABLE IF NOT EXISTS schemacraft.schemas (
 schema_id text PRIMARY KEY CHECK (schema_id <> ''),
 revision bigint NOT NULL DEFAULT nextval('schemacraft.revision_seq'),
 record_count bigint NOT NULL CHECK (record_count >= 0),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
 definition_text text NOT NULL
);
CREATE TABLE IF NOT EXISTS schemacraft.records (
 schema_id text NOT NULL REFERENCES schemacraft.schemas(schema_id) ON DELETE CASCADE,
 record_id text NOT NULL CHECK (record_id <> ''),
 record_code text NOT NULL CHECK (record_code <> ''),
 ordinal bigint NOT NULL CHECK (ordinal >= 0),
 values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 payload_text text NOT NULL,
 PRIMARY KEY (schema_id, record_id), UNIQUE (schema_id, record_code), UNIQUE (schema_id, ordinal)
);
CREATE INDEX IF NOT EXISTS records_values_gin ON schemacraft.records USING gin (values);
CREATE TABLE IF NOT EXISTS schemacraft.children (
 schema_id text NOT NULL, record_id text NOT NULL,
 child_id text NOT NULL CHECK (child_id <> ''), category_id text NOT NULL CHECK (category_id <> ''),
 ordinal bigint NOT NULL CHECK (ordinal >= 0), parent_child_id text,
 values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), payload_text text NOT NULL,
 PRIMARY KEY (schema_id, child_id), UNIQUE (schema_id, record_id, child_id),
 UNIQUE (schema_id, record_id, category_id, ordinal),
 FOREIGN KEY (schema_id, record_id) REFERENCES schemacraft.records(schema_id, record_id) ON DELETE CASCADE,
 FOREIGN KEY (schema_id, record_id, parent_child_id)
 REFERENCES schemacraft.children(schema_id, record_id, child_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK (parent_child_id IS NULL OR parent_child_id <> child_id)
);
CREATE INDEX IF NOT EXISTS children_values_gin ON schemacraft.children USING gin (values);
CREATE TABLE IF NOT EXISTS schemacraft.identities (
 person_id text PRIMARY KEY CHECK (person_id <> ''), person_uuid text NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), payload_text text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_person_uuid ON schemacraft.identities(person_uuid) WHERE person_uuid <> '';
CREATE TABLE IF NOT EXISTS schemacraft.identity_memberships (
 person_id text NOT NULL REFERENCES schemacraft.identities(person_id) ON DELETE CASCADE,
 schema_id text NOT NULL CHECK (schema_id <> ''), PRIMARY KEY (person_id, schema_id)
);
CREATE TABLE IF NOT EXISTS schemacraft.metadata (
 name text PRIMARY KEY CHECK (name <> ''), value jsonb NOT NULL, value_text text NOT NULL
);
"""


class PostgresStore:
    """Thread-safe repository using a short-lived connection per operation.

    A signature is ``(monotonic_revision, record_count)``. Supplying signatures
    to ``write_many`` protects a read/modify/write cycle. A mapping value of
    ``None`` explicitly requires that schema not to exist. Ordinary writes with
    no signatures are serialized, atomic replacements of the provided datasets.
    """
    def __init__(self, dsn: str):
        if not isinstance(dsn, str) or not dsn.strip():
            raise StorageError("A PostgreSQL connection string is required")
        self.dsn = dsn
        self._closed = False
        self._state_lock = threading.RLock()
        self._transaction_state: ContextVar[dict[str, Any] | None] = ContextVar("schemacraft_storage_transaction", default=None)

    @contextmanager
    def _connection(self, *, readonly: bool = False, wrap_errors: bool = True) -> Iterator[Any]:
        with self._state_lock:
            if self._closed:
                raise StorageError("PostgreSQL repository is closed")
        state = self._transaction_state.get()
        if state is not None:
            try:
                # The outer transaction owns isolation, commit and connection.
                # Reads must see pending writes when exporting a logical backup.
                yield state["connection"]
            except StorageError:
                state["failed"] = True
                raise
            except Exception as exc:
                state["failed"] = True
                raise StorageError(f"PostgreSQL operation failed: {type(exc).__name__}: {exc}") from exc
            return
        try:
            import psycopg
        except ImportError as exc:
            raise StorageError("PostgreSQL support requires the bundled psycopg 3 driver") from exc
        connection = None
        try:
            connection = psycopg.connect(self.dsn, connect_timeout=15, application_name="SchemaCraft")
            with connection:
                if readonly:
                    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                yield connection
        except StorageError:
            raise
        except Exception as exc:
            if not wrap_errors and not isinstance(exc, psycopg.Error):
                raise
            # Do not include the DSN/password in a user-visible exception.
            raise StorageError(f"PostgreSQL operation failed: {type(exc).__name__}: {exc}") from exc
        finally:
            if connection is not None:
                connection.close()

    @contextmanager
    def transaction(self) -> Iterator["PostgresStore"]:
        """Group repository writes and durable file-commit markers atomically.

        Per-context connection reuse makes this safe for independent request
        threads. Nested contexts join the outer transaction; a failed database
        operation prevents commit even if a caller catches its exception.
        """
        state = self._transaction_state.get()
        if state is not None:
            try:
                yield self
            except BaseException:
                state["failed"] = True
                raise
            return
        state = None
        try:
            with self._connection(wrap_errors=False) as connection:
                connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
                state = {"connection": connection, "failed": False, "on_commit": [], "on_rollback": []}
                token = self._transaction_state.set(state)
                try:
                    yield self
                    if state["failed"]:
                        raise StorageError("The PostgreSQL transaction contains a failed operation")
                finally:
                    self._transaction_state.reset(token)
        except BaseException:
            if state is not None:
                self._run_completion_callbacks(reversed(state["on_rollback"]), "rollback")
            raise
        else:
            self._run_completion_callbacks(state["on_commit"], "commit")

    def on_commit(self, callback) -> None:
        """Run a callback only after the owning SQL transaction is durable."""
        self._add_completion_callback("on_commit", callback)

    def on_rollback(self, callback) -> None:
        """Run a callback after the owning SQL transaction rolls back."""
        self._add_completion_callback("on_rollback", callback)

    def _add_completion_callback(self, name, callback) -> None:
        state = self._transaction_state.get()
        if state is None:
            raise StorageError("Transaction completion callbacks require an active transaction")
        if not callable(callback):
            raise StorageError("Transaction completion callback must be callable")
        state[name].append(callback)

    @staticmethod
    def _run_completion_callbacks(callbacks, outcome) -> None:
        for callback in callbacks:
            try:
                callback()
            except Exception:
                # A failed projection/retry callback cannot undo a SQL commit
                # and must never make the caller delete committed attachments.
                logging.getLogger(__name__).exception("PostgreSQL %s callback failed", outcome)

    def initialize(self) -> None:
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            connection.execute(_DDL)
            row = connection.execute("SELECT value_text FROM schemacraft.metadata WHERE name = 'storage_format_version'").fetchone()
            if row and json.loads(row[0]) != FORMAT_VERSION:
                raise StorageError("Unsupported PostgreSQL storage format version")
            encoded = _encode(FORMAT_VERSION)
            connection.execute("INSERT INTO schemacraft.metadata(name,value,value_text) VALUES ('storage_format_version',%s::jsonb,%s) ON CONFLICT (name) DO NOTHING", (encoded, encoded))

    def has_schema(self, schema_id: str) -> bool:
        _identifier(schema_id, "schema_id")
        with self._connection(readonly=True) as connection:
            return connection.execute("SELECT 1 FROM schemacraft.schemas WHERE schema_id=%s", (schema_id,)).fetchone() is not None

    def read_schema(self, schema_id: str) -> dict[str, Any] | None:
        _identifier(schema_id, "schema_id")
        with self._connection(readonly=True) as connection:
            row = connection.execute("SELECT definition_text FROM schemacraft.schemas WHERE schema_id=%s", (schema_id,)).fetchone()
            return json.loads(row[0]) if row else None

    def read_dataset(self, schema_id: str) -> list[dict[str, Any]]:
        _identifier(schema_id, "schema_id")
        with self._connection(readonly=True) as connection:
            rows = connection.execute("SELECT payload_text FROM schemacraft.records WHERE schema_id=%s ORDER BY ordinal", (schema_id,)).fetchall()
            return [json.loads(row[0]) for row in rows]

    def signature(self, schema_id: str) -> tuple[int, int] | None:
        _identifier(schema_id, "schema_id")
        with self._connection(readonly=True) as connection:
            row = connection.execute("SELECT revision,record_count FROM schemacraft.schemas WHERE schema_id=%s", (schema_id,)).fetchone()
            return (int(row[0]), int(row[1])) if row else None

    def write_dataset(self, schema_id: str, schema: dict[str, Any], records: list[dict[str, Any]], expected_signature: tuple[int, int] | None = None) -> None:
        signatures = {schema_id: expected_signature} if expected_signature is not None else None
        self.write_many({schema_id: {"schema": schema, "records": records}}, signatures)

    @staticmethod
    def _write_prepared(connection: Any, schema_id: str, prepared: dict[str, Any]) -> None:
        text = prepared["schema_text"]
        connection.execute("INSERT INTO schemacraft.schemas(schema_id,record_count,definition,definition_text) VALUES (%s,%s,%s::jsonb,%s) ON CONFLICT(schema_id) DO UPDATE SET revision=nextval('schemacraft.revision_seq'),record_count=EXCLUDED.record_count,definition=EXCLUDED.definition,definition_text=EXCLUDED.definition_text", (schema_id, len(prepared["records"]), text, text))
        connection.execute("DELETE FROM schemacraft.children WHERE schema_id=%s", (schema_id,))
        connection.execute("DELETE FROM schemacraft.records WHERE schema_id=%s", (schema_id,))
        with connection.cursor() as cursor:
            if prepared["records"]:
                cursor.executemany("INSERT INTO schemacraft.records(schema_id,record_id,record_code,ordinal,values,payload,payload_text) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s)", prepared["records"])
            if prepared["children"]:
                cursor.executemany("INSERT INTO schemacraft.children(schema_id,record_id,child_id,category_id,ordinal,parent_child_id,values,payload,payload_text) VALUES(%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s)", prepared["children"])

    def write_many(self, datasets: Mapping[str, Mapping[str, Any]], expected_signatures: Mapping[str, tuple[int, int] | None] | None = None) -> None:
        if not isinstance(datasets, Mapping):
            raise StorageError("datasets must be a mapping")
        prepared = {}
        for schema_id, dataset in datasets.items():
            if not isinstance(dataset, Mapping) or "schema" not in dataset or "records" not in dataset:
                raise StorageError("Each dataset requires schema and records")
            prepared[schema_id] = _prepare_dataset(schema_id, dataset["schema"], dataset["records"])
        if expected_signatures and any(schema_id not in prepared for schema_id in expected_signatures):
            raise StorageError("A revision check refers to a dataset outside this write")
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            for schema_id in sorted(prepared):
                if expected_signatures is not None and schema_id in expected_signatures:
                    row = connection.execute("SELECT revision,record_count FROM schemacraft.schemas WHERE schema_id=%s", (schema_id,)).fetchone()
                    actual = (int(row[0]), int(row[1])) if row else None
                    expected = expected_signatures[schema_id]
                    if expected is not None:
                        expected = tuple(expected)
                    if actual != expected:
                        raise StorageConflict(f"Schema {schema_id} changed before this write; reload and retry")
            for schema_id in sorted(prepared):
                self._write_prepared(connection, schema_id, prepared[schema_id])

    def delete_schema(self, schema_id: str) -> None:
        _identifier(schema_id, "schema_id")
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            connection.execute("DELETE FROM schemacraft.schemas WHERE schema_id=%s", (schema_id,))

    @staticmethod
    def _prepare_registry(registry: Any) -> list[tuple[str, str, str, list[str]]]:
        if type(registry) is not dict:
            raise StorageError("Identity registry must be an object")
        result, uuids = [], set()
        for person_id, source in registry.items():
            _identifier(person_id, "person_id")
            if type(source) is not dict:
                raise StorageError("Identity registry entries must be objects")
            entry = dict(source)
            if entry.get("person_id", person_id) != person_id:
                raise StorageError("Identity key and person_id disagree")
            schemas = entry.get("schema_ids", [])
            if isinstance(schemas, (set, frozenset)):
                schemas = sorted(schemas)
            if type(schemas) is not list:
                raise StorageError("Identity schema_ids must be a list or set")
            for schema_id in schemas:
                _identifier(schema_id, "identity.schema_id")
            if len(set(schemas)) != len(schemas):
                raise StorageError("Identity schema_ids contains duplicates")
            if "schema_ids" in entry:
                entry["schema_ids"] = schemas
            person_uuid = entry.get("person_uuid", "")
            if type(person_uuid) is not str:
                raise StorageError("Identity person_uuid must be a string")
            if person_uuid:
                if person_uuid in uuids:
                    raise StorageError("Identity person_uuid must be globally unique")
                uuids.add(person_uuid)
            encoded = _encode(entry, f"registry.{person_id}")
            result.append((person_id, person_uuid, encoded, schemas))
        return result

    @staticmethod
    def _write_registry_prepared(connection: Any, rows: list[tuple[str, str, str, list[str]]]) -> None:
        connection.execute("DELETE FROM schemacraft.identities")
        with connection.cursor() as cursor:
            if rows:
                cursor.executemany("INSERT INTO schemacraft.identities(person_id,person_uuid,payload,payload_text) VALUES (%s,%s,%s::jsonb,%s)", [(person_id, person_uuid, encoded, encoded) for person_id, person_uuid, encoded, _ in rows])
            memberships = [(person_id, schema_id) for person_id, _, _, schemas in rows for schema_id in schemas]
            if memberships:
                cursor.executemany("INSERT INTO schemacraft.identity_memberships(person_id,schema_id) VALUES (%s,%s)", memberships)

    def read_registry(self) -> dict[str, dict[str, Any]]:
        with self._connection(readonly=True) as connection:
            return {person_id: json.loads(encoded) for person_id, encoded in connection.execute("SELECT person_id,payload_text FROM schemacraft.identities ORDER BY person_id").fetchall()}

    def write_registry(self, registry: dict[str, dict[str, Any]]) -> None:
        rows = self._prepare_registry(registry)
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            self._write_registry_prepared(connection, rows)

    def get_metadata(self, name: str, default: Any = None) -> Any:
        _identifier(name, "metadata name")
        with self._connection(readonly=True) as connection:
            row = connection.execute("SELECT value_text FROM schemacraft.metadata WHERE name=%s", (name,)).fetchone()
            return json.loads(row[0]) if row else default

    def set_metadata(self, name: str, value: Any) -> None:
        _identifier(name, "metadata name")
        if name == "storage_format_version" and value != FORMAT_VERSION:
            raise StorageError("The storage format version cannot be changed")
        encoded = _encode(value)
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            connection.execute("INSERT INTO schemacraft.metadata(name,value,value_text) VALUES (%s,%s::jsonb,%s) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,value_text=EXCLUDED.value_text", (name, encoded, encoded))

    def export_snapshot(self) -> dict[str, Any]:
        """Read all schemas, records, registry and metadata from one DB snapshot."""
        with self._connection(readonly=True) as connection:
            schemas = connection.execute("SELECT schema_id,definition_text FROM schemacraft.schemas ORDER BY schema_id").fetchall()
            datasets = {}
            for schema_id, definition in schemas:
                rows = connection.execute("SELECT payload_text FROM schemacraft.records WHERE schema_id=%s ORDER BY ordinal", (schema_id,)).fetchall()
                datasets[schema_id] = {"schema": json.loads(definition), "records": [json.loads(row[0]) for row in rows]}
            registry = {person_id: json.loads(encoded) for person_id, encoded in connection.execute("SELECT person_id,payload_text FROM schemacraft.identities ORDER BY person_id").fetchall()}
            metadata = {name: json.loads(encoded) for name, encoded in connection.execute("SELECT name,value_text FROM schemacraft.metadata ORDER BY name").fetchall()}
            return {"format_version": FORMAT_VERSION, "datasets": datasets, "registry": registry, "metadata": metadata}

    def restore_snapshot(self, snapshot: dict[str, Any]) -> None:
        """Validate first, then replace the entire logical store atomically."""
        if type(snapshot) is not dict or snapshot.get("format_version") != FORMAT_VERSION:
            raise StorageError("Unsupported PostgreSQL snapshot format")
        _encode(snapshot, "snapshot")
        datasets, registry, metadata = snapshot.get("datasets"), snapshot.get("registry"), snapshot.get("metadata")
        if type(datasets) is not dict or type(metadata) is not dict:
            raise StorageError("Snapshot datasets and metadata must be objects")
        prepared = {}
        for schema_id, dataset in datasets.items():
            if type(dataset) is not dict or "schema" not in dataset or "records" not in dataset:
                raise StorageError("Invalid snapshot dataset")
            prepared[schema_id] = _prepare_dataset(schema_id, dataset["schema"], dataset["records"])
        rows = self._prepare_registry(registry)
        if metadata.get("storage_format_version", FORMAT_VERSION) != FORMAT_VERSION:
            raise StorageError("Unsupported storage format in snapshot metadata")
        metadata = {**metadata, "storage_format_version": FORMAT_VERSION}
        encoded_metadata = [(_identifier(name, "metadata name"), _encode(value)) for name, value in metadata.items()]
        with self._connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (_WRITE_LOCK,))
            connection.execute("DELETE FROM schemacraft.children")
            connection.execute("DELETE FROM schemacraft.schemas")
            for schema_id in sorted(prepared):
                self._write_prepared(connection, schema_id, prepared[schema_id])
            self._write_registry_prepared(connection, rows)
            connection.execute("DELETE FROM schemacraft.metadata")
            with connection.cursor() as cursor:
                cursor.executemany("INSERT INTO schemacraft.metadata(name,value,value_text) VALUES (%s,%s::jsonb,%s)", [(name, encoded, encoded) for name, encoded in encoded_metadata])

    def close(self) -> None:
        # Connections belong to individual operations and close on every exit.
        with self._state_lock:
            self._closed = True
