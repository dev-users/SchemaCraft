"""Coordinate portable app launches with an atomic directory update.

The persistent lease file lives inside the application. A kernel-only gate
serializes lease acquisition with an updater's whole-directory replacement;
the gate continues to identify the same install even while its folder moves.
"""
from __future__ import annotations

import ctypes
import errno
import hashlib
import os
from pathlib import Path
import socket
import stat
import time


def folder_key(root: Path) -> str:
    return hashlib.sha256(str(Path(root).resolve()).casefold().encode("utf-8")).hexdigest()[:20]


def lock_path(root: Path) -> Path:
    return Path(root).resolve() / ".schemacraft-update.lock"


def legacy_lock_path(root: Path) -> Path:
    root = Path(root).resolve()
    return root.parent / (".schemacraft-update-lock-" + folder_key(root))


def linked_path(path: Path) -> bool:
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


class StableUpdateGate:
    """A crash-released kernel gate with no filesystem entry.

    Apps hold it only while acquiring their internal lease. Updaters hold it
    until publication and verification finish, including both directory moves.
    """
    def __init__(self, root: Path):
        self.key = folder_key(root)
        self.handle = None

    def acquire(self, timeout: float = 0.0) -> bool:
        if self.handle is not None:
            return True
        deadline = time.monotonic() + timeout
        if os.name == "nt":
            kernel = ctypes.windll.kernel32
            kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
            kernel.CreateMutexW.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            kernel.WaitForSingleObject.restype = ctypes.c_uint32
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel.CloseHandle.restype = ctypes.c_bool
            handle = kernel.CreateMutexW(None, False, "Local\\SchemaCraftUpdateGate-" + self.key)
            if not handle:
                raise ctypes.WinError()
            result = kernel.WaitForSingleObject(handle, max(0, int(timeout * 1000)))
            if result in (0, 0x80):
                self.handle = int(handle)
                return True
            kernel.CloseHandle(handle)
            if result != 0x102:
                raise OSError("The application update gate could not be acquired.")
            return False
        while True:
            handle = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                # Linux abstract sockets are kernel objects, not files in /tmp
                # or beside the app. The path hash keeps Unicode names short.
                handle.bind("\0SchemaCraftUpdateGate-" + self.key)
            except OSError as error:
                handle.close()
                if error.errno != errno.EADDRINUSE:
                    raise
                if time.monotonic() >= deadline:
                    return False
                time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))
            else:
                self.handle = handle
                return True

    def close(self) -> None:
        handle, self.handle = self.handle, None
        if handle is None:
            return
        if os.name == "nt":
            kernel = ctypes.windll.kernel32
            kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
            kernel.ReleaseMutex.restype = ctypes.c_bool
            kernel.ReleaseMutex(ctypes.c_void_p(handle))
            kernel.CloseHandle(ctypes.c_void_p(handle))
        else:
            handle.close()


class FileUpdateLease:
    """Shared on Linux for apps; exclusive for updater/Windows app leases."""
    def __init__(self, path: Path):
        self.path = Path(path)
        self.handle = None

    def acquire(self, *, exclusive: bool = False, create: bool = True) -> bool:
        if self.handle is not None:
            return True
        if linked_path(self.path):
            raise OSError("The application update lock must not be a symbolic link or junction.")
        flags = os.O_RDWR | (os.O_CREAT if create else 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        handle = os.fdopen(descriptor, "r+b")
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError("The application update lock is not a regular file.")
            if os.name == "nt":
                import msvcrt
                handle.seek(0, 2)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def close(self) -> None:
        handle, self.handle = self.handle, None
        if handle is not None:
            handle.close()


class ApplicationUpdateLease:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.path = lock_path(self.root)
        self.handle = None
        self._internal = FileUpdateLease(self.path)
        self._legacy = FileUpdateLease(legacy_lock_path(self.root))

    def acquire(self) -> bool:
        if self.handle is not None:
            return True
        gate = StableUpdateGate(self.root)
        if not gate.acquire(timeout=0.2):
            return False
        try:
            # Respect an older updater already holding its legacy file, but
            # never create that external file from a new application launch.
            try:
                if not self._legacy.acquire(create=False):
                    return False
            except FileNotFoundError:
                pass
            if not self._internal.acquire():
                self._legacy.close()
                return False
            self.handle = self._internal.handle
            return True
        except BaseException:
            self.close()
            raise
        finally:
            gate.close()

    def close(self) -> None:
        self._internal.close()
        self._legacy.close()
        self.handle = None
