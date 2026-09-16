from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import ExportHistoryStore
from test_feature_batch import MAIN, NAME, TRIGGER, field, schema


ROOT = Path(__file__).resolve().parents[1]
LIST_FIELD = "fld_260000000001"


class Alpha26FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.settings = (ROOT / "app" / "src" / "pages" / "settings" / "settings.html").read_text(encoding="utf-8")

    def test_release_and_separate_history_limits(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", self.html)
        for name in ("entry", "search", "import", "export"):
            self.assertIn(f'id="setting-{name}-history-limit"', self.settings)
        for name in ("entry", "builder", "search", "import", "export"):
            self.assertIn(f'id="setting-home-{name}-history-limit"', self.settings)
        self.assertNotIn('id="setting-operation-history-limit"', self.settings)

    def test_entry_navigation_and_dependent_list_contracts(self) -> None:
        for token in (
            'dataset.addInlineListOption',
            'className = "editable-list-menu"',
            'dependency_token: dependencyToken',
            'allowedOptionsForControl(control)',
            'focusAdjacentEntryField(event.target',
        ):
            self.assertIn(token, self.javascript)
        self.assertNotIn("data-calendar-compact", self.javascript)
        self.assertIn('card.className = "search-result-card"', self.javascript)

    def test_exchange_and_builder_history_contracts(self) -> None:
        self.assertIn("entry.skipped", self.javascript)
        self.assertIn("restoreExportHistoryConfiguration", self.javascript)
        self.assertIn('scopeId = state.builderScope === "global"', self.javascript)
        self.assertIn('id="builder-history-scope"', self.html)
        self.assertIn("fillRelatedPersonSourceCheckboxes", self.javascript)

    def test_cancel_buttons_follow_primary_buttons_in_rtl_dialogs(self) -> None:
        import re

        for actions in re.findall(r'<div class="[^"]*dialog-actions[^"]*">(.*?)</div>', self.html, re.S):
            if "button-primary" not in actions or "إلغاء" not in actions:
                continue
            self.assertLess(actions.index("button-primary"), actions.rindex("إلغاء"))
        close_dialog = self.html[self.html.index('id="close-confirm-dialog"'):]
        close_dialog = close_dialog[:close_dialog.index("</dialog>")]
        self.assertLess(close_dialog.index('id="close-confirm-accept"'), close_dialog.index('id="close-confirm-cancel"'))

    def test_builder_save_uses_background_excel_projection(self) -> None:
        backend = (ROOT / "SchemaCraft.py").read_text(encoding="utf-8")
        start = backend.index("def save_schema(payload: Any)")
        end = backend.index("\ndef add_runtime_list_option", start)
        save_path = backend[start:end]
        self.assertIn("background_sync = WORKSPACE_MANAGER is not None", save_path)
        self.assertIn("schedule_workbook_schema_sync", save_path)
        self.assertIn('response["workbook_sync_pending"] = True', save_path)


class Alpha26BackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.originals = {
            name: getattr(APP, name)
            for name in (
                "DATA_DIR", "SCHEMA_PATH", "WORKBOOK_PATH", "BACKUP_DIR",
                "BUILDER_AUTH_PATH", "WORKSPACE_SETTINGS_PATH", "WORKSPACE_MANAGER",
                "DEVELOPER_MODE", "_BUILDER_UNLOCKED", "_DATASET_SNAPSHOT",
                "_DATASET_SNAPSHOTS",
            )
        }
        APP.DATA_DIR = self.root
        APP.SCHEMA_PATH = self.root / "schema.json"
        APP.WORKBOOK_PATH = self.root / "database.xlsx"
        APP.BACKUP_DIR = self.root / "backups"
        APP.BUILDER_AUTH_PATH = self.root / "builder-auth.json"
        APP.WORKSPACE_SETTINGS_PATH = self.root / "workspace-settings.json"
        APP.WORKSPACE_MANAGER = None
        APP.DEVELOPER_MODE = True
        APP._BUILDER_UNLOCKED = True
        APP._DATASET_SNAPSHOT = None
        APP._DATASET_SNAPSHOTS = {}
        APP.ensure_storage()

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(APP, name, value)
        self.temporary.cleanup()

    def test_dependent_runtime_option_is_mapped_to_current_source_value(self) -> None:
        candidate = copy.deepcopy(schema())
        main = next(category for category in candidate["categories"] if category["id"] == MAIN)
        main["fields"].append(field(
            LIST_FIELD,
            "قائمة تابعة",
            "select",
            options=[{"id": "opt_260000000001", "label": "موجود", "active": True}],
            option_filter={
                "source_field_id": TRIGGER,
                "mappings": {"true": [], "false": []},
                "unmatched": "none",
            },
        ))
        APP.save_schema(candidate)
        result = APP.add_runtime_list_option({
            "field_id": LIST_FIELD,
            "label": "قيمة جديدة",
            "dependency_token": "true",
        })
        saved_field = APP.schema_indexes(APP.read_schema_file())["fields"][LIST_FIELD]
        self.assertIn(result["option"]["id"], saved_field["option_filter"]["mappings"]["true"])
        existing = APP.add_runtime_list_option({
            "field_id": LIST_FIELD,
            "label": "موجود",
            "dependency_token": "false",
        })
        saved_field = APP.schema_indexes(APP.read_schema_file())["fields"][LIST_FIELD]
        self.assertIn(existing["option"]["id"], saved_field["option_filter"]["mappings"]["false"])

    def test_history_limits_are_independent_free_numbers(self) -> None:
        result = APP.save_workspace_settings({
            "shortcuts": {},
            "entry_history_limit": 17,
            "search_history_limit": 34,
            "import_history_limit": 67,
            "export_history_limit": 100,
            "home_entry_history_limit": 1,
            "home_builder_history_limit": 2,
            "home_search_history_limit": 3,
            "home_import_history_limit": 4,
            "home_export_history_limit": 5,
        })["workspace_settings"]
        self.assertEqual(
            [result[f"{name}_history_limit"] for name in ("entry", "search", "import", "export")],
            [17, 34, 67, 100],
        )
        self.assertEqual(
            [result[f"home_{name}_history_limit"] for name in ("entry", "builder", "search", "import", "export")],
            [1, 2, 3, 4, 5],
        )

    def test_export_history_preserves_reusable_configuration(self) -> None:
        store = ExportHistoryStore(self.root)
        entry = store.append({
            "type": "table",
            "filename": "report.xlsx",
            "configuration": {
                "schema_id": "schema-a",
                "field_ids": [NAME],
                "criteria": {"_search_field_ids": [NAME], NAME: "سليم"},
            },
        })
        self.assertEqual(entry["configuration"]["field_ids"], [NAME])
        self.assertEqual(store.read()[0]["configuration"]["schema_id"], "schema-a")


if __name__ == "__main__":
    unittest.main()
