from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "generic_data_entry_test_server", PROJECT_DIR / "SchemaCraft.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load SchemaCraft.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)

def main(argv: list[str]) -> int:
    if len(argv) < 2 or any(
        argument not in {"--builder", "--workspace"} for argument in argv[2:]
    ):
        raise SystemExit("Usage: test_server.py DATA_DIR [--builder] [--workspace]")

    APP.DATA_DIR = Path(argv[1]).resolve()
    APP.SCHEMA_PATH = APP.DATA_DIR / "schema.json"
    APP.WORKBOOK_PATH = APP.DATA_DIR / "database.xlsx"
    APP.BACKUP_DIR = APP.DATA_DIR / "backups"
    APP.BUILDER_AUTH_PATH = APP.DATA_DIR / "builder-auth.json"
    APP.DEVELOPER_MODE = "--builder" in argv[2:]
    if "--workspace" in argv[2:]:
        APP.initialize_workspace()
    else:
        APP.ensure_storage()

    server = APP.DataEntryHTTPServer((APP.HOST, 0), APP.DataEntryRequestHandler)
    print(f"PORT={server.server_address[1]}", flush=True)

    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
