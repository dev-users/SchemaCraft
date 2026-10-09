"""Named, read-only live alerts over saved schema data.

Rules belong to stable field/category IDs and are edited with the schema draft.
No alert scan writes records, workbooks, or a notification history. Dates use the
server's local calendar day. See THIRD_PARTY_ALERT_CALENDARS.txt for the calendar
algorithm sources and licenses; Hijri conversion is the civil/tabular calendar.
"""
from __future__ import annotations

import copy
import hashlib
import re
import unicodedata
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

import schemacraft_i18n as I18N
import schemacraft_alert_messages as Messages
import schemacraft_composite_text as Composite
import schemacraft_field_rules as FieldRules

MAX_RULES_PER_TARGET = 32
MAX_RULES_PER_SCHEMA = 2000
DATE_TYPES = {'date_gregorian', 'date_persian', 'date_hijri'}
LAYOUT_TYPES = {'spacer', 'horizontal_line', 'separator', 'field_group'}
NUMBER_OPS = {'gt', 'gte', 'lt', 'lte'}
DATE_OPS = {'expired', 'due_soon', 'on_date', 'after_days', 'date_window'}
COUNT_OPS = {'count_eq', 'count_lt', 'count_lte', 'count_gt', 'count_gte'}
BASE_OPS = {'empty', 'not_empty', 'equals', 'not_equals'}
ID_PATTERN = re.compile(r'alt_[a-f0-9]{12,32}\Z')
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫−', '01234567890123456789.-')

class AlertError(ValueError):
    pass


def text(value: Any) -> str:
    return '' if value is None else str(value).strip()


def empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip()) or (isinstance(value, (list, dict)) and not value)


def decimal(value: Any) -> Decimal:
    try:
        result = Decimal(text(value).translate(DIGITS))
    except (InvalidOperation, ValueError, TypeError):
        raise AlertError('قيمة المقارنة الرقمية في التنبيه غير صالحة.') from None
    if not result.is_finite() or len(text(value)) > 100:
        raise AlertError('قيمة المقارنة الرقمية في التنبيه غير صالحة.')
    return result


def arithmetic(field: dict) -> bool:
    return field.get('type') == 'number' and (field.get('number_behavior') or {}).get('storage_mode', 'numeric') != 'text'


def operators(owner: dict, category: bool = False) -> set[str]:
    if category:
        return COUNT_OPS if owner.get('kind') == 'repeatable' else set()
    typ = owner.get('type', 'text')
    if typ in LAYOUT_TYPES:
        return set()
    allowed = set(BASE_OPS)
    if typ in {'text', 'textarea', 'select', 'checkbox_group', 'yes_no', 'user_name', 'file', 'system_record_code'}:
        allowed.add('contains')
    if arithmetic(owner):
        allowed |= NUMBER_OPS
    if typ in DATE_TYPES:
        allowed |= DATE_OPS | NUMBER_OPS
    return allowed


def bounded_int(raw: Any, low: int, high: int) -> int:
    value = text(raw).translate(DIGITS)
    if not re.fullmatch(r'-?\d+', value):
        raise AlertError('أدخل عددًا صحيحًا صالحًا لإعداد التنبيه.')
    number = int(value)
    if not low <= number <= high:
        raise AlertError('عدد إعداد التنبيه خارج النطاق المسموح.')
    return number


def _persian_start(year: int) -> date:
    # Port of jalCal(year, true), jalaali-js 1.2.8 (MIT). All relevant divisions
    # are nonnegative for supported years; Python // therefore matches div().
    breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
              1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]
    if not 1 <= year <= 3177:
        raise ValueError('Persian year outside conversion range')
    previous, leap_j = breaks[0], -14
    for bound in breaks[1:]:
        jump = bound - previous
        if year < bound:
            break
        leap_j += (jump // 33) * 8 + (jump % 33) // 4
        previous = bound
    n = year - previous
    leap_j += (n // 33) * 8 + (n % 33 + 3) // 4
    if jump % 33 == 4 and jump - n == 4:
        leap_j += 1
    gy = year + 621
    leap_g = gy // 4 - ((gy // 100 + 1) * 3) // 4 - 150
    return date(gy, 3, 20 + leap_j - leap_g)


def day_value(value: Any, typ: str) -> date:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        if typ != 'date_gregorian':
            raise ValueError('Calendar must be explicit')
        return value
    raw = text(value).translate(DIGITS)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
        raise ValueError('Invalid date')
    y, m, d = map(int, raw.split('-'))
    if typ == 'date_gregorian':
        return date(y, m, d)
    if not 1 <= m <= 12 or y < 1:
        raise ValueError('Invalid calendar date')
    if typ == 'date_persian':
        start = _persian_start(y)
        # Keep the existing schema's leap validation untouched. When an entered
        # historical date is invalid under conversion, report it, never coerce.
        end = _persian_start(y + 1) if y < 3177 else date(3799, 3, 20)
        max_day = 31 if m <= 6 else 30 if m < 12 else (end - start).days - 336
        if not 1 <= d <= max_day:
            raise ValueError('Invalid Persian day')
        return start + timedelta(days=(m - 1) * 31 if m <= 6 else 186 + (m - 7) * 30) + timedelta(days=d - 1)
    if typ == 'date_hijri':
        leap = ((11 * y + 14) % 30) < 11
        if not 1 <= d <= (30 if m % 2 or (m == 12 and leap) else 29):
            raise ValueError('Invalid civil Hijri day')
        # Civil Islamic JD epoch 1948439.5; Gregorian ordinal epoch 1721424.5.
        ordinal = 227015 + (y - 1) * 354 + (3 + 11 * y) // 30 + (59 * (m - 1) + 1) // 2 + d - 1
        return date.fromordinal(ordinal)
    raise ValueError('Unsupported calendar')


def _canonical(value: Any, field: dict) -> Any:
    if field.get('type') == 'checkbox':
        if isinstance(value, bool):
            return value
        raw = text(value).casefold()
        if raw in {'true', '1', 'نعم'}:
            return True
        if raw in {'false', '0', 'لا'}:
            return False
        return raw
    option_map = {text(o.get('id')): text(o.get('label')) for o in field.get('options', []) if isinstance(o, dict)}
    if isinstance(value, list):
        return [option_map.get(text(v), text(v)) for v in value]
    return option_map.get(text(value), text(value))


def normalize_rules(raw: Any, owner: dict, *, category: bool = False, schema: dict | None = None) -> list[dict]:
    if raw is None:
        raw = []
    if not isinstance(raw, list) or len(raw) > MAX_RULES_PER_TARGET:
        raise AlertError('قائمة التنبيهات غير صالحة؛ الحد الأقصى 32 تنبيهًا لكل حقل أو فئة.')
    allowed = operators(owner, category)
    seen: set[str] = set()
    result = []
    for rule in raw:
        if not isinstance(rule, dict):
            raise AlertError('تعريف التنبيه غير صالح.')
        ident, name, op = text(rule.get('id')), text(rule.get('name')), text(rule.get('operator'))
        if not ID_PATTERN.fullmatch(ident) or ident in seen:
            raise AlertError('معرّف التنبيه غير صالح أو مكرر داخل الحقل أو الفئة.')
        if not name or len(name) > 160 or len(text(rule.get('message'))) > 2000:
            raise AlertError('اسم التنبيه مطلوب؛ الحد الأقصى 160 حرفًا للاسم و2000 للرسالة.')
        if op not in allowed:
            raise AlertError('شرط التنبيه لا يتوافق مع نوع الحقل أو الفئة.')
        if 'enabled' in rule and not isinstance(rule['enabled'], bool):
            raise AlertError('حالة تفعيل التنبيه غير صالحة.')
        seen.add(ident)
        item = {'id': ident, 'name': name, 'message': text(rule.get('message')), 'enabled': rule.get('enabled', True), 'operator': op}
        if rule.get('i18n'):
            item['i18n'] = I18N.normalize_names(rule['i18n'], ('name', 'message'))
        if rule.get('compare_field_id'):
            if category or schema is None:
                raise AlertError('المقارنة بين الحقول تتطلب حقلاً ومصدرًا متاحًا.')
            owner_category = next((c['id'] for c in schema.get('categories', []) if any(f['id'] == owner.get('id') for f in c.get('fields', []))), '')
            try:
                FieldRules.validate_comparison(schema, owner.get('id'), rule['compare_field_id'], owner_category, op)
            except FieldRules.RuleError as exc:
                raise AlertError(str(exc)) from exc
            item['compare_field_id'] = rule['compare_field_id']
        elif op in COUNT_OPS:
            item['value'] = bounded_int(rule.get('value'), 0, 1000000)
        elif arithmetic(owner) and op in (NUMBER_OPS | {'equals', 'not_equals'}):
            item['value'] = str(decimal(rule.get('value')))
        elif op in ({'equals', 'not_equals', 'contains'} | NUMBER_OPS):
            value = rule.get('value')
            if empty(value) or isinstance(value, (list, dict)) or len(text(value)) > 4000:
                raise AlertError('أدخل قيمة للتنبيه؛ استخدم شرط القيمة الفارغة بدلًا من ترك المقارنة فارغة.')
            if owner.get('type') == 'checkbox':
                value = _canonical(value, owner)
                if not isinstance(value, bool):
                    raise AlertError('قيمة تنبيه مربع الاختيار غير صالحة.')
            elif owner.get('type') in DATE_TYPES:
                value = text(value).translate(DIGITS)
                try:
                    day_value(value, owner['type'])
                except (ValueError, OverflowError):
                    raise AlertError('تاريخ المقارنة في التنبيه غير صالح.') from None
            elif owner.get('type') in {'select', 'checkbox_group', 'yes_no'} and not owner.get('record_options') and op != 'contains':
                # Prefer stable option IDs; existing saved values can be IDs or canonical labels.
                matches = [o for o in owner.get('options', []) if text(o.get('id')) == text(value) or text(o.get('label')) == text(value)]
                if len(matches) != 1:
                    raise AlertError('اختر قيمة قائمة صالحة للتنبيه.')
                value = matches[0]['id']
            item['value'] = value if isinstance(value, bool) else text(value)
        if op in {'due_soon', 'after_days'}:
            item['days'] = bounded_int(rule.get('days', 0), 0, 36500)
        if op == 'date_window':
            item['from_days'] = bounded_int(rule.get('from_days'), -36500, 36500)
            item['to_days'] = bounded_int(rule.get('to_days'), -36500, 36500)
            if item['from_days'] > item['to_days']:
                raise AlertError('بداية فترة التنبيه يجب أن تسبق نهايتها.')
        # Presentation is schema metadata, never an executable style/template.
        if 'icon' in rule:
            if not isinstance(rule['icon'], str) or rule['icon'] not in {'auto', 'info', 'warning', 'error', 'bell', 'calendar', 'document', 'clock', 'check'}:
                raise AlertError('اختر أيقونة صالحة للتنبيه.')
            item['icon'] = rule['icon']
        if 'message_template' in rule:
            if not isinstance(rule['message_template'], bool):
                raise AlertError('إعداد حقول رسالة التنبيه غير صالح.')
            item['message_template'] = rule['message_template']
        if 'color' in rule:
            color = text(rule['color'])
            if color and not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                raise AlertError('اختر لونًا صالحًا للتنبيه.')
            item['color'] = color.lower()
        if 'priority' in rule:
            item['priority'] = bounded_int(rule['priority'], 0, 2000)
        if 'hide_cause' in rule:
            if not isinstance(rule['hide_cause'], bool):
                raise AlertError('إعداد عرض سبب التنبيه غير صالح.')
            item['hide_cause'] = rule['hide_cause']
        if 'conditions' in rule:
            item['conditions'] = normalize_conditions(rule['conditions'], schema)
            mode = rule.get('condition_mode', 'all')
            if mode not in {'all', 'any'}:
                raise AlertError('طريقة جمع شروط التنبيه غير صالحة.')
            item['condition_mode'] = mode
        result.append(item)
    return result


def normalize_conditions(raw: Any, schema: dict | None) -> list[dict]:
    """Additional typed predicates over the same profile, identified by stable IDs.

    Repeated-field predicates explicitly choose this card, any/all cards, or a
    count of matching cards. All-cards requires at least one card (not vacuous).
    Separate predicates may match different cards; choose this_card for a join.
    """
    if not isinstance(raw, list) or len(raw) > 16:
        raise AlertError('الحد الأقصى 16 شرطًا إضافيًا لكل تنبيه.')
    if not raw:
        return []
    if schema is None:
        raise AlertError('يلزم التصميم للتحقق من مصادر شروط التنبيه.')
    categories = {c['id']: c for c in schema.get('categories', [])}
    fields = {f['id']: (c, f) for c in categories.values() for f in c.get('fields', [])}
    result = []
    for clause in raw:
        if not isinstance(clause, dict) or 'conditions' in clause:
            raise AlertError('شرط التنبيه الإضافي غير صالح.')
        kind, ref = clause.get('target_kind', 'field'), text(clause.get('target_id'))
        if kind == 'field' and ref in fields:
            cat, owner = fields[ref]
        elif kind == 'category' and ref in categories and categories[ref].get('kind') == 'repeatable':
            cat = owner = categories[ref]
        else:
            raise AlertError('مصدر شرط التنبيه مفقود. عدّل التنبيه قبل حذف الحقل أو الفئة.')
        single = {k: clause[k] for k in ('operator', 'value', 'days', 'from_days', 'to_days', 'compare_field_id') if k in clause}
        checked = normalize_rules([dict(single, id='alt_000000000000', name='condition')], owner, category=kind=='category', schema=schema)[0]
        clean = {k: v for k, v in checked.items() if k in ('operator', 'value', 'days', 'from_days', 'to_days', 'compare_field_id')}
        clean.update(target_kind=kind, target_id=ref)
        scope = clause.get('scope', 'any')
        if scope not in {'any', 'all', 'this_card', 'matching_count'}:
            raise AlertError('نطاق بطاقات شرط التنبيه غير صالح.')
        if kind == 'category':
            scope = 'any'  # total across the profile; owner rules retain parent-card scope.
        if cat.get('kind') != 'repeatable' and scope != 'any':
            raise AlertError('نطاق البطاقات متاح لحقول الفئات المتكررة فقط.')
        clean['scope'] = scope
        if scope == 'matching_count':
            op = clause.get('count_operator', 'count_gte')
            if op not in COUNT_OPS:
                raise AlertError('مقارنة عدد البطاقات غير صالحة.')
            clean['count_operator'] = op
            clean['count_value'] = bounded_int(clause.get('count_value', 1), 0, 1000000)
        result.append(clean)
    return result


def condition_match(clause: dict, schema: dict, record: dict, today: date, *, child_id='', owner_category='') -> bool:
    cats = {c['id']: c for c in schema.get('categories', [])}
    related, main = record.get('related', {}), record.get('values', record.get('main', {}))
    if clause['target_kind'] == 'category':
        return compare(clause, len(related.get(clause['target_id'], [])), {}, today)[0]
    cat, f = next((c, f) for c in cats.values() for f in c.get('fields', []) if f['id'] == clause['target_id'])
    if cat.get('kind') == 'main':
        values = [(_field_value(f, main, record), main)]
    else:
        rows = related.get(cat['id'], [])
        if clause.get('scope') == 'this_card':
            rows = [r for r in rows if cat['id'] == owner_category and r.get('_child_id') == child_id and child_id]
        values = [(_field_value(f, r.get('values', {}), record), r.get('values', {})) for r in rows]
    matches = [compare_context(clause, value, f, today, schema, record, local)[0] for value, local in values]
    scope = clause.get('scope', 'any')
    if scope == 'matching_count':
        return compare({'operator': clause['count_operator'], 'value': clause['count_value']}, sum(matches), {}, today)[0]
    return bool(matches) and all(matches) if scope == 'all' else any(matches)


def condition_names(rule: dict, schema: dict, language: str) -> list[str]:
    owners = {c['id']: c for c in schema.get('categories', [])}
    owners.update({f['id']: f for c in schema.get('categories', []) for f in c.get('fields', [])})
    keys = [rule.get('compare_field_id')]
    for c in rule.get('conditions', []): keys.extend([c['target_id'], c.get('compare_field_id')])
    return list(dict.fromkeys(I18N.display_text(owners[k], language) for k in keys if k in owners))


def card_key(group_id: str, item: dict) -> str:
    material = [group_id, item.get('record_code', ''), item.get('child_id', ''), item.get('parent_child_id', ''), item.get('attachment_id', '')]
    return hashlib.sha256('|'.join(material).encode()).hexdigest()[:32]


def normalize_schema(schema: dict) -> dict:
    """Called after core schema validation; no mutation of the caller's payload."""
    total = 0
    for category in schema.get('categories', []):
        if 'alerts' in category:
            category['alerts'] = normalize_rules(category['alerts'], category, category=True, schema=schema)
            total += len(category['alerts'])
        for field in category.get('fields', []):
            if 'alerts' in field:
                field['alerts'] = normalize_rules(field['alerts'], field, schema=schema)
                total += len(field['alerts'])
    for cat in schema.get('categories', []):
        for owner in [cat, *cat.get('fields', [])]:
            for rule in owner.get('alerts', []):
                try:
                    Messages.normalize_rule(rule, schema, cat['id'], owner is not cat)
                except Messages.MessageError as exc:
                    raise AlertError(str(exc)) from exc
                for clause in rule.get('conditions', []):
                    if clause.get('scope') == 'this_card' and (owner is cat or cat.get('kind') != 'repeatable' or not any(f['id'] == clause['target_id'] for f in cat.get('fields', []))):
                        raise AlertError('شرط البطاقة نفسها يجب أن يشير إلى حقل في الفئة المتكررة نفسها.')
    if total > MAX_RULES_PER_SCHEMA:
        raise AlertError('عدد التنبيهات في التصميم يتجاوز الحد المسموح.')
    return schema


def compare_context(rule, value, field, today, schema, record, local=None):
    if rule.get('compare_field_id'):
        cat, other = next((c, f) for c in schema['categories'] for f in c['fields'] if f['id'] == rule['compare_field_id'])
        values = record.get('values', record.get('main', {})) if cat['kind'] == 'main' else (local or {})
        right = _field_value(other, values, record)
        return FieldRules.compare_values(value, right, field, other, rule['operator']), {}
    return compare(rule, value, field, today)


def compare(rule: dict, value: Any, field: dict, today: date) -> tuple[bool, dict]:
    op = rule['operator']
    if op == 'empty':
        return empty(value), {}
    if op == 'not_empty':
        return not empty(value), {}
    if empty(value):
        return False, {}
    if op in DATE_OPS:
        target = day_value(value, field['type'])
        elapsed = (today - target).days
        matched = {'expired': lambda: elapsed > 0,
                   'on_date': lambda: elapsed == 0,
                   'due_soon': lambda: -rule['days'] <= elapsed <= 0,
                   'after_days': lambda: elapsed >= rule['days'],
                   'date_window': lambda: rule['from_days'] <= elapsed <= rule['to_days']}[op]()
        return matched, {'days_remaining': -elapsed, 'gregorian_date': target.isoformat(), 'calendar': field['type']}
    if op in COUNT_OPS:
        left, right = int(value), rule['value']
        op = {'count_eq': 'equals', 'count_lt': 'lt', 'count_lte': 'lte', 'count_gt': 'gt', 'count_gte': 'gte'}[op]
    elif arithmetic(field):
        left, right = decimal(value), decimal(rule['value'])
    elif field.get('type') in DATE_TYPES:
        left, right = day_value(value, field['type']), day_value(rule['value'], field['type'])
    else:
        left, right = _canonical(value, field), _canonical(rule.get('value'), field)
        if isinstance(left, list):
            if op == 'equals':
                return right in left, {}
            if op == 'not_equals':
                return right not in left, {}
            left = ' | '.join(map(str, left))
        if op == 'contains':
            return unicodedata.normalize('NFKC', text(right)).casefold() in unicodedata.normalize('NFKC', text(left)).casefold(), {}
    return {'equals': lambda: left == right, 'not_equals': lambda: left != right,
            'gt': lambda: left > right, 'gte': lambda: left >= right,
            'lt': lambda: left < right, 'lte': lambda: left <= right}[op](), {}


def color_type(rule: dict) -> str:
    op = rule['operator']
    if op.startswith('count_'):
        return 'count'
    if op == 'empty':
        return 'missing'
    if op in {'expired', 'after_days'}:
        return 'expired'
    if op in DATE_OPS:
        return 'date'
    if op in NUMBER_OPS:
        return 'threshold'
    return 'value'


def _field_value(field: dict, values: dict, record: dict) -> Any:
    system = {'system_record_code': 'record_code', 'system_created_at': 'created_at', 'system_updated_at': 'updated_at'}
    return record.get(system[field['type']], '') if field.get('type') in system else values.get(field['id'], '')


def scan(schema: dict, records: Iterable[dict], *, schema_id: str = '', schema_name: str = '',
         today: date | None = None, language: str = 'ar', limit: int = 50,
         group_id: str = '', offset: int = 0, summary: bool = False) -> dict:
    """Count all matches; bound returned cards, never silently cap badge counts.

    Empty repeat categories have no field instances: configure a card-count rule.
    Nested repeat counts are per parent card, not one total over unrelated parents.
    Alerts deliberately do not inherit appearance conditions (missing-data alerts
    must remain visible even if a field is hidden by another field's condition).
    """
    today = today or date.today()
    categories = schema.get('categories', [])
    cat_map = {c['id']: c for c in categories}
    configured = []
    for cat in categories:
        configured.extend((cat, None, r) for r in cat.get('alerts', []) if r.get('enabled', True))
        for field in cat.get('fields', []):
            configured.extend((cat, field, r) for r in field.get('alerts', []) if r.get('enabled', True))
    groups: dict[str, dict] = {}
    skipped = Counter()
    computed = any(f.get('composition') for c in categories for f in c.get('fields', []))
    title_fields = [f for c in categories if c.get('kind') == 'main' for f in c.get('fields', []) if f.get('result_title')]
    for record in records:
        if record.get('archived'):
            continue
        # Defensive copy only when a computed field needs evaluation.
        record = Composite.recompute_record(schema, copy.deepcopy(record)) if computed else record
        main = record.get('values', record.get('main', {}))
        related = record.get('related', {})
        title = ' · '.join(Composite.display(_field_value(f, main, record), f) for f in title_fields).strip(' ·') or record.get('record_code', '')
        for cat, field, rule in configured:
            owner = field or cat
            key = f"{schema_id}:{'field' if field else 'category'}:{owner['id']}:{rule['id']}"
            instances = []
            if field:
                if cat.get('kind') == 'main':
                    instances = [('', '', _field_value(field, main, record))]
                else:
                    instances = [(r.get('_child_id', ''), r.get('parent_child_id', ''), _field_value(field, r.get('values', {}), record)) for r in related.get(cat['id'], [])]
            else:
                cards = related.get(cat['id'], [])
                parent = cat_map.get(cat.get('parent_category_id'))
                if parent and parent.get('kind') == 'repeatable':
                    instances = [('', p.get('_child_id', ''), sum(1 for r in cards if r.get('parent_child_id') == p.get('_child_id'))) for p in related.get(parent['id'], [])]
                else:
                    instances = [('', '', len(cards))]
            for child_id, parent_id, value in instances:
                try:
                    local = next((r.get('values', {}) for r in related.get(cat['id'], []) if r.get('_child_id') == child_id), main)
                    matched, details = compare_context(rule, value, field or {}, today, schema, record, local)
                    extra = [condition_match(c, schema, record, today, child_id=child_id, owner_category=cat['id']) for c in rule.get('conditions', [])]
                    if extra:
                        matched = all([matched, *extra]) if rule.get('condition_mode', 'all') == 'all' else any([matched, *extra])
                except (AlertError, ValueError, OverflowError, TypeError, KeyError):
                    skipped[key] += 1
                    continue
                if not matched:
                    continue
                try:
                    message = Messages.render(rule, schema, record, cat['id'], child_id, language, allow_card=field is not None)
                except Messages.MessageError:
                    skipped[key] += 1
                    continue
                group = groups.setdefault(key, {'id': key, 'rule_id': rule['id'], 'name': I18N.display_text(rule, language, 'name'),
                    'message': I18N.display_text(rule, language, 'message'), 'color_type': color_type(rule), 'operator': rule['operator'],
                    'schema_id': schema_id, 'schema_name': schema_name, 'category_id': cat['id'],
                    'category_name': I18N.display_text(cat, language), 'field_id': field['id'] if field else '',
                    'field_name': I18N.display_text(field, language) if field else '', 'total': 0, 'items': [],
                    'condition_names': condition_names(rule, schema, language), 'color': rule.get('color', ''),
                    'priority': rule.get('priority', 0), 'hide_cause': rule.get('hide_cause', False), **({'icon': rule['icon']} if 'icon' in rule else {})})
                index = group['total']
                group['total'] += 1
                if summary or (group_id and key != group_id) or index < offset or len(group['items']) >= limit:
                    continue
                item = {'record_code': record['record_code'], 'record_title': title[:1000],
                    'child_id': child_id, 'parent_child_id': parent_id, 'value': Composite.display(value, field)[:2000] if field else str(value),
                    'updated_at': record.get('updated_at', ''), **details}
                if rule.get('message_template'):
                    item['message'] = message
                if child_id:
                    rows = related.get(cat['id'], [])
                    item['card_name'] = str(next((r.get('minor_id') or i+1 for i, r in enumerate(rows) if r.get('_child_id') == child_id), ''))
                item['key'] = card_key(key, item)
                group['items'].append(item)
    result = list(groups.values())
    for g in result:
        g['offset'] = offset
        g['has_more'] = offset + len(g['items']) < g['total'] if not summary else False
    return {'groups': [g for g in result if not group_id or g['id'] == group_id],
            'total': sum(g['total'] for g in result), 'group_count': len(result),
            'skipped_values': sum(skipped.values()), 'date': today.isoformat()}
