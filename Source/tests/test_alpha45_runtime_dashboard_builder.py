from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import SchemaCraft as APP


ROOT = Path(__file__).resolve().parents[1]


class Alpha45RuntimeTextTests(unittest.TestCase):
    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_runtime_ui_catalog_changes_served_asset_without_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            asset = root / "index.html"
            catalog = root / "ui_text.json"
            asset.write_text("<button>إغلاق</button>", encoding="utf-8")
            catalog.write_text(json.dumps({"إغلاق": "خروج"}, ensure_ascii=False), encoding="utf-8")
            original_catalog = APP.UI_TEXT_PATH
            try:
                APP.UI_TEXT_PATH = catalog
                APP._UI_TEXT_ASSET_CACHE.clear()
                self.assertIn("خروج", APP.localized_ui_asset(asset).decode("utf-8"))
                catalog.write_text(json.dumps({"إغلاق": "إنهاء"}, ensure_ascii=False), encoding="utf-8")
                self.assertIn("إنهاء", APP.localized_ui_asset(asset).decode("utf-8"))
            finally:
                APP.UI_TEXT_PATH = original_catalog
                APP._UI_TEXT_ASSET_CACHE.clear()

    def test_frontend_build_copies_runtime_catalog(self) -> None:
        build = (ROOT / "build_frontend.py").read_text(encoding="utf-8")
        release = (ROOT / "make_user_copy.py").read_text(encoding="utf-8")
        self.assertIn('APP_DIR / "ui_text.json"', build)
        self.assertIn("ui_text.json", release)


class Alpha45PersistentHomeStatisticsTests(unittest.TestCase):
    def test_custom_statistics_round_trip_in_workspace_settings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original_path = APP.WORKSPACE_SETTINGS_PATH
            original_unlocked = APP._BUILDER_UNLOCKED
            try:
                APP.WORKSPACE_SETTINGS_PATH = Path(temporary) / "workspace-settings.json"
                APP._BUILDER_UNLOCKED = True
                payload = [{
                    "id": "stat-1",
                    "label": "الموافقات",
                    "calculation": "filled",
                    "selections": [{
                        "schemaId": "schema-1",
                        "fieldId": "field-1",
                        "values": ["نعم", "نعم", "لا"],
                    }],
                }]
                saved = APP.save_home_custom_stats({"home_custom_stats": payload})
                self.assertEqual(saved["home_custom_stats"][0]["selections"][0]["values"], ["نعم", "لا"])
                self.assertEqual(APP.read_workspace_settings()["home_custom_stats"][0]["label"], "الموافقات")
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original_path
                APP._BUILDER_UNLOCKED = original_unlocked

    def test_custom_statistics_write_requires_admin_mode(self) -> None:
        original_unlocked = APP._BUILDER_UNLOCKED
        try:
            APP._BUILDER_UNLOCKED = False
            with self.assertRaises(APP.ApplicationError):
                APP.save_home_custom_stats({"home_custom_stats": []})
        finally:
            APP._BUILDER_UNLOCKED = original_unlocked


class Alpha45FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        cls.entry = (ROOT / "app" / "src" / "pages" / "entry" / "entry.js").read_text(encoding="utf-8")
        cls.advanced = (ROOT / "app" / "src" / "core" / "advanced.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")

    def test_home_chart_and_layout_contract(self) -> None:
        self.assertIn('document.createElementNS("http://www.w3.org/2000/svg", "circle")', self.home)
        self.assertNotIn('layout.append(svg, legend)', self.home)
        self.assertIn("home-builder-stacked-bar", self.home)
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr))", self.styles)
        self.assertIn("addHomeRecordTooltips", self.home)

    def test_custom_stats_are_persisted_and_admin_controls_are_gated(self) -> None:
        self.assertIn('fetch("/api/home/custom-stats"', self.home)
        self.assertIn("state.workspaceSettings?.home_custom_stats", self.home)
        self.assertIn("builderUnlocked() && custom.length < 3", self.home)

    def test_builder_general_category_inheritance_and_collapse_contract(self) -> None:
        self.assertIn("chooseGlobalCategoryContents", self.advanced)
        self.assertIn("globalCategoryEditorParents", self.advanced)
        self.assertIn("schema.name || schema.schema_name", self.advanced)
        self.assertIn("data-collapse-builder-panel", self.events)
        self.assertIn("builder-action-rail-collapsed", self.styles)

    def test_editable_list_keeps_focus_after_value_selection(self) -> None:
        choose = self.entry.split("const chooseOption =", 1)[1].split("const renderMenu =", 1)[0]
        self.assertNotIn(".focus(", choose)
        self.assertNotIn("requestAnimationFrame", choose)
        self.assertIn('pointerdown', self.entry)


if __name__ == "__main__":
    unittest.main()
