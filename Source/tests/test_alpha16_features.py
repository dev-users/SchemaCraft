from __future__ import annotations

import json
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class _DialogIndex(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.dialogs: dict[str, dict[str, str]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag == "dialog" and attributes.get("id"):
            self.dialogs[attributes["id"]] = attributes


class Alpha16FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        parser = _DialogIndex()
        parser.feed(cls.html)
        cls.dialogs = parser.dialogs

    def test_release_contains_alpha16_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)
        self.assertIn("Canonical selection dialogs and Search refinements", self.styles)

    def test_every_field_filter_picker_uses_the_canonical_contract(self) -> None:
        picker_ids = {
            "search-fields-dialog",
            "full-search-filter-dialog",
            "full-search-fields-dialog",
            "profile-export-options-dialog",
            "profile-info-fields-dialog",
            "export-filter-dialog",
            "export-fields-dialog",
            "globalize-existing-dialog",
        }
        for picker_id in picker_ids:
            self.assertIn(picker_id, self.dialogs)
            self.assertIn(
                "selection-tree-dialog",
                self.dialogs[picker_id].get("class", ""),
                picker_id,
            )
        self.assertIn("--selection-dialog-inline-padding: 18px", self.styles)
        self.assertIn("--selection-dialog-category-background: #f4f6f9", self.styles)
        self.assertIn(".selection-tree-dialog .search-field-option-grid .check-field", self.styles)

    def test_schema_search_categories_and_large_filter_viewport_are_explicit(self) -> None:
        self.assertIn('id="schema-search-filter-groups"', self.html)
        self.assertIn("createSchemaSearchFilterCategory", self.javascript)
        self.assertIn('categoryCount > 5', self.javascript)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr))", self.styles)
        self.assertIn(".schema-search-filter-groups.is-scrollable", self.styles)

    def test_search_result_scroll_rail_uses_requested_layout(self) -> None:
        self.assertIn(".global-result-table", self.styles)
        self.assertIn("global-result-table-scroll", self.javascript)
        self.assertIn('id="schema-search-results-table-scroll"', self.html)
        pagination = self.html.index('class="table-pagination"')
        table_scroll = self.html.index('id="schema-search-results-table-scroll"')
        dialog_actions = self.html.index(
            'class="dialog-actions"><button class="button button-primary" data-close-dialog="search-results-dialog"'
        )
        self.assertLess(table_scroll, pagination)  # Pagination stays below the independent scrolling table.
        self.assertLess(table_scroll, dialog_actions)
        self.assertIn("overflow: scroll !important", self.styles)


if __name__ == "__main__":
    unittest.main()
