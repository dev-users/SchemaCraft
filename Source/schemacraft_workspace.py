"""Multi-schema workspace and global identity registry for SchemaCraft.

The record engine intentionally remains in :mod:`SchemaCraft`.  This module
owns the durable catalog, isolated schema folders, legacy Release 2 migration,
and the Excel-backed global person identity registry.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import unicodedata
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook, load_workbook

WORKSPACE_VERSION = 1
REGISTRY_SHEET = "identities"
REGISTRY_HEADERS = (
    "person_id",
    "person_uuid",
    "schema_ids",
    "created_at",
    "updated_at",
    "retired",
)
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
PERSON_CODE = re.compile(r"^[A-Z][A-Z0-9]{7}$")
_ACTIVE_CONTEXT: ContextVar[SchemaContext | None] = ContextVar(
    "schemacraft_schema_context", default=None
)


class WorkspaceError(ValueError):
    """A workspace error safe to display to the local user."""


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        prefix=f".{path.stem}-",
        suffix=".json",
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


def _safe_name(value: Any, fallback: str = "Schema") -> str:
    text = " ".join(str(value or "").split()).strip(" .")
    text = INVALID_FILENAME.sub(" ", text)
    text = " ".join(text.split()).strip(" .")
    if not text:
        text = fallback
    if text.casefold() in {
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4",
        "lpt1", "lpt2", "lpt3", "lpt4",
    }:
        text = f"{text}-schema"
    return text[:80]


def _folder_slug(name: str, schema_id: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text).strip("-").lower()
    return f"{slug or 'schema'}-{schema_id[:8]}"


@dataclass(frozen=True)
class SchemaContext:
    schema_id: str
    name: str
    folder: Path
    schema_path: Path
    workbook_path: Path
    attachments_path: Path
    archived: bool = False


def active_context() -> SchemaContext | None:
    return _ACTIVE_CONTEXT.get()


@contextmanager
def use_context(context: SchemaContext) -> Iterator[SchemaContext]:
    token = _ACTIVE_CONTEXT.set(context)
    try:
        yield context
    finally:
        _ACTIVE_CONTEXT.reset(token)


class WorkspaceManager:
    """Durable catalog plus globally unique identity authority."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.catalog_path = self.data_dir / "workspace.json"
        self.schemas_dir = self.data_dir / "schemas"
        self.registry_path = self.data_dir / "identity-registry.xlsx"
        self.migration_dir = self.data_dir / "release-2-original"
        self._lock = threading.RLock()
        self._registry: dict[str, dict[str, Any]] = {}
        self._catalog: dict[str, Any] = {}

    def initialize(self, default_schema: dict[str, Any]) -> SchemaContext:
        with self._lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.schemas_dir.mkdir(parents=True, exist_ok=True)
            if self.catalog_path.is_file():
                self._catalog = self._read_catalog()
            else:
                self._catalog = self._migrate_or_create(default_schema)
                _atomic_json(self.catalog_path, self._catalog)
            self._validate_catalog()
            self._load_or_rebuild_registry()
            return self.context(self._catalog["active_schema_id"])

    def _read_catalog(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise WorkspaceError(f"تعذّر قراءة مساحة العمل متعددة التصاميم: {exc}") from exc
        if not isinstance(payload, dict):
            raise WorkspaceError("ملف مساحة العمل غير صالح.")
        return payload

    def _migrate_or_create(self, default_schema: dict[str, Any]) -> dict[str, Any]:
        legacy_schema = self.data_dir / "schema.json"
        legacy_workbook = self.data_dir / "database.xlsx"
        schema_id = uuid.uuid4().hex
        name = "التصميم الرئيسي"
        if legacy_schema.is_file():
            try:
                legacy_definition = json.loads(
                    legacy_schema.read_text(encoding="utf-8")
                )
                legacy_app = legacy_definition.get("app", {})
                name = _safe_name(
                    legacy_app.get("entity_plural")
                    or legacy_app.get("title")
                    or name
                )
            except (OSError, json.JSONDecodeError, AttributeError):
                pass
        folder_name = _folder_slug(name, schema_id)
        folder = self.schemas_dir / folder_name
        folder.mkdir(parents=True, exist_ok=False)
        workbook_name = f"{_safe_name(name)}.xlsx"

        if legacy_schema.is_file() or legacy_workbook.is_file():
            self.migration_dir.mkdir(parents=True, exist_ok=True)
        if legacy_schema.is_file():
            shutil.copy2(legacy_schema, self.migration_dir / "schema.json")
            shutil.copy2(legacy_schema, folder / "schema.json")
        else:
            _atomic_json(folder / "schema.json", default_schema)
        if legacy_workbook.is_file():
            # copy2 preserves the original workbook bytes and timestamps.  The
            # legacy file remains available in release-2-original as recovery.
            shutil.copy2(legacy_workbook, self.migration_dir / "database.xlsx")
            shutil.copy2(legacy_workbook, folder / workbook_name)

        (folder / "attachments").mkdir(parents=True, exist_ok=True)
        legacy_attachments = self.data_dir / "attachments"
        if legacy_attachments.is_dir():
            backup_attachments = self.migration_dir / "attachments"
            if not backup_attachments.exists():
                shutil.copytree(legacy_attachments, backup_attachments)
            shutil.copytree(
                legacy_attachments,
                folder / "attachments",
                dirs_exist_ok=True,
            )

        timestamp = _now()
        return {
            "workspace_version": WORKSPACE_VERSION,
            "active_schema_id": schema_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            "schemas": [
                {
                    "id": schema_id,
                    "name": name,
                    "folder": folder_name,
                    "workbook": workbook_name,
                    "archived": False,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "migrated_from_release_2": bool(
                        legacy_schema.is_file() or legacy_workbook.is_file()
                    ),
                }
            ],
        }

    def _validate_catalog(self) -> None:
        try:
            version = int(self._catalog.get("workspace_version"))
        except (TypeError, ValueError) as exc:
            raise WorkspaceError("إصدار مساحة العمل غير صالح.") from exc
        if version != WORKSPACE_VERSION:
            raise WorkspaceError("إصدار مساحة العمل غير مدعوم.")
        schemas = self._catalog.get("schemas")
        if not isinstance(schemas, list) or not schemas:
            raise WorkspaceError("مساحة العمل لا تحتوي على أي تصميم.")
        seen_ids: set[str] = set()
        seen_names: set[str] = set()
        for entry in schemas:
            if not isinstance(entry, dict):
                raise WorkspaceError("أحد تعريفات التصميم غير صالح.")
            schema_id = str(entry.get("id") or "")
            name = " ".join(str(entry.get("name") or "").split())
            if not re.fullmatch(r"[a-f0-9]{32}", schema_id):
                raise WorkspaceError("المعرّف الداخلي لأحد التصاميم غير صالح.")
            if schema_id in seen_ids or not name or name.casefold() in seen_names:
                raise WorkspaceError("أسماء التصاميم أو معرفاتها مكررة.")
            seen_ids.add(schema_id)
            seen_names.add(name.casefold())
            context = self._context_from_entry(entry)
            if not context.schema_path.is_file():
                raise WorkspaceError(f'ملف تصميم "{name}" غير موجود.')
        parents = {entry["id"]: entry.get("profile_source_schema_id", "") for entry in schemas}
        for schema_id in parents:
            visited = {schema_id}
            parent = parents[schema_id]
            while parent:
                if parent not in parents or parent in visited:
                    raise WorkspaceError("مصدر مزامنة الملفات غير صالح أو يتضمن حلقة.")
                visited.add(parent)
                parent = parents[parent]
        if self._catalog.get("active_schema_id") not in seen_ids:
            self._catalog["active_schema_id"] = schemas[0]["id"]
            self._save_catalog()

    def _entry(self, schema_id: str) -> dict[str, Any]:
        for entry in self._catalog.get("schemas", []):
            if entry.get("id") == schema_id:
                return entry
        raise WorkspaceError("التصميم المطلوب غير موجود.")

    def _context_from_entry(self, entry: dict[str, Any]) -> SchemaContext:
        folder = (self.schemas_dir / str(entry["folder"])).resolve()
        root = self.schemas_dir.resolve()
        if root not in folder.parents:
            raise WorkspaceError("مسار أحد التصاميم غير آمن.")
        workbook = folder / str(entry["workbook"])
        return SchemaContext(
            schema_id=str(entry["id"]),
            name=str(entry["name"]),
            folder=folder,
            schema_path=folder / "schema.json",
            workbook_path=workbook,
            attachments_path=folder / "attachments",
            archived=bool(entry.get("archived")),
        )

    def context(self, schema_id: str | None = None) -> SchemaContext:
        with self._lock:
            selected = schema_id or str(self._catalog.get("active_schema_id") or "")
            return self._context_from_entry(self._entry(selected))

    def contexts(self, *, include_archived: bool = True) -> list[SchemaContext]:
        with self._lock:
            return [
                self._context_from_entry(entry)
                for entry in self._catalog["schemas"]
                if include_archived or not entry.get("archived")
            ]

    def response(self) -> dict[str, Any]:
        with self._lock:
            return {
                "workspace_version": WORKSPACE_VERSION,
                "active_schema_id": self._catalog["active_schema_id"],
                "schemas": [
                    {
                        "id": entry["id"],
                        "name": entry["name"],
                        "archived": bool(entry.get("archived")),
                        "workbook": entry["workbook"],
                        "created_at": entry.get("created_at", ""),
                        "updated_at": entry.get("updated_at", ""),
                        "profile_source_schema_id": entry.get("profile_source_schema_id", ""),
                    }
                    for entry in self._catalog["schemas"]
                ],
            }

    def _save_catalog(self) -> None:
        self._catalog["updated_at"] = _now()
        _atomic_json(self.catalog_path, self._catalog)

    def set_active(self, schema_id: str) -> SchemaContext:
        with self._lock:
            context = self.context(schema_id)
            if context.archived:
                raise WorkspaceError("لا يمكن جعل تصميم مؤرشف هو التصميم النشط.")
            self._catalog["active_schema_id"] = schema_id
            self._save_catalog()
            return context

    def create_schema(
        self,
        name: Any,
        schema_definition: dict[str, Any],
        *,
        template_schema_id: str | None = None,
        profile_source_schema_id: str | None = None,
    ) -> SchemaContext:
        with self._lock:
            clean_name = _safe_name(name, "")
            if profile_source_schema_id:
                self.context(profile_source_schema_id)
            if not clean_name:
                raise WorkspaceError("اكتب اسمًا للتصميم الجديد.")
            if any(
                str(entry["name"]).casefold() == clean_name.casefold()
                for entry in self._catalog["schemas"]
            ):
                raise WorkspaceError("يوجد تصميم آخر بالاسم نفسه.")
            schema_id = uuid.uuid4().hex
            folder_name = _folder_slug(clean_name, schema_id)
            folder = self.schemas_dir / folder_name
            folder.mkdir(parents=True, exist_ok=False)
            workbook_name = f"{clean_name}.xlsx"
            if template_schema_id:
                template = self.context(template_schema_id)
                shutil.copy2(template.schema_path, folder / "schema.json")
            else:
                _atomic_json(folder / "schema.json", schema_definition)
            (folder / "attachments").mkdir(parents=True, exist_ok=True)
            timestamp = _now()
            self._catalog["schemas"].append(
                {
                    "id": schema_id,
                    "name": clean_name,
                    "folder": folder_name,
                    "workbook": workbook_name,
                    "archived": False,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "profile_source_schema_id": profile_source_schema_id or "",
                    "profile_source_seen_codes": [],
                }
            )
            self._catalog["active_schema_id"] = schema_id
            self._save_catalog()
            return self.context(schema_id)

    def profile_dependents(self, source_id: str) -> list[tuple[SchemaContext, set[str]]]:
        """Return direct downstream schemas and their last applied source IDs."""
        with self._lock:
            return [
                (self._context_from_entry(entry), set(entry.get("profile_source_seen_codes", [])))
                for entry in self._catalog["schemas"]
                if entry.get("profile_source_schema_id") == source_id
            ]

    def mark_profile_source_seen(self, schema_id: str, codes: set[str]) -> None:
        with self._lock:
            entry = self._entry(schema_id)
            entry["profile_source_seen_codes"] = sorted(codes)
            self._save_catalog()

    def rename_schema(self, schema_id: str, name: Any) -> SchemaContext:
        with self._lock:
            entry = self._entry(schema_id)
            clean_name = _safe_name(name, "")
            if not clean_name:
                raise WorkspaceError("اكتب اسمًا صالحًا للتصميم.")
            if any(
                other["id"] != schema_id
                and str(other["name"]).casefold() == clean_name.casefold()
                for other in self._catalog["schemas"]
            ):
                raise WorkspaceError("يوجد تصميم آخر بالاسم نفسه.")
            old_context = self._context_from_entry(entry)
            new_workbook_name = f"{clean_name}.xlsx"
            new_workbook = old_context.folder / new_workbook_name
            if old_context.workbook_path.is_file() and old_context.workbook_path != new_workbook:
                if new_workbook.exists():
                    raise WorkspaceError("اسم ملف Excel الجديد مستخدم مسبقًا.")
                os.replace(old_context.workbook_path, new_workbook)
            entry["name"] = clean_name
            entry["workbook"] = new_workbook_name
            entry["updated_at"] = _now()
            self._save_catalog()
            return self.context(schema_id)

    def archive_schema(self, schema_id: str, archived: bool) -> SchemaContext:
        with self._lock:
            entry = self._entry(schema_id)
            if archived:
                active = [item for item in self._catalog["schemas"] if not item.get("archived")]
                if len(active) <= 1:
                    raise WorkspaceError("يجب أن يبقى تصميم نشط واحد على الأقل.")
            entry["archived"] = bool(archived)
            entry["updated_at"] = _now()
            if archived and self._catalog["active_schema_id"] == schema_id:
                replacement = next(
                    item for item in self._catalog["schemas"] if not item.get("archived")
                )
                self._catalog["active_schema_id"] = replacement["id"]
            self._save_catalog()
            return self.context(schema_id)

    def delete_schema(self, schema_id: str, confirmation_name: Any) -> dict[str, Any]:
        """Permanently remove one schema after an exact typed-name confirmation.

        The caller is responsible for creating the automatic workspace backup
        before invoking this operation.
        """
        with self._lock:
            entry = self._entry(schema_id)
            expected = str(entry.get("name") or "").strip()
            if self.profile_dependents(schema_id):
                raise WorkspaceError("لا يمكن حذف تصميم تتبعه تصاميم أخرى في مزامنة الملفات. احذف التصاميم التابعة أولًا أو أرشف المصدر.")
            provided = " ".join(str(confirmation_name or "").split())
            if provided != expected:
                raise WorkspaceError("اكتب اسم التصميم كاملًا لتأكيد الحذف النهائي.")
            if len(self._catalog["schemas"]) <= 1:
                raise WorkspaceError("لا يمكن حذف التصميم الوحيد في مساحة العمل.")
            context = self._context_from_entry(entry)
            remaining = [item for item in self._catalog["schemas"] if item is not entry]
            if not any(not item.get("archived") for item in remaining):
                raise WorkspaceError("يجب أن يبقى تصميم نشط واحد على الأقل.")
            if self._catalog.get("active_schema_id") == schema_id:
                replacement = next(item for item in remaining if not item.get("archived"))
                self._catalog["active_schema_id"] = replacement["id"]
            self._catalog["schemas"] = remaining
            self._save_catalog()
            # The resolved context is guaranteed to be a direct child of the
            # managed schemas root by _context_from_entry.
            shutil.rmtree(context.folder)
            for registry_entry in self._registry.values():
                if schema_id in registry_entry.get("schema_ids", set()):
                    registry_entry["schema_ids"].discard(schema_id)
                    registry_entry["retired"] = not bool(registry_entry["schema_ids"])
                    registry_entry["updated_at"] = _now()
            self._write_registry()
            return {
                "ok": True,
                "deleted_schema_id": schema_id,
                "active_schema_id": self._catalog["active_schema_id"],
            }

    def _load_or_rebuild_registry(self) -> None:
        try:
            self._registry = self._read_registry()
        except (OSError, ValueError, KeyError):
            self._registry = {}
        # Workbooks remain authoritative.  Reconciliation adds missing links
        # without ever recycling an identity removed from a schema.
        changed = False
        contexts = self.contexts()
        known_schema_ids = {context.schema_id for context in contexts}
        memberships: dict[str, set[str]] = {}
        for context in contexts:
            for person_id in self._workbook_person_ids(context.workbook_path):
                memberships.setdefault(person_id, set()).add(context.schema_id)
                entry = self._registry.get(person_id)
                if entry is None:
                    timestamp = _now()
                    self._registry[person_id] = {
                        "person_id": person_id,
                        "person_uuid": uuid.uuid4().hex,
                        "schema_ids": {context.schema_id},
                        "created_at": timestamp,
                        "updated_at": timestamp,
                        "retired": False,
                    }
                    changed = True
                elif context.schema_id not in entry["schema_ids"]:
                    entry["schema_ids"].add(context.schema_id)
                    entry["updated_at"] = _now()
                    changed = True
        for person_id, entry in self._registry.items():
            authoritative = memberships.get(person_id, set())
            reconciled = (entry["schema_ids"] - known_schema_ids) | authoritative
            if reconciled != entry["schema_ids"]:
                entry["schema_ids"] = reconciled
                entry["updated_at"] = _now()
                entry["retired"] = not bool(reconciled)
                changed = True
        if changed or not self.registry_path.is_file():
            self._write_registry()

    def _workbook_person_ids(self, path: Path) -> list[str]:
        if not path.is_file():
            return []
        workbook = load_workbook(path, read_only=True, data_only=False)
        try:
            for worksheet in workbook.worksheets:
                headers = [
                    str(value or "").strip()
                    for value in next(
                        worksheet.iter_rows(min_row=1, max_row=1, values_only=True),
                        (),
                    )
                ]
                if "record_code" not in headers:
                    continue
                index = headers.index("record_code")
                result: list[str] = []
                for row in worksheet.iter_rows(min_row=3, values_only=True):
                    value = str(row[index] or "").strip().upper() if index < len(row) else ""
                    if PERSON_CODE.fullmatch(value):
                        result.append(value)
                return result
            return []
        finally:
            workbook.close()

    def _read_registry(self) -> dict[str, dict[str, Any]]:
        if not self.registry_path.is_file():
            return {}
        workbook = load_workbook(self.registry_path, read_only=True, data_only=True)
        try:
            worksheet = workbook[REGISTRY_SHEET]
            headers = [str(value or "") for value in next(worksheet.iter_rows(values_only=True))]
            positions = {header: index for index, header in enumerate(headers)}
            if any(header not in positions for header in REGISTRY_HEADERS):
                raise ValueError("registry headers")
            registry: dict[str, dict[str, Any]] = {}
            for row in worksheet.iter_rows(min_row=2, values_only=True):
                person_id = str(row[positions["person_id"]] or "").strip().upper()
                if not person_id:
                    continue
                schema_ids = {
                    item for item in str(row[positions["schema_ids"]] or "").split(",") if item
                }
                registry[person_id] = {
                    "person_id": person_id,
                    "person_uuid": str(row[positions["person_uuid"]] or ""),
                    "schema_ids": schema_ids,
                    "created_at": str(row[positions["created_at"]] or ""),
                    "updated_at": str(row[positions["updated_at"]] or ""),
                    "retired": bool(row[positions["retired"]]),
                }
            return registry
        finally:
            workbook.close()

    def _write_registry(self) -> None:
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = REGISTRY_SHEET
        worksheet.append(REGISTRY_HEADERS)
        for person_id in sorted(self._registry):
            entry = self._registry[person_id]
            worksheet.append(
                [
                    person_id,
                    entry["person_uuid"],
                    ",".join(sorted(entry["schema_ids"])),
                    entry["created_at"],
                    entry["updated_at"],
                    bool(entry.get("retired")),
                ]
            )
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = f"A1:F{max(1, worksheet.max_row)}"
        for letter, width in zip("ABCDEF", (18, 36, 70, 28, 28, 12)):
            worksheet.column_dimensions[letter].width = width
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=".identity-registry-",
            suffix=".xlsx",
            dir=self.registry_path.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        try:
            workbook.save(temporary_path)
            os.replace(temporary_path, self.registry_path)
        finally:
            workbook.close()
            temporary_path.unlink(missing_ok=True)

    def identity(self, person_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._registry.get(person_id.upper())
            if entry is None:
                return None
            return {
                **entry,
                "schema_ids": sorted(entry["schema_ids"]),
            }

    def person_id_in_use(self, person_id: str) -> bool:
        with self._lock:
            return person_id.upper() in self._registry

    def assert_profile_creation(
        self, person_id: str, schema_id: str, *, link_existing: bool
    ) -> None:
        with self._lock:
            entry = self._registry.get(person_id.upper())
            if entry is None:
                return
            if schema_id in entry["schema_ids"]:
                raise WorkspaceError("يوجد ملف بهذا ID داخل التصميم الحالي.")
            if not link_existing:
                raise WorkspaceError(
                    "هذا ID يعود إلى شخص موجود في تصميم آخر. استخدم «إضافة شخص موجود» لربط الملفين."
                )

    def register_profile(self, person_id: str, schema_id: str) -> None:
        self.register_profiles([person_id], schema_id)

    def register_profiles(self, person_ids: list[str], schema_id: str) -> None:
        with self._lock:
            timestamp = _now()
            for raw_person_id in person_ids:
                person_id = raw_person_id.upper()
                entry = self._registry.get(person_id)
                if entry is None:
                    entry = {
                        "person_id": person_id,
                        "person_uuid": uuid.uuid4().hex,
                        "schema_ids": set(),
                        "created_at": timestamp,
                        "updated_at": timestamp,
                        "retired": False,
                    }
                    self._registry[person_id] = entry
                entry["schema_ids"].add(schema_id)
                entry["updated_at"] = timestamp
                entry["retired"] = False
            self._write_registry()

    def unregister_profile(self, person_id: str, schema_id: str) -> None:
        with self._lock:
            entry = self._registry.get(person_id.upper())
            if entry is None:
                return
            entry["schema_ids"].discard(schema_id)
            entry["updated_at"] = _now()
            entry["retired"] = not bool(entry["schema_ids"])
            self._write_registry()

    def identity_search(self, person_id: str) -> list[dict[str, str]]:
        with self._lock:
            entry = self._registry.get(person_id.upper())
            if entry is None:
                return []
            result = []
            for schema_id in sorted(entry["schema_ids"]):
                context = self.context(schema_id)
                result.append({"schema_id": schema_id, "schema_name": context.name})
            return result

    def mapping_profile(
        self, source_schema_id: str, target_schema_id: str
    ) -> list[dict[str, str]]:
        with self._lock:
            key = f"{source_schema_id}->{target_schema_id}"
            profile = self._catalog.get("mapping_profiles", {}).get(key, [])
            return [dict(item) for item in profile if isinstance(item, dict)]

    def save_mapping_profile(
        self,
        source_schema_id: str,
        target_schema_id: str,
        mappings: list[dict[str, str]],
    ) -> None:
        with self._lock:
            key = f"{source_schema_id}->{target_schema_id}"
            profiles = self._catalog.setdefault("mapping_profiles", {})
            profiles[key] = [
                {
                    "source_field_id": str(item["source_field_id"]),
                    "target_field_id": str(item["target_field_id"]),
                }
                for item in mappings
                if item.get("source_field_id") and item.get("target_field_id")
            ]
            self._save_catalog()
