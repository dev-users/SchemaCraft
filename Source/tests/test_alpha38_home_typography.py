from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha38HomeTypographyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")
        cls.final_styles = cls.styles[cls.styles.index("Alpha 38") :]

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_home_typography_is_scaled_without_resizing_other_pages(self) -> None:
        self.assertIn(".home-view {\n  font-size: 150%;", self.final_styles)
        for size in ("1.8rem", "1.11rem", "2rem", "1.14rem", "1.56rem", "1.19rem", "2.48rem"):
            self.assertIn(f"font-size: {size}", self.final_styles)
        self.assertNotIn("body {\n  font-size: 150%;", self.final_styles)

    def test_hover_feedback_does_not_recolor_cards(self) -> None:
        hover = self.final_styles[
            self.final_styles.index("@media (hover: hover)") :
            self.final_styles.index("@media (max-width: 720px)")
        ]
        self.assertNotIn("rgba(238, 246, 255", hover)
        self.assertNotIn("rgba(229, 241, 255", hover)
        self.assertNotIn("--home-tab-surface:", hover)
        self.assertIn("background: transparent", hover)
        self.assertIn("background: rgba(248, 250, 252, .6)", hover)

    def test_neutral_hover_still_has_motion_safe_feedback(self) -> None:
        self.assertIn("box-shadow: 0 18px 42px rgba(31, 55, 82, .12)", self.final_styles)
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.final_styles)
        self.assertIn("transform: none", self.final_styles)


if __name__ == "__main__":
    unittest.main()
