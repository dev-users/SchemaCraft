"""Offline, staged SchemaCraft update and verified database cutover.

The original installation is never migrated in place. Recovery completes a
verified cutover or restores the unchanged installation before publication;
there is deliberately no downgrade operation after successful publication.
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
import uuid


_DEVELOPER_DIRECTORIES = {
    "Packages", "node_modules", "tests", "tools", "__pycache__", ".build-env",
    ".build-dist", ".build-work", ".build-spec", ".venv", "app/src",
    "vendor/python", "vendor/reportlab",
}
_DEVELOPER_SCRIPTS = {
    "SchemaCraft.py", "build_frontend.py", "build-windows-gui.py", "make_user_copy.py",
    "migrate-storage.py", "set-builder-password.py", "build-windows-cli.bat",
    "build-windows.bat", "make-user-copy.bat", "prepare-packages.bat",
    "reset-build-environment.bat", "OPEN_SCHEMACRAFT.bat", "OPEN_SCHEMACRAFT.sh",
    "start-windows.bat", "start-linux.sh", "package.json", "package-lock.json",
    "requirements.txt", "requirements-build.txt", ".build-timing.json",
    "portable-runtime.json",
}
_DEVELOPER_DOCUMENTS = {
    'README_ALERTS_UPDATE.md',
    'README_ALERT_ATTACHMENT_REFINEMENT.md',
    'README_ALERT_AUTHORING_POLISH.md',
    'README_ALERT_CONTROLS_IMPORT.md',
    'README_APPEARANCE_CONDITION_UPDATE.md',
    'README_ATTACHMENT_IMPORT_UPDATE.md',
    'README_BUILDER_CONDITIONS_TOKENS.md',
    'README_BUILDER_DETAIL_POLISH.md',
    'README_BUILDER_FLOW_UPDATE.md',
    'README_BUILDER_REFINEMENT.md',
    'README_COMPACT_BUILDER.md',
    'README_COMPOSED_TEXT_UPDATE.md',
    'README_DIALOGS_EXPORT_ALERT_DESIGN.md',
    'README_ENTRY_SEARCH_DATE_UPDATE.md',
    'README_ENTRY_TOOLS_UPDATE.md',
    'README_FIELD_ONLY_LINKING_FIX.md',
    'README_FIELD_RULES_PROFILE_LINKING.md',
    'README_FINANCE_STABILITY.md',
    'README_FINANCIAL_TABLES_UPDATE.md',
    'README_GRADE_AVERAGE_UPDATE.md',
    'README_LANGUAGE_UPDATE.md',
    'README_LINKED_SAVE_REPAIR.md',
    'README_LINK_WORKFLOW_CORRECTIONS.md',
    'README_POSTGRESQL.md',
    'README_RECORD_CHOICES_REFINEMENT.md',
    'README_RUNTIME_ATTACHMENTS_UPDATE.md',
    'README_SOURCE_OWNED_LINKS.md',
    'README_SOURCE_PROFILE_ROWS.md',
    'README_TAB_JOIN_UPDATE.md',
    'README_UI_TEXT_UPDATE.md',
    'README_UNIFIED_INTERFACE_UPDATE.md',
    'README_WORKFLOW_UPDATE.md',
    'THIRD_PARTY_ALERT_CALENDARS.txt',
    'docs/ALPHA22_FEATURES.md',
    'docs/ALPHA23_DASHBOARD.md',
    'docs/ALPHA24_WORKFLOWS.md',
    'docs/ALPHA25_FEATURES.md',
    'docs/ALPHA26_FEATURES.md',
    'docs/ALPHA27_FEATURES.md',
    'docs/ALPHA28_HOME.md',
    'docs/ALPHA29_HOME_TABS.md',
    'docs/ALPHA30_HOME_POLISH.md',
    'docs/ALPHA31_HOME_METRICS.md',
    'docs/ALPHA32_HOME_NEUTRAL.md',
    'docs/ALPHA33_HOME_TABS.md',
    'docs/ALPHA34_SEAMLESS_TABS.md',
    'docs/ALPHA35_HOME_HEADERS.md',
    'docs/ALPHA36_TAB_ALIGNMENT.md',
    'docs/ALPHA37_HOME_REFINEMENT.md',
    'docs/ALPHA38_HOME_TYPOGRAPHY.md',
    'docs/ALPHA39_HOME_ARCHITECTURE.md',
    'docs/ALPHA40_HOME_BUILDER_TAGS.md',
    'docs/ALPHA41_HOME_STATISTICS.md',
    'docs/ALPHA42_BUILDER_TAB_STATISTICS.md',
    'docs/ALPHA43_HOME_INTERACTIONS.md',
    'docs/ALPHA44_WORKFLOW_REFINEMENT.md',
    'docs/ALPHA45_RUNTIME_DASHBOARD_BUILDER.md',
    'docs/ALPHA46_VISUAL_WINDOWS_BUILDER.md',
    'docs/ALPHA47_GENERAL_BUILDER_CHARTS.md',
    'docs/ALPHA48_BUILD_BUILDER_DIALOGS.md',
    'docs/ALPHA49.md',
    'docs/ALPHA50.md',
    'docs/ALPHA51.md',
    'docs/ALPHA52.md',
    'docs/ALPHA53.md',
    'docs/ALPHA54_UI_UNIFICATION.md',
    'docs/ALPHA55_GLOBAL_UI_POLISH.md',
    'docs/API_REFERENCE.md',
    'docs/ARCHITECTURE.md',
    'docs/BACKEND.md',
    'docs/BUILDER_LAYOUT_AND_MEANINGS.md',
    'docs/BUILDER_PERFORMANCE.md',
    'docs/BUILD_AND_RELEASE.md',
    'docs/DATA_MODEL.md',
    'docs/DEVELOPMENT.md',
    'docs/EXCEL_POSTGRESQL_MIGRATION.md',
    'docs/FRONTEND.md',
    'docs/HTTP_API.md',
    'docs/MAINTENANCE_UI.md',
    'docs/MANAGED_POSTGRESQL_RUNTIME.md',
    'docs/OFFLINE_MODE.md',
    'docs/POSTGRESQL_MIGRATION.md',
    'docs/POSTGRESQL_ONLY_RELEASE.md',
    'docs/POSTGRESQL_VERIFICATION.md',
    'docs/REPORT_QUICK_START.md',
    'docs/SECURITY.md',
    'docs/TESTING.md',
    'docs/USER_GUIDE.md',
    'docs/advanced-reports-fix-review.md',
    'docs/advanced-reports.md',
    'docs/document-reports-v3.md',
    'docs/report-studio-changes.md',
    'docs/reports-assessment.md',
    'vendor/README.md',
}
_RECEIPT = "data/.postgresql/consolidation-update.json"


class UpdateError(RuntimeError):
    """An update stopped without silently repairing business data."""


def package_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    here = Path(__file__).resolve().parent
    return here if (here / "manifest.json").is_file() else here.parent


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(_json(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        _sync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def _sync_dir(path):
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _sync_file(path):
    # Windows FlushFileBuffers requires a write-capable handle. Copied readonly
    # files are temporarily made writable inside our private staging/backup,
    # then their original readonly attribute is restored.
    readonly = os.name == "nt" and not (Path(path).stat().st_mode & stat.S_IWRITE)
    if readonly:
        os.chmod(path, stat.S_IWRITE)
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDWR if os.name == "nt" else os.O_RDONLY)
        os.fsync(descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if readonly:
            os.chmod(path, stat.S_IREAD)


def _sync_tree(root):
    """Persist copied files and directory entries before a cutover journal."""
    for folder, directories, files in os.walk(root, topdown=False, followlinks=False):
        current = Path(folder)
        for name in files:
            path = current / name
            if not _linked(path) and path.is_file():
                _sync_file(path)
        _sync_dir(current)
    _sync_dir(Path(root).parent)


def _secure_work(path):
    """Backups contain credentials; do not widen inherited Windows access."""
    if os.name != "nt":
        os.chmod(path, 0o700)
        return
    flags = 0x08000000
    try:
        output = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"],
                                check=True, capture_output=True, timeout=15,
                                creationflags=flags).stdout
        # whoami emits the account name using the Windows OEM code page. Read
        # only the ASCII SID, avoiding UTF-8/OEM decoding of Arabic names. Some
        # Windows-compatible environments return a table despite /fo csv.
        identities = re.findall(rb'(?<![A-Za-z0-9-])(S-1-[0-9]+(?:-[0-9]+)+)(?![A-Za-z0-9-])', output)
        if len(identities) != 1:
            raise UpdateError("Could not identify the Windows account protecting the backup.")
        identity = identities[0].decode("ascii")
        subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"*{identity}:(OI)(CI)F"],
                       check=True, capture_output=True, timeout=30, creationflags=flags)
    except (OSError, subprocess.SubprocessError) as error:
        raise UpdateError("Could not protect the private update backup; no data was migrated.") from error


def _read_json(path):
    try:
        with Path(path).open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError) as error:
        raise UpdateError(f"Missing or invalid JSON file: {Path(path).name}") from error


def _linked(path):
    try:
        return path.is_symlink() or bool(getattr(path.lstat(), "st_file_attributes", 0) & 0x400)
    except FileNotFoundError:
        return False


def _relative(value):
    devices = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    parts = value.split("/") if isinstance(value, str) else []
    if (not parts or PurePosixPath(value).is_absolute() or "\\" in value
            or any(part in {"", ".", ".."} or ":" in part or part.endswith((" ", "."))
                   or any(ord(c) < 32 for c in part) or part.split(".")[0].upper() in devices for part in parts)):
        raise UpdateError("Unsafe package path.")
    return parts


def _safe(root, value):
    path = Path(root)
    for part in _relative(value):
        path /= part
        if _linked(path):
            raise UpdateError(f"Linked package/application path refused: {value}")
    return path


def _host():
    machine = platform.machine().casefold()
    if machine not in {"x86_64", "amd64"}:
        raise UpdateError("This update supports x86-64 computers only.")
    if sys.platform == "win32":
        return "windows-x86_64"
    if sys.platform.startswith("linux"):
        return "linux-x86_64"
    raise UpdateError("This update supports Windows or Linux only.")


def _windows_version():
    # platform_version describes the actual system rather than the version
    # advertised to a program by Windows compatibility manifest settings.
    try:
        version = tuple(sys.getwindowsversion().platform_version)
    except (AttributeError, TypeError, OSError) as error:
        raise UpdateError("Could not verify the Windows version required by this update.") from error
    if len(version) != 3 or any(type(value) is not int or value < 0 for value in version):
        raise UpdateError("Could not verify the Windows version required by this update.")
    return version


def _check_windows_version(manifest):
    if "minimum_windows_version" not in manifest:
        return None
    minimum = manifest["minimum_windows_version"]
    if (manifest.get("platform") != "windows-x86_64" or not isinstance(minimum, list)
            or len(minimum) != 3 or any(type(value) is not int or value < 0 for value in minimum)):
        raise UpdateError("Invalid minimum Windows version in the update manifest.")
    actual = _windows_version()
    if actual < tuple(minimum):
        if minimum == [10, 0, 18362]:
            raise UpdateError("This update requires Windows 10 version 1903 (build 18362) or later, or Windows 11. No data was migrated.")
        required = ".".join(map(str, minimum))
        raise UpdateError(f"This update requires Windows {required} or later. No data was migrated.")
    return actual


def _event(emit, phase, message, done=None, total=None):
    event = {"type": "progress", "phase": phase, "message": message}
    if done is not None:
        event["done"] = done
    if total is not None:
        event["total"] = total
    if emit:
        emit(event)


def load_package(package=None, emit=None):
    package = Path(package or package_root()).resolve(strict=True)
    manifest = _read_json(_safe(package, "manifest.json"))
    if _linked(package / "payload"):
        raise UpdateError("The package payload must not be linked.")
    if (manifest.get("format_version") != 1 or manifest.get("platform") != _host()
            or not isinstance(manifest.get("update_id"), str)
            or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", manifest["update_id"])):
        raise UpdateError("The package format or operating system is unsupported.")
    _check_windows_version(manifest)
    consolidation = _consolidation_policy(manifest)
    retired_developer = _developer_files(manifest)
    preserved = manifest.get("preserve_existing_files", ["app/ui_text.json"])
    if (not isinstance(preserved, list) or any(name != "app/ui_text.json" for name in preserved)
            or len(preserved) != len(set(preserved))):
        raise UpdateError("Unsupported preserved application setting declaration.")
    obsolete = _obsolete_launchers(manifest)
    entries, seen = {}, set()
    forbidden = {"data", "backups", ".postgresql", ".git"}
    private = {"builder-auth.json", "developer-access.key", "developer-access.json"}
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise UpdateError("The package has no application payload.")
    for number, entry in enumerate(files, 1):
        if not isinstance(entry, dict):
            raise UpdateError("Invalid payload inventory.")
        rel = entry.get("path")
        parts = _relative(rel)
        if parts[0].casefold() in forbidden or any(part.casefold() in private for part in parts):
            raise UpdateError("An update payload must not contain company data or credentials.")
        folded = rel.casefold()
        if folded in seen:
            raise UpdateError("Duplicate or case-colliding payload paths.")
        seen.add(folded)
        digest = entry.get("sha256")
        size = entry.get("size")
        mode = entry.get("mode", 0o644)
        if (not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or type(size) is not int or size < 0 or mode not in {0o644, 0o755, 0o600, 0o700}):
            raise UpdateError("Invalid payload digest, size or permissions.")
        path = _safe(package / "payload", rel)
        if not path.is_file() or path.stat().st_size != size or _hash(path) != digest:
            raise UpdateError(f"Payload checksum failed: {rel}")
        entries[rel] = entry
        _event(emit, "package", "Verifying update files", number, len(files))
    actual = set()
    for folder, directories, names in os.walk(package / "payload", followlinks=False):
        current = Path(folder)
        if any(_linked(current / name) for name in directories):
            raise UpdateError("The package payload contains a linked directory.")
        for name in names:
            path = current / name
            if _linked(path) or not path.is_file():
                raise UpdateError("The package payload contains a linked or special file.")
            actual.add(path.relative_to(package / "payload").as_posix())
    if actual != set(entries):
        raise UpdateError("The extracted payload contains unlisted or missing files. Extract a fresh copy.")
    if any(relative.casefold() in {name.casefold() for name in entries} for relative in obsolete):
        raise UpdateError("A retired launcher must not also be installed by the payload.")
    commands = {name: manifest.get(name) for name in ("application_command", "migration_command", "probe_command")}
    if consolidation:
        commands["cleanup_command"] = consolidation["cleanup_command"]
        _require_postgres_policy(package / "payload")
    for name, command in commands.items():
        if not isinstance(command, list) or not command or any(not isinstance(arg, str) or "\x00" in arg for arg in command):
            raise UpdateError(f"Missing packaged command: {name}")
        for index, arg in enumerate(command):
            if arg.startswith("--"):
                continue
            _relative(arg)
            if (index == 0 or arg.endswith((".py", ".exe"))) and arg not in entries:
                raise UpdateError(f"Packaged command is absent from the inventory: {name}")
        if command[0] not in entries:
            raise UpdateError("A packaged command must use its private executable.")
    if any(relative.casefold() == name.casefold() or name.casefold().startswith(relative.casefold() + "/") for relative in retired_developer for name in entries):
        raise UpdateError("A retired developer path must not also be installed by the payload.")
    return package, manifest, entries


def _consolidation_policy(manifest):
    if "consolidation" not in manifest:
        return None
    policy = manifest["consolidation"]
    if (not isinstance(policy, dict) or set(policy) != {"format_version", "require_postgresql_only", "remove_update_backups", "cleanup_command"}
            or type(policy.get("format_version")) is not int or policy["format_version"] != 1
            or policy.get("require_postgresql_only") is not True
            or type(policy.get("remove_update_backups")) is not bool
            or not isinstance(policy.get("cleanup_command"), list) or not policy["cleanup_command"]):
        raise UpdateError("Invalid PostgreSQL consolidation policy.")
    return policy


def _developer_files(manifest):
    files = manifest.get("retire_developer_files", [])
    if (not isinstance(files, list) or any(not isinstance(name, str) for name in files)
            or len(files) != len({name.casefold() for name in files})):
        raise UpdateError("Invalid developer-file retirement list.")
    for name in files:
        parts = _relative(name)
        allowed = name in _DEVELOPER_DIRECTORIES or name in _DEVELOPER_SCRIPTS
        allowed = allowed or (len(parts) == 1 and re.fullmatch(r"schemacraft_[A-Za-z0-9_]+\.py", name) is not None)
        # Source documentation must be named individually; user documents and
        # the complete docs tree are never eligible for recursive retirement.
        allowed = allowed or name in _DEVELOPER_DOCUMENTS
        if not allowed:
            raise UpdateError("An unrecognized or protected developer path was selected for retirement.")
    return files


def _require_postgres_policy(root):
    policy = _read_json(_safe(root, "storage-default.json"))
    if (not isinstance(policy, dict) or type(policy.get("version")) is not int or policy.get("version") != 1
            or policy.get("backend") != "managed-postgresql" or policy.get("require_postgresql") is not True):
        raise UpdateError("The consolidated application must enforce PostgreSQL-only storage.")


def _obsolete_launchers(manifest):
    """Allow only this Windows release's replaced launcher, never user data."""
    obsolete = manifest.get("obsolete_launcher_files", [])
    if (not isinstance(obsolete, list) or any(not isinstance(name, str) for name in obsolete)
            or len(obsolete) != len(set(obsolete))
            or any(name != "SchemaCraft.exe" for name in obsolete)
            or obsolete and manifest.get("platform") != "windows-x86_64"):
        raise UpdateError("Unsupported obsolete launcher declaration. No application files were removed.")
    return obsolete


def _target(target, *, required=True):
    supplied = Path(target).expanduser().absolute()
    if _linked(supplied):
        raise UpdateError("Choose a real application folder, not a symbolic link or junction.")
    target = supplied.resolve(strict=required)
    if required:
        if not target.is_dir() or not (target / "data").is_dir():
            raise UpdateError("Choose the SchemaCraft application folder containing its data directory.")
        if not any((target / name).is_file() for name in ("SchemaCraft.py", "SchemaCraft.exe", "SchemaCraft")):
            raise UpdateError("The selected folder is not a recognized SchemaCraft installation.")
        if _linked(target / "data"):
            raise UpdateError("Linked data directories are unsupported for an atomic update.")
    return target


def _key(target):
    return hashlib.sha256(str(Path(target).resolve()).casefold().encode("utf-8")).hexdigest()[:20]


def lock_path(target):
    target = Path(target).resolve()
    return target.parent / (".schemacraft-update-lock-" + _key(target))


def journal_path(target):
    target = Path(target).resolve()
    return target.parent / (".schemacraft-update-journal-" + _key(target) + ".json")


@contextlib.contextmanager
def _locked(target):
    """Hold an OS lock and the legacy Windows app mutex through cutover."""
    path = lock_path(target)
    if _linked(path):
        raise UpdateError("The update lock is a linked path.")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    mutex = None
    with os.fdopen(descriptor, "r+b") as stream:
        if stream.seek(0, 2) == 0:
            stream.write(b"\0")
            stream.flush()
        try:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                kernel = ctypes.windll.kernel32
                kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
                kernel.CreateMutexW.restype = ctypes.c_void_p
                mutex = kernel.CreateMutexW(None, False, "Local\\GenericSchemaCraft-" + _key(target))
                if not mutex or kernel.GetLastError() == 183:
                    if mutex:
                        kernel.CloseHandle(ctypes.c_void_p(mutex))
                        mutex = None
                    raise UpdateError("Close the running SchemaCraft application before updating.")
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise UpdateError("Another update or application is using this folder.") from error
        control = {"remove_lock": False}
        try:
            yield control
        finally:
            # A successful consolidation has finished all writes before this
            # unlink. Keep the Windows app mutex while closing/unlinking its
            # byte-lock file; POSIX unlinks the inode while still holding it.
            if control["remove_lock"] and os.name != "nt":
                path.unlink(missing_ok=True)
                _sync_dir(path.parent)
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            if control["remove_lock"] and os.name == "nt":
                stream.close()
                path.unlink(missing_ok=True)
            if mutex:
                ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(mutex))


def _process_exists(pid):
    if type(pid) is not int or pid <= 0:
        return False
    if os.name == "nt":
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return kernel.GetLastError() == 5
        kernel.CloseHandle(ctypes.c_void_p(handle))
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def assert_closed(target):
    """Detect real listeners/processes, not stale lock-file existence."""
    folder_digest = hashlib.sha256(str(target).casefold().encode("utf-8")).digest()
    port = 51000 + int.from_bytes(folder_digest[:2], "big") % 10000
    with socket.socket() as connection:
        connection.settimeout(0.2)
        if connection.connect_ex(("127.0.0.1", port)) == 0:
            raise UpdateError("Close SchemaCraft; its local application server is still running.")
    proc = Path("/proc")
    if os.name != "nt" and proc.is_dir():
        candidates = {str(target / "SchemaCraft.py"), str(target / "SchemaCraft"), str(target / "SchemaCraft.exe")}
        for directory in proc.iterdir():
            if not directory.name.isdigit() or int(directory.name) == os.getpid():
                continue
            try:
                args = (directory / "cmdline").read_bytes().decode("utf-8", errors="replace").split("\0")
                cwd = (directory / "cwd").resolve(strict=True)
                for arg in args:
                    candidate = Path(arg)
                    if candidate.name in {"SchemaCraft.py", "SchemaCraft", "SchemaCraft.exe"}:
                        absolute = candidate if candidate.is_absolute() else cwd / candidate
                        if str(absolute.resolve()) in candidates:
                            raise UpdateError("Close the SchemaCraft process before updating.")
                    if arg in candidates:
                        raise UpdateError("Close the SchemaCraft process before updating.")
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue
    data = target / "data"
    pid_path = data / ".postgresql" / "cluster" / "postmaster.pid"
    if pid_path.exists():
        try:
            # PostgreSQL writes a structural ASCII PID on line one and UTF-8
            # data-directory text on later lines. Decode no path contents.
            first = pid_path.read_bytes().splitlines()[0]
            if not re.fullmatch(rb"[1-9][0-9]*", first):
                raise ValueError("Invalid PostgreSQL PID")
            pid = int(first)
            if pid > (0xFFFFFFFF if os.name == "nt" else 0x7FFFFFFF):
                raise ValueError("PostgreSQL PID is outside the platform process-ID range")
        except (OSError, ValueError, IndexError) as error:
            raise UpdateError("The database shutdown state is uncertain; inspect its server log first.") from error
        if _process_exists(pid):
            raise UpdateError("The managed PostgreSQL server is still running; close all copies using this workspace.")
    for lease in (data / ".postgresql" / "leases").glob("*.json"):
        try:
            if _process_exists(_read_json(lease).get("pid")):
                raise UpdateError("A process still holds a managed database lease; close it first.")
        except UpdateError as error:
            if str(error).startswith("A process"):
                raise
            raise UpdateError("A managed database lease is unreadable; inspect it before updating.") from error


def _inventory(root, emit=None, phase="inventory"):
    """Hash every regular file; preserve non-data symlinks without following."""
    root = Path(root)
    result = {}
    for folder, directories, files in os.walk(root, followlinks=False):
        current = Path(folder)
        for name in list(directories):
            path = current / name
            rel = path.relative_to(root).as_posix()
            if _linked(path):
                if rel == "data" or rel.startswith("data/") or not path.is_symlink():
                    raise UpdateError("Company data or junction paths must not be linked.")
                result[rel] = {"kind": "link", "target": os.readlink(path)}
                directories.remove(name)
            else:
                result[rel] = {"kind": "directory"}
        for name in files:
            path = current / name
            rel = path.relative_to(root).as_posix()
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                if rel.startswith("data/"):
                    raise UpdateError("Linked company files are unsupported.")
                result[rel] = {"kind": "link", "target": os.readlink(path)}
            elif stat.S_ISREG(info.st_mode):
                result[rel] = {"kind": "file", "size": info.st_size, "sha256": _hash(path)}
            else:
                raise UpdateError("The installation contains a special file that cannot be safely backed up.")
        _event(emit, phase, "Checking installation contents", len(result))
    return dict(sorted(result.items()))


def _copy(source, destination, inventory, emit=None, phase="backup"):
    destination.mkdir(mode=0o700)
    entries = list(inventory.items())
    for number, (rel, info) in enumerate(entries, 1):
        source_path, dest = source / rel, destination / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if info["kind"] == "directory":
            dest.mkdir(exist_ok=True)
        elif info["kind"] == "link":
            os.symlink(info["target"], dest, target_is_directory=source_path.is_dir())
        else:
            shutil.copy2(source_path, dest)
            if _hash(dest) != info["sha256"]:
                raise UpdateError("The complete backup failed its file comparison.")
        _event(emit, phase, "Copying and verifying installation", number, len(entries))
    # PostgreSQL requires its cluster directory to retain mode 0700/0750.
    # Apply directory metadata after children, including readonly recovery
    # folders, so creating the verified copy never needs source permission edits.
    for rel, info in reversed(entries):
        if info["kind"] == "directory":
            shutil.copystat(source / rel, destination / rel, follow_symlinks=False)
    shutil.copystat(source, destination, follow_symlinks=False)
    _sync_tree(destination)


def _overlay(stage, package, entries, emit=None, *, obsolete_files=()):
    # The caller has already verified a complete backup of the original.
    # Remove only the old custom launcher in this disposable staging tree.
    retired = []
    if any(name != "SchemaCraft.exe" for name in obsolete_files):
        raise UpdateError("Only the replaced Windows SchemaCraft.exe launcher may be retired.")
    if obsolete_files and _host() != "windows-x86_64":
        raise UpdateError("Custom Windows launchers can be retired only by the Windows update.")
    for relative in obsolete_files:
        obsolete = _safe(stage, relative)
        if obsolete.exists():
            if not obsolete.is_file():
                raise UpdateError("The obsolete application launcher is not a regular file.")
            obsolete.unlink()
            retired.append(relative)
            _event(emit, "install", "Retiring the backed-up custom Windows launcher")
    # The bundled interpreter/server are authoritative trees. Leaving an old
    # unlisted DLL/module beside the new runtime can change what gets loaded.
    for rel in ("vendor/python", "runtime/postgresql"):
        if any(name.startswith(rel + "/") for name in entries):
            owned = _safe(stage, rel)
            if owned.exists():
                if not owned.is_dir():
                    raise UpdateError("An application runtime path is not a directory.")
                shutil.rmtree(owned)
    for number, (rel, entry) in enumerate(entries.items(), 1):
        destination = _safe(stage, rel)
        # Older releases stored operator-edited wording in this application
        # asset. Preserve it byte-for-byte; newer overrides already live in data.
        if rel == "app/ui_text.json" and destination.is_file():
            _event(emit, "install", "Preserving custom interface wording", number, len(entries))
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_safe(package / "payload", rel), destination)
        os.chmod(destination, entry.get("mode", 0o644))
        if _hash(destination) != entry["sha256"]:
            raise UpdateError("The staged application failed payload verification.")
        _event(emit, "install", "Installing the new application in staging", number, len(entries))
    _sync_tree(stage)
    return retired


def _command(base, declared):
    command = list(declared)
    command[0] = str(_safe(base, command[0]))
    for index, arg in enumerate(command[1:], 1):
        if arg.endswith(".py") and not arg.startswith("--"):
            command[index] = str(_safe(base, arg))
    return command


def _migration_failure_summary(result):
    """Render only fixed diagnostic categories, never exception messages/data."""
    stages = {"source_preflight", "backup", "target_initialization", "target_inspection", "target_import",
              "target_readback", "source_recheck", "activation", "target_rollback", "restore_preflight",
              "restore_install", "restore_cleanup", "migration_setup", "migration_cleanup", "report_write"}
    operations = {"resolve_workspace", "acquire_workbook_lock", "inventory_source", "read_workspace_catalog",
                  "read_schema_definition", "validate_excel_dataset", "validate_excel_registry", "validate_attachments",
                  "summarize_source", "recheck_source_inventory", "backup_originals", "store.initialize",
                  "store.export_snapshot", "verify_target_empty_or_identical", "store.restore_snapshot",
                  "compare_snapshot", "store.read_schema", "compare_schema", "store.read_dataset", "compare_dataset",
                  "store.read_registry", "compare_registry", "inventory_before_activation", "write_migration_report",
                  "write_storage_marker", "prepare_empty_workspace", "inventory_restore_target",
                  "create_restore_staging_directory", "extract_backup", "validate_postgres_seed",
                  "prepare_schema_projections", "verify_restore_target_empty", "compare_restore_snapshot",
                  "inventory_before_install", "install_restored_files", "validate_installed_postgres_seed",
                  "write_restore_report", "remove_installed_files", "import_application", "acquire_application_instance",
                  "migrate_workspace", "import_postgres_runtime", "import_postgres_store", "create_managed_runtime",
                  "runtime.start", "create_postgres_store", "restore_backup", "store.close", "runtime.stop",
                  "write_requested_report"}
    exceptions = {"StorageError", "StorageConflict", "MigrationBlocked", "PostgresRuntimeError", "ImportError",
                  "ModuleNotFoundError", "OperationalError", "InterfaceError", "ProgrammingError", "DataError",
                  "IntegrityError", "InternalError", "NotSupportedError", "DatabaseError", "Error", "OSError",
                  "PermissionError", "FileNotFoundError", "FileExistsError", "NotADirectoryError", "IsADirectoryError",
                  "TimeoutError", "ConnectionError", "ConnectionRefusedError", "ConnectionResetError", "BrokenPipeError",
                  "ValueError", "TypeError", "KeyError", "RuntimeError", "OverflowError", "RecursionError",
                  "UnicodeDecodeError", "UnicodeEncodeError", "JSONDecodeError", "TimeoutExpired"}
    reasons = {"repository_closed", "driver_unavailable", "unsupported_storage_format", "failed_transaction"}
    if not isinstance(result, dict) or not isinstance(result.get("issues"), list):
        return ""
    for issue in result["issues"]:
        if not isinstance(issue, dict) or not isinstance(issue.get("diagnostic"), dict):
            continue
        diagnostic, details = issue["diagnostic"], []
        stage = issue.get("stage", result.get("stage"))
        operation = issue.get("operation", result.get("operation"))
        if isinstance(stage, str) and stage in stages:
            details.append("stage: " + stage)
        if isinstance(operation, str) and operation in operations:
            details.append("operation: " + operation)
        reason = diagnostic.get("validation_code")
        if isinstance(reason, str) and reason in reasons:
            details.append("reason: " + reason)
        else:
            sqlstate = diagnostic.get("sqlstate")
            if isinstance(sqlstate, str) and re.fullmatch(r"[0-9A-Z]{5}", sqlstate):
                details.append("SQLSTATE: " + sqlstate)
            for field in ("winerror", "errno"):
                code = diagnostic.get(field)
                if type(code) is int and 0 <= code <= 65535:
                    details.append(field + ": " + str(code))
        root_cause = diagnostic.get("root_cause_type", diagnostic.get("exception_type"))
        if isinstance(root_cause, str) and root_cause in exceptions:
            details.append("root cause: " + root_cause)
        if details:
            return " Diagnostic " + "; ".join(details) + "."
    return ""


def _run(base, declared, data, report, action, emit=None, phase="preflight", timeout=14400):
    command = _command(base, declared) + ["--data-dir", str(data), "--report", str(report)] + action
    env = dict(os.environ)
    isolated = {"SCHEMACRAFT_POSTGRES_BIN", "SCHEMACRAFT_POSTGRES_DEV", "PYTHONPATH", "PYTHONHOME", "PSYCOPG_IMPL"}
    for key in list(env):
        if key.upper() in isolated or key.upper().startswith("PG"):
            env.pop(key)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    creationflags = 0x08000000 if os.name == "nt" else 0
    started = time.monotonic()
    report.unlink(missing_ok=True)
    # Do not persist stdout/stderr: an unforeseen dependency may expose values.
    with tempfile_output() as output:
        try:
            process = subprocess.Popen(command, cwd=base, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=output, creationflags=creationflags)
        except OSError as error:
            raise UpdateError("The packaged application could not start. No installation was published.") from error
        last = 0.0
        while process.poll() is None:
            elapsed = time.monotonic() - started
            if elapsed >= timeout:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise UpdateError("The staged operation exceeded its time limit; preserve its report and retry recovery.")
            if elapsed - last >= 10:
                _event(emit, phase, "Operation is running; the original installation is preserved")
                last = elapsed
            time.sleep(0.1)
    if not report.is_file():
        raise UpdateError("The packaged application did not produce a verification report.")
    result = _read_json(report)
    if process.returncode != 0:
        error = UpdateError(f"Verification blocked.{_migration_failure_summary(result)} Review the report: {report}")
        error.report = str(report)
        raise error
    return result


@contextlib.contextmanager
def tempfile_output():
    import tempfile
    with tempfile.TemporaryFile() as stream:
        yield stream


def _backend(target):
    path = target / "data" / "storage.json"
    if not path.exists():
        return "excel"
    config = _read_json(path)
    if not isinstance(config, dict):
        raise UpdateError("Unsupported storage configuration; no database was replaced.")
    backend = config.get("backend")
    if backend not in {"excel", "managed-postgresql"}:
        raise UpdateError("Unsupported storage configuration; no database was replaced.")
    if backend == "managed-postgresql" and (type(config.get("version")) is not int or config["version"] != 1):
        raise UpdateError("Unsupported PostgreSQL storage configuration version; no database was replaced.")
    if backend == "managed-postgresql" and not (target / "data" / ".postgresql" / "deployment.json").is_file():
        raise UpdateError("The active PostgreSQL workspace has no deployment identity. Restore its matching backup first.")
    return backend


def _workspace_files(inventory):
    return {rel[5:]: value for rel, value in inventory.items()
            if rel.startswith("data/") and rel != "data/storage.json"
            and not rel.startswith("data/.postgresql/") and rel != "data/.postgresql"}


def _verified_probe(report):
    if (not isinstance(report, dict) or report.get("status") != "verified_backend" or report.get("backend") != "managed-postgresql"
            or report.get("readback_verified") is not True
            or not re.fullmatch(r"[0-9a-f]{64}", str(report.get("logical_sha256", "")))
            or not re.fullmatch(r"[0-9a-f]{64}", str(report.get("snapshot_sha256", "")))):
        raise UpdateError("The staged database did not pass its startup/readback verification.")
    return report


def _fingerprints(report):
    _verified_probe(report)
    keys = ("logical_sha256", "snapshot_sha256", "attachment_sha256")
    if any(not re.fullmatch(r"[0-9a-f]{64}", str(report.get(key, ""))) for key in keys):
        raise UpdateError("Consolidation requires complete record, metadata and attachment fingerprints.")
    return {key: report[key] for key in keys}


def _stable_inventory(inventory, removed=()):
    """Protect every app file except approved removals and physical PG state."""
    volatile = {"data/.postgresql/postgres.log", "data/.postgresql/lifecycle.lock"}
    prefixes = ("data/.postgresql/cluster", "data/.postgresql/leases")
    def keep(name):
        if name in removed or name in volatile:
            return False
        return not any(name == prefix or name.startswith(prefix + "/") for prefix in prefixes)
    return {name: value for name, value in inventory.items() if keep(name)}


def _cleanup_paths(plan, inventory, stage):
    if not isinstance(plan, dict) or plan.get("status") != "planned":
        raise UpdateError("The packaged cleanup did not produce an exact reviewed plan.")
    catalog = _read_json(_safe(stage, "data/workspace.json"))
    workbooks = set()
    if not isinstance(catalog, dict) or not isinstance(catalog.get("schemas"), list):
        raise UpdateError("Missing catalog ownership for cleanup.")
    for entry in catalog["schemas"]:
        if not isinstance(entry, dict):
            raise UpdateError("Invalid catalog ownership for cleanup.")
        folder, workbook = entry.get("folder"), entry.get("workbook")
        if len(_relative(folder)) != 1 or len(_relative(workbook)) != 1 or not workbook.casefold().endswith(".xlsx"):
            raise UpdateError("Invalid catalog workbook ownership for cleanup.")
        workbooks.add("data/schemas/" + folder + "/" + workbook)
    paths = []
    for field, kind in (("removed_files", "file"), ("removed_directories", "directory")):
        values = plan.get(field)
        if (not isinstance(values, list) or any(not isinstance(name, str) for name in values)
                or len(values) != len({name.casefold() for name in values})):
            raise UpdateError("Invalid exact cleanup inventory.")
        for name in values:
            parts = _relative(name)
            # Independently bound all removals to obsolete Excel storage or
            # identified recovery copies. Active data, credentials and user
            # documents are never accepted merely because a CLI lists them.
            recovery = any(name == prefix or name.startswith(prefix + "/") for prefix in
                ("backups", "data/release-2-original", "data/.postgresql/migration-backups"))
            workbook = (kind == "file" and name in {"data/database.xlsx", "data/identity-registry.xlsx"})
            workbook = workbook or (kind == "file" and name in workbooks)
            transient = (kind == "file" and (len(parts) == 2 or (len(parts) == 4 and parts[:2] == ["data", "schemas"])) and parts[0] == "data"
                and re.fullmatch(r"\.(?:database|database-schema|database-projection|database-rollback|identity-registry)-[a-z0-9_]{8}\.xlsx", parts[-1]))
            if not (recovery or workbook or transient) or inventory.get(name, {}).get("kind") != kind:
                raise UpdateError("The cleanup plan selected a protected or unidentified application path.")
            paths.append(name)
    if len(paths) != len(set(paths)):
        raise UpdateError("Overlapping cleanup file/directory entries.")
    # A removed directory must include its complete original contents, never
    # permitting an unlisted attachment or hidden file to disappear with it.
    approved = set(paths)
    for name in plan["removed_directories"]:
        if any(child.startswith(name + "/") and child not in approved for child in inventory):
            raise UpdateError("A cleanup directory has unlisted contents.")
    return approved


def _purge(path):
    """Delete a selected owned tree without following symlinks/junctions."""
    path = Path(path)
    if _linked(path):
        if not path.is_symlink():
            raise UpdateError("A recovery junction must be reviewed before cleanup.")
        path.unlink()
    elif path.is_dir():
        os.chmod(path, 0o700)
        for item in list(path.iterdir()):
            _purge(item)
        path.rmdir()
    elif path.exists():
        if not path.is_file():
            raise UpdateError("A special recovery file cannot be removed safely.")
        os.chmod(path, 0o600)
        path.unlink()


def _retire_developer(stage, manifest):
    removed = []
    selected = _developer_files(manifest)
    for name in selected:
        parts = _relative(name)
        # A copied .venv symlink may be unlinked itself, never traversed.
        parent = _safe(stage, "/".join(parts[:-1])) if len(parts) > 1 else stage
        path = parent / parts[-1]
        if path.exists() or _linked(path):
            _purge(path)
            removed.append(name)
    for name in ("docs", "vendor"):
        if not any(relative.startswith(name + "/") for relative in selected):
            continue
        path = _safe(stage, name)
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
            removed.append(name)
    return removed


def _owned_backup_roots(target):
    key = _key(target)
    for sibling in target.parent.iterdir():
        if sibling == target or not sibling.is_dir() or _linked(sibling):
            continue
        if _key(sibling) == key and (not target.exists() or not os.path.samefile(sibling, target)):
            raise UpdateError("Two application paths share this updater ownership key. Their backups were preserved for review.")
    roots = []
    for namespace in (".scu", ".schemacraft-update-backups"):
        parent = target.parent / namespace
        root = parent / key
        if _linked(parent) or _linked(root):
            raise UpdateError("A target-owned updater backup path is linked; cleanup was blocked.")
        if root.exists() and not root.is_dir():
            raise UpdateError("A target-owned updater backup path is not a directory.")
        roots.append(root)
    return roots


def _verification_root(target, work, declared, emit, inventory=None):
    """Copy verified software to probe the locked final workspace safely.

    The app's CLI also takes its ordinary launch lease. Executing it from a
    separate private root avoids conflicting with the updater's target lock;
    its explicit --data-dir still opens the published, authoritative database.
    No unlocked publication window or launch-lock bypass is introduced.
    """
    verifier = _safe(work, "verification-runtime")
    _purge(verifier)
    files = inventory if inventory is not None else _inventory(target)
    roots = ("app", "runtime/postgresql", "vendor/python")
    exact = {declared[0], "storage-default.json"}
    exact.update(arg for arg in declared if arg.endswith(".py") and not arg.startswith("--"))
    selected = {name: info for name, info in files.items()
        if name in exact or name in {"runtime", "vendor"}
        or any(name == prefix or name.startswith(prefix + "/") for prefix in roots)
        or ("/" not in name and (name == "SchemaCraft.py" or re.fullmatch(r"schemacraft_[A-Za-z0-9_]+\.py", name)))}
    if declared[0] not in selected or "storage-default.json" not in selected:
        raise UpdateError("The published installation has no verified probe executable or storage policy.")
    _copy(target, verifier, selected, emit, "verification")
    if _inventory(verifier) != selected:
        raise UpdateError("The isolated published-database verifier failed exact file/hash comparison.")
    return verifier


def _finish_consolidation(target, journal, verification, emit, cleanup=None):
    """Persist a receipt before deleting this target's obsolete recovery trees."""
    _require_postgres_policy(target)
    fingerprints = _fingerprints(verification)
    roots = _owned_backup_roots(target)
    # Validate the exact journal ownership before deleting anything. This also
    # accepts cleanup_pending after a previous purge removed sealed inventories.
    journal["status"] = "cleanup_pending"
    journal["report"] = str(target / _RECEIPT)
    journal["completed_at"] = datetime.now(timezone.utc).isoformat()
    _atomic(journal_path(target), journal)
    _validated_journal(target)
    result = {"type": "result", "status": "completed", "backend": "managed-postgresql",
        "target": str(target), "update_id": journal["update_id"],
        "backup": None, "work": None, "report": journal["report"], "verification": verification,
        "launch_command": _command(target, journal["application_command"]),
        "consolidated": True, "cleanup": cleanup or journal.get("cleanup"),
        "fingerprints": fingerprints, "completed_at": journal["completed_at"],
        "retired_developer_files": journal.get("retired_developer_files", []),
        "retired_launchers": journal.get("retired_launchers", []), "update_backups_removed": True}
    pending = dict(result, status="cleanup_pending", update_backups_removed=False)
    _atomic(_safe(target, _RECEIPT), pending)
    _event(emit, "cleanup", "Removing verified obsolete backups belonging to this application")
    for root in roots:
        _purge(root)
        if root.parent.is_dir():
            _sync_dir(root.parent)
        if root.parent.is_dir() and not any(root.parent.iterdir()):
            root.parent.rmdir()
            _sync_dir(root.parent.parent)
    _atomic(_safe(target, _RECEIPT), result)
    journal_path(target).unlink()
    _sync_dir(target.parent)
    return result


def _workspace_path(target, update_id):
    parent = target.parent / ".scu" / _key(target)
    if _linked(parent.parent) or _linked(parent):
        raise UpdateError("The private update backup directory must not be linked or a junction.")
    # Keep the full update ID in the journal rather than adding it to every
    # runtime path. PostgreSQL's Windows file APIs still impose path limits.
    return parent / uuid.uuid4().hex


def _check_windows_runtime_paths(target, stage, entries):
    """Block native loader paths before copying any original installation."""
    if _host() != "windows-x86_64":
        return
    for relative in entries:
        if PurePosixPath(relative).suffix.casefold() not in {".dll", ".pyd", ".exe"}:
            continue
        parts = _relative(relative)
        for base in (target, stage):
            native_path = base.joinpath(*parts)
            # MAX_PATH includes the terminating NUL. Extended-path filesystem
            # support does not establish native DLL loader support.
            if len(str(native_path)) >= 260:
                raise UpdateError("A required Windows runtime file would have a path of 260 characters or more. "
                                  "Move the application to a shorter parent folder and retry. "
                                  "No backup or migration was started.")


def _pending(target):
    path = journal_path(target)
    if _linked(path):
        raise UpdateError("The recovery journal must not be a linked path.")
    if not path.exists():
        return None
    journal = _read_json(path)
    if journal.get("status") not in {"completed", "recovered", "blocked"}:
        return journal
    return None


def check(target, package=None, emit=None):
    package, manifest, entries = load_package(package, emit)
    target = _target(target)
    if package == target or package.is_relative_to(target) or target.is_relative_to(package):
        raise UpdateError("Keep the extracted updater outside the installed application folder.")
    with _locked(target):
        if _pending(target):
            raise UpdateError("An interrupted update exists. Use Recover before starting another update.")
        assert_closed(target)
        backend = _backend(target)
        inventory = _inventory(target, emit)
        report_dir = _workspace_path(target, manifest["update_id"])
        report_dir.mkdir(parents=True, mode=0o700)
        _secure_work(report_dir)
        _atomic(report_dir / "source-inventory.json", inventory)
        report_path = report_dir / "preflight.json"
        if backend == "excel":
            report = _run(package / "payload", manifest["migration_command"], target / "data", report_path,
                          ["--verify-only"], emit)
            if report.get("status") != "verified_source" or report.get("activated") is not False:
                raise UpdateError(f"The Excel source did not pass strict verification. Review: {report_path}")
        else:
            # A closed-cluster inventory is the read-only preflight; database
            # startup/readback is performed on a copied cluster during apply.
            report = {"status": "verified_closed_source", "backend": backend}
            _atomic(report_path, report)
        assert_closed(target)
        if _inventory(target) != inventory:
            raise UpdateError("The original installation changed during preflight. Close other programs and retry.")
        return {"type": "result", "status": "verified", "backend": backend, "report": str(report_path),
                "source_files": sum(v["kind"] == "file" for v in inventory.values()),
                "source_bytes": sum(v.get("size", 0) for v in inventory.values()), "verification": report}


def apply(target, package=None, emit=None):
    package, manifest, entries = load_package(package, emit)
    target = _target(target)
    if package == target or package.is_relative_to(target) or target.is_relative_to(package):
        raise UpdateError("Keep the extracted updater outside the installed application folder.")
    policy = _consolidation_policy(manifest)
    with _locked(target) as lock:
        if _pending(target):
            raise UpdateError("An interrupted update exists. Use Recover before starting another update.")
        assert_closed(target)
        backend = _backend(target)
        if policy and policy["remove_update_backups"]:
            _owned_backup_roots(target)
        original = _inventory(target, emit)
        work = _workspace_path(target, manifest["update_id"])
        # Exercise the full final basename without the old lengthy work root.
        stage = work / ("staged-" + target.name)
        _check_windows_runtime_paths(target, stage, entries)
        work.mkdir(parents=True, mode=0o700)
        _secure_work(work)
        # Exercise the final folder's characters before publication: Windows
        # runtime tools must handle the same Unicode and shell-sensitive name.
        backup, retired = work / "application-backup", work / "retired-installation"
        journal = {"format_version": 1, "status": "preflight", "target": str(target), "work": str(work),
                   "stage": str(stage), "backup": str(backup), "retired": str(retired),
                   "update_id": manifest["update_id"], "backend_before": backend,
                   "source_signature": hashlib.sha256(_json(original).encode()).hexdigest(),
                   "created_at": datetime.now(timezone.utc).isoformat(), "platform": manifest["platform"]}
        if policy:
            journal["consolidation"] = policy
            journal["probe_command"] = manifest["probe_command"]
            journal["application_command"] = manifest["application_command"]
        journal_file = journal_path(target)
        _atomic(work / "source-inventory.json", original)
        _atomic(journal_file, journal)
        try:
            source_report = work / "preflight.json"
            if backend == "excel":
                preflight = _run(package / "payload", manifest["migration_command"], target / "data", source_report,
                                 ["--verify-only"], emit)
                if preflight.get("status") != "verified_source" or preflight.get("activated") is not False:
                    raise UpdateError(f"The Excel source did not pass verification. Review: {source_report}")
            else:
                preflight = {"status": "verified_closed_source", "backend": backend}
                _atomic(source_report, preflight)
            assert_closed(target)
            if _inventory(target) != original:
                raise UpdateError("The original changed during preflight. No update was installed.")
            total = sum(v.get("size", 0) for v in original.values())
            payload_size = sum(v["size"] for v in entries.values())
            required = 2 * total + payload_size + max(256 * 1024 * 1024, total)
            if shutil.disk_usage(target.parent).free < required:
                raise UpdateError("Insufficient free space for verified backup, staging and the local database.")
            journal["status"] = "backing_up"
            _atomic(journal_file, journal)
            _copy(target, backup, original, emit, "backup")
            if _inventory(backup) != original or _inventory(target) != original:
                raise UpdateError("The whole application backup did not match the closed original.")
            _atomic(work / "backup-inventory.json", original)
            try:
                _copy(backup, stage, original, emit, "stage")
            except OSError as error:
                if error.errno == errno.ENAMETOOLONG or getattr(error, "winerror", None) == 206:
                    raise UpdateError("The staging path is too long. The verified original backup is preserved; use a shorter application path before retrying.") from error
                raise
            original_probe = None
            if backend == "managed-postgresql":
                original_probe = _verified_probe(_run(package / "payload", manifest["probe_command"],
                    stage / "data", work / "probe-before-install.json", [], emit, "database"))
                assert_closed(stage)
            retired_launchers = _overlay(stage, package, entries, emit,
                                        obsolete_files=manifest.get("obsolete_launcher_files", []))
            journal["retired_launchers"] = retired_launchers
            journal["retired_developer_files"] = _retire_developer(stage, manifest)
            if policy:
                _require_postgres_policy(stage)
            journal["status"] = "staged"
            _atomic(journal_file, journal)
            if backend == "excel":
                migration = _run(stage, manifest["migration_command"], stage / "data", work / "migration.json",
                                 ["--apply", "--final-data-dir", str(target / "data")], emit, "migration")
                if (migration.get("status") != "activated" or migration.get("activated") is not True
                        or migration.get("readback_verified") is not True
                        or migration.get("logical_sha256") != preflight.get("logical_sha256")
                        or migration.get("source_sha256") != preflight.get("source_sha256")):
                    raise UpdateError("Migration failed exact source/readback verification. The original remains preserved.")
            if _workspace_files(_inventory(stage)) != _workspace_files(original):
                raise UpdateError("A workbook, attachment, schema or setting changed in staging. Publication was blocked.")
            first = _verified_probe(_run(stage, manifest["probe_command"], stage / "data", work / "probe-first.json", [], emit, "startup"))
            second = _verified_probe(_run(stage, manifest["probe_command"], stage / "data", work / "probe-restart.json", [], emit, "restart"))
            if first.get("logical_sha256") != second.get("logical_sha256") or first.get("snapshot_sha256") != second.get("snapshot_sha256"):
                raise UpdateError("The database changed across clean shutdown/restart verification.")
            if original_probe and (original_probe["logical_sha256"] != second["logical_sha256"]
                                   or original_probe["snapshot_sha256"] != second["snapshot_sha256"]):
                raise UpdateError("The new application changed the copied PostgreSQL records or metadata.")
            if backend == "excel" and second["logical_sha256"] != preflight.get("logical_sha256"):
                raise UpdateError("The reopened database differs from the verified Excel records.")
            assert_closed(stage)
            assert_closed(target)
            if _inventory(target) != original:
                raise UpdateError("The original changed while staging. It was preserved; repeat the update after closing writers.")
            if _workspace_files(_inventory(stage)) != _workspace_files(original):
                raise UpdateError("Startup verification changed a preserved workspace file.")
            cleanup = None
            if policy:
                expected_hashes = _fingerprints(second)
                if _fingerprints(first) != expected_hashes or (original_probe and _fingerprints(original_probe) != expected_hashes):
                    raise UpdateError("Consolidation changed records, metadata or attachments before cleanup.")
                cleanup_check = work / "cleanup-check.json"
                reviewed = _run(stage, policy["cleanup_command"], stage / "data", cleanup_check,
                                ["--check"], emit, "cleanup")
                if reviewed.get("status") != "cleanup_ready" or _fingerprints(reviewed.get("verification_before", {})) != expected_hashes:
                    raise UpdateError("Cleanup preflight did not verify the staged PostgreSQL store.")
                before_cleanup = _inventory(stage)
                approved = _cleanup_paths(reviewed.get("cleanup_plan"), before_cleanup, stage)
                protected = _stable_inventory(before_cleanup, approved)
                cleanup = _run(stage, policy["cleanup_command"], stage / "data", work / "cleanup-apply.json",
                               ["--apply", "--plan", str(cleanup_check)], emit, "cleanup")
                if (cleanup.get("status") != "consolidated" or cleanup.get("cleanup_plan") != reviewed["cleanup_plan"]
                        or _fingerprints(cleanup.get("verification_before", {})) != expected_hashes
                        or _fingerprints(cleanup.get("verification_after", {})) != expected_hashes):
                    raise UpdateError("Cleanup failed the exact reviewed plan or PostgreSQL readback.")
                if _stable_inventory(_inventory(stage)) != protected:
                    raise UpdateError("Cleanup changed an unapproved application file or retained an obsolete file.")
                second = _verified_probe(_run(stage, manifest["probe_command"], stage / "data", work / "probe-cleaned.json", [], emit, "restart"))
                if _fingerprints(second) != expected_hashes or _stable_inventory(_inventory(stage)) != protected:
                    raise UpdateError("The cleaned application changed across restart verification.")
                assert_closed(stage)
                journal["cleanup"] = {key: cleanup[key] for key in ("removed_files", "removed_directories", "removed_bytes", "protected_files", "retained_excel_files") if key in cleanup}
                assert_closed(target)
                if _inventory(target) != original:
                    raise UpdateError("The original changed during cleanup. The staged update was not published.")
            staged_inventory = _inventory(stage)
            _sync_tree(stage)
            _atomic(work / "staged-inventory.json", staged_inventory)
            journal.update(status="ready", logical_sha256=second["logical_sha256"],
                           snapshot_sha256=second.get("snapshot_sha256"),
                           stage_signature=hashlib.sha256(_json(staged_inventory).encode()).hexdigest(),
                           application_command=manifest["application_command"], report=str(work / "probe-restart.json"))
            _atomic(journal_file, journal)
            _event(emit, "publish", "Publishing the verified installation")
            journal["status"] = "moving_original"
            _atomic(journal_file, journal)
            os.replace(target, retired)
            _sync_dir(target.parent)
            journal["status"] = "original_moved"
            _atomic(journal_file, journal)
            os.replace(stage, target)
            _sync_dir(target.parent)
            journal["status"] = "published"
            _atomic(journal_file, journal)
            # Publication is the boundary: no later failure may restore old Excel.
            if policy:
                _require_postgres_policy(target)
                verifier = _verification_root(target, work, manifest["probe_command"], emit, staged_inventory)
                final = _verified_probe(_run(verifier, manifest["probe_command"], target / "data", work / "probe-published.json", [], emit, "published"))
                if _fingerprints(final) != _fingerprints(second) or _stable_inventory(_inventory(target)) != _stable_inventory(staged_inventory):
                    raise UpdateError("Published PostgreSQL verification failed. The current application and recovery copies were retained.")
                assert_closed(target)
                if policy["remove_update_backups"]:
                    result = _finish_consolidation(target, journal, final, emit, journal.get("cleanup"))
                    lock["remove_lock"] = True
                    return result
                second = final
            journal["status"] = "completed"
            journal["completed_at"] = datetime.now(timezone.utc).isoformat()
            _atomic(journal_file, journal)
            result = {"type": "result", "status": "completed", "backend": "managed-postgresql",
                      "backup": str(backup), "report": journal["report"], "work": str(work),
                      "launch_command": _command(target, manifest["application_command"]), "verification": second,
                      "retired_launchers": retired_launchers}
            _atomic(work / "update-result.json", result)
            return result
        except Exception as error:
            # Keep crash state intact if either rename may have happened.
            if journal["status"] not in {"moving_original", "original_moved", "published", "cleanup_pending", "completed"}:
                journal["status"] = "blocked"
                _atomic(journal_file, journal)
            for field, value in (("backup", str(backup)), ("work", str(work))):
                setattr(error, field, value)
            if not getattr(error, "report", None):
                if journal.get("status") == "cleanup_pending" and (target / _RECEIPT).is_file():
                    error.report = str(target / _RECEIPT)
                for name in ("probe-published.json", "probe-cleaned.json", "cleanup-apply.json", "cleanup-check.json", "probe-restart.json", "probe-first.json", "migration.json", "preflight.json"):
                    if not getattr(error, "report", None) and (work / name).is_file():
                        error.report = str(work / name)
                        break
            raise


def _validated_journal(target):
    path = journal_path(target)
    if _linked(path):
        raise UpdateError("The recovery journal must not be a linked path.")
    journal = _read_json(path)
    if (journal.get("format_version") != 1 or journal.get("target") != str(target)
            or journal.get("platform") != _host()):
        raise UpdateError("The recovery journal does not belong to this installation/platform.")
    policy = _consolidation_policy(journal)
    if policy:
        for name in ("probe_command", "application_command"):
            command = journal.get(name)
            if (not isinstance(command, list) or not command
                    or any(not isinstance(arg, str) or "\x00" in arg for arg in command)):
                raise UpdateError("Invalid recovery command.")
            for arg in command:
                if not arg.startswith("--"):
                    _relative(arg)
    work = Path(journal.get("work", ""))
    allowed_parents = {target.parent / name / _key(target)
                       for name in (".scu", ".schemacraft-update-backups")}
    if not work.is_absolute() or work.parent not in allowed_parents:
        raise UpdateError("Unsafe recovery workspace.")
    expected_parent = work.parent
    for directory in (expected_parent, expected_parent.parent, work):
        if _linked(directory):
            raise UpdateError("Linked recovery parent directories are unsafe.")
    if not work.is_absolute() or work.parent != expected_parent or _linked(work):
        raise UpdateError("Unsafe recovery workspace.")
    # Retain recovery compatibility with earlier releases' literal 'staged'
    # folder while accepting only the current target-derived stage name.
    allowed_stages = {str(work / "staged"), str(work / ("staged-" + target.name))}
    if journal.get("stage") not in allowed_stages or _linked(Path(journal["stage"])):
        raise UpdateError("Unsafe recovery directory.")
    for name, suffix in (("backup", "application-backup"), ("retired", "retired-installation")):
        if journal.get(name) != str(work / suffix) or _linked(work / suffix):
            raise UpdateError("Unsafe recovery directory.")
    if journal.get("status") in {"moving_original", "original_moved", "published"}:
        for filename, field in (("source-inventory.json", "source_signature"), ("staged-inventory.json", "stage_signature")):
            inventory = _read_json(work / filename)
            digest = hashlib.sha256(_json(inventory).encode()).hexdigest()
            if not isinstance(inventory, dict) or digest != journal.get(field):
                raise UpdateError("A sealed recovery inventory changed. No historical data was restored.")
    return journal


def _recover_consolidation(target, journal, emit):
    policy = _consolidation_policy(journal)
    if not policy or not policy["remove_update_backups"]:
        return None
    # Publication made this database authoritative. User edits made after an
    # interruption are verified as they stand and never compared to old Excel.
    assert_closed(target)
    if _backend(target) != "managed-postgresql":
        raise UpdateError("The published PostgreSQL deployment is unavailable; recovery copies were preserved.")
    _require_postgres_policy(target)
    work = Path(journal["work"])
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    _secure_work(work)
    verifier = _verification_root(target, work, journal["probe_command"], emit)
    verification = _verified_probe(_run(verifier, journal["probe_command"], target / "data",
                                       work / "probe-recovery.json", [], emit, "recovery"))
    assert_closed(target)
    return _finish_consolidation(target, journal, verification, emit)


def recover(target, package=None, emit=None):
    # Recovery never depends on the package still being present and never
    # reapplies migration. It uses only the sealed pre-publication inventories.
    target = _target(target, required=False)
    with _locked(target) as lock:
        journal = _validated_journal(target)
        work, stage, retired = Path(journal["work"]), Path(journal["stage"]), Path(journal["retired"])
        state = journal["status"]
        if state == "completed":
            raise UpdateError("This update completed. Automatic downgrade is disabled to protect subsequent PostgreSQL edits.")
        if state == "cleanup_pending":
            if not target.is_dir():
                raise UpdateError("The published installation is missing; cleanup cannot safely continue.")
            result = _recover_consolidation(target, journal, emit)
            if result is None:
                raise UpdateError("A cleanup journal has no approved consolidation policy.")
            lock["remove_lock"] = True
            return result
        if state in {"blocked", "recovered", "preflight", "backing_up", "staged", "ready"}:
            if not target.is_dir():
                raise UpdateError("The original installation is missing; preserve the recovery folder for review.")
            assert_closed(target)
            journal["status"] = "recovered"
            _atomic(journal_path(target), journal)
            return {"type": "result", "status": "recovered", "message": "The unchanged original installation is available.",
                    "backup": journal["backup"], "report": str(work / "preflight.json")}
        if state not in {"moving_original", "original_moved", "published"}:
            raise UpdateError("Unknown recovery state; no installation was changed.")
        _event(emit, "recovery", "Inspecting the interrupted directory cutover")
        if target.exists():
            assert_closed(target)
            if retired.exists():
                # The staged app may already have been used after interruption.
                # Preserve it unconditionally; a hash change must never trigger
                # restoration of historical Excel data.
                if _backend(target) != "managed-postgresql":
                    raise UpdateError("Publication state is uncertain. Both directories were preserved for review.")
                result = _recover_consolidation(target, journal, emit)
                if result is not None:
                    lock["remove_lock"] = True
                    return result
                journal["status"] = "completed"
                journal["recovered_publication"] = True
                _atomic(journal_path(target), journal)
                return {"type": "result", "status": "completed", "backup": journal["backup"],
                        "report": journal.get("report", str(work / "probe-restart.json")),
                        "launch_command": _command(target, journal["application_command"])}
            expected = _read_json(work / "source-inventory.json")
            if _inventory(target) != expected:
                raise UpdateError("The original changed during interruption; preserve it for review.")
            journal["status"] = "recovered"
            _atomic(journal_path(target), journal)
            return {"type": "result", "status": "recovered", "backup": journal["backup"], "message": "Original installation retained."}
        if not retired.is_dir():
            raise UpdateError("Both active and original directories are missing; no automatic repair is safe.")
        if state == "published" or not stage.is_dir():
            raise UpdateError("A database installation may already have been published. Historical data was not restored; preserve both backups for review.")
        assert_closed(retired)
        source = _read_json(work / "source-inventory.json")
        if _inventory(retired) != source:
            raise UpdateError("The retained original changed. No directory was overwritten.")
        if stage.is_dir() and _inventory(stage) == _read_json(work / "staged-inventory.json"):
            assert_closed(stage)
            os.replace(stage, target)
            _sync_dir(target.parent)
            journal["status"] = "published"
            _atomic(journal_path(target), journal)
            result = _recover_consolidation(target, journal, emit)
            if result is not None:
                lock["remove_lock"] = True
                return result
            journal["status"] = "completed"
            journal["recovered_publication"] = True
            _atomic(journal_path(target), journal)
            return {"type": "result", "status": "completed", "backup": journal["backup"],
                    "report": journal.get("report", str(work / "probe-restart.json")),
                    "launch_command": _command(target, journal["application_command"])}
        # No database installation has been published or edited at the target.
        os.replace(retired, target)
        _sync_dir(target.parent)
        journal["status"] = "recovered"
        _atomic(journal_path(target), journal)
        return {"type": "result", "status": "recovered", "backup": journal["backup"],
                "message": "The unchanged original installation was restored before publication."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--package", type=Path)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--check", action="store_true")
    actions.add_argument("--apply", action="store_true")
    actions.add_argument("--recover", action="store_true")
    args = parser.parse_args(argv)
    def emit(event):
        print(json.dumps(event, ensure_ascii=False), flush=True)
    try:
        operation = recover if args.recover else apply if args.apply else check
        result = operation(args.target, args.package, emit)
        emit(result)
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, UpdateError) else f"Update stopped: {type(error).__name__}. The recovery journal was preserved."
        result = {"type": "result", "status": "blocked", "message": message}
        for field in ("report", "backup", "work"):
            if getattr(error, field, None):
                result[field] = getattr(error, field)
        emit(result)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
