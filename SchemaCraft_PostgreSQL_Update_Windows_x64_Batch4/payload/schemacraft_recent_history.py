"""Workspace-backed recently opened records, independent of browser profiles."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
from typing import Any

HISTORY_FILENAME = 'recent-records.json'
MAXIMUM_ENTRIES = 500
_LOCK = threading.RLock()


def _text(value: Any, limit: int) -> str:
    return str(value or '').strip()[:limit]


def _read(data_dir: Path) -> list[dict[str, str]]:
    try:
        payload = json.loads((Path(data_dir) / HISTORY_FILENAME).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    raw_entries = payload.get('entries', []) if isinstance(payload, dict) else []
    if not isinstance(raw_entries, list):
        return []
    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_entries[:MAXIMUM_ENTRIES]:
        if not isinstance(raw, dict):
            continue
        code = _text(raw.get('code'), 160)
        schema_id = _text(raw.get('schema_id'), 160) or 'legacy'
        key = (schema_id, code)
        if not code or key in seen:
            continue
        seen.add(key)
        entries.append({
            'code': code,
            'schema_id': schema_id,
            'schema_name': _text(raw.get('schema_name'), 200),
            'title': _text(raw.get('title'), 1000),
            'opened_at': _text(raw.get('opened_at'), 80),
        })
    return entries


def _write(data_dir: Path, entries: list[dict[str, str]]) -> None:
    directory = Path(data_dir)
    directory.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.recent-records-', suffix='.tmp', dir=directory)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump({'version': 1, 'entries': entries[:MAXIMUM_ENTRIES]}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / HISTORY_FILENAME)
    finally:
        temporary.unlink(missing_ok=True)


def read(data_dir: Path) -> list[dict[str, str]]:
    with _LOCK:
        return _read(data_dir)


def remember(data_dir: Path, code: Any, schema_id: Any = 'legacy', *, title: Any = '', schema_name: Any = '') -> list[dict[str, str]]:
    clean_code = _text(code, 160)
    clean_schema = _text(schema_id, 160) or 'legacy'
    if not clean_code:
        return read(data_dir)
    with _LOCK:
        entries = [item for item in _read(data_dir) if (item['schema_id'], item['code']) != (clean_schema, clean_code)]
        entries.insert(0, {
            'code': clean_code,
            'schema_id': clean_schema,
            'schema_name': _text(schema_name, 200),
            'title': _text(title, 1000),
            'opened_at': datetime.now(timezone.utc).isoformat(),
        })
        entries = entries[:MAXIMUM_ENTRIES]
        _write(data_dir, entries)
        return entries


def remove(data_dir: Path, code: Any, schema_id: Any = 'legacy') -> list[dict[str, str]]:
    key = (_text(schema_id, 160) or 'legacy', _text(code, 160))
    with _LOCK:
        entries = _read(data_dir)
        retained = [item for item in entries if (item['schema_id'], item['code']) != key]
        if len(retained) != len(entries):
            _write(data_dir, retained)
        return retained


def clear(data_dir: Path) -> int:
    with _LOCK:
        count = len(_read(data_dir))
        _write(data_dir, [])
        return count
