from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Alpha28HomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source_html = (ROOT / "app" / "src" / "pages" / "home" / "home.html").read_text(encoding="utf-8")
        cls.source_javascript = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8"))

    def test_data_and_builder_have_general_and_schema_surfaces(self) -> None:
        self.assertEqual(self.source_html.count("home-page-module"), 4)
        for element_id in (
            "home-data-general-tags",
            "home-data-schema-tabs",
            "recent-records",
            "home-builder-general-tags",
            "home-builder-schema-tabs",
            "home-builder-schemas",
        ):
            self.assertIn(f'id="{element_id}"', self.source_html)
        self.assertIn("home-statistics-row", self.source_html)

    def test_both_chart_slots_choose_their_type_independently(self) -> None:
        self.assertNotIn('disabled id="home-chart-type"', self.source_html)
        for token in (
            "normalizedHomeChartSlots",
            'primary: slot("primary", "bar"',
            'secondary: slot("secondary", "gauge"',
            "payload[schemaId] = { slots }",
            "dataset.homeChartSlot",
            'renderHomeSchemaChart(schemaId, "primary")',
            'renderHomeSchemaChart(schemaId, "secondary")',
        ):
            self.assertIn(token, self.source_javascript)
        self.assertIn("chart.dataset.homeChartSlot", self.events)

    def test_collapsed_cards_use_auto_rows_and_leave_only_titles(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 28") :]
        self.assertIn("grid-template-rows: none !important", final_styles)
        self.assertIn("grid-row: auto !important", final_styles)
        self.assertIn("height: fit-content !important", final_styles)
        self.assertIn(".home-schema-panel-content[hidden]", final_styles)
        self.assertIn(".optional-explanation", final_styles)
        self.assertIn(".home-schema-stat-tags", final_styles)
        self.assertIn("toggleHomeSchemaPanel", self.source_javascript)

    def test_page_modules_are_not_visual_outer_cards(self) -> None:
        final_styles = self.styles[self.styles.index("Alpha 28") :]
        module_rule = final_styles[final_styles.index(".home-page-module {") : final_styles.index(".home-page-module >")]
        self.assertIn("border: 0", module_rule)
        self.assertIn("background: transparent !important", module_rule)
        self.assertIn("box-shadow: none !important", module_rule)


if __name__ == "__main__":
    unittest.main()
