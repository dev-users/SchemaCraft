from __future__ import annotations

import json
import unittest
from pathlib import Path

import SchemaCraft as APP
from schemacraft_advanced import _pdf_text

ROOT = Path(__file__).resolve().parents[1]


class Alpha15FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.exchange_source = (
            ROOT / "app" / "src" / "pages" / "exchange" / "exchange.html"
        ).read_text(encoding="utf-8")

    def test_release_contains_alpha15_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(
            encoding="utf-8"
        )
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)
        self.assertIn("Flush scopes, durable pickers, and RTL reports", self.styles)

    def test_scope_rails_dialogs_and_tables_use_new_contract(self) -> None:
        self.assertIn("--workspace-strip-height: 54px", self.styles)
        self.assertIn("top: calc(var(--workspace-strip-height)", self.styles)
        self.assertIn('content: "⌄" !important', self.styles)
        self.assertIn("overflow-x: scroll !important", self.styles)
        self.assertIn("white-space: nowrap", self.styles)
        self.assertIn(".global-result-table", self.styles)
        self.assertIn('table.className = "data-table records-table global-result-table"', self.javascript)

    def test_dialogs_restore_applied_search_and_export_selections(self) -> None:
        self.assertIn(
            'renderGlobalSchemaFieldSettings("filter");', self.javascript
        )
        self.assertIn(
            'activeFullSearchOptionIds("filter")', self.javascript
        )
        self.assertIn(
            'renderExportFilters(); elements.exportFilterDialog.showModal()',
            self.javascript,
        )
        self.assertNotIn(
            'renderExportFilters({ fresh: true }); elements.exportFilterDialog.showModal()',
            self.javascript,
        )

    def test_multiple_values_in_one_list_field_use_or(self) -> None:
        checkbox_group = {
            "type": "checkbox_group",
            "options": [
                {"id": "a", "label": "A", "active": True},
                {"id": "b", "label": "B", "active": True},
                {"id": "c", "label": "C", "active": True},
            ],
            "search_match": "exact",
        }
        self.assertTrue(APP._field_matches(checkbox_group, ["a", "b"], ["b"]))
        self.assertFalse(APP._field_matches(checkbox_group, ["a", "b"], ["c"]))
        self.assertTrue(
            APP._indexed_field_matches(
                checkbox_group, ["a", "b"], frozenset({"b"})
            )
        )
        self.assertFalse(
            APP._indexed_field_matches(
                checkbox_group, ["a", "b"], frozenset({"c"})
            )
        )

        select = {
            "type": "select",
            "options": checkbox_group["options"],
            "search_match": "exact",
        }
        self.assertTrue(APP._field_matches(select, ["a", "b"], "b"))
        self.assertFalse(APP._field_matches(select, ["a", "b"], "c"))

    def test_automatic_pdf_wrap_preserves_logical_line_order(self) -> None:
        prepared = _pdf_text(
            "سطر FIRST سطر SECOND سطر THIRD",
            max_width=12,
            measure=lambda visual: float(len(visual)),
        )
        self.assertGreaterEqual(prepared.count("<br/>"), 1)
        self.assertLess(prepared.index("FIRST"), prepared.index("SECOND"))
        self.assertLess(prepared.index("SECOND"), prepared.index("THIRD"))

    def test_profile_format_editor_and_excel_sections_are_explicit(self) -> None:
        self.assertIn("dataset.profileInfoToken", self.javascript)
        self.assertIn("profile-info-format-tokens", self.styles)
        filter_button = self.exchange_source.index('id="open-export-filter-dialog"')
        filter_values = self.exchange_source.index('id="export-filter-values"')
        fields_button = self.exchange_source.index('id="open-export-fields-dialog"')
        fields_values = self.exchange_source.index('id="export-selected-field-summary"')
        self.assertLess(filter_button, filter_values)
        self.assertLess(filter_values, fields_button)
        self.assertLess(fields_button, fields_values)


if __name__ == "__main__":
    unittest.main()
