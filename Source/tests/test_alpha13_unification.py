from __future__ import annotations

import copy
import json
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

import SchemaCraft as APP

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_backend import configured_schema, field

ROOT = Path(__file__).resolve().parents[1]


class _ElementIndex(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.by_id: dict[str, tuple[str, dict[str, str]]] = {}
        self.tables: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name: value or "" for name, value in attrs}
        if attributes.get("id"):
            self.by_id[attributes["id"]] = (tag, attributes)
        if tag == "table":
            self.tables.append(attributes)


class Alpha13UnificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.parser = _ElementIndex()
        cls.parser.feed(cls.index_html)

    def test_release_and_generated_assets_include_alpha13(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8").splitlines())
        self.assertIn("Shared component primitives and large-data bounds", self.styles)
        self.assertIn("v=20260906-alpha53", self.index_html)

    def test_every_field_or_filter_picker_uses_the_shared_tree_dialog(self) -> None:
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
        for dialog_id in picker_ids:
            tag, attributes = self.parser.by_id[dialog_id]
            self.assertEqual(tag, "dialog")
            self.assertIn("selection-tree-dialog", attributes.get("class", ""), dialog_id)
        self.assertGreaterEqual(self.index_html.count("selection-dialog-toolbar"), len(picker_ids))
        self.assertIn("details:not([open])", self.styles)

    def test_all_tables_use_one_visual_contract(self) -> None:
        self.assertGreaterEqual(len(self.parser.tables), 5)
        for table in self.parser.tables:
            self.assertIn("data-table", table.get("class", ""))
        self.assertIn(".data-table th", self.styles)
        self.assertIn(".history-action-buttons", self.styles)
        self.assertIn('className = "history-actions-cell"', self.javascript)
        self.assertIn("document.createDocumentFragment()", self.javascript)

    def test_shared_panels_rails_summaries_and_builder_cards_are_present(self) -> None:
        for class_name in (
            "action-rail-card",
            "workflow-status",
            "selection-summary-card",
            "secondary-segmented-tabs",
            "builder-summary-panel",
            "empty-state-compact",
        ):
            self.assertIn(class_name, self.index_html)
            self.assertIn(f".{class_name}", self.styles)
        self.assertIn("builder-category global-definition-card", self.javascript)
        self.assertIn("builder-field-row global-category-field-row", self.javascript)

    def test_large_schema_with_tens_of_fields_and_hundreds_of_values_validates(self) -> None:
        schema = copy.deepcopy(configured_schema())
        schema["app"]["search_page_size"] = 10_000
        category = schema["categories"][0]
        for field_index in range(32):
            category["fields"].append(
                field(
                    f"fld_{0x100 + field_index:012x}",
                    f"حقل واسع {field_index + 1}",
                    "select",
                    searchable=True,
                    show=field_index < 8,
                    options=[f"قيمة {field_index + 1}-{option_index + 1}" for option_index in range(300)],
                )
            )

        validated = APP.validate_schema(schema)
        validated_category = validated["categories"][0]
        wide_fields = [item for item in validated_category["fields"] if item["id"].startswith("fld_0000000001")]
        self.assertEqual(len(wide_fields), 32)
        self.assertTrue(all(len(item["options"]) == 300 for item in wide_fields))
        self.assertEqual(validated["app"]["search_page_size"], 100)
        last_option = wide_fields[-1]["options"][-1]
        self.assertEqual(APP.field_display_value(wide_fields[-1], last_option["id"]), last_option["label"])

    def test_large_data_ui_has_bounded_native_controls_and_viewports(self) -> None:
        self.assertIn("Math.min(6, Math.max(2", self.javascript)
        self.assertIn("select.multiple = true", self.javascript)
        self.assertIn("max-height: 240px", self.styles)
        self.assertIn("max-height: min(62vh, 640px)", self.styles)
        self.assertIn("max-height: min(38vh, 380px)", self.styles)
        self.assertIn("scrollbar-gutter: stable", self.styles)
        self.assertIn("contain-intrinsic-size: 64px", self.styles)


if __name__ == "__main__":
    unittest.main()
