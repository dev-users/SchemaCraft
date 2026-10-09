"""Workspace-wide definitions, exports, reports, and portable packages.

This module deliberately does not know about SchemaCraft's record engine.  It
owns durable workspace metadata and byte-oriented report/package operations so
the Excel repositories can remain isolated and authoritative.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import re
import tempfile
import threading
import unicodedata
import zipfile
from collections.abc import Callable, Iterable
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from xml.sax.saxutils import escape

GLOBAL_DEFINITION_VERSION = 1
GLOBAL_REFERENCE = re.compile(r"^(gcat|gfld)_[a-f0-9]{12}$")
PORTABLE_PACKAGE_VERSION = 1


class AdvancedFeatureError(ValueError):
    """An advanced-feature error safe to show in the local application."""


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        prefix=f".{path.stem}-",
        suffix=path.suffix or ".json",
        dir=path.parent,
        delete=False,
    ) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _clean_definition(kind: str, definition: Any) -> dict[str, Any]:
    if kind not in {"category", "field"} or not isinstance(definition, dict):
        raise AdvancedFeatureError("تعريف العنصر العام غير صالح.")
    if kind == "field" and (definition.get("type") == "field_group" or definition.get("composition")):
        raise AdvancedFeatureError("مجموعة الحقول تحتاج فئتها وأعضاءها؛ احفظها ضمن فئة عامة لا كحقل مستقل.")
    if kind == "field" and definition.get("financial"):
        raise AdvancedFeatureError("الحقل المالي المرتبط بمصادر يحتاج فئته وسياق المصادر؛ احفظه ضمن فئة عامة لا كحقل مستقل.")
    if kind == "field":
        # A standalone reusable field has no source-field context. Record codes
        # are portable; other references belong in a containing category tree.
        from schemacraft_alert_messages import MessageError, remap_owner
        try:
            remap_owner(copy.deepcopy(definition), {})
        except MessageError as exc:
            raise AdvancedFeatureError(str(exc)) from exc
    result = copy.deepcopy(definition)
    result.pop("id", None)
    result.pop("global_ref", None)
    if kind == "category":
        # Placement always remains schema-local.  Field templates are kept so
        # a reusable category can be created together with its complete field
        # structure; local instances receive fresh stable IDs when inserted.
        result.pop("parent_category_id", None)
        result.pop("anchor_field_id", None)
    if not str(result.get("label") or "").strip():
        raise AdvancedFeatureError("اسم التعريف العام مطلوب.")
    return result


class GlobalDefinitionStore:
    """Revisioned library of reusable category and field configurations."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "global-definitions.json"
        self._lock = threading.RLock()

    def _empty(self) -> dict[str, Any]:
        timestamp = _now()
        return {
            "version": GLOBAL_DEFINITION_VERSION,
            "revision": 0,
            "created_at": timestamp,
            "updated_at": timestamp,
            "categories": {},
            "fields": {},
        }

    def read(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.is_file():
                payload = self._empty()
                _atomic_json(self.path, payload)
                return payload
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AdvancedFeatureError(
                    f"تعذّر قراءة مكتبة التعريفات العامة: {exc}"
                ) from exc
            if (
                not isinstance(payload, dict)
                or payload.get("version") != GLOBAL_DEFINITION_VERSION
                or not isinstance(payload.get("categories"), dict)
                or not isinstance(payload.get("fields"), dict)
            ):
                raise AdvancedFeatureError("مكتبة التعريفات العامة غير صالحة.")
            return payload

    def response(self) -> dict[str, Any]:
        payload = self.read()
        return copy.deepcopy(payload)

    def save_definition(
        self,
        kind: str,
        global_ref: str,
        definition: Any,
        *,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        prefix = "gcat" if kind == "category" else "gfld"
        if not GLOBAL_REFERENCE.fullmatch(global_ref) or not global_ref.startswith(prefix):
            raise AdvancedFeatureError("معرّف التعريف العام غير صالح.")
        with self._lock:
            payload = self.read()
            if expected_revision is not None and payload["revision"] != expected_revision:
                raise AdvancedFeatureError(
                    "تغيّرت مكتبة التعريفات العامة. أعد تحميلها ثم حاول مجددًا."
                )
            collection = payload["categories" if kind == "category" else "fields"]
            previous = collection.get(global_ref, {})
            timestamp = _now()
            collection[global_ref] = {
                "id": global_ref,
                "definition": _clean_definition(kind, definition),
                "created_at": previous.get("created_at", timestamp),
                "updated_at": timestamp,
            }
            payload["revision"] += 1
            payload["updated_at"] = timestamp
            _atomic_json(self.path, payload)
            return copy.deepcopy(collection[global_ref])

    def remove_definition(
        self, kind: str, global_ref: str, *, expected_revision: int | None = None
    ) -> dict[str, Any]:
        with self._lock:
            payload = self.read()
            if expected_revision is not None and payload["revision"] != expected_revision:
                raise AdvancedFeatureError(
                    "تغيّرت مكتبة التعريفات العامة. أعد تحميلها ثم حاول مجددًا."
                )
            collection = payload["categories" if kind == "category" else "fields"]
            if global_ref not in collection:
                raise AdvancedFeatureError("التعريف العام المطلوب غير موجود.")
            collection.pop(global_ref)
            payload["revision"] += 1
            payload["updated_at"] = _now()
            _atomic_json(self.path, payload)
            return {"ok": True, "global_ref": global_ref}

    def reorder_definition(
        self,
        kind: str,
        global_ref: str,
        direction: str,
        *,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        """Move a definition while preserving the revisioned JSON ordering."""

        if direction not in {"up", "down"}:
            raise AdvancedFeatureError("اتجاه نقل التعريف العام غير صالح.")
        with self._lock:
            payload = self.read()
            if expected_revision is not None and payload["revision"] != expected_revision:
                raise AdvancedFeatureError(
                    "تغيّرت مكتبة التعريفات العامة. أعد تحميلها ثم حاول مجددًا."
                )
            collection_name = "categories" if kind == "category" else "fields"
            collection = payload[collection_name]
            keys = list(collection)
            if global_ref not in collection:
                raise AdvancedFeatureError("التعريف العام المطلوب غير موجود.")
            index = keys.index(global_ref)
            target = index - 1 if direction == "up" else index + 1
            if target < 0 or target >= len(keys):
                return {
                    "ok": True,
                    "moved": False,
                    "global_ref": global_ref,
                    "global_definitions": copy.deepcopy(payload),
                }
            keys[index], keys[target] = keys[target], keys[index]
            payload[collection_name] = {key: collection[key] for key in keys}
            payload["revision"] += 1
            payload["updated_at"] = _now()
            _atomic_json(self.path, payload)
            return {
                "ok": True,
                "moved": True,
                "global_ref": global_ref,
                "global_definitions": copy.deepcopy(payload),
            }

    def reorder_definitions(self, kind: str, order: Any, *, expected_revision: int | None = None) -> dict[str, Any]:
        """Commit an explicit order in one revision, without repeated moves."""
        with self._lock:
            payload = self.read()
            if expected_revision is not None and payload["revision"] != expected_revision:
                raise AdvancedFeatureError("تغيّرت مكتبة التعريفات العامة. أعد تحميلها ثم حاول مجددًا.")
            key = "categories" if kind == "category" else "fields"
            collection = payload[key]
            if not isinstance(order, list) or any(not isinstance(ref, str) for ref in order) or len(order) != len(collection) or set(order) != set(collection):
                raise AdvancedFeatureError("ترتيب التعريفات العامة غير صالح.")
            payload[key] = {ref: collection[ref] for ref in order}
            payload["revision"] += 1
            payload["updated_at"] = _now()
            _atomic_json(self.path, payload)
            return {"ok": True, "global_definitions": copy.deepcopy(payload)}

    def definition(self, global_ref: str) -> dict[str, Any] | None:
        payload = self.read()
        collection = (
            payload["categories"]
            if global_ref.startswith("gcat_")
            else payload["fields"]
        )
        item = collection.get(global_ref)
        return copy.deepcopy(item.get("definition")) if item else None


class ExportHistoryStore:
    """Durable audit trail for administrator-initiated exports."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "export-history.json"
        self._lock = threading.RLock()

    def read(self) -> list[dict[str, Any]]:
        with self._lock:
            if not self.path.is_file():
                return []
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AdvancedFeatureError(f"تعذّر قراءة سجل التصدير: {exc}") from exc
            return payload if isinstance(payload, list) else []

    def append(self, entry: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            item = {
                "id": str(entry.get("id") or hashlib.sha256(os.urandom(32)).hexdigest()[:16]),
                "created_at": _now(),
                "type": str(entry.get("type") or "file"),
                "schemas": list(entry.get("schemas") or []),
                "schema_names": list(entry.get("schema_names") or []),
                "person_id": str(entry.get("person_id") or ""),
                "row_count": int(entry.get("row_count") or 0),
                "filename": str(entry.get("filename") or ""),
                "destination": str(entry.get("destination") or ""),
                "status": str(entry.get("status") or "success"),
                "checksum": str(entry.get("checksum") or ""),
                "backup_archive": str(entry.get("backup_archive") or "")[:1000],
                "notes": str(entry.get("notes") or "")[:4000],
                "user_name": str(entry.get("user_name") or "")[:160],
                "configuration": copy.deepcopy(entry.get("configuration") or {}),
            }
            entries.insert(0, item)
            _atomic_json(self.path, entries[:5000])
            return copy.deepcopy(item)

    def response(self, limit: int | None = 20) -> dict[str, Any]:
        entries = self.read()
        selected = entries if limit is None else entries[: max(1, min(limit, 5000))]
        return {
            "entries": copy.deepcopy(selected),
            "total": len(entries),
            "stats": {
                "success": sum(item.get("status") == "success" for item in entries),
                "failed": sum(item.get("status") == "failed" for item in entries),
                "cancelled": sum(item.get("status") in {"cancelled", "aborted"} for item in entries),
            },
        }

    def update_notes(self, entry_id: str, notes: Any) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            for item in entries:
                if item.get("id") == entry_id:
                    item["notes"] = str(notes or "").strip()[:4000]
                    _atomic_json(self.path, entries)
                    return copy.deepcopy(item)
            raise AdvancedFeatureError("عنصر سجل التصدير المطلوب غير موجود.")

    def delete(self, entry_id: str) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            removed = next((item for item in entries if item.get("id") == entry_id), None)
            if removed is None:
                raise AdvancedFeatureError("عنصر سجل التصدير المطلوب غير موجود.")
            _atomic_json(self.path, [item for item in entries if item.get("id") != entry_id])
            return copy.deepcopy(removed)

    def clear(self) -> list[dict[str, Any]]:
        """Permanently empty the authoritative history file."""

        with self._lock:
            removed = self.read()
            _atomic_json(self.path, [])
            return copy.deepcopy(removed)


class ImportHistoryStore:
    """Durable, searchable summaries of Excel and portable imports."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "import-history.json"
        self._lock = threading.RLock()

    def read(self) -> list[dict[str, Any]]:
        with self._lock:
            if not self.path.is_file():
                return []
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AdvancedFeatureError(f"تعذّر قراءة سجل الاستيراد: {exc}") from exc
            return payload if isinstance(payload, list) else []

    def append(self, entry: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            item = {
                "id": str(entry.get("id") or hashlib.sha256(os.urandom(32)).hexdigest()[:16]),
                "created_at": _now(),
                "type": str(entry.get("type") or "excel"),
                "schema_id": str(entry.get("schema_id") or ""),
                "schema_name": str(entry.get("schema_name") or ""),
                "filename": str(entry.get("filename") or "")[:500],
                "status": str(entry.get("status") or "success"),
                "added": int(entry.get("added") or 0),
                "updated": int(entry.get("updated") or 0),
                "skipped": int(entry.get("skipped") or 0),
                "rejected": int(entry.get("rejected") or 0),
                "details": copy.deepcopy(entry.get("details") or []),
                "notes": str(entry.get("notes") or "")[:4000],
                "title": str(entry.get("title") or "").strip()[:250],
                "user_name": str(entry.get("user_name") or "")[:160],
                "source_archive": str(entry.get("source_archive") or "")[:1000],
            }
            entries.insert(0, item)
            _atomic_json(self.path, entries[:5000])
            return copy.deepcopy(item)

    def update_notes(self, entry_id: str, notes: Any) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            for item in entries:
                if item.get("id") == entry_id:
                    item["notes"] = str(notes or "").strip()[:4000]
                    _atomic_json(self.path, entries)
                    return copy.deepcopy(item)
            raise AdvancedFeatureError("عنصر سجل الاستيراد المطلوب غير موجود.")

    def response(self, limit: int | None = 20) -> dict[str, Any]:
        entries = self.read()
        selected = entries if limit is None else entries[: max(1, min(limit, 5000))]
        return {
            "entries": copy.deepcopy(selected),
            "total": len(entries),
            "stats": {
                "success": sum(item.get("status") == "success" for item in entries),
                "failed": sum(item.get("status") == "failed" for item in entries),
                "aborted": sum(item.get("status") == "aborted" for item in entries),
            },
        }

    def update_source_archive(self, entry_id: str, relative_path: str) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            for item in entries:
                if item.get("id") == entry_id:
                    item["source_archive"] = str(relative_path or "")[:1000]
                    _atomic_json(self.path, entries)
                    return copy.deepcopy(item)
            raise AdvancedFeatureError("عنصر سجل الاستيراد المطلوب غير موجود.")

    def delete(self, entry_id: str) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            removed = next((item for item in entries if item.get("id") == entry_id), None)
            if removed is None:
                raise AdvancedFeatureError("عنصر سجل الاستيراد المطلوب غير موجود.")
            _atomic_json(self.path, [item for item in entries if item.get("id") != entry_id])
            return copy.deepcopy(removed)

    def clear(self) -> list[dict[str, Any]]:
        """Permanently empty the authoritative history file."""

        with self._lock:
            removed = self.read()
            _atomic_json(self.path, [])
            return copy.deepcopy(removed)


class AuditUserStore:
    """Names used for attribution only; never an authentication authority."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "audit-users.json"
        self._lock = threading.RLock()
        # The selected operator belongs to the running application session.
        # Persisting the list of known names is useful, but silently restoring
        # the previous operator on a later launch would misattribute audits.
        self._current_user = ""

    def _empty(self) -> dict[str, Any]:
        return {"version": 1, "current_user": "", "users": []}

    def read(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.is_file():
                return self._empty()
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AdvancedFeatureError(f"تعذّر قراءة أسماء المستخدمين: {exc}") from exc
            if not isinstance(payload, dict) or not isinstance(payload.get("users"), list):
                raise AdvancedFeatureError("ملف أسماء المستخدمين غير صالح.")
            users = []
            for raw in payload.get("users", []):
                name = " ".join(str(raw or "").split())[:160]
                if name and name.casefold() not in {item.casefold() for item in users}:
                    users.append(name)
            remembered = " ".join(str(payload.get("current_user") or "").split())[:160]
            if remembered and remembered.casefold() not in {item.casefold() for item in users}:
                users.append(remembered)
            return {
                "version": 1,
                "current_user": self._current_user,
                "users": users,
            }

    def select(self, name: Any) -> dict[str, Any]:
        clean = " ".join(str(name or "").split())[:160]
        if not clean:
            raise AdvancedFeatureError("اكتب اسم المستخدم.")
        with self._lock:
            payload = self.read()
            existing = next(
                (item for item in payload["users"] if item.casefold() == clean.casefold()),
                None,
            )
            selected = existing or clean
            if not existing:
                payload["users"].append(selected)
            self._current_user = selected
            # Keep older files readable while deliberately clearing the
            # persisted current user. The next process must ask again.
            stored = {
                "version": 1,
                "current_user": "",
                "users": payload["users"],
            }
            _atomic_json(self.path, stored)
            return {
                "version": 1,
                "current_user": selected,
                "users": copy.deepcopy(payload["users"]),
            }


class SearchHistoryStore:
    """Durable reusable search definitions with bounded result snapshots."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "search-history.json"
        self._lock = threading.RLock()

    def read(self) -> list[dict[str, Any]]:
        with self._lock:
            if not self.path.is_file():
                return []
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AdvancedFeatureError(f"تعذّر قراءة سجل البحث: {exc}") from exc
            return payload if isinstance(payload, list) else []

    def append(self, entry: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            raw_results = copy.deepcopy(entry.get("results") or {})
            if isinstance(raw_results.get("matches"), list):
                raw_results["matches"] = raw_results["matches"][:250]
            if isinstance(raw_results.get("results"), list):
                raw_results["results"] = raw_results["results"][:50]
                for schema_result in raw_results["results"]:
                    if isinstance(schema_result, dict) and isinstance(schema_result.get("matches"), list):
                        schema_result["matches"] = schema_result["matches"][:250]
            item = {
                "id": str(entry.get("id") or hashlib.sha256(os.urandom(32)).hexdigest()[:16]),
                "created_at": _now(),
                "mode": str(entry.get("mode") or "schema"),
                "name": str(entry.get("name") or "")[:240],
                "notes": str(entry.get("notes") or "")[:4000],
                "user_name": str(entry.get("user_name") or "")[:160],
                "schema_id": str(entry.get("schema_id") or ""),
                "schema_name": str(entry.get("schema_name") or "")[:240],
                "schema_ids": list(entry.get("schema_ids") or []),
                "filters": copy.deepcopy(entry.get("filters") or {}),
                "headers": copy.deepcopy(entry.get("headers") or {}),
                "query": str(entry.get("query") or "")[:4000],
                "result_total": max(0, int(entry.get("result_total") or 0)),
                "results": raw_results,
            }
            entries.insert(0, item)
            _atomic_json(self.path, entries[:5000])
            return copy.deepcopy(item)

    def response(self, limit: int | None = 50, query: str = "") -> dict[str, Any]:
        entries = self.read()
        needle = " ".join(str(query or "").split()).casefold()
        if needle:
            entries = [
                item for item in entries
                if needle in " ".join(
                    str(item.get(key) or "")
                    for key in ("created_at", "name", "notes", "user_name", "schema_name", "query")
                ).casefold()
            ]
        total = len(entries)
        selected = entries if limit is None else entries[: max(1, min(limit, 5000))]
        return {"entries": copy.deepcopy(selected), "total": total}

    def delete(self, entry_id: str) -> dict[str, Any]:
        with self._lock:
            entries = self.read()
            kept = [item for item in entries if item.get("id") != entry_id]
            if len(kept) == len(entries):
                raise AdvancedFeatureError("عملية البحث المطلوبة غير موجودة.")
            _atomic_json(self.path, kept)
            return {"ok": True, "id": entry_id}

    def purge_record(self, record_code: str, schema_id: str) -> int:
        """Remove a deleted profile from every retained search snapshot."""

        clean_code = str(record_code or "").strip().upper()
        clean_schema = str(schema_id or "").strip()
        if not clean_code:
            return 0
        removed = 0
        with self._lock:
            entries = self.read()
            for item in entries:
                results = item.get("results")
                if not isinstance(results, dict):
                    continue
                if isinstance(results.get("matches"), list) and (
                    not clean_schema or str(item.get("schema_id") or "") == clean_schema
                ):
                    before = len(results["matches"])
                    results["matches"] = [
                        match
                        for match in results["matches"]
                        if str(match.get("record_code") or "").upper() != clean_code
                    ]
                    removed += before - len(results["matches"])
                    results["total"] = min(
                        int(results.get("total") or before), len(results["matches"])
                    )
                if isinstance(results.get("results"), list):
                    for schema_result in results["results"]:
                        if not isinstance(schema_result, dict):
                            continue
                        if (
                            clean_schema
                            and str(schema_result.get("schema_id") or "") != clean_schema
                        ):
                            continue
                        matches = schema_result.get("matches")
                        if not isinstance(matches, list):
                            continue
                        before = len(matches)
                        schema_result["matches"] = [
                            match
                            for match in matches
                            if str(match.get("record_code") or "").upper() != clean_code
                        ]
                        removed += before - len(schema_result["matches"])
                        schema_result["total"] = min(
                            int(schema_result.get("total") or before),
                            len(schema_result["matches"]),
                        )
                nested_results = results.get("results")
                item["result_total"] = (
                    sum(
                        len(result.get("matches") or [])
                        for result in nested_results
                        if isinstance(result, dict)
                    )
                    if isinstance(nested_results, list)
                    else len(results.get("matches") or [])
                )
            if removed:
                _atomic_json(self.path, entries)
        return removed

    def clear(self) -> list[dict[str, Any]]:
        """Permanently empty the authoritative history file."""

        with self._lock:
            removed = self.read()
            _atomic_json(self.path, [])
            return copy.deepcopy(removed)


def portable_package_bytes(
    *,
    schema_id: str,
    schema_name: str,
    schema_path: Path,
    workbook_path: Path,
    attachments_path: Path,
    global_definitions: dict[str, Any],
    records: list[dict[str, Any]] | None = None,
    source_deployment_id: str | None = None,
) -> bytes:
    """Create a validated one-schema package that can round-trip exactly."""

    files: dict[str, bytes] = {
        "schema.json": schema_path.read_bytes(),
        "database.xlsx": workbook_path.read_bytes(),
        "global-definitions.json": json.dumps(
            global_definitions, ensure_ascii=False, indent=2
        ).encode("utf-8"),
    }
    if records is not None:
        files['records.json'] = json.dumps({'format': 'SchemaCraft Records', 'version': 1,
                                          'records': records}, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if attachments_path.is_dir():
        for path in sorted(attachments_path.rglob("*")):
            if path.is_file():
                relative = path.relative_to(attachments_path).as_posix()
                files[f"attachments/{relative}"] = path.read_bytes()
    checksums = {
        name: hashlib.sha256(content).hexdigest() for name, content in files.items()
    }
    manifest = {
        "format": "SchemaCraft Portable Schema",
        "version": PORTABLE_PACKAGE_VERSION,
        "schema_id": schema_id,
        "schema_name": schema_name,
        "created_at": _now(),
        "files": sorted(files),
    }
    if records is not None:
        manifest['record_format'] = {'name': 'SchemaCraft Records', 'version': 1}
    if source_deployment_id:
        manifest['source_deployment_id'] = source_deployment_id
    files["manifest.json"] = json.dumps(
        manifest, ensure_ascii=False, indent=2
    ).encode("utf-8")
    files["checksums.json"] = json.dumps(
        checksums, ensure_ascii=False, indent=2
    ).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def inspect_portable_package(data: bytes) -> dict[str, Any]:
    if len(data) > 1024 * 1024 * 1024:
        raise AdvancedFeatureError("حزمة الاستيراد أكبر من الحد المسموح.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile as exc:
        raise AdvancedFeatureError("ملف ZIP ليس حزمة SchemaCraft صالحة.") from exc
    with archive:
        listed_names = archive.namelist()
        names = set(listed_names)
        if len(names) != len(listed_names):
            raise AdvancedFeatureError("حزمة SchemaCraft تحتوي على أسماء ملفات مكررة.")
        required = {
            "manifest.json",
            "checksums.json",
            "schema.json",
            "database.xlsx",
            "global-definitions.json",
        }
        if not required.issubset(names):
            raise AdvancedFeatureError("حزمة SchemaCraft لا تحتوي على كل الملفات المطلوبة.")
        total_size = 0
        for info in archive.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or info.file_size > 250 * 1024 * 1024:
                raise AdvancedFeatureError("حزمة SchemaCraft تحتوي على مسار غير آمن.")
            total_size += info.file_size
            if total_size > 1024 * 1024 * 1024:
                raise AdvancedFeatureError("محتوى حزمة SchemaCraft أكبر من الحد المسموح.")
        try:
            manifest = json.loads(archive.read("manifest.json"))
            checksums = json.loads(archive.read("checksums.json"))
            schema = json.loads(archive.read("schema.json"))
            global_definitions = json.loads(archive.read("global-definitions.json"))
        except (json.JSONDecodeError, KeyError) as exc:
            raise AdvancedFeatureError("بيانات حزمة SchemaCraft غير صالحة.") from exc
        if (
            manifest.get("format") != "SchemaCraft Portable Schema"
            or manifest.get("version") != PORTABLE_PACKAGE_VERSION
        ):
            raise AdvancedFeatureError("إصدار حزمة SchemaCraft غير مدعوم.")
        manifest_files = manifest.get("files")
        if (
            not isinstance(manifest_files, list)
            or not isinstance(checksums, dict)
            or set(manifest_files) != set(checksums)
            or not (required - {"manifest.json", "checksums.json"}).issubset(
                set(manifest_files)
            )
            or not set(manifest_files).issubset(names)
        ):
            raise AdvancedFeatureError("قائمة ملفات الحزمة أو بصماتها غير مكتملة.")
        for name, expected in checksums.items():
            if (
                not isinstance(name, str)
                or not isinstance(expected, str)
                or not re.fullmatch(r"[a-f0-9]{64}", expected)
                or name not in names
                or hashlib.sha256(archive.read(name)).hexdigest() != expected
            ):
                raise AdvancedFeatureError(f'فشل التحقق من الملف "{name}" داخل الحزمة.')
        attachments = [name for name in names if name.startswith("attachments/")]
        result = {
            "manifest": manifest,
            "schema": schema,
            "global_definitions": global_definitions,
            "record_workbook_bytes": archive.read("database.xlsx"),
            "attachments": {name: archive.read(name) for name in attachments},
        }
        if 'records.json' in names:
            if 'records.json' not in manifest_files:
                raise AdvancedFeatureError('بيانات السجلات الأصلية غير مشمولة ببصمات الحزمة.')
            try:
                native = json.loads(archive.read('records.json'))
                if native.get('format') != 'SchemaCraft Records' or native.get('version') != 1 or not isinstance(native.get('records'), list):
                    raise ValueError('record format')
                result['records'] = native['records']
            except (ValueError, AttributeError, UnicodeError) as exc:
                raise AdvancedFeatureError('بيانات السجلات الأصلية داخل الحزمة غير صالحة.') from exc
        return result


def _arabic_glyph_forms(character: str) -> tuple[str, str, str, str] | None:
    """Return Unicode presentation forms without an external shaping engine."""

    name = unicodedata.name(character, "")
    if not name.startswith("ARABIC LETTER "):
        return None
    forms: list[str] = []
    for suffix in (" ISOLATED FORM", " FINAL FORM", " INITIAL FORM", " MEDIAL FORM"):
        try:
            forms.append(unicodedata.lookup(name + suffix))
        except KeyError:
            forms.append("")
    return tuple(forms)  # type: ignore[return-value]


def _shape_arabic_token(token: str) -> str:
    clusters: list[list[str]] = []
    for character in token:
        if unicodedata.combining(character) and clusters:
            clusters[-1].append(character)
        else:
            clusters.append([character])

    bases = [cluster[0] for cluster in clusters]
    shaped: list[str] = []
    for index, cluster in enumerate(clusters):
        forms = _arabic_glyph_forms(cluster[0])
        if forms is None:
            shaped.append("".join(cluster))
            continue
        previous = _arabic_glyph_forms(bases[index - 1]) if index else None
        following = (
            _arabic_glyph_forms(bases[index + 1])
            if index + 1 < len(bases)
            else None
        )
        joins_previous = bool(previous and previous[2] and forms[1])
        joins_following = bool(forms[2] and following and following[1])
        if joins_previous and joins_following and forms[3]:
            glyph = forms[3]
        elif joins_previous and forms[1]:
            glyph = forms[1]
        elif joins_following and forms[2]:
            glyph = forms[2]
        else:
            glyph = forms[0] or cluster[0]
        shaped.append(glyph + "".join(cluster[1:]))
    visual = "".join(reversed(shaped))
    # Arabic filenames often include Latin extensions or record identifiers.
    # Keep those embedded runs readable after reversing the Arabic clusters.
    ltr = r"[A-Za-z0-9_\u0660-\u0669\u06f0-\u06f9]+(?:[.:/+%\-][A-Za-z0-9_\u0660-\u0669\u06f0-\u06f9]+)*"
    return re.sub(ltr, lambda match: match.group()[::-1], visual)


def _pdf_visual_line(line: str) -> str:
    """Shape one logical line into the visual order expected by ReportLab."""

    if not any(_arabic_glyph_forms(character) for character in line):
        return line
    tokens = re.findall(r"\S+|\s+", line)
    visual: list[str] = []
    for token in reversed(tokens):
        if token.isspace():
            visual.append(token)
        elif any(_arabic_glyph_forms(character) for character in token):
            visual.append(_shape_arabic_token(token))
        else:
            visual.append(token)
    return "".join(visual)


def _pdf_wrap_logical_line(
    line: str,
    max_width: float,
    measure: Callable[[str], float],
) -> list[str]:
    """Wrap in logical reading order before Arabic visual-order conversion."""

    words = line.split()
    if not words:
        return [""]
    wrapped: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if measure(_pdf_visual_line(candidate)) <= max_width:
            current = candidate
            continue
        if current:
            wrapped.append(current)
            current = ""
        # Long filenames/identifiers must wrap inside a narrow field too.
        for character in word:
            candidate = current + character
            if current and measure(_pdf_visual_line(candidate)) > max_width:
                wrapped.append(current)
                current = character
            else:
                current = candidate
    if current:
        wrapped.append(current)
    return wrapped


def _pdf_text(
    value: Any,
    *,
    max_width: float | None = None,
    measure: Callable[[str], float] | None = None,
) -> str:
    """Prepare safe, top-to-bottom visual-order Arabic for ReportLab."""

    text = str(value or "")
    # Automatic ReportLab wrapping happens after visual-order reversal and can
    # therefore put the beginning of a long Arabic sentence on the last line.
    # Wrap the logical text first, then shape every resulting line separately.
    logical_lines: list[str] = []
    for source_line in text.splitlines() or [""]:
        if max_width is not None and measure is not None:
            logical_lines.extend(_pdf_wrap_logical_line(source_line, max_width, measure))
        else:
            logical_lines.append(source_line)
    return "<br/>".join(escape(_pdf_visual_line(line)) for line in logical_lines)


def readonly_pdf_grid(fields: Iterable[dict[str, Any]]) -> list[list[tuple[int, int, dict[str, Any]]]]:
    """Place fields in six RTL columns without backfilling gaps."""
    rows = []
    row = []
    used = 0
    for field in fields:
        width = {"normal": "1", "wide": "4", "long": "4"}.get(str(field.get("width")), str(field.get("width") or "1"))
        span = 6 if width == "full" else max(1, min(6, int(width))) if width.isdigit() else 1
        if used + span > 6 or (used and field.get("start_new_line")):
            rows.append(row)
            row, used = [], 0
        row.append((6 - used - span, span, field))
        used += span
    if row:
        rows.append(row)
    return rows


def _pdf_image_flowable(path: Path, max_width: float, max_height: float):
    """Decode and orient the actual image, retaining aspect ratio."""
    from PIL import Image as PillowImage, ImageOps
    from reportlab.platypus import Image
    try:
        with PillowImage.open(path) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail((2400, 3200))
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA")
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)
            width, height = image.size
        ratio = min(max_width / width, max_height / height)
        return Image(buffer, width=width*ratio, height=height*ratio)
    except Exception as exc:
        raise AdvancedFeatureError(f"تعذّر قراءة صورة المرفق: {path.name}") from exc


def _pdf_attachment_image_page(attachment, font_name):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, leftMargin=34, rightMargin=34, topMargin=34, bottomMargin=34)
    style = ParagraphStyle("AttachmentTitle", fontName=font_name, fontSize=11, leading=16, alignment=TA_RIGHT)
    label = " — ".join(filter(None, [attachment.get("schema_name"), attachment.get("category"), attachment.get("field")]))
    image = _pdf_image_flowable(Path(attachment["path"]), document.width-12, document.height-100)
    image.hAlign = "CENTER"
    document.build([Paragraph(_pdf_text(attachment["name"]), style), Paragraph(_pdf_text(label),style), Spacer(1,16), image])
    return output.getvalue()


def _append_pdf_attachments(content, attachments, font_name):
    if not attachments:
        return content
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError as exc:
        raise AdvancedFeatureError("مكوّن دمج مرفقات PDF غير مثبت في هذه النسخة.") from exc
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(content)), import_outline=False)
    for attachment in attachments:
        path = Path(attachment["path"])
        try:
            if path.suffix.lower() == ".pdf":
                reader = PdfReader(io.BytesIO(path.read_bytes()))
                if reader.is_encrypted and not reader.decrypt(""):
                    raise AdvancedFeatureError(f"المرفق محمي بكلمة مرور: {path.name}")
                writer.append(reader, import_outline=False)
            else:
                page = _pdf_attachment_image_page(attachment, font_name)
                writer.append(PdfReader(io.BytesIO(page)), import_outline=False)
        except AdvancedFeatureError:
            raise
        except Exception as exc:
            raise AdvancedFeatureError(f"تعذّر تضمين المرفق داخل PDF: {path.name}") from exc
    output = io.BytesIO()
    writer.write(output)
    writer.close()
    return output.getvalue()


def profile_pdf_bytes(title: str, profiles: Iterable[dict[str, Any]], font_path: Path) -> bytes:
    """Print the read-only section/card layout with its six-column field widths."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak, HRFlowable
    except ImportError as exc:
        raise AdvancedFeatureError("مكوّن إنشاء PDF غير مثبت في هذه النسخة.") from exc
    if not font_path.is_file():
        raise AdvancedFeatureError("خط PDF العربي المضمّن غير موجود.")
    font_name = "SchemaCraftArabic"
    if font_name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=12*mm, leftMargin=12*mm,
        topMargin=12*mm, bottomMargin=12*mm, title=title)
    normal = ParagraphStyle("ReadonlyValue", fontName=font_name, fontSize=10.5, leading=16,
        alignment=TA_RIGHT, textColor=colors.HexColor("#172a40"))
    label_style = ParagraphStyle("ReadonlyLabel", parent=normal, fontSize=8.5, leading=13,
        textColor=colors.HexColor("#617086"))
    heading = ParagraphStyle("ReadonlyTitle", parent=normal, fontSize=20, leading=28, spaceAfter=14, keepWithNext=True)
    section_style = ParagraphStyle("ReadonlyCategory", parent=normal, fontSize=12, leading=18,
        textColor=colors.HexColor("#17496f"), spaceBefore=12, spaceAfter=8, keepWithNext=True)
    def paragraph(text, style, width):
        measure = lambda visual: pdfmetrics.stringWidth(visual, font_name, style.fontSize)
        return Paragraph(_pdf_text(text, max_width=width, measure=measure), style)
    story = []
    profiles = list(profiles)
    for profile_index, profile in enumerate(profiles):
        if profile_index:
            story.append(PageBreak())
        story.append(paragraph("عرض للقراءة فقط", label_style, document.width))
        story.append(paragraph(profile.get("title") or title, heading, document.width))
        story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#2f78c4"), spaceAfter=12))
        if len(profiles) > 1:
            story.append(paragraph(profile.get("schema_name"), label_style, document.width))
        sections = profile.get("sections")
        if sections is None:
            sections = [{"label":"", "cards":[{"title":"", "fields":profile.get("fields", [])}]}]
        if not sections:
            story.append(paragraph("لا يحتوي هذا السجل على بيانات معروضة.", normal, document.width))
        for section in sections:
            if section.get("label"):
                category_heading = paragraph(section["label"], section_style, document.width-112 if section.get("profile_image") else document.width)
                if section.get("profile_image"):
                    image = _pdf_image_flowable(Path(section["profile_image"]), 28*mm, 38*mm)
                    image.hAlign = "LEFT"
                    category_heading = Table([[image, category_heading]], colWidths=[36*mm, document.width-36*mm])
                    category_heading.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0)]))
                    category_heading.keepWithNext = True
                story.append(category_heading)
                story.append(HRFlowable(width="100%", thickness=.4, color=colors.HexColor("#dce4ed"), spaceAfter=6))
            for card in section.get("cards", []):
                repeated = section.get("kind") == "repeatable" or bool(card.get("title"))
                width = document.width
                unit = width / 6
                rows, commands = [], []
                if card.get("profile_image"):
                    image = _pdf_image_flowable(Path(card["profile_image"]), unit-14, 38*mm)
                    image.hAlign = "LEFT"
                    rows.append([image, paragraph(card.get("title", ""), normal, width-unit-14), "", "", "", ""])
                    commands.append(("SPAN", (1,0), (5,0)))
                elif card.get("title"):
                    rows.append([paragraph(card["title"], normal, width-16), "", "", "", "", ""])
                    commands.append(("SPAN", (0,0), (5,0)))
                for grid_row in readonly_pdf_grid(card.get("fields", [])):
                    prepared = []
                    for column, span, field in grid_row:
                        available = unit*span-14
                        measure = lambda visual: pdfmetrics.stringWidth(visual, font_name, normal.fontSize)
                        lines = []
                        for line in str(field.get("value", "")).splitlines() or [""]:
                            lines.extend(_pdf_wrap_logical_line(line, available, measure))
                        prepared.append((column, span, field, available, lines))
                    # Bound row height before pagination. ReportLab's in-row
                    # splitting of spanned cells can leave giant empty regions.
                    for start in range(0, max(len(item[4]) for item in prepared), 16):
                        cells = [""] * 6
                        row_index = len(rows)
                        for column, span, field, available, lines in prepared:
                            content = []
                            if start == 0:
                                content.extend([paragraph(field.get("label"), label_style, available), Spacer(1,3)])
                            if start < len(lines):
                                content.append(Paragraph(_pdf_text("\n".join(lines[start:start+16])), normal))
                            cells[column] = content
                            if span > 1:
                                commands.append(("SPAN", (column,row_index), (column+span-1,row_index)))
                            if start + 16 >= max(len(item[4]) for item in prepared):
                                commands.append(("LINEBELOW", (column,row_index), (column+span-1,row_index), .35, colors.HexColor("#e5eaf0")))
                        rows.append(cells)
                if not rows:
                    continue
                commands.extend([("VALIGN",(0,0),(-1,-1),"TOP"), ("ALIGN",(0,0),(-1,-1),"RIGHT"),
                    ("LEFTPADDING",(0,0),(-1,-1),7), ("RIGHTPADDING",(0,0),(-1,-1),7),
                    ("TOPPADDING",(0,0),(-1,-1),8), ("BOTTOMPADDING",(0,0),(-1,-1),8)])
                if repeated:
                    commands.extend([("BOX",(0,0),(-1,-1),.5,colors.HexColor("#dce4ed")),
                        ("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f7f9fc"))])
                table = Table(rows, colWidths=[unit]*6, hAlign="RIGHT", splitByRow=1, splitInRow=0,
                    repeatRows=1 if card.get("title") else 0, cornerRadii=[8]*4 if repeated else None)
                table.setStyle(TableStyle(commands))
                story.extend([table, Spacer(1,9)])
    document.build(story)
    attachments = [{**attachment, "schema_name":profile.get("schema_name", "")} for profile in profiles for attachment in profile.get("attachments", [])]
    return _append_pdf_attachments(output.getvalue(), attachments, font_name)


def choose_export_destination(default_name: str, file_types: list[tuple[str, str]]) -> Path | None:
    """Open the operating-system save dialog from the local desktop process."""

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise AdvancedFeatureError("مكوّن اختيار مكان الحفظ غير متاح.") from exc
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.asksaveasfilename(
            title="اختر مكان حفظ الملف",
            initialfile=default_name,
            filetypes=file_types,
            defaultextension=(file_types[0][1].replace("*", "") if file_types else ""),
        )
    finally:
        root.destroy()
    return normalize_export_destination(Path(selected), file_types) if selected else None


def choose_directory(title: str = "اختر المجلد") -> Path | None:
    """Open a native, local-only folder picker."""

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise AdvancedFeatureError("مكوّن اختيار المجلد غير متاح.") from exc
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(title=title, mustexist=True)
    finally:
        root.destroy()
    return Path(selected).resolve() if selected else None


def normalize_export_destination(
    destination: Path, file_types: list[tuple[str, str]]
) -> Path:
    """Append the expected suffix when a save-dialog filename omits it."""

    allowed = [pattern.replace("*", "").casefold() for _label, pattern in file_types]
    if not allowed:
        return destination
    if not destination.suffix:
        return destination.with_suffix(allowed[0])
    if destination.suffix.casefold() not in set(allowed):
        raise AdvancedFeatureError("امتداد ملف التصدير لا يطابق النوع المختار.")
    return destination


def save_export_bytes(
    content: bytes,
    default_name: str,
    file_types: list[tuple[str, str]],
    *,
    destination: Path | None = None,
) -> Path | None:
    target = (
        normalize_export_destination(destination, file_types)
        if destination is not None
        else choose_export_destination(default_name, file_types)
    )
    if target is None:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb", prefix=f".{target.stem}-", suffix=target.suffix, dir=target.parent, delete=False
    ) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target
