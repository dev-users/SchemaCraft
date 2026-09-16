from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha36TabAlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_tab_strip_starts_at_the_rtl_content_edge(self) -> None:
        tab_rule = self.styles[
            self.styles.index(".home-schema-browser-tabs {", self.styles.index("Alpha 31")) :
            self.styles.index(".home-schema-browser-tab {", self.styles.index("Alpha 31"))
        ]
        self.assertIn("padding: 0", tab_rule)
        self.assertNotIn("padding-inline", tab_rule)
        mobile_styles = self.styles[self.styles.index("@media (max-width: 720px)", self.styles.index("Alpha 33")) :]
        self.assertNotIn(".home-schema-browser-tabs {\n    padding-inline", mobile_styles)

    def test_tab_and_content_touch_without_reserved_internal_space(self) -> None:
        seamless = self.styles[self.styles.index("Alpha 34") :]
        self.assertIn("margin-top: -1px", seamless)
        self.assertNotIn("bottom: -8px", seamless)
        self.assertNotIn("height: 9px", seamless)

    def test_home_corners_are_balanced(self) -> None:
        final_home = self.styles[self.styles.index("Alpha 31") :]
        for token in (
            "border-radius: 15px",
            "border-radius: 12px 12px 0 0",
            "border-radius: 24px",
            "border-radius: 0 0 18px 18px",
            "border-start-end-radius: 13px",
        ):
            self.assertIn(token, final_home)


if __name__ == "__main__":
    unittest.main()
