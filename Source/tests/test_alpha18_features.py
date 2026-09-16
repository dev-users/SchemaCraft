from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Alpha18FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

    def test_release_contains_alpha18_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)
        self.assertIn("Filter, Builder heading, and scroll geometry", self.styles)

    def test_schema_search_filters_share_export_geometry(self) -> None:
        self.assertIn('wrapper.className = "field categorized-filter-control shared-filter-control"', self.javascript)
        self.assertIn(".schema-search-filter-groups .schema-search-filter-category", self.styles)
        self.assertIn(".schema-search-filter-groups .categorized-filter-control.field-full", self.styles)
        self.assertIn("grid-column: auto !important", self.styles)

    def test_builder_actions_belong_to_category_title_rows(self) -> None:
        self.assertGreaterEqual(self.javascript.count("titleRow.append(actions)"), 1)
        self.assertNotIn("heading.append(titleBlock, actions)", self.javascript)
        self.assertIn("titleRow.append(actions)", self.javascript)
        self.assertIn(".category-title-row > .builder-actions", self.styles)
        self.assertIn("#global-builder-stats + #global-category-list", self.styles)

    def test_tab_aware_scrollbar_and_home_strip_mounting(self) -> None:
        self.assertIn('"page-tab-bar-active"', self.javascript)
        self.assertIn("body.page-tab-bar-active .page::-webkit-scrollbar-track", self.styles)
        self.assertIn("function setWorkspaceSchemaStripMounted(shouldMount)", self.javascript)
        self.assertIn("strip.remove()", self.javascript)


if __name__ == "__main__":
    unittest.main()
