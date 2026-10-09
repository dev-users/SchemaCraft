"""Atomic presentation preferences and server-side alert views.

Rule evaluation is owned by schemacraft_alerts. This module never edits records.
View filtering and ordering happen before pagination, including pinned cards.
"""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import date
import schemacraft_alerts as Alerts

# These are presentation values only; no executable HTML/CSS/templates are accepted.
CONTENT_PARTS = ('profile', 'rule', 'schema', 'message', 'cause', 'time')
TEXT_TOKENS = frozenset({'alert', 'message', 'profile', 'id', 'schema', 'field',
                         'category', 'value', 'date', 'edited', 'card', 'remaining'})
DEFAULTS = {'show_id': True, 'show_title': True, 'show_rule': True,
            'show_schema': True, 'show_message': True, 'show_cause': True,
            'show_time': False, 'show_icon': True, 'compact': False,
            'profile_templates': {}, 'content_order': list(CONTENT_PARTS),
            'layout_mode': 'stack', 'message_mode': 'preserve',
            'text_align': 'start', 'icon_side': 'left',
            'title_size': 'normal', 'text_size': 'normal', 'line_spacing': 'normal',
            'padding': 14, 'corner_radius': 10, 'border_width': 1, 'card_gap': 10,
            'heading_template': '{alert}', 'message_template': '{message}',
            'use_content_template': False, 'card_template': '', 'icon_choice': 'auto'}
LAYOUT_CHOICES = {'icon_choice': {'auto', 'info', 'warning', 'error', 'bell', 'calendar', 'document', 'clock', 'check'}, 'layout_mode': {'stack', 'inline', 'columns'},
                  'message_mode': {'preserve', 'wrap', 'single'},
                  'text_align': {'start', 'center', 'end'},
                  'icon_side': {'left', 'right'},
                  'title_size': {'small', 'normal', 'large'},
                  'text_size': {'small', 'normal', 'large'},
                  'line_spacing': {'tight', 'normal', 'relaxed'}}
LAYOUT_RANGES = {'padding': (6, 28), 'corner_radius': (0, 24),
                 'border_width': (1, 3), 'card_gap': (4, 24)}


def validate_text_template(A, value):
    """Allow a small, inert named-token grammar and escaped literal braces."""
    if not isinstance(value, str) or len(value) > 4000 or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
        raise A.ApplicationError('نص قالب بطاقة التنبيه غير صالح.')
    pos = 0
    while pos < len(value):
        if value[pos:pos+2] in ('{{', '}}'):
            pos += 2
        elif value[pos] == '{':
            end = value.find('}', pos + 1)
            if end < 0 or value[pos+1:end] not in TEXT_TOKENS:
                raise A.ApplicationError('اختر عناصر النص من أزرار القالب؛ يوجد عنصر غير معروف.')
            pos = end + 1
        elif value[pos] == '}':
            raise A.ApplicationError('أقواس قالب التنبيه غير متوازنة.')
        else:
            pos += 1
    return value


CARD_PARTS = ('profile', 'schema', 'message', 'cause', 'time')

def selected_card_parts(layout):
    selected = {'profile'} if layout.get('show_id') or layout.get('show_title') else set()
    selected.update(key for key in CARD_PARTS if key != 'profile' and layout.get({'schema':'show_schema', 'message':'show_message', 'cause':'show_cause', 'time':'show_time'}[key]))
    return [key for key in layout.get('content_order', CONTENT_PARTS) if key in selected]


def validate_card_template(A, layout):
    """The content checklist owns membership; the text box owns separators only."""
    text = layout['card_template']; found = []; pos = 0
    while pos < len(text):
        if text[pos:pos+2] in ('{{', '}}'):
            pos += 2
        elif text[pos] == '{':
            end = text.find('}', pos + 1)
            key = text[pos+1:end] if end >= 0 else ''
            if key not in CARD_PARTS:
                raise A.ApplicationError('اختر عناصر البطاقة من القائمة فقط؛ الصيغة تحتوي على عنصر غير صالح.')
            found.append(key); pos = end + 1
        elif text[pos] == '}':
            raise A.ApplicationError('أقواس قالب التنبيه غير متوازنة.')
        else:
            pos += 1
    if found != selected_card_parts(layout):
        raise A.ApplicationError('تُضاف عناصر البطاقة وتُحذف وتُرتّب من القائمة. احتفظ بعناصر الصيغة كما هي وأضف الفواصل بينها فقط.')
    return text


def path(A):
    return A.DATA_DIR / 'alert-presentation.json'


def read(A):
    p = path(A)
    if p.is_symlink():
        raise A.ApplicationError('مسار إعدادات التنبيهات غير آمن.')
    if not p.exists():
        return {'version': 1, 'revision': '', 'layout': copy.deepcopy(DEFAULTS), 'pins': []}
    try:
        raw = p.read_bytes()
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('layout'), dict) or not isinstance(data.get('pins'), list):
            raise ValueError('invalid format')
        data['layout'] = dict(copy.deepcopy(DEFAULTS), **data['layout'])
        data['revision'] = hashlib.sha256(raw).hexdigest()
        return data
    except (OSError, ValueError) as exc:
        raise A.ApplicationError('تعذّر قراءة إعدادات التنبيهات. استعد النسخة الاحتياطية.') from exc


def write(A, data):
    p = path(A)
    if p.is_symlink():
        raise A.ApplicationError('مسار إعدادات التنبيهات غير آمن.')
    p.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v for k, v in data.items() if k != 'revision'}
    fd, name = tempfile.mkstemp(prefix='.alert-presentation-', dir=p.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush(); os.fsync(f.fileno())
        os.replace(name, p)
    finally:
        Path(name).unlink(missing_ok=True)
    return read(A)


def validate_layout(A, layout):
    if not isinstance(layout, dict):
        raise A.ApplicationError('إعدادات بطاقات التنبيه غير صالحة.')
    result = copy.deepcopy(DEFAULTS)
    for key, default in DEFAULTS.items():
        if key == 'profile_templates':
            continue
        value = layout.get(key, copy.deepcopy(default))
        if isinstance(default, bool):
            if not isinstance(value, bool):
                raise A.ApplicationError('خيارات عرض التنبيهات غير صالحة.')
        elif key in LAYOUT_CHOICES:
            if not isinstance(value, str) or value not in LAYOUT_CHOICES[key]:
                raise A.ApplicationError('تنسيق بطاقة التنبيه غير صالح.')
        elif key in LAYOUT_RANGES:
            low, high = LAYOUT_RANGES[key]
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise A.ApplicationError('قياس بطاقة التنبيه خارج النطاق المسموح.')
        elif key == 'content_order':
            if not isinstance(value, list) or len(value) != len(CONTENT_PARTS) or not all(isinstance(x, str) for x in value) or set(value) != set(CONTENT_PARTS):
                raise A.ApplicationError('ترتيب أجزاء بطاقة التنبيه غير صالح.')
            value = list(value)
        elif key == 'card_template':
            if not isinstance(value, str) or len(value) > 4000 or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
                raise A.ApplicationError('صيغة محتوى البطاقة غير صالحة.')
        elif key in ('heading_template', 'message_template'):
            value = validate_text_template(A, value)
        result[key] = value
    if result['use_content_template']:
        validate_card_template(A, result)
    templates = layout.get('profile_templates', {})
    if not isinstance(templates, dict) or len(templates) > 200:
        raise A.ApplicationError('قوالب عرض السجلات غير صالحة.')
    # Every template is validated against its actual schema, never evaluated as code.
    manager = A.WORKSPACE_MANAGER
    contexts = manager.contexts(include_archived=True) if manager is not None else [None]
    from contextlib import nullcontext
    known = {}
    for ctx in contexts:
        sid = ctx.schema_id if ctx else ''
        known[sid] = ctx
    for sid, item in templates.items():
        if not isinstance(item, dict) or not isinstance(item.get('template', ''), str):
            raise A.ApplicationError('صيغة عرض السجل غير صالحة.')
        template = item.get('template', '').strip()
        if not template:
            continue
        if sid not in known:
            # Removed schema settings are omitted, not allowed to disclose IDs.
            continue
        with A.use_context(known[sid]) if known[sid] else nullcontext():
            schema = A.read_schema_file()
            parts = A.schemacraft_attachment_import.compile_pattern(A, schema, template)
            canonical = ''.join(('{' + v + '}') if k == 'field' else v.replace('{', '{{').replace('}', '}}') for k, v in parts)
            result['profile_templates'][sid] = {'template': canonical}
    return result


def api(A, payload):
    if not isinstance(payload, dict):
        raise A.ApplicationError('طلب إعدادات التنبيهات غير صالح.')
    with A.WORKBOOK_LOCK:
        data = read(A)
        action = payload.get('action', 'save')
        if action == 'pin':
            key, pinned = payload.get('key'), payload.get('pinned')
            if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{32}', key) or not isinstance(pinned, bool):
                raise A.ApplicationError('مرجع بطاقة التنبيه غير صالح.')
            pins = list(data['pins'])
            if pinned and key not in pins:
                if len(pins) >= 5000:
                    raise A.ApplicationError('بلغ عدد التنبيهات المثبتة الحد الأقصى.')
                pins.append(key)
            elif not pinned:
                pins = [k for k in pins if k != key]
            data['pins'] = pins
        elif action == 'save':
            A.require_builder_access()
            if payload.get('revision') != data['revision']:
                raise A.ApplicationError('تغيرت إعدادات التنبيهات. أعد فتح الإعدادات ثم حاول مجددًا.')
            data['layout'] = validate_layout(A, payload.get('layout'))
        else:
            raise A.ApplicationError('طلب إعدادات التنبيهات غير معروف.')
        return write(A, data)


def enrich(A, response, schema, records, schema_id, prefs, language):
    """Only return configured main-field presentation, not an entire record."""
    by_code = {r['record_code']: r for r in records}
    template = prefs['layout'].get('profile_templates', {}).get(schema_id, {}).get('template', '')
    parts = None
    if template:
        try:
            parts = A.schemacraft_attachment_import.compile_pattern(A, schema, template)
        except A.ApplicationError:
            # Source field removed since layout was configured: fall back visibly.
            response.setdefault('layout_warnings', []).append(A.schemacraft_i18n.display_text(schema.get('app', {}), language, 'title'))
    for group in response['groups']:
        if group.get('schema_id') != schema_id:
            continue
        for item in group['items']:
            rec = by_code.get(item['record_code'])
            if not rec:
                continue
            item['key'] = item.get('key') or Alerts.card_key(group['id'], item)
            item['updated_at'] = item.get('updated_at') or rec.get('updated_at', '')
            if parts:
                item['profile_display'] = ''.join(value if kind == 'text' else A.schemacraft_attachment_import._display(A, schema, rec, value) for kind, value in parts)[:2000]


def build_view(A, response, query, prefs, language='ar'):
    get = lambda key, default='': (query.get(key) or [default])[0]
    sort = get('sort', 'type')
    direction = get('direction', 'desc' if sort == 'edited' else 'asc')
    group_by = get('group_by', 'rule')
    if sort not in {'type', 'edited', 'profile', 'due', 'name', 'group_count'} or direction not in {'asc', 'desc'} or group_by not in {'rule', 'type', 'profile', 'edited_day', 'due_day', 'none'}:
        raise A.ApplicationError('اختيار ترتيب التنبيهات غير صالح.')
    q, field, kind = get('q').casefold().strip()[:500], get('field').casefold().strip()[:200], get('type')
    schema_filter, rule_filter = get('schema'), get('rule').casefold().strip()[:160]
    profile_filter, operator = get('profile').casefold().strip()[:500], get('operator')
    pin_filter, message_filter = get('pin'), get('message')
    if pin_filter not in {'', 'yes', 'no'} or message_filter not in {'', 'yes', 'no'}:
        raise A.ApplicationError('مرشح التنبيهات غير صالح.')
    bounds = {}
    for key in ('from', 'to', 'due_from', 'due_to'):
        raw = get(key)
        if raw:
            try: bounds[key] = date.fromisoformat(raw).isoformat()
            except (ValueError, TypeError): raise A.ApplicationError('مرشح تاريخ التنبيهات غير صالح.') from None
    if any(start in bounds and end in bounds and bounds[start] > bounds[end] for start, end in [('from', 'to'), ('due_from', 'due_to')]):
        raise A.ApplicationError('بداية فترة الترشيح يجب أن تسبق نهايتها.')
    try:
        offset = Alerts.bounded_int(get('offset', '0'), 0, 10000000)
        limit = Alerts.bounded_int(get('limit', '50'), 1, 100)
    except Alerts.AlertError as exc:
        raise A.ApplicationError(str(exc)) from exc
    all_items = []
    pins = set(prefs.get('pins', []))
    schema_options, field_options, rule_options = {}, set(), {}
    for group in response['groups']:
        schema_options[group['schema_id']] = group.get('schema_name', '')
        rule_options[group['id']] = {'id': group['id'], 'label': group['name'], 'schema_id': group['schema_id']}

        field_options.update(x for x in [group.get('field_name', ''), group.get('category_name', ''), *group.get('condition_names', [])] if x)
        meta = {k: v for k, v in group.items() if k not in {'items', 'total', 'offset', 'has_more'}}
        for original in group['items']:
            item = dict(original)
            item['key'] = item.get('key') or Alerts.card_key(group['id'], item)
            item['pinned'] = item['key'] in pins
            item['rule'] = {**meta, 'message': item.get('message', meta.get('message', ''))}
            updated = str(item.get('updated_at', ''))[:10]
            due = str(item.get('gregorian_date', ''))[:10]
            if kind and kind != group['color_type']: continue
            if schema_filter and schema_filter != group['schema_id']: continue
            if get('rule_id') and get('rule_id') != group['id']: continue
            if get('field_exact') and get('field_exact') not in [group.get('field_name', ''), group.get('category_name', ''), *group.get('condition_names', [])]: continue
            if rule_filter and rule_filter not in group['name'].casefold(): continue
            if operator and operator != group.get('operator'): continue
            if pin_filter and item['pinned'] != (pin_filter == 'yes'): continue
            if message_filter and bool(item['rule'].get('message', '').strip()) != (message_filter == 'yes'): continue
            if field and field not in (' '.join([group.get('field_name', ''), group.get('category_name', ''), *group.get('condition_names', [])])).casefold(): continue
            profile_text = ' '.join(str(item.get(k) or '') for k in ('record_code', 'record_title', 'profile_display')).casefold()
            if profile_filter and profile_filter not in profile_text: continue
            haystack = ' '.join(str(x or '') for x in [group['name'], item['rule'].get('message'), group.get('schema_name'), group.get('field_name'), group.get('category_name'), item.get('notes'), item.get('record_code'), item.get('record_title'), item.get('profile_display'), item.get('value')]).casefold()
            if q and q not in haystack: continue
            if 'from' in bounds and (not updated or updated < bounds['from']): continue
            if 'to' in bounds and (not updated or updated > bounds['to']): continue
            if 'due_from' in bounds and (not due or due < bounds['due_from']): continue
            if 'due_to' in bounds and (not due or due > bounds['due_to']): continue
            all_items.append(item)
    # Builder row order (stored internally as priority) and pins always dominate
    # the chosen ascending/descending secondary sort. No records are modified.
    if sort == 'edited': key = lambda i: (i.get('updated_at', ''), i['key'])
    elif sort == 'due': key = lambda i: (i.get('gregorian_date', ''), i['key'])
    elif sort == 'name': key = lambda i: (i['rule']['name'].casefold(), i['record_code'], i['key'])
    elif sort == 'profile': key = lambda i: (i.get('profile_display') or i.get('record_title') or i['record_code'], i['rule']['name'], i['key'])
    else: key = lambda i: (i['rule']['color_type'], i['rule']['name'], i['record_code'], i['key'])
    all_items.sort(key=key, reverse=direction == 'desc')
    all_items.sort(key=lambda i: -int(i['rule'].get('priority', 0)))
    all_items.sort(key=lambda i: not i['pinned'])
    groups = {}
    labels = {'ar': {'pins':'مثبتة', 'none':'كل التنبيهات', 'date':'دون تاريخ تعديل', 'due':'دون تاريخ استحقاق'}, 'fa': {'pins':'سنجاق‌شده', 'none':'همه هشدارها', 'date':'بدون تاریخ ویرایش', 'due':'بدون تاریخ سررسید'}}[language if language in {'ar','fa'} else 'ar']
    type_names = {'unassigned':('مرفقات غير مسندة','پیوست‌های تخصیص‌نیافته'), 'missing':('قيم فارغة','مقادیر خالی'), 'value':('قيمة محددة','مقدار مشخص'), 'threshold':('حدود رقمية','آستانه عددی'), 'expired':('تواريخ منتهية','تاریخ‌های منقضی'), 'date':('مواعيد وتواريخ','تاریخ و موعد'), 'count':('عدد البطاقات','تعداد کارت‌ها')}
    for item in all_items:
        rule = item['rule']
        if item['pinned']:
            material, name = 'pins', labels['pins']
        elif group_by == 'rule': material, name = 'rule:'+rule['id'], rule['name']
        elif group_by == 'type': material, name = 'type:'+rule['color_type'], type_names.get(rule['color_type'],('تنبيه','هشدار'))[language=='fa']
        elif group_by == 'profile': material, name = 'profile:'+rule['schema_id']+':'+item['record_code'], (item.get('profile_display') or item.get('record_title') or item['record_code'])
        elif group_by == 'edited_day': material = 'day:'+str(item.get('updated_at',''))[:10]; name = str(item.get('updated_at',''))[:10] or labels['date']
        elif group_by == 'due_day': material = 'due:'+str(item.get('gregorian_date',''))[:10]; name = str(item.get('gregorian_date',''))[:10] or labels['due']
        else: material, name = 'all', labels['none']
        gid = hashlib.sha256(material.encode()).hexdigest()[:24]
        g = groups.setdefault(gid, {'id':gid, 'name':name, 'total':0, 'items':[], 'pinned':material=='pins', '_colors':{}})
        if group_by == 'profile' and not item['pinned']:
            g['profile_code'] = item['record_code']
        g['total'] += 1
        g['items'].append(item)
        notice = 'danger' if rule['color_type'] in {'missing', 'expired', 'unassigned'} or (rule['color_type'] == 'count' and rule.get('operator') == 'count_eq' and str(item.get('value')) == '0') else 'warning' if rule['color_type'] == 'date' else 'info'
        color = rule.get('color', '')
        color = color if isinstance(color, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', color) else ''
        palette_key = (rule['color_type'], notice, color)
        entry = g['_colors'].setdefault(palette_key, {'type':rule['color_type'], 'notice':notice, 'color':color, 'count':0})
        entry['count'] += 1
    requested = get('group')
    output = []
    ordered_groups = list(groups.values())
    if sort == 'group_count':
        ordered_groups.sort(key=lambda g: (g['total'], g['name'].casefold(), g['id']), reverse=direction == 'desc')
        ordered_groups.sort(key=lambda g: not g['pinned'])
    for group in ordered_groups:
        if requested and group['id'] != requested: continue
        # Summarize ALL matches before slicing. A group's type colors must not
        # change merely because a different page or secondary sort was chosen.
        group['colors'] = [group['_colors'][k] for k in sorted(group['_colors'])]
        del group['_colors']
        group['items'] = group['items'][offset:offset+limit]
        group['offset'] = offset
        group['has_more'] = offset+len(group['items']) < group['total']
        output.append(group)
    response['overall_total'] = response['total']
    response['total'] = len(all_items)
    response['group_count'] = len(groups)
    response['groups'] = output
    response['layout'] = prefs['layout']
    response['filter_options'] = {'schemas':[{'id':sid, 'label':name} for sid,name in schema_options.items()], 'fields':sorted(field_options), 'rules':sorted(rule_options.values(), key=lambda item: (item['label'].casefold(), item['id']))}
    response['view'] = True
    return response
