"""Check the finished executable without opening or changing a workspace."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def verify_build_runtime(base_dir: Path, *, runtime_dir: Path | None = None) -> dict:
    import psycopg
    import psycopg_binary
    from zoneinfo import ZoneInfo
    from schemacraft_postgres_runtime import validate_runtime_directory

    if psycopg.pq.__impl__ != "binary":
        raise RuntimeError("The built application requires the bundled binary driver")
    if psycopg.__version__ != psycopg_binary.__version__:
        raise RuntimeError("The bundled PostgreSQL driver versions do not match")
    ZoneInfo("UTC")
    runtime = validate_runtime_directory(runtime_dir or Path(base_dir) / "runtime" / "postgresql",
        expected_platform="windows-x86_64", execute=True)
    return {"version": 1, "status": "verified_build", "frozen": bool(getattr(sys, "frozen", False)),
        "python_version": list(sys.version_info[:3]), "driver_version": psycopg.__version__,
        "binary_version": psycopg_binary.__version__, "driver_implementation": psycopg.pq.__impl__,
        "timezone_support": True, "runtime_major": runtime["major"], "runtime_platform": runtime["platform"]}


def cli_main(argv=None, *, app) -> int:
    parser = argparse.ArgumentParser(description="Verify bundled EXE dependencies without accessing application data.")
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--runtime-dir", type=Path, help="Reviewed external runtime used while validating a new build.")
    args = parser.parse_args(argv)
    report_path = args.report.resolve()
    if report_path.is_relative_to(app.DATA_DIR.resolve()):
        parser.error("--report must be outside the data directory")
    try:
        report = verify_build_runtime(app.BASE_DIR, runtime_dir=args.runtime_dir)
    except Exception as exc:
        report = {"version": 1, "status": "blocked", "frozen": bool(getattr(sys, "frozen", False)),
            "issues": [{"code": "build_runtime_check_failed", "location": type(exc).__name__}]}
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    report_path.write_text(output, encoding="utf-8")
    if sys.stdout is not None:
        print(output, end="")
    return 0 if report["status"] == "verified_build" else 2
