from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha29HomeTabTests(unittest.TestCase):
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

    def test_data_overview_is_one_compact_statistics_row(self) -> None:
        self.assertIn("home-data-statistics-row", self.html)
        self.assertIn('id="home-data-general-tags"', self.html)
        self.assertNotIn('id="home-data-general-history"', self.html)

    def test_schema_dashboards_use_accessible_browser_tabs(self) -> None:
        self.assertIn('id="home-data-schema-tabs" role="tablist"', self.html)
        for token in (
            "function selectHomeDataSchema(schemaId)",
            'tab.setAttribute("role", "tab")',
            'panel.setAttribute("role", "tabpanel")',
            "panel.hidden = !selected",
            "elements.homeDataSchemaTabs.hidden = dashboards.length === 0",
        ):
            self.assertIn(token, self.home)
        self.assertIn('event.target.closest("[data-home-data-schema]")', self.events)

    def test_schema_dashboard_has_two_charts_and_history_on_one_row(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 29") :]
        self.assertIn('grid-template-areas: "primary secondary history"', final_styles)
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr))", final_styles)
        self.assertIn(".home-schema-browser-tab.is-active", final_styles)

    def test_page_heading_is_clear_without_a_title_container(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 29") :]
        heading_rule = final_styles[
            final_styles.index(".home-page-module > .home-card-heading {") :
            final_styles.index(".home-page-module > .home-card-heading .home-card-title-link")
        ]
        self.assertIn("border: 0", heading_rule)
        self.assertIn("border-radius: 0", heading_rule)
        self.assertIn("background: transparent", heading_rule)
        self.assertIn("box-shadow: none", heading_rule)


if __name__ == "__main__":
    unittest.main()
