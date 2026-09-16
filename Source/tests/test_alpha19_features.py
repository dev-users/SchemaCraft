from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import GlobalDefinitionStore

ROOT = Path(__file__).resolve().parents[1]


class Alpha19FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

    def test_release_contains_alpha19_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)

    def test_filter_component_is_shared_and_four_columns(self) -> None:
        self.assertIn(
            'wrapper.className = "field categorized-filter-control shared-filter-control"',
            self.javascript,
        )
        self.assertIn(
            ".categorized-filter-groups .categorized-filter-control",
            self.styles,
        )
        self.assertIn(
            "grid-template-columns: repeat(4, minmax(0, 1fr)) !important",
            self.styles,
        )

    def test_import_matching_problems_block_the_sidebar_action(self) -> None:
        self.assertIn('disabled id="commit-import-button"', self.html)
        self.assertIn("elements.commitImportButton.disabled = hasProblems", self.javascript)
        self.assertIn("if (renderImportMatchingProblems())", self.javascript)
        self.assertIn("عالج جميع مشكلات المطابقة قبل تطبيق الاستيراد", self.javascript)

    def test_export_backup_bytes_are_retained_under_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original_data = APP.DATA_DIR
            APP.DATA_DIR = Path(temporary) / "data"
            try:
                relative = APP._archive_export_content(
                    "entry123", "report.xlsx", b"exact export bytes"
                )
                target = APP.DATA_DIR / "exported-files" / relative
                self.assertEqual(target.read_bytes(), b"exact export bytes")
            finally:
                APP.DATA_DIR = original_data

    def test_global_category_order_is_revisioned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            store = GlobalDefinitionStore(Path(temporary))
            first = "gcat_300000000011"
            second = "gcat_300000000012"
            store.save_definition("category", first, {"label": "الأولى", "kind": "main"})
            store.save_definition("category", second, {"label": "الثانية", "kind": "main"})
            before = store.response()
            result = store.reorder_definition(
                "category", second, "up", expected_revision=before["revision"]
            )
            self.assertTrue(result["moved"])
            self.assertEqual(list(result["global_definitions"]["categories"]), [second, first])

    def test_history_actions_and_home_exit_are_stable(self) -> None:
        self.assertIn(".export-history-panel .history-action-buttons", self.styles)
        self.assertIn("flex-wrap: nowrap", self.styles)
        self.assertIn("body.home-mode-active #close-app-button:hover", self.styles)
        self.assertIn("background: #b42318 !important", self.styles)


if __name__ == "__main__":
    unittest.main()
