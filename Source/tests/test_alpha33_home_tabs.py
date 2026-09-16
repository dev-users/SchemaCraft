from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha33HomeTabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_data_and_builder_are_titled_workspace_surfaces(self) -> None:
        self.assertEqual(self.html.count("home-tabbed-workspace"), 2)
        self.assertIn('id="home-data-workspace-title">إدخال البيانات</h3>', self.html)
        self.assertIn('id="home-builder-workspace-title">بناء التصاميم</h3>', self.html)
        data_header = self.html[self.html.index('id="home-data-workspace-title"') - 180 : self.html.index('id="home-data-content"')]
        builder_header = self.html[self.html.index('id="home-builder-workspace-title"') - 180 : self.html.index('id="home-builder-content"')]
        self.assertNotIn("home-section-eyebrow", data_header)
        self.assertNotIn("home-section-eyebrow", builder_header)

    def test_every_schema_has_a_visible_tab_even_in_single_schema_workspaces(self) -> None:
        self.assertIn("elements.homeDataSchemaTabs.hidden = dashboards.length === 0", self.home)
        self.assertIn("elements.homeBuilderSchemaTabs.hidden = false", self.home)
        self.assertIn('label: "الحقول والفئات العامة"', self.home)
        self.assertNotIn("SchemaTabs.hidden = dashboards.length <= 1", self.home)

    def test_tabs_are_short_borderless_and_attached_to_the_active_panel(self) -> None:
        tab_styles = self.styles[self.styles.index("Alpha 31") : self.styles.index("Alpha 32")]
        for token in (
            "min-height: 38px",
            "border: 0",
            "border-radius: 12px 12px 0 0",
            "background: rgba(248, 250, 252, .94)",
        ):
            self.assertIn(token, tab_styles)

    def test_workspace_surface_is_neutral_and_responsive(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 33") :]
        for token in (
            ".home-page-module.home-tabbed-workspace",
            "border-radius: 24px",
            ".home-dashboard-card > .home-unified-card-heading",
            ".home-tabbed-workspace .home-schema-panel",
            "@media (max-width: 720px)",
            "@media (prefers-reduced-transparency: reduce)",
        ):
            self.assertIn(token, final_styles)


if __name__ == "__main__":
    unittest.main()
