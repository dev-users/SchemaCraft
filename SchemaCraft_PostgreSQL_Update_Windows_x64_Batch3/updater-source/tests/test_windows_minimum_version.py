"""Minimum Windows version gating without any source or backup mutation."""
from pathlib import Path
import types
import unittest
from unittest import mock

import test_engine as fixture
engine = fixture.engine


class WindowsMinimumVersion(unittest.TestCase):
    setUp = fixture.EngineTests.setUp
    tearDown = fixture.EngineTests.tearDown
    save_manifest = fixture.EngineTests.save_manifest

    def test_old_windows_blocks_before_inventory_or_workspace_creation(self):
        self.manifest.update(platform="windows-x86_64", minimum_windows_version=[10, 0, 18362])
        self.save_manifest()
        original = engine._inventory(self.target)
        with mock.patch.object(engine, "_host", return_value="windows-x86_64"), mock.patch.object(engine, "_windows_version", return_value=(10, 0, 17763)), mock.patch.object(engine, "_inventory", side_effect=AssertionError("source was accessed")):
            with self.assertRaisesRegex(engine.UpdateError, "Windows 10 version 1903"):
                engine.apply(self.target, self.package)
        self.assertEqual(engine._inventory(self.target), original)
        self.assertFalse(engine.journal_path(self.target).exists())
        self.assertFalse((self.target.parent / ".schemacraft-update-backups").exists())

    def test_windows_11_is_accepted(self):
        self.manifest.update(platform="windows-x86_64", minimum_windows_version=[10, 0, 18362])
        self.save_manifest()
        with mock.patch.object(engine, "_host", return_value="windows-x86_64"), mock.patch.object(engine, "_windows_version", return_value=(10, 0, 26100)):
            _, manifest, _ = engine.load_package(self.package)
            self.assertEqual(engine._check_windows_version(manifest), (10, 0, 26100))

    def test_invalid_requirement_is_rejected(self):
        for invalid in (None, "10.0.18362", [10, 0], [10, 0, 18362, 0], [10, False, 18362], [10, -1, 18362], [10, 0, "18362"], (10, 0, 18362)):
            with self.subTest(requirement=invalid):
                with mock.patch.object(engine, "_windows_version", side_effect=AssertionError("invalid requirement queried OS")):
                    with self.assertRaisesRegex(engine.UpdateError, "Invalid minimum Windows version"):
                        engine._check_windows_version({"platform": "windows-x86_64", "minimum_windows_version": invalid})

    def test_absent_field_keeps_legacy_package_compatibility(self):
        with mock.patch.object(engine, "_windows_version", side_effect=AssertionError("legacy package queried OS")):
            self.assertIsNone(engine._check_windows_version({"platform": "windows-x86_64"}))

    def test_reported_version_uses_authoritative_platform_version(self):
        reported = types.SimpleNamespace(major=6, minor=2, build=9200, platform_version=(10, 0, 26100))
        with mock.patch.object(engine.sys, "getwindowsversion", return_value=reported, create=True):
            self.assertEqual(engine._windows_version(), (10, 0, 26100))


if __name__ == "__main__":
    unittest.main()
