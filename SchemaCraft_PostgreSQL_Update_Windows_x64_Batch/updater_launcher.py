#!/usr/bin/env python3
"""Console-visible portable graphical updater entry point."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

# Embedded Python does not reliably add the launched script's directory.
# Bootstrap siblings before importing the diagnostics or GUI modules.
_SOURCE_DIRECTORY = str(Path(__file__).resolve().parent)
if _SOURCE_DIRECTORY not in sys.path:
    sys.path.insert(0, _SOURCE_DIRECTORY)


def main(argv=None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and arguments[0] == "--engine":
        import engine
        return engine.main(arguments[1:])
    if arguments and arguments[0] == "--startup-self-test":
        import startup_self_test
        return startup_self_test.main(arguments[1:])
    parser = argparse.ArgumentParser(description="SchemaCraft graphical PostgreSQL updater")
    parser.add_argument("target", nargs="?", default="", help="Existing SchemaCraft application folder")
    parser.add_argument("--package", type=Path, help="Update package directory")
    parser.add_argument("--language", choices=("en", "ar"), default="en")
    args = parser.parse_args(arguments)
    import startup_support
    return startup_support.run_graphical(target=args.target, package=args.package, language=args.language)


if __name__ == "__main__":
    raise SystemExit(main())
