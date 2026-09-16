from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import SearchHistoryStore


class Alpha9FeatureTests(unittest.TestCase):
    def test_search_history_preserves_bounded_schema_result_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            store = SearchHistoryStore(Path(root))
            matches = [
                {"record_code": f"A{index:07d}", "title": f"سجل {index}"}
                for index in range(300)
            ]
            item = store.append({
                "mode": "schema",
                "schema_id": "schema-1",
                "schema_name": "الطلاب",
                "result_total": 300,
                "results": {"matches": matches, "total": 300},
            })
            self.assertEqual(item["result_total"], 300)
            self.assertEqual(item["results"]["total"], 300)
            self.assertEqual(len(item["results"]["matches"]), 250)
            self.assertEqual(store.read()[0]["results"]["matches"][0]["record_code"], "A0000000")

    def test_search_history_preserves_bounded_global_result_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            store = SearchHistoryStore(Path(root))
            result_groups = [
                {
                    "schema_id": f"schema-{index}",
                    "schema_name": f"تصميم {index}",
                    "total": 280,
                    "matches": [{"record_code": f"B{value:07d}"} for value in range(280)],
                }
                for index in range(60)
            ]
            item = store.append({
                "mode": "global",
                "result_total": 16800,
                "results": {"results": result_groups},
            })
            self.assertEqual(len(item["results"]["results"]), 50)
            self.assertTrue(all(len(group["matches"]) == 250 for group in item["results"]["results"]))

    def test_workspace_shortcuts_accept_alpha9_context_actions(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            original_path = APP.WORKSPACE_SETTINGS_PATH
            original_access = APP.require_builder_access
            try:
                APP.WORKSPACE_SETTINGS_PATH = Path(root) / "workspace-settings.json"
                APP.require_builder_access = lambda: None
                saved = APP.save_workspace_settings({
                    "shortcuts": {
                        "Ctrl+F": "context_focus_search",
                        "Ctrl+A": "context_archive",
                        "Ctrl+Tab": "next_workspace_tab",
                    }
                })
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original_path
                APP.require_builder_access = original_access
            shortcuts = saved["workspace_settings"]["shortcuts"]
            self.assertEqual(shortcuts["Ctrl+F"], "context_focus_search")
            self.assertEqual(shortcuts["Ctrl+A"], "context_archive")
            self.assertEqual(shortcuts["Ctrl+Tab"], "next_workspace_tab")


if __name__ == "__main__":
    unittest.main()
