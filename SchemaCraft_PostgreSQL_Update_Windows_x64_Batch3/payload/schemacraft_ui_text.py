"""Plain-text UI overrides and a recoverable, session-owned edit lease.

No schema, record or list-option values are accepted here. Overrides are stored
outside the application assets so frontend builds and updates cannot erase them.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
import time
from typing import Any

LOCK = threading.RLock()
LANGUAGES = ('ar', 'fa')
MAX_TEXT = 6000


class TextConflict(ValueError):
    """The saved catalog changed after this editor was opened."""


def defaults(app_dir: Path) -> dict[str, dict[str, str]]:
    path = app_dir / 'locales' / 'ui-defaults.json'
    content = json.loads(path.read_text(encoding='utf-8'))
    # The allowlist is generated from shipped UI only, never a workspace.
    result = {key: {'ar': value['ar'], 'fa': value['fa']} for key, value in content.items()
              if isinstance(key, str) and isinstance(value, dict)}
    try:
        legacy = json.loads((app_dir / 'ui_text.json').read_text(encoding='utf-8'))
        for key, value in legacy.items():
            if key in result and isinstance(value, str):
                result[key]['ar'] = value
    except (OSError, ValueError, AttributeError):
        pass
    return result


def snapshot(data_dir: Path) -> dict[str, Any]:
    path = data_dir / 'ui-text-overrides.json'
    with LOCK:
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            raw = b''
        payload = json.loads(raw) if raw else {'version': 1, 'overrides': {}}
        if not isinstance(payload, dict) or not isinstance(payload.get('overrides'), dict):
            raise ValueError('ملف نصوص الواجهة غير صالح؛ لم يتم استبداله.')
        for source, values in payload['overrides'].items():
            if (not isinstance(source, str) or not isinstance(values, dict)
                    or set(values) - set(LANGUAGES)
                    or any(not isinstance(text, str) for text in values.values())):
                raise ValueError('ملف نصوص الواجهة غير صالح؛ لم يتم استبداله.')
        return {'revision': hashlib.sha256(raw).hexdigest(), 'overrides': payload['overrides']}


def read_overrides(data_dir: Path) -> dict[str, dict[str, str]]:
    # A damaged customization must not stop the application from opening.
    try:
        return snapshot(data_dir)['overrides']
    except (OSError, ValueError):
        return {}


def validate(overrides: Any, catalog: dict) -> dict[str, dict[str, str]]:
    if not isinstance(overrides, dict) or len(overrides) > len(catalog):
        raise ValueError('نصوص الواجهة غير صالحة.')
    result = {}
    for source, translations in overrides.items():
        if source not in catalog or not isinstance(translations, dict):
            raise ValueError('يمكن تعديل نصوص الواجهة المسجلة فقط، وليس بيانات التصاميم.')
        if set(translations) - set(LANGUAGES):
            raise ValueError('لغة الواجهة غير مدعومة.')
        values = {}
        for language, text in translations.items():
            if not isinstance(text, str) or len(text) > MAX_TEXT:
                raise ValueError('نص الواجهة أطول من الحد المسموح.')
            if not text.strip():
                continue  # Empty means use the shipped wording.
            # Existing UI uses both textContent and HTML template literals. Do not
            # permit markup/attribute delimiters to become code in either sink.
            # Arabic/Persian quotation marks « » and typographic quotes are safe.
            if any(c in text for c in '<>&"\'`\\') or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
                raise ValueError('أدخل نصًا فقط دون رموز HTML أو اقتباسات برمجية؛ يمكن استخدام « » للاقتباس.')
            if Counter(re.findall(r'\{\d+\}', source)) != Counter(re.findall(r'\{\d+\}', text)):
                raise ValueError('احتفظ بعلامات القيم مثل {0} كما هي في النص الأصلي.')
            if text != catalog[source][language]:
                values[language] = text
        if values:
            result[source] = values
    return result


def save(data_dir: Path, expected_revision: str, overrides: Any, catalog: dict) -> dict:
    valid = validate(overrides, catalog)
    directory = Path(data_dir)
    with LOCK:
        current = snapshot(directory)
        if not secrets.compare_digest(str(expected_revision), current['revision']):
            raise TextConflict('تغيرت نصوص الواجهة في جلسة أخرى. افتح المحرر مجددًا قبل الحفظ.')
        directory.mkdir(parents=True, exist_ok=True)
        fd, filename = tempfile.mkstemp(prefix='.ui-text-', suffix='.json', dir=directory)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump({'version': 1, 'overrides': valid}, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(filename, directory / 'ui-text-overrides.json')
        finally:
            Path(filename).unlink(missing_ok=True)
        return snapshot(directory)


class EditLease:
    """Freeze mutations for the editing browser session; recover after a crash."""
    def __init__(self, clock=time.monotonic, timeout: float = 90):
        self.clock, self.timeout = clock, timeout
        self.lock = threading.RLock()
        self.owner = self.token = ''
        self.expires = 0.0

    def _expire(self):
        if self.clock() >= self.expires:
            self.owner = self.token = ''

    def start(self, owner: str) -> str:
        with self.lock:
            self._expire()
            if self.token:
                raise TextConflict('محرر نصوص الواجهة مفتوح بالفعل. أغلقه أو انتظر انتهاء الجلسة.')
            self.owner, self.token = owner, secrets.token_urlsafe(32)
            self.expires = self.clock() + self.timeout
            return self.token

    def check(self, owner: str, token: str) -> None:
        with self.lock:
            self._expire()
            if not self.token or self.owner != owner or not secrets.compare_digest(self.token, str(token)):
                raise PermissionError('انتهت جلسة تعديل النصوص. افتح المحرر مجددًا.')

    def touch(self, owner: str, token: str) -> None:
        with self.lock:
            self.check(owner, token)
            self.expires = self.clock() + self.timeout

    def finish(self, owner: str, token: str) -> None:
        with self.lock:
            self.check(owner, token)
            self.owner = self.token = ''
            self.expires = 0.0

    def blocks(self, owner: str) -> bool:
        with self.lock:
            self._expire()
            return bool(self.token and self.owner == owner)
