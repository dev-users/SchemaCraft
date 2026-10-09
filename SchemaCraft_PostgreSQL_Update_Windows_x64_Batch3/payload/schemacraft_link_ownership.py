"""Single-source relationship checks; no name-based ownership or remote writes.

A main profile may receive many transactions. A particular repeated source row
may be selected by only one owning row. Historical links are retained unchanged;
new links, including stale concurrent requests, are checked under WORKBOOK_LOCK.
"""
from __future__ import annotations
from functools import wraps

MAX_ROWS = 100000


def coherent(function):
    @wraps(function)
    def call(app, *args, **kwargs):
        with app.WORKBOOK_LOCK:
            return function(app, *args, **kwargs)
    return call


def target_key(link):
    return tuple(str(link.get(k) or '') for k in
                 ('schema_id', 'record_id', 'category_id', 'child_id'))


def owner_key(sid, record, category, row):
    return (sid, record.get('_record_id', ''), category['id'], row.get('_child_id', ''))


def is_reverse_source(current_sid, local_category, source, remote, remote_sid):
    """Recognize the old reciprocal setup by configured identities, never labels.

    If the selected table already defines outgoing links to this profile schema,
    it is that table which must select the person. A person-side matching rule
    does not authorize claiming an unlinked outside person's transaction.
    Ordinary contract-row sources without this reciprocal configuration remain
    supported, including same-schema row references.
    """
    cid = source.get('category_id')
    if not cid or (remote_sid == current_sid and cid == local_category['id']):
        return False
    category = next((c for c in remote.get('categories', []) if c['id'] == cid), {})
    # Old Name-only choice configurations also indicate the intended direction;
    # never let a recipient claim an outside person's equal-name transaction.
    sources = list(category.get('profile_linking', {}).get('sources', []))
    for field in category.get('fields', []):
        sources.extend(field.get('record_options', {}).get('sources', []))
    for back in sources:
        if (back.get('schema_id') or remote_sid) == current_sid and not back.get('category_id'):
            return True
    return False


class Inventory:
    """Read-only inventory of saved links. Archived owners still reserve rows."""
    def __init__(self, app, schema, resolver, replace_record_id=None):
        import schemacraft_profile_links as P
        self.rows = {}
        self.claims = {}
        self.links = {}
        self.app = app
        self.sid = app.current_schema_id() or ''
        manager = app.WORKSPACE_MANAGER
        entries = manager.response().get('schemas', []) if manager else [{'id': self.sid}]
        seen = set()
        count = 0
        for entry in entries:
            sid = entry['id']
            if sid in seen:
                continue
            seen.add(sid)
            if entry.get('archived') and manager:
                with app.use_context(manager.context(sid)):
                    remote = app.read_schema_file()
                    records = app._dataset_snapshot_unlocked(remote).records
            else:
                remote, records = resolver(sid)
            for record in records:
                if sid == self.sid and record.get('_record_id') == replace_record_id:
                    continue
                for category in remote.get('categories', []):
                    if category.get('kind') != 'repeatable':
                        continue
                    for row in record.get('related', {}).get(category['id'], []):
                        count += 1
                        if count > MAX_ROWS:
                            raise P.LinkError('عدد الصفوف يتجاوز حد فحص الروابط؛ لم يتم تغيير أي رابط.')
                        key = owner_key(sid, record, category, row)
                        self.rows[key] = row
                        link = P.read_link(row.get('profile_link'))
                        if link:
                            self.register(key, link)

    def register(self, owner, link):
        self.links[owner] = link
        key = target_key(link)
        if key[2] and key[3]:
            self.claims.setdefault(key, set()).add(owner)

    def reason(self, owner, key, remote_row=None):
        if key[2] and key[3]:
            if key == owner:
                return 'لا يمكن ربط الصف بنفسه.'
            if (remote_row or {}).get('profile_link') or key in self.links:
                return 'هذه الحركة مرتبطة بالفعل؛ افتحها من جدولها الأصلي بدل ربطها مرة ثانية.'
            if self.claims.get(key, set()) - {owner}:
                return 'تم ربط هذا الصف بالفعل؛ حدّث القائمة واختر صفًا آخر.'
        # Old recipient-side links may exist. Do not silently assign their source
        # transaction to a different person. A same-person source-owned link can
        # replace the old workflow without modifying the recipient's workbook.
        for claimant in self.claims.get(owner, set()):
            if claimant[:2] != key[:2]:
                return 'لهذه الحركة رابط محفوظ مع سجل آخر؛ راجع الرابط القديم قبل تغييره.'
        return ''


def draft_owner(app, payload):
    return (app.current_schema_id() or '', str(payload.get('record_id') or ''),
            str(payload.get('category_id') or ''), str(payload.get('child_id') or ''))


def draft_targets(payload):
    """Client exclusions reduce suggestions, never grant permission to save."""
    rows = payload.get('draft_links', [])
    if not isinstance(rows, list) or len(rows) > 10000:
        from schemacraft_profile_links import LinkError
        raise LinkError('قائمة الروابط المؤقتة غير صالحة.')
    return {target_key(r) for r in rows if isinstance(r, dict) and r.get('child_id')}


@coherent
def resolve_target(app, payload):
    """Resolve immutable identity and exact card before navigation.

    Profile-code reuse or a removed child must not open an unrelated record.
    This endpoint never acknowledges a link and never writes either profile.
    """
    import schemacraft_profile_links as P
    import schemacraft_finance_api as API
    if not isinstance(payload, dict) or not isinstance(payload.get('target'), dict):
        raise P.LinkError('رابط التنقل غير صالح.')
    target = payload['target']
    values = [target.get(k, '') for k in ('schema_id', 'record_id', 'record_code', 'category_id', 'child_id')]
    if any(not isinstance(v, str) or len(v) > 1000 for v in values):
        raise P.LinkError('رابط التنقل غير صالح.')
    sid, rid, code, cid, child = values
    sid = sid or app.current_schema_id() or ''
    if not rid or not code or bool(cid) != bool(child):
        raise P.LinkError('رابط التنقل غير صالح.')
    schema, records = API.resolver_for(app, app.read_schema_file())(sid)
    record = next((r for r in records if r.get('_record_id') == rid and r.get('record_code') == code), None)
    if record is None:
        raise P.LinkError('السجل المرتبط لم يعد متاحًا؛ لم يتم فتح سجل بديل.')
    if cid:
        category = next((c for c in schema['categories'] if c['id'] == cid and c['kind'] == 'repeatable'), None)
        row = next((r for r in record.get('related', {}).get(cid, []) if r.get('_child_id') == child), None)
        if not category or row is None:
            raise P.LinkError('صف الحركة المرتبط لم يعد متاحًا؛ لم يتم اختيار صف بديل.')
    return {'schema_id': sid, 'record_id': rid, 'record_code': code,
            'category_id': cid, 'child_id': child, 'archived': bool(record.get('archived')),
            'record_title': P.title(schema, record)}


@coherent
def validate_import_links(app, schema, proposed):
    """Check newly introduced import links against the final saved graph.

    Field-only imports do not create links. Unchanged historical pointers survive;
    imported new pointers cannot evade exclusive-row or direction checks. This
    runs before workbook publication in the existing reviewed import workflow.
    """
    import schemacraft_profile_links as P
    import schemacraft_finance_api as API
    previous = app._dataset_snapshot_unlocked(schema).records
    previous_links = {}
    sid = app.current_schema_id() or ''
    for record in previous:
        for category in schema.get('categories', []):
            for row in record.get('related', {}).get(category['id'], []):
                link = P.read_link(row.get('profile_link'))
                if link:
                    previous_links[owner_key(sid,record,category,row)] = link
    changed = []
    for record in proposed:
        for category in schema.get('categories', []):
            for row in record.get('related', {}).get(category['id'], []):
                link = P.read_link(row.get('profile_link'))
                if link and not P.same_saved_link(link,previous_links.get(owner_key(sid,record,category,row))):
                    changed.append((record,category,row,link))
    if not changed:
        return
    resolver = API.resolver_for(app, schema, proposed)
    inventory = Inventory(app, schema, resolver)
    for record,category,row,link in changed:
        source = next((s for s in P.configured_sources(category) if s['id']==link['source_id']), None)
        if not source or (source.get('schema_id') or sid) != link['schema_id']:
            raise P.LinkError('مصدر الربط غير مسموح.')
        remote, records = resolver(link['schema_id'])
        target = next((r for r in records if r['_record_id']==link['record_id'] and r['record_code']==link['record_code'] and not r.get('archived')), None)
        if target is None:
            raise P.LinkError('السجل المختار غير متاح؛ أعد الاختيار أو ألغِ الربط.')
        remote_row = P.selected_row(remote,target,source,link)
        P.check_available(app,schema,category,source,remote,target,remote_row,
                          owner_key(sid,record,category,row),inventory)
