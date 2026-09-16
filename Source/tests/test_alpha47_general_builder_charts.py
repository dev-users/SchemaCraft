from __future__ import annotations

import json
import unittest
from pathlib import Path

import SchemaCraft as APP


ROOT = Path(__file__).resolve().parents[1]


class Alpha47HomeChartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_builder_dashboard_has_two_independent_chart_slots(self) -> None:
        self.assertIn("function normalizedHomeBuilderChartSlots", self.home)
        self.assertIn('chartButton("primary")', self.home)
        self.assertIn('chartButton("secondary")', self.home)
        self.assertIn("renderHomeBuilderChart(schemaId, panel._builderSnapshot, 'primary')", self.home)
        self.assertIn("renderHomeBuilderChart(schemaId, panel._builderSnapshot, 'secondary')", self.home)
        self.assertIn("grid-template-rows: repeat(2, minmax(0, 1fr))", self.styles)

    def test_builder_bar_uses_one_stacked_bar_with_visible_percentages(self) -> None:
        self.assertIn("home-builder-stacked-bar", self.home)
        self.assertIn("home-builder-bar-percent", self.home)
        self.assertIn("percent.textContent = `${percentage}%`", self.home)
        self.assertIn("font-size: .88rem", self.styles)


class Alpha47GeneralBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.advanced = (ROOT / "app" / "src" / "core" / "advanced.js").read_text(encoding="utf-8")

    def test_general_category_uses_schema_style_tree_editor(self) -> None:
        for token in (
            "function globalCategoryTreeCard",
            'builder-category global-definition-tree-category',
            "function globalTreeFieldRow",
            "function globalPackageConditions",
            "openGlobalCategoryPackageEditor",
            "openGlobalPackageConditionEditor",
        ):
            self.assertIn(token, self.advanced)

    def test_category_package_serializes_only_internal_condition_keys(self) -> None:
        self.assertIn("const sourceFieldKey = fieldKeys.get(condition.source_field_id)", self.advanced)
        self.assertIn("if (!sourceFieldKey || !targetKey) return []", self.advanced)
        self.assertIn("function restoredGlobalCategoryConditions", self.advanced)
        self.assertIn("if (!sourceFieldId || !targetId) return []", self.advanced)


class Alpha47GlobalConditionMigrationTests(unittest.TestCase):
    def test_linked_package_conditions_remap_and_external_rules_are_omitted(self) -> None:
        global_ref = "gcat_alpha47"
        schema = {
            "categories": [
                {
                    "id": "cat_local_root",
                    "label": "الجذر المحلي",
                    "kind": "main",
                    "fields": [{
                        "id": "fld_local_source",
                        "label": "المصدر المحلي",
                        "type": "text",
                        "global_tree_ref": global_ref,
                        "global_tree_key": "source",
                    }],
                    "global_ref": global_ref,
                    "global_tree_ref": global_ref,
                    "global_tree_key": "root",
                },
                {
                    "id": "cat_local_child",
                    "label": "الابنة المحلية",
                    "kind": "main",
                    "fields": [{
                        "id": "fld_local_target",
                        "label": "الهدف المحلي",
                        "type": "text",
                        "global_tree_ref": global_ref,
                        "global_tree_key": "target",
                    }],
                    "global_tree_ref": global_ref,
                    "global_tree_key": "child",
                    "parent_category_id": "cat_local_root",
                },
            ],
            "conditions": [
                {
                    "id": "cond_old_linked",
                    "source_field_id": "fld_local_source",
                    "target_type": "field",
                    "target_id": "fld_local_target",
                    "operator": "equals",
                    "value": "قديم",
                    "global_tree_ref": global_ref,
                },
                {
                    "id": "cond_unrelated",
                    "source_field_id": "outside_source",
                    "target_type": "field",
                    "target_id": "outside_target",
                    "operator": "equals",
                    "value": "محلي",
                },
            ],
        }
        definition = {
            "category_tree": [
                {
                    "key": "root",
                    "parent_key": "",
                    "definition": {"label": "الجذر العام", "kind": "main"},
                    "fields": [{"key": "source", "definition": {"label": "المصدر", "type": "text"}}],
                },
                {
                    "key": "child",
                    "parent_key": "root",
                    "definition": {"label": "الابنة العامة", "kind": "main"},
                    "fields": [{"key": "target", "definition": {"label": "الهدف", "type": "text"}}],
                },
            ],
            "conditions": [
                {
                    "key": "inside",
                    "group_key": "group-1",
                    "source_field_key": "source",
                    "target_type": "field",
                    "target_key": "target",
                    "operator": "equals",
                    "value": "نعم",
                },
                {
                    "key": "outside",
                    "source_field_key": "source",
                    "target_type": "field",
                    "target_key": "missing-field",
                    "operator": "equals",
                    "value": "لا",
                },
            ],
        }

        self.assertTrue(APP._merge_global_category_tree(schema, definition, global_ref))
        self.assertEqual(schema["categories"][0]["label"], "الجذر العام")
        self.assertEqual(schema["categories"][1]["label"], "الابنة العامة")
        linked = [item for item in schema["conditions"] if item.get("global_tree_ref") == global_ref]
        self.assertEqual(len(linked), 1)
        self.assertEqual(linked[0]["source_field_id"], "fld_local_source")
        self.assertEqual(linked[0]["target_id"], "fld_local_target")
        self.assertEqual(linked[0]["global_condition_key"], "inside")
        self.assertTrue(any(item["id"] == "cond_unrelated" for item in schema["conditions"]))


if __name__ == "__main__":
    unittest.main()
