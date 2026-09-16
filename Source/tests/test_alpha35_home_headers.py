from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha35HomeHeaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_all_five_cards_use_identical_title_only_headers(self) -> None:
        self.assertEqual(self.html.count('class="home-card-heading home-unified-card-heading"'), 5)
        self.assertNotIn("home-section-eyebrow", self.html)
        self.assertNotIn("optional-explanation", self.html)
        for title in (
            "إدخال البيانات",
            "بناء التصاميم",
            "البحث في السجلات",
            "استيراد البيانات",
            "تصدير البيانات",
        ):
            self.assertIn(title, self.html)

    def test_one_rule_controls_every_home_card_header(self) -> None:
        workspace_styles = self.styles[self.styles.index("Alpha 33") :]
        header_rule = workspace_styles[
            workspace_styles.index(".home-dashboard-card > .home-unified-card-heading {") :
            workspace_styles.index(".home-dashboard-card > .home-unified-card-heading::after")
        ]
        self.assertIn("min-height: 48px", header_rule)
        self.assertIn("padding: 10px 16px", header_rule)
        self.assertIn("border: 0", header_rule)
        self.assertIn("background: transparent", header_rule)
        self.assertIn("box-shadow: none", header_rule)

    def test_tabs_and_content_surface_are_borderless(self) -> None:
        tab_styles = self.styles[self.styles.index("Alpha 31") : self.styles.index("Alpha 32")]
        self.assertIn("min-height: 38px", tab_styles)
        self.assertIn("border: 0", tab_styles)
        seamless = self.styles[self.styles.index("Alpha 34") :]
        self.assertIn(".home-tabbed-workspace .home-schema-browser-tabs", seamless)
        self.assertIn(".home-tabbed-workspace .home-schema-browser-panels", seamless)
        self.assertGreaterEqual(seamless.count("border: 0"), 4)

    def test_active_tab_blends_into_content(self) -> None:
        seamless = self.styles[self.styles.index("Alpha 34") :]
        self.assertIn("background: var(--home-tab-surface)", seamless)
        self.assertIn("margin-top: -1px", seamless)
        self.assertNotIn(".home-tabbed-workspace .home-schema-browser-tab.is-active::after", seamless)


if __name__ == "__main__":
    unittest.main()
