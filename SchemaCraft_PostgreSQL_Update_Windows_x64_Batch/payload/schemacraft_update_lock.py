"""Coordinate an application launch with a graphical directory update."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path


def lock_path(root: Path) -> Path:
    root = Path(root).resolve()
    key = hashlib.sha256(str(root).casefold().encode("utf-8")).hexdigest()[:20]
    return root.parent / (".schemacraft-update-lock-" + key)


class ApplicationUpdateLease:
    def __init__(self, root: Path):
        self.path = lock_path(root)
        self.handle = None

    def acquire(self) -> bool:
        if self.handle is not None:
            return True
        handle = self.path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0, 2)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def close(self) -> None:
        if self.handle is not None:
            self.handle.close()
            self.handle = None
