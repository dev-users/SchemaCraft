from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import make_user_copy as PACKAGER


ROOT = Path(__file__).resolve().parents[1]


class Alpha48ReleaseTests(unittest.TestCase):
    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_clean_package_uses_deterministic_python_copy(self) -> None:
        cli = (ROOT / "build-windows-cli.bat").read_text(encoding="utf-8")
        helper = (ROOT / "make_user_copy.py").read_text(encoding="utf-8")
        self.assertIn('make_user_copy.py --quiet', cli)
        self.assertIn("shutil.copytree", helper)
        self.assertIn("Required {kind} was not found", helper)
        self.assertNotIn("xcopy", cli.lower())

    def test_visual_builder_uses_owned_dialogs_not_message_boxes(self) -> None:
        gui = (ROOT / "build-windows-gui.py").read_text(encoding="utf-8")
        backend = (ROOT / "SchemaCraft.py").read_text(encoding="utf-8")
        self.assertNotIn("messagebox", gui)
        self.assertNotIn("MessageBoxW", backend)
        self.assertIn("def _show_dialog", gui)
        self.assertIn("tk.Toplevel(self)", gui)
        self.assertIn("dialog.overrideredirect(True)", backend)

    def test_clean_package_helper_copies_every_runtime_asset(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = root / "app"
            (app / "assets").mkdir(parents=True)
            (root / "assets" / "fonts").mkdir(parents=True)
            (root / "SchemaCraft.exe").write_bytes(b"exe")
            for name in PACKAGER.SUPPORT_FILES:
                (app / name).write_text(name, encoding="utf-8")
            (app / "assets" / "icon.ico").write_bytes(b"icon")
            (root / "assets" / "fonts" / "font.ttf").write_bytes(b"font")
            destination = root / "release" / "SchemaCraft-Windows-User"
            with (
                mock.patch.object(PACKAGER, "PROJECT_DIR", root),
                mock.patch.object(PACKAGER, "USER_RELEASE", destination),
                mock.patch.object(PACKAGER, "EXECUTABLE", root / "SchemaCraft.exe"),
                mock.patch.object(PACKAGER, "set_hidden"),
            ):
                self.assertEqual(PACKAGER.create_user_copy(), destination)
            self.assertEqual((destination / "SchemaCraft.exe").read_bytes(), b"exe")
            self.assertTrue((destination / "app" / "app.js").is_file())
            self.assertTrue((destination / "app" / "assets" / "icon.ico").is_file())
            self.assertTrue((destination / "assets" / "fonts" / "font.ttf").is_file())
            self.assertFalse((destination / "data").exists())


class Alpha48FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shell = (ROOT / "app" / "src" / "pages" / "entry" / "unsaved-dialog.html").read_text(encoding="utf-8")
        cls.foundation = (ROOT / "app" / "src" / "core" / "foundation.js").read_text(encoding="utf-8")
        cls.advanced = (ROOT / "app" / "src" / "core" / "advanced.js").read_text(encoding="utf-8")
        cls.builder_html = (ROOT / "app" / "src" / "pages" / "builder" / "builder.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "app" / "src" / "styles" / "application.css").read_text(encoding="utf-8")
        cls.frontend_sources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "app" / "src").rglob("*.js")
        )

    def test_builder_charts_occupy_separate_half_height_rows(self) -> None:
        self.assertIn("grid-template-rows: repeat(2, minmax(0, 1fr))", self.styles)
        self.assertIn(".home-builder-charts > .home-builder-chart {\n  grid-area: unset;", self.styles)
        self.assertIn(".home-builder-charts > .home-builder-chart:first-child", self.styles)
        self.assertIn(".home-builder-charts > .home-builder-chart:last-child", self.styles)
        self.assertIn("height: 100%", self.styles)
        self.assertIn(".home-builder-charts > .home-builder-chart + .home-builder-chart", self.styles)

    def test_general_builder_creation_stays_in_side_rail(self) -> None:
        self.assertNotIn('footer.className = "global-category-footer-actions"', self.advanced)
        self.assertNotIn('childList.className = "global-child-category-list"', self.advanced)
        self.assertIn('openNewFieldCategoryDialog("global")', self.advanced)
        self.assertIn("function orderedGlobalCategoryNodes", self.advanced)
        self.assertIn('id="new-global-category"', (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8"))
        self.assertIn('id="new-global-field"', (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8"))

    def test_general_conditions_match_schema_panel_structure(self) -> None:
        self.assertIn('class="builder-panel builder-conditions-panel" id="global-conditions-panel"', self.builder_html)
        self.assertIn('class="condition-list" id="global-conditions"', self.builder_html)
        self.assertIn("function renderGlobalConditions", self.advanced)

    def test_native_browser_alerts_prompts_and_confirms_are_removed(self) -> None:
        for forbidden in ("window.alert(", "window.prompt(", "window.confirm("):
            self.assertNotIn(forbidden, self.frontend_sources)
        self.assertIn('id="action-confirm-dialog"', self.shell)
        self.assertIn('id="action-selection-dialog"', self.shell)
        self.assertIn('id="action-input-dialog"', self.shell)
        self.assertIn("function requestConfirmation", self.foundation)
        self.assertIn("function requestSelection", self.foundation)
        self.assertIn("function requestText", self.foundation)


if __name__ == "__main__":
    unittest.main()
