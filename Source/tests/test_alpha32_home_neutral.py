from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha32HomeNeutralTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_schema_statistics_are_compact_tags_in_the_heading(self) -> None:
        self.assertGreaterEqual(self.home.count('tags.className = "home-schema-stat-tags"'), 1)
        self.assertIn("heading.append(tags)", self.home)
        self.assertIn("panel.append(heading, body)", self.home)
        self.assertIn("body.append(statistics, charts, history)", self.home)
        self.assertIn("panel.append(body)", self.home)
        self.assertNotIn("home-schema-statistics-row", self.home)

    def test_general_stat_cards_use_one_neutral_palette(self) -> None:
        metric_styles = self.styles[self.styles.index("Alpha 31") : self.styles.index("Alpha 32")]
        self.assertIn("background: rgba(250, 251, 252, .86)", metric_styles)
        for colored_variant in (
            "rgba(43, 157, 118",
            "rgba(224, 157, 43",
            "rgba(50, 126, 194",
            ".home-statistics-row .home-schema-stat-tag:nth-child",
        ):
            self.assertNotIn(colored_variant, metric_styles)

    def test_additional_polish_is_neutral_and_responsive(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 32") :]
        for token in (
            ".home-schema-browser-tab:focus-visible",
            "border-radius: 18px",
            "background: rgba(102, 116, 133, .54)",
            "@media (max-width: 620px)",
        ):
            self.assertIn(token, final_styles)


if __name__ == "__main__":
    unittest.main()
