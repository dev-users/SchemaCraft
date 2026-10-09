"""Pure, non-executable computed text fields with stable source identifiers.

The persisted field is type=text; composition is extra metadata. No eval, no
spreadsheet formulas, no record/schema labels used as binding identifiers.
"""
from __future__ import annotations
import copy
import re
from typing import Any, Callable

MAX_SOURCES = 64
MAX_TEMPLATE = 4000
MAX_TOKENS = 256
MAX_RESULT = 32767
SYSTEM_KEYS = {'system_record_code':'record_code', 'system_created_at':'created_at',
               'system_updated_at':'updated_at'}

class CompositionError(ValueError):
    pass

def is_composed(field: dict) -> bool:
    return field.get('type') == 'text' and isinstance(field.get('composition'), dict)

def tokens(template: str, count: int) -> list[tuple[str, Any]]:
    """Parse literal braces and numbered placeholders; reject all other syntax."""
    if not isinstance(template, str) or not template.strip() or len(template) > MAX_TEMPLATE:
        raise CompositionError('صيغة النص المركب مطلوبة وبحد أقصى 4000 حرف.')
    output: list[tuple[str, Any]] = []
    literal: list[str] = []
    i = uses = 0
    while i < len(template):
        char = template[i]
        if char in '{}':
            if i + 1 < len(template) and template[i + 1] == char:
                literal.append(char); i += 2; continue
            if char == '}':
                raise CompositionError('استخدم الأقواس المزدوجة لكتابة قوس حرفي.')
            end = template.find('}', i + 1)
            key = template[i + 1:end] if end != -1 else ''
            if not re.fullmatch(r'[1-9][0-9]*', key) or not 1 <= int(key) <= count:
                raise CompositionError('أحد رموز النص المركب لا يطابق حقل مصدر مختارًا.')
            if literal: output.append(('text', ''.join(literal))); literal = []
            output.append(('source', int(key) - 1)); uses += 1
            if uses > MAX_TOKENS:
                raise CompositionError('عدد رموز النص المركب يتجاوز الحد المسموح.')
            i = end + 1; continue
        if ord(char) < 32 and char not in '\n\r\t':
            raise CompositionError('صيغة النص المركب تحتوي على محارف تحكم غير مسموحة.')
        literal.append(char); i += 1
    if literal: output.append(('text', ''.join(literal)))
    if not uses:
        raise CompositionError('أضف رمز حقل واحد على الأقل إلى صيغة النص المركب.')
    return output

def migrate_legacy(payload: Any) -> Any:
    """Migrate earlier layout groups without dropping their member references.

    File members contribute filenames only; system members contribute metadata.
    No files are opened. This makes all previously valid groups loadable.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get('categories'), list):
        return payload
    result = copy.deepcopy(payload)
    for category in result['categories']:
        if not isinstance(category, dict) or not isinstance(category.get('fields'), list): continue
        for field in category['fields']:
            if not isinstance(field, dict) or field.get('type') != 'field_group': continue
            members = field.get('field_ids')
            if (not isinstance(members, list) or len(members) < 2
                    or any(not isinstance(x, str) or not x for x in members)
                    or len(set(members)) != len(members)):
                raise CompositionError('اختر حقلين مختلفين على الأقل للنص المركب.')
            field['type'] = 'text'
            field['composition'] = {'field_ids': list(members),
                'template': ' '.join('{'+str(i+1)+'}' for i in range(len(members)))}
            field.pop('field_ids', None)
            field.update(required=False, unique=False, validation={}, auto_update=None,
                         option_filter=None, related_person_source_field_id=None,
                         related_person_source_checkbox_id=None)
    return result

def normalize(schema: dict) -> dict:
    """Validate after ordinary schema normalization; preserve only safe metadata."""
    fields = {f['id']:(c,f) for c in schema.get('categories',[]) for f in c.get('fields',[])}
    graph: dict[str, list[str]] = {}
    for target_id, (category, field) in fields.items():
        raw = field.get('composition')
        dependencies: list[str] = []
        rule = field.get('auto_update')
        if rule and rule.get('source_field_id'):
            dependencies.append(rule['source_field_id'])
        if raw is not None:
            if field.get('type') != 'text' or not isinstance(raw, dict):
                raise CompositionError('النص المركب يجب أن يكون حقلًا نصيًا.')
            sources = raw.get('field_ids')
            if (not isinstance(sources,list) or not 2 <= len(sources) <= MAX_SOURCES
                    or any(not isinstance(x,str) or not x for x in sources)
                    or len(set(sources)) != len(sources)):
                raise CompositionError('اختر حقلين مختلفين على الأقل للنص المركب.')
            parsed = tokens(raw.get('template'), len(sources))
            for source_id in sources:
                source = fields.get(source_id)
                if source is None or source[1].get('type') in {'spacer','field_group'}:
                    raise CompositionError('أحد مصادر النص المركب محذوف أو ليس حقل قيمة.')
                if source_id == target_id:
                    raise CompositionError('لا يمكن أن يعتمد النص المركب على نفسه.')
                if source[0].get('kind') != 'main' and source[0]['id'] != category['id']:
                    raise CompositionError('مصدر النص المركب يجب أن يكون رئيسيًا أو من البطاقة نفسها.')
            if rule or field.get('related_person_source_field_id'):
                raise CompositionError('لا تجمع بين النص المركب وقاعدة تعبئة أخرى للحقل نفسه.')
            field['composition'] = {'field_ids':list(sources), 'template':raw['template']}
            dependencies.extend(sources)
        else:
            field.pop('composition',None)
        graph[target_id] = dependencies
    visiting: set[str] = set(); done: set[str] = set()
    def visit(key: str, chain: list[str]):
        if key in done: return
        if key in visiting:
            cycle = chain[chain.index(key):]
            if any(is_composed(fields[x][1]) for x in cycle if x in fields):
                raise CompositionError('يوجد اعتماد دائري بين النصوص المركبة أو قواعد التعبئة.')
            return  # Existing non-composition bounded auto rules keep their semantics.
        visiting.add(key)
        for dependency in graph.get(key,[]): visit(dependency, chain+[key])
        visiting.remove(key); done.add(key)
    for key in graph: visit(key,[])
    return schema

def ordered_fields(schema: dict) -> list[tuple[dict,dict]]:
    lookup = {f['id']:(c,f) for c in schema.get('categories',[]) for f in c.get('fields',[])}
    result = []; seen = set(); active = set()
    def add(key):
        if key in seen: return
        if key in active: raise CompositionError('يوجد اعتماد دائري بين النصوص المركبة أو قواعد التعبئة.')
        pair = lookup.get(key)
        if not pair or not is_composed(pair[1]): return
        active.add(key)
        for dep in pair[1]['composition']['field_ids']: add(dep)
        active.remove(key); seen.add(key); result.append(pair)
    for key in lookup: add(key)
    return result

def _choice(field: dict, value: Any) -> str:
    text = str(value)
    for option in field.get('options',[]):
        if isinstance(option,dict) and (value == option.get('id') or text == str(option.get('label'))):
            return str(option.get('label',''))
    return text

def display(value: Any, field: dict) -> str:
    if value is None or value == '' or value == []: return ''
    kind = field.get('type')
    if kind == 'file':
        if isinstance(value, list): return '، '.join(filter(None,(display(x,field) for x in value)))
        if isinstance(value, dict):
            value = value.get('name') or value.get('original_name') or value.get('filename') or value.get('path') or ''
        return str(value).replace('\\','/').rsplit('/',1)[-1]
    if kind == 'checkbox':
        checked = value is True or value == 1 or str(value).lower() in {'true','1','yes','نعم'}
        return str(field.get('checkbox_true_label') or 'نعم') if checked else str(field.get('checkbox_false_label') or 'لا')
    if isinstance(value,list): return '، '.join(_choice(field,x) for x in value)
    if kind in {'select','yes_no','checkbox_group'}: return _choice(field,value)
    if isinstance(value,bool): return 'true' if value else 'false'
    if isinstance(value,dict): return ''
    if isinstance(value,float) and value.is_integer(): return str(int(value))
    return str(value).strip()

def render(composition: dict, values: list[str]) -> str:
    parts = tokens(composition['template'], len(composition['field_ids']))
    if not any(values[index] for kind,index in parts if kind == 'source'): return ''
    out = ''.join(value if kind == 'text' else values[value] for kind,value in parts).strip()
    if len(out) > MAX_RESULT: raise CompositionError('النص المركب الناتج أطول من الحد المسموح.')
    return out

def recompute(schema: dict, main: dict, related: dict, metadata: dict | None = None,
              normalize_value: Callable | None = None) -> bool:
    ordered = ordered_fields(schema)
    if not ordered: return False
    lookup = {f['id']:(c,f) for c in schema['categories'] for f in c['fields']}
    metadata = metadata or {}; changed = False
    for category,field in ordered:
        rows = [None] if category.get('kind') == 'main' else related.get(category['id'],[])
        if not isinstance(rows,list): continue
        for row in rows:
            target = main if row is None else row.get('values',row) if isinstance(row,dict) else None
            if not isinstance(target,dict): continue
            source_values = []
            for source_id in field['composition']['field_ids']:
                source_category, source_field = lookup[source_id]
                source_dict = main if source_category.get('kind') == 'main' else target
                if source_field.get('type') in SYSTEM_KEYS:
                    value = metadata.get(SYSTEM_KEYS[source_field['type']],source_dict.get(source_id,''))
                else: value = source_dict.get(source_id,'')
                if (normalize_value and value not in (None,'') and source_field.get('type') not in {*SYSTEM_KEYS,'file'}
                        and not is_composed(source_field)):
                    value = normalize_value(value,source_field)
                source_values.append(display(value,source_field))
            result = render(field['composition'],source_values)
            if target.get(field['id']) != result:
                target[field['id']] = result; changed = True
    return changed

def recompute_record(schema: dict, record: dict) -> dict:
    if any(is_composed(f) for c in schema.get('categories',[]) for f in c.get('fields',[])):
        recompute(schema,record.setdefault('values',{}),record.setdefault('related',{}),record)
    return record

def literal_cells(sheet, fields: list[dict], row: int, columns: dict) -> None:
    """Force computed output to literal Excel text even when it begins with '='."""
    for field in fields:
        if is_composed(field) and field['id'] in columns:
            cell = sheet.cell(row=row,column=columns[field['id']])
            if cell.value is not None:
                cell.data_type = 's'; cell.number_format = '@'
