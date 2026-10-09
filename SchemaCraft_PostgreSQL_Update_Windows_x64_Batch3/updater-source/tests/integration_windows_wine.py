"""Run using bundled Windows Python; synthetic workspace must be prepared first.

Wine execution proves the actual Windows binaries and Win32 branches in that
emulator, and deliberately does not claim native Microsoft Windows validation.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    package, target = args.package.resolve(), args.target.resolve()
    module_path = package / "engine.py"
    spec = importlib.util.spec_from_file_location("integration_engine", module_path)
    engine = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = engine
    spec.loader.exec_module(engine)
    evidence = {"platform": "Windows PE binaries under privately extracted Wine 11.0",
                "native_windows_verified": False, "checks": {}, "target": str(target)}
    previous_phase = None

    def emit(event):
        nonlocal previous_phase
        if event.get("phase") != previous_phase:
            previous_phase = event.get("phase")
            print(json.dumps(event, ensure_ascii=False), flush=True)

    try:
        original = engine._inventory(target)
        preflight = engine.check(target, package, emit)
        assert preflight["status"] == "verified", preflight
        assert engine._inventory(target) == original, "Read-only preflight changed the original"
        evidence["checks"]["read_only_preflight"] = True
        evidence["preflight"] = preflight
        result = engine.apply(target, package, emit)
        assert result["status"] == "completed", result
        assert engine._inventory(Path(result["backup"])) == original, "Backup mismatch"
        assert (Path(result["backup"]) / "SchemaCraft.exe").read_bytes() == b"synthetic historical launcher", "Old launcher absent in backup"
        assert not (target / "SchemaCraft.exe").exists(), "Obsolete EXE still present after publication"
        assert (target / "OPEN_SCHEMACRAFT.bat").is_file(), "New batch launcher absent"
        evidence["checks"]["full_verified_backup_and_launcher_retirement"] = True
        evidence["apply"] = result
        manifest = engine.load_package(package)[1]
        probe = engine._run(target, manifest["probe_command"], target / "data",
                            args.report.with_name("windows-published-probe.json"), [], emit, "published_restart")
        assert probe["status"] == "verified_backend", probe
        assert probe["logical_sha256"] == preflight["verification"]["logical_sha256"]
        assert probe["records"] == 2 and probe["schemas"] == 2 and probe["archived_schemas"] == 1
        assert probe["children"] == 4 and probe["attachment_files"] == 2
        evidence["checks"]["published_database_restart_exact_readback"] = True
        evidence["published_probe"] = probe
        repeated = engine.apply(target, package, emit)
        assert repeated["status"] == "completed", repeated
        assert engine._read_json(engine.journal_path(target))["backend_before"] == "managed-postgresql"
        assert not (Path(repeated["work"]) / "migration.json").exists(), "Already-PostgreSQL update reimported Excel"
        second = engine._run(target, manifest["probe_command"], target / "data",
                             args.report.with_name("windows-repeated-probe.json"), [], emit, "repeated_restart")
        assert second["logical_sha256"] == probe["logical_sha256"]
        assert second["snapshot_sha256"] == probe["snapshot_sha256"]
        evidence["checks"]["already_postgresql_update_preserves_all_records_and_metadata"] = True
        evidence["repeated_apply"] = repeated
        evidence["repeated_probe"] = second
        evidence["status"] = "passed"
        code = 0
    except Exception as error:
        evidence.update(status="failed", error=type(error).__name__, message=str(error),
                        traceback=traceback.format_exc(), backup=getattr(error, "backup", None),
                        operation_report=getattr(error, "report", None))
        print(evidence["traceback"], flush=True)
        code = 1
    args.report.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "checks": evidence["checks"], "report": str(args.report)}, ensure_ascii=False), flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
