from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha39HomeArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.foundation = (ROOT / "app" / "src" / "core" / "foundation.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_balanced_home_typography_is_the_final_cascade(self) -> None:
        final = self.styles[self.styles.rindex("Alpha 39 final cascade") :]
        self.assertIn(".home-view {\n  font-size: 125%;", final)
        self.assertIn("font-size: 1.55rem", final)
        self.assertIn("font-size: .95rem", final)
        self.assertIn("font-size: 118%", final)
        self.assertNotIn("font-size: 150%", final)

    def test_schema_names_live_in_navigable_tab_labels_only(self) -> None:
        for token in (
            'text.className = "home-schema-browser-tab-label"',
            "text.dataset.homeTabDestination = destination",
            "text.dataset.homeTabSchemaId = schemaId",
            'event.target.closest("[data-home-tab-destination]")',
        ):
            self.assertIn(token, self.home + self.events)
        data_render = self.home[
            self.home.index("function renderHomeSchemaDashboards()") :
            self.home.index("async function loadHomeSchemaDashboards()")
        ]
        self.assertIn("heading.append(tags)", data_render)
        self.assertNotIn("home-schema-title-link", data_render)

    def test_data_overview_has_fixed_and_configurable_metrics(self) -> None:
        for label in ("التصاميم", "كل السجلات", "المؤرشفة", "غير المؤرشفة"):
            self.assertIn(f'createSchemaStatTag("{label}"', self.home)
        self.assertIn("HOME_CUSTOM_STATS_STORAGE_KEY", self.foundation)
        self.assertIn("readHomeCustomStats", self.home)
        self.assertIn("configs.slice(0, 3)", self.home)
        self.assertIn("/api/search/field-values", self.home)
        self.assertIn('id="home-custom-stat-dialog"', self.html)

    def test_data_panel_keeps_centered_stats_two_charts_and_history(self) -> None:
        self.assertIn('heading.className = "home-schema-panel-heading home-data-schema-summary"', self.home)
        self.assertIn("body.append(history, primaryChart, secondaryChart)", self.home)
        self.assertIn("justify-content: center", self.styles[self.styles.index(".home-data-schema-summary") :])

    def test_builder_has_general_tab_and_three_part_panels(self) -> None:
        builder = self.home[
            self.home.index("function renderHomeBuilderDashboard()") :
            self.home.index("async function openBuilderHistoryItem")
        ]
        self.assertIn('scopeId: "__global__"', builder)
        self.assertIn('label: "الحقول والفئات العامة"', builder)
        self.assertIn("body.append(statistics, charts, history)", builder)
        self.assertNotIn("home-schema-panel-heading", builder)
        self.assertIn('grid-template-areas: "stats chart history"', self.styles)

    def test_builder_statistics_cover_requested_structure_dimensions(self) -> None:
        for token in (
            "categoryIsGlobal",
            "fieldIsGlobal",
            "categories.independent",
            "categories.parented",
            "fields.independent",
            "fields.parented",
            "fields.withoutCategory",
            '["من العام", snapshot.fields.general]',
            '["خاصة بالتصميم", snapshot.fields.specific]',
            '["بلا فئة", snapshot.fields.withoutCategory]',
        ):
            self.assertIn(token, self.home)
        self.assertIn("home-builder-structure-tag-row", self.home)

    def test_builder_chart_is_configurable_by_structure_or_field_type(self) -> None:
        self.assertIn("HOME_BUILDER_CHART_SOURCES", self.home)
        for source in ("category_kind", "category_parent", "category_source", "field_location", "field_parent", "field_source", "field_type"):
            self.assertIn(f'id: "{source}"', self.home)
        self.assertIn("renderHomeBuilderBarChart", self.home)
        self.assertIn("renderHomeGaugeChart", self.home)
        self.assertIn('event.target.closest("[data-configure-home-builder-chart]")', self.events)


if __name__ == "__main__":
    unittest.main()
