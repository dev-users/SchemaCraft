"""Windows package declarations tested with synthetic files on Linux.

Host declarations are mocked for these tests. Native Windows execution is a
separate validation requirement; these cases prove the staged removal contract.
"""
from __future__ import annotations

from pathlib import Path
import unittest
from unittest import mock

import test_engine as fixture
engine = fixture.engine


class WindowsLauncherRetirement(unittest.TestCase):
    # Reuse only fixture setup; general regression tests run in test_engine.py.
    setUp = fixture.EngineTests.setUp
    tearDown = fixture.EngineTests.tearDown
    save_manifest = fixture.EngineTests.save_manifest
    def test_staged_launcher_retirement_keeps_original_and_verified_backup(self):
        old = self.target / "SchemaCraft.exe"
        old.write_bytes(b"synthetic historical custom launcher")
        original = engine._inventory(self.target)
        self.manifest.update(platform="windows-x86_64", obsolete_launcher_files=["SchemaCraft.exe"])
        self.save_manifest()
        with mock.patch.object(engine, "_host", return_value="windows-x86_64"):
            result = engine.apply(self.target, self.package)
        self.assertEqual(result["status"], "completed")
        self.assertFalse(old.exists())
        self.assertEqual(result["retired_launchers"], ["SchemaCraft.exe"])
        self.assertEqual(engine._inventory(Path(result["backup"])), original)
        self.assertEqual((Path(result["backup"]) / "SchemaCraft.exe").read_bytes(), b"synthetic historical custom launcher")
        journal = engine._read_json(engine.journal_path(self.target))
        self.assertEqual((Path(journal["retired"]) / "SchemaCraft.exe").read_bytes(), b"synthetic historical custom launcher")

    def test_failure_after_staged_removal_never_removes_installed_launcher(self):
        old = self.target / "SchemaCraft.exe"
        old.write_bytes(b"keep the installed custom launcher until publication")
        original = engine._inventory(self.target)
        self.manifest.update(platform="windows-x86_64", obsolete_launcher_files=["SchemaCraft.exe"])
        self.save_manifest()
        real_run = engine._run
        def fail_staged_migration(base, declared, data, report, action, *args, **kwargs):
            if "--apply" in action:
                self.assertFalse((base / "SchemaCraft.exe").exists())
                self.assertTrue(old.exists())
                raise engine.UpdateError("synthetic failure after staged launcher retirement")
            return real_run(base, declared, data, report, action, *args, **kwargs)
        with mock.patch.object(engine, "_host", return_value="windows-x86_64"), mock.patch.object(engine, "_run", fail_staged_migration):
            with self.assertRaisesRegex(engine.UpdateError, "after staged") as caught:
                engine.apply(self.target, self.package)
        self.assertEqual(engine._inventory(self.target), original)
        self.assertEqual((Path(caught.exception.backup) / "SchemaCraft.exe").read_bytes(), old.read_bytes())

    def test_obsolete_declaration_cannot_remove_data_or_arbitrary_executables(self):
        for illegal in (["data/database.xlsx"], ["vendor/python/python.exe"], ["Another.exe"],
                        ["SchemaCraft.exe", "SchemaCraft.exe"], "SchemaCraft.exe", ["../SchemaCraft.exe"]):
            with self.subTest(declaration=illegal):
                self.manifest.update(platform="windows-x86_64", obsolete_launcher_files=illegal)
                self.save_manifest()
                with mock.patch.object(engine, "_host", return_value="windows-x86_64"):
                    with self.assertRaisesRegex(engine.UpdateError, "obsolete launcher"):
                        engine.load_package(self.package)
        self.manifest.update(platform="linux-x86_64", obsolete_launcher_files=["SchemaCraft.exe"])
        self.save_manifest()
        with self.assertRaisesRegex(engine.UpdateError, "obsolete launcher"):
            engine.load_package(self.package)

    def test_retired_launcher_cannot_be_reinstalled_by_same_payload(self):
        new = self.package / "payload" / "SchemaCraft.exe"
        new.write_bytes(b"new custom launcher must not be included")
        self.manifest["files"].append({"path": "SchemaCraft.exe", "sha256": engine._hash(new),
                                       "size": new.stat().st_size, "mode": 0o644})
        self.manifest.update(platform="windows-x86_64", obsolete_launcher_files=["SchemaCraft.exe"])
        self.save_manifest()
        with mock.patch.object(engine, "_host", return_value="windows-x86_64"):
            with self.assertRaisesRegex(engine.UpdateError, "retired launcher"):
                engine.load_package(self.package)

    def test_utf8_interpreter_switches_are_literal_arguments_not_payload_paths(self):
        for key in ("application_command", "migration_command", "probe_command"):
            old = self.manifest[key]
            self.manifest[key] = [old[0], "-X", "utf8", "-B", *old[1:]]
        self.save_manifest()
        _, manifest, _ = engine.load_package(self.package)
        command = engine._command(self.package / "payload", manifest["migration_command"])
        self.assertEqual(command[1:4], ["-X", "utf8", "-B"])
        self.assertTrue(Path(command[0]).is_absolute())


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(WindowsLauncherRetirement)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
