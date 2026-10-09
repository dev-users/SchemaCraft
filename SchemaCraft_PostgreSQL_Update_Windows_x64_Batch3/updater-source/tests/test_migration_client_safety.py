"""Synthetic Windows loader-path, child environment and recovery regressions."""
import json
import os
from pathlib import Path, PureWindowsPath
import types
import unittest
from unittest import mock
import uuid

import test_engine as fixture

engine = fixture.engine


class RuntimePaths(unittest.TestCase):
    def test_company_path_keeps_full_basename_and_all_native_payloads_under_260(self):
        target = PureWindowsPath(r"C:\data entry application\2026-10-07 Schemacraft-Accounting-V2.79 - Copy")
        identifier = "7d2616f658704116b6f64082f6704479"
        manifest = json.loads((Path(__file__).resolve().parents[2] / "manifest.json").read_text(encoding="utf-8"))
        entries = {entry["path"]: entry for entry in manifest["files"]}
        with mock.patch.object(engine, "_key", return_value="b3a22305f635d63b626e"), \
                mock.patch.object(engine, "_linked", return_value=False), \
                mock.patch.object(engine.uuid, "uuid4", return_value=uuid.UUID(identifier)), \
                mock.patch.object(engine, "_host", return_value="windows-x86_64"):
            work = engine._workspace_path(target, manifest["update_id"])
            self.assertEqual(work.parts[-3:], (".scu", "b3a22305f635d63b626e", identifier))
            stage = work / ("staged-" + target.name)
            self.assertEqual(stage.name, "staged-" + target.name)
            engine._check_windows_runtime_paths(target, stage, entries)
        native = [relative for relative in entries if PureWindowsPath(relative).suffix.casefold() in {".dll", ".pyd", ".exe"}]
        self.assertTrue(any(relative.endswith(".pyd") for relative in native))
        self.assertTrue(any("psycopg_binary.libs" in relative for relative in native))
        lengths = [len(str(stage.joinpath(*relative.split("/")))) for relative in native]
        self.assertLess(max(lengths), 260)
        legacy = target.parent / ".schemacraft-update-backups" / "b3a22305f635d63b626e" / identifier / stage.name
        legacy_lengths = [len(str(legacy.joinpath(*relative.split("/")))) for relative in native]
        self.assertGreaterEqual(max(legacy_lengths), 260)

    def test_windows_native_path_boundary_and_linux_exemption(self):
        target = PureWindowsPath(r"C:\app")
        relative = "x.dll"
        for length, blocked in ((259, False), (260, True)):
            stage = PureWindowsPath("C:\\" + "a" * (length - len("C:\\") - len("\\x.dll")))
            self.assertEqual(len(str(stage / relative)), length)
            with mock.patch.object(engine, "_host", return_value="windows-x86_64"):
                if blocked:
                    with self.assertRaisesRegex(engine.UpdateError, "shorter parent folder"):
                        engine._check_windows_runtime_paths(target, stage, {relative: {}})
                else:
                    engine._check_windows_runtime_paths(target, stage, {relative: {}})
            with mock.patch.object(engine, "_host", return_value="linux-x86_64"):
                engine._check_windows_runtime_paths(target, stage, {relative: {}})


class ClientAndRecovery(unittest.TestCase):
    setUp = fixture.EngineTests.setUp
    tearDown = fixture.EngineTests.tearDown
    save_manifest = fixture.EngineTests.save_manifest

    def test_path_guard_blocks_before_backup_preflight_or_journal(self):
        original = engine._inventory(self.target)
        with mock.patch.object(engine, "_check_windows_runtime_paths", side_effect=engine.UpdateError("shorter parent folder")), \
                mock.patch.object(engine, "_copy") as copy, mock.patch.object(engine, "_run") as run:
            with self.assertRaisesRegex(engine.UpdateError, "shorter parent folder"):
                engine.apply(self.target, self.package)
        copy.assert_not_called()
        run.assert_not_called()
        self.assertEqual(engine._inventory(self.target), original)
        self.assertFalse(engine.journal_path(self.target).exists())
        self.assertFalse((self.target.parent / ".scu").exists())

    def test_recovery_accepts_new_and_legacy_root_with_both_stage_names(self):
        for root in (".scu", ".schemacraft-update-backups"):
            for stage_name in ("staged", "staged-" + self.target.name):
                with self.subTest(root=root, stage=stage_name):
                    work = self.target.parent / root / engine._key(self.target) / uuid.uuid4().hex
                    work.mkdir(parents=True)
                    journal = {"format_version": 1, "status": "blocked", "target": str(self.target),
                               "platform": engine._host(), "work": str(work), "stage": str(work / stage_name),
                               "backup": str(work / "application-backup"), "retired": str(work / "retired-installation")}
                    engine._atomic(engine.journal_path(self.target), journal)
                    self.assertEqual(engine.recover(self.target)["status"], "recovered")

    def test_recovery_refuses_links_and_wrong_key_under_both_roots(self):
        for root in (".scu", ".schemacraft-update-backups"):
            for linked in (True, False):
                with self.subTest(root=root, linked=linked):
                    key = engine._key(self.target) if linked else "different-installation"
                    work = self.target.parent / root / key / uuid.uuid4().hex
                    work.mkdir(parents=True)
                    journal = {"format_version": 1, "status": "blocked", "target": str(self.target),
                               "platform": engine._host(), "work": str(work), "stage": str(work / "staged"),
                               "backup": str(work / "application-backup"), "retired": str(work / "retired-installation")}
                    if linked:
                        (work / "staged").symlink_to(self.target, target_is_directory=True)
                    engine._atomic(engine.journal_path(self.target), journal)
                    with self.assertRaisesRegex(engine.UpdateError, "Unsafe recovery"):
                        engine._validated_journal(self.target)

    def run_report(self, result, returncode=0):
        report = self.root / "child-report.json"
        def spawn(command, **kwargs):
            report.write_text(json.dumps(result), encoding="utf-8")
            return types.SimpleNamespace(poll=lambda: returncode, returncode=returncode)
        with mock.patch.object(engine.subprocess, "Popen", side_effect=spawn) as process:
            value = engine._run(self.package / "payload", ["vendor/runner"], self.target / "data", report, ["--verify-only"])
        return value, process.call_args.kwargs["env"]

    def test_child_environment_is_case_insensitive_and_parent_unchanged(self):
        poisons = {"PGSERVICE": "private-service", "pgSslMode": "require", "PgGssEncMode": "require",
                   "PSYCOPG_IMPL": "c", "psycopg_impl": "python", "PYTHONPATH": "private-python",
                   "pythonhome": "private-home", "schemacraft_postgres_dev": "1", "KEEP_SYNTHETIC": "kept"}
        with mock.patch.dict(os.environ, poisons):
            before = dict(os.environ)
            _, child = self.run_report({"status": "verified_source"})
            self.assertEqual(dict(os.environ), before)
        self.assertFalse(any(key.upper().startswith("PG") for key in child))
        for key in poisons:
            if key != "KEEP_SYNTHETIC":
                self.assertNotIn(key, child)
        self.assertEqual(child["KEEP_SYNTHETIC"], "kept")
        self.assertEqual(child["PYTHONNOUSERSITE"], "1")
        self.assertEqual(child["PYTHONDONTWRITEBYTECODE"], "1")

    def test_structured_error_surfaces_categories_without_private_values(self):
        secret = "PRIVATE_COMPANY_VALUE_MUST_NOT_APPEAR"
        result = {"status": "blocked", "issues": [{"code": "preflight_or_storage_error", "location": secret,
                  "stage": "target_initialization", "operation": "store.initialize",
                  "diagnostic": {"exception_type": "StorageError", "root_cause_type": "ImportError",
                                 "validation_code": "driver_unavailable", "message": secret,
                                 "cause_chain": [{"message": secret, "traceback": [{"filename": secret}]}]}}]}
        with self.assertRaises(engine.UpdateError) as caught:
            self.run_report(result, returncode=2)
        message = str(caught.exception)
        for value in ("target_initialization", "store.initialize", "driver_unavailable", "ImportError"):
            self.assertIn(value, message)
        self.assertNotIn(secret, message)
        self.assertTrue(Path(caught.exception.report).is_file())
        result["issues"][0].update(stage=secret, operation=secret)
        result["issues"][0]["diagnostic"].update(root_cause_type=secret, validation_code=secret, errno=secret)
        self.assertNotIn(secret, engine._migration_failure_summary(result))


if __name__ == "__main__":
    unittest.main()
