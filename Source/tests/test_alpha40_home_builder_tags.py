from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha40HomeBuilderTagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_closed_builder_tab_selects_before_active_tab_navigates(self) -> None:
        handler = self.events[
            self.events.index('const builderSchemaTab = event.target.closest("[data-home-builder-schema]")') :
            self.events.index('const tabDestination = event.target.closest("[data-home-tab-destination]")')
        ]
        self.assertIn('if (!builderSchemaTab.classList.contains("is-active"))', handler)
        self.assertIn("selectHomeBuilderSchema(scopeId)", handler)
        self.assertIn('scopeId === "__global__"', handler)
        self.assertIn('switchActiveSchema(scopeId, { mode: "builder" })', handler)

    def test_builder_overview_is_rendered_from_complete_structure_snapshot(self) -> None:
        overview = self.home[
            self.home.index("function renderHomeBuilderOverview") :
            self.home.index("function createBuilderOverviewValue")
        ]
        self.assertNotIn("createBuilderOverviewCard", self.home)
        self.assertIn("const all = addSnapshots(global, schemaSpecific)", overview)
        self.assertIn('createBuilderOverviewCount("التصاميم"', overview)
        self.assertIn('createBuilderOverviewBreakdown("الفئات"', overview)
        self.assertIn('createBuilderOverviewBreakdown("الحقول"', overview)

    def test_per_tab_builder_statistics_are_compact_tags_in_requested_order(self) -> None:
        metric_group = self.home[
            self.home.index("function structureMetricGroup") :
            self.home.index("function renderBuilderStructureStats")
        ]
        self.assertIn('row.className = "home-schema-stat-tags home-builder-structure-tag-row"', metric_group)
        self.assertIn("createSchemaStatTag(name, value)", metric_group)
        self.assertIn('total.className = "home-builder-structure-total"', metric_group)
        stats = self.home[
            self.home.index("function renderBuilderStructureStats") :
            self.home.index("function builderChartValues")
        ]
        for label in (
            'structureMetricGroup("الفئات"', '"رئيسية"', '"متكررة"',
            '"مستقلة"', '"ذات فئة أم"', '"من العام"',
            'structureMetricGroup("الحقول"', '"في الرئيسية"', '"في المتكررة"',
            '"ضمن فئات مستقلة"', '"ضمن فئات فرعية"', '"ضمن فئة"', '"بلا فئة"',
        ):
            self.assertIn(label, stats)

    def test_builder_tag_rows_use_compact_schema_tag_styling(self) -> None:
        styles = self.styles[
            self.styles.index(".home-builder-structure-tag-row") :
            self.styles.index(".home-builder-chart", self.styles.index(".home-builder-structure-tag-row"))
        ]
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr))", styles)
        self.assertIn(".home-builder-structure-tag-row .home-schema-stat-tag", styles)
        builder_overview = self.styles[
            self.styles.index(".home-builder-statistics-row") :
            self.styles.index(".home-builder-panel-body")
        ]
        self.assertIn("repeat(auto-fit, minmax(138px, 1fr))", builder_overview)


if __name__ == "__main__":
    unittest.main()
