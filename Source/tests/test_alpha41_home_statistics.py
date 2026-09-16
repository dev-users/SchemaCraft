from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha41HomeStatisticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_general_data_statistics_are_centered_without_decoration(self) -> None:
        final = self.styles[self.styles.rindex("Alpha 41") :]
        self.assertIn("place-content: center", final)
        self.assertIn("justify-items: center", final)
        self.assertIn(".home-statistics-row > .home-schema-stat-tag::before", final)
        self.assertIn("display: none", final)

    def test_custom_stat_adder_is_a_standalone_plus(self) -> None:
        overview = self.home[
            self.home.index("function renderHomeDataOverview") :
            self.home.index("function openHomeCustomStatDialog")
        ]
        self.assertIn('add.className = "home-configurable-stat home-add-stat"', overview)
        self.assertIn('add.textContent = "+"', overview)
        self.assertNotIn('label.textContent = "إضافة إحصاء"', overview)
        final = self.styles[self.styles.rindex("Alpha 41") :]
        self.assertIn("flex: 0 0 44px", final)
        self.assertIn("background: transparent", final)

    def test_builder_overview_has_one_compact_and_two_composite_cards(self) -> None:
        overview = self.home[
            self.home.index("function renderHomeBuilderOverview") :
            self.home.index("function structureMetricGroup")
        ]
        self.assertIn('createBuilderOverviewCount("التصاميم"', overview)
        self.assertIn('createBuilderOverviewBreakdown("الفئات"', overview)
        self.assertIn('["المتكررة", all.categories.repeated]', overview)
        self.assertIn('["المستقلة", all.categories.independent]', overview)
        self.assertIn('createBuilderOverviewBreakdown("الحقول"', overview)
        self.assertIn('["في المتكررة", all.fields.repeated]', overview)
        self.assertIn('["في المستقلة", all.fields.independent]', overview)
        self.assertIn("--home-builder-share", overview)
        final = self.styles[self.styles.rindex("Alpha 41") :]
        self.assertIn("minmax(112px, .42fr)", final)
        self.assertIn("repeat(2, minmax(300px, 1.29fr))", final)

    def test_builder_tab_partitions_visually_reconcile_to_totals(self) -> None:
        stats = self.home[
            self.home.index("function structureMetricGroup") :
            self.home.index("function builderChartValues")
        ]
        self.assertIn('group.className = "home-builder-structure-group"', stats)
        self.assertIn('total.className = "home-builder-structure-total"', stats)
        self.assertIn('row.classList.add("home-builder-structure-partition")', stats)
        for partition in (
            '[["رئيسية", snapshot.categories.main], ["متكررة", snapshot.categories.repeated]]',
            '[["مستقلة", snapshot.categories.independent], ["ذات فئة أم", snapshot.categories.parented]]',
            '[["في الرئيسية", snapshot.fields.main], ["في المتكررة", snapshot.fields.repeated]',
            '[["ضمن فئات مستقلة", snapshot.fields.independent], ["ضمن فئات فرعية", snapshot.fields.parented]',
        ):
            self.assertIn(partition, stats)
        self.assertIn('["خاصة بالتصميم", snapshot.categories.specific]', stats)
        self.assertIn('["خاصة بالتصميم", snapshot.fields.specific]', stats)


if __name__ == "__main__":
    unittest.main()
