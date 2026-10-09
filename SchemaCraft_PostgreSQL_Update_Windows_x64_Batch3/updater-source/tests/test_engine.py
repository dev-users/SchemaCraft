"""Synthetic updater tests: company data is never used by these cases."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import tempfile
import unittest
from unittest import mock

MODULE = Path(__file__).resolve().parents[1] / "core" / "engine.py"
SPEC = importlib.util.spec_from_file_location("migration_update_engine", MODULE)
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)


FAKE_APP = '''#!/usr/bin/env python3
import hashlib,json,pathlib,sys
args=sys.argv[1:]
root=pathlib.Path(args[args.index('--data-dir')+1])
output=pathlib.Path(args[args.index('--report')+1])
def signature():
    value={}
    for p in sorted(root.rglob('*')):
        if p.is_file() and '.postgresql' not in p.relative_to(root).parts and p.name!='storage.json':
            value[p.relative_to(root).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
logical=hashlib.sha256(b'synthetic-lossless-records').hexdigest()
snapshot=hashlib.sha256(b'synthetic-lossless-snapshot').hexdigest()
if '--storage-probe' in args:
    report={'status':'verified_backend','backend':'managed-postgresql','readback_verified':True,
        'logical_sha256':logical,'snapshot_sha256':snapshot,'records':2,'schemas':1}
elif (root/'BLOCK').exists():
    report={'status':'blocked','activated':False,'issues':[{'code':'synthetic_problem','location':'workbook.xlsx'}]}
    output.write_text(json.dumps(report));sys.exit(2)
else:
    report={'status':'verified_source','activated':False,'logical_sha256':logical,'source_sha256':signature()}
    if '--apply' in args:
        pg=root/'.postgresql';pg.mkdir(exist_ok=True)
        (pg/'deployment.json').write_text('{"format_version":1,"major":18}')
        (pg/'cluster').mkdir(exist_ok=True)
        (pg/'cluster'/'PG_VERSION').write_text('18')
        (root/'storage.json').write_text('{"backend":"managed-postgresql","version":1}')
        report.update(status='activated',activated=True,readback_verified=True)
output.write_text(json.dumps(report))
'''


@unittest.skipIf(os.name == "nt", "Synthetic executable uses a Linux shebang; Windows package is validated natively separately.")
class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="schemacraft-updater-synthetic-")
        self.root = Path(self.temp.name)
        self.target = self.root / "Installed SchemaCraft"
        self.target.mkdir()
        (self.target / "SchemaCraft.py").write_text("# synthetic previous application\n")
        (self.target / "data").mkdir()
        (self.target / "data" / "workbook.xlsx").write_bytes(b"synthetic Excel content, Arabic and dates represented by the real migration test suite")
        (self.target / "data" / "attachments").mkdir()
        (self.target / "data" / "attachments" / "document.txt").write_text("synthetic attachment")
        (self.target / "data" / "workspace.json").write_text('{"synthetic":true}')
        (self.target / "builder-auth.json").write_text("synthetic private credential")
        (self.target / "app").mkdir()
        (self.target / "app" / "ui_text.json").write_text('{"custom":"operator wording"}')
        self.package = self.root / "Update Package"
        payload = self.package / "payload"
        (payload / "vendor").mkdir(parents=True)
        (payload / "app").mkdir()
        (payload / "vendor" / "runner").write_text(FAKE_APP)
        (payload / "vendor" / "runner").chmod(0o755)
        (payload / "SchemaCraft.py").write_text("# synthetic PostgreSQL application\n")
        (payload / "app" / "ui_text.json").write_text('{"custom":"shipped default"}')
        self.entries = []
        for p in sorted(payload.rglob("*")):
            if p.is_file():
                self.entries.append({"path": p.relative_to(payload).as_posix(), "sha256": engine._hash(p),
                                     "size": p.stat().st_size, "mode": 0o755 if p.name == "runner" else 0o644})
        self.manifest = {"format_version": 1, "update_id": "synthetic-migration", "platform": engine._host(),
                         "files": self.entries, "application_command": ["vendor/runner"],
                         "migration_command": ["vendor/runner", "--migrate-storage"],
                         "probe_command": ["vendor/runner", "--storage-probe"]}
        self.save_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def save_manifest(self):
        (self.package / "manifest.json").write_text(json.dumps(self.manifest))

    def test_preflight_is_read_only_and_writes_report_outside_installation(self):
        original = engine._inventory(self.target)
        result = engine.check(self.target, self.package)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(engine._inventory(self.target), original)
        self.assertFalse(Path(result["report"]).is_relative_to(self.target))

    def test_verified_excel_cutover_preserves_every_original_and_custom_wording(self):
        original = engine._inventory(self.target)
        result = engine.apply(self.target, self.package)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(engine._inventory(Path(result["backup"])), original)
        self.assertEqual(engine._workspace_files(engine._inventory(self.target)), engine._workspace_files(original))
        self.assertEqual((self.target / "builder-auth.json").read_text(), "synthetic private credential")
        self.assertEqual((self.target / "app" / "ui_text.json").read_text(), '{"custom":"operator wording"}')
        self.assertEqual(engine._backend(self.target), "managed-postgresql")
        self.assertEqual(engine._read_json(engine.journal_path(self.target))["status"], "completed")

    def test_blocked_source_never_changes_installation_and_exposes_report(self):
        (self.target / "data" / "BLOCK").write_text("synthetic blocked source")
        original = engine._inventory(self.target)
        with self.assertRaises(engine.UpdateError) as caught:
            engine.apply(self.target, self.package)
        self.assertTrue(Path(caught.exception.report).is_file())
        self.assertEqual(engine._inventory(self.target), original)
        self.assertEqual(engine._read_json(engine.journal_path(self.target))["status"], "blocked")

    def test_payload_tampering_fails_before_source_or_journal_mutation(self):
        (self.package / "payload" / "SchemaCraft.py").write_text("tampered")
        original = engine._inventory(self.target)
        with self.assertRaisesRegex(engine.UpdateError, "checksum"):
            engine.apply(self.target, self.package)
        self.assertEqual(engine._inventory(self.target), original)
        self.assertFalse(engine.journal_path(self.target).exists())

    def test_data_payload_and_traversal_case_collision_refused(self):
        for unsafe in ("data/workbook.xlsx", "../outside.py", "vendor/CON.exe", "vendor/a:stream", "vendor/runner."):
            with self.subTest(unsafe=unsafe):
                self.manifest["files"] = self.entries + [{**self.entries[0], "path": unsafe}]
                self.save_manifest()
                with self.assertRaises(engine.UpdateError):
                    engine.load_package(self.package)
        self.manifest["files"] = self.entries + [{**self.entries[0], "path": self.entries[0]["path"].upper()}]
        self.save_manifest()
        with self.assertRaisesRegex(engine.UpdateError, "case-colliding"):
            engine.load_package(self.package)

    def test_other_platform_refused(self):
        self.manifest["platform"] = "windows-x86_64"
        self.save_manifest()
        with self.assertRaisesRegex(engine.UpdateError, "operating system"):
            engine.check(self.target, self.package)

    def test_symlinked_data_and_payload_refused(self):
        real_data = self.target / "original-data"
        (self.target / "data").rename(real_data)
        (self.target / "data").symlink_to(real_data, target_is_directory=True)
        with self.assertRaisesRegex(engine.UpdateError, "Linked data"):
            engine.check(self.target, self.package)

    def test_external_venv_link_preserved_without_following(self):
        private_external = self.root / "external-interpreter"
        private_external.write_text("synthetic external executable")
        (self.target / "python-link").symlink_to(private_external)
        result = engine.apply(self.target, self.package)
        self.assertTrue((self.target / "python-link").is_symlink())
        self.assertTrue((Path(result["backup"]) / "python-link").is_symlink())
        self.assertEqual(private_external.read_text(), "synthetic external executable")

    def test_already_postgres_skips_excel_reimport_preserves_cluster(self):
        pg = self.target / "data" / ".postgresql"
        pg.mkdir()
        (pg / "deployment.json").write_text('{"format_version":1,"major":18}')
        (pg / "cluster").mkdir()
        (pg / "cluster").chmod(0o700)
        (pg / "cluster" / "PG_VERSION").write_text("18")
        (self.target / "data" / "storage.json").write_text('{"backend":"managed-postgresql"}')
        (self.target / "data" / "BLOCK").write_text("historical Excel deliberately must not be imported")
        result = engine.apply(self.target, self.package)
        self.assertEqual(result["status"], "completed")
        self.assertTrue((self.target / "data" / "BLOCK").exists())
        self.assertFalse((Path(result["work"]) / "migration.json").exists())
        self.assertTrue((Path(result["work"]) / "probe-before-install.json").is_file())
        self.assertEqual(stat.S_IMODE((self.target / "data" / ".postgresql" / "cluster").stat().st_mode), 0o700)

    def test_private_runtime_replacement_removes_old_unlisted_modules_only_in_stage(self):
        runtime = self.target / "vendor" / "python"
        runtime.mkdir(parents=True)
        (runtime / "old-unlisted-module.py").write_text("old interpreter module")
        payload_runtime = self.package / "payload" / "vendor" / "python"
        payload_runtime.mkdir()
        new_file = payload_runtime / "new-runtime.txt"
        new_file.write_text("sealed replacement runtime")
        self.manifest["files"].append({"path": "vendor/python/new-runtime.txt", "sha256": engine._hash(new_file),
                                       "size": new_file.stat().st_size, "mode": 0o644})
        self.save_manifest()
        result = engine.apply(self.target, self.package)
        self.assertFalse((runtime / "old-unlisted-module.py").exists())
        self.assertEqual((runtime / "new-runtime.txt").read_text(), "sealed replacement runtime")
        self.assertEqual((Path(result["backup"]) / "vendor" / "python" / "old-unlisted-module.py").read_text(), "old interpreter module")

    def test_unlisted_payload_file_is_refused_before_backup(self):
        (self.package / "payload" / "vendor" / "unexpected-module.py").write_text("unlisted")
        with self.assertRaisesRegex(engine.UpdateError, "unlisted"):
            engine.apply(self.target, self.package)
        self.assertFalse(engine.journal_path(self.target).exists())

    def test_missing_pg_deployment_blocks_and_retains_source(self):
        (self.target / "data" / "storage.json").write_text('{"backend":"managed-postgresql"}')
        original = engine._inventory(self.target)
        with self.assertRaisesRegex(engine.UpdateError, "deployment identity"):
            engine.apply(self.target, self.package)
        self.assertEqual(engine._inventory(self.target), original)

    def test_open_database_pid_blocks(self):
        cluster = self.target / "data" / ".postgresql" / "cluster"
        cluster.mkdir(parents=True)
        (cluster / "postmaster.pid").write_text(str(os.getpid()) + "\n")
        with self.assertRaisesRegex(engine.UpdateError, "PostgreSQL server"):
            engine.check(self.target, self.package)

    def test_real_application_listener_blocks(self):
        folder_hash = hashlib.sha256(str(self.target).casefold().encode()).digest()
        port = 51000 + int.from_bytes(folder_hash[:2], "big") % 10000
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", port))
            listener.listen()
            with self.assertRaisesRegex(engine.UpdateError, "application server"):
                engine.check(self.target, self.package)

    def test_lock_uses_os_ownership_and_stale_file_does_not_block(self):
        engine.lock_path(self.target).write_bytes(b"stale file")
        with engine._locked(self.target):
            with self.assertRaisesRegex(engine.UpdateError, "Another update"):
                with engine._locked(self.target):
                    self.fail("a second updater acquired the active lock")
        self.assertEqual(engine.check(self.target, self.package)["status"], "verified")

    def test_original_change_during_preflight_blocks_without_overwrite(self):
        real_run = engine._run
        def run_then_edit(*args, **kwargs):
            result = real_run(*args, **kwargs)
            (self.target / "data" / "workbook.xlsx").write_bytes(b"concurrent business edit")
            return result
        with mock.patch.object(engine, "_run", run_then_edit):
            with self.assertRaisesRegex(engine.UpdateError, "changed during preflight"):
                engine.check(self.target, self.package)
        self.assertEqual((self.target / "data" / "workbook.xlsx").read_bytes(), b"concurrent business edit")
        self.assertEqual((self.target / "SchemaCraft.py").read_text(), "# synthetic previous application\n")

    def test_interrupted_publish_recovers_verified_stage(self):
        replace = engine.os.replace
        def interrupted(source, destination):
            if Path(source).name == "staged-" + self.target.name and Path(destination) == self.target:
                raise OSError("synthetic interruption during second rename")
            return replace(source, destination)
        with mock.patch.object(engine.os, "replace", interrupted):
            with self.assertRaises(OSError):
                engine.apply(self.target, self.package)
        self.assertFalse(self.target.exists())
        result = engine.recover(self.target)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(engine._backend(self.target), "managed-postgresql")

    def test_damaged_unpublished_stage_restores_unchanged_original(self):
        original = engine._inventory(self.target)
        replace = engine.os.replace
        def interrupted(source, destination):
            if Path(source).name == "staged-" + self.target.name and Path(destination) == self.target:
                raise OSError("synthetic interruption")
            return replace(source, destination)
        with mock.patch.object(engine.os, "replace", interrupted):
            with self.assertRaises(OSError):
                engine.apply(self.target, self.package)
        journal = engine._read_json(engine.journal_path(self.target))
        (Path(journal["stage"]) / "data" / "workbook.xlsx").write_bytes(b"damaged staged workbook")
        result = engine.recover(self.target)
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(engine._inventory(self.target), original)

    def test_published_new_data_is_never_rolled_back_after_journal_failure(self):
        atomic = engine._atomic
        def interrupted(path, value):
            if Path(path) == engine.journal_path(self.target) and value.get("status") == "published":
                raise OSError("synthetic journal write failure after new installation exists")
            return atomic(path, value)
        with mock.patch.object(engine, "_atomic", interrupted):
            with self.assertRaises(OSError):
                engine.apply(self.target, self.package)
        (self.target / "data" / "new-business-edit.json").write_text("must survive")
        result = engine.recover(self.target)
        self.assertEqual(result["status"], "completed")
        self.assertEqual((self.target / "data" / "new-business-edit.json").read_text(), "must survive")

    def test_completed_update_cannot_be_automatically_downgraded(self):
        engine.apply(self.target, self.package)
        (self.target / "data" / "new-business-edit.json").write_text("must survive")
        with self.assertRaisesRegex(engine.UpdateError, "downgrade"):
            engine.recover(self.target)
        self.assertEqual((self.target / "data" / "new-business-edit.json").read_text(), "must survive")

    def test_missing_stage_and_target_cannot_restore_historical_data_after_possible_publication(self):
        replace = engine.os.replace
        def interrupted(source, destination):
            if Path(source).name == "staged-" + self.target.name and Path(destination) == self.target:
                raise OSError("synthetic interruption")
            return replace(source, destination)
        with mock.patch.object(engine.os, "replace", interrupted):
            with self.assertRaises(OSError):
                engine.apply(self.target, self.package)
        journal = engine._read_json(engine.journal_path(self.target))
        shutil = __import__("shutil")
        shutil.rmtree(journal["stage"])
        with self.assertRaisesRegex(engine.UpdateError, "may already have been published"):
            engine.recover(self.target)
        self.assertFalse(self.target.exists())
        self.assertTrue(Path(journal["retired"]).is_dir())

    def test_backup_or_recovery_path_cannot_escape_installation_parent(self):
        engine.apply(self.target, self.package)
        journal_path = engine.journal_path(self.target)
        journal = engine._read_json(journal_path)
        journal.update(status="original_moved", work=str(self.root / "other-company-data"))
        engine._atomic(journal_path, journal)
        with self.assertRaisesRegex(engine.UpdateError, "Unsafe recovery"):
            engine.recover(self.target)


if __name__ == "__main__":
    unittest.main()
