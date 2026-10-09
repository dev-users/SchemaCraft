"""Real offline-package migration tests, using synthetic fixtures only."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve()
BUILD = HERE.parents[1]
APP_ROOT = HERE.parents[4] / "App"
sys.path[:0] = [str(APP_ROOT), str(APP_ROOT / "tests")]
from test_storage_migration import MigrationFixture

spec = importlib.util.spec_from_file_location("offline_update_engine", BUILD / "core" / "engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def assert_equal(left, right, label):
    if left != right:
        raise AssertionError(label)


def make_target(root, fixture, name):
    target = root / name
    target.mkdir()
    shutil.copytree(fixture.root, target / "data")
    (target / "SchemaCraft.py").write_text("# Synthetic historical installation marker\n")
    (target / "builder-auth.json").write_text('{"synthetic_private_credential":"preserved"}')
    (target / "app").mkdir()
    (target / "app" / "ui_text.json").write_text('{"synthetic_custom_wording":"preserved exactly"}')
    (target / ".venv").mkdir()
    (target / ".venv" / "python").symlink_to(sys.executable)
    return target


def execute(package, output):
    results = {"synthetic_only": True, "platform": engine._host(), "checks": []}
    fixture = MigrationFixture()
    fixture.setUp()
    root = Path(tempfile.mkdtemp(prefix="schemacraft-real-offline-update-"))
    results["test_workspace"] = str(root)
    start = time.monotonic()
    try:
        package, manifest, _ = engine.load_package(package)
        target = make_target(root, fixture, "Synthetic Installed SchemaCraft")
        original = engine._inventory(target)
        source_files = engine._workspace_files(original)
        original_env = dict(os.environ)
        # An arbitrary development environment must not redirect the release.
        os.environ["SCHEMACRAFT_POSTGRES_DEV"] = "1"
        os.environ["SCHEMACRAFT_POSTGRES_BIN"] = "/not/a/real/PostgreSQL/runtime"
        try:
            checked = engine.check(target, package)
            assert_equal(checked["status"], "verified", "Strict source preflight failed")
            assert_equal(engine._inventory(target), original, "Preflight changed the original installation")
            report = checked["verification"]
            assert_equal((report["schemas"], report["archived_schemas"], report["records"], report["children"], report["attachment_files"]),
                         (2, 1, 2, 4, 2), "Preflight did not account for every synthetic schema/row/attachment")
            results["checks"].append("Read-only preflight covers two schemas, archived data, four nested children, Arabic/Persian Unicode, zero/false and two attachments")
            updated = engine.apply(target, package)
        finally:
            os.environ.clear()
            os.environ.update(original_env)
        assert_equal(updated["status"], "completed", "The verified staged cutover did not finish")
        assert_equal(engine._inventory(Path(updated["backup"])), original, "Complete original backup mismatch")
        assert_equal(engine._workspace_files(engine._inventory(target)), source_files, "Original workspace files changed")
        assert_equal((target / "builder-auth.json").read_text(), '{"synthetic_private_credential":"preserved"}', "Credentials changed")
        assert_equal((target / "app" / "ui_text.json").read_text(), '{"synthetic_custom_wording":"preserved exactly"}', "Custom wording changed")
        if not (target / ".venv" / "python").is_symlink():
            raise AssertionError("The original interpreter symlink was lost")
        settings = engine._read_json(target / "data" / "storage.json")
        if not Path(settings["report_path"]).is_file():
            raise AssertionError("The post-cutover report reference does not exist")
        migration = engine._read_json(Path(updated["work"]) / "migration.json")
        if not Path(migration["backup_path"]).is_dir():
            raise AssertionError("The migration's post-cutover Excel backup reference does not exist")
        results["checks"].append("Complete backup, exact preserved Excel/schema/attachment/settings files, credentials, custom wording, symlink and diagnostic paths survive directory cutover")
        reopened = engine._verified_probe(engine._run(target, manifest["probe_command"], target / "data", root / "probe-after-cutover.json", [], phase="restart"))
        assert_equal(reopened["logical_sha256"], updated["verification"]["logical_sha256"], "Reopened relocated database logical fingerprint differs")
        assert_equal(reopened["snapshot_sha256"], updated["verification"]["snapshot_sha256"], "Reopened relocated database metadata fingerprint differs")
        engine.assert_closed(target)
        results["checks"].append("Real bundled PostgreSQL restart/readback remains exact after moving the staged installation to its final folder")
        pg_updated = engine.apply(target, package)
        assert_equal(pg_updated["status"], "completed", "Already-PostgreSQL update failed")
        assert_equal(pg_updated["verification"]["snapshot_sha256"], reopened["snapshot_sha256"], "Already-PostgreSQL update changed its snapshot")
        if (Path(pg_updated["work"]) / "migration.json").exists():
            raise AssertionError("Already-PostgreSQL data incorrectly reimported historical Excel")
        assert_equal(engine._workspace_files(engine._inventory(target)), source_files, "Later update changed preserved workspace files")
        results["checks"].append("Already-PostgreSQL second update preserves exact snapshot and skips historical Excel import")
        removed = []
        for workbook in (target / "data").rglob("*.xlsx"):
            if ".postgresql" not in workbook.relative_to(target / "data").parts:
                removed.append(workbook.relative_to(target / "data").as_posix())
                workbook.unlink()
        no_excel = engine._verified_probe(engine._run(target, manifest["probe_command"], target / "data",
            root / "probe-no-workbooks.json", [], phase="database"))
        assert_equal(no_excel["snapshot_sha256"], reopened["snapshot_sha256"], "PostgreSQL-only workspace probe depended on historical Excel")
        results["checks"].append("An active PostgreSQL workspace with all historical Excel workbooks removed still passes real startup/readback with its exact snapshot")
        results["postgresql_only_probe"] = no_excel
        results["removed_synthetic_historical_workbooks"] = removed
        blocked = make_target(root, fixture, "Synthetic Broken Attachment Installation")
        missing = next((blocked / "data").rglob("وثيقة فارسی.txt"))
        missing.unlink()
        before_blocked = engine._inventory(blocked)
        try:
            engine.apply(blocked, package)
        except engine.UpdateError as error:
            blocked_report = engine._read_json(error.report)
            if "missing_referenced_attachment" not in [issue["code"] for issue in blocked_report["issues"]]:
                raise AssertionError("Missing attachment did not produce the expected strict report")
        else:
            raise AssertionError("A missing attachment did not block the update")
        assert_equal(engine._inventory(blocked), before_blocked, "Blocked preflight changed the original company-like installation")
        results["checks"].append("Missing referenced attachment blocks before migration/publication and leaves the complete original untouched")
        results.update(status="passed", elapsed_seconds=round(time.monotonic() - start, 2),
                       preflight=report, final_probe=reopened, update_result=updated, second_update_result=pg_updated)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        return results
    except Exception as error:
        results.update(status="failed", error=f"{type(error).__name__}: {error}", elapsed_seconds=round(time.monotonic() - start, 2))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        raise
    finally:
        fixture.tearDown()
        # Keep the synthetic integration directory and reports for audit; it
        # contains no company data. All probes have cleanly stopped their server.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=BUILD / "release" / "SchemaCraft_PostgreSQL_Update_Linux_x64")
    parser.add_argument("--report", type=Path, default=BUILD / "linux-integration.json")
    args = parser.parse_args()
    result = execute(args.package, args.report)
    print(json.dumps({"status": result["status"], "checks": result["checks"], "report": str(args.report), "elapsed_seconds": result["elapsed_seconds"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
