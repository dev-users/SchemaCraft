from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import SchemaCraft as APP


ROOT = Path(__file__).resolve().parents[1]


class Alpha44FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.entry = (ROOT / "app" / "src" / "pages" / "entry" / "entry.js").read_text(encoding="utf-8")
        cls.events = (ROOT / "app" / "src" / "core" / "events.js").read_text(encoding="utf-8")
        cls.search = (ROOT / "app" / "src" / "pages" / "search" / "search.js").read_text(encoding="utf-8")
        cls.multi = (ROOT / "app" / "src" / "core" / "multischema.js").read_text(encoding="utf-8")
        cls.settings = (ROOT / "app" / "src" / "pages" / "settings" / "settings.html").read_text(encoding="utf-8")
        cls.runtime = (ROOT / "app" / "src" / "core" / "runtime.js").read_text(encoding="utf-8")
        cls.startup = (ROOT / "app" / "src" / "lifecycle" / "startup.html").read_text(encoding="utf-8")
        cls.startup_js = (ROOT / "app" / "src" / "lifecycle" / "startup.js").read_text(encoding="utf-8")
        cls.lifecycle_css = (ROOT / "app" / "src" / "lifecycle" / "lifecycle.css").read_text(encoding="utf-8")
        cls.builder = (ROOT / "app" / "src" / "pages" / "builder" / "builder.js").read_text(encoding="utf-8")
        cls.advanced = (ROOT / "app" / "src" / "core" / "advanced.js").read_text(encoding="utf-8")
        cls.field_dialog = (ROOT / "app" / "src" / "pages" / "builder" / "field-dialog.html").read_text(encoding="utf-8")
        cls.entry_html = (ROOT / "app" / "src" / "pages" / "entry" / "entry.html").read_text(encoding="utf-8")

    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_lifecycle_uses_one_chromeless_fullscreen_surface(self) -> None:
        self.assertNotIn('id="loading-panel"', self.startup)
        self.assertIn('class="lifecycle-logo startup-logo"', self.startup)
        self.assertIn('id="login-panel"', self.startup)
        self.assertNotIn("resizeForApplication", self.startup_js)
        self.assertIn('window.location.replace("/closing.html")', self.runtime)
        self.assertIn("background: transparent", self.lifecycle_css)
        self.assertIn("box-shadow: none", self.lifecycle_css)

    def test_entry_lists_and_tab_order_follow_the_new_contract(self) -> None:
        self.assertIn("control.required = field.required === true", self.entry)
        self.assertIn("dependencyTokenForControl(control)", self.entry)
        self.assertIn("typed && matches.length === 0 && dependencyReady", self.entry)
        self.assertIn("const activelyTyping", self.entry)
        self.assertIn("control._renderListMenu?.(true)", self.entry)
        self.assertIn("'button:not([disabled])'", self.entry)
        self.assertIn("'a[href]'", self.entry)
        self.assertNotIn('querySelectorAll("button, a[href]").forEach', self.entry)
        self.assertIn("[data-file-picker], [data-file-name], [data-related-tab], button, a[href]", self.events)

    def test_search_filter_selections_are_removable(self) -> None:
        self.assertIn("removeFullSearchFilter", self.search)
        self.assertIn("function removeFullSearchFilter", self.search)
        self.assertIn("removeGlobalFilterField", self.multi)
        self.assertIn("globalFilterSelectionSummary?.addEventListener", self.multi)

    def test_builder_history_limit_is_exposed(self) -> None:
        self.assertIn('id="setting-builder-history-limit"', self.settings)
        home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        self.assertIn("workspaceSettings?.builder_history_limit", home)

    def test_builder_width_import_parent_and_collapse_contracts(self) -> None:
        for width in ("1", "2", "3", "4", "5", "full"):
            self.assertIn(f'<option value="{width}">', self.field_dialog)
        self.assertIn('"في نهاية الفئة الأم"', self.builder)
        self.assertNotIn('elements.categoryKind.disabled = hasParent', self.builder)
        self.assertIn('state.categoryImportSources', self.builder)
        self.assertIn('global-field:', self.advanced)
        self.assertIn('global-category:', self.advanced)
        self.assertIn('title: "إضافة التعريف العام إلى تصميم"', self.advanced)
        self.assertIn('label: schema.name || schema.schema_name', self.advanced)
        # The schema Builder now delegates to the shared Entry-style tab preview.
        # Category collapse was superseded by main-category tabs.
        self.assertIn('renderBuilderPreview()', self.builder)
        self.assertNotIn('class="button button-icon search-collapse-button"', self.entry_html)
        self.assertNotIn('document.createElement("button");\n      toggle.className = "category-nav-toggle"', self.builder)

    def test_builder_history_describes_specific_edits(self) -> None:
        home = (ROOT / "app" / "src" / "pages" / "home" / "home.js").read_text(encoding="utf-8")
        for token in (
            'type: "conditions"',
            'type: "parent"',
            'type: "name"',
            'type: "type"',
            'تعديل إعدادات',
        ):
            self.assertIn(token, home)


class Alpha44BackendTests(unittest.TestCase):
    def test_application_window_requests_kiosk_without_size_constraints(self) -> None:
        with (
            mock.patch.object(APP, "_application_browser_candidates", return_value=[Path("browser")]),
            mock.patch.object(APP.subprocess, "Popen") as popen,
        ):
            APP.open_application_window("http://127.0.0.1:8123/startup.html", window_size=(470, 360))
        command = popen.call_args.args[0]
        self.assertIn("--kiosk", command)
        self.assertIn("--start-fullscreen", command)
        self.assertIn("--disable-background-mode", command)
        self.assertIn("--no-default-browser-check", command)
        self.assertTrue(any(argument.startswith("--user-data-dir=") for argument in command))
        self.assertFalse(any(argument.startswith("--window-size=") for argument in command))

    def test_shutdown_cookie_explicitly_logs_out(self) -> None:
        manager = APP.BrowserSessionManager()
        token = manager.create_session("مستخدم", manager.startup_token)
        self.assertEqual(
            manager.authenticated_user(f"schemacraft_session={token}"),
            "مستخدم",
        )
        manager.invalidate_all()
        self.assertEqual(manager.authenticated_user(f"schemacraft_session={token}"), "")
        self.assertIn("Max-Age=0", manager.clear_cookie_header())

    def test_builder_history_limit_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original = APP.WORKSPACE_SETTINGS_PATH
            original_unlocked = APP._BUILDER_UNLOCKED
            try:
                APP.WORKSPACE_SETTINGS_PATH = Path(temporary) / "workspace-settings.json"
                APP._BUILDER_UNLOCKED = True
                self.assertEqual(APP.read_workspace_settings()["builder_history_limit"], 20)
                saved = APP.save_workspace_settings({
                    "shortcuts": {},
                    "builder_history_limit": 37,
                })["workspace_settings"]
                self.assertEqual(saved["builder_history_limit"], 37)
                self.assertEqual(APP.read_workspace_settings()["builder_history_limit"], 37)
            finally:
                APP.WORKSPACE_SETTINGS_PATH = original
                APP._BUILDER_UNLOCKED = original_unlocked

    def test_six_unit_width_migration_and_main_child_at_parent_end(self) -> None:
        candidate = APP.default_schema()
        candidate["categories"] = [
            {
                "id": "cat_440000000001",
                "label": "الأم",
                "kind": "main",
                "fields": [{
                    "id": "fld_440000000001",
                    "label": "قديم واسع",
                    "type": "text",
                    "width": "wide",
                }],
            },
            {
                "id": "cat_440000000002",
                "label": "ابنة رئيسية",
                "kind": "main",
                "parent_category_id": "cat_440000000001",
                "parent_field_id": None,
                "fields": [{
                    "id": "fld_440000000002",
                    "label": "خمسة أجزاء",
                    "type": "text",
                    "width": "5",
                }],
            },
        ]
        normalized = APP.validate_schema(candidate)
        self.assertEqual(normalized["categories"][0]["fields"][0]["width"], "4")
        child = normalized["categories"][1]
        self.assertEqual(child["kind"], "main")
        self.assertIsNone(child["parent_field_id"])
        self.assertEqual(child["fields"][0]["width"], "5")


if __name__ == "__main__":
    unittest.main()
