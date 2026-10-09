"""Actual Windows-engine negative migration check against synthetic data only."""
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
    spec = importlib.util.spec_from_file_location("negative_engine", args.package / "engine.py")
    engine = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = engine
    spec.loader.exec_module(engine)
    evidence = {"native_windows_verified": False, "platform": "Windows PE binaries under Wine 11.0"}
    try:
        original = engine._inventory(args.target)
        try:
            engine.apply(args.target, args.package)
        except engine.UpdateError as error:
            operation = engine._read_json(error.report)
            assert operation["status"] == "blocked" and operation["activated"] is False
            assert "missing_referenced_attachment" in {issue["code"] for issue in operation["issues"]}
            assert engine._inventory(args.target) == original
            assert not Path(error.backup).exists(), "Backup started despite failed source preflight"
            assert not (args.target / "data/.postgresql").exists()
            evidence.update(status="passed", missing_attachment_blocks_before_backup=True,
                            source_unchanged=True, no_database_created=True,
                            verification=operation, operation_report=error.report)
        else:
            raise AssertionError("Missing referenced attachment was allowed")
        code = 0
    except Exception as error:
        evidence.update(status="failed", message=str(error), traceback=traceback.format_exc())
        code = 1
    args.report.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "report": str(args.report)}, ensure_ascii=False), flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
