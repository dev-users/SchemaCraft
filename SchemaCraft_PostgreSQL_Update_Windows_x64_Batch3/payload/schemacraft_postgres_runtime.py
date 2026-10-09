"""Own and supervise a private, loopback-only PostgreSQL 18 cluster.

The shipped runtime is outside PyInstaller's temporary extraction directory.
Database files and credentials live only under the selected data directory.
No machine-wide service, existing cluster, or company workbook is modified.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path


SUPPORTED_MAJOR = 18
MANIFEST_NAME = "runtime-manifest.json"
REQUIRED_TOOLS = ("postgres", "initdb", "pg_ctl", "pg_isready", "pg_controldata", "psql", "pg_dump", "pg_restore")


def prepare_packaged_process_environment(base_dir: Path) -> tuple[str, ...]:
    """Isolate a private portable process before driver imports or threads.

    This never changes machine/user environment settings. Source development
    runs retain their environment; deployed apps use their managed connection
    rather than unrelated libpq defaults inherited from the desktop.
    """
    if not (Path(base_dir) / "portable-runtime.json").is_file():
        return ()
    removed = []
    for name in tuple(os.environ):
        if name.upper().startswith("PG") or name.upper() == "PSYCOPG_IMPL":
            os.environ.pop(name, None)
            removed.append(name)
    return tuple(sorted(removed))


class PostgresRuntimeError(RuntimeError):
    """An actionable, credential-free local runtime failure."""


def _digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def _runtime_files(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise PostgresRuntimeError(f"Runtime must not contain symlinks: {path.relative_to(root)}")
        if path.is_file() and path != root / MANIFEST_NAME:
            result[path.relative_to(root).as_posix()] = _digest(path)
    return result


def _check_pe_x64(path: Path) -> None:
    """Reject a non-Windows or non-AMD64 binary before preparing a package."""
    try:
        with path.open("rb") as stream:
            if stream.read(2) != b"MZ":
                raise ValueError("missing DOS header")
            stream.seek(0x3C)
            offset = struct.unpack("<I", stream.read(4))[0]
            stream.seek(offset)
            if stream.read(4) != b"PE\0\0" or struct.unpack("<H", stream.read(2))[0] != 0x8664:
                raise ValueError("expected AMD64 PE header")
    except (OSError, ValueError, struct.error) as error:
        raise PostgresRuntimeError(f"Not a Windows x86-64 executable: {path.name}") from error


def validate_runtime_directory(runtime_dir: Path, *, expected_platform: str | None = None,
                               execute: bool = True) -> dict:
    """Verify the sealed file inventory, platform, binaries and major version.

    A manifest verifies integrity against a reviewed inventory; it is not a
    publisher signature. The release maintainer must verify its provenance.
    """
    root = Path(runtime_dir).resolve()
    try:
        manifest = json.loads((root / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PostgresRuntimeError(f"Missing or invalid PostgreSQL runtime manifest: {root / MANIFEST_NAME}") from error
    if not isinstance(manifest, dict) or manifest.get("format_version") != 1 or manifest.get("product") != "PostgreSQL":
        raise PostgresRuntimeError("Unsupported PostgreSQL runtime manifest format.")
    version = str(manifest.get("version", ""))
    if not re.fullmatch(r"18\.\d+", version) or manifest.get("major") != SUPPORTED_MAJOR:
        raise PostgresRuntimeError("This release requires a sealed PostgreSQL 18 runtime; major upgrades require a database migration.")
    target = manifest.get("platform")
    if target not in ("windows-x86_64", "linux-x86_64") or (expected_platform and target != expected_platform):
        raise PostgresRuntimeError(f"PostgreSQL runtime platform mismatch: expected {expected_platform}, received {target}.")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, dict) or not str(provenance.get("source_url", "")).startswith("https://") or not re.fullmatch(r"[0-9a-f]{64}", str(provenance.get("archive_sha256", ""))):
        raise PostgresRuntimeError("Runtime manifest lacks reviewed source URL and archive SHA-256 provenance.")
    inventory = manifest.get("files")
    if not isinstance(inventory, dict) or not inventory:
        raise PostgresRuntimeError("Runtime manifest contains no file inventory.")
    for name, digest in inventory.items():
        if not isinstance(name, str):
            raise PostgresRuntimeError("Unsafe path in PostgreSQL runtime manifest.")
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name or not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
            raise PostgresRuntimeError("Unsafe path or digest in PostgreSQL runtime manifest.")
        if relative.name in {"PG_VERSION", "postmaster.pid", "postgresql.auto.conf", "deployment.json", "pg_control"} or (len(relative.parts) > 1 and relative.parts[0] not in {"bin", "lib", "share", "include", "doc", "licenses", "symbols"}):
            raise PostgresRuntimeError("A PostgreSQL runtime must contain server files only, without database files or deployment credentials.")
    actual = _runtime_files(root)
    if actual != inventory:
        differing = sorted(set(actual) ^ set(inventory) | {name for name in set(actual) & set(inventory) if actual[name] != inventory[name]})
        raise PostgresRuntimeError(f"PostgreSQL runtime integrity check failed: {', '.join(differing[:8])}")
    suffix = ".exe" if target == "windows-x86_64" else ""
    for name in REQUIRED_TOOLS:
        binary = root / "bin" / (name + suffix)
        if not binary.is_file():
            raise PostgresRuntimeError(f"Incomplete PostgreSQL runtime: missing bin/{name}{suffix}.")
        if target == "windows-x86_64":
            _check_pe_x64(binary)
    for name in ("share", "lib"):
        if not (root / name).is_dir() or not any((root / name).rglob("*")):
            raise PostgresRuntimeError(f"Incomplete PostgreSQL runtime: missing populated {name} directory.")
    if execute:
        host = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
        if target != host or platform.machine().lower() not in ("amd64", "x86_64"):
            raise PostgresRuntimeError("The supplied PostgreSQL runtime cannot run on this computer.")
        for name in ("postgres", "initdb", "pg_ctl", "pg_dump", "pg_restore"):
            observed = _command([str(root / "bin" / (name + suffix)), "--version"], timeout=10).stdout
            match = re.search(r"\(PostgreSQL\)\s+(\d+\.\d+)", observed)
            if not match or match.group(1) != version:
                raise PostgresRuntimeError(f"PostgreSQL runtime version mismatch for {name}; manifest declares {version}.")
    return manifest


def seal_runtime_directory(runtime_dir: Path, *, version: str, source_url: str,
                           source_archive: Path, expected_archive_sha256: str,
                           target_platform: str = "windows-x86_64") -> Path:
    """Seal an explicitly supplied, independently reviewed vendor extraction."""
    root = Path(runtime_dir).resolve()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_archive_sha256) or _digest(Path(source_archive)) != expected_archive_sha256:
        raise PostgresRuntimeError("The supplied vendor archive does not match the expected SHA-256.")
    manifest = {"format_version": 1, "product": "PostgreSQL", "major": SUPPORTED_MAJOR,
                "version": version, "platform": target_platform,
                "provenance": {"source_url": source_url, "archive_sha256": expected_archive_sha256},
                "files": _runtime_files(root)}
    path = root / MANIFEST_NAME
    _write_json(path, manifest)
    validate_runtime_directory(root, expected_platform=target_platform, execute=False)
    return path


def _command(arguments: list[str], *, timeout: float = 60, env: dict | None = None,
             input_text: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    clean_env = {name: value for name, value in os.environ.items() if not name.startswith("PG")}
    clean_env.update({"LC_ALL": "C", "LANG": "C"})
    if env:
        clean_env.update(env)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        # pg_ctl can leave stdout/stderr handles open in its detached server.
        # Capture into files so completion waits only for the direct command,
        # without waiting for an inherited pipe to reach EOF in descendants.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            completed = subprocess.run(arguments, input=input_text,
                                       stdin=subprocess.DEVNULL if input_text is None else None,
                                       stdout=output, stderr=errors, text=True,
                                       encoding="utf-8", errors="replace", timeout=timeout,
                                       env=clean_env, creationflags=flags)
            output.seek(0)
            errors.seek(0)
            result = subprocess.CompletedProcess(completed.args, completed.returncode,
                                                  output.read().decode("utf-8", errors="replace"),
                                                  errors.read().decode("utf-8", errors="replace"))
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PostgresRuntimeError(f"PostgreSQL command {Path(arguments[0]).name} could not complete; check the local runtime and its log.") from error
    if check and result.returncode:
        # Command input can contain bootstrap secrets; never include it here.
        detail = (result.stderr or result.stdout).strip()[-1800:]
        if env:
            for name, secret in env.items():
                if "PASSWORD" in name and secret:
                    detail = detail.replace(secret, "[redacted]")
        raise PostgresRuntimeError(f"PostgreSQL command {Path(arguments[0]).name} failed: {detail}")
    return result


def _windows_account_sid() -> str:
    """Identify the ACL principal without decoding the localized account name."""
    message = "Could not identify the Windows account protecting the local database."
    try:
        result = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"],
                                capture_output=True, timeout=10,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PostgresRuntimeError(message) from error
    if result.returncode:
        raise PostgresRuntimeError(message)
    # whoami writes the account name in the Windows console's code page. The
    # SID remains ASCII in CSV and tabular output; icacls accepts it with '*'.
    identities = re.findall(rb'(?<![A-Za-z0-9-])(S-1-[0-9]+(?:-[0-9]+)+)(?![A-Za-z0-9-])', result.stdout)
    if len(identities) != 1:
        raise PostgresRuntimeError(message)
    return identities[0].decode("ascii")


def _write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            os.chmod(path, 0o600)
            descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def _process_key(pid: int) -> str | None:
    """Identify a live process including its start time to reject PID reuse."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        kernel.GetProcessTimes.restype = wintypes.BOOL
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.GetExitCodeProcess.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return None
        creation, exited, kernel_time, user_time = (wintypes.FILETIME() for _ in range(4))
        try:
            if not kernel.GetProcessTimes(handle, ctypes.byref(creation), ctypes.byref(exited), ctypes.byref(kernel_time), ctypes.byref(user_time)):
                return None
            code = wintypes.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
                return None
            return str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)
        finally:
            kernel.CloseHandle(handle)
    try:
        content = Path(f"/proc/{pid}/stat").read_text()
        # Fields after the closing parenthesis start at field 3; starttime is 22.
        tail = content[content.rfind(")") + 2:].split()
        return None if tail[0] == "Z" else tail[19]
    except (OSError, IndexError):
        return None


class ManagedPostgres:
    """Private cluster lifecycle, serialized across processes and safe to reuse."""

    def __init__(self, base_dir: Path, data_dir: Path, runtime_dir: Path | None = None):
        self.base_dir = Path(base_dir).resolve()
        self.data_dir = Path(data_dir).resolve()
        self.root = self.data_dir / ".postgresql"
        self.cluster_dir = self.root / "cluster"
        self.state_path = self.root / "deployment.json"
        self.log_path = self.root / "postgres.log"
        self.runtime_dir = Path(runtime_dir).resolve() if runtime_dir else self.base_dir / "runtime" / "postgresql"
        self._binary_dir: Path | None = None
        self._thread_lock = threading.RLock()
        self._lease_id = uuid.uuid4().hex
        self._started = False
        self._last_error: str | None = None

    @property
    def deployment_id(self) -> str | None:
        state = self._read_state(optional=True)
        return state.get("deployment_id") if state else None

    def _record_event(self, event: str, detail: str = "") -> None:
        """Append lifecycle failures without exposing stored credentials."""
        try:
            state = self._read_state(optional=True)
            if state:
                for key in ("app_password", "admin_password"):
                    detail = detail.replace(state[key], "[redacted]")
            entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     "schemacraft_runtime": event, "detail": detail}
            descriptor = os.open(self.log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except (OSError, PostgresRuntimeError):
            pass

    def _secure_root(self) -> None:
        for path in (self.root, self.cluster_dir, self.state_path, self.log_path,
                     self.root / "lifecycle.lock", self.root / "leases"):
            if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
                raise PostgresRuntimeError("Managed PostgreSQL paths must not be symlinks; refusing to adopt another deployment.")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != "nt":
            os.chmod(self.root, 0o700)
        else:
            identity = _windows_account_sid()
            _command(["icacls", str(self.root), "/inheritance:r", "/grant:r", f"*{identity}:(OI)(CI)F"], timeout=20)

    @contextlib.contextmanager
    def _locked(self):
        with self._thread_lock:
            self._secure_root()
            lock_path = self.root / "lifecycle.lock"
            descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
            with os.fdopen(descriptor, "r+b") as stream:
                if stream.seek(0, 2) == 0:
                    stream.write(b"\0")
                    stream.flush()
                deadline = time.monotonic() + 120
                while True:
                    try:
                        stream.seek(0)
                        if os.name == "nt":
                            import msvcrt
                            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        else:
                            import fcntl
                            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise PostgresRuntimeError("Another local database startup or shutdown is still running.")
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    stream.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def _resolve_binaries(self) -> None:
        override = os.environ.get("SCHEMACRAFT_POSTGRES_BIN")
        # Portable source launchers carry the same sealed runtime as frozen
        # releases. A development environment left over from testing must not
        # redirect an installed application to a machine-wide PostgreSQL.
        if (self.base_dir / "portable-runtime.json").is_file():
            override = None
        if override:
            if os.environ.get("SCHEMACRAFT_POSTGRES_DEV") != "1" or getattr(sys, "frozen", False):
                raise PostgresRuntimeError("A system PostgreSQL override requires explicit SCHEMACRAFT_POSTGRES_DEV=1 in a source development run.")
            binary_dir = Path(override).resolve()
            suffix = ".exe" if os.name == "nt" else ""
            for name in REQUIRED_TOOLS:
                if not (binary_dir / (name + suffix)).is_file():
                    raise PostgresRuntimeError(f"Development PostgreSQL binary is missing: {name}.")
            observed = _command([str(binary_dir / ("postgres" + suffix)), "--version"], timeout=10).stdout
            if not re.search(r"\(PostgreSQL\)\s+18\.\d+", observed):
                raise PostgresRuntimeError("Development PostgreSQL must use major version 18.")
            self._binary_dir = binary_dir
            return
        host = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
        validate_runtime_directory(self.runtime_dir, expected_platform=host)
        self._binary_dir = self.runtime_dir / "bin"

    def _tool(self, name: str) -> str:
        if self._binary_dir is None:
            self._resolve_binaries()
        return str(self._binary_dir / (name + (".exe" if os.name == "nt" else "")))

    def _read_state(self, *, optional: bool = False) -> dict | None:
        if not self.state_path.exists():
            if optional:
                return None
            raise PostgresRuntimeError("Local PostgreSQL deployment state is missing; the existing cluster has not been adopted.")
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
            uuid.UUID(state["deployment_id"])
            if state.get("format_version") != 1 or state.get("major") != SUPPORTED_MAJOR:
                raise ValueError("unsupported deployment version")
            if not isinstance(state["port"], int) or not 1024 <= state["port"] <= 65535:
                raise ValueError("invalid port")
            for key in ("app_password", "admin_password"):
                if not re.fullmatch(r"[A-Za-z0-9_-]{40,}", state[key]):
                    raise ValueError("invalid private credential")
            if state.get("cluster_system_id") is not None and not re.fullmatch(r"\d+", str(state["cluster_system_id"])):
                raise ValueError("invalid cluster identity")
            return state
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise PostgresRuntimeError("Local PostgreSQL deployment state is invalid; restore its matching backup rather than creating a new database.") from error

    @staticmethod
    def _free_port() -> int:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            return listener.getsockname()[1]

    @staticmethod
    def _port_available(port: int) -> bool:
        try:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False

    def _cluster_identity(self) -> str:
        if (self.cluster_dir / "PG_VERSION").read_text().strip() != str(SUPPORTED_MAJOR):
            raise PostgresRuntimeError("Existing local PostgreSQL data uses a different major version; an explicit database upgrade is required.")
        output = _command([self._tool("pg_controldata"), "-D", str(self.cluster_dir)], timeout=10).stdout
        match = re.search(r"Database system identifier:\s*(\d+)", output)
        if not match:
            raise PostgresRuntimeError("Could not verify the private PostgreSQL cluster identity.")
        return match.group(1)

    def _query(self, state: dict, sql: str, *, database: str = "postgres") -> str:
        try:
            result = _command([self._tool("psql"), "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                               "-h", "127.0.0.1", "-p", str(state["port"]), "-U", "sc_admin", "-d", database],
                              env={"PGPASSWORD": state["admin_password"], "PGCONNECT_TIMEOUT": "3"},
                              input_text=sql, timeout=15)
            return result.stdout.strip()
        except PostgresRuntimeError as error:
            raise PostgresRuntimeError(str(error).replace(state["admin_password"], "[redacted]").replace(state["app_password"], "[redacted]")) from None

    def _server_owned(self, state: dict) -> bool:
        try:
            result = self._query(state, "SELECT current_setting('data_directory'), system_identifier FROM pg_control_system();\n")
            directory, identifier = result.split("|", 1)
            return Path(directory).resolve() == self.cluster_dir.resolve() and identifier == str(state["cluster_system_id"])
        except (PostgresRuntimeError, ValueError):
            return False

    def _pid_running(self) -> bool:
        try:
            return _process_key(int((self.cluster_dir / "postmaster.pid").read_text().splitlines()[0])) is not None
        except (OSError, ValueError, IndexError):
            return False

    def _write_configuration(self, state: dict) -> None:
        # Config is regenerated only while stopped. Durability settings are never relaxed.
        config = ("# Managed by SchemaCraft; local connections only.\n"
                  "listen_addresses = '127.0.0.1'\n"
                  f"port = {state['port']}\n"
                  "unix_socket_directories = ''\n"
                  "password_encryption = 'scram-sha-256'\n"
                  "max_connections = 40\n"
                  "shared_buffers = '64MB'\n"
                  "fsync = on\n"
                  "synchronous_commit = on\n"
                  "full_page_writes = on\n"
                  "log_statement = 'none'\n"
                  "log_min_error_statement = 'panic'\n"
                  "log_line_prefix = '%m [%p] '\n"
                  "timezone = 'UTC'\n")
        (self.cluster_dir / "postgresql.conf").write_text(config, encoding="utf-8")
        (self.cluster_dir / "pg_hba.conf").write_text(
            "# Only SchemaCraft's password-authenticated local roles.\n"
            "host all sc_admin 127.0.0.1/32 scram-sha-256\n"
            "host schemacraft sc_app 127.0.0.1/32 scram-sha-256\n", encoding="utf-8")

    def _initialize(self, state: dict) -> None:
        password_file = self.root / (".bootstrap-" + uuid.uuid4().hex)
        descriptor = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(state["admin_password"] + "\n")
            _command([self._tool("initdb"), "-D", str(self.cluster_dir), "-U", "sc_admin", "--encoding=UTF8",
                      "--locale=C", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
                      "--data-checksums", "--pwfile=" + str(password_file)], timeout=120)
        finally:
            password_file.unlink(missing_ok=True)

    def _register_lease(self, state: dict) -> None:
        lease_dir = self.root / "leases"
        lease_dir.mkdir(exist_ok=True, mode=0o700)
        _write_json(lease_dir / (self._lease_id + ".json"),
                    {"pid": os.getpid(), "process_key": _process_key(os.getpid()),
                     "deployment_id": state["deployment_id"]})

    def _live_leases(self, state: dict) -> bool:
        live = False
        for path in (self.root / "leases").glob("*.json"):
            try:
                lease = json.loads(path.read_text())
                process_key = _process_key(int(lease["pid"]))
                if lease["deployment_id"] == state["deployment_id"] and process_key is not None and process_key == lease["process_key"]:
                    live = True
                    continue
            except (OSError, ValueError, KeyError, TypeError):
                pass
            path.unlink(missing_ok=True)
        return live

    @staticmethod
    def _dsn(state: dict) -> str:
        return f"host=127.0.0.1 port={state['port']} dbname=schemacraft user=sc_app password={state['app_password']} connect_timeout=5"

    def start(self) -> str:
        """Initialize if fresh, start/reuse this exact cluster, return app DSN."""
        try:
            with self._locked():
                self._record_event("starting")
                self._resolve_binaries()
                state = self._read_state(optional=True)
                if state is None:
                    if self.cluster_dir.exists() and any(self.cluster_dir.iterdir()):
                        raise PostgresRuntimeError("Existing PostgreSQL files have no deployment identity; refusing to initialize or adopt them.")
                    state = {"format_version": 1, "deployment_id": str(uuid.uuid4()), "major": SUPPORTED_MAJOR,
                             "port": self._free_port(), "app_password": secrets.token_urlsafe(48),
                             "admin_password": secrets.token_urlsafe(48), "cluster_system_id": None}
                    _write_json(self.state_path, state)
                if not (self.cluster_dir / "PG_VERSION").is_file():
                    if self.cluster_dir.exists() and any(self.cluster_dir.iterdir()):
                        raise PostgresRuntimeError("Local PostgreSQL initialization is incomplete. Preserve the folder and inspect its log before recovery.")
                    self._initialize(state)
                identity = self._cluster_identity()
                if state["cluster_system_id"] is None:
                    state["cluster_system_id"] = identity
                    _write_json(self.state_path, state)
                elif str(state["cluster_system_id"]) != identity:
                    raise PostgresRuntimeError("Deployment identity does not match the local database cluster; restore the matching backup.")
                if self._pid_running():
                    if not self._server_owned(state):
                        raise PostgresRuntimeError("A process is using the local cluster but its identity could not be verified; it was not stopped or adopted.")
                else:
                    if not self._port_available(state["port"]):
                        state["port"] = self._free_port()
                        _write_json(self.state_path, state)
                    self._write_configuration(state)
                    _command([self._tool("pg_ctl"), "-D", str(self.cluster_dir), "-l", str(self.log_path),
                              "-w", "-t", "60", "start"], timeout=75)
                    if not self._server_owned(state):
                        raise PostgresRuntimeError("Local PostgreSQL started but its authenticated identity could not be verified. Inspect postgres.log.")
                self._register_lease(state)
                self._started = True
                self._query(state, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sc_app') THEN "
                            f"CREATE ROLE sc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{state['app_password']}'; "
                            "END IF; END $$;\n"
                            f"ALTER ROLE sc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{state['app_password']}';\n")
                if self._query(state, "SELECT 1 FROM pg_database WHERE datname='schemacraft';\n") != "1":
                    self._query(state, "CREATE DATABASE schemacraft OWNER sc_app ENCODING 'UTF8' TEMPLATE template0;\n")
                self._last_error = None
                self._record_event("ready", f"deployment={state['deployment_id']} port={state['port']}")
                return self._dsn(state)
        except PostgresRuntimeError as error:
            if self._started:
                try:
                    self.stop()
                except PostgresRuntimeError:
                    pass
            self._last_error = str(error)
            self._record_event("startup_failed", self._last_error)
            raise

    def stop(self) -> None:
        """Release this app's lease; cleanly stop only our verified last-user cluster."""
        if not self._started:
            return
        try:
            with self._locked():
                state = self._read_state()
                (self.root / "leases" / (self._lease_id + ".json")).unlink(missing_ok=True)
                self._started = False
                if self._live_leases(state) or not self._pid_running():
                    self._record_event("lease_released")
                    return
                if self._cluster_identity() != str(state["cluster_system_id"]) or not self._server_owned(state):
                    raise PostgresRuntimeError("Local database shutdown was refused because ownership could not be verified; no unrelated process was stopped.")
                _command([self._tool("pg_ctl"), "-D", str(self.cluster_dir), "-m", "fast", "-w", "-t", "60", "stop"], timeout=75)
                self._record_event("stopped")
        except PostgresRuntimeError as error:
            self._last_error = str(error)
            self._record_event("shutdown_failed", self._last_error)
            raise

    def status(self) -> dict:
        """Return diagnostics suitable for UI display; never return credentials."""
        result = {"running": False, "ready": False, "owned": False, "initialized": False,
                  "deployment_id": None, "port": None, "log_path": str(self.log_path), "error": self._last_error}
        try:
            state = self._read_state(optional=True)
            if state:
                result.update(deployment_id=state["deployment_id"], port=state["port"],
                              initialized=(self.cluster_dir / "PG_VERSION").is_file())
                result["running"] = self._pid_running()
                if result["running"]:
                    result["owned"] = self._server_owned(state)
                    result["ready"] = result["owned"]
        except (PostgresRuntimeError, OSError) as error:
            result["error"] = str(error)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify or prepare an explicitly supplied PostgreSQL runtime; never download binaries.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    verify = subparsers.add_parser("verify-runtime")
    verify.add_argument("--runtime-dir", required=True, type=Path)
    verify.add_argument("--platform", default="windows-x86_64", choices=("windows-x86_64", "linux-x86_64"))
    verify.add_argument("--execute", action="store_true")
    seal = subparsers.add_parser("seal-runtime", help="Seal a vendor extraction after independent publisher/archive verification.")
    seal.add_argument("--runtime-dir", required=True, type=Path)
    seal.add_argument("--version", required=True)
    seal.add_argument("--source-url", required=True)
    seal.add_argument("--source-archive", required=True, type=Path)
    seal.add_argument("--expected-archive-sha256", required=True)
    seal.add_argument("--platform", default="windows-x86_64", choices=("windows-x86_64", "linux-x86_64"))
    install = subparsers.add_parser("install-runtime", help="Copy an already sealed runtime into this app; never copy data directories.")
    install.add_argument("--runtime-dir", required=True, type=Path)
    install.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "seal-runtime":
            path = seal_runtime_directory(args.runtime_dir, version=args.version, source_url=args.source_url,
                                          source_archive=args.source_archive, expected_archive_sha256=args.expected_archive_sha256,
                                          target_platform=args.platform)
            print(f"Sealed PostgreSQL runtime inventory: {path}")
        elif args.command == "install-runtime":
            validate_runtime_directory(args.runtime_dir, expected_platform="windows-x86_64", execute=False)
            destination = args.destination.resolve()
            if destination.exists():
                raise PostgresRuntimeError(f"Destination already exists; review and move the old runtime before replacement: {destination}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(args.runtime_dir, destination)
            validate_runtime_directory(destination, expected_platform="windows-x86_64", execute=False)
            print(f"Installed verified runtime files: {destination}")
        else:
            manifest = validate_runtime_directory(args.runtime_dir, expected_platform=args.platform, execute=args.execute)
            print(f"Verified PostgreSQL {manifest['version']} {manifest['platform']} ({len(manifest['files'])} files).")
        return 0
    except (PostgresRuntimeError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
