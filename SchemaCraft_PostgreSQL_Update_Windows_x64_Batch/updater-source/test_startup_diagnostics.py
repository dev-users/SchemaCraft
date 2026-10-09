"""Synthetic-only regression checks for formerly silent GUI startup failures."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import startup_support


class StartupDiagnosticsTests(unittest.TestCase):
    def test_private_tcl_paths_override_unrelated_system_python(self):
        with tempfile.TemporaryDirectory(prefix="schemacraft-startup-") as temporary:
            root = Path(temporary)
            for folder in ("tcl8.6", "tk8.6"):
                (root / "vendor/python/tcl" / folder).mkdir(parents=True)
            with patch.dict(os.environ, {"TCL_LIBRARY": "unrelated Tcl", "TK_LIBRARY": "unrelated Tk"}), \
                    patch.object(sys, "path", list(sys.path)):
                result = startup_support.configure_private_runtime(root)
                self.assertEqual(os.environ["TCL_LIBRARY"], str(root / "vendor/python/tcl/tcl8.6"))
                self.assertEqual(os.environ["TK_LIBRARY"], str(root / "vendor/python/tcl/tk8.6"))
                self.assertEqual(result["TK_LIBRARY"], os.environ["TK_LIBRARY"])
                self.assertIn(str(root), sys.path)

    def test_gui_import_failure_is_logged_without_console_or_data_access(self):
        with tempfile.TemporaryDirectory(prefix="schemacraft-startup-") as temporary:
            root = Path(temporary)
            with patch.dict(sys.modules, {"UPDATER_GUI": None}), patch.object(sys, "stdout", None), \
                    patch.object(sys, "path", list(sys.path)):
                self.assertEqual(startup_support.run_graphical(package=root), 2)
            saved = (root / "updater-startup.log").read_text(encoding="utf-8")
            self.assertIn("ModuleNotFoundError", saved)
            self.assertIn("Traceback", saved)
            self.assertIn("No installed application data was opened", saved)
            self.assertEqual([path.name for path in root.iterdir()], ["updater-startup.log"])

    def test_isolated_launcher_bootstraps_siblings_before_self_test(self):
        with tempfile.TemporaryDirectory(prefix="schemacraft-startup-") as temporary:
            root = Path(temporary)
            opposite = "linux-x86_64" if sys.platform == "win32" else "windows-x86_64"
            (root / "manifest.json").write_text(json.dumps({"platform": opposite}), encoding="utf-8")
            launcher = Path(__file__).with_name("updater_launcher.py")
            result = subprocess.run([sys.executable, "-I", "-B", str(launcher), "--startup-self-test",
                                     "--package", str(root), "--platform", opposite],
                                    capture_output=True, text=True, encoding="utf-8", timeout=20)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("Package/interpreter platform mismatch", result.stdout)
            self.assertNotIn("No module named 'startup_support'", result.stdout + result.stderr)
            self.assertTrue((root / "updater-startup.log").is_file())


if __name__ == "__main__":
    unittest.main()
