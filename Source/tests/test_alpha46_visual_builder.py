from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest import mock

import SchemaCraft as APP


ROOT = Path(__file__).resolve().parents[1]


class Alpha46VisualBuilderTests(unittest.TestCase):
    def test_release_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], "3.0.0-alpha.53")
        shell = (ROOT / "app" / "src" / "shell.html").read_text(encoding="utf-8")
        self.assertIn("v=20260906-alpha53", shell)

    def test_visual_launcher_wraps_quiet_canonical_build(self) -> None:
        wrapper = (ROOT / "build-windows.bat").read_text(encoding="utf-8")
        gui = (ROOT / "build-windows-gui.py").read_text(encoding="utf-8")
        cli = (ROOT / "build-windows-cli.bat").read_text(encoding="utf-8")
        packager = (ROOT / "make_user_copy.py").read_text(encoding="utf-8")
        frontend = (ROOT / "build_frontend.py").read_text(encoding="utf-8")
        self.assertIn("build-windows-gui.py", wrapper)
        self.assertIn('CLI_BUILD_SCRIPT = PROJECT_DIR / "build-windows-cli.bat"', gui)
        self.assertIn('"/quiet"', gui)
        self.assertIn('if /I "%~1"=="/quiet" set "QUIET=1"', cli)
        self.assertIn('make_user_copy.py --quiet', cli)
        self.assertIn("def create_user_copy()", packager)
        self.assertIn("::BEGIN_ICON_BASE64", cli)
        self.assertIn('PROJECT_DIR / "build-windows-cli.bat"', frontend)

    def test_visual_builder_has_progress_log_and_output_action(self) -> None:
        gui = (ROOT / "build-windows-gui.py").read_text(encoding="utf-8")
        self.assertIn('ttk.Progressbar(progress_card, mode="determinate", maximum=100,', gui)
        self.assertIn("self.events: queue.Queue", gui)
        self.assertIn("threading.Thread", gui)
        self.assertIn("Open output folder", gui)

    def test_user_package_hides_every_non_executable_support_item(self) -> None:
        release = (ROOT / "make-user-copy.bat").read_text(encoding="utf-8")
        packager = (ROOT / "make_user_copy.py").read_text(encoding="utf-8")
        self.assertIn("make_user_copy.py", release)
        self.assertIn("set_hidden(app_destination, True)", packager)
        self.assertIn('set_hidden(USER_RELEASE / "assets", True)', packager)
        self.assertIn("set_hidden(auth_destination, True)", packager)
        self.assertIn("set_hidden(USER_RELEASE / EXECUTABLE.name, False)", packager)


class Alpha46RuntimeVisibilityTests(unittest.TestCase):
    def test_source_tree_is_never_hidden(self) -> None:
        with mock.patch.object(APP.sys, "frozen", False, create=True), mock.patch.object(
            APP, "hide_windows_path"
        ) as hide:
            APP.hide_packaged_support_paths()
        hide.assert_not_called()

    def test_frozen_runtime_hides_support_paths_but_not_executable(self) -> None:
        with mock.patch.object(APP.sys, "frozen", True, create=True), mock.patch.object(
            APP, "hide_windows_path"
        ) as hide:
            APP.hide_packaged_support_paths()
        paths = [call.args[0] for call in hide.call_args_list]
        self.assertIn(APP.APP_DIR, paths)
        self.assertIn(APP.DATA_DIR, paths)
        self.assertIn(APP.BASE_DIR / "assets", paths)
        self.assertIn(APP.BUILDER_AUTH_PATH, paths)
        self.assertNotIn(Path(APP.sys.executable), paths)


if __name__ == "__main__":
    unittest.main()
