#!/usr/bin/env python3
"""Source launcher for the CLI also shipped inside SchemaCraft.exe."""
from schemacraft_migration import cli_main


if __name__ == "__main__":
    raise SystemExit(cli_main())
