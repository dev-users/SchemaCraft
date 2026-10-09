"""Safe per-record alert messages. Only named field tokens, never executable code.

The flag is explicit so pre-feature messages containing ordinary braces keep their
literal meaning. Field references use stable keys internally; the editor supplies
human labels. Main fields and the alert's own repeated card are deterministic.
"""
from __future__ import annotations

import copy
import re
from typing import Any

import schemacraft_composite_text as Composite
import schemacraft_i18n as I18N

TOKEN = re.compile(r'\{\{|\}\}|\{([^{}]+)\}')
MAX_TEMPLATE = 2000
MAX_TOKENS = 64
MAX_RESULT = 16000
EXCLUDED_TYPES = {'spacer', 'separator', 'horizontal_line', 'field_group'}


class MessageError(ValueError):
    pass


def parse(value: Any) -> list[tuple[str, str]]:
    if not isinstance(value, str) or len(value) > MAX_TEMPLATE:
        raise MessageError('صيغة رسالة التنبيه غير صالحة؛ الحد الأقصى 2000 حرف.')
    result = []
    end = 0
    count = 0
    for m in TOKEN.finditer(value):
        literal = value[end:m.start()]
        if '{' in literal or '}' in literal:
            raise MessageError('أقواس رسالة التنبيه غير متوازنة. استخدم {{ و }} للأقواس العادية.')
        if literal:
            result.append(('text', literal))
        if m.group(1) is None:
            result.append(('text', m[0][0]))
        else:
            count += 1
            if count > MAX_TOKENS:
                raise MessageError('الحد الأقصى 64 مرجع حقل في رسالة التنبيه.')
            result.append(('field', m.group(1).strip()))
        end = m.end()
    last = value[end:]
    if '{' in last or '}' in last:
        raise MessageError('أقواس رسالة التنبيه غير متوازنة. استخدم {{ و }} للأقواس العادية.')
    if last:
        result.append(('text', last))
    return result


def fields(schema: dict, category_id: str = '', allow_card: bool = False) -> dict[str, tuple[dict, dict]]:
    return {f['id']: (c, f) for c in schema.get('categories', [])
            if c.get('kind') == 'main' or (allow_card and c.get('id') == category_id)
            for f in c.get('fields', []) if f.get('type') not in EXCLUDED_TYPES}


def normalize_template(value: str, schema: dict, category_id: str, allow_card: bool) -> str:
    available = fields(schema, category_id, allow_card)
    aliases: dict[str, set[str]] = {}
    for ident, (cat, field) in available.items():
        flabels = {str(field.get('label', '')), *(I18N.display_text(field, lang) for lang in ('ar', 'fa'))}
        clabels = {str(cat.get('label', '')), *(I18N.display_text(cat, lang) for lang in ('ar', 'fa'))}
        for name in {ident, *flabels, *(c+' / '+f for c in clabels for f in flabels)}:
            if name:
                aliases.setdefault(name, set()).add(ident)
    for name in ('record_code', 'ID', 'معرّف السجل', 'شناسه رکورد'):
        aliases.setdefault(name, set()).add('record_code')
    chunks = []
    for kind, token in parse(value):
        if kind == 'text':
            chunks.append(token.replace('{', '{{').replace('}', '}}'))
        else:
            # Exact technical identities take precedence over matching labels.
            matches = {token} if token in available or token == 'record_code' else aliases.get(token, set())
            if len(matches) != 1:
                raise MessageError('اختر حقولًا موجودة من السجل الرئيسي أو البطاقة نفسها لرسالة التنبيه؛ المرجع غير متاح أو الاسم مكرر.')
            chunks.append('{'+next(iter(matches))+'}')
    result = ''.join(chunks)
    if len(result) > MAX_TEMPLATE:
        raise MessageError('صيغة رسالة التنبيه غير صالحة؛ الحد الأقصى 2000 حرف.')
    return result


def normalize_rule(rule: dict, schema: dict, category_id: str, allow_card: bool) -> None:
    if not rule.get('message_template'):
        return
    rule['message'] = normalize_template(rule.get('message', ''), schema, category_id, allow_card)
    for lang in ('ar', 'fa'):
        names = rule.get('i18n', {}).get(lang, {})
        if 'message' in names:
            names['message'] = normalize_template(names['message'], schema, category_id, allow_card)


def render(rule: dict, schema: dict, record: dict, category_id: str, child_id: str,
           language: str = 'ar', *, allow_card: bool = False) -> str:
    raw = I18N.display_text(rule, language, 'message')
    if not rule.get('message_template'):
        return raw
    available = fields(schema, category_id, allow_card)
    main = record.get('values', record.get('main', {}))
    current = next((row.get('values', {}) for row in record.get('related', {}).get(category_id, [])
                    if child_id and row.get('_child_id') == child_id), {})
    chunks = []
    for kind, key in parse(raw):
        if kind == 'text':
            chunks.append(key)
            continue
        if key == 'record_code':
            chunks.append(str(record.get('record_code') or ''))
            continue
        if key not in available:
            raise MessageError('حقل مستخدم في رسالة التنبيه لم يعد متاحًا.')
        cat, field = available[key]
        values = main if cat.get('kind') == 'main' else current
        system = {'system_record_code': 'record_code', 'system_created_at': 'created_at', 'system_updated_at': 'updated_at'}
        value = record.get(system[field['type']], '') if field.get('type') in system else values.get(key, '')
        # Display values using manual aliases without rewriting saved values.
        display_field = copy.deepcopy(field)
        for option in display_field.get('options', []):
            option['label'] = I18N.display_text(option, language)
        if field.get('type') == 'file':
            # Do not expose storage paths or read file contents into messages.
            if isinstance(value, str):
                value = value.replace('\\', '/').rsplit('/', 1)[-1]
        chunks.append(Composite.display(value, display_field))
    result = ''.join(chunks)
    if len(result) > MAX_RESULT:
        raise MessageError('رسالة التنبيه الناتجة أطول من الحد المسموح.')
    return result


def remap_owner(owner: dict, mapping: dict[str, str], *, strict: bool = True) -> None:
    """Remap reusable category keys to instance IDs (or the reverse)."""
    for rule in owner.get('alerts', []):
        if not rule.get('message_template'):
            continue
        def convert(template: str) -> str:
            parts = []
            for kind, key in parse(template):
                if kind == 'text':
                    parts.append(key.replace('{', '{{').replace('}', '}}'))
                elif key == 'record_code':
                    parts.append('{record_code}')
                elif mapping.get(key):
                    parts.append('{'+mapping[key]+'}')
                elif strict:
                    raise MessageError('رسالة التنبيه تشير إلى حقل خارج التعريف العام؛ أدرج الفئة التي تحتوي حقول الرسالة.')
                else:
                    parts.append('{'+key+'}')
            return ''.join(parts)
        rule['message'] = convert(rule.get('message', ''))
        for lang in ('ar', 'fa'):
            names = rule.get('i18n', {}).get(lang, {})
            if 'message' in names:
                names['message'] = convert(names['message'])
