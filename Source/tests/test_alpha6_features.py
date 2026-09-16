from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from test_backend import CAT_IDENTITY, FLD_NAME, configured_schema

import SchemaCraft as APP
from schemacraft_advanced import AuditUserStore, SearchHistoryStore
from schemacraft_workspace import use_context

AUDIT_FIELD = "fld_aaaaaaaaaaaa"


class Alpha6FeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.originals = {
            "DATA_DIR": APP.DATA_DIR,
            "SCHEMA_PATH": APP.SCHEMA_PATH,
            "WORKBOOK_PATH": APP.WORKBOOK_PATH,
            "BACKUP_DIR": APP.BACKUP_DIR,
            "BUILDER_AUTH_PATH": APP.BUILDER_AUTH_PATH,
            "WORKSPACE_MANAGER": APP.WORKSPACE_MANAGER,
            "DEVELOPER_MODE": APP.DEVELOPER_MODE,
            "_BUILDER_UNLOCKED": APP._BUILDER_UNLOCKED,
            "_DATASET_SNAPSHOT": APP._DATASET_SNAPSHOT,
            "_DATASET_SNAPSHOTS": APP._DATASET_SNAPSHOTS,
            "AUDIT_USERS": APP.AUDIT_USERS,
            "SEARCH_HISTORY": APP.SEARCH_HISTORY,
        }
        APP.DATA_DIR = self.data
        APP.SCHEMA_PATH = self.data / "schema.json"
        APP.WORKBOOK_PATH = self.data / "database.xlsx"
        APP.BACKUP_DIR = self.root / "backups"
        APP.BUILDER_AUTH_PATH = self.root / "builder-auth.json"
        APP.WORKSPACE_MANAGER = None
        APP.DEVELOPER_MODE = True
        APP._BUILDER_UNLOCKED = True
        APP._DATASET_SNAPSHOT = None
        APP._DATASET_SNAPSHOTS = {}
        APP.AUDIT_USERS = AuditUserStore(self.data / "audit-users.json")
        APP.SEARCH_HISTORY = SearchHistoryStore(self.data / "search-history.json")
        APP.ensure_storage()

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(APP, name, value)
        self.temporary.cleanup()

    def test_archive_restore_never_changes_schema_or_workbook_bytes(self) -> None:
        APP.save_schema(configured_schema())
        APP.save_record({"mode": "create", "record_code": "A0000001", "main": {FLD_NAME: "أرشيف"}, "related": {}})
        APP.initialize_workspace()
        manager = APP.require_workspace()
        original = manager.context()
        with use_context(original):
            created = APP.manage_workspace_schema({
                "action": "duplicate",
                "name": "تصميم بديل",
                "template_schema_id": original.schema_id,
            })
        alternative = manager.context(created["schema_id"])
        schema_bytes = original.schema_path.read_bytes()
        workbook_bytes = original.workbook_path.read_bytes()

        with use_context(alternative):
            APP.manage_workspace_schema({"action": "archive", "schema_id": original.schema_id})
            APP.manage_workspace_schema({"action": "restore", "schema_id": original.schema_id})

        self.assertEqual(original.schema_path.read_bytes(), schema_bytes)
        self.assertEqual(original.workbook_path.read_bytes(), workbook_bytes)

    def test_create_from_archived_copies_structure_only(self) -> None:
        APP.save_schema(configured_schema())
        APP.save_record({"mode": "create", "record_code": "A0000002", "main": {FLD_NAME: "مصدر"}, "related": {}})
        APP.initialize_workspace()
        manager = APP.require_workspace()
        source = manager.context()
        with use_context(source):
            source_categories = APP.schema_response(APP.read_schema_file())["categories"]
        with use_context(source):
            alternative_id = APP.manage_workspace_schema({
                "action": "duplicate", "name": "نشط", "template_schema_id": source.schema_id,
            })["schema_id"]
        alternative = manager.context(alternative_id)
        with use_context(alternative):
            APP.manage_workspace_schema({"action": "archive", "schema_id": source.schema_id})
            new_id = APP.manage_workspace_schema({
                "action": "duplicate", "name": "من بنية مؤرشفة", "template_schema_id": source.schema_id,
            })["schema_id"]
        copied = manager.context(new_id)
        with use_context(copied):
            response = APP.schema_response(APP.read_schema_file())
            self.assertEqual(response["stats"]["record_count"], 0)
            self.assertEqual(response["categories"], source_categories)
            self.assertEqual(APP.search_records({"_allow_empty": True})["total"], 0)

    def test_audit_identity_is_not_auth_and_can_fill_an_immutable_user_field(self) -> None:
        schema = copy.deepcopy(configured_schema())
        category = next(item for item in schema["categories"] if item["id"] == CAT_IDENTITY)
        category["fields"].append({
            "id": AUDIT_FIELD,
            "label": "المستخدم",
            "type": "user_name",
            "required": True,
            "placeholder": "",
            "width": "normal",
            "options": [],
            "searchable": True,
            "search_match": "contains",
            "show_in_results": True,
            "result_title": False,
            "user_editable": False,
        })
        APP.save_schema(schema)
        selected = APP.select_audit_user({"name": "ليلى"})
        self.assertEqual(selected["audit_users"]["current_user"], "ليلى")
        self.assertTrue(APP.DEVELOPER_MODE)  # audit identity did not alter Admin Mode
        created = APP.save_record({"mode": "create", "record_code": "A0000003", "main": {FLD_NAME: "هوية"}, "related": {}})
        self.assertEqual(APP.load_record("A0000003")["main"][AUDIT_FIELD], "ليلى")
        APP.select_audit_user({"name": "نور"})
        APP.save_record({
            "mode": "update",
            "record_code": "A0000003",
            "expected_updated_at": created["updated_at"],
            "main": {FLD_NAME: "هوية معدلة", AUDIT_FIELD: ""},
            "related": {},
        })
        self.assertEqual(APP.load_record("A0000003")["main"][AUDIT_FIELD], "ليلى")


if __name__ == "__main__":
    unittest.main()
