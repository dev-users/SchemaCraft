from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Alpha17FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

    def test_release_contains_alpha17_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)
        self.assertIn("Search tables, shared filters, and Builder parity", self.styles)

    def test_search_fields_and_filters_have_distinct_layout_rules(self) -> None:
        self.assertIn("#full-search-options-summary > .selection-category-group > .selection-chip-list", self.styles)
        self.assertIn("display: flex !important", self.styles)
        self.assertIn(".categorized-filter-groups .schema-search-category-field-grid", self.styles)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr))", self.styles)
        self.assertIn("updateCategorizedFilterScrolling(container)", self.javascript)

    def test_global_search_results_are_schema_tables(self) -> None:
        self.assertIn('table.className = "data-table records-table global-result-table"', self.javascript)
        self.assertIn('tableScroll.className = "table-scroll global-result-table-scroll"', self.javascript)
        self.assertNotIn('card.className = "global-result-card"', self.javascript)
        self.assertIn(".global-result-table-scroll", self.styles)

    def test_exchange_history_and_profile_formatter_use_new_contract(self) -> None:
        self.assertIn(".exchange-history-panel > .history-table-card", self.styles)
        self.assertIn("padding: 0 !important", self.styles)
        self.assertIn("profile-info-selection-part", self.javascript)
        self.assertIn("profile-info-format-part", self.javascript)
        self.assertIn("renderProfileInfoFormatTokens", self.javascript)
        self.assertIn("[data-profile-info-field]:checked", self.javascript)

    def test_global_builder_matches_schema_builder_structure(self) -> None:
        self.assertIn('class="builder-intro builder-summary-panel" id="global-builder-stats"', self.html)
        self.assertIn('class="builder-intro builder-summary-panel" id="builder-intro-panel"', self.html)
        self.assertIn("titleRow.append(actions)", self.javascript)
        self.assertIn(".global-definition-category-card > .global-definition-heading", self.styles)


if __name__ == "__main__":
    unittest.main()
