from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha37HomeRefinementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")
        cls.final_styles = cls.styles[cls.styles.index("Alpha 37") :]

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_tabs_touch_content_without_a_padding_bridge(self) -> None:
        tab_rule = self.styles[
            self.styles.index(".home-schema-browser-tabs {", self.styles.index("Alpha 31")) :
            self.styles.index(".home-schema-browser-tab {", self.styles.index("Alpha 31"))
        ]
        self.assertIn("padding: 0", tab_rule)
        seamless = self.styles[self.styles.index("Alpha 34") : self.styles.index("Alpha 37")]
        self.assertIn("margin-top: -1px", seamless)
        self.assertNotIn(".home-tabbed-workspace .home-schema-browser-tab.is-active::after", seamless)

    def test_home_uses_title_only_headers_and_larger_labels(self) -> None:
        self.assertNotIn("home-section-eyebrow", self.html)
        self.assertNotIn("optional-explanation", self.html)
        self.assertNotIn("explanation-text", self.html)
        self.assertIn("font-size: 1.2rem", self.styles[self.styles.index("Alpha 33") :])
        self.assertIn("font-size: .74rem", self.styles[self.styles.index("Alpha 31") :])
        self.assertIn("font-size: .79rem", self.final_styles)

    def test_corner_radii_are_tighter(self) -> None:
        for token in (
            "border-radius: 15px",
            "border-radius: 12px 12px 0 0",
            "border-radius: 24px",
            "border-radius: 0 0 18px 18px",
            "border-radius: 14px",
        ):
            self.assertIn(token, self.styles[self.styles.index("Alpha 31") :])

    def test_cards_have_motion_safe_hover_support(self) -> None:
        self.assertIn("transition: box-shadow 180ms ease", self.final_styles)
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.final_styles)


if __name__ == "__main__":
    unittest.main()
