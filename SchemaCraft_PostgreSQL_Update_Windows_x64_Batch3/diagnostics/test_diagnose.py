import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import diagnose


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.parent = self.root / "company parent"
        self.target = self.parent / "SchemaCraft"
        self.target.mkdir(parents=True)
        key = hashlib.sha256(str(self.target.resolve()).casefold().encode()).hexdigest()[:20]
        self.work = self.parent / ".schemacraft-update-backups" / key / "failed-attempt"
        self.stage = self.work / "staged"
        self.pg = self.stage / "data/.postgresql"
        self.pg.mkdir(parents=True)
        self.updater = self.root / "updater"
        (self.updater / "vendor/python").mkdir(parents=True)
        (self.updater / "vendor/python/python.exe").write_bytes(b"fixture")
        self.journal = self.parent / f".schemacraft-update-journal-{key}.json"
        self.journal.write_text(json.dumps({"target": str(self.target), "work": str(self.work),
                                            "stage": str(self.stage), "status": "blocked"}), encoding="utf-8")

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def test_collection_is_read_only_and_redacted(self):
        secret = "PRIVATE_COMPANY_SECRET_DO_NOT_COPY"
        (self.pg / "deployment.json").write_text(json.dumps({"format_version": 1, "major": 18,
                "port": 54321, "app_password": secret, "admin_password": secret, "dsn": secret}), encoding="utf-8")
        (self.pg / "postgres.log").write_text('database system is ready to accept connections\n'
                'ERROR: INSERT INTO records VALUES (' + secret + ')\n'
                'database system is shut down\n', encoding="utf-8")
        (self.work / "migration.json").write_text(json.dumps({"status": "blocked", "activated": False,
             "issues": [{"code": "migration_setup_failed", "location": "StorageError", "message": secret}],
             "diagnostics": {"phase": "store_initialize", "exception_chain": [
                {"type": "StorageError", "message": secret, "dsn": secret},
                {"type": "OperationalError", "errno": 2, "winerror": 126, "sqlstate": "08001", "message": secret}]},
             "records": [secret]}), encoding="utf-8")
        before = self.snapshot()
        with patch.dict(os.environ, {"PGPASSWORD": secret, "PSYCOPG_IMPL": secret}):
            report = diagnose.collect(self.updater, self.journal, run_probes=False)
        self.assertEqual(before, self.snapshot())
        encoded = json.dumps(report)
        self.assertNotIn(secret, encoded)
        self.assertIn("PGPASSWORD", report["environment_variable_names"])
        self.assertIn("PSYCOPG_IMPL", report["environment_variable_names"])
        self.assertTrue(report["postgres_log"]["log_has_server_ready"])
        self.assertEqual(1, report["postgres_log"]["error_lines"])
        self.assertEqual(18, report["deployment"]["major"])
        self.assertEqual("migration.json", report["last_report_file"])
        self.assertEqual("StorageError", report["reports"][1]["exception_types"][0])
        self.assertIn({"type": "OperationalError", "errno": 2, "winerror": 126, "sqlstate": "08001"},
                      report["reports"][1]["safe_exception_diagnostics"])

    def test_ready_phrase_does_not_need_json_ready_event(self):
        path = self.pg / "postgres.log"
        path.write_bytes(b'{"event": "starting"}\ndatabase system is ready to accept connections\n'
                         b'database system is shut down\n{"event": "stopped"}\n')
        info = diagnose.inspect_log(path)
        self.assertTrue(info["log_has_server_ready"])
        self.assertFalse(info["runtime_ready_present"])
        self.assertEqual(0, info["error_lines"])

    def test_journal_path_escape_is_rejected(self):
        info = diagnose.read_json(self.journal)
        info["stage"] = str(self.root / "unrelated company data")
        with self.assertRaises(diagnose.DiagnosticError):
            diagnose.validate_workspace(self.journal, info)

    def test_compact_workspace_is_accepted_with_same_ownership(self):
        info = diagnose.read_json(self.journal)
        key = self.work.parent.name
        compact = self.parent / ".scu" / key / "failed-attempt"
        (compact / "staged").mkdir(parents=True)
        info.update(work=str(compact), stage=str(compact / "staged"))
        self.journal.write_text(json.dumps(info), encoding="utf-8")
        report = diagnose.collect(self.updater, self.journal, run_probes=False)
        self.assertEqual(".scu", report["workspace_root"])
        self.assertTrue(report["paths"]["stage"]["exists"])
        info.update(work=str(self.parent / ".scu" / ("0" * 20) / "failed-attempt"),
                    stage=str(self.parent / ".scu" / ("0" * 20) / "failed-attempt/staged"))
        with self.assertRaises(diagnose.DiagnosticError):
            diagnose.validate_workspace(self.journal, info)

    def test_junction_or_symlink_is_rejected(self):
        link = self.root / "link"
        try:
            link.symlink_to(self.pg, target_is_directory=True)
        except (NotImplementedError, OSError):
            self.skipTest("Symlink creation unavailable")
        with self.assertRaises(diagnose.DiagnosticError):
            diagnose.read_bytes(link / "deployment.json", 100)

    def test_known_dll_lengths_and_threshold(self):
        info = diagnose.driver_paths(self.root / ("a" * 150))
        crypto = next(item for item in info["files"] if item["file"].startswith("libcrypto"))
        expected = self.root / ("a" * 150) / "vendor/python/Lib/site-packages/psycopg_binary.libs" / crypto["file"]
        self.assertEqual(len(str(expected)), crypto["characters"])
        self.assertTrue(crypto["over_259_characters"])
        self.assertGreater(info["over_259_characters_count"], 0)

    def test_path_length_survives_windows_stat_failure(self):
        with patch.object(Path, "exists", side_effect=OSError(36, "private path")):
            info = diagnose.driver_paths(self.root / ("a" * 150))
        self.assertGreater(info["over_259_characters_count"], 0)
        self.assertNotIn("private path", json.dumps(info))

    def test_probe_uses_bundled_python_and_no_database_actions(self):
        class Child:
            returncode = 0
            stdout = b'{"import_ok": true, "implementation": "binary"}'
            stderr = b"secret stderr is never reported"
        with patch("diagnose.subprocess.run", return_value=Child()) as run:
            result = diagnose.probe_driver(self.updater)
        arguments = run.call_args.args[0]
        self.assertEqual(str(self.updater / "vendor/python/python.exe"), arguments[0])
        self.assertEqual(["-X", "utf8", "-B", "-c"], arguments[1:5])
        self.assertNotIn("connect(", arguments[5])
        self.assertNotIn("SchemaCraft", arguments[5])
        self.assertEqual(30, run.call_args.kwargs["timeout"])
        self.assertNotIn("secret", json.dumps(result))

    def test_malformed_fields_do_not_leak_or_crash(self):
        path = self.work / "migration.json"
        path.write_text(json.dumps({"status": {"secret": "private"}, "diagnostics":
            {"type": {"secret": "private"}, "phase": ["private"], "sqlstate": "private"}}))
        result = diagnose.inspect_json(path)
        self.assertEqual("other_or_missing", result["status"])
        self.assertNotIn("private", json.dumps(result))

    def test_new_report_only_and_no_overwrite(self):
        output = self.root / "diagnostic"
        output.mkdir()
        first = diagnose.write_report({"safe": True}, output)
        second = diagnose.write_report({"safe": False}, output)
        self.assertNotEqual(first, second)
        self.assertEqual({"safe": True}, json.loads(first.read_text()))
        self.assertEqual({"safe": False}, json.loads(second.read_text()))
        self.assertEqual(2, len(list(output.iterdir())))


if __name__ == "__main__":
    unittest.main()
