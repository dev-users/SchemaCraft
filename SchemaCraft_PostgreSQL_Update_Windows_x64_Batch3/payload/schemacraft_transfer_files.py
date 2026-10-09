"""Recoverable, exclusively published portable attachments and SQL markers.

New files retain a durable private staging hard link until SQL commit is known.
Rollback removes a target only when it is still the exact staged inode. Existing
files are never overwritten, and a collision can never make rollback delete one.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from contextlib import nullcontext
from pathlib import Path, PurePosixPath

VERSION = 2
_HEX_ID = re.compile(r"[0-9a-f]{32}")
_HASH = re.compile(r"[0-9a-f]{64}")


def _sync_directory(path):
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _save(path, payload):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _safe_join(root, relative):
    if type(relative) is not str or not relative or "\\" in relative or ":" in relative or any(ord(char) < 32 for char in relative):
        raise ValueError("Unsafe attachment transaction path")
    parts = PurePosixPath(relative)
    if parts.is_absolute() or ".." in parts.parts or parts.as_posix() != relative:
        raise ValueError("Unsafe attachment transaction path")
    path = root
    for component in parts.parts:
        path = path / component
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ValueError("Attachment transaction uses a symlink")
    if root.resolve() not in path.resolve().parents:
        raise ValueError("Attachment transaction leaves its workspace")
    return path


def _target(root, relative):
    path = _safe_join(root, relative)
    parts = PurePosixPath(relative).parts
    if not ((len(parts) >= 2 and parts[0] == "attachments") or
            (len(parts) >= 4 and parts[0] == "schemas" and parts[2] == "attachments")):
        raise ValueError("Attachment transaction target is not an attachment")
    return path


def _stage(root, transaction_id, relative):
    path = _safe_join(root, relative)
    parts = PurePosixPath(relative).parts
    if len(parts) != 4 or parts[:3] != (".postgresql", "file-transactions", transaction_id) or not re.fullmatch(r"[0-9a-f]{32}\.stage", parts[3]):
        raise ValueError("Unsafe attachment transaction stage")
    return path


def _digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def _matches(path, entry):
    return path.is_file() and not path.is_symlink() and path.stat().st_size == entry["size"] and _digest(path) == entry["sha256"]


def _validate(root, journal, state):
    if type(state) is not dict or state.get("version") != VERSION or not _HEX_ID.fullmatch(str(state.get("id", ""))) or type(state.get("files")) is not list:
        raise ValueError("Invalid attachment transaction journal")
    if "rollback_complete" in state and type(state["rollback_complete"]) is not bool:
        raise ValueError("Invalid attachment transaction rollback state")
    transaction_id = state["id"]
    if journal.name != transaction_id + ".json" or journal.is_symlink():
        raise ValueError("Attachment transaction journal identity mismatch")
    targets, stages, entries = set(), set(), []
    for entry in state["files"]:
        if type(entry) is not dict or set(entry) != {"target", "stage", "size", "sha256"} or type(entry["size"]) is not int or entry["size"] < 0 or not _HASH.fullmatch(str(entry["sha256"])):
            raise ValueError("Invalid attachment transaction file manifest")
        target = _target(root, entry["target"])
        stage = _stage(root, transaction_id, entry["stage"])
        if entry["target"] in targets or entry["stage"] in stages:
            raise ValueError("Duplicate attachment transaction path")
        targets.add(entry["target"])
        stages.add(entry["stage"])
        entries.append((entry, target, stage))
    return entries


def _same_file(first, second):
    try:
        return first.is_file() and second.is_file() and os.path.samefile(first, second)
    except OSError:
        return False


def _remove_stages(root, state):
    # This UUID directory was exclusively created. A crash can leave partial
    # stage files before journal publication; remove only our flat naming format.
    stage_dir = _safe_join(root, ".postgresql/file-transactions/" + state["id"])
    if stage_dir.exists():
        for path in stage_dir.iterdir():
            if path.is_symlink() or not path.is_file() or not re.fullmatch(r"[0-9a-f]{32}\.stage", path.name):
                raise ValueError("Unexpected file in attachment transaction staging directory")
        for path in stage_dir.iterdir():
            path.unlink()
        _sync_directory(stage_dir)
        stage_dir.rmdir()
        _sync_directory(stage_dir.parent)


def _finish(root, journal, state, committed):
    # Validate the whole journal and every committed target before touching files.
    entries = _validate(root, journal, state)
    if committed:
        if state.get("rollback_complete"):
            raise ValueError("Attachment journal rollback state contradicts its SQL commit marker")
        for entry, target, stage in entries:
            if not _matches(target, entry):
                raise ValueError("A committed portable attachment is missing or has different content")
    elif not state.get("rollback_complete"):
        for entry, target, stage in entries:
            if stage.exists() and not _matches(stage, entry):
                raise ValueError("An attachment staging file has different content; recovery requires review")
            if target.exists() and not stage.exists():
                raise ValueError("Attachment rollback ownership cannot be verified; recovery requires review")
        for entry, target, stage in entries:
            if _same_file(target, stage):
                target.unlink()
                _sync_directory(target.parent)
            # Different destination inodes are collisions/replacements, never ours.
        # Crash after deleting our targets and cleaning stages can leave the
        # journal. Record that deletion finished before removing ownership proof.
        state["rollback_complete"] = True
        _save(journal, state)
    _remove_stages(root, state)
    journal.unlink(missing_ok=True)
    _sync_directory(journal.parent)


def _durable_marker(store, transaction_id):
    context = getattr(store, "_transaction_state", None)
    if context is not None and context.get() is not None:
        raise ValueError("Attachment recovery requires a completed SQL transaction")
    # A lost COMMIT response does not prove rollback. The original backend may
    # still be completing COMMIT; acquire the same writer lock on a fresh SQL
    # transaction before deciding that its immutable marker is absent.
    transaction = getattr(store, "transaction", None)
    with transaction() if transaction is not None else nullcontext():
        marker = store.get_metadata("file_transaction:" + transaction_id)
    if marker not in (None, "committed"):
        raise ValueError("Invalid durable attachment transaction marker")
    return marker


def _acquire_lock(path, *, exclusive_create=False):
    flags = os.O_RDWR | os.O_CREAT
    if exclusive_create:
        flags |= os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    stream = os.fdopen(descriptor, "r+b")
    try:
        if stream.seek(0, 2) == 0:
            stream.write(b"\0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except OSError:
        stream.close()
        return None


def recover(data_dir, store):
    root = Path(data_dir).resolve()
    area = _safe_join(root, ".postgresql/file-transactions")
    if not area.is_dir():
        return
    for journal in sorted(area.glob("*.json")):
        if journal.is_symlink():
            raise ValueError("Attachment transaction journal uses a symlink")
        state = json.loads(journal.read_text(encoding="utf-8"))
        _validate(root, journal, state)
        lock_path = _safe_join(root, ".postgresql/file-transactions/" + state["id"] + ".lock")
        stream = _acquire_lock(lock_path)
        if stream is None:
            continue
        try:
            if journal.exists():
                # The active owner may have published a newer journal while we
                # were inspecting its filename; re-read under exclusive lock.
                state = json.loads(journal.read_text(encoding="utf-8"))
                _validate(root, journal, state)
                committed = _durable_marker(store, state["id"]) == "committed"
                _finish(root, journal, state, committed)
        finally:
            stream.close()
        # Keep lock files stable while journals exist. They can be removed once
        # this immutable UUID's journal is durably gone.
        if not journal.exists():
            lock_path.unlink(missing_ok=True)
            _sync_directory(area)


class AttachmentTransaction:
    def __init__(self, data_dir, store):
        self.root = Path(data_dir).resolve()
        self.store = store
        self.state = {"version": VERSION, "id": uuid.uuid4().hex, "files": []}
        area = _safe_join(self.root, ".postgresql/file-transactions")
        area.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.stage_dir = area / self.state["id"]
        self.stage_dir.mkdir(mode=0o700)
        self.journal = area / (self.state["id"] + ".json")
        self.lock_path = area / (self.state["id"] + ".lock")
        self._lock_stream = _acquire_lock(self.lock_path, exclusive_create=True)
        if self._lock_stream is None:
            raise ValueError("Could not acquire portable attachment transaction ownership")
        try:
            _save(self.journal, self.state)
        except Exception:
            self.abandon()
            raise
        self.durable = False

    def add(self, path, content):
        if self.durable or self.state.get("rollback_complete") or self._lock_stream is None:
            raise ValueError("Attachment transaction is no longer active")
        if not isinstance(content, bytes):
            raise ValueError("Portable attachment content must be bytes")
        relative = Path(path).relative_to(self.root).as_posix()
        path = _target(self.root, relative)
        if any(entry["target"] == relative for entry in self.state["files"]):
            raise ValueError("Duplicate attachment transaction destination")
        if path.exists():
            raise FileExistsError("Portable attachment destination already exists")
        stage = self.stage_dir / (uuid.uuid4().hex + ".stage")
        descriptor = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        _sync_directory(self.stage_dir)
        entry = {"target": relative, "stage": stage.relative_to(self.root).as_posix(),
                 "size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        self.state["files"].append(entry)
        _save(self.journal, self.state)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic and exclusive on NTFS/normal Unix filesystems. Unsupported
        # filesystems or volume mismatches fail closed without publishing a file.
        os.link(stage, path)
        _sync_directory(path.parent)

    def mark_commit(self):
        if self._lock_stream is None or self.state.get("rollback_complete"):
            raise ValueError("Attachment transaction is no longer active")
        context = getattr(self.store, "_transaction_state", None)
        if context is not None and context.get() is None:
            raise ValueError("Attachment commit marker requires the record SQL transaction")
        entries = _validate(self.root, self.journal, self.state)
        if any(not _matches(target, entry) or not _same_file(target, stage) for entry, target, stage in entries):
            raise ValueError("Portable attachments changed before database commit")
        self.store.set_metadata("file_transaction:" + self.state["id"], "committed")

    def finalize(self):
        try:
            context = getattr(self.store, "_transaction_state", None)
            if context is not None and context.get() is not None:
                raise ValueError("Attachment finalization requires a completed SQL commit")
            if self.store.get_metadata("file_transaction:" + self.state["id"]) != "committed":
                raise ValueError("Attachment finalization has no committed SQL marker")
            self.durable = True
            _finish(self.root, self.journal, self.state, committed=True)
        finally:
            self.abandon()

    def rollback(self):
        if self.durable:
            self.abandon()
            return
        try:
            try:
                marker = _durable_marker(self.store, self.state["id"])
            except Exception:
                # Unknown commit outcome or unavailable database: leave all
                # ownership/content evidence for the next successful recovery.
                self.recovery_pending = True
                return
            if marker == "committed":
                self.durable = True
                _finish(self.root, self.journal, self.state, committed=True)
            else:
                _finish(self.root, self.journal, self.state, committed=False)
        finally:
            self.abandon()

    def abandon(self):
        """Release a live lease without deciding recovery (also useful to tests)."""
        stream = getattr(self, "_lock_stream", None)
        if stream is not None:
            stream.close()
            self._lock_stream = None
        if not self.journal.exists():
            self.lock_path.unlink(missing_ok=True)
            _sync_directory(self.lock_path.parent)
