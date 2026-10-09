"""Source-owned transaction delivery into normal recipient repeated categories.

A delivery is a materialized, read-only projection of one saved source row. Its
provenance is persisted with the recipient row, not inferred from matching text.
All affected workbooks are staged, journalled, and replaced under WORKBOOK_LOCK.
The journal is recovered before workspace data is served after a restart.
"""
from __future__ import annotations

import schemacraft_link_config as LC
import copy
import errno
import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from contextlib import nullcontext
from pathlib import Path

import schemacraft_field_rules as R
import schemacraft_finance as F
from schemacraft_value_presentation import wire_value

HEADER = '_transaction_origin'
KEY = 'transaction_origin'
JOURNAL = '.transaction-delivery-journal'


def _error(app, message):
    return app.ApplicationError(message)


def _ctx(app, sid):
    return app.use_context(app.WORKSPACE_MANAGER.context(sid)) if app.WORKSPACE_MANAGER is not None else nullcontext()


def source_key(sid, record, cid, row):
    return (sid or '', record['_record_id'], cid, row['_child_id'])


def origin_key(origin):
    return tuple(origin.get(k, '') for k in ('schema_id', 'record_id', 'category_id', 'child_id'))


def read_origin(value):
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError('بيانات مصدر الحركة غير صالحة.')
    result = copy.deepcopy(value)
    for k in ('schema_id', 'record_id', 'record_code', 'category_id', 'child_id'):
        if not isinstance(result.get(k), str) or len(result[k]) > 100:
            raise ValueError('بيانات مصدر الحركة غير صالحة.')
    for k in ('record_id', 'child_id'):
        if not re.fullmatch(r'[a-fA-F0-9]{32}', result[k]):
            raise ValueError('بيانات مصدر الحركة غير صالحة.')
    if not isinstance(result.get('field_map', {}), dict):
        raise ValueError('ربط حقول الحركة غير صالح.')
    if len(json.dumps(result, ensure_ascii=False)) > 32000:
        raise ValueError('بيانات مصدر الحركة كبيرة جدًا.')
    return result


def canonical_row_key(sid, rec, cat, row):
    origin = row.get(KEY)
    return origin_key(origin) if origin else (sid, rec.get('_record_id') or rec.get('record_code'), cat['id'], row.get('_child_id') or id(row))


def canonical_value_key(sid, rec, cat, row, field_id):
    origin = row.get(KEY)
    if origin and (not field_id or field_id in origin.get('field_map', {})):
        return (*origin_key(origin), origin.get('field_map', {}).get(field_id, field_id))
    return (sid, rec.get('_record_id') or rec.get('record_code'), cat['id'], row.get('_child_id') or id(row), field_id)


def normalize_destination(schema, cat, source, remote, raw, schema_id):
    """Validate source-side mapping; no recipient-side link rule is required."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError('إعداد نسخ الحركة إلى السجل المقصد غير صالح.')
    cid = str(raw.get('category_id') or '')
    mappings = raw.get('mappings', [])
    if not cid or not isinstance(mappings, list) or not 1 <= len(mappings) <= 64:
        raise ValueError('اختر جدول المقصد وحقلًا واحدًا على الأقل لنسخ الحركة.')
    sid = source.get('schema_id') or schema_id
    if sid == schema_id and cid == cat['id']:
        raise ValueError('لا يمكن نسخ الحركة إلى جدولها الأصلي نفسه.')
    target = next((c for c in (remote or {}).get('categories', []) if c['id'] == cid), None)
    if remote is not None:
        if not target or target['kind'] != 'repeatable' or target.get('view_table'):
            raise ValueError('جدول المقصد يجب أن يكون فئة متكررة قابلة لحفظ الصفوف.')
        parent = next((c for c in remote['categories'] if c['id'] == target.get('parent_category_id')), None)
        if parent and parent['kind'] == 'repeatable' and source.get('category_id') != parent['id']:
            raise ValueError('للمقصد المتداخل، اختر صف الفئة الأم في إعداد المطابقة أولًا.')
    available = {f['id']: f for c in schema['categories'] if c['kind'] == 'main' or c['id'] == cat['id'] for f in c['fields']}
    available['$record_code'] = {'type': 'text', 'label': 'معرّف السجل'}
    targets = {f['id']: f for f in (target or {}).get('fields', [])}
    seen = set(); cleaned = []
    for m in mappings:
        if not isinstance(m, dict):
            raise ValueError('ربط حقول النسخ غير صالح.')
        sf, tf = m.get('source_field_id'), m.get('target_field_id')
        if sf not in available or not isinstance(tf, str) or not tf or tf in seen:
            raise ValueError('اختر حقول مصدر صالحة وحقول مقصد مختلفة.')
        f = available[sf]
        if f['type'] in {'file', 'spacer', 'field_group'}:
            raise ValueError('نسخ ملفات المرفقات ليس جزءًا من ربط قيم الحركة.')
        if remote is not None:
            t = targets.get(tf)
            if not t or t['type'] in {'file', 'spacer', 'field_group', 'system_record_code', 'system_created_at', 'system_updated_at', 'user_name'} or t.get('financial') or t.get('composition') or t.get('auto_update') or t.get('date_value_mode') == 'on_checkbox':
                raise ValueError('وجهة النسخ يجب أن تكون حقل قيمة يدويًا داخل جدول المقصد.')
            if not R.compatible(t, f) and t['type'] not in {'text', 'textarea'}:
                raise ValueError('نوعا الحقل المنسوخ وحقل المقصد غير متوافقين.')
        seen.add(tf); cleaned.append({'source_field_id': sf, 'target_field_id': tf})
    return {'category_id': cid, 'mappings': cleaned}


def bindings(definitions):
    result = {}
    for sid, item in definitions.items():
        for c in item['schema'].get('categories', []):
            cfg = LC.config(c)
            if not cfg.get('enabled'):
                continue
            for source in cfg.get('sources', []):
                d = source.get('destination')
                if not d:
                    continue
                dest_sid = source.get('schema_id') or sid
                result.setdefault((dest_sid, d['category_id']), []).append({
                    'schema_id': sid, 'schema_name': item['name'], 'category_id': c['id'],
                    'category_name': c['label'], 'source_id': source['id'],
                })
    return result


def _check_dependencies(definitions):
    """Add delivery edges to the existing value graph; prohibit write-back loops."""
    graph = {}; delivery_edges = set()
    for sid, item in definitions.items():
        schema = item['schema']
        for cid, field in F.fields(schema).values():
            node = (sid, field['id']); deps = graph.setdefault(node, set())
            deps.update((sid, fid) for fid in (field.get('composition') or {}).get('field_ids', []))
            if (field.get('auto_update') or {}).get('source_field_id'):
                deps.add((sid, field['auto_update']['source_field_id']))
            cfg = field.get('financial') or {}
            if cfg.get('mode') == 'lookup':
                remote = cfg.get('schema_id') or sid
                deps.update([(remote, cfg.get('field_id')), (sid, cfg.get('local_field_id')), (remote, cfg.get('remote_field_id'))])
            for operand in cfg.get('operands', []):
                if operand.get('kind') == 'field':
                    deps.add((sid, operand.get('field_id')))
                    deps.update((sid, x.get('field_id')) for x in operand.get('filters', []))
                for source in operand.get('sources', []):
                    remote = source.get('schema_id') or sid
                    deps.update((remote, source.get(k)) for k in ('value_field_id', 'currency_field_id', 'remote_field_id'))
                    deps.add((sid, source.get('local_field_id')))
                    deps.update((remote, x.get('field_id')) for x in source.get('filters', []))
        for cat in schema.get('categories', []):
            cfg = LC.config(cat)
            if not cfg.get('enabled'): continue
            for source in cfg.get('sources', []):
                remote = source.get('schema_id') or sid
                for mapping in source.get('destination', {}).get('mappings', []):
                    a = (remote, mapping['target_field_id']); b = (sid, mapping['source_field_id'])
                    graph.setdefault(a, set()).add(b); delivery_edges.add((a,b))
    # A pre-existing unrelated graph cycle belongs to its existing validator.
    # Every new delivery edge must not complete a path back to its destination.
    for destination, origin in delivery_edges:
        pending = [origin]; seen = set()
        while pending:
            n = pending.pop()
            if n == destination:
                raise ValueError('يوجد اعتماد دائري بين قيم الحركة وحقول جدول المقصد؛ لا تجعل المصدر يحسب من نسخته المرتبطة.')
            if n in seen: continue
            seen.add(n); pending.extend(graph.get(n, ()))


def validate_configuration(app, schema, definitions):
    """Do not strand linked rows or remove a referenced destination field."""
    sid = app.current_schema_id() or ''
    definitions = copy.deepcopy(definitions)
    definitions[sid] = {'name': schema.get('app', {}).get('title', ''), 'schema': schema}
    for origin_sid, item in definitions.items():
        for cat in item['schema'].get('categories', []):
            cfg = LC.config(cat)
            for source in cfg.get('sources', []) if cfg.get('enabled') else []:
                if not source.get('destination'):
                    continue
                remote_sid = source.get('schema_id') or origin_sid
                remote = definitions.get(remote_sid, {}).get('schema')
                if remote is None:
                    raise _error(app, 'تصميم المقصد غير متاح؛ أصلح إعداد نسخ الحركة أولًا.')
                try:
                    normalize_destination(item['schema'], cat, source, remote, source['destination'], origin_sid)
                except ValueError as exc:
                    raise _error(app, f'تعذر حفظ التصميم: «{item["name"]} — {cat["label"]}»: {exc}') from exc
    try: _check_dependencies(definitions)
    except ValueError as exc: raise _error(app, str(exc)) from exc
    # Existing source rows must not disappear through a schema projection.
    try:
        old_schema = app.read_schema_file()
        old_records = app._dataset_snapshot_unlocked(old_schema).records
    except (FileNotFoundError, KeyError):
        return
    new_cats = {c['id']: c for c in schema['categories']}
    for record in old_records:
        for cat in old_schema['categories']:
            rows = record.get('related', {}).get(cat['id'], [])
            affected = any(r.get(KEY) for r in rows) or (LC.config(cat).get('enabled') and any(s.get('destination') for s in LC.config(cat).get('sources', [])) and bool(rows))
            if affected and (cat['id'] not in new_cats or new_cats[cat['id']]['kind'] != 'repeatable'):
                raise _error(app, f'لا يمكن حذف الفئة «{cat["label"]}» قبل فك روابط حركاتها وحفظ السجلات المصدر.')


def _definitions(app):
    import schemacraft_finance_api as API
    return API.definitions(app, annotate=False)


def is_recipient(app, category_id):
    return bool(bindings(_definitions(app)).get((app.current_schema_id() or '', category_id)))


def restore_provenance(related, existing):
    """Never trust client/imported lineage as authority for copies or sums."""
    for cid, rows in related.items():
        previous = {r['_child_id']: r for r in (existing or {}).get('related', {}).get(cid, [])}
        if not isinstance(rows, list): continue
        for row in rows:
            if not isinstance(row, dict): continue
            row.pop(KEY, None)
            saved = previous.get(row.get('_child_id'), {}).get(KEY)
            if saved: row[KEY] = copy.deepcopy(saved)


def _derived_field(f):
    return bool(f.get('financial') or f.get('composition') or f.get('auto_update') or f['type'] in {'system_record_code','system_created_at','system_updated_at','user_name'} or f.get('date_value_mode') == 'on_checkbox')


def _same_values(app, schema, cat, submitted, saved):
    for f in app.data_fields(cat):
        if _derived_field(f): continue
        a, b = submitted.get(f['id'], ''), saved.get(f['id'], '')
        # Native date values and API strings are equivalent; display grouping is not data.
        try:
            a = app.normalize_field_value(a, f) if f['type'] != 'file' else a
            b = app.normalize_field_value(b, f) if f['type'] != 'file' else b
        except Exception:
            return False
        if wire_value(a) != wire_value(b):
            return False
    return True


def protect_recipient_rows(app, schema, old_records, records):
    """Restore server-owned provenance; reject forged origins and recipient edits."""
    old_by = {r['_record_id']: r for r in old_records}
    new_by = {r['_record_id']: r for r in records}
    cats = {c['id']: c for c in schema['categories']}
    for old in old_records:
        managed = [(cid, row) for cid, rows in old.get('related', {}).items() for row in rows if row.get(KEY)]
        if not managed:
            continue
        target = new_by.get(old['_record_id'])
        if target is None:
            raise _error(app, 'هذا السجل يحتوي على حركات واردة مرتبطة؛ افصلها من سجلاتها المالية المصدر قبل حذف السجل.')
        for cid, row in managed:
            incoming = next((r for r in target.get('related', {}).get(cid, []) if r.get('_child_id') == row['_child_id']), None)
            if incoming is None or cid not in cats or not _same_values(app, schema, cats[cid], incoming.get('values', {}), row['values']):
                raise _error(app, f'الحركة في «{cats.get(cid, {}).get("label", "جدول المقصد") }» تُعدّل من مصدرها المالي فقط. أعد تحميل السجل لعرض أحدث الصفوف.')
            derived = {f['id']: copy.deepcopy(incoming.get('values', {}).get(f['id'], '')) for f in app.data_fields(cats[cid]) if _derived_field(f)}
            new_timestamp = incoming.get('updated_at', row.get('updated_at', ''))
            incoming.clear(); incoming.update(copy.deepcopy(row))
            if derived: incoming['values'].update(derived); incoming['updated_at'] = new_timestamp
    for rec in records:
        old = old_by.get(rec['_record_id'], {})
        for cid, rows in rec.get('related', {}).items():
            previous = {r['_child_id']: r for r in old.get('related', {}).get(cid, [])}
            for row in rows:
                if row.get(KEY) and not previous.get(row['_child_id'], {}).get(KEY):
                    raise _error(app, 'لا يمكن إنشاء مرجع حركة من السجل المقصد؛ احفظ الحركة من مصدرها المالي.')


def _copy_value(app, source_field, target_field, value):
    if R.empty(value):
        value = False if target_field['type'] == 'checkbox' else [] if target_field['type'] == 'checkbox_group' else ''
    elif source_field['type'] in R.DATE_TYPES and target_field['type'] in R.DATE_TYPES:
        value = R.convert_date(value, source_field['type'], target_field['type'])
    elif target_field['type'] in {'text', 'textarea'}:
        value = F.label(source_field, value)
    elif target_field['type'] in R.OPTION_TYPES:
        value = [F.label(source_field, v) for v in value] if isinstance(value, list) else F.label(source_field, value)
    return app.normalize_field_value(value, target_field)


def _validate_recipient(app, schema, before, record, dataset, staged):
    """Use existing native rules, typed defaults, calculations and uniqueness checks."""
    payload = {'mode': 'update', 'record_code': record['record_code'], 'main': copy.deepcopy(record['values']),
               'related': copy.deepcopy(record['related']), '_composition_metadata': {
                   'record_code': record['record_code'], '_record_id': record['_record_id'], 'created_at': record['created_at'], 'updated_at': record['updated_at']}}
    app.schemacraft_field_rules.apply_initial(app, schema, payload, before, new_record=False)
    app.apply_auto_update_rules(schema, payload['main'], payload['related'], app.current_audit_user())
    old_paths = app._record_file_paths(schema, before)
    main, related, files, _ = app._normalize_submission(schema, payload, 'update', old_paths, field_rules_existing=before, trusted_origins=True)
    # This path never uploads a file. Reject a malformed request instead of leaking temp files.
    if files:
        for path, _ in files:
            path.unlink(missing_ok=True)
        raise _error(app, 'نسخ الحركة لا يقبل تحميل ملفات؛ استخدم حقول القيم في الربط.')
    record['values'] = main
    for cid, rows in related.items():
        metadata = {r['_child_id']: r for r in record['related'].get(cid, [])}
        clean = []
        for n, values in enumerate(rows, 1):
            old = metadata.get(values['_child_id'], {})
            clean.append({**old, **{k: v for k, v in values.items() if k != '_client_generated'}, 'minor_id': n})
        record['related'][cid] = clean
    app.validate_unique_fields(schema, dataset, record['_record_id'], main, record['related'])
    app.validate_related_person_links(schema, dataset, record['record_code'], record['related'])


def _has_delivery(schema):
    return any(LC.config(c).get('enabled') and any(s.get('destination') for s in LC.config(c).get('sources', [])) for c in schema['categories'])


def prepare(app, schema, records):
    """Return all changed datasets, or None for the unchanged old single-file path."""
    sid = app.current_schema_id() or ''
    store = app._postgres_store() if hasattr(app, '_postgres_store') else None
    old_records = list(app._dataset_snapshot_unlocked(schema).records) if store is not None or app._workbook_path().exists() else []
    if not _has_delivery(schema) and not any(row.get(KEY) or row.get('profile_link') for rec in [*old_records, *records] for rows in rec.get('related', {}).values() for row in rows):
        return None
    records[:] = copy.deepcopy(records)
    protect_recipient_rows(app, schema, old_records, records)
    definitions = _definitions(app)
    definitions[sid] = {'name': definitions.get(sid, {}).get('name', schema.get('app', {}).get('title', '')), 'schema': schema}
    try: _check_dependencies(definitions)
    except ValueError as exc: raise _error(app, str(exc)) from exc
    datasets = {sid: {'schema': schema, 'old': old_records, 'records': records, 'path': app._workbook_path(), 'changed': True}}
    # Full workspace inspection is bounded by the normal active schema catalog.
    # Include archived schemas to avoid stranding previously delivered rows.
    contexts = [(s['id'], app.WORKSPACE_MANAGER.context(s['id'])) for s in app.WORKSPACE_MANAGER.response().get('schemas', [])] if app.WORKSPACE_MANAGER else []
    for other_sid, ctx in contexts:
        if other_sid == sid:
            continue
        with app.use_context(ctx):
            remote = app.read_schema_file()
            old = list(app._dataset_snapshot_unlocked(remote).records)
            datasets[other_sid] = {'schema': remote, 'old': old, 'records': copy.deepcopy(old), 'path': app._workbook_path(), 'changed': False, 'archived': ctx.archived}
    changed_profiles = {}
    old_source_ids = {r['_record_id'] for r in old_records}
    source_ids = old_source_ids | {r['_record_id'] for r in records}
    import schemacraft_profile_links as P
    existing_origins = {}; legacy_claims = {}
    for dsid, data in datasets.items():
        for rec in data['records']:
            for cid, rows in rec.get('related', {}).items():
                for row in rows:
                    old_link = P.read_link(row.get('profile_link')) or {}
                    if old_link.get('category_id') and old_link.get('child_id'):
                        old_key=(old_link['schema_id'],old_link['record_id'],old_link['category_id'],old_link['child_id'])
                        legacy_claims.setdefault(old_key,[]).append((dsid,rec['_record_id']))
                    o = row.get(KEY)
                    if o and o['schema_id'] == sid and o['record_id'] in source_ids:
                        k = origin_key(o)
                        if k in existing_origins:
                            raise _error(app, 'توجد نسختان مرتبطتان بالحركة نفسها؛ راجع نسخة مساحة العمل قبل المتابعة.')
                        existing_origins[k] = (dsid, rec, cid, row)
    desired = set(); touched = False
    import schemacraft_profile_links as P
    for rec in list(records):
        if rec.get('archived'):
            continue
        for cat in schema['categories']:
            cfg = LC.config(cat)
            if not cfg.get('enabled'):
                continue
            for row in list(rec.get('related', {}).get(cat['id'], [])):
                if row.get(KEY) or not row.get('profile_link'):
                    continue
                link = P.read_link(row['profile_link'])
                source = next((s for s in cfg['sources'] if s['id'] == link['source_id']), None)
                if not source or not source.get('destination'):
                    continue
                dsid = source.get('schema_id') or sid
                if dsid != link['schema_id']:
                    raise _error(app, 'تغيّر تصميم السجل المرتبط؛ أعد مطابقة الحركة قبل الحفظ.')
                data = datasets.get(dsid)
                if not data or data.get('archived'):
                    raise _error(app, 'تعذر نسخ الحركة: تصميم السجل المقصد غير متاح أو مؤرشف.')
                remote = data['schema']
                try:
                    dest = normalize_destination(schema, cat, source, remote, source['destination'], sid)
                except ValueError as exc:
                    raise _error(app, f'تعذر نسخ الحركة من «{cat["label"]}»: {exc}') from exc
                target_cat = next(c for c in remote['categories'] if c['id'] == dest['category_id'])
                person = next((r for r in data['records'] if r['_record_id'] == link['record_id'] and r['record_code'] == link['record_code']), None)
                if person is None or person.get('archived'):
                    raise _error(app, 'السجل المقصد محذوف أو مؤرشف؛ ألغِ الربط أو اختر سجلًا صالحًا.')
                if rec['_record_id'] == person['_record_id'] and sid == dsid:
                    raise _error(app, 'اختر سجلًا مختلفًا كمقصد للحركة.')
                parent = next((c for c in remote['categories'] if c['id'] == target_cat.get('parent_category_id') and c['kind'] == 'repeatable'), None)
                parent_id = ''
                if parent:
                    parent_id = link.get('child_id', '')
                    if not any(r['_child_id'] == parent_id for r in person['related'].get(parent['id'], [])):
                        raise _error(app, 'صف الفئة الأم في المقصد لم يعد متاحًا؛ أعد المطابقة.')
                key = source_key(sid, rec, cat['id'], row); desired.add(key)
                previous = existing_origins.get(key)
                if any(legacy_sid != dsid or legacy_record_id != person['_record_id'] for legacy_sid,legacy_record_id in legacy_claims.get(key, [])):
                    raise _error(app, 'توجد حركة قديمة مرتبطة بشخص آخر؛ افصل الربط القديم قبل اختيار مقصد جديد.')
                target_rows = person.setdefault('related', {}).setdefault(target_cat['id'], [])
                linked = previous[3] if previous and previous[0] == dsid and previous[1]['_record_id'] == person['_record_id'] and previous[2] == target_cat['id'] else None
                # Reuse only an explicit old reverse link to this exact transaction,
                # never a same-name row or an approximate match.
                if linked is None:
                    legacy = [r for r in target_rows if not r.get(KEY) and (r.get('profile_link') or {}).get('schema_id') == sid and (r.get('profile_link') or {}).get('record_id') == rec['_record_id'] and (r.get('profile_link') or {}).get('category_id') == cat['id'] and (r.get('profile_link') or {}).get('child_id') == row['_child_id']]
                    if len(legacy) > 1:
                        raise _error(app, 'توجد روابط قديمة متعددة للحركة نفسها في المقصد؛ صحّحها قبل إعادة الحفظ.')
                    linked = legacy[0] if legacy else None
                values = copy.deepcopy(linked['values']) if linked else {}
                if linked and linked.get(KEY):
                    for fid in linked[KEY].get('field_map', {}):
                        if fid not in {m['target_field_id'] for m in dest['mappings']}:
                            values[fid] = ''
                local_fields = F.fields(schema); target_fields = F.fields(remote)
                for m in dest['mappings']:
                    v, sf = P.record_value(schema, rec, m['source_field_id'], row)
                    tf = target_fields[m['target_field_id']][1]
                    try:
                        values[tf['id']] = _copy_value(app, sf, tf, v)
                    except Exception as exc:
                        if isinstance(exc, (app.ApplicationError, R.RuleError, ValueError)):
                            raise _error(app, f'تعذر نسخ «{sf.get("label", "معرّف السجل") }» إلى «{tf["label"]}» في «{target_cat["label"]}»: {exc}') from exc
                        raise
                origin = {'schema_id': sid, 'record_id': rec['_record_id'], 'record_code': rec['record_code'], 'category_id': cat['id'], 'child_id': row['_child_id'],
                          'schema_name': definitions[sid]['name'], 'category_name': cat['label'], 'record_title': P.title(schema, rec),
                          'field_map': {m['target_field_id']: m['source_field_id'] for m in dest['mappings']}}
                if linked and wire_value(values) == wire_value(linked['values']) and linked.get(KEY) == origin and linked.get('parent_child_id', '') == parent_id:
                    continue
                if previous and previous[3] is not linked:
                    previous[1]['related'][previous[2]].remove(previous[3]); datasets[previous[0]]['changed'] = True
                    changed_profiles[(previous[0], previous[1]['_record_id'])] = previous[1]
                before_row = copy.deepcopy(linked) if linked else None
                if linked is None:
                    linked = {'_child_id': app.new_internal_id(), 'minor_id': len(target_rows)+1, 'created_at': app.now_iso()}
                    target_rows.append(linked)
                linked.update(values=values, parent_child_id=parent_id, linked_record_code='', updated_at=app.now_iso())
                linked.pop('profile_link', None); linked[KEY] = origin
                person['updated_at'] = app.now_iso(); data['changed'] = True; touched = True
                changed_profiles[(dsid, person['_record_id'])] = person
    # Unlink, deleting a source row, moving its recipient, disabling a mapping, or
    # archiving the source removes only its owned recipient copy.
    for key, (dsid, person, cid, row) in existing_origins.items():
        if key in desired:
            continue
        person['related'][cid].remove(row)
        person['updated_at'] = app.now_iso(); datasets[dsid]['changed'] = True; touched = True
        changed_profiles[(dsid, person['_record_id'])] = person
    if not touched:
        return None
    import schemacraft_finance_api as API
    token = API.TRANSACTION_SNAPSHOTS.set({k: (v['schema'], v['records']) for k, v in datasets.items()})
    try:
        for (dsid, rid), person in changed_profiles.items():
            data = datasets[dsid]
            before = next(r for r in data['old'] if r['_record_id'] == rid)
            with _ctx(app, dsid):
                try:
                    _validate_recipient(app, data['schema'], before, person, data['records'], datasets)
                except (app.ApplicationError, R.RuleError, F.FinanceError) as exc:
                    raise _error(app, f'لم تُحفظ الحركة. تعذر تحديث جدول السجل المقصد «{P.title(data["schema"], person)}»: {exc}') from exc
        with _ctx(app, sid):
            for rec in records:
                API.recompute(app, schema, rec, strict=True, records=records)
                app.validate_unique_fields(schema, records, rec['_record_id'], rec['values'], rec['related'])
    finally:
        API.TRANSACTION_SNAPSHOTS.reset(token)
    return {k: v for k, v in datasets.items() if v['changed']}


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _sync_dir(path):
    if os.name == 'nt':
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_json(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path); _sync_dir(path.parent)


def _sync_staged_workbook(path):
    """Persist completed workbook bytes before the prepared journal is published.

    Windows' file flush requires write access. Reopening with ``rb`` happened
    to work on Linux but can fail on Windows. ``r+b`` opens the existing stage
    with write permission without truncating it. Close before replacement so
    Windows does not retain a handle across os.replace(). Never ignore fsync
    failures: a failed durability check must abort before publishing workbooks.
    """
    with path.open('r+b') as handle:
        handle.flush()
        os.fsync(handle.fileno())


def _storage_error_reason(exc):
    """A safe operator-facing reason; technical paths stay in the log only."""
    code = getattr(exc, 'errno', None)
    win = getattr(exc, 'winerror', None)
    if code in {errno.ENOSPC, getattr(errno, 'EDQUOT', errno.ENOSPC)} or win in {39, 112, 1816}:
        return 'مساحة التخزين غير كافية؛ وفر مساحة في قرص مساحة العمل ثم أعد المحاولة.'
    if isinstance(exc, PermissionError) or code in {errno.EACCES, errno.EPERM, errno.EROFS, errno.EBUSY} or win in {5, 19, 32, 33}:
        return 'تعذر الوصول للكتابة؛ أغلق ملفات Excel للمصدر والمقصد وتحقق من صلاحيات مجلد مساحة العمل.'
    if code in {errno.ENOENT, errno.ENOTDIR} or win in {2, 3, 15, 21}:
        return 'ملف أو مجلد الحفظ غير متاح؛ تحقق من اتصال قرص مساحة العمل قبل إعادة المحاولة.'
    if code == errno.EIO or win in {23, 29, 30, 1117}:
        return 'فشل القرص في إتمام الكتابة؛ تحقق من سلامة التخزين واحتفظ بنسخة مساحة العمل.'
    if code in {errno.EBADF, errno.EINVAL} or win in {6, 87}:
        return 'تعذر تثبيت الملف على القرص؛ أعد تشغيل التطبيق بعد التحديث وراجع سجل التطبيق إن تكرر الخطأ.'
    return 'تعذر إتمام عملية التخزين؛ راجع سجل التطبيق باستخدام مرجع التشخيص.'


def _copy_synced(src, dest):
    with src.open('rb') as i, dest.open('wb') as o:
        shutil.copyfileobj(i, o); o.flush(); os.fsync(o.fileno())


def _safe_target(root, value):
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Unsafe transaction journal path')
    p = Path(value)
    if p.is_absolute() or '..' in p.parts:
        raise ValueError('Unsafe transaction journal path')
    path = root / p
    for part in [path, *path.parents]:
        if part == root.parent:
            break
        if part.is_symlink():
            raise ValueError('Symbolic links are not accepted in delivery journals')
    if root.resolve() not in path.resolve().parents:
        raise ValueError('Unsafe transaction journal path')
    return path


def _validate_plan(root, journal, plan):
    if not isinstance(plan, dict) or plan.get('version') != 1 or not isinstance(plan.get('files'), list) or not 1 <= len(plan['files']) <= 10000:
        raise ValueError('Invalid transaction recovery manifest')
    seen = set()
    for e in plan['files']:
        if not isinstance(e, dict):
            raise ValueError('Invalid recovery file')
        path = _safe_target(root, e.get('path'))
        if path.suffix.lower() != '.xlsx' or path in seen:
            raise ValueError('Invalid or repeated recovery workbook')
        seen.add(path)
        for prop, suffix in [('backup', 'before'), ('staged', 'after')]:
            name = e.get(prop, '')
            if not isinstance(name, str) or not re.fullmatch(r'[0-9]+\.' + suffix, name) or (journal / name).is_symlink():
                raise ValueError('Invalid recovery staging path')
        for key in ('before', 'after'):
            digest = e.get(key)
            if not (key == 'before' and digest is None) and not (isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest)):
                raise ValueError('Invalid recovery checksum')


def _restore(root, journal, plan):
    # Validate the entire rollback before changing any target. Never overwrite an
    # externally changed file merely because a stale journal is present.
    _validate_plan(root, journal, plan)
    targets = []
    for e in plan['files']:
        p = _safe_target(root, e['path'])
        digest = _sha(p)
        if digest not in {e['before'], e['after']}:
            raise RuntimeError('A workbook changed outside the interrupted save; manual recovery is required.')
        old = journal / e['backup']
        if e['before'] is not None and _sha(old) != e['before']:
            raise RuntimeError('A transaction recovery backup is missing or corrupted.')
        targets.append((p, e, old))
    for path, e, old in targets:
        if _sha(path) == e['before']:
            continue
        if e['before'] is None:
            path.unlink(missing_ok=True)
        else:
            fd, name = tempfile.mkstemp(prefix='.delivery-restore-', dir=path.parent); os.close(fd)
            tmp = Path(name)
            try:
                _copy_synced(old, tmp); os.replace(tmp, path)
            finally:
                tmp.unlink(missing_ok=True)
        _sync_dir(path.parent)


def recover(app):
    root = Path(app.DATA_DIR).resolve(); area = root / JOURNAL
    if not area.exists():
        return
    if area.is_symlink():
        raise _error(app, 'مسار استرداد الربط غير آمن.')
    with app.WORKBOOK_LOCK:
        for directory in sorted(area.iterdir()):
            if not directory.is_dir() or directory.is_symlink():
                continue
            manifest = directory / 'journal.json'
            if not manifest.exists():
                # No ready marker means no workbook replacement ever began.
                shutil.rmtree(directory); continue
            try:
                if manifest.is_symlink() or manifest.stat().st_size > 4 * 1024 * 1024:
                    raise ValueError('Invalid recovery manifest file')
                plan = json.loads(manifest.read_text(encoding='utf-8'))
                _validate_plan(root, directory, plan)
                if plan.get('state') == 'prepared':
                    _restore(root, directory, plan)
                    app.LOGGER.warning('Recovered interrupted linked-transaction workbook operation %s', directory.name)
                elif plan.get('state') != 'committed':
                    raise ValueError('Invalid transaction recovery state')
                shutil.rmtree(directory); app.invalidate_dataset_cache()
            except Exception as exc:
                app.LOGGER.exception('Unable to recover linked transaction %s', directory.name)
                raise _error(app, 'تعذر استرداد حفظ حركة مرتبط متوقف. احتفظ بنسخة مساحة العمل وراجع سجل التطبيق قبل المتابعة.') from exc


def commit(app, datasets):
    store = app._postgres_store()
    if store is not None:
        expected = {}
        for sid, data in datasets.items():
            with _ctx(app, sid):
                cached = app._DATASET_SNAPSHOTS.get(str(app._workbook_path().resolve()))
                if cached is not None:
                    expected[sid] = cached.workbook_signature
        durable = {sid: {**data, 'records': app._postgres_records(data['records'])} for sid, data in datasets.items()}
        app._storage_call(store.write_many, durable, expected_signatures=expected)
        for sid, data in datasets.items():
            with _ctx(app, sid):
                app.invalidate_dataset_cache()
                app._safe_publish_dataset_snapshot(data['schema'], data['records'])
        for sid, data in datasets.items():
            try:
                with _ctx(app, sid):
                    app._sync_or_defer_profiles(sid, data['records'])
            except Exception:
                app.LOGGER.exception('Profile synchronization pending after PostgreSQL linked commit')
                app.schedule_profile_sync_retry()
        return
    root = Path(app.DATA_DIR).resolve(); area = root / JOURNAL
    area.mkdir(parents=True, exist_ok=True)
    directory = area / uuid.uuid4().hex; directory.mkdir()
    plan = {'version': 1, 'state': 'staging', 'files': []}
    ready = False; committed = False; rolled_back = False
    try:
        for index, (sid, data) in enumerate(datasets.items()):
            path = Path(data['path']).resolve()
            if root not in path.parents:
                raise _error(app, 'ملف جدول مرتبط خارج مساحة العمل؛ تعذر الحفظ الآمن.')
            relative = path.relative_to(root).as_posix(); _safe_target(root, relative)
            before = _sha(path); backup = f'{index}.before'; staged = directory / f'{index}.after'
            if before is not None:
                _copy_synced(path, directory / backup)
            with _ctx(app, sid):
                app.write_dataset_workbook(data['schema'], data['records'], staged)
            _sync_staged_workbook(staged)
            plan['files'].append({'path': relative, 'backup': backup, 'staged': staged.name, 'before': before, 'after': _sha(staged)})
        plan['state'] = 'prepared'; _write_json(directory/'journal.json', plan); _sync_dir(area); ready = True
        for e in plan['files']:
            path = _safe_target(root, e['path'])
            if _sha(path) != e['before']:
                raise _error(app, 'تغيّر ملف Excel أثناء تجهيز الحفظ؛ أغلقه وأعد المحاولة.')
        for e in plan['files']:
            path = _safe_target(root, e['path'])
            _replace_workbook(directory/e['staged'], path); _sync_dir(path.parent)
        plan['state'] = 'committed'; _write_json(directory/'journal.json', plan); committed = True
    except Exception:
        if ready and not committed:
            try:
                _restore(root, directory, plan)
                rolled_back = True
            except Exception as recovery_error:
                incident = 'SC-' + uuid.uuid4().hex[:8].upper()
                app.LOGGER.exception('Linked save rollback failed %s; keep recovery journal %s', incident, directory)
                raise _error(app, f'لم يكتمل حفظ الحركة ولا استرداد الجداول السابقة. احتفظ بنسخة مساحة العمل وسجل الاسترداد، وأوقف التعديل حتى معالجة الخطأ. مرجع التشخيص: {incident}') from recovery_error
        raise
    finally:
        # A rollback error leaves the prepared journal for recover()/diagnosis.
        if committed or rolled_back or not ready:
            shutil.rmtree(directory, ignore_errors=True)
    if not committed:
        return
    for sid, data in datasets.items():
        with _ctx(app, sid):
            app.invalidate_dataset_cache(); app._safe_publish_dataset_snapshot(data['schema'], data['records'])
    for sid, data in datasets.items():
        try:
            with _ctx(app, sid):
                app.synchronize_profile_dependents(sid, data['records'])
        except Exception:
            app.LOGGER.exception('Profile-following sync pending after linked transaction commit')
            app.schedule_profile_sync_retry()


def _replace_workbook(source, destination):
    """Named boundary for deterministic interrupted-write regression tests."""
    os.replace(source, destination)


def write_if_needed(app, schema, records):
    # An unresolved recovery journal must never be bypassed by a later write.
    with app.WORKBOOK_LOCK:
        stage = 'استرداد عملية حفظ سابقة'
        try:
            if app._postgres_store() is None:
                recover(app)
            stage = 'تجهيز صف السجل المقصد والتحقق من حقوله'
            datasets = prepare(app, schema, records)
            if datasets is None:
                return False
            stage = 'كتابة جداول المصدر والمقصد'
            commit(app, datasets)
            return True
        except app.ApplicationError:
            raise
        except (R.RuleError, F.FinanceError) as exc:
            raise _error(app, f'تعذر حفظ وربط الحركة أثناء «{stage}»: {exc}') from exc
        except OSError as exc:
            incident = 'SC-' + uuid.uuid4().hex[:8].upper()
            app.LOGGER.exception('Linked save storage failure %s at stage %s (errno=%s, winerror=%s)',
                                 incident, stage, exc.errno, getattr(exc, 'winerror', None))
            reason = _storage_error_reason(exc)
            raise _error(app, f'تعذر إكمال حفظ وربط الحركة أثناء «{stage}»: {reason} التغييرات لم تُحفظ؛ احتفظ بالمسودة. مرجع التشخيص: {incident}') from exc
        except Exception as exc:
            incident = 'SC-' + uuid.uuid4().hex[:8].upper()
            app.LOGGER.exception('Linked save failure %s at stage %s', incident, stage)
            raise _error(app, f'تعذر إكمال حفظ وربط الحركة أثناء «{stage}». احتفظ بالتغييرات وأعد المحاولة بعد مراجعة سجل التطبيق. مرجع التشخيص: {incident}') from exc
