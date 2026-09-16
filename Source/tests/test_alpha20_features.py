from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import SchemaCraft as APP
from schemacraft_advanced import ImportHistoryStore

ROOT = Path(__file__).resolve().parents[1]


class Alpha20FeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        cls.javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        cls.backend = (ROOT / "SchemaCraft.py").read_text(encoding="utf-8")

    def test_release_contains_alpha20_assets(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = (ROOT / "app" / "src" / "styles.manifest").read_text(encoding="utf-8")
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        self.assertIn("styles/application.css", manifest.splitlines())
        self.assertIn("v=20260906-alpha53", self.html)

    def test_import_history_uses_local_open_not_download(self) -> None:
        self.assertIn("source.dataset.openImportSource = entry.id", self.javascript)
        self.assertIn('fetch("/api/import/history/open"', self.javascript)
        self.assertNotIn("/api/import/source/", self.javascript)
        self.assertNotIn('path.startswith("/api/import/source/")', self.backend)
        self.assertIn("def open_import_history_file", self.backend)

    def test_retained_import_file_is_opened_from_data_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            originals = {
                "IMPORT_ARCHIVE_DIR": APP.IMPORT_ARCHIVE_DIR,
                "IMPORT_HISTORY": APP.IMPORT_HISTORY,
                "DEVELOPER_MODE": APP.DEVELOPER_MODE,
                "_BUILDER_UNLOCKED": APP._BUILDER_UNLOCKED,
            }
            try:
                APP.IMPORT_ARCHIVE_DIR = root / "data" / "imported-source-files"
                APP.IMPORT_HISTORY = ImportHistoryStore(root / "data")
                APP.DEVELOPER_MODE = True
                APP._BUILDER_UNLOCKED = True
                entry = APP.IMPORT_HISTORY.append(
                    {
                        "filename": "people.xlsx",
                        "status": "success",
                        "source_archive": "entry/source.xlsx",
                    }
                )
                source = APP.IMPORT_ARCHIVE_DIR / "entry" / "source.xlsx"
                source.parent.mkdir(parents=True)
                source.write_bytes(b"saved import")
                with mock.patch.object(APP.subprocess, "Popen") as opener:
                    result = APP.open_import_history_file(entry["id"])
                self.assertEqual(result["filename"], "people.xlsx")
                if APP.os.name != "nt":
                    opener.assert_called_once()
                    self.assertEqual(Path(opener.call_args.args[0][-1]), source)
            finally:
                for name, value in originals.items():
                    setattr(APP, name, value)

    def test_global_category_controls_match_schema_builder(self) -> None:
        self.assertIn('actions.className = "builder-actions global-category-heading-actions"', self.javascript)
        self.assertIn("titleRow.append(actions)", self.javascript)
        self.assertNotIn('footer.className = "global-category-footer-actions"', self.javascript)
        self.assertIn("إضافة الفئة إلى التصميم", self.javascript)
        self.assertIn("grid-template-columns: minmax(0, 1fr) auto", self.styles)
        self.assertIn("padding: 14px 8px 14px 16px", self.styles)


if __name__ == "__main__":
    unittest.main()
