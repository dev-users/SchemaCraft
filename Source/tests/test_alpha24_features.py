from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from test_feature_batch import CHILD, CHILD_NAME, PARENT, PARENT_NAME, schema

import SchemaCraft as APP

ROOT = Path(__file__).resolve().parents[1]


class Alpha24FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.builder_source = (
            ROOT / "app" / "src" / "pages" / "builder" / "builder.js"
        ).read_text(encoding="utf-8")
        cls.exchange_source = (
            ROOT / "app" / "src" / "pages" / "exchange" / "exchange.js"
        ).read_text(encoding="utf-8")

    def test_release_and_cache_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("v=20260906-alpha53", self.html)

    def test_home_cards_are_collapsible_and_data_uses_three_columns(self) -> None:
        self.assertNotIn("data-home-card-toggle", self.html)
        self.assertIn('data-card-kind="builder"', self.html)
        alpha24 = self.styles.index("Alpha 24")
        final_styles = self.styles[alpha24:]
        self.assertIn('grid-template-areas: "history gauge bar"', final_styles)
        self.assertIn(".home-dashboard-card.is-collapsed", final_styles)
        self.assertIn('event.target.closest(".home-dashboard-card")', self.javascript)
        self.assertIn("renderHomeBuilderDashboard", self.javascript)
        self.assertIn("describeBuilderChanges", self.javascript)
        self.assertNotIn("remove.dataset.removeRecentRecord", self.javascript)

    def test_search_export_and_profile_result_chips_are_removable(self) -> None:
        for token in (
            "data-remove-full-search-column",
            "data-remove-global-result-field",
            "data-remove-export-result-field",
            "data-remove-profile-export-field",
        ):
            self.assertIn(token, self.javascript)
        history_panel = self.html.index("search-history-results-panel")
        clear_button = self.html.index('id="clear-search-history"')
        self.assertGreater(clear_button, history_panel)

    def test_entry_id_copy_category_collapse_and_focus_contract(self) -> None:
        self.assertIn("control.dataset.copySystemRecordCode", self.javascript)
        self.assertIn("setEntryCategoryCollapsed", self.javascript)
        self.assertIn("activateEntryCategoryForControl", self.javascript)
        self.assertIn("focusAdjacentEntryField", self.javascript)
        self.assertNotIn("data-calendar-compact", self.javascript)
        self.assertIn('event.key !== "-"', self.javascript)
        self.assertIn(".entry-category-collapsed", self.styles)

    def test_import_defaults_and_builder_controls(self) -> None:
        self.assertIn('column.suggested_target || "__ignore__"', self.exchange_source)
        self.assertIn("function ignoreAllImportFields", self.exchange_source)
        self.assertIn('id="ignore-all-import-fields"', self.html)
        self.assertIn('id="builder-sidebar-add-field-button"', self.html)
        self.assertNotIn(
            '<option value="checkbox_group">مجموعة مربعات اختيار</option>',
            self.html,
        )
        self.assertIn("category.parent_field_id", self.builder_source)
        self.assertIn("category.card_name_prefix", self.builder_source)

    def test_schema_preserves_parent_field_prefix_and_nonrequired_last_editor(self) -> None:
        candidate = schema()
        candidate["categories"][2]["parent_field_id"] = PARENT_NAME
        candidate["categories"][2]["card_name_prefix"] = "my_card"
        current_user = candidate["categories"][0]["fields"][2]
        current_user["required"] = True
        validated = APP.validate_schema(candidate)
        child = next(item for item in validated["categories"] if item["id"] == CHILD)
        self.assertEqual(child["parent_field_id"], PARENT_NAME)
        self.assertEqual(child["card_name_prefix"], "my_card")
        normalized_user = validated["categories"][0]["fields"][2]
        self.assertFalse(normalized_user["required"])

    def test_cross_repeatable_auto_update_uses_first_matching_source_card(self) -> None:
        candidate = copy.deepcopy(schema())
        child = next(item for item in candidate["categories"] if item["id"] == CHILD)
        child["parent_field_id"] = PARENT_NAME
        child["fields"][0]["auto_update"] = {
            "source_field_id": PARENT_NAME,
            "operator": "not_empty",
            "value": "",
            "action": "copy_source",
            "result_value": "",
        }
        validated = APP.validate_schema(candidate)
        related = {
            PARENT: [
                {"values": {PARENT_NAME: "المصدر الأول"}},
                {"values": {PARENT_NAME: "المصدر الثاني"}},
            ],
            CHILD: [{"values": {CHILD_NAME: ""}}],
        }
        APP.apply_auto_update_rules(validated, {}, related, "محرر")
        self.assertEqual(
            related[CHILD][0]["values"][CHILD_NAME],
            "المصدر الأول",
        )


if __name__ == "__main__":
    unittest.main()
