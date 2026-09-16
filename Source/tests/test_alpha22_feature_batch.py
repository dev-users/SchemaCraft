import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import SchemaCraft as APP
from schemacraft_advanced import normalize_export_destination

ROOT = Path(__file__).resolve().parents[1]


class Alpha22FeatureBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")

    def test_release_and_official_icon(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        icon = (ROOT / "app" / "assets" / "schemacraft.ico").read_bytes()
        self.assertEqual(icon[:4], b"\x00\x00\x01\x00")
        self.assertIn('href="assets/schemacraft.ico"', self.html)

    def test_ui_text_catalog_is_build_time_editable(self) -> None:
        catalog = json.loads((ROOT / "app" / "src" / "ui_text.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(catalog), 230)
        for label in ("مسح السجل", "حقول فارغة", "حقول غير فارغة", "إنشاء التطبيق الجديد"):
            self.assertEqual(catalog[label], label)
        build = (ROOT / "build_frontend.py").read_text(encoding="utf-8")
        self.assertIn("localize_ui_text", build)

    def test_shared_search_and_export_filter_engine(self) -> None:
        manifest = (ROOT / "app" / "src" / "javascript.manifest").read_text(encoding="utf-8")
        self.assertEqual(manifest.count("core/filters.js"), 1)
        self.assertIn("renderSharedFilterControls", self.javascript)
        self.assertIn("sharedFilterCriteria", self.javascript)
        self.assertIn("data-filter-not-empty", self.javascript)
        self.assertIn('operator === "between"', self.javascript)
        self.assertIn("/api/search/field-values", self.javascript)

    def test_number_and_date_operators(self) -> None:
        number = {
            "type": "number",
            "number_behavior": {"storage": "numeric"},
            "search_match": "equals",
        }
        date = {"type": "date_gregorian", "search_match": "equals"}
        self.assertTrue(APP._field_matches(number, {"operator": "greater_than", "value": 9}, 10))
        self.assertTrue(APP._field_matches(number, {"operator": "less_or_equal", "value": 10}, 10))
        self.assertTrue(APP._field_matches(number, {"operator": "between", "value": 20, "to": 10}, 15))
        self.assertTrue(APP._field_matches(date, {"operator": "before", "value": "2026-08-28"}, "2026-08-27"))
        self.assertTrue(APP._field_matches(date, {"operator": "between", "value": "2026-08-01", "to": "2026-08-31"}, "2026-08-27"))

    def test_empty_and_not_empty_operators(self) -> None:
        field = {"type": "text", "search_match": "contains"}
        self.assertTrue(APP._field_matches(field, {"operator": "empty"}, ""))
        self.assertTrue(APP._field_matches(field, {"operator": "not_empty"}, "value"))
        self.assertFalse(APP._field_matches(field, {"operator": "not_empty"}, ""))

    def test_home_uses_six_by_six_card_coordinates(self) -> None:
        self.assertIn('class="home-dashboard home-grid-6x6"', self.html)
        self.assertIn('data-card-kind="data"', self.html)
        self.assertIn('data-card-kind="data" data-grid-x="1" data-grid-w="6"', self.html)
        self.assertIn("grid-template-columns: repeat(6, minmax(0, 1fr))", self.styles)
        self.assertIn("grid-template-rows: none !important", self.styles)
        self.assertNotIn('data-clear-history="search"', self.html)
        self.assertIn('data-home-destination="search"', self.html)

    def test_admin_only_settings_and_dialog_shortcuts(self) -> None:
        self.assertIn("elements.settingsPageButton.hidden = !unlocked", self.javascript)
        self.assertIn('enter_admin: () => elements.sessionModeBadge?.click()', self.javascript)
        self.assertIn('select_user: () => elements.auditUserBadge?.click()', self.javascript)
        self.assertEqual(APP.DEFAULT_WORKSPACE_SHORTCUT_BINDINGS["Ctrl+Q"], "close_application")
        self.assertEqual(APP.DEFAULT_WORKSPACE_SHORTCUT_BINDINGS["Ctrl+Alt+U"], "select_user")

    def test_attachment_viewer_and_readonly_navigator(self) -> None:
        for name in ("attachment-viewer.html", "attachment-viewer.css", "attachment-viewer.js"):
            self.assertTrue((ROOT / "app" / name).is_file(), name)
        self.assertIn("attachmentViewerUrl", self.javascript)
        self.assertIn('state.mode === "readonly"', self.javascript)
        self.assertIn('id = `readonly-category-${category.id}`', self.javascript)
        self.assertIn('grid-template-areas: "main navigation"', self.styles)

    def test_export_suffix_is_automatic(self) -> None:
        path = normalize_export_destination(Path("report"), [("Excel", "*.xlsx")])
        self.assertEqual(path.name, "report.xlsx")

    def test_default_app_copy_clears_records_and_histories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            schema_dir = source / "data" / "schemas" / "schema-one"
            attachments = schema_dir / "attachments"
            attachments.mkdir(parents=True)
            destination.mkdir()
            (source / "SchemaCraft.py").write_text("# app\n", encoding="utf-8")
            (source / "builder-auth.json").write_text('{"algorithm":"bcrypt"}\n', encoding="utf-8")
            (source / "data" / "workspace.json").write_text("{}\n", encoding="utf-8")
            (source / "data" / "search-history.json").write_text("[]\n", encoding="utf-8")
            (source / "data" / "audit-users.json").write_text("{}\n", encoding="utf-8")
            (source / "data" / "identity-registry.xlsx").write_bytes(b"registry")
            (schema_dir / "schema.json").write_text("{}\n", encoding="utf-8")
            (schema_dir / "records.xlsx").write_bytes(b"records")
            (attachments / "photo.png").write_bytes(b"photo")
            with mock.patch.object(APP, "BASE_DIR", source), mock.patch.object(APP, "require_builder_access"):
                result = APP.create_default_app_copy({
                    "destination": str(destination),
                    "clear_records": True,
                })
            clone = Path(result["destination"])
            self.assertTrue((clone / "data" / "schemas" / "schema-one" / "schema.json").is_file())
            self.assertFalse((clone / "data" / "schemas" / "schema-one" / "records.xlsx").exists())
            self.assertFalse((clone / "data" / "identity-registry.xlsx").exists())
            self.assertFalse((clone / "data" / "search-history.json").exists())
            self.assertFalse((clone / "data" / "audit-users.json").exists())
            self.assertTrue((clone / "builder-auth.json").is_file())

            with mock.patch.object(APP, "BASE_DIR", source), mock.patch.object(APP, "require_builder_access"):
                clear_result = APP.create_default_app_copy({
                    "destination": str(destination),
                    "clear_schema": True,
                })
            clear_clone = Path(clear_result["destination"])
            self.assertFalse((clear_clone / "data").exists())
            self.assertFalse((clear_clone / "builder-auth.json").exists())


if __name__ == "__main__":
    unittest.main()
