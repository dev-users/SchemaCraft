"""Opt-in field behavior. Never runs defaults during schema migration or reads.

Shared server rules for default initialization, two-key lists, date conversion,
field-to-field comparisons and staged row validation. All writes still go
through the application's normal record Save transaction.
"""
from __future__ import annotations
import copy
import json
from datetime import date, timedelta
from decimal import Decimal
from itertools import product
from schemacraft_value_presentation import wire_value

DATE_TYPES = {'date_gregorian', 'date_persian', 'date_hijri'}
TEXT_TYPES = {'text', 'textarea', 'select', 'yes_no', 'user_name', 'system_record_code'}
OPTION_TYPES = {'select', 'yes_no', 'checkbox_group'}

class RuleError(ValueError):
    pass


def empty(value):
    return value is None or value == '' or value == []


def numeric(f):
    return f.get('type') == 'number' and f.get('number_behavior', {}).get('storage_mode', 'numeric') != 'text'


def day(value, typ):
    from schemacraft_alerts import day_value
    try:
        return day_value(value, typ)
    except (ValueError, OverflowError) as exc:
        raise RuleError('التاريخ غير صالح للتقويم المحدد.') from exc


def date_text(value: date, typ: str):
    if typ == 'date_gregorian':
        return value.isoformat()
    if typ == 'date_persian':
        from schemacraft_entry_tools import persian_parts, iso
        try: return iso(persian_parts(value))
        except ValueError as exc: raise RuleError(str(exc)) from exc
    if typ == 'date_hijri':
        # Inverse of the same civil/tabular calendar used by existing alerts.
        if value < date.fromordinal(227015):
            raise RuleError('التاريخ قبل بداية التقويم الهجري المدعوم.')
        low, high = 1, min(9999, (value.toordinal() - 227015) // 354 + 2)
        while low < high:
            middle = (low + high + 1) // 2
            if day(f'{middle:04d}-01-01', typ) <= value: low = middle
            else: high = middle - 1
        y, month = low, 1
        while month < 12 and day(f'{y:04d}-{month+1:02d}-01', typ) <= value:
            month += 1
        n = (value - day(f'{y:04d}-{month:02d}-01', typ)).days + 1
        result = f'{y:04d}-{month:02d}-{n:02d}'
        if day(result, typ) != value: raise RuleError('التاريخ خارج نطاق التحويل.')
        return result
    raise RuleError('نوع التقويم غير صالح.')


def convert_date(value, source_type, target_type):
    if empty(value): return ''
    if source_type not in DATE_TYPES or target_type not in DATE_TYPES:
        raise RuleError('مصدر التاريخ أو وجهته ليس حقل تاريخ.')
    return date_text(day(value, source_type), target_type)


def compatible(left, right):
    a,b = left.get('type'), right.get('type')
    if a in DATE_TYPES or b in DATE_TYPES: return a in DATE_TYPES and b in DATE_TYPES
    if numeric(left) or numeric(right): return numeric(left) and numeric(right)
    if a == 'checkbox' or b == 'checkbox': return a == b
    if a == 'checkbox_group' or b == 'checkbox_group': return a == b
    return a not in {'file','spacer','field_group'} and b not in {'file','spacer','field_group'}


def compare_values(left, right, left_field, right_field, operator):
    """Compare scalar meanings, not unrelated option IDs. Blank RHS never matches."""
    import schemacraft_finance as F
    if empty(left) or empty(right): return False
    if not compatible(left_field, right_field):
        raise RuleError('نوعا حقلي المقارنة غير متوافقين.')
    op = {'greater_than':'gt','greater_or_equal':'gte','less_than':'lt','less_or_equal':'lte',
          'after':'gt','on_or_after':'gte','before':'lt','on_or_before':'lte'}.get(operator,operator)
    if left_field.get('type') in DATE_TYPES:
        a,b = day(left,left_field['type']),day(right,right_field['type'])
    elif numeric(left_field):
        a,b = F.decimal_value(left),F.decimal_value(right)
    elif left_field.get('type') == 'checkbox':
        a,b = F.truth(left), F.truth(right)
    elif left_field.get('type') == 'checkbox_group':
        def group(v,f):
            if isinstance(v,str): v=v.split(' | ')
            return {F._text(F.label(f,x)) for x in v}
        a,b = group(left,left_field),group(right,right_field)
        if op == 'contains': return b <= a
        if op == 'not_contains': return not b <= a
    else:
        a,b = F._text(F.label(left_field,left)),F._text(F.label(right_field,right))
    if op == 'equals': return a == b
    if op == 'not_equals': return a != b
    if op == 'contains': return str(b) in str(a)
    if op == 'not_contains': return str(b) not in str(a)
    if op == 'gt': return a > b
    if op == 'gte': return a >= b
    if op == 'lt': return a < b
    if op == 'lte': return a <= b
    raise RuleError('عامل المقارنة بين الحقول غير صالح.')


def validate_comparison(schema, source_id, compare_id, category_id, operator):
    lookup = {f['id']:(c,f) for c in schema['categories'] for f in c['fields']}
    if source_id not in lookup or compare_id not in lookup:
        raise RuleError('حقل المقارنة محذوف؛ اختر حقلًا متاحًا.')
    c,a = lookup[source_id]; rc,b=lookup[compare_id]
    if c['kind'] != 'main' and c['id'] != category_id or rc['kind'] != 'main' and rc['id'] != category_id:
        raise RuleError('قارن حقول السجل الرئيسي أو حقول البطاقة نفسها فقط.')
    if not compatible(a,b): raise RuleError('نوعا حقلي المقارنة غير متوافقين.')
    ops={'equals','not_equals','contains','not_contains'}
    if numeric(a): ops |= {'gt','gte','lt','lte','greater_than','greater_or_equal','less_than','less_or_equal'}
    if a['type'] in DATE_TYPES: ops |= {'gt','gte','lt','lte','after','before','on_or_after','on_or_before'}
    if a['type'] == 'checkbox': ops={'equals','not_equals'}
    if operator not in ops: raise RuleError('عامل المقارنة بين الحقول غير صالح.')
    return b


def source_tokens(field):
    return ['true','false'] if field['type']=='checkbox' else [o['id'] for o in field.get('options',[]) if o.get('active',True)]


def filter_source_ids(cfg):
    return cfg.get('source_field_ids') or [cfg.get('source_field_id')]


def token_key(tokens):
    return tokens[0] if len(tokens)==1 else json.dumps(tokens,ensure_ascii=False,separators=(',',':'))


def valid_filter_tokens(cfg, lookup):
    sources=[lookup[k] for k in filter_source_ids(cfg)]
    return {token_key(list(tokens)) for tokens in product(*(source_tokens(f) for f in sources))}


def dependency_token(app, field, main, row, indexes):
    cfg=field.get('option_filter')
    if not cfg: return ''
    tokens=[]
    for fid in filter_source_ids(cfg):
        f=indexes['fields'][fid]
        v=app.field_source_value(fid,indexes['field_categories'][field['id']],main,row,indexes)
        tokens.append(app.option_token(f,v))
    return token_key(tokens) if all(tokens) else ''


def normalize_double_filter(raw, field, category, lookup):
    if not isinstance(raw,dict): raise RuleError('تصفية الخيارات غير صالحة.')
    ids=raw.get('source_field_ids')
    if not isinstance(ids,list) or len(ids)!=2 or len(set(ids))!=2:
        raise RuleError('اختر حقلين مختلفين لتصفية القائمة.')
    if field['type'] not in {'select','checkbox_group'}: raise RuleError('تصفية الخيارات متاحة للقوائم فقط.')
    for fid in ids:
        if fid not in lookup or fid == field['id']: raise RuleError('مصدر تصفية القائمة غير صالح.')
        c,f=lookup[fid]
        if f['type'] not in {'select','yes_no','checkbox'} or (c['kind']!='main' and c['id']!=category['id']):
            raise RuleError('اختر مصدر قائمة أو مربع اختيار من السجل أو البطاقة نفسها.')
    if len(source_tokens(lookup[ids[0]][1])) * len(source_tokens(lookup[ids[1]][1])) > 2000:
        raise RuleError('عدد تركيبات القائمة يتجاوز 2000؛ قلّل خيارات المصدر.')
    cfg={'source_field_id':ids[0],'source_field_ids':ids[:], 'mappings':{}, 'unmatched':'none' if raw.get('unmatched')=='none' else 'all'}
    allowed_keys=valid_filter_tokens(cfg,{k:v[1] for k,v in lookup.items()})
    options={o['id'] for o in field.get('options',[])}
    mappings=raw.get('mappings',{})
    if not isinstance(mappings,dict): raise RuleError('خريطة خيارات الحقل غير صالحة.')
    for key, choices in mappings.items():
        if key not in allowed_keys: continue
        if not isinstance(choices,list): raise RuleError('خريطة خيارات الحقل غير صالحة.')
        cfg['mappings'][key]=list(dict.fromkeys(x for x in choices if isinstance(x,str) and x in options))
    return cfg


def normalize(app, schema, raw):
    lookup={f['id']:(c,f) for c in schema['categories'] for f in c['fields']}
    raw_lookup={f['id']:f for c in raw.get('categories',[]) for f in c.get('fields',[])}
    for fid,(cat,f) in lookup.items():
        rf=raw_lookup.get(fid,{})
        if rf.get('record_options') is not None:
            # Full source validation follows after schema fields are normalized.
            f['record_options'] = copy.deepcopy(rf['record_options'])
        if 'preserve_hidden_space' in rf:
            if not isinstance(rf['preserve_hidden_space'], bool):
                raise RuleError('إعداد الاحتفاظ بمساحة الحقل غير صالح.')
            f['preserve_hidden_space'] = rf['preserve_hidden_space']
        if rf.get('default_today'):
            if rf.get('default_today') is not True or f['type'] not in DATE_TYPES or rf.get('financial') or rf.get('composition') or f.get('auto_update') or f.get('date_value_mode', 'manual') != 'manual':
                raise RuleError('تاريخ اليوم الافتراضي متاح لحقول التاريخ اليدوية فقط.')
            if 'default_value' in rf:
                raise RuleError('اختر تاريخًا ثابتًا أو تاريخ اليوم، وليس كليهما.')
            f['default_today'] = True
        if f['type'] in OPTION_TYPES and 'allow_new_options' in rf:
            if not isinstance(rf['allow_new_options'],bool): raise RuleError('إعداد إضافة خيارات القائمة غير صالح.')
            f['allow_new_options']=rf['allow_new_options']
        if rf.get('option_filter',{} ) and isinstance(rf['option_filter'],dict) and rf['option_filter'].get('source_field_ids'):
            f['option_filter']=normalize_double_filter(rf['option_filter'],f,cat,lookup)
        if 'default_value' in rf:
            if f['type'] not in {'text','textarea','number','select','yes_no','checkbox','checkbox_group',*DATE_TYPES} or rf.get('financial') or rf.get('composition') or f.get('auto_update') or f.get('date_value_mode','manual')!='manual':
                raise RuleError('القيمة الافتراضية متاحة لحقول الإدخال اليدوي فقط.')
            sf=copy.deepcopy(f)
            if rf.get('exact_decimal'): sf['exact_decimal']=True
            # Schema metadata is JSON, not a workbook cell. Validate, then keep its wire scalar.
            f['default_value']=wire_value(app.normalize_field_value(copy.deepcopy(rf['default_value']),sf))
        if rf.get('number_display') is not None:
            cfg=rf['number_display']
            if f['type']!='number' or not isinstance(cfg,dict) or cfg.get('group_separator',',') not in {',','٬',' '} or cfg.get('decimal_separator','.') not in {'.','٫'}:
                raise RuleError('إعداد فواصل العدد غير صالح.')
            f['number_display']={'group_separator':cfg.get('group_separator',','),'decimal_separator':cfg.get('decimal_separator','.') }
            if cfg.get('decimal_places') is not None:
                places=cfg['decimal_places']
                if type(places) is not int or not 0 <= places <= 12:
                    raise RuleError('المنازل العشرية يجب أن تكون عددًا صحيحًا من 0 إلى 12.')
                f['number_display']['decimal_places']=places
        if rf.get('fill_today_when_required'):
            if not isinstance(rf['fill_today_when_required'],bool) or f['type'] not in DATE_TYPES or rf.get('financial') or f.get('auto_update') or f.get('date_value_mode','manual')!='manual':
                raise RuleError('التاريخ الحالي التلقائي متاح لحقل تاريخ يدوي فقط.')
            f['fill_today_when_required']=True
    for rule in schema.get('conditions',[]):
        if rule.get('compare_field_id'):
            cid=rule['target_id'] if rule['target_type']=='category' else lookup[rule['target_id']][0]['id']
            validate_comparison(schema,rule['source_field_id'],rule['compare_field_id'],cid,rule['operator'])
    # List dependency cycles would erase values while the client repeatedly refreshes.
    graph={fid:filter_source_ids(f['option_filter']) for fid,(_,f) in lookup.items() if f.get('option_filter')}
    active=set();done=set()
    def visit(fid):
        if fid in done:return
        if fid in active:raise RuleError('يوجد اعتماد دائري بين القوائم التابعة.')
        active.add(fid)
        for dep in graph.get(fid,[]): visit(dep)
        active.remove(fid);done.add(fid)
    for fid in graph:visit(fid)
    return schema


def apply_initial(app,schema,payload,existing=None,*,new_record=False,today=None,fill_dates=True):
    """Only absent keys in new records/cards get defaults. Explicit blanks stay blank."""
    main=payload.setdefault('main',{})
    related=payload.setdefault('related',{})
    indexes=app.schema_indexes(schema)
    today=today or date.today()
    for cat in schema['categories']:
        if cat['kind']=='main': entries=[(main,new_record,None)]
        elif cat['kind']=='repeatable':
            old={r.get('_child_id') for r in (existing or {}).get('related',{}).get(cat['id'],[])}
            entries=[(r.setdefault('values',{}),not r.get('_child_id') or r.get('_child_id') not in old,r) for r in related.get(cat['id'],[]) if isinstance(r,dict)]
        else:continue
        for values,is_new,row in entries:
            for f in cat['fields']:
                if is_new and f['id'] not in values and 'default_value' in f:
                    values[f['id']]=copy.deepcopy(f['default_value'])
                elif is_new and f['id'] not in values and f.get('default_today'):
                    values[f['id']]=date_text(today,f['type'])
    if not fill_dates:return
    today=today or date.today()
    for cat in schema['categories']:
        entries=[main] if cat['kind']=='main' else [r.get('values',{}) for r in related.get(cat['id'],[])]
        for values in entries:
            rv=values if cat['kind']=='repeatable' else None
            for f in cat['fields']:
                if f.get('required') and f.get('fill_today_when_required') and empty(values.get(f['id'])) and app.target_visible('category',cat['id'],main,rv,indexes) and app.target_visible('field',f['id'],main,rv,indexes):
                    values[f['id']]=date_text(today,f['type'])


def validate_row(app,payload):
    schema=app.read_schema_file(); indexes=app.schema_indexes(schema)
    cid=payload.get('category_id'); cat=indexes['categories'].get(cid)
    if not cat or cat['kind']!='repeatable':raise RuleError('الفئة المتكررة غير متاحة.')
    main=copy.deepcopy(payload.get('main',{})); row=copy.deepcopy(payload.get('row',{}))
    if not isinstance(main,dict) or not isinstance(row,dict) or not isinstance(row.get('values',{}),dict):raise RuleError('بيانات الصف غير صالحة.')
    draft={'main':main,'related':{cid:[row]}}
    apply_initial(app,schema,draft,existing={'related':{cid:[row]}} if not payload.get('new_row') else None,fill_dates=True)
    values=row['values']; normalized={};visible_fields=[]
    for f in app.data_fields(cat):
        visible=app.target_visible('category',cid,main,values,indexes) and app.target_visible('field',f['id'],main,values,indexes)
        raw=values.get(f['id'],'')
        try:
            if f['type']=='file':
                # Presence only; full content/ownership checks remain at record Save.
                value=raw
            else:
                value=app.normalize_field_value(raw,f)
                if visible:app.validate_dependent_option_value(f,value,main,values,indexes)
            if visible:
                visible_fields.append(f)
                if f.get('required') and (not (value.get('selected') or value.get('stored_path') or value.get('upload')) if f['type']=='file' and isinstance(value,dict) else app.required_value_missing(f,value)):
                    raise RuleError(f'الحقل «{f["label"]}» مطلوب.')
        except (app.ApplicationError, RuleError) as exc:
            raise RuleError(f'تعذر تأكيد الصف في «{cat["label"]}» — الحقل «{f["label"]}»: {exc}') from exc
        normalized[f['id']]=value
    app.validate_cross_field_constraints(visible_fields,normalized)
    import schemacraft_record_choices as C
    existing = None
    if payload.get('record_code'):
        import schemacraft_finance_api as API
        _, records = API.resolver_for(app, schema)(app.current_schema_id() or '')
        existing = next((r for r in records if r['record_code'] == payload['record_code']), None)
    C.validate_values(app, schema, {'main':main, 'related':{cid:[{**row,'values':normalized}]}}, existing)
    # Excel retains its native types; only the API representation is converted.
    return {'values':wire_value(normalized),'ok':True}
