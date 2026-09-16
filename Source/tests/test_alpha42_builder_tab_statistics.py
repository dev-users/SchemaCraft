from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha42BuilderTabStatisticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_totals_are_plain_elements_not_tags(self) -> None:
        metric_group = self.home[
            self.home.index("function structureMetricGroup") :
            self.home.index("function renderBuilderStructureStats")
        ]
        self.assertIn('total.className = "home-builder-structure-total"', metric_group)
        self.assertIn("total.append(totalValue, totalLabel)", metric_group)
        self.assertNotIn("createSchemaStatTag(title", metric_group)
        self.assertNotIn("home-schema-stat-tag home-builder-structure-total", metric_group)

    def test_partition_tags_are_larger(self) -> None:
        final = self.styles[self.styles.rindex("Alpha 41") :]
        partition = final[final.index(".home-builder-structure-partition .home-schema-stat-tag") :]
        self.assertIn("min-height: 42px", partition)
        self.assertIn("font-size: 1.2rem", partition)
        self.assertIn("font-size: .92rem", partition)

    def test_plain_totals_have_strong_typographic_hierarchy(self) -> None:
        final = self.styles[self.styles.rindex("Alpha 41") :]
        total = final[final.index(".home-builder-structure-total {") : final.index(".home-builder-structure-partition {")]
        self.assertIn("background: transparent", total)
        self.assertIn("font-size: 1.58rem", total)
        self.assertIn("font-size: 1rem", total)


if __name__ == "__main__":
    unittest.main()
