from __future__ import annotations

import tempfile
import unittest
import base64
import io
from unittest import mock
from pathlib import Path

from test_backend import FLD_NAME, FLD_STATUS, configured_schema

import SchemaCraft as APP
from schemacraft_workspace import use_context


class MultiSchemaWorkspaceTests(unittest.TestCase):
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
        APP.ensure_storage()
        APP.save_schema(configured_schema())
        APP.save_record(
            {
                "mode": "create",
                "record_code": "M0000001",
                "main": {FLD_NAME: "طالب أول", FLD_STATUS: "نشط"},
                "related": {},
            }
        )

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(APP, name, value)
        self.temporary.cleanup()

    def test_legacy_workbook_is_reused_byte_for_byte_and_indexed_per_schema(self) -> None:
        legacy_bytes = APP.WORKBOOK_PATH.read_bytes()
        APP.initialize_workspace()
        manager = APP.require_workspace()
        student = manager.context()

        self.assertEqual(student.workbook_path.read_bytes(), legacy_bytes)
        self.assertEqual(
            (self.data / "release-2-original" / "database.xlsx").read_bytes(),
            legacy_bytes,
        )
        self.assertEqual(student.workbook_path.name, f"{student.name}.xlsx")

        with use_context(student):
            self.assertEqual(APP.load_record("M0000001")["main"][FLD_NAME], "طالب أول")
            APP.search_records({"_record_code": "M0000001"})
        self.assertIn(str(student.workbook_path.resolve()), APP._DATASET_SNAPSHOTS)

    def test_following_schema_backfills_and_follows_one_way(self) -> None:
        APP.initialize_workspace()
        manager = APP.require_workspace()
        source = manager.context()
        result = APP.manage_workspace_schema({"action": "create", "name": "تابع", "profile_source_schema_id": source.schema_id})
        target = manager.context(result["schema_id"])
        with use_context(target):
            self.assertEqual(APP.load_record("M0000001")["main"], {})
            APP.save_schema(configured_schema())
            loaded = APP.load_record("M0000001")
            APP.save_record({"mode": "update", "record_code": "M0000001", "expected_updated_at": loaded["updated_at"], "main": {FLD_NAME: "بيانات مستقلة", FLD_STATUS: "نشط"}, "related": {}})
        with use_context(source):
            APP.save_record({"record_code": "M0000002", "main": {FLD_NAME: "ثان", FLD_STATUS: "نشط"}, "related": {}})
        with use_context(target):
            self.assertEqual(APP.load_record("M0000001")["main"][FLD_NAME], "بيانات مستقلة")
            self.assertFalse(APP.load_record("M0000002")["main"][FLD_NAME])
            APP.delete_record("M0000002")
        with use_context(source):
            self.assertEqual(APP.load_record("M0000002")["main"][FLD_NAME], "ثان")
        APP.synchronize_workspace_profiles()
        APP.initialize_workspace()
        with use_context(target):
            with self.assertRaises(APP.ApplicationError):
                APP.load_record("M0000002")
        with use_context(source):
            APP.delete_record("M0000001")
        with use_context(target):
            with self.assertRaises(APP.ApplicationError):
                APP.load_record("M0000001")
        self.assertNotIn(target.schema_id, APP.require_workspace().identity("M0000001")["schema_ids"])

    def test_following_schema_retries_a_locked_target_without_losing_source(self) -> None:
        APP.initialize_workspace()
        manager = APP.require_workspace()
        source = manager.context()
        result = APP.manage_workspace_schema({"action": "create", "name": "تابع", "profile_source_schema_id": source.schema_id})
        target = manager.context(result["schema_id"])
        real_write = APP.write_dataset_workbook
        def locked_write(schema, records, destination):
            if destination.parent == target.workbook_path.parent:
                raise PermissionError("locked target")
            return real_write(schema, records, destination)
        with mock.patch.object(APP, "write_dataset_workbook", side_effect=locked_write), mock.patch.object(APP, "schedule_profile_sync_retry") as retry:
            with use_context(source):
                APP.save_record({"record_code": "M0000003", "main": {FLD_NAME: "ثالث", FLD_STATUS: "نشط"}, "related": {}})
                self.assertEqual(APP.load_record("M0000003")["main"][FLD_NAME], "ثالث")
            retry.assert_called()
        APP.synchronize_workspace_profiles()
        with use_context(target):
            self.assertEqual(APP.load_record("M0000003")["main"], {})

    def test_following_schema_rejects_bad_source_and_protects_source_schema(self) -> None:
        APP.initialize_workspace()
        manager = APP.require_workspace()
        source = manager.context()
        with self.assertRaises(APP.ApplicationError):
            APP.manage_workspace_schema({"action": "create", "name": "غير صالح", "profile_source_schema_id": "missing"})
        self.assertEqual(len(manager.contexts()), 1)
        APP.manage_workspace_schema({"action": "create", "name": "تابع", "profile_source_schema_id": source.schema_id})
        with self.assertRaises(APP.WorkspaceError):
            manager.delete_schema(source.schema_id, source.name)

    def test_following_schema_handles_import_and_chained_deletion(self) -> None:
        APP.initialize_workspace()
        manager = APP.require_workspace()
        source = manager.context()
        first = APP.manage_workspace_schema({"action": "create", "name": "تابع أول", "profile_source_schema_id": source.schema_id})
        target = manager.context(first["schema_id"])
        second = APP.manage_workspace_schema({"action": "create", "name": "تابع ثان", "profile_source_schema_id": target.schema_id})
        downstream = manager.context(second["schema_id"])
        with use_context(source):
            _, content, _ = APP.create_filtered_export({"criteria": {}, "field_ids": [FLD_NAME, FLD_STATUS], "include_related": False})
            workbook = APP.load_workbook(io.BytesIO(content))
            workbook["السجلات المصدرة"]["A3"] = "M0000004"
            output = io.BytesIO()
            workbook.save(output)
            workbook.close()
            encoded = base64.b64encode(output.getvalue()).decode("ascii")
            inspected = APP.inspect_import({"file_data": encoded})
            APP.commit_import({"file_data": encoded, "sheet_name": inspected["sheet_name"], "mapping": {str(col["column"]): col["suggested_target"] for col in inspected["columns"] if col["suggested_target"]}, "duplicate_policy": "skip", "schema_revision": inspected["schema_revision"]})
        for context in (target, downstream):
            with use_context(context):
                self.assertEqual(APP.load_record("M0000004")["main"], {})
        with use_context(source):
            APP.delete_record("M0000004")
        for context in (target, downstream):
            with use_context(context):
                with self.assertRaises(APP.ApplicationError):
                    APP.load_record("M0000004")

    def test_manual_cross_schema_mapping_global_identity_and_multi_search(self) -> None:
        APP.initialize_workspace()
        manager = APP.require_workspace()
        student = manager.context()
        with use_context(student):
            result = APP.manage_workspace_schema(
                {
                    "action": "duplicate",
                    "name": "العاملون",
                    "template_schema_id": student.schema_id,
                    "schema_id": student.schema_id,
                }
            )
        worker = manager.context(result["schema_id"])

        inspection = APP.inspect_profile_transfer(
            {
                "source_schema_id": student.schema_id,
                "target_schema_id": worker.schema_id,
                "record_code": "M0000001",
            }
        )
        self.assertTrue(inspection["source_fields"])

        # Manual mapping is intentionally unrestricted by labels or field type:
        # the student's select status becomes the worker's text name.
        linked = APP.create_linked_profile(
            {
                "source_schema_id": student.schema_id,
                "target_schema_id": worker.schema_id,
                "record_code": "M0000001",
                "mappings": [
                    {
                        "source_field_id": FLD_STATUS,
                        "target_field_id": FLD_NAME,
                    }
                ],
            }
        )
        self.assertEqual(linked["record_code"], "M0000001")
        with use_context(worker):
            self.assertEqual(APP.load_record("M0000001")["main"][FLD_NAME], "نشط")

        self.assertEqual(
            manager.mapping_profile(student.schema_id, worker.schema_id),
            [{"source_field_id": FLD_STATUS, "target_field_id": FLD_NAME}],
        )

        identity = manager.identity("M0000001")
        self.assertEqual(
            set(identity["schema_ids"]), {student.schema_id, worker.schema_id}
        )

        result = APP.multi_schema_search(
            {
                "queries": [
                    {
                        "schema_id": student.schema_id,
                        "criteria": {"_record_code": "M0000001"},
                    },
                    {
                        "schema_id": worker.schema_id,
                        "criteria": {"_record_code": "M0000001"},
                    },
                ]
            }
        )
        self.assertEqual([item["total"] for item in result["results"]], [1, 1])
        self.assertIn(str(student.workbook_path.resolve()), APP._DATASET_SNAPSHOTS)
        self.assertIn(str(worker.workbook_path.resolve()), APP._DATASET_SNAPSHOTS)

        with (
            use_context(worker),
            self.assertRaisesRegex(APP.ApplicationError, "مستخدم مسبقًا"),
        ):
            APP.save_record(
                {
                    "mode": "create",
                    "record_code": "M0000001",
                    "main": {},
                    "related": {},
                }
            )

    def test_export_is_administrator_only(self) -> None:
        APP.DEVELOPER_MODE = False
        APP._BUILDER_UNLOCKED = False
        with self.assertRaisesRegex(APP.ApplicationError, "المصمّم مقفل"):
            APP.create_filtered_export({"criteria": {"_allow_empty": True}})


if __name__ == "__main__":
    unittest.main()
