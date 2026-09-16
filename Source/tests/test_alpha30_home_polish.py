from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha30HomePolishTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8"))

    def test_builder_matches_the_summary_and_browser_tab_model(self) -> None:
        self.assertIn('class="home-statistics-row home-builder-statistics-row"', self.html)
        self.assertIn('id="home-builder-schema-tabs" role="tablist"', self.html)
        self.assertNotIn('id="home-builder-general-history"', self.html)
        for token in (
            "function selectHomeBuilderSchema(schemaId)",
            'datasetKey: "homeBuilderSchema"',
            "panel.dataset.homeBuilderPanel = scopeId",
            "elements.homeBuilderSchemaTabs.hidden = false",
            'scopeId: "__global__"',
        ):
            self.assertIn(token, self.home)
        self.assertIn('event.target.closest("[data-home-builder-schema]")', self.events)

    def test_builder_schema_panels_include_structural_charts(self) -> None:
        builder_render = self.home[
            self.home.index("function renderHomeBuilderDashboard()") :
            self.home.index("async function openBuilderHistoryItem")
        ]
        self.assertIn("home-schema-chart-button home-builder-chart", builder_render)
        self.assertIn("panel._builderSnapshot = snapshot", builder_render)
        selection = self.home[self.home.index("function selectHomeBuilderSchema("):self.home.index("function renderHomeSchemaDashboards(")]
        self.assertIn("renderHomeBuilderChart", selection)
        self.assertNotIn("renderHomeSchemaChart", builder_render)
        self.assertIn("home-builder-history", builder_render)

    def test_home_uses_translucent_surfaces_with_accessible_fallback(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 30") :]
        for token in (
            "--home-glass-surface: rgba(",
            "backdrop-filter: blur(14px)",
            ".home-schema-browser-tab.is-active::after",
            "@media (prefers-reduced-transparency: reduce)",
        ):
            self.assertIn(token, final_styles)

    def test_section_names_use_the_unified_title_header(self) -> None:
        self.assertEqual(self.html.count("home-unified-card-heading"), 5)
        self.assertNotIn("home-section-eyebrow", self.html)
        self.assertIn('id="home-data-workspace-title"', self.html)
        self.assertIn('id="home-builder-workspace-title"', self.html)
        for title in (
            "إدخال البيانات",
            "بناء التصاميم",
            "البحث في السجلات",
            "استيراد البيانات",
            "تصدير البيانات",
        ):
            self.assertIn(title, self.html)


if __name__ == "__main__":
    unittest.main()
