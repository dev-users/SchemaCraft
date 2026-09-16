from __future__ import annotations

import copy
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import AuditUserStore, SearchHistoryStore
from test_feature_batch import (
    ATTACHMENT,
    CREATOR,
    LAST_EDITOR,
    MAIN,
    NAME,
    PARENT,
    PARENT_NAME,
    TRIGGER,
    UPDATE_DATE,
    field,
    schema,
)

ROOT = Path(__file__).resolve().parents[1]
AUTO_DATE = "fld_100000000009"
LIST_FIELD = "fld_100000000010"
CARD_SELECTOR = "fld_100000000011"


class Alpha25FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.home_source = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.builder_source = (ROOT / "app" / "src" / "pages" / "builder" / "field-dialog.html").read_text(encoding="utf-8")

    def test_release_and_cache_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", self.html)

    def test_admin_cancel_is_left_of_enter_in_rtl_order(self) -> None:
        start = self.html.index('id="builder-auth-dialog"')
        end = self.html.index("</dialog>", start)
        actions = self.html.index('<div class="dialog-actions">', start, end)
        fragment = self.html[actions:end]
        self.assertLess(
            fragment.index('id="confirm-builder-auth-button"'),
            fragment.index('data-close-dialog="builder-auth-dialog"'),
        )

    def test_home_cards_use_title_navigation_and_blank_space_collapse(self) -> None:
        self.assertNotIn("data-home-card-toggle", self.home_source)
        self.assertNotIn("data-clear-history", self.home_source)
        self.assertIn('data-home-destination="entry"', self.home_source)
        self.assertIn('event.target.closest(".home-dashboard-card")', self.javascript)
        self.assertIn("toggleHomeCard(card)", self.javascript)
        for obsolete in (
            "data-remove-recent-record",
            "data-remove-builder-history",
            "data-open-builder-schema",
        ):
            self.assertNotIn(obsolete, self.javascript)

    def test_shared_history_limit_discard_recent_records_and_list_growth(self) -> None:
        for token in (
            'id="setting-search-history-limit"',
            'id="discard-settings-changes"',
            'id="entry-recent-records"',
            'dataset.addInlineListOption',
            'fetch("/api/schema/options"',
        ):
            self.assertIn(token, self.html + self.javascript)
        self.assertIn('id="setting-export-history-limit"', self.html)
        self.assertIn('id="setting-import-history-limit"', self.html)

    def test_unified_builder_types_and_retired_features(self) -> None:
        for token in (
            'id="field-text-mode"',
            'id="field-list-mode"',
            'id="field-date-mode"',
            'value="automatic_checkbox"',
            'value="current_on_checkbox"',
            'id="field-unique-card-checkbox"',
            'id="related-person-source-checkbox"',
        ):
            self.assertIn(token, self.builder_source)
        self.assertNotIn("system_completion", self.javascript)
        self.assertNotIn("system_completed_at", self.javascript)
        self.assertNotIn("row_markers", self.javascript)
        self.assertNotIn("toggle_complete", self.javascript)
        self.assertNotIn("complete-record-button", self.javascript)
        self.assertNotIn("وسوم البطاقات", self.html)

    def test_list_save_path_avoids_the_old_double_copy(self) -> None:
        backend = (ROOT / "SchemaCraft.py").read_text(encoding="utf-8")
        start = backend.index("def save_schema(payload: Any)")
        end = backend.index("\ndef add_runtime_list_option", start)
        save_path = backend[start:end]
        self.assertNotIn("copy.deepcopy(snapshot.records)", save_path)
        self.assertNotIn("_sync_excel_field_labels_unlocked(read_schema_file())", save_path)
        self.assertIn("records = list(_dataset_snapshot_unlocked(current).records)", save_path)


class Alpha25BackendTests(unittest.TestCase):
    def setUp(self) -> None:
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

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(APP, name, value)
        self.temporary.cleanup()

    @staticmethod
    def alpha25_schema() -> dict:
        candidate = copy.deepcopy(schema())
        main = next(category for category in candidate["categories"] if category["id"] == MAIN)
        parent = next(category for category in candidate["categories"] if category["id"] == PARENT)
        main["fields"].extend(
            [
                field(
                    AUTO_DATE,
                    "تاريخ الاعتماد",
                    "date_gregorian",
                    date_value_mode="on_checkbox",
                    date_trigger_field_id=TRIGGER,
                ),
                field(
                    LIST_FIELD,
                    "القائمة",
                    "select",
                    options=[{"id": "opt_100000000001", "label": "قديم", "active": True}],
                ),
                field("fld_100000000012", "حالة قديمة", "system_completion"),
            ]
        )
        parent["row_markers"] = [
            {"id": "mark_100000000001", "label": "قديم", "display_text": "قديم"}
        ]
        parent["fields"].append(
            field(
                CARD_SELECTOR,
                "البطاقة المختارة",
                "checkbox",
                unique_checked_across_cards=True,
            )
        )
        candidate["categories"][1]["fields"][1]["file_naming"]["parts"][0]["marker_id"] = "mark_100000000001"
        return candidate

    def test_removed_features_are_normalized_out_and_checkbox_triggers_work(self) -> None:
        validated = APP.validate_schema(self.alpha25_schema())
        parent = next(category for category in validated["categories"] if category["id"] == PARENT)
        self.assertNotIn("row_markers", parent)
        self.assertNotIn("marker_id", parent["fields"][1]["file_naming"]["parts"][0])
        self.assertFalse(
            any(
                field_definition["type"] == "system_completion"
                for category in validated["categories"]
                for field_definition in category["fields"]
            )
        )
        APP.save_schema(validated)
        APP.select_audit_user({"name": "ليلى"})
        APP.save_record(
            {
                "mode": "create",
                "record_code": "A2500001",
                "main": {NAME: "الأول", TRIGGER: False},
                "related": {
                    PARENT: [
                        {"values": {PARENT_NAME: "أ", CARD_SELECTOR: False}},
                        {"values": {PARENT_NAME: "ب", CARD_SELECTOR: False}},
                    ]
                },
            }
        )
        created = APP.load_record("A2500001")
        self.assertEqual(created["main"][AUTO_DATE], "")
        self.assertEqual(created["main"][LAST_EDITOR], "")
        created["main"][TRIGGER] = True
        APP.save_record(
            {
                "mode": "update",
                "record_code": "A2500001",
                "main": created["main"],
                "related": created["related"],
            }
        )
        updated = APP.load_record("A2500001")
        self.assertEqual(updated["main"][AUTO_DATE], date.today().isoformat())
        self.assertEqual(updated["main"][LAST_EDITOR], "ليلى")
        self.assertEqual(updated["main"][CREATOR], "ليلى")

        option = APP.add_runtime_list_option({"field_id": LIST_FIELD, "label": "جديد"})
        self.assertEqual(option["option"]["label"], "جديد")
        self.assertTrue(
            any(
                item["label"] == "جديد"
                for category in APP.read_schema_file()["categories"]
                for definition in category["fields"]
                if definition["id"] == LIST_FIELD
                for item in definition["options"]
            )
        )

        with self.assertRaisesRegex(APP.ApplicationError, "بطاقة واحدة"):
            APP.save_record(
                {
                    "mode": "create",
                    "record_code": "A2500002",
                    "main": {NAME: "الثاني", TRIGGER: False},
                    "related": {
                        PARENT: [
                            {"values": {PARENT_NAME: "أ", CARD_SELECTOR: True}},
                            {"values": {PARENT_NAME: "ب", CARD_SELECTOR: True}},
                        ]
                    },
                }
            )

    def test_last_editor_requires_the_last_update_date_field(self) -> None:
        candidate = self.alpha25_schema()
        main = next(category for category in candidate["categories"] if category["id"] == MAIN)
        main["fields"] = [item for item in main["fields"] if item["id"] != UPDATE_DATE]
        APP.save_schema(candidate)
        APP.select_audit_user({"name": "محرر"})
        APP.save_record(
            {"mode": "create", "record_code": "A2500003", "main": {NAME: "قبل"}, "related": {}}
        )
        loaded = APP.load_record("A2500003")
        loaded["main"][NAME] = "بعد"
        APP.save_record(
            {
                "mode": "update",
                "record_code": "A2500003",
                "main": loaded["main"],
                "related": loaded["related"],
            }
        )
        self.assertEqual(APP.load_record("A2500003")["main"][CREATOR], "")

    def test_deleted_profile_is_removed_from_search_snapshots(self) -> None:
        history = SearchHistoryStore(self.root)
        history.append(
            {
                "id": "saved-search",
                "schema_id": "schema-a",
                "results": {
                    "total": 2,
                    "matches": [
                        {"record_code": "A2500001"},
                        {"record_code": "A2500009"},
                    ],
                },
            }
        )
        self.assertEqual(history.purge_record("A2500001", "schema-a"), 1)
        stored = history.read()[0]["results"]
        self.assertEqual(stored["total"], 1)
        self.assertEqual([item["record_code"] for item in stored["matches"]], ["A2500009"])


if __name__ == "__main__":
    unittest.main()
