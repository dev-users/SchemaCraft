from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import SchemaCraft as APP


ROOT = Path(__file__).resolve().parents[1]


class Alpha43HomeInteractionTests(unittest.TestCase):
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

    def test_custom_stat_dialog_loads_and_persists_multiple_values(self) -> None:
        for token in (
            "function loadHomeCustomStatValues",
            'values.multiple = true',
            'values.size = 4',
            'valuesLabel.textContent = "القيم المحتسبة"',
            "selectedOptions",
            'parameters.append("selected_value", value)',
            '"matching_record_count"',
        ):
            self.assertIn(token, self.home)
        self.assertIn("اختر قيمة واحدة على الأقل لكل حقل محدد", self.home)

    def test_data_tabs_select_before_navigating(self) -> None:
        handler = self.events[
            self.events.index('const dataSchemaTab = event.target.closest("[data-home-data-schema]")') :
            self.events.index('const tabDestination = event.target.closest("[data-home-tab-destination]")')
        ]
        self.assertIn('if (!dataSchemaTab.classList.contains("is-active"))', handler)
        self.assertIn("selectHomeDataSchema(schemaId)", handler)
        self.assertIn('switchActiveSchema(schemaId, { mode: "entry" })', handler)

    def test_builder_overview_shares_toggle_to_opposites(self) -> None:
        for pair in (
            '[["المتكررة", all.categories.repeated], ["الرئيسية", all.categories.main]]',
            '[["المستقلة", all.categories.independent], ["ذات فئة أم", all.categories.parented]]',
            '[["في المتكررة", all.fields.repeated], ["في الرئيسية", all.fields.main]]',
            '[["في المستقلة", all.fields.independent], ["في فئات ذات أم", all.fields.parented]]',
        ):
            self.assertIn(pair, self.home)
        self.assertIn("function updateBuilderOverviewShare", self.home)
        self.assertIn('segment.setAttribute("aria-pressed", String(!showingAlternate))', self.home)

    def test_general_field_stats_have_one_with_without_category_pair(self) -> None:
        stats = self.home[
            self.home.index("function renderBuilderStructureStats") :
            self.home.index("function builderChartValues")
        ]
        self.assertIn('["ضمن فئة", snapshot.fields.withCategory]', stats)
        self.assertEqual(stats.count('["بلا فئة", snapshot.fields.withoutCategory]'), 1)
        self.assertIn('withCategory: fields.filter((item) => item.category).length', self.home)

    def test_selected_field_values_count_matching_records_once(self) -> None:
        field = {"id": "status", "label": "الحالة", "type": "select", "options": []}
        schema = {
            "conditions": [],
            "categories": [{"id": "details", "kind": "repeatable", "fields": [field]}],
        }
        records = (
            {"values": {}, "related": {"details": [{"values": {"status": "active"}}, {"values": {"status": "active"}}]}},
            {"values": {}, "related": {"details": [{"values": {"status": "closed"}}]}},
            {"values": {}, "related": {"details": [{"values": {"status": "active"}}, {"values": {"status": "closed"}}]}},
        )
        with (
            mock.patch.object(APP, "read_schema_file", return_value=schema),
            mock.patch.object(APP, "_dataset_snapshot_unlocked", return_value=SimpleNamespace(records=records)),
        ):
            result = APP.field_value_suggestions("status", selected_values=["active"])
        self.assertEqual(result["matching_record_count"], 2)
        self.assertEqual(result["matching_value_count"], 3)


if __name__ == "__main__":
    unittest.main()
