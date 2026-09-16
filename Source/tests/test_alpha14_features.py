from __future__ import annotations

import base64
import io
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook
from test_backend import configured_schema

import SchemaCraft as APP
from schemacraft_advanced import _pdf_text
from schemacraft_io import inspect_import_workbook

ROOT = Path(__file__).resolve().parents[1]


class Alpha14FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

    def test_release_contains_alpha14_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8").splitlines())
        self.assertIn("v=20260906-alpha53", self.html)
        self.assertIn("Sticky scopes and interaction unification", self.styles)

    def test_tabs_pickers_histories_and_settings_use_final_contract(self) -> None:
        self.assertIn(".full-search-view > .search-scope-strip", self.styles)
        self.assertIn("position: sticky", self.styles)
        self.assertIn('content: "›"', self.styles)
        self.assertIn('class="workspace-panel history-table-card"', self.html)
        self.assertNotIn('class="check-field archived-filter-setting"><input id="full-search-include-archived"', self.html)
        self.assertIn('id="full-search-include-archived"', self.html)
        self.assertNotIn("settings-dialog-close-row", self.html)
        self.assertNotIn("shortcut-default-button", self.javascript)
        self.assertNotIn("reset-shortcuts-button", self.html)

    def test_import_inspection_returns_all_matching_problems(self) -> None:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Data"
        sheet.append(["Unknown A", "Unknown B", "Unknown C"])
        sheet.append(["one", "two", "three"])
        output = io.BytesIO()
        workbook.save(output)
        workbook.close()
        encoded = base64.b64encode(output.getvalue()).decode("ascii")

        inspection = inspect_import_workbook(encoded, configured_schema())
        messages = [item["message"] for item in inspection["problems"]]
        self.assertEqual(len(messages), 3)
        self.assertTrue(any("Unknown A" in message for message in messages))
        self.assertTrue(any("Unknown B" in message for message in messages))
        self.assertTrue(any("Unknown C" in message for message in messages))

    def test_saved_background_can_be_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original_path = APP.WORKSPACE_SETTINGS_PATH
            original_access = APP.require_builder_access
            APP.WORKSPACE_SETTINGS_PATH = Path(temporary) / "workspace-settings.json"
            APP.require_builder_access = lambda: None
            try:
                content = b"\x89PNG\r\n\x1a\nalpha-14-background"
                saved = APP.save_workspace_settings(
                    {
                        "background_image_name": "alpha14.png",
                        "background_image_data": base64.b64encode(content).decode("ascii"),
                    }
                )["workspace_settings"]
                image_id = saved["background_image_id"]
                image_path = APP.workspace_background_image_file(image_id)
                self.assertTrue(image_path.is_file())

                deleted = APP.save_workspace_settings(
                    {"delete_background_image_id": image_id}
                )["workspace_settings"]
                self.assertEqual(deleted["background_image_id"], "default")
                self.assertFalse(deleted["background_image_custom"])
                self.assertFalse(image_path.exists())
                self.assertNotIn(image_id, {item["id"] for item in deleted["background_images"]})
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original_path
                APP.require_builder_access = original_access

    def test_multiline_pdf_text_preserves_top_to_bottom_line_order(self) -> None:
        prepared = _pdf_text("سطر FIRST\nسطر SECOND\nسطر THIRD")
        self.assertEqual(prepared.count("<br/>"), 2)
        self.assertLess(prepared.index("FIRST"), prepared.index("SECOND"))
        self.assertLess(prepared.index("SECOND"), prepared.index("THIRD"))

    def test_profile_general_information_has_per_schema_template(self) -> None:
        self.assertIn("profileInfoFormatBySchema", self.javascript)
        self.assertIn("data-profile-info-format-schema", self.javascript)
        self.assertIn("template.replace", self.javascript)


if __name__ == "__main__":
    unittest.main()
