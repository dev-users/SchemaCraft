"""Reviewed, profile-owned attachment inboxes.

Import is file-by-file and atomic. Assignment is a normal record save: inbox
status is derived from saved file references, so cancelling a draft or failing
workbook validation cannot consume an unassigned attachment. The index is
schema-local and never contains an arbitrary external filesystem path.
"""
from __future__ import annotations
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import time
import threading
import stat
import copy
import unicodedata

MAX_FILES = 2000
MAX_TICKETS = 12
TICKET_SECONDS = 2 * 60 * 60
FOLDERS: dict[str, dict] = {}
PICKER_LOCK = threading.Lock()
TICKETS: dict[str, dict] = {}  # Access only under the app's WORKBOOK_LOCK.


def _fail(A, text):
    raise A.ApplicationError(text)


def normalized(value):
    """Conservative exact matching, not fuzzy identity inference."""
    return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())


def _filename(A, value):
    if not isinstance(value, str) or not value or len(value) > 255 or value in {'.', '..'} or any(ord(c) < 32 for c in value) or '/' in value or '\\' in value:
        _fail(A, 'اسم المرفق غير صالح.')
    return value


def _index_path(A):
    return A.attachments_directory().parent / 'attachment-imports.json'


def read_index(A):
    path = _index_path(A)
    if path.is_symlink():
        _fail(A, 'مسار فهرس المرفقات غير آمن.')
    if not path.exists():
        return {'version': 1, 'entries': []}
    try:
        result = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(result, dict) or result.get('version') != 1 or not isinstance(result.get('entries'), list):
            raise ValueError('invalid index')
        if any(not isinstance(e, dict) or not all(isinstance(e.get(k), str) for k in ('id', 'record_code', 'record_id', 'path', 'name')) for e in result['entries']):
            raise ValueError('invalid item')
        return result
    except (ValueError, OSError) as exc:
        raise A.ApplicationError('تعذّر قراءة فهرس المرفقات. استعد النسخة الاحتياطية ولا تستبدل الفهرس يدويًا.') from exc


def write_index(A, data):
    path = _index_path(A)
    if path.is_symlink():
        _fail(A, 'مسار فهرس المرفقات غير آمن.')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.attachment-index-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def _safe_file(A, value):
    path = A.attachment_absolute_path(value)
    if path is None or path.is_symlink() or not path.resolve().is_relative_to(A.attachments_directory().resolve()):
        _fail(A, 'مسار ملف المرفق غير صالح.')
    return path


def pending(A, schema, record, index=None):
    if not record:
        return []
    index = read_index(A) if index is None else index
    used = A._record_file_paths(schema, record)
    result = []
    for e in index['entries']:
        if e['record_code'] != record['record_code'] or e['record_id'] != record['_record_id'] or e['path'] in used or set(e.get('assigned_paths', [])) & used:
            continue
        # Normal removal of a previously assigned file deletes its bytes. It
        # must not resurrect as a pending inbox item. Never follow symlinks.
        if not _safe_file(A, e['path']).is_file():
            continue
        result.append({k: e.get(k) for k in ('id', 'path', 'name', 'size', 'imported_at', 'notes')})
    return result


def assignment_paths(A, schema, record, payload):
    """Authorize only this profile's inbox paths for a normal record update."""
    inbox = {e['path']: e for e in pending(A, schema, record)} if record else {}
    if not inbox:
        return set()
    authorized = set()
    for cat in schema['categories']:
        rows = [payload.get('main', {})] if cat['kind'] == 'main' else [r.get('values', r) for r in payload.get('related', {}).get(cat['id'], []) if isinstance(r, dict)]
        for values in rows:
            if not isinstance(values, dict):
                continue
            for f in cat.get('fields', []):
                if f['type'] != 'file':
                    continue
                raw = values.get(f['id'], '')
                if isinstance(raw, dict) and raw.get('upload'):
                    continue
                path = A.attachment_relative_path(raw) if raw else ''
                if path not in inbox:
                    continue
                if record.get('archived'):
                    _fail(A, 'استعد السجل المؤرشف قبل إسناد المرفقات.')
                if path in authorized:
                    _fail(A, 'لا يمكن إسناد المرفق غير المسند إلى أكثر من حقل في الحفظ نفسه.')
                if isinstance(raw, dict) and raw.get('unassigned_id') and raw['unassigned_id'] != inbox[path]['id']:
                    _fail(A, 'مرجع المرفق غير المسند غير صالح.')
                if f.get('image_display') in {'profile', 'card'} and not re.search(r'\.(avif|bmp|gif|jpe?g|png|webp)$', inbox[path]['name'], re.I):
                    _fail(A, 'اختر ملف صورة صالحًا للمعاينة.')
                authorized.add(path)
    return authorized


def fields(A, schema, language='ar'):
    result = []
    for c in schema['categories']:
        if c['kind'] != 'main':
            continue
        for f in A.data_fields(c):
            if f['type'] == 'file':
                continue
            result.append({'id': f['id'], 'label': A.schemacraft_i18n.display_text(f, language), 'canonical_label': f['label'], 'category': A.schemacraft_i18n.display_text(c, language), 'category_id': c['id']})
    return result


def compile_pattern(A, schema, template):
    if not isinstance(template, str) or not template.strip() or len(template) > 2000:
        _fail(A, 'أدخل صيغة تسمية صالحة لا تتجاوز 2000 حرف.')
    allowed = {f['id']: f for c in schema['categories'] if c['kind'] == 'main' for f in A.data_fields(c) if f['type'] != 'file'}
    aliases = {'ID': {'record_code'}, 'record_code': {'record_code'}, 'معرّف السجل': {'record_code'}, 'شناسه رکورد': {'record_code'}}
    for fid, f in allowed.items():
        names = {fid, f['label']}
        for lang in ('ar', 'fa'):
            names.add(A.schemacraft_i18n.display_text(f, lang))
        cat = next(c for c in schema['categories'] if f in c.get('fields', []))
        for lang in ('ar', 'fa'):
            names.add(A.schemacraft_i18n.display_text(cat, lang) + ' / ' + A.schemacraft_i18n.display_text(f, lang))
        for name in names:
            aliases.setdefault(name, set()).add(fid)
    # Literal braces can be escaped; field IDs avoid ambiguity after renaming.
    tokens = re.findall(r'\{\{|\}\}|\{[^{}]+\}|[^{}]+|[{}]', template.strip())
    parts, refs = [], set()
    for token in tokens:
        if token in ('{{', '}}'):
            parts.append(('text', token[0]))
        elif token in ('{', '}'):
            _fail(A, 'الأقواس في صيغة التسمية غير مكتملة.')
        elif token.startswith('{'):
            key = token[1:-1].strip()
            matches = {key} if key in allowed else aliases.get(key, set())
            if len(matches) != 1:
                _fail(A, 'الحقل في صيغة التسمية مفقود أو اسمه مكرر. اختره من قائمة الحقول.')
            fid = next(iter(matches)); parts.append(('field', fid)); refs.add(fid)
        else:
            parts.append(('text', token))
    if not refs:
        _fail(A, 'أضف حقلًا واحدًا على الأقل إلى صيغة التسمية.')
    return parts


def _display(A, schema, rec, fid):
    if fid == 'record_code':
        return rec['record_code']
    f = A.schema_indexes(schema)['fields'][fid]
    if f['type'].startswith('system_'):
        key = {'system_record_id': 'record_code', 'system_created_at': 'created_at', 'system_updated_at': 'updated_at'}.get(f['type'])
        return str(rec.get(key, '')) if key else ''
    return A.schemacraft_composite_text.display(rec.get('values', {}).get(fid, ''), f)


def profile_title(A, schema, rec):
    fs = [f for c in schema['categories'] if c['kind'] == 'main' for f in A.data_fields(c) if f['type'] != 'file']
    selected = [f for f in fs if f.get('result_title')] or fs[:3]
    return ' · '.join(filter(None, (_display(A, schema, rec, f['id']) for f in selected)))[:800] or rec['record_code']


def _ticket(A, payload, owner):
    key = payload.get('token')
    ticket = TICKETS.get(key) if isinstance(key, str) else None
    if not ticket or ticket['expires'] < time.monotonic() or ticket['owner'] != owner or ticket['schema_id'] != A.current_schema_id() or ticket['root'] != str(A.attachments_directory().resolve()):
        _fail(A, 'انتهت معاينة المرفقات أو لا تعود إلى هذا التصميم. أعد المطابقة.')
    return ticket


def preview(A, payload, owner, language='ar'):
    schema = A.read_schema_file()
    folder = None
    if payload.get('folder_token'):
        folder = folder_ticket(A, payload['folder_token'], owner)
        names = [{'name': i['name'], 'size': i['size']} for i in folder['items']]
    else:
        names = payload.get('files')
    if not isinstance(names, list) or not 1 <= len(names) <= MAX_FILES:
        _fail(A, 'اختر بين ملف واحد و2000 ملف للدفعة.')
    checked = []
    for i, item in enumerate(names):
        if not isinstance(item, dict):
            _fail(A, 'بيانات المرفقات غير صالحة.')
        name = _filename(A, item.get('name'))
        size = item.get('size')
        if isinstance(size, bool) or not isinstance(size, int) or not 0 <= size <= A.MAX_ATTACHMENT_BYTES:
            _fail(A, 'حجم الملف يتجاوز 100 ميغابايت.')
        checked.append({'id': str(i), 'name': name, 'size': size})
    parts = compile_pattern(A, schema, payload.get('template'))
    records = {r['record_code']: r for r in A._dataset_snapshot_unlocked(schema).records if not r.get('archived')}
    profiles, lookup = {}, {}
    for code, rec in records.items():
        profiles[code] = {'record_code': code, 'title': profile_title(A, schema, rec), 'record_id': rec['_record_id'], 'updated_at': rec.get('updated_at', '')}
        values = {fid: _display(A, schema, rec, fid) for typ, fid in parts if typ == 'field'}
        # Missing keys must not create a plausible automatic match.
        if not all(str(v).strip() for v in values.values()):
            continue
        expected = ''.join(value if typ == 'text' else values[value] for typ, value in parts)
        lookup.setdefault(normalized(expected), []).append(code)
    result = []
    for item in checked:
        candidates = lookup.get(normalized(Path(item['name']).stem), [])
        result.append({**item, 'matches': [{'record_code': c, 'title': profiles[c]['title']} for c in candidates[:100]], 'match_count': len(candidates)})
    now = time.monotonic()
    for key in list(TICKETS):
        if TICKETS[key]['expires'] < now:
            del TICKETS[key]
    if len(TICKETS) >= MAX_TICKETS:
        oldest = min(TICKETS, key=lambda k: TICKETS[k]['expires']); del TICKETS[oldest]
    token = secrets.token_urlsafe(32)
    TICKETS[token] = {'owner': owner, 'schema_id': A.current_schema_id(), 'root': str(A.attachments_directory().resolve()), 'expires': now + TICKET_SECONDS, 'revision': schema.get('revision'), 'items': checked, 'profiles': profiles}
    if folder:
        TICKETS[token]['native_folder'] = folder
    return {'token': token, 'files': result, 'profile_count': len(profiles), 'expires_in': TICKET_SECONDS}


def profiles(A, payload, owner):
    ticket = _ticket(A, payload, owner)
    q = normalized(str(payload.get('query', ''))[:500])
    matches = [p for p in ticket['profiles'].values() if not q or q in normalized(p['title'] + ' ' + p['record_code'])]
    return {'profiles': [{'record_code': p['record_code'], 'title': p['title']} for p in matches[:100]], 'total': len(matches)}


def commit_file(A, payload, owner):
    ticket = _ticket(A, payload, owner)
    try:
        i = int(payload.get('item_id'))
    except (TypeError, ValueError):
        _fail(A, 'عنصر المرفق غير صالح.')
    if not 0 <= i < len(ticket['items']):
        _fail(A, 'عنصر المرفق غير صالح.')
    item = ticket['items'][i]
    code = payload.get('record_code')
    if not isinstance(code, str) or code not in ticket['profiles']:
        _fail(A, 'اختر سجلًا صالحًا لكل مرفق أو تجاهله قبل التنفيذ.')
    notes = payload.get('notes', '')
    if not isinstance(notes, str) or len(notes) > 4000 or any(ord(c) < 32 and c not in '\n\t\r' for c in notes):
        _fail(A, 'ملاحظات المرفق غير صالحة؛ الحد الأقصى 4000 حرف.')
    upload = payload.get('upload')
    if ticket.get('native_folder'):
        content = read_native_file(A, ticket['native_folder'], i)
        upload = {'name': item['name'], 'data': base64.b64encode(content).decode('ascii')}
    if not isinstance(upload, dict) or upload.get('name') != item['name'] or not isinstance(upload.get('data'), str):
        _fail(A, 'الملف المرفوع لا يطابق ملف المعاينة.')
    try:
        content = base64.b64decode(upload['data'], validate=True)
    except (ValueError, binascii.Error):
        _fail(A, 'تعذّر قراءة الملف.')
    if len(content) != item['size'] or len(content) > A.MAX_ATTACHMENT_BYTES:
        _fail(A, 'حجم الملف المرفوع لا يطابق المعاينة.')
    schema = A.read_schema_file()
    rec = A._dataset_snapshot_unlocked(schema).records_by_code.get(code)
    if not rec or rec.get('archived') or rec['_record_id'] != ticket['profiles'][code]['record_id']:
        _fail(A, 'السجل غير متاح. أعد المطابقة قبل الاستيراد.')
    if rec.get('updated_at', '') != ticket['profiles'][code]['updated_at'] or schema.get('revision') != ticket['revision']:
        _fail(A, 'تغير السجل أو التصميم منذ المعاينة. أعد المطابقة قبل الاستيراد.')
    index = read_index(A)
    digest = hashlib.sha256(content).hexdigest()
    key = hashlib.sha256((payload['token'] + ':' + item['id']).encode()).hexdigest()
    for entry in index['entries']:
        if entry.get('batch_item') == key:
            if entry['record_id'] != rec['_record_id'] or entry.get('sha256') != digest:
                _fail(A, 'تم استيراد هذا العنصر سابقًا إلى سجل مختلف. أعد المطابقة.')
            ticket.setdefault('completed', {}).setdefault(item['id'], {'record_code': code, 'name': item['name'], 'duplicate': True})
            return {'ok': True, 'duplicate': True, 'entry': entry}
        if entry['record_id'] == rec['_record_id'] and entry['record_code'] == code and entry['name'] == item['name'] and entry.get('sha256') == digest and _safe_file(A, entry['path']).is_file():
            ticket.setdefault('completed', {}).setdefault(item['id'], {'record_code': code, 'name': item['name'], 'duplicate': True})
            return {'ok': True, 'duplicate': True, 'entry': entry}
    directory = A.attachments_directory()
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink():
        _fail(A, 'مسار ملف المرفق غير صالح.')
    ident = 'att_' + secrets.token_hex(12)
    relative, destination = A.unique_attachment_destination(A.sanitize_filename_text(Path(item['name']).stem)[:120] or 'file', A.attachment_extension(item['name']), set())
    filename = destination.name
    entry = {'id': ident, 'batch_item': key, 'record_code': code, 'record_id': rec['_record_id'], 'path': 'attachments/' + filename, 'name': item['name'], 'size': len(content), 'sha256': digest, 'imported_at': A.now_iso(), 'user': A.current_audit_user(), 'notes': notes.strip()}
    fd, name = tempfile.mkstemp(prefix='.inbox-', dir=directory)
    promoted = False
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, destination); promoted = True
        index['entries'].append(entry)
        write_index(A, index)
    except Exception:
        if promoted:
            destination.unlink(missing_ok=True)
        raise
    finally:
        Path(name).unlink(missing_ok=True)
    ticket.setdefault('completed', {})[item['id']] = {'record_code': code, 'name': item['name'], 'duplicate': False}
    return {'ok': True, 'duplicate': False, 'entry': entry}


def begin_operation(A, payload, owner):
    """Record one optional title/note pair for the reviewed batch, not per file."""
    ticket = _ticket(A, payload, owner)
    values = {}
    for key, limit in (('title', 250), ('notes', 4000)):
        value = payload.get(key, '')
        if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
            _fail(A, 'عنوان أو ملاحظات عملية الاستيراد غير صالحة.')
        values[key] = value.strip()
    if ticket.get('completed') and ticket.get('operation', {'title':'', 'notes':''}) != values:
        _fail(A, 'بدأ الاستيراد؛ لا يمكن تغيير وصف العملية أثناء تنفيذها.')
    ticket['operation'] = values
    return {'ok': True, 'operation': dict(values)}


def api(A, payload, owner, action, language='ar'):
    A.require_builder_access()
    if not isinstance(payload, dict):
        _fail(A, 'صيغة طلب الاستيراد غير صحيحة.')
    if action == 'choose-folder':
        return choose_native_folder(A, owner, language)
    with A.WORKBOOK_LOCK:
        if action == 'fields':
            return {'fields': fields(A, A.read_schema_file(), language)}
        if action == 'preview':
            return preview(A, payload, owner, language)
        if action == 'profiles':
            return profiles(A, payload, owner)
        if action == 'begin':
            return begin_operation(A, payload, owner)
        if action == 'commit':
            return commit_file(A, payload, owner)
        if action == 'finish':
            ticket = _ticket(A, payload, owner)
            completed = ticket.get('completed', {})
            skipped = payload.get('skipped', [])
            if not isinstance(skipped, list) or any(not isinstance(i, str) or not i.isdecimal() or int(i) >= len(ticket['items']) for i in skipped):
                _fail(A, 'قائمة المرفقات المتجاهلة غير صالحة.')
            signature = sorted(completed)
            if not completed or ticket.get('history_signature') == signature:
                return {'ok': True}
            reported = set(ticket.get('history_reported', []))
            added = {i: e for i, e in completed.items() if i not in reported}
            details = [{'row': int(i) + 1, 'record_code': e['record_code'], 'message': e['name']} for i, e in added.items()]
            remaining = len(ticket['items']) - len(completed) - len(set(skipped) - set(completed))
            result = {'imported': sum(not e['duplicate'] for e in added.values()),
                'skipped': (len(set(skipped)) if not reported else 0) + sum(e['duplicate'] for e in added.values()),
                'rejected': remaining, '_partial': remaining > 0, 'changes': details}
            history = A._record_import_history({'filename': str(payload.get('folder', ''))[:250], **ticket.get('operation', {})}, result, 'attachments')
            if history is not None:
                ticket['history_signature'] = signature
                ticket['history_reported'] = signature
            return {'ok': True, 'history_saved': history is not None}
        if action == 'cancel':
            _ticket(A, payload, owner); TICKETS.pop(payload['token'], None); return {'ok': True}
        _fail(A, 'طلب المرفقات غير معروف.')


def alert_group(A, schema, records, *, schema_id='', schema_name='', language='ar', limit=50, offset=0, summary=False, group_id=''):
    gid = hashlib.sha256(('unassigned-attachments:' + schema_id).encode()).hexdigest()[:24]
    if group_id and group_id != gid:
        return None
    index = read_index(A)
    # A bell refresh must not scan every inbox entry for every profile.
    # Keep profile identity in the key so reused visible codes cannot inherit files.
    by_owner = {}
    for entry in index['entries']:
        by_owner.setdefault((entry['record_code'], entry['record_id']), []).append(entry)
    title = 'مرفقات غير مسندة' if language == 'ar' else 'پیوست‌های تخصیص‌نیافته'
    group = {'id': gid, 'rule_id': '__unassigned_attachments', 'name': title, 'message': ('أسند المرفق إلى حقل ثم احفظ السجل.' if language == 'ar' else 'پیوست را به یک فیلد تخصیص دهید و رکورد را ذخیره کنید.'), 'color_type': 'unassigned', 'operator': 'unassigned', 'schema_id': schema_id, 'schema_name': schema_name, 'category_id': '', 'category_name': title, 'field_id': '__attachment', 'field_name': '', 'total': 0, 'items': [], 'offset': offset}
    for record in records:
        if record.get('archived'):
            continue
        owned = by_owner.get((record['record_code'], record['_record_id']))
        if not owned:
            continue
        for e in pending(A, schema, record, {'entries': owned}):
            n = group['total']; group['total'] += 1
            if not summary and offset <= n < offset + limit:
                group['items'].append({'record_code': record['record_code'], 'record_title': profile_title(A, schema, record), 'value': e['name'], 'attachment_id': e['id'], 'notes': e.get('notes', ''), 'updated_at': e.get('imported_at', record.get('updated_at', '')), 'child_id': '', 'parent_child_id': ''})
    group['has_more'] = not summary and offset + len(group['items']) < group['total']
    return group if group['total'] else None


def folder_ticket(A, token, owner):
    item = FOLDERS.get(token) if isinstance(token, str) else None
    if not item or item['owner'] != owner or item['expires'] < time.monotonic() or item['schema_id'] != A.current_schema_id() or item['storage'] != str(A.attachments_directory().resolve()):
        _fail(A, 'انتهى اختيار المجلد. اختر المجلد مرة أخرى.')
    return item


def choose_native_folder(A, owner, language='ar'):
    """Explicit OS picker grants access; requests cannot submit arbitrary paths.

    Unlike browser directory upload, the desktop picker needs no second browser
    confirmation. Only regular non-symlink files under the picked root are used.
    """
    if not PICKER_LOCK.acquire(blocking=False):
        _fail(A, 'نافذة اختيار المجلد مفتوحة بالفعل.')
    try:
        root = A.choose_directory('اختر مجلد المرفقات' if language == 'ar' else 'پوشه پیوست‌ها را انتخاب کنید')
    finally:
        PICKER_LOCK.release()
    if root is None:
        return {'cancelled': True}
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        _fail(A, 'المجلد المحدد غير متاح.')
    items = []
    for current, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(current)/d).is_symlink())
        for name in sorted(names):
            p = Path(current)/name
            if p.is_symlink() or not p.is_file():
                continue
            _filename(A, name)
            meta = p.stat()
            if meta.st_size > A.MAX_ATTACHMENT_BYTES:
                _fail(A, 'حجم الملف يتجاوز 100 ميغابايت.')
            items.append({'name': name, 'size': meta.st_size, 'relative': p.relative_to(root).as_posix(),
                'mtime_ns': meta.st_mtime_ns, 'dev': meta.st_dev, 'inode': meta.st_ino})
            if len(items) > MAX_FILES:
                _fail(A, 'الحد الأقصى 2000 ملف في الدفعة و100 ميغابايت لكل ملف.')
    if not items:
        _fail(A, 'المجلد لا يحتوي على ملفات قابلة للاستيراد.')
    now = time.monotonic()
    with A.WORKBOOK_LOCK:
        for key in list(FOLDERS):
            if FOLDERS[key]['expires'] < now: del FOLDERS[key]
        if len(FOLDERS) >= MAX_TICKETS:
            del FOLDERS[min(FOLDERS, key=lambda k:FOLDERS[k]['expires'])]
        token = secrets.token_urlsafe(32)
        FOLDERS[token] = {'owner': owner, 'schema_id': A.current_schema_id(), 'storage': str(A.attachments_directory().resolve()),
            'expires': now+TICKET_SECONDS, 'root': str(root), 'items': items}
    return {'folder_token': token, 'folder_name': root.name, 'files': [{'name':e['name'], 'size':e['size'], 'relative':e['relative']} for e in items]}


def read_native_file(A, folder, i):
    if folder['expires'] < time.monotonic():
        _fail(A, 'انتهى اختيار المجلد. اختر المجلد مرة أخرى.')
    root = Path(folder['root']); item = folder['items'][i]; path = root/item['relative']
    if root.is_symlink() or any(p.is_symlink() for p in [path, *path.parents] if p != root.parent) or not path.resolve().is_relative_to(root):
        _fail(A, 'تغير مسار الملف منذ اختيار المجلد. أعد الاختيار.')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or (before.st_size, before.st_mtime_ns, before.st_dev, before.st_ino) != (item['size'],item['mtime_ns'],item['dev'],item['inode']):
                _fail(A, 'تغير الملف منذ اختيار المجلد. أعد المطابقة.')
            content = stream.read(A.MAX_ATTACHMENT_BYTES+1)
            after = os.fstat(stream.fileno())
            if (after.st_size,after.st_mtime_ns) != (before.st_size,before.st_mtime_ns) or len(content) != item['size']:
                _fail(A, 'تغير الملف أثناء قراءته. أعد المطابقة.')
        return content
    except OSError as exc:
        raise A.ApplicationError('تعذّر فتح المرفق المختار. اختر المجلد مرة أخرى.') from exc


def delete_pending(A, payload):
    """Delete only an owned, still-unassigned file, serialized with record saves."""
    if not isinstance(payload, dict) or not isinstance(payload.get('id'), str):
        _fail(A, 'مرجع المرفق غير المسند غير صالح.')
    with A.WORKBOOK_LOCK:
        schema = A.read_schema_file()
        record = A._dataset_snapshot_unlocked(schema).records_by_code.get(payload.get('record_code'))
        if not record or record.get('archived'):
            _fail(A, 'السجل غير متاح أو مؤرشف.')
        index = read_index(A)
        entry = next((e for e in pending(A, schema, record, index) if e['id'] == payload['id']), None)
        if not entry:
            _fail(A, 'المرفق غير متاح أو تم إسناده بالفعل.')
        # Never delete a referenced file, even if a malformed old index linked it twice.
        if any(entry['path'] in A._record_file_paths(schema, r) for r in A._dataset_snapshot_unlocked(schema).records):
            _fail(A, 'هذا المرفق مسند إلى حقل ولا يمكن حذفه من المرفقات غير المسندة.')
        source = _safe_file(A, entry['path'])
        tomb = source.with_name('.removed-'+secrets.token_hex(12))
        new = copy.deepcopy(index)
        new['entries'] = [e for e in new['entries'] if e['id'] != entry['id']]
        os.replace(source, tomb)
        try:
            write_index(A, new)
        except Exception:
            os.replace(tomb, source)
            raise
        # An unlink failure leaves an inaccessible tomb, not a visible pending file.
        try: tomb.unlink(missing_ok=True)
        except OSError: A.LOGGER.warning('Unable to remove quarantined attachment')
        return {'ok': True, 'deleted': entry['name']}


def stage_assignment_index(A, plan):
    """Journal destination aliases before workbook publication.

    Pending status tests both original and destination references. If the process
    crashes before saving, the original still exists; after saving the destination
    reference suppresses the pending notice even if cleanup did not run.
    """
    if not plan:
        return None
    before = read_index(A); new = copy.deepcopy(before)
    for entry in new['entries']:
        if entry['path'] in plan:
            aliases = list(entry.get('assigned_paths', []))
            dest = plan[entry['path']]
            if dest not in aliases: aliases.append(dest)
            entry['assigned_paths'] = aliases
    write_index(A, new)
    return before
