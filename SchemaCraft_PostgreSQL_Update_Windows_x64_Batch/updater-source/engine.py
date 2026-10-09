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
    for name in ("application_command", "migration_command", "probe_command"):
        command = manifest.get(name)
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
    return package, manifest, entries


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
        try:
            yield
        finally:
            if mutex:
                ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(mutex))
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


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
            pid = int(pid_path.read_text(encoding="ascii").splitlines()[0])
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


def _run(base, declared, data, report, action, emit=None, phase="preflight", timeout=14400):
    command = _command(base, declared) + ["--data-dir", str(data), "--report", str(report)] + action
    env = dict(os.environ)
    for key in ("SCHEMACRAFT_POSTGRES_BIN", "SCHEMACRAFT_POSTGRES_DEV", "PYTHONPATH", "PYTHONHOME"):
        env.pop(key, None)
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
        error = UpdateError(f"Verification blocked. Review the report: {report}")
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
    backend = config.get("backend")
    if backend not in {"excel", "managed-postgresql"}:
        raise UpdateError("Unsupported storage configuration; no database was replaced.")
    if backend == "managed-postgresql" and not (target / "data" / ".postgresql" / "deployment.json").is_file():
        raise UpdateError("The active PostgreSQL workspace has no deployment identity. Restore its matching backup first.")
    return backend


def _workspace_files(inventory):
    return {rel[5:]: value for rel, value in inventory.items()
            if rel.startswith("data/") and rel != "data/storage.json"
            and not rel.startswith("data/.postgresql/") and rel != "data/.postgresql"}


def _verified_probe(report):
    if (report.get("status") != "verified_backend" or report.get("backend") != "managed-postgresql"
            or report.get("readback_verified") is not True
            or not re.fullmatch(r"[0-9a-f]{64}", str(report.get("logical_sha256", "")))
            or not re.fullmatch(r"[0-9a-f]{64}", str(report.get("snapshot_sha256", "")))):
        raise UpdateError("The staged database did not pass its startup/readback verification.")
    return report


def _workspace_path(target, update_id):
    parent = target.parent / ".schemacraft-update-backups" / _key(target)
    if _linked(parent.parent) or _linked(parent):
        raise UpdateError("The private update backup directory must not be linked or a junction.")
    # Keep the full update ID in the journal rather than adding it to every
    # runtime path. PostgreSQL's Windows file APIs still impose path limits.
    return parent / uuid.uuid4().hex


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
    with _locked(target):
        if _pending(target):
            raise UpdateError("An interrupted update exists. Use Recover before starting another update.")
        assert_closed(target)
        backend = _backend(target)
        original = _inventory(target, emit)
        work = _workspace_path(target, manifest["update_id"])
        work.mkdir(parents=True, mode=0o700)
        _secure_work(work)
        # Exercise the final folder's characters before publication: Windows
        # runtime tools must handle the same Unicode and shell-sensitive name.
        stage = work / ("staged-" + target.name)
        backup, retired = work / "application-backup", work / "retired-installation"
        journal = {"format_version": 1, "status": "preflight", "target": str(target), "work": str(work),
                   "stage": str(stage), "backup": str(backup), "retired": str(retired),
                   "update_id": manifest["update_id"], "backend_before": backend,
                   "source_signature": hashlib.sha256(_json(original).encode()).hexdigest(),
                   "created_at": datetime.now(timezone.utc).isoformat(), "platform": manifest["platform"]}
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
            if journal["status"] not in {"moving_original", "original_moved", "published", "completed"}:
                journal["status"] = "blocked"
                _atomic(journal_file, journal)
            for field, value in (("backup", str(backup)), ("work", str(work))):
                setattr(error, field, value)
            if not getattr(error, "report", None):
                for name in ("probe-restart.json", "probe-first.json", "migration.json", "preflight.json"):
                    if (work / name).is_file():
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
    work = Path(journal.get("work", ""))
    expected_parent = target.parent / ".schemacraft-update-backups" / _key(target)
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


def recover(target, package=None, emit=None):
    # Recovery never depends on the package still being present and never
    # reapplies migration. It uses only the sealed pre-publication inventories.
    target = _target(target, required=False)
    with _locked(target):
        journal = _validated_journal(target)
        work, stage, retired = Path(journal["work"]), Path(journal["stage"]), Path(journal["retired"])
        state = journal["status"]
        if state == "completed":
            raise UpdateError("This update completed. Automatic downgrade is disabled to protect subsequent PostgreSQL edits.")
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
