#!/usr/bin/env python3
"""Create SchemaCraft's clean Windows user package deterministically."""

from __future__ import annotations

import argparse
import ctypes
import os
import shutil
import stat
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
USER_RELEASE = PROJECT_DIR / "release" / "SchemaCraft-Windows-User"
EXECUTABLE = PROJECT_DIR / "SchemaCraft.exe"
SUPPORT_FILES = (
    "index.html",
    "app.js",
    "workspace.js",
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
    require_path(EXECUTABLE)
    require_path(PROJECT_DIR / "app", "directory")
    require_path(PROJECT_DIR / "app" / "assets", "directory")
    require_path(PROJECT_DIR / "assets", "directory")
    for name in SUPPORT_FILES:
        require_path(PROJECT_DIR / "app" / name)

    remove_existing_tree(USER_RELEASE)
    app_destination = USER_RELEASE / "app"
    app_destination.mkdir(parents=True)

    shutil.copy2(EXECUTABLE, USER_RELEASE / EXECUTABLE.name)
    for name in SUPPORT_FILES:
        shutil.copy2(PROJECT_DIR / "app" / name, app_destination / name)
    shutil.copytree(PROJECT_DIR / "app" / "assets", app_destination / "assets")
    shutil.copytree(PROJECT_DIR / "assets", USER_RELEASE / "assets")

    auth_source = PROJECT_DIR / "builder-auth.json"
    auth_destination = USER_RELEASE / auth_source.name
    if auth_source.is_file():
        shutil.copy2(auth_source, auth_destination)

    set_hidden(app_destination, True)
    set_hidden(USER_RELEASE / "assets", True)
    if auth_destination.is_file():
        set_hidden(auth_destination, True)
    set_hidden(USER_RELEASE / EXECUTABLE.name, False)
    return USER_RELEASE


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    try:
        destination = create_user_copy()
    except Exception as error:
        print(f"ERROR: Could not create the clean user package: {error}", file=sys.stderr)
        return 1
    if not args.quiet:
        print(f"User package created: {destination}")
        print("Only SchemaCraft.exe is normally visible; support folders are hidden.")
        print("Runtime data is created and hidden when SchemaCraft first starts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
