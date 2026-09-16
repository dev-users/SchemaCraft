from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha31HomeMetricTests(unittest.TestCase):
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

    def test_general_statistics_have_no_summary_label_container(self) -> None:
        self.assertIn('class="home-statistics-row home-data-statistics-row"', self.html)
        self.assertIn('class="home-statistics-row home-builder-statistics-row"', self.html)
        self.assertNotIn("home-summary-label", self.html)
        self.assertNotIn("ملخص السجلات", self.html)
        self.assertNotIn("ملخص البنية", self.html)

    def test_schema_statistics_remain_compact_heading_tags(self) -> None:
        self.assertIn('tags.className = "home-schema-stat-tags"', self.home)
        self.assertIn("heading.append(tags)", self.home)
        self.assertIn("panel.append(heading, body)", self.home)
        self.assertIn("body.append(statistics, charts, history)", self.home)
        self.assertIn("panel.append(body)", self.home)

    def test_metric_tiles_follow_the_reference_hierarchy(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 31") :]
        for token in (
            "grid-template-columns: repeat(auto-fit, minmax(138px, 1fr))",
            ".home-statistics-row .home-schema-stat-tag",
            "font-size: 1.34rem",
            "background: rgba(250, 251, 252, .86)",
            "@media (prefers-reduced-transparency: reduce)",
        ):
            self.assertIn(token, final_styles)

    def test_schema_tabs_scroll_smoothly_and_attach_to_the_panel(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 31") :]
        for token in (
            "scroll-behavior: smooth",
            "scroll-snap-type: inline proximity",
            "scroll-snap-align: start",
            "border-radius: 12px 12px 0 0",
            "min-height: 38px",
            ".home-schema-browser-tab.is-active",
        ):
            self.assertIn(token, final_styles)


if __name__ == "__main__":
    unittest.main()
