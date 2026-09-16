from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import AuditUserStore

MAIN = "cat_100000000001"
PARENT = "cat_100000000002"
CHILD = "cat_100000000003"
NAME = "fld_100000000001"
TRIGGER = "fld_100000000002"
CREATOR = "fld_100000000003"
LAST_EDITOR = "fld_100000000004"
ATTACHMENT = "fld_100000000005"
PARENT_NAME = "fld_100000000006"
CHILD_NAME = "fld_100000000007"
UPDATE_DATE = "fld_100000000008"


def field(field_id: str, label: str, field_type: str, **extra):
    result = {
        "id": field_id,
        "label": label,
        "type": field_type,
        "required": False,
        "placeholder": "",
        "width": "normal",
        "options": [],
        "searchable": field_type != "file",
        "search_match": "contains" if field_type in {"text", "user_name"} else "exact",
        "show_in_results": field_type != "file",
        "result_title": field_id == NAME,
    }
    result.update(extra)
    return result


def schema():
    return {
        "schema_version": 2,
        "revision": 0,
        "app": {"title": "Batch", "entity_singular": "سجل", "entity_plural": "سجلات"},
        "categories": [
            {
                "id": MAIN,
                "label": "الرئيسية",
                "kind": "main",
                "fields": [
                    field(NAME, "الاسم", "text"),
                    field(TRIGGER, "اعتماد البطاقة", "checkbox"),
                    field(
                        CREATOR,
                        "المستخدم",
                        "user_name",
                        user_value_mode="current_on_save",
                        user_editable=False,
                    ),
                    field(
                        LAST_EDITOR,
                        "مستخدم الاعتماد",
                        "user_name",
                        user_value_mode="current_on_checkbox",
                        user_trigger_field_id=TRIGGER,
                        user_editable=False,
                    ),
                    field(UPDATE_DATE, "تاريخ آخر تعديل", "system_updated_at"),
                ],
            },
            {
                "id": PARENT,
                "label": "الآباء",
                "kind": "repeatable",
                "card_title_field_id": PARENT_NAME,
                "card_sort": {"mode": "title", "direction": "asc"},
                "fields": [
                    field(PARENT_NAME, "اسم الأب", "text"),
                    field(
                        ATTACHMENT,
                        "المرفق",
                        "file",
                        file_naming={
                            "mode": "template",
                            "parts": [
                                {
                                    "field_id": PARENT_NAME,
                                    "prefix": "وثيقة-",
                                    "suffix": "",
                                }
                            ],
                        },
                    ),
                ],
            },
            {
                "id": CHILD,
                "label": "الأبناء المتداخلون",
                "kind": "repeatable",
                "parent_category_id": PARENT,
                "parent_field_id": PARENT_NAME,
                "fields": [field(CHILD_NAME, "اسم الابن", "text")],
            },
        ],
        "conditions": [],
    }


class RequestedFeatureBatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.originals = {
            name: getattr(APP, name)
            for name in (
                "DATA_DIR",
                "SCHEMA_PATH",
                "WORKBOOK_PATH",
                "BACKUP_DIR",
                "BUILDER_AUTH_PATH",
                "WORKSPACE_MANAGER",
                "AUDIT_USERS",
                "DEVELOPER_MODE",
                "_BUILDER_UNLOCKED",
                "_DATASET_SNAPSHOT",
                "_DATASET_SNAPSHOTS",
            )
        }
        APP.DATA_DIR = self.root
        APP.SCHEMA_PATH = self.root / "schema.json"
        APP.WORKBOOK_PATH = self.root / "database.xlsx"
        APP.BACKUP_DIR = self.root / "backups"
        APP.BUILDER_AUTH_PATH = self.root / "builder-auth.json"
        APP.WORKSPACE_MANAGER = None
        APP.AUDIT_USERS = AuditUserStore(self.root / "audit-users.json")
        APP.DEVELOPER_MODE = True
        APP._BUILDER_UNLOCKED = True
        APP._DATASET_SNAPSHOT = None
        APP._DATASET_SNAPSHOTS = {}
        APP.ensure_storage()
        APP.save_schema(schema())

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(APP, name, value)
        self.temporary.cleanup()

    def test_checkbox_trigger_nested_cards_and_repeated_file_name(self):
        APP.select_audit_user({"name": "مستخدم أول"})
        parent_id = "a" * 32
        child_id = "b" * 32
        APP.save_record(
            {
                "mode": "create",
                "record_code": "B0000001",
                "main": {
                    NAME: "أحمد",
                    TRIGGER: True,
                },
                "related": {
                    PARENT: [
                        {
                            "_child_id": parent_id,
                            "_client_generated": True,
                            "values": {
                                PARENT_NAME: "زينب",
                                ATTACHMENT: {
                                    "upload": {
                                        "name": "original.png",
                                        "data": base64.b64encode(b"image-bytes").decode("ascii"),
                                    }
                                },
                            },
                        }
                    ],
                    CHILD: [
                        {
                            "_child_id": child_id,
                            "_client_generated": True,
                            "parent_child_id": parent_id,
                            "values": {CHILD_NAME: "ليلى"},
                        }
                    ],
                },
            }
        )
        loaded = APP.load_record("B0000001")
        self.assertEqual(loaded["main"][CREATOR], "")
        self.assertEqual(loaded["main"][LAST_EDITOR], "مستخدم أول")
        self.assertEqual(loaded["related"][CHILD][0]["parent_child_id"], parent_id)
        self.assertIn("وثيقة-زينب", loaded["related"][PARENT][0]["values"][ATTACHMENT])

        APP.select_audit_user({"name": "مستخدم ثان"})
        APP.save_record(
            {
                "mode": "update",
                "record_code": "B0000001",
                "main": loaded["main"],
                "related": loaded["related"],
            }
        )
        updated = APP.load_record("B0000001")
        self.assertEqual(updated["main"][CREATOR], "مستخدم ثان")
        self.assertEqual(updated["main"][LAST_EDITOR], "مستخدم أول")

    def test_empty_value_search(self):
        APP.select_audit_user({"name": "باحث"})
        APP.save_record(
            {
                "mode": "create",
                "record_code": "B0000002",
                "main": {NAME: ""},
                "related": {},
            }
        )
        result = APP.search_records(
            {
                NAME: {"empty": True},
                "_search_field_ids": [NAME],
                "_allow_empty": True,
            }
        )
        self.assertEqual([item["record_code"] for item in result["matches"]], ["B0000002"])


if __name__ == "__main__":
    unittest.main()
