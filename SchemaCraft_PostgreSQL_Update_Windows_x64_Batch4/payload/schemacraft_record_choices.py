"""Schema-backed suggestions and a read-only reverse view of saved row links.

Choices are snapshots of saved scalar values, not copied schema option lists.
Selecting a suggestion may explicitly link its profile/row through the existing
profile-link API. This module never creates another monetary transaction.
"""
from __future__ import annotations
import schemacraft_link_config as LC
import copy
import re
import schemacraft_finance as F
import schemacraft_finance_api as API
import schemacraft_field_rules as R

MAX_SOURCES = 16
MAX_SCAN = 100000
MAX_CHOICES = 100


def fail(message):
    # Share the application's already-handled exception type without an import cycle.
    from schemacraft_profile_links import LinkError
    raise LinkError(message)


def normalize(schema, raw, schemas=None, schema_id=''):
    original = F.fields(raw)
    for fid, (cat, field) in F.fields(schema).items():
        cfg = original.get(fid, ({}, {}))[1].get('record_options')
        if cfg is None:
            continue
        if not isinstance(cfg, dict) or field['type'] not in {'text', 'select'}:
            fail('الاختيار من السجلات متاح لحقل نص أو قائمة فقط.')
        if field.get('auto_update') or field.get('composition') or field.get('financial') or field.get('option_filter'):
            fail('لا تجمع اختيار السجلات مع مصدر تلقائي أو قائمة تابعة للحقل نفسه.')
        sources = cfg.get('sources', [])
        if not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES:
            fail('اختر مصدر قيم واحدًا على الأقل؛ الحد الأقصى 16.')
        if not isinstance(cfg.get('allow_unmatched', True), bool):
            fail('إعداد القيم غير المطابقة غير صالح.')
        cleaned = []
        seen = set()
        for source in sources:
            if not isinstance(source, dict): fail('مصدر قيم السجلات غير صالح.')
            ident, sid, cid, remote_fid = (source.get(k, '') for k in ('id', 'schema_id', 'category_id', 'field_id'))
            if not all(isinstance(x, str) and len(x) <= 100 for x in (ident, sid, cid, remote_fid)) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', ident) or ident in seen or not remote_fid:
                fail('اختر مصدرًا وحقلاً صالحين دون تكرار.')
            seen.add(ident)
            remote = schema if not sid or sid == schema_id else (schemas or {}).get(sid)
            if remote is None and schemas is not None: fail('تصميم مصدر الخيارات غير متاح.')
            if remote is not None:
                cats = {c['id']: c for c in remote['categories']}
                if cid and (cid not in cats or cats[cid]['kind'] != 'repeatable'):
                    fail('فئة مصدر الخيارات المتكررة غير متاحة.')
                if remote_fid != '$record_code':
                    pair = F.fields(remote).get(remote_fid)
                    if not pair or pair[0]['kind'] != 'main' and pair[0]['id'] != cid or pair[1]['type'] in {'file','spacer','field_group','checkbox_group'}:
                        fail('اختر حقل قيمة من الملف الرئيسي أو صف المصدر المحدد.')
            cleaned.append({'id':ident,'schema_id':sid,'category_id':cid,'field_id':remote_fid})
        field['record_options'] = {'sources':cleaned, 'allow_unmatched':cfg.get('allow_unmatched', True)}
        # Dynamic suggestions must never create schema options as a side effect.
        field['allow_new_options'] = False
    return schema


def _items(app, schema, field, search='', exact=False):
    import schemacraft_profile_links as P
    resolver = API.resolver_for(app, schema)
    wanted = F._text(search)
    seen = set()
    count = 0
    for source in field['record_options']['sources']:
        sid = source['schema_id'] or app.current_schema_id() or ''
        remote, records = resolver(sid)
        for record in records:
            if record.get('archived'): continue
            for row in P.source_rows(remote, record, source):
                count += 1
                if count > MAX_SCAN: fail('مصدر الخيارات كبير؛ قلّل نطاق التصاميم.')
                value, sf = P.record_value(remote, record, source['field_id'], row)
                if R.empty(value): continue
                label = F.label(sf, value)
                if len(label) > 4000: continue
                if wanted and (F._text(label) != wanted if exact else wanted not in F._text(label)):
                    continue
                # Keep distinct identities when names collide; deduplicate only
                # overlapping definitions of the very same record and row.
                identity = (sid, record['_record_id'], (row or {}).get('_child_id',''), label)
                if identity in seen: continue
                seen.add(identity)
                yield {'value':label, 'option_source_id':source['id'],
                       **P.candidate(app, remote, record, source, sid, row)}


def options(app, payload):
    if not isinstance(payload, dict): fail('طلب خيارات السجلات غير صالح.')
    schema = app.read_schema_file()
    pair = F.fields(schema).get(payload.get('field_id'))
    if not pair or not pair[1].get('record_options'): fail('مصدر قيم هذا الحقل غير مفعّل.')
    search = payload.get('search', '')
    if not isinstance(search, str) or len(search) > 4000: fail('نص البحث طويل أو غير صالح.')
    items = []; total = 0; exact_match = False
    for item in _items(app, schema, pair[1], search):
        total += 1
        exact_match = exact_match or F._text(item['value']) == F._text(search)
        if len(items) < MAX_CHOICES: items.append(item)
    return {'items':items, 'total':total, 'has_more':total > len(items),
            'allow_unmatched':pair[1]['record_options']['allow_unmatched'], 'exact_match':exact_match}


def validate_values(app, schema, payload, existing=None):
    """Validate new/changed strict values; never invalidate unchanged history.

    Unmatched-enabled fields preserve typed input even without a selected link.
    The profile-link API validates any explicitly selected identity separately.
    """
    old = existing or {}
    for cat in schema['categories']:
        fields = [f for f in cat['fields'] if f.get('record_options') and not f['record_options']['allow_unmatched']]
        if not fields: continue
        if cat['kind'] == 'main':
            rows = [(payload.get('main', {}), old.get('values', old.get('main', {})))]
        else:
            old_rows = {r.get('_child_id'):r.get('values', {}) for r in old.get('related', {}).get(cat['id'], [])}
            rows = [(r.get('values',{}), old_rows.get(r.get('_child_id'), {})) for r in payload.get('related', {}).get(cat['id'], [])]
        for values, before in rows:
            for field in fields:
                value = values.get(field['id'], '')
                if R.empty(value) or field['id'] in before and value == before[field['id']]: continue
                if next(_items(app, schema, field, str(value), exact=True), None) is None:
                    fail(f'اختر قيمة موجودة للحقل «{field["label"]}»؛ القيم غير المطابقة غير مسموحة.')


def incoming(app, payload):
    """A saved transaction appears at its related profile without a duplicate row.

    This is an explicitly read-only view over original saved card identities. It
    is outside the recipient's stored card list and cannot be posted twice.
    """
    import schemacraft_profile_links as P
    if not isinstance(payload, dict): fail('طلب الحركات المرتبطة غير صالح.')
    schema = app.read_schema_file(); sid = app.current_schema_id() or ''
    resolver = API.resolver_for(app, schema)
    _, local_records = resolver(sid)
    record = next((r for r in local_records if r['record_code'] == payload.get('record_code') and not r.get('archived')), None)
    if not record: return {'groups':[], 'total':0}
    manager = app.WORKSPACE_MANAGER
    schemas = [x['id'] for x in manager.response().get('schemas',[]) if not x.get('archived')] if manager else [sid]
    groups = []; total = 0; scanned = 0
    for source_sid in schemas:
        remote, records = resolver(source_sid)
        for cat in remote['categories']:
            if cat['kind'] != 'repeatable': continue
            requested = LC.config(cat).get('incoming_fields', cat.get('table',{}).get('columns'))
            fields = [f for f in cat['fields'] if f['type'] not in {'file','spacer','field_group'} and (requested is None or f['id'] in requested)]
            rows = []
            for owner in records:
                if owner.get('archived'): continue
                for row in owner.get('related',{}).get(cat['id'],[]):
                    scanned += 1
                    if scanned > MAX_SCAN: fail('عدد الحركات كبير؛ ضيّق نطاق السجلات المرتبطة.')
                    origin = row.get('transaction_origin') or {}
                    if origin.get('schema_id') == sid and origin.get('record_id') == record['_record_id']:
                        total += 1
                        rows.append({'record_code':owner['record_code'],'record_id':owner['_record_id'],'record_title':P.title(remote,owner),
                            'target_category_id':origin['category_id'],'target_child_id':origin['child_id'],
                            'child_id':row['_child_id'],'matched_row':'', 'values':{f['id']:F.label(f,row.get('values',{}).get(f['id'],'')) for f in fields}})
                        continue
                    link = row.get('profile_link') or {}
                    if not link: continue
                    link = P.read_link(link)
                    if link['schema_id'] != sid or link['record_id'] != record['_record_id']: continue
                    total += 1
                    if total > 1000: fail('عدد الحركات المرتبطة يتجاوز حد العرض 1000؛ استخدم جدول عرض مخصصًا.')
                    rows.append({'record_code':owner['record_code'], 'record_id':owner['_record_id'], 'record_title':P.title(remote,owner),
                        'target_category_id':link.get('category_id',''), 'target_child_id':link.get('child_id',''),
                        'child_id':row['_child_id'], 'matched_row':link.get('row_title',''),
                        'values':{f['id']:F.label(f,row.get('values',{}).get(f['id'],'')) for f in fields}})
            if rows:
                groups.append({'schema_id':source_sid, 'category_id':cat['id'], 'schema_name':P.source_name(app,remote,source_sid),
                    'category_name':cat['label'], 'columns':[{'id':f['id'],'label':f['label']} for f in fields], 'rows':rows})
    return {'groups':groups, 'total':total}
