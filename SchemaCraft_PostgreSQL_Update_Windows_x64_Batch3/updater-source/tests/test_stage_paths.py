"""Synthetic staging names and strict backward-compatible journal recovery."""
import errno
from pathlib import Path
import unittest
from unittest import mock

import test_engine as fixture
engine = fixture.engine


class StagePaths(unittest.TestCase):
    setUp = fixture.EngineTests.setUp
    tearDown = fixture.EngineTests.tearDown
    save_manifest = fixture.EngineTests.save_manifest

    def test_migration_and_restart_probe_stage_preserves_target_basename(self):
        renamed = self.root / "SchemaCraft العربية !&"
        self.target.rename(renamed)
        self.target = renamed
        calls = []
        run = engine._run
        def record(base, *args, **kwargs):
            if base != self.package / "payload":
                calls.append(base.name)
            return run(base, *args, **kwargs)
        with mock.patch.object(engine, "_run", record):
            result = engine.apply(self.target, self.package)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(calls, ["staged-" + self.target.name] * 3)
        journal = engine._read_json(engine.journal_path(self.target))
        self.assertEqual(Path(journal["stage"]).name, "staged-" + self.target.name)

    def test_recovery_accepts_legacy_literal_staged_folder(self):
        replace = engine.os.replace
        def interrupted(source, destination):
            if Path(source).name == "staged-" + self.target.name and Path(destination) == self.target:
                raise OSError("synthetic interruption")
            return replace(source, destination)
        with mock.patch.object(engine.os, "replace", interrupted):
            with self.assertRaises(OSError):
                engine.apply(self.target, self.package)
        path = engine.journal_path(self.target)
        journal = engine._read_json(path)
        legacy = Path(journal["work"]) / "staged"
        Path(journal["stage"]).rename(legacy)
        journal["stage"] = str(legacy)
        engine._atomic(path, journal)
        result = engine.recover(self.target)
        self.assertEqual(result["status"], "completed")

    def test_recovery_rejects_different_target_derived_stage(self):
        engine.apply(self.target, self.package)
        path = engine.journal_path(self.target)
        journal = engine._read_json(path)
        original = engine._inventory(self.target)
        for invalid in ("staged-another-app", "staged-../other", "other"):
            with self.subTest(name=invalid):
                journal.update(status="ready", stage=str(Path(journal["work"]) / invalid))
                engine._atomic(path, journal)
                with self.assertRaisesRegex(engine.UpdateError, "Unsafe recovery directory"):
                    engine.recover(self.target)
                self.assertEqual(engine._inventory(self.target), original)

    def test_too_long_stage_blocks_after_verified_backup_without_source_change(self):
        original = engine._inventory(self.target)
        copy = engine._copy
        def fail_stage(source, destination, *args, **kwargs):
            if destination.name == "staged-" + self.target.name:
                raise OSError(errno.ENAMETOOLONG, "synthetic filesystem component limit")
            return copy(source, destination, *args, **kwargs)
        with mock.patch.object(engine, "_copy", fail_stage):
            with self.assertRaisesRegex(engine.UpdateError, "staging path is too long") as caught:
                engine.apply(self.target, self.package)
        self.assertEqual(engine._inventory(self.target), original)
        self.assertEqual(engine._inventory(Path(caught.exception.backup)), original)
        self.assertEqual(engine._read_json(engine.journal_path(self.target))["status"], "blocked")

    def test_workspace_uses_short_uuid_and_retains_full_update_id_in_journal(self):
        self.manifest["update_id"] = "meaningful-release-" + "x" * 75
        self.save_manifest()
        result = engine.apply(self.target, self.package)
        self.assertRegex(Path(result["work"]).name, r"^[0-9a-f]{32}$")
        journal = engine._read_json(engine.journal_path(self.target))
        self.assertEqual(journal["update_id"], self.manifest["update_id"])


if __name__ == "__main__":
    unittest.main()
