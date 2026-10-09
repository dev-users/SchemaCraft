"""Schema-native tables, read-only views and bounded decimal calculations.

No expression evaluation, SQL, new workspace, or independent ledger. Definitions
belong to existing categories/fields. All references are IDs internally; labels
are presentation. An Engine operates on an isolated record/snapshot and never
writes a source record. Missing/ambiguous sources and mixed currencies fail
explicitly instead of manufacturing a financial result.
"""
from __future__ import annotations

import copy
import re
import unicodedata
import schemacraft_expressions as Expressions
import schemacraft_value_presentation as Presentation
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_UP
from typing import Any, Callable

MAX_RULES = 64
MAX_SOURCES = 32
MAX_ROWS = 50000
MAX_DEPTH = 32
MAX_DIGITS = 28
OPERATORS = {'equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty',
             'gt', 'gte', 'lt', 'lte', 'between', 'in'}
OPERATIONS = {'sum', 'subtract', 'multiply', 'divide', 'average', 'count', 'min', 'max'}
AGGREGATES = {'sum', 'sumif', 'sumifs', 'average', 'count', 'min', 'max'}
SYSTEM = {'$record_code', '$updated_at', '$created_at'}
NUMBER_TYPES = {'number'}

class FinanceError(ValueError):
    pass

def enabled(schema: dict) -> bool:
    return any(c.get('table') or c.get('view_table') or
               any(f.get('financial') or f.get('exact_decimal') for f in c.get('fields', []))
               for c in schema.get('categories', []))

def fields(schema: dict) -> dict[str, tuple[dict, dict]]:
    return {f['id']: (c, f) for c in schema.get('categories', []) for f in c.get('fields', [])}

def numeric(field: dict) -> bool:
    return field.get('type') == 'number' and field.get('number_behavior', {}).get('storage_mode', 'numeric') != 'text'

def blank(value: Any) -> bool:
    return value is None or value == '' or value == []

def normalize_digits(value: Any) -> str:
    if isinstance(value, bool):
        raise FinanceError('القيمة المطلوبة رقم وليست مربع اختيار.')
    return str(value).strip().translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫−', '01234567890123456789.-'))

def decimal_value(value: Any) -> Decimal:
    text = normalize_digits(value)
    # A comma is never guessed to mean a decimal mark or thousands separator.
    if len(text) > 80 or not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,2})?', text):
        raise FinanceError('أدخل رقمًا عشريًا صالحًا دون فواصل آلاف.')
    try:
        d = Decimal(text)
    except InvalidOperation as exc:
        raise FinanceError('القيمة العددية غير صالحة.') from exc
    if not d.is_finite() or len(d.as_tuple().digits) > MAX_DIGITS or (d and (d.adjusted() > 24 or d.adjusted() < -18)):
        raise FinanceError('القيمة العددية تتجاوز دقة الحساب المسموحة.')
    return d

def decimal_text(value: Any, precision: int | None = None) -> str:
    d = value if isinstance(value, Decimal) else decimal_value(value)
    try:
        with localcontext() as ctx:
            ctx.prec = 60
            if precision is not None:
                d = d.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP)
            if not d.is_finite() or (d and (d.adjusted() > 24 or d.adjusted() < -18)):
                raise FinanceError('نتيجة الحساب تتجاوز النطاق المسموح.')
            out = format(d, 'f')
    except InvalidOperation as exc:
        raise FinanceError('تعذّر تقريب نتيجة الحساب.') from exc
    if '.' in out:
        out = out.rstrip('0').rstrip('.')
    return '0' if out in {'-0', '+0', ''} else out

def label(field: dict, value: Any) -> str:
    if blank(value): return ''
    if isinstance(value, (date, datetime)): return value.isoformat()
    if field.get('type') == 'checkbox':
        return str(field.get('checkbox_true_label') or 'نعم') if truth(value) else str(field.get('checkbox_false_label') or 'لا')
    if isinstance(value, list): return '، '.join(label(field, v) for v in value)
    for option in field.get('options', []):
        if isinstance(option, dict) and str(value) in {str(option.get('id')), str(option.get('label'))}:
            return str(option.get('label', ''))
    return str(value)

def truth(value: Any) -> bool:
    return value is True or (not isinstance(value, bool) and str(value).strip().lower() in {'1','true','yes','نعم'})

def _text(value: Any) -> str:
    return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())

def condition_matches(rule: dict, value: Any, field: dict, context: dict | None = None) -> bool:
    op = rule['operator']
    if op == 'empty': return blank(value)
    if op == 'not_empty': return not blank(value)
    if op == 'in':
        return any((blank(value) and blank(v)) or (not blank(value) and not blank(v) and condition_matches({'operator':'equals','value':v}, value, field, context)) for v in rule.get('values', []))
    if blank(value): return False
    expected = rule.get('value', '')
    if rule.get('value_field_id'):
        expected = (context or {}).get(rule['value_field_id'], '')
        if blank(expected): return False
    if field.get('type') == 'checkbox':
        lhs, rhs = truth(value), truth(expected)
    elif numeric(field):
        lhs, rhs = decimal_value(value), decimal_value(expected)
    elif isinstance(value, list):
        actual = {_text(label(field, v)) for v in value}
        rhs = _text(label(field, expected))
        return (rhs not in actual) if op in {'not_equals','not_contains'} else (rhs in actual)
    else:
        lhs, rhs = _text(label(field, value)), _text(label(field, expected))
    if op == 'equals': return lhs == rhs
    if op == 'not_equals': return lhs != rhs
    if op == 'contains': return str(rhs) in str(lhs)
    if op == 'not_contains': return str(rhs) not in str(lhs)
    if op == 'gt': return lhs > rhs
    if op == 'gte': return lhs >= rhs
    if op == 'lt': return lhs < rhs
    if op == 'lte': return lhs <= rhs
    if op == 'between':
        upper = decimal_value(rule.get('upper')) if numeric(field) else _text(rule.get('upper', ''))
        return rhs <= lhs <= upper
    if op == 'in':
        choices = rule.get('values', [])
        return any(condition_matches({'operator':'equals','value':v}, value, field, context) for v in choices)
    return False

def normalize_conditions(raw: Any, lookup: dict, *, allow_context=True) -> list[dict]:
    if raw is None: return []
    if not isinstance(raw, list) or len(raw) > MAX_RULES:
        raise FinanceError('قائمة شروط الجدول أو الحساب غير صالحة.')
    out=[]
    for r in raw:
        if not isinstance(r, dict) or r.get('field_id') not in lookup or r.get('operator') not in OPERATORS:
            raise FinanceError('اختر حقلًا وعامل مقارنة صالحين لكل شرط.')
        f=lookup[r['field_id']]
        if isinstance(f, tuple): f=f[1]
        if f.get('type') in {'file','spacer','field_group'}:
            raise FinanceError('لا يمكن استخدام هذا الحقل في شرط مالي.')
        op=r['operator']; n={'field_id':r['field_id'],'operator':op}
        if r.get('value_field_id'):
            # Values in this condition builder are literals. Source/profile matching
            # has separate validated local/remote keys and must not bypass those rules.
            raise FinanceError('حقل المقارنة غير صالح.')
        elif op not in {'empty','not_empty'}:
            if op=='in':
                if not isinstance(r.get('values'),list) or len(r['values'])>50000:
                    raise FinanceError('اختر قيمة واحدة على الأقل للشرط.')
                n['values']=copy.deepcopy(r['values'])
                n['value']=r['values'][0] if r['values'] else ''
            else:
                if blank(r.get('value')): raise FinanceError('قيمة الشرط مطلوبة؛ استخدم شرط الفراغ للقيمة الفارغة.')
                n['value']=copy.deepcopy(r['value'])
            if numeric(f):
                for v in n.get('values',[n.get('value')]):
                    if not blank(v): decimal_value(v)
            if op=='between':
                if blank(r.get('upper')): raise FinanceError('الحد الأعلى للشرط مطلوب.')
                n['upper']=r['upper']
                a,b=(decimal_value(n['value']),decimal_value(n['upper'])) if numeric(f) else (str(n['value']),str(n['upper']))
                if a>b: raise FinanceError('الحد الأدنى يجب ألا يتجاوز الحد الأعلى.')
        out.append(n)
    return out

def _scope_fields(schema: dict, category: dict) -> dict:
    return {fid:pair[1] for fid,pair in fields(schema).items() if pair[0]['kind']=='main' or pair[0]['id']==category['id']} | {k:{'id':k,'type':'text','label':k} for k in SYSTEM}

def normalize(schema: dict, raw: dict | None = None, schemas: dict | None = None, schema_id: str = '') -> dict:
    """Normalize metadata without touching ordinary schemas; remote validation on Save.

    raw is the submitted pre-normalization schema; every app-normalized field/category
    is present in schema. schemas may contain external schemas for strict validation.
    """
    raw=raw or schema; lookup=fields(schema); cats={c['id']:c for c in schema['categories']}
    raw_cats={c['id']:c for c in raw.get('categories',[]) if isinstance(c,dict)}
    raw_fields=fields(raw); graph={fid:[] for fid in lookup}
    def source_schema(sid):
        return schema if not sid or sid==schema_id else (schemas or {}).get(sid)
    def normalize_source(src, count=False):
        if not isinstance(src,dict): raise FinanceError('مصدر الجدول غير صالح.')
        sid=str(src.get('schema_id') or '')
        target=source_schema(sid)
        kind=src.get('scope','current')
        if kind not in {'current','all','match'}: raise FinanceError('نطاق مصدر الجدول غير صالح.')
        result={'id':str(src.get('id') or src.get('category_id') or ''), 'schema_id':sid,
                'category_id':str(src.get('category_id') or ''),'scope':kind,'match':'any' if src.get('match')=='any' else 'all'}
        if not result['id'] or not result['category_id']: raise FinanceError('اختر جدول مصدر.')
        if target:
            c=next((x for x in target['categories'] if x['id']==result['category_id']),None)
            if not c or c['kind']!='repeatable': raise FinanceError('مصدر العرض أو التجميع يجب أن يكون فئة متكررة متاحة.')
            valid=_scope_fields(target,c)
            result['filters']=normalize_conditions(src.get('filters'),valid)
            for name in ['value_field_id','currency_field_id']:
                fid=str(src.get(name) or '')
                if fid and (fid not in valid or (name=='value_field_id' and not count and not numeric(valid[fid]))):
                    raise FinanceError('اختر حقل قيمة عددية وعملة صالحين من المصدر.')
                if fid: result[name]=fid
        else:
            if schemas is not None: raise FinanceError('التصميم المصدر غير متاح.')
            result['filters']=copy.deepcopy(src.get('filters') or [])
            for name in ['value_field_id','currency_field_id']:
                if src.get(name):result[name]=str(src[name])
        if kind=='match':
            local=src.get('local_field_id') or '$record_code'; remote=src.get('remote_field_id') or '$record_code'
            if local not in lookup and local not in SYSTEM: raise FinanceError('حقل المطابقة في السجل الحالي غير موجود.')
            if target and remote not in fields(target) and remote not in SYSTEM:raise FinanceError('حقل المطابقة في التصميم المصدر غير موجود.')
            if target and remote in fields(target) and fields(target)[remote][0]['kind']!='main':raise FinanceError('حقل مطابقة السجل المصدر يجب أن يكون رئيسيًا.')
            result.update(local_field_id=local,remote_field_id=remote)
        return result
    def sources(raw_sources,count=False):
        if not isinstance(raw_sources,list) or not 1<=len(raw_sources)<=MAX_SOURCES: raise FinanceError('اختر مصدر جدول واحدًا على الأقل.')
        result=[normalize_source(s,count=count) for s in raw_sources]
        if len({s['id'] for s in result})!=len(result): raise FinanceError('مصادر الجدول مكررة.')
        return result
    def operand(raw_operand,owner,count=False):
        if not isinstance(raw_operand,dict): raise FinanceError('عنصر الحساب غير صالح.')
        k=raw_operand.get('kind','field')
        if k=='field':
            fid=raw_operand.get('field_id'); available=_scope_fields(schema,owner)
            if fid not in available or available[fid].get('type') in {'spacer','field_group','file'} or (not count and not numeric(available[fid])): raise FinanceError('مصدر الحساب يجب أن يكون رقمًا رئيسيًا أو من البطاقة نفسها.')
            return {'kind':'field','field_id':fid,'filters':normalize_conditions(raw_operand.get('filters'),available),'match':'any' if raw_operand.get('match')=='any' else 'all'}
        if k=='constant':return {'kind':'constant','value':decimal_text(raw_operand.get('value',''))}
        if k=='aggregate':
            operation=raw_operand.get('operation','sum')
            if operation not in AGGREGATES:raise FinanceError('عملية تجميع غير مدعومة.')
            ss=sources(raw_operand.get('sources'),count=operation=='count')
            if operation!='count' and any(not s.get('value_field_id') for s in ss):raise FinanceError('اختر حقل المبلغ لكل مصدر تجميع.')
            if operation=='sumif' and any(len(s['filters'])!=1 for s in ss):raise FinanceError('SUMIF يحتاج شرطًا واحدًا لكل مصدر.')
            if operation=='sumifs' and any(not s['filters'] or s['match']!='all' for s in ss):raise FinanceError('SUMIFS يحتاج شروطًا مرتبطة بتحقق الكل.')
            return {'kind':k,'operation':operation,'sources':ss}
        raise FinanceError('نوع مصدر الحساب غير صالح.')
    for c in schema['categories']:
        rc=raw_cats.get(c['id'],{})
        if rc.get('table') is not None:
            cfg=rc['table']
            if c['kind']!='repeatable' or not isinstance(cfg,dict):raise FinanceError('عرض الجدول متاح للفئات المتكررة فقط.')
            own={f['id']:f for f in c['fields'] if f['type'] not in {'spacer','field_group'}}
            cols=cfg.get('columns',list(own))
            if not isinstance(cols,list) or any(x not in own for x in cols) or len(set(cols))!=len(cols):raise FinanceError('أعمدة الجدول تتضمن حقلًا محذوفًا.')
            row_rules=[]
            if not isinstance(cfg.get('row_rules',[]),list) or len(cfg.get('row_rules',[]))>MAX_RULES:raise FinanceError('قواعد تنسيق الصفوف غير صالحة.')
            for rr in cfg.get('row_rules',[]):
                if not isinstance(rr,dict) or not re.fullmatch(r'#[0-9a-fA-F]{6}',str(rr.get('color',''))):raise FinanceError('اختر لونًا صالحًا لتنسيق الصف.')
                rules=normalize_conditions(rr.get('filters'),_scope_fields(schema,c))
                if not rules:raise FinanceError('أضف شرطًا واحدًا على الأقل لتنسيق الصف.')
                row_rules.append({'color':rr['color'],'filters':rules,'match':'any' if rr.get('match')=='any' else 'all'})
            c['table']={'display':'table' if cfg.get('display')=='table' else 'cards','columns':cols,'row_rules':row_rules}
        if rc.get('view_table') is not None:
            if c['kind']!='main' or c.get('parent_category_id'):raise FinanceError('جدول العرض يجب أن يكون فئة رئيسية مستقلة.')
            if c['fields']:raise FinanceError('جدول العرض يستخدم أعمدة المصدر وحقول الجمع؛ لا يقبل حقول إدخال مستقلة.')
            cfg=rc['view_table']
            if not isinstance(cfg,dict):raise FinanceError('تعريف جدول العرض غير صالح.')
            ss=sources(cfg.get('sources')); sm={s['id']:s for s in ss}
            columns=[]
            for col in cfg.get('columns',[]):
                if not isinstance(col,dict) or not col.get('id') or not str(col.get('label','')).strip():raise FinanceError('اسم عمود العرض مطلوب.')
                mappings=col.get('fields',{})
                if not isinstance(mappings,dict) or not mappings:raise FinanceError('اربط عمود العرض بحقل مصدر واحد على الأقل.')
                types=[]
                for source_id,fid in mappings.items():
                    if source_id not in sm:raise FinanceError('أحد مصادر العمود محذوف.')
                    target=source_schema(sm[source_id]['schema_id'])
                    if target:
                        pair=fields(target).get(fid)
                        if not pair or (pair[0]['kind']!='main' and pair[0]['id']!=sm[source_id]['category_id']):raise FinanceError('حقل عمود العرض غير موجود في المصدر.')
                        if pair[1]['type'] in {'file','spacer','field_group'}:raise FinanceError('اختر حقل قيمة لعمود العرض.')
                        types.append('number' if numeric(pair[1]) else 'text')
                columns.append({'id':str(col['id']),'label':str(col['label']).strip()[:200], 'fields':dict(mappings),'type':('number' if all(t=='number' for t in types) else 'text') if types else ('number' if col.get('type')=='number' else 'text')})
            if not columns or len(columns)>100 or len({x['id'] for x in columns})!=len(columns):raise FinanceError('اختر أعمدة عرض فريدة، بحد أقصى 100 عمود.')
            cl={x['id']:x for x in columns}; totals=[]
            for total in cfg.get('totals',[]):
                if not isinstance(total,dict) or not total.get('label') or total.get('operation','sum') not in AGGREGATES:raise FinanceError('تعريف حقل الجمع غير صالح.')
                op=total.get('operation','sum'); fid=total.get('column_id','')
                if op!='count' and (fid not in cl or cl[fid]['type']!='number'):raise FinanceError('اختر عمودًا عدديًا لحقل الجمع.')
                fs=normalize_conditions(total.get('filters'),cl)
                if op=='sumif' and len(fs)!=1:raise FinanceError('SUMIF يحتاج شرطًا واحدًا.')
                if op=='sumifs' and not fs:raise FinanceError('SUMIFS يحتاج شرطًا واحدًا على الأقل.')
                precision=_precision(total.get('precision',2))
                currency=str(total.get('currency_column_id') or '')
                if currency and currency not in cl:raise FinanceError('عمود العملة غير موجود.')
                totals.append({'id':str(total.get('id') or 'sum'+str(len(totals)+1)), 'label':str(total['label'])[:200], 'operation':op,'column_id':fid,'filters':fs,'precision':precision,'currency_column_id':currency})
            if len(totals)>64:raise FinanceError('عدد حقول الجمع يتجاوز الحد المسموح.')
            c['view_table']={'sources':ss,'columns':columns,'filters':normalize_conditions(cfg.get('filters'),cl),'match':'any' if cfg.get('match')=='any' else 'all','totals':totals}
        for f in c['fields']:
            rf=raw_fields.get(f['id'],({},{}))[1]
            if rf.get('exact_decimal'):
                if not numeric(f):raise FinanceError('الدقة العشرية متاحة للحقول العددية فقط.')
                f['exact_decimal']=True
            cfg=rf.get('financial')
            if cfg is None:continue
            if not isinstance(cfg,dict):raise FinanceError('تعريف الحساب غير صالح.')
            if f.get('composition') or f.get('auto_update') or f.get('related_person_source_field_id'):raise FinanceError('لا تجمع بين مصدر حساب وقاعدة تعبئة أخرى في الحقل نفسه.')
            mode=cfg.get('mode','calculation')
            if mode=='lookup':
                sid=str(cfg.get('schema_id') or ''); target=source_schema(sid)
                remote=str(cfg.get('remote_field_id') or '$record_code'); local=str(cfg.get('local_field_id') or '$record_code'); value_id=str(cfg.get('field_id') or '')
                if local not in _scope_fields(schema,c):raise FinanceError('حقل مطابقة السجل الحالي غير متاح.')
                if f['type'] in {'file','spacer','field_group',*{'system_record_code','system_created_at','system_updated_at'}}:raise FinanceError('نوع حقل النسخ غير مدعوم.')
                if target:
                    tp=fields(target)
                    if value_id not in tp or tp[value_id][0]['kind']!='main' or tp[value_id][1]['type']=='file':raise FinanceError('اختر حقل مصدر رئيسيًا صالحًا.')
                    if remote not in SYSTEM and (remote not in tp or tp[remote][0]['kind']!='main'):raise FinanceError('حقل مطابقة المصدر غير صالح.')
                    if f['type']!=tp[value_id][1]['type'] and f['type'] not in {'text','textarea'}:raise FinanceError('نوع حقل النسخ يجب أن يطابق نوع المصدر.')
                elif schemas is not None: raise FinanceError('التصميم المصدر غير متاح.')
                f['financial']={'mode':mode,'schema_id':sid,'field_id':value_id,'local_field_id':local,'remote_field_id':remote}
            elif mode in {'calculation','budget'}:
                if not numeric(f):raise FinanceError('حقل الحساب أو الرصيد يجب أن يكون عدديًا.')
                raw_operands=cfg.get('operands')
                if not isinstance(raw_operands,list) or not 2<=len(raw_operands)<=64 or (mode=='budget' and len(raw_operands)!=2):raise FinanceError('الحساب يحتاج مصدرين على الأقل؛ الرصيد يحتاج الدخل والمصروف.')
                operation='subtract' if mode=='budget' else cfg.get('operation','sum')
                ops=[operand(o,c,count=operation=='count') for o in raw_operands]
                if operation not in OPERATIONS | {'expression'}:raise FinanceError('عملية الحساب غير مدعومة.')
                f['financial']={'mode':mode,'operation':operation,'operands':ops,'precision':_precision(cfg.get('precision',2))}
                if operation == 'expression':
                    try: f['financial']['expression'] = Expressions.normalize(cfg.get('expression'), len(ops))
                    except Expressions.ExpressionError as exc: raise FinanceError(str(exc)) from exc
                f['exact_decimal']=True
            else:raise FinanceError('نوع الحساب غير صالح.')
    # Local graph spans calculations, conditions, lookups, existing composition and auto-fill.
    for fid,(c,f) in lookup.items():
        deps=list(f.get('composition',{}).get('field_ids',[]))
        if f.get('auto_update',{}):deps.append(f['auto_update'].get('source_field_id'))
        config=f.get('financial',{})
        if config.get('mode')=='lookup':
            if config.get('local_field_id') not in SYSTEM:deps.append(config.get('local_field_id'))
            if not config.get('schema_id') or config.get('schema_id')==schema_id:deps.append(config['field_id'])
        for o in config.get('operands',[]):
            if o['kind']=='field':deps.append(o['field_id']);deps.extend(x['field_id'] for x in o.get('filters',[]))
            for s in o.get('sources',[]):
                if not s.get('schema_id') or s.get('schema_id')==schema_id:
                    deps.extend([s.get('value_field_id'),s.get('currency_field_id')]);deps.extend(x['field_id'] for x in s.get('filters',[]))
        graph[fid]=[d for d in deps if d in lookup]
    done=set(); active=[]
    def visit(fid):
        if fid in done:return
        if fid in active:
            cycle=active[active.index(fid):]
            if any(lookup[x][1].get('financial') for x in cycle):raise FinanceError('يوجد اعتماد دائري بين الحقول المحسوبة أو مصادر النسخ.')
            return
        if len(active)>MAX_DEPTH:raise FinanceError('سلسلة الحساب طويلة جدًا.')
        active.append(fid)
        for dep in graph[fid]:visit(dep)
        active.pop();done.add(fid)
    for fid in lookup:visit(fid)
    return schema

def _precision(value):
    if isinstance(value,bool) or not isinstance(value,int) or not 0<=value<=12:raise FinanceError('المنازل العشرية يجب أن تكون بين 0 و12.')
    return value

class Engine:
    """Read-only request snapshot. resolver(id) -> (schema, saved_records)."""
    def __init__(self,schema:dict,record:dict,schema_id:str='',resolver:Callable|None=None):
        self.schema_id=schema_id;self.schema=schema;self.record=record
        self.resolver=resolver;self.snapshots={};self.memo={};self.stack=[];self.rows_seen=0
        self.current_code=str(record.get('record_code') or '')
    def snapshot(self,sid):
        sid=sid or self.schema_id
        if sid not in self.snapshots:
            if self.resolver:
                sch,records=self.resolver(sid)
                records=copy.deepcopy(list(records))
            elif sid==self.schema_id:sch,records=self.schema,[]
            else:raise FinanceError('التصميم المصدر غير متاح.')
            if sid==self.schema_id:
                sch=self.schema
                records=[r for r in records if str(r.get('record_code') or '')!=self.current_code]
                records.append(self.record)
            self.snapshots[sid]=(sch,records)
        return self.snapshots[sid]
    def value(self,sid,sch,record,category,field,row=None):
        fid=field['id'];k=(sid, str(record.get('_record_id') or record.get('record_code') or id(record)),fid,str((row or {}).get('_child_id') or id(row)))
        if k in self.memo:return self.memo[k]
        if len(self.stack)>=MAX_DEPTH or k in self.stack:raise FinanceError('يوجد اعتماد دائري بين التصاميم أو الحقول المحسوبة.')
        values=record.setdefault('values',{}) if category['kind']=='main' else (row or {}).setdefault('values',{})
        cfg=field.get('financial')
        if not cfg:return values.get(fid,'')
        self.stack.append(k)
        try:
            if cfg['mode']=='lookup':out=self.lookup(sid,sch,record,category,row,cfg,field)
            else:
                values_and_units=[self.operand(sid,sch,record,category,row,o,count=cfg['operation']=='count') for o in cfg['operands']]
                vals=[v for v,u in values_and_units if v is not None]
                units=set().union(*(u for v,u in values_and_units))
                if len(units)>1:raise FinanceError('لا يمكن جمع أو طرح عملات مختلفة؛ أضف شرط العملة.')
                if cfg['operation'] == 'expression':
                    try: result = Expressions.evaluate(cfg['expression'], [v for v,u in values_and_units])
                    except Expressions.ExpressionError as exc: raise FinanceError(str(exc)) from exc
                else: result=combine(vals,cfg['operation'])
                out='' if result is None else decimal_text(result,cfg['precision'])
            self.memo[k]=out;values[fid]=out;return out
        finally:self.stack.pop()
    def field_value(self,sid,sch,record,row,fid):
        if fid in SYSTEM:return record.get(fid[1:],'')
        pair=fields(sch).get(fid)
        if not pair:raise FinanceError('أحد حقول المصدر محذوف؛ عدّل تعريف الحساب.')
        c,f=pair
        return self.value(sid,sch,record,c,f,row)
    def match(self,rules,mode,sid,sch,record,row,context=None):
        if not rules:return True
        lookup=fields(sch); values=[]
        for rule in rules:
            fid=rule['field_id'];f=lookup[fid][1] if fid in lookup else {'type':'text'}
            values.append(condition_matches(rule,self.field_value(sid,sch,record,row,fid),f,context))
        return any(values) if mode=='any' else all(values)
    def source_rows(self,source,owner_sid,owner_schema,owner_record,owner_row=None):
        sid=source.get('schema_id') or owner_sid
        sch,records=self.snapshot(sid)
        if sid==owner_sid:
            sch=owner_schema
            records=[r for r in records if r.get('record_code')!=owner_record.get('record_code')]+[owner_record]
        category=next((c for c in sch['categories'] if c['id']==source['category_id'] and c['kind']=='repeatable'),None)
        if not category:raise FinanceError('أحد جداول المصدر محذوف أو تغير نوعه.')
        scope=source.get('scope','current')
        if scope=='current':records=[r for r in records if r.get('record_code')==owner_record.get('record_code')]
        elif scope=='match':
            lv=self.field_value(owner_sid,owner_schema,owner_record,owner_row,source['local_field_id'])
            if blank(lv):records=[]
            else:records=[r for r in records if _text(self.field_value(sid,sch,r,None,source['remote_field_id']))==_text(lv)]
        context=owner_record.get('values',{})|(owner_row or {}).get('values',{})
        for rec in records:
            if rec.get('archived'):continue
            for row in rec.get('related',{}).get(category['id'],[]):
                self.rows_seen+=1
                if self.rows_seen>MAX_ROWS*64:raise FinanceError('عدد صفوف الحساب كبير؛ ضيّق نطاق المصدر.')
                if self.match(source.get('filters',[]),source.get('match','all'),sid,sch,rec,row,context):
                    yield sid,sch,rec,category,row
    def operand(self,sid,sch,rec,cat,row,operand,count=False):
        kind=operand['kind']
        if kind=='constant':return decimal_value(operand['value']),set()
        if kind=='field':
            if not self.match(operand.get('filters',[]),operand.get('match','all'),sid,sch,rec,row):return None,set()
            value=self.field_value(sid,sch,rec,row,operand['field_id'])
            return (None if blank(value) else Decimal(1) if count else decimal_value(value)),set()
        values=[];units=set();seen=set()
        for source in operand['sources']:
            for ss,sc,r,c,rr in self.source_rows(source,sid,sch,rec,row):
                from schemacraft_transaction_delivery import canonical_value_key
                key=canonical_value_key(ss,r,c,rr,source.get('value_field_id'))
                if key in seen:continue
                seen.add(key)
                value=self.field_value(ss,sc,r,rr,source['value_field_id']) if source.get('value_field_id') else 1
                if blank(value):continue
                values.append(Decimal(1) if operand['operation']=='count' else decimal_value(value))
                currency=source.get('currency_field_id')
                if currency:
                    unit=self.field_value(ss,sc,r,rr,currency)
                    if blank(unit):raise FinanceError('العملة غير محددة لأحد المبالغ المطابقة.')
                    units.add(Presentation.display_value(fields(sc)[currency][1],unit).strip())
        if len(units)>1:raise FinanceError('المصدر يحتوي على أكثر من عملة؛ حدّد العملة في شروط الحساب.')
        operation='sum' if operand['operation'] in {'sumif','sumifs','count'} else operand['operation']
        result=combine(values,operation)
        if result is None and operation=='sum':result=Decimal(0)
        return result,units
    def lookup(self,sid,sch,rec,cat,row,cfg,target_field):
        match_value=self.field_value(sid,sch,rec,row,cfg['local_field_id'])
        if blank(match_value):return ''
        remote=cfg.get('schema_id') or sid; rs,records=self.snapshot(remote)
        matches=[]
        for candidate in records:
            if candidate.get('archived'):continue
            v=self.field_value(remote,rs,candidate,None,cfg['remote_field_id'])
            if _text(v)==_text(match_value):matches.append(candidate)
        if len(matches)>1:raise FinanceError('توجد عدة سجلات مطابقة لمصدر النسخ؛ استخدم معرّفًا فريدًا.')
        if not matches:return ''
        source_pair = fields(rs).get(cfg['field_id'])
        if not source_pair or source_pair[0]['kind']!='main':raise FinanceError('حقل مصدر النسخ غير متاح.')
        source_field=source_pair[1]
        if target_field['type'] not in {'text','textarea'} and target_field['type']!=source_field['type']:
            raise FinanceError('تغير نوع حقل المصدر؛ راجع إعداد النسخ.')
        value=copy.deepcopy(self.field_value(remote,rs,matches[0],None,cfg['field_id']))
        if blank(value):return ''
        if target_field['type'] in {'text','textarea'}:return label(source_field,value)
        if target_field['type'] in {'select','yes_no','checkbox_group'}:
            def mapped(item):
                source_label=_text(label(source_field,item))
                options=[o for o in target_field.get('options',[]) if _text(o.get('label',''))==source_label]
                if len(options)!=1:raise FinanceError('خيار المصدر لا يطابق خيارًا فريدًا في حقل الوجهة.')
                return options[0].get('id') or options[0]['label']
            return [mapped(v) for v in value] if isinstance(value,list) else mapped(value)
        return value
    def recompute(self,strict=True):
        errors=[]
        for c in self.schema['categories']:
            for f in c['fields']:
                if not f.get('financial'):continue
                for row in ([None] if c['kind']=='main' else self.record.get('related',{}).get(c['id'],[])):
                    try:self.value(self.schema_id,self.schema,self.record,c,f,row)
                    except FinanceError as exc:
                        (self.record['values'] if row is None else row.setdefault('values',{}))[f['id']]=''
                        errors.append({'field_id':f['id'],'category_id':c['id'],'child_id':(row or {}).get('_child_id',''),'message':str(exc),'label':f.get('label','')})
                        if strict:raise FinanceError(f"{f.get('label','')}: {exc}") from exc
        return errors
    def view(self,category_id,temporary_filters=None):
        cat=next((c for c in self.schema['categories'] if c['id']==category_id),None)
        if not cat or not cat.get('view_table'):raise FinanceError('جدول العرض غير موجود.')
        cfg=cat['view_table'];cols=cfg['columns'];cl={c['id']:c for c in cols};rows=[];merged={}
        formats={}; source_formats={}; column_formats={}
        # Resolve configured formats even for an empty result. Totals use the
        # first configured mapped source, independent of filter/sort/row order.
        for source in cfg['sources']:
            source_sid=source.get('schema_id') or self.schema_id
            source_schema=self.schema if source_sid==self.schema_id else self.snapshot(source_sid)[0]
            for col in cols:
                fid=col['fields'].get(source['id'])
                if not fid:continue
                pair=fields(source_schema).get(fid)
                if not pair:raise FinanceError('حقل مصدر العرض محذوف؛ راجع ربط الأعمدة.')
                format_key=f'fmt_{len(formats)}'
                formats[format_key]=Presentation.field_format(pair[1])
                source_formats[(source['id'],col['id'])]=format_key
                column_formats.setdefault(col['id'],format_key)
        temporary=normalize_conditions(temporary_filters,cl) if temporary_filters else []
        for source in cfg['sources']:
            for sid,sch,record,category,row in self.source_rows(source,self.schema_id,self.schema,self.record):
                from schemacraft_transaction_delivery import canonical_row_key
                key=canonical_row_key(sid,record,category,row)
                item=merged.setdefault(key,{'values':{c['id']:'' for c in cols},'display':{c['id']:'' for c in cols},'format_keys':{},'mapped':set(),'record_code':record.get('record_code',''),'schema_id':sid,'category_id':category['id'],'child_id':row.get('_child_id','')})
                for col in cols:
                    fid=col['fields'].get(source['id'])
                    if not fid:continue
                    value=self.field_value(sid,sch,record,row,fid)
                    if col['id'] in item['mapped'] and item['values'][col['id']]!=value:
                        raise FinanceError('المصادر المتداخلة تربط العمود بقيم مختلفة في الصف نفسه؛ راجع ربط الأعمدة.')
                    f=fields(sch)[fid][1]
                    if col['id'] not in item['mapped']:
                        item['values'][col['id']]=value
                        item['display'][col['id']]=Presentation.display_value(f,value)
                        item['format_keys'][col['id']]=source_formats[(source['id'],col['id'])]
                        item['mapped'].add(col['id'])
                if len(merged)>MAX_ROWS:raise FinanceError('جدول العرض يتجاوز 50000 صف؛ ضيّق الشروط.')
        for item in merged.values():
            item.pop('mapped',None)
            if not matches_values(cfg.get('filters',[]),cfg.get('match','all'),item['values'],cl):continue
            if not matches_values(temporary,'all',item['values'],cl):continue
            rows.append(item)
        totals=[]
        for total in cfg.get('totals',[]):
            selected=[r for r in rows if matches_values(total.get('filters',[]),'all',r['values'],cl)]
            vals=[];units=set()
            for r in selected:
                v=r['values'].get(total['column_id'])
                if total['operation']=='count':
                    if not total.get('column_id') or not blank(v): vals.append(Decimal(1))
                elif not blank(v):vals.append(decimal_value(v))
                currency=total.get('currency_column_id')
                if currency and (not blank(v) or total['operation']=='count'):
                    unit=r['values'].get(currency)
                    if blank(unit):raise FinanceError('العملة مفقودة في أحد صفوف المجموع.')
                    currency_format=formats.get(r.get('format_keys',{}).get(currency) or column_formats.get(currency),{})
                    units.add(Presentation.display_value(currency_format,unit).strip())
            if len(units)>1:raise FinanceError('لا تجمع عملات مختلفة في حقل جمع واحد؛ أضف شرط العملة.')
            op='sum' if total['operation'] in {'sum','sumif','sumifs','count'} else total['operation']
            result=combine(vals,op)
            if result is None and op=='sum':result=Decimal(0)
            value='' if result is None else decimal_text(result,total['precision'])
            format_key=column_formats.get(total.get('column_id'), '')
            inherited=formats.get(format_key, {'type':'number'})
            totals.append({'id':total['id'],'label':total['label'],'value':value,
                           'display':Presentation.format_number(value,inherited),
                           'format_key':format_key,'currency':next(iter(units),'')})
        return Presentation.wire_value({'category_id':cat['id'],'label':cat['label'],
            'columns':[{'id':c['id'],'label':c['label'],'type':c['type'],'format_key':column_formats.get(c['id'],'')} for c in cols],
            'formats':formats,'rows':rows,'totals':totals,'count':len(rows)})

def matches_values(rules,mode,values,lookup):
    if not rules:return True
    matches=[condition_matches(r,values.get(r['field_id']),lookup[r['field_id']]) for r in rules]
    return any(matches) if mode=='any' else all(matches)

def combine(values:list[Decimal],operation:str) -> Decimal | None:
    if operation=='count':return Decimal(len(values))
    if not values:return None
    with localcontext() as ctx:
        ctx.prec=60
        if operation=='sum':return sum(values,Decimal(0))
        if operation=='average':return sum(values,Decimal(0))/len(values)
        if operation=='min':return min(values)
        if operation=='max':return max(values)
        result=values[0]
        for value in values[1:]:
            if operation=='subtract':result-=value
            elif operation=='multiply':result*=value
            elif operation=='divide':
                if value==0:raise FinanceError('لا يمكن القسمة على صفر.')
                result/=value
            else:raise FinanceError('عملية حساب غير مدعومة.')
        return result

def remap_metadata(obj:Any,field_map:dict,category_map:dict,schema_id:str='') -> Any:
    """Local reusable/portable definitions retain identity mappings, never labels."""
    if isinstance(obj,list):return [remap_metadata(v,field_map,category_map,schema_id) for v in obj]
    if not isinstance(obj,dict):return copy.deepcopy(obj)
    if obj.get('schema_id') and obj.get('schema_id')!=schema_id:
        result=copy.deepcopy(obj)
        if result.get('local_field_id'):result['local_field_id']=field_map.get(result['local_field_id'],result['local_field_id'])
        return result
    out={}
    for key,value in obj.items():
        if key in {'field_id','value_field_id','currency_field_id','local_field_id','remote_field_id'} and isinstance(value,str):out[key]=field_map.get(value,value)
        elif key=='category_id':out[key]=category_map.get(value,value)
        elif key=='columns' and isinstance(value,list) and all(isinstance(x,str) for x in value):out[key]=[field_map.get(x,x) for x in value]
        elif key=='fields' and isinstance(value,dict):out[key]={k:field_map.get(v,v) for k,v in value.items()}
        else:out[key]=remap_metadata(value,field_map,category_map,schema_id)
    return out


def remap_owner(owner:dict,field_map:dict,category_map:dict,schema_id:str='') -> dict:
    for key in ('financial','view_table','table','record_options'):
        if owner.get(key) is not None:owner[key]=remap_metadata(owner[key],field_map,category_map,schema_id)
    if owner.get('option_filter',{}):
        cfg=owner['option_filter']
        if cfg.get('source_field_ids'):cfg['source_field_ids']=[field_map.get(x,x) for x in cfg['source_field_ids']]
    for rule in owner.get('alerts',[]):
        for clause in [rule,*rule.get('conditions',[])]:
            if clause.get('compare_field_id'):clause['compare_field_id']=field_map.get(clause['compare_field_id'],clause['compare_field_id'])
    link_config = owner.get('transaction_linking') or owner.get('profile_linking') or {}
    for source in link_config.get('sources',[]):
        local=not source.get('schema_id') or source['schema_id']==schema_id
        if local and source.get('category_id'): source['category_id']=category_map.get(source['category_id'],source['category_id'])
        for pair in source.get('matches',[]):
            pair['local_field_id']=field_map.get(pair['local_field_id'],pair['local_field_id'])
            if local:pair['remote_field_id']=field_map.get(pair['remote_field_id'],pair['remote_field_id'])
        for pair in source.get('copies',[]):
            pair['target_field_id']=field_map.get(pair['target_field_id'],pair['target_field_id'])
            if local:pair['source_field_id']=field_map.get(pair['source_field_id'],pair['source_field_id'])
        if source.get('destination'):
            d=source['destination']
            if local:d['category_id']=category_map.get(d['category_id'],d['category_id'])
            for pair in d.get('mappings',[]):
                pair['source_field_id']=field_map.get(pair['source_field_id'],pair['source_field_id'])
                if local:pair['target_field_id']=field_map.get(pair['target_field_id'],pair['target_field_id'])
    if link_config.get('incoming_fields') is not None:
        link_config['incoming_fields']=[field_map.get(k,k) for k in link_config['incoming_fields']]
    return owner
