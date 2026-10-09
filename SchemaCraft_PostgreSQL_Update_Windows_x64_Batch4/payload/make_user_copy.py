#!/usr/bin/env python3
"""Create SchemaCraft's clean Windows user package deterministically."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import stat
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
# Embedded CPython uses an isolated search path and does not automatically
# include the directory containing a directly executed script.
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from schemacraft_postgres_runtime import validate_runtime_directory


USER_RELEASE = PROJECT_DIR / "release" / "SchemaCraft-Windows-User"
EXECUTABLE = PROJECT_DIR / "SchemaCraft.exe"
SUPPORT_FILES = (
    "index.html",
    "app.js",
    "workspace.js",
    "i18n.js",
    "ui-text-preview.css",
    "styles.css",
    "ui_text.json",
    "startup.html",
    "startup.js",
    "closing.html",
    "closing.js",
    "lifecycle.css",
    "attachment-viewer.html",
    "attachment-viewer.css",
    "attachment-viewer.js",
)
FILE_ATTRIBUTE_HIDDEN = 0x2
INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF


def remove_existing_tree(path: Path) -> None:
    """Remove a previous package, including read-only or hidden descendants."""

    if not path.exists():
        return

    def retry_with_write_access(function, target, _exc_info) -> None:
        os.chmod(target, stat.S_IWRITE)
        function(target)

    shutil.rmtree(path, onerror=retry_with_write_access)


def require_path(path: Path, kind: str = "file") -> None:
    valid = path.is_dir() if kind == "directory" else path.is_file()
    if not valid:
        raise FileNotFoundError(f"Required {kind} was not found: {path}")


def set_hidden(path: Path, hidden: bool) -> None:
    """Set or clear the native Windows hidden bit without invoking attrib.exe."""

    if os.name != "nt":
        return
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    current = kernel32.GetFileAttributesW(str(path))
    if current == INVALID_FILE_ATTRIBUTES:
        raise OSError(ctypes.get_last_error(), f"Could not read attributes: {path}")
    updated = current | FILE_ATTRIBUTE_HIDDEN if hidden else current & ~FILE_ATTRIBUTE_HIDDEN
    if not kernel32.SetFileAttributesW(str(path), updated):
        raise OSError(ctypes.get_last_error(), f"Could not update attributes: {path}")


def create_user_copy() -> Path:
    """Create a new local-PostgreSQL deployment without copying developer data."""
    return _create_user_copy(legacy_excel=False)


def _create_user_copy(*, legacy_excel: bool, executable: bool = False) -> Path:
    portable_python = PROJECT_DIR / "portable-runtime.json"
    # A migrated developer app keeps a private Python launcher. Building a new
    # executable must explicitly package that executable rather than silently
    # returning another source/interpreter package because this marker exists.
    source_package = portable_python.is_file() and not executable
    launcher = EXECUTABLE
    if source_package:
        metadata = json.loads(portable_python.read_text(encoding="utf-8"))
        if metadata.get("kind") != "private-cpython" or metadata.get("platform") != "windows-x86_64":
            raise ValueError("Unsupported private Python package")
        batch_launcher = PROJECT_DIR / "OPEN_SCHEMACRAFT.bat"
        if batch_launcher.is_file():
            launcher = batch_launcher
        require_path(PROJECT_DIR / "vendor/python/python.exe")
        require_path(PROJECT_DIR / "vendor/python/pythonw.exe")
        require_path(PROJECT_DIR / "SchemaCraft.py")
    require_path(launcher)
    require_path(PROJECT_DIR / "app", "directory")
    require_path(PROJECT_DIR / "app" / "assets", "directory")
    require_path(PROJECT_DIR / "assets", "directory")
    require_path(PROJECT_DIR / "app" / "locales" / "fa.json")
    require_path(PROJECT_DIR / "app" / "locales" / "ui-defaults.json")
    require_path(PROJECT_DIR / "app" / "ui-previews" / "report.html")
    for name in SUPPORT_FILES:
        require_path(PROJECT_DIR / "app" / name)

    runtime_source = PROJECT_DIR / "runtime" / "postgresql"
    if not legacy_excel:
        # Validate before touching a previous successful release.
        validate_runtime_directory(runtime_source, expected_platform="windows-x86_64", execute=False)

    remove_existing_tree(USER_RELEASE)
    app_destination = USER_RELEASE / "app"
    app_destination.mkdir(parents=True)

    shutil.copy2(launcher, USER_RELEASE / launcher.name)
    if source_package:
        shutil.copy2(portable_python, USER_RELEASE / portable_python.name)
        shutil.copytree(PROJECT_DIR / "vendor/python", USER_RELEASE / "vendor/python")
        for source in PROJECT_DIR.glob("*.py"):
            shutil.copy2(source, USER_RELEASE / source.name)
            set_hidden(USER_RELEASE / source.name, True)
        set_hidden(USER_RELEASE / "vendor", True)
        set_hidden(USER_RELEASE / portable_python.name, True)
    for name in SUPPORT_FILES:
        shutil.copy2(PROJECT_DIR / "app" / name, app_destination / name)
    shutil.copytree(PROJECT_DIR / "app" / "assets", app_destination / "assets")
    shutil.copytree(PROJECT_DIR / "app" / "locales", app_destination / "locales")
    shutil.copytree(PROJECT_DIR / "app" / "ui-previews", app_destination / "ui-previews")
    shutil.copytree(PROJECT_DIR / "assets", USER_RELEASE / "assets")
    if not legacy_excel:
        shutil.copytree(runtime_source, USER_RELEASE / "runtime" / "postgresql")
        validate_runtime_directory(USER_RELEASE / "runtime" / "postgresql", expected_platform="windows-x86_64", execute=False)
        set_hidden(USER_RELEASE / "runtime", True)
    (USER_RELEASE / "storage-default.json").write_text(
        json.dumps({"version": 1, "backend": "excel" if legacy_excel else "managed-postgresql"}, indent=2) + "\n",
        encoding="utf-8",
    )
    set_hidden(USER_RELEASE / "storage-default.json", True)
    calendar_license = PROJECT_DIR / "THIRD_PARTY_ALERT_CALENDARS.txt"
    if calendar_license.is_file():
        shutil.copy2(calendar_license, app_destination / calendar_license.name)

    auth_source = PROJECT_DIR / "builder-auth.json"
    auth_destination = USER_RELEASE / auth_source.name
    if auth_source.is_file():
        shutil.copy2(auth_source, auth_destination)

    set_hidden(app_destination, True)
    set_hidden(USER_RELEASE / "assets", True)
    if auth_destination.is_file():
        set_hidden(auth_destination, True)
    set_hidden(USER_RELEASE / launcher.name, False)
    return USER_RELEASE


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--legacy-excel", action="store_true", help="Explicit compatibility/test package; excludes PostgreSQL and does not migrate data.")
    parser.add_argument("--executable", action="store_true", help="Package the built SchemaCraft.exe instead of the private Python source launcher.")
    args = parser.parse_args()
    try:
        destination = _create_user_copy(legacy_excel=args.legacy_excel, executable=args.executable) \
            if args.legacy_excel or args.executable else create_user_copy()
    except Exception as error:
        print(f"ERROR: Could not create the clean user package: {error}", file=sys.stderr)
        return 1
    if not args.quiet:
        print(f"User package created: {destination}")
        launcher_name = "OPEN_SCHEMACRAFT.bat" if (destination / "OPEN_SCHEMACRAFT.bat").is_file() else EXECUTABLE.name
        print(f"Only {launcher_name} is normally visible; support folders are hidden.")
        print("Runtime data is created and hidden when SchemaCraft first starts.")
        print("Storage: " + ("legacy Excel (explicit compatibility mode)" if args.legacy_excel else "managed local PostgreSQL 18"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
