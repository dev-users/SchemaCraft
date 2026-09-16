from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import SchemaCraft as APP

ROOT = Path(__file__).resolve().parents[1]


class Alpha23DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

    def test_release_and_cache_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", self.html)

    def test_home_has_one_data_card_and_three_operation_cards(self) -> None:
        self.assertEqual(self.html.count('data-card-kind="data"'), 1)
        self.assertEqual(self.html.count('data-card-kind="table"'), 3)
        self.assertIn('data-card-kind="data" data-grid-x="1" data-grid-w="6"', self.html)
        self.assertIn('data-card-kind="builder"', self.html)
        self.assertIn('id="home-chart-dialog"', self.html)
        self.assertIn('id="home-chart-type"', self.html)
        self.assertIn('id="home-chart-field"', self.html)
        self.assertIn("loadHomeSchemaDashboards", self.javascript)
        self.assertIn("HOME_CHART_CONFIG_STORAGE_KEY", self.javascript)
        self.assertIn("home-schema-gauge-segment", self.javascript)

    def test_home_card_title_navigates_without_action_buttons(self) -> None:
        self.assertIn('data-home-destination="search"', self.html)
        self.assertNotIn('data-clear-history="search"', self.html)
        self.assertNotIn('data-home-card-toggle', self.html)
        self.assertIn('toggleHomeCard(card)', self.javascript)

    def test_result_window_and_table_have_real_containers(self) -> None:
        self.assertIn('className = "search-results-window-container workspace-panel"', self.javascript)
        self.assertIn('content.classList.add("search-results-window-content")', self.javascript)
        self.assertIn(".search-results-window-content.search-results-section", self.styles)
        self.assertIn("overflow: auto !important", self.styles)

    def test_scrollbar_uses_wide_white_track_after_legacy_rules(self) -> None:
        alpha23 = self.styles.index("Alpha 23")
        final_styles = self.styles[alpha23:]
        self.assertIn("--application-scrollbar-size: 16px", final_styles)
        self.assertIn("--application-scrollbar-track: #fff", final_styles)
        self.assertIn(".page::-webkit-scrollbar-track", final_styles)
        self.assertIn("scrollbar-width: auto !important", final_styles)

    def test_field_value_summary_counts_records_and_checked_boxes(self) -> None:
        field = {"id": "field-one", "label": "منجز", "type": "checkbox", "options": []}
        schema = {
            "conditions": [],
            "categories": [{"id": "category-one", "kind": "main", "fields": [field]}],
        }
        records = (
            {"values": {"field-one": True}, "related": {}},
            {"values": {"field-one": False}, "related": {}},
            {"values": {"field-one": True}, "related": {}},
        )
        with (
            mock.patch.object(APP, "read_schema_file", return_value=schema),
            mock.patch.object(APP, "_dataset_snapshot_unlocked", return_value=SimpleNamespace(records=records)),
        ):
            result = APP.field_value_suggestions("field-one")
        self.assertEqual(result["record_count"], 3)
        self.assertEqual(result["records_with_value"], 3)
        self.assertEqual(result["checked_record_count"], 2)


if __name__ == "__main__":
    unittest.main()
