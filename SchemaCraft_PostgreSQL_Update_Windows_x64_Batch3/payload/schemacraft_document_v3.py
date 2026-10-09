"""Document-first reports: typed JSON, explicit contexts and immutable runs.

Only the authenticated report API calls this module. Source workbooks are read-only.
Legacy v1/v2 reports deliberately stay in their original stores.
"""
from __future__ import annotations
import base64
import copy
import io
import json
import math
import os
import re
import statistics
import threading
import uuid
import zipfile
from datetime import datetime, date
from pathlib import Path
from schemacraft_reports import ReportError, LOCK
from schemacraft_formula import describe_calculation

BLOCKS = {'paragraph', 'heading', 'section', 'row', 'divider', 'spacer', 'pagebreak', 'toc', 'image', 'repeat', 'table', 'chart', 'calculation', 'percentage'}
REDUCERS = {'count', 'profile_count', 'nonempty', 'distinct', 'sum', 'average', 'min', 'max', 'median'}
PARAM_TYPES = {'text', 'number', 'date', 'datetime', 'boolean', 'choice', 'multi_choice', 'profile', 'profiles'}
DEFAULTS = {'locale': 'ar', 'direction': 'rtl', 'font_size': 11, 'margin': 18, 'page_size': 'A4', 'orientation': 'portrait', 'max_profiles': 5000, 'max_blocks': 10000}
JOBS = {}

def fail(message):
    raise ReportError(message)

def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail('القيمة ليست رقمًا صالحًا؛ لن يتم تحويل النص إلى رقم تلقائيًا.')
    return value

def is_numeric(field):
    return field['type']=='number' and field.get('number_behavior',{}).get('storage_mode')!='text'

def safe_name(value):
    name = re.sub(r'[\x00-\x1f\\/:*?"<>|]', '_', str(value)).strip(' .')[:120]
    if not name or name.upper().split('.')[0] in {'CON', 'PRN', 'AUX', 'NUL', *('COM'+str(i) for i in range(1,10)), *('LPT'+str(i) for i in range(1,10))}:
        name = 'report'
    return name

def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        os.replace(tmp, path)
    finally:
        if tmp.exists(): tmp.unlink()

def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', value): fail('مرجع غير صالح.')
    return value

class Store:
    def __init__(self, root):
        self.root = Path(root) / 'document-reports'
        self.root.mkdir(parents=True, exist_ok=True)

    def read(self, kind, key):
        path = self.root / kind / (ident(key)+'.json')
        if not path.is_file(): fail('العنصر غير موجود.')
        return json.loads(path.read_text(encoding='utf-8'))

    def list(self, kind):
        return [json.loads(p.read_text(encoding='utf-8')) for p in sorted((self.root/kind).glob('*.json'))]

    def delete(self, kind, key):
        path = self.root / kind / (ident(key)+'.json')
        if not path.is_file(): fail('العنصر غير موجود.')
        path.unlink()

    def write(self, kind, data, key=None, revision=None):
        with LOCK:
            key = ident(key) if key else uuid.uuid4().hex
            path = self.root/kind/(key+'.json')
            old = self.read(kind, key) if path.exists() else None
            if old and revision != old['revision']: fail('تغيرت النسخة في نافذة أخرى. أعد فتحها قبل الحفظ.')
            out = {**copy.deepcopy(data), 'id': key, 'revision': old['revision']+1 if old else 1, 'updated_at': datetime.now().isoformat()}
            save_json(path, out)
            return out

class Engine:
    def __init__(self, template, schema, records=None, parameters=None, display=None):
        self.t = copy.deepcopy(template)
        self.schema = schema
        self.categories = {c['id']: c for c in schema.get('categories', [])}
        self.fields = {f['id']: (c, f) for c in self.categories.values() for f in c.get('fields', [])}
        self.records = records or []
        self.parameters = parameters or {}
        self.display = display or (lambda f, v: '، '.join(map(str, v)) if isinstance(v, list) else str(v))
        self.problems = []
        self.trace = []
        self.emitted = 0

    def problem(self, element, message, severity='error'):
        self.problems.append({'element': element, 'message': message, 'severity': severity})

    def field(self, ref):
        if not isinstance(ref, dict): fail('اختر حقلًا.')
        pair = self.fields.get(ref.get('field'))
        if not pair or pair[0]['id'] != ref.get('category') or ref.get('schema') != self.t.get('schema_id'):
            fail('حُذف مرجع الحقل أو لا ينتمي إلى التصميم والفئة المحددين.')
        if pair[1]['type'] in {'file', 'spacer', 'field_group'}: fail('هذا الحقل ليس قيمة نصية؛ استخدم عنصر صورة آمنًا.')
        return pair

    def check_ref(self, ref, ctx):
        c, f = self.field(ref)
        scope = ref.get('context', 'profile')
        if scope not in {'profile', 'card', 'row', 'group'}: fail('سياق الحقل غير صالح.')
        if scope == 'profile' and not ctx.get('profile'): fail('الحقل يحتاج ملفًا حاليًا. أضفه داخل مكرر ملفات أو استخدم وضع كل ملف.')
        if scope in {'card', 'row', 'group'} and not ctx.get(scope): fail('الحقل خارج سياقه المطلوب: '+scope)
        if c['kind'] != 'main' and ctx.get('category') != c['id']: fail('الحقل يحتاج البطاقة الحالية من فئته المحددة.')
        if c['kind'] != 'main' and scope == 'profile': fail('حقل البطاقة لا يُقرأ كقيمة مفردة من الملف.')
        return f

    def source_context(self, source, ctx):
        kind = source.get('kind', 'profiles')
        if kind in {'current_profile','current_card','current_row','current_group'}:
            required={'current_profile':'profile','current_card':'card','current_row':'row','current_group':'group'}[kind]
            if not ctx.get(required):fail('مصدر الحساب خارج سياقه المطلوب: '+required)
            return {**ctx,'row':True}
        if kind == 'profiles':
            if ctx.get('card'): fail('لا يمكن تداخل مكرر ملفات داخل بطاقة.')
            return {**ctx, 'profile': True, 'row': True, 'category': None, 'card': False}
        if kind not in {'cards', 'current_cards'}: fail('مصدر البيانات غير صالح.')
        c = self.categories.get(source.get('category'))
        if not c or c['kind'] == 'main': fail('اختر فئة بطاقات موجودة.')
        if kind == 'current_cards' and not ctx.get('profile'): fail('هذا المصدر يحتاج الملف الحالي.')
        if ctx.get('card') and c.get('parent_category_id') != ctx.get('category'): fail('لا توجد علاقة فعلية بين فئتي البطاقات المتداخلتين.')
        return {**ctx, 'profile': True, 'card': True, 'row': True, 'category': c['id']}

    def check_filter(self, condition, ctx, depth=0):
        if not condition: return
        if depth > 10: fail('تداخل الشروط يتجاوز الحد الآمن.')
        kind = condition.get('kind')
        if kind in {'all', 'any'}:
            if len(condition.get('items', [])) > 100: fail('عدد الشروط كبير جدًا.')
            for child in condition.get('items', []): self.check_filter(child, ctx, depth+1)
        elif kind == 'exists':
            self.check_filter(condition.get('where'), self.source_context({'kind':'current_cards','category':condition.get('category')}, ctx), depth+1)
        elif kind == 'rule':
            f = self.check_ref(condition.get('ref'), ctx)
            op = condition.get('op')
            allowed = {'eq','ne','empty','not_empty'}
            if f['type'] in {'text','textarea','user_name'} or f['type']=='number' and not is_numeric(f): allowed.add('contains')
            if f['type'] == 'checkbox_group': allowed.add('includes')
            if is_numeric(f) or f['type'] in {'date_gregorian','date_hijri','date_persian'}: allowed.update({'gt','gte','lt','lte'})
            if op not in allowed: fail('المقارنة لا تناسب نوع الحقل.')
            val = condition.get('value')
            if isinstance(val, dict):
                if val.get('parameter') not in {p['id'] for p in self.t.get('parameters',[])}: fail('معامل الشرط غير موجود.')
            elif op not in {'empty','not_empty'}:
                if is_numeric(f): number(val)
                if f['type']=='checkbox' and type(val) is not bool: fail('المقارنة تحتاج قيمة منطقية.')
                if f['type'] in {'select','yes_no','checkbox_group'} and val not in {o['id'] for o in f.get('options',[])}:fail('خيار الشرط محذوف أو غير صالح؛ اختر الهوية الثابتة للخيار.')
        else: fail('شرط غير معروف.')

    def check_calc(self, calc, ctx, stack=()):
        if not isinstance(calc, dict): fail('الحساب غير صالح.')
        kind = calc.get('kind')
        if kind == 'literal': number(calc.get('value'))
        elif kind == 'parameter':
            if not any(p['id']==calc.get('id') and p['type']=='number' for p in self.t.get('parameters',[])): fail('الحساب يحتاج معاملًا رقميًا.')
        elif kind == 'ref':
            key = calc.get('id')
            if key in stack: fail('حلقة اعتماد بين الحسابات.')
            if key not in self.t.get('calculations',{}): fail('الحساب المرجعي غير موجود.')
            self.check_calc(self.t['calculations'][key], ctx, stack+(key,))
        elif kind in {'add','subtract','multiply','ratio','percentage'}:
            self.check_calc(calc.get('left'),ctx,stack); self.check_calc(calc.get('right'),ctx,stack)
        elif kind in {'age','days'}:
            f = self.check_ref(calc.get('ref'),ctx)
            if f['type'] != 'date_gregorian': fail('حساب المدة يحتاج تاريخًا ميلاديًا؛ لا نحول التقاويم ضمنيًا.')
        elif kind == 'aggregate':
            sub = self.source_context(calc.get('source',{}),ctx)
            self.check_filter(calc.get('filter'),sub)
            if calc.get('op') not in REDUCERS: fail('دالة الحساب غير صالحة.')
            if calc.get('op') not in {'count','profile_count'}:
                f = self.check_ref(calc.get('ref'),sub)
                if calc.get('op') in {'sum','average','min','max','median'} and not is_numeric(f): fail('هذا الحساب يحتاج حقلًا رقميًا؛ الأرقام المحفوظة كنص ليست قياسات.')
        else: fail('نوع الحساب غير مدعوم.')

    def validate(self):
        t = self.t
        if not isinstance(t,dict) or t.get('format') != 'schemacraft-document' or t.get('version') != 3: fail('صيغة المستند غير صالحة.')
        if t.get('locale', 'ar') not in {'ar', 'fa'}: fail('لغة شرح الحساب غير صالحة.')
        if t.get('mode') not in {'collection','per_profile'}: fail('اختر وضع التقرير.')
        if not isinstance(t.get('title'),str) or not t['title'].strip() or len(t['title'])>160: fail('اسم التقرير غير صالح.')
        if len(json.dumps(t,ensure_ascii=False))>2000000: fail('المستند يتجاوز الحد الآمن.')
        params=t.get('parameters',[])
        if len({p.get('id') for p in params})!=len(params): fail('معامل مكرر.')
        for p in params:
            ident(p.get('id'))
            if p.get('type') not in PARAM_TYPES: fail('نوع معامل غير صالح.')
        page=t.get('page',{})
        for name,low,high in [('margin',12,30),('font_size',9,16)]:
            if not low<=number(page.get(name,DEFAULTS[name]))<=high:fail('إعداد الصفحة خارج النطاق الآمن: '+name)
        if page.get('size',DEFAULTS['page_size']) not in {'A4','A3','Letter','Legal'}:fail('حجم الصفحة غير مدعوم.')
        if page.get('orientation',DEFAULTS['orientation']) not in {'portrait','landscape'}:fail('اتجاه الصفحة غير صالح.')
        if page.get('first_header_mode','same') not in {'same','different','none'}:fail('إعداد رأس الصفحة الأولى غير صالح.')
        if page.get('first_footer_mode','same') not in {'same','different','none'}:fail('إعداد تذييل الصفحة الأولى غير صالح.')
        ids=set()
        root={'profile':t['mode']=='per_profile'}
        def walk(blocks, ctx, depth=0):
            if depth>12: fail('تداخل المستند كبير جدًا.')
            for b in blocks:
                bid=b.get('id','document')
                try:
                    ident(bid)
                    if bid in ids: fail('هوية عنصر مكررة.')
                    ids.add(bid)
                    if len(ids)>500: fail('الحد 500 عنصر في القالب.')
                    kind=b.get('type')
                    if kind not in BLOCKS: fail('عنصر غير مدعوم.')
                    if kind in {'heading','section'} and b.get('level',1) not in {1,2,3}:fail('مستوى العنوان غير صالح.')
                    if 'show_description' in b and type(b['show_description']) is not bool: fail('خيار إظهار شرح الحساب يجب أن يكون منطقيًا.')
                    self.check_filter(b.get('when'),ctx)
                    for token in b.get('content',[]):
                        if 'show_description' in token and type(token['show_description']) is not bool: fail('خيار إظهار شرح الحساب يجب أن يكون منطقيًا.')
                        if token.get('decimals') is not None and (type(token['decimals']) is not int or not 0<=token['decimals']<=8):fail('الدقة الرقمية بين 0 و8.')
                        tk=token.get('type')
                        if tk=='field': self.check_ref(token.get('ref'),ctx)
                        elif tk=='parameter':
                            if token.get('id') not in {p['id'] for p in params}: fail('المعامل غير موجود.')
                        elif tk=='calculation': self.check_calc(token.get('calculation'),ctx)
                        elif tk=='join':
                            sub=self.source_context(token.get('source',{}),ctx);self.check_ref(token.get('ref'),sub);self.check_filter(token.get('filter'),sub)
                        elif tk=='system':
                            if token.get('name') not in {'date','index','total','first','last','profile_id','current_page','total_pages'}: fail('قيمة نظام غير معروفة.')
                            if token.get('name')=='profile_id' and not ctx.get('profile'): fail('لا يوجد ملف حالي.')
                            if token.get('name') in {'index','total','first','last'} and not ctx.get('row'): fail('قيمة التكرار خارج المكرر.')
                            if token.get('name') in {'current_page','total_pages'} and not ctx.get('page_chrome'): fail('رقم الصفحة يُستخدم داخل رأس أو تذييل الصفحة فقط.')
                        elif tk!='text' or not isinstance(token.get('text'),str): fail('عنصر نص غير صالح.')
                    if kind in {'repeat','table','chart'}:
                        sub=self.source_context(b.get('source',{}),ctx);self.check_filter(b.get('filter'),sub)
                        for sort in b.get('sort',[]): self.check_ref(sort['ref'],sub)
                        if b.get('limit') is not None and (type(b['limit']) is not int or not 1<=b['limit']<=5000): fail('حد الصفوف غير صالح.')
                        if kind=='repeat': walk(b.get('children',[]),sub,depth+1)
                        if kind=='table':
                            cols=b.get('columns',[])
                            if b.get('group_by'):sub={**sub,'group':True}
                            if not 1<=len(cols)<=12: fail('اختر من عمود إلى 12 عمودًا.')
                            if len(cols)>6: self.problem(bid,'قد يكون الجدول أعرض من المساحة القابلة للطباعة. قلّل الأعمدة.','warning')
                            for col in cols:
                                if 'show_description' in col and type(col['show_description']) is not bool: fail('خيار إظهار شرح الحساب يجب أن يكون منطقيًا.')
                                if col.get('ref'): self.check_ref(col['ref'],sub)
                                elif col.get('calculation'): self.check_calc(col['calculation'],sub)
                                elif not col.get('row_number'): fail('عمود غير مكتمل.')
                                if col.get('total') and col.get('total') not in REDUCERS: fail('دالة إجمالي غير صالحة.')
                                if col.get('total') in {'sum','average','min','max','median'} and (not col.get('ref') or not is_numeric(self.field(col['ref'])[1])):fail('الإجمالي الرقمي يحتاج حقلًا رقميًا.')
                                if not 0<number(col.get('width',1))<=20:fail('عرض العمود غير صالح.')
                            if b.get('group_by'):self.check_ref(b['group_by'],sub)
                        if kind=='chart':
                            self.check_ref(b.get('category'),sub)
                            measure=b.get('measure',{})
                            self.check_calc({'kind':'aggregate','source':b.get('source',{}),**measure},ctx)
                            if b.get('chart','bar') not in {'bar','horizontal','line','pie','donut','stacked','stacked100'}: fail('نوع الرسم غير مدعوم.')
                            if b.get('series'):self.check_ref(b['series'],sub)
                            if b.get('date_group') and self.field(b['category'])[1]['type']!='date_gregorian':fail('التجميع الزمني يحتاج تاريخًا ميلاديًا؛ لا نحول التقاويم ضمنيًا.')
                            if b.get('top_n') is not None and (type(b['top_n']) is not int or not 1<=b['top_n']<=60):fail('Top N يجب أن يكون بين 1 و60.')
                    if kind in {'calculation','percentage'}: self.check_calc(b.get('calculation'),ctx)
                    if kind=='section': walk(b.get('children',[]),ctx,depth+1)
                    if kind=='row':
                        if not 2<=len(b.get('cells',[]))<=6: fail('صف التخطيط يحتاج خليتين إلى ست خلايا.')
                        for cell in b['cells']:
                            if not 0<number(cell.get('weight',1))<=12: fail('نسبة الخلية غير صالحة.')
                            walk(cell.get('children',[]),ctx,depth+1)
                    if kind=='image':
                        raw=b.get('data','')
                        if not re.fullmatch(r'data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+',raw): fail('أدخل صورة PNG/JPEG محلية؛ الروابط البعيدة غير مسموحة.')
                        try:
                            decoded=base64.b64decode(raw.split(',',1)[1],validate=True)
                            if len(decoded)>1_500_000:fail('الصورة تتجاوز الحد الآمن 1.5 ميغابايت.')
                            from PIL import Image as PILImage
                            with PILImage.open(io.BytesIO(decoded)) as im:
                                if im.format not in {'PNG','JPEG'}:fail('صيغة الصورة الفعلية يجب أن تكون PNG أو JPEG.')
                                if im.width*im.height>16_000_000:fail('الصورة كبيرة جدًا.')
                                im.verify()
                        except ReportError:raise
                        except Exception:fail('ملف الصورة غير صالح أو تالف. اختر PNG/JPEG صالحًا.')
                except (ReportError,KeyError,TypeError,ValueError) as exc: self.problem(bid,str(exc))
        walk(t.get('blocks',[]),root)
        def check_chrome(nodes):
            for n in nodes:
                if n.get('type') not in {'paragraph','image','row','divider','spacer'}:self.problem(n.get('id','document'),'الرأس والتذييل يدعمان النص والصور وصفوف التخطيط فقط.')
                for c in n.get('cells',[]):check_chrome(c.get('children',[]))
        for chrome_nodes in [t.get('header',[]),t.get('footer',[]),t.get('first_header',[]),t.get('first_footer',[])]:check_chrome(chrome_nodes)
        chrome_root={**root,'page_chrome':True}
        for chrome_nodes in [t.get('header',[]),t.get('footer',[]),t.get('first_header',[]),t.get('first_footer',[])]:walk(chrome_nodes,chrome_root)
        for key,calc in t.get('calculations',{}).items():
            try:self.check_calc(calc,root,(key,))
            except ReportError as exc:self.problem('calculation:'+key,str(exc))
        return self.problems

    def parameter_values(self):
        result={}
        for p in self.t.get('parameters',[]):
            v=self.parameters.get(p['id'],p.get('default'))
            if v is None or v=='':
                if p.get('required'): fail('المعامل مطلوب: '+p.get('label',p['id']))
                result[p['id']]='';continue
            typ=p['type']
            if typ=='number':
                number(v)
                if p.get('min') is not None and v<p['min'] or p.get('max') is not None and v>p['max']:fail('المعامل خارج النطاق: '+p['id'])
            elif typ=='boolean':
                if type(v) is not bool:fail('المعامل يحتاج قيمة منطقية.')
            elif typ in {'multi_choice','profiles'}:
                if not isinstance(v,list) or any(not isinstance(x,str) for x in v):fail('المعامل يحتاج قائمة.')
                if typ=='multi_choice' and any(x not in p.get('choices',[]) for x in v):fail('اختيار غير صالح.')
            elif not isinstance(v,str):fail('المعامل يحتاج نصًا.')
            if typ=='choice' and v not in p.get('choices',[]):fail('اختيار غير صالح.')
            if typ in {'date','datetime'}:
                try:(date.fromisoformat if typ=='date' else datetime.fromisoformat)(v)
                except ValueError:fail('تاريخ المعامل غير صالح.')
            result[p['id']]=v
        self.parameters=result

    def value(self, ref, ctx):
        c,f=self.field(ref)
        profile=ctx.get('profile')
        if not profile:fail('لا يوجد ملف حالي.')
        if c['kind']=='main':
            system={'system_record_code':profile['id'],'system_created_at':profile.get('created_at',''),'system_updated_at':profile.get('updated_at','')}
            return system.get(f['type'],profile.get('values',{}).get(f['id']))
        card=ctx.get('card')
        if not card or ctx.get('category')!=c['id']:fail('لا توجد بطاقة حالية من الفئة المطلوبة.')
        return card.get('values',{}).get(f['id'])

    def matches(self, condition, ctx):
        if not condition:return True
        kind=condition['kind']
        if kind in {'all','any'}:return (all if kind=='all' else any)(self.matches(c,ctx) for c in condition.get('items',[]))
        if kind=='exists':return any(self.matches(condition.get('where'),r) for r in self.rows({'kind':'current_cards','category':condition['category']},ctx))
        a=self.value(condition['ref'],ctx);b=condition.get('value');op=condition['op']
        if isinstance(b,dict):b=self.parameters.get(b['parameter'])
        empty=a is None or a=='' or a==[]
        if op=='empty':return empty
        if op=='not_empty':return not empty
        if empty:return False
        f=self.field(condition['ref'])[1]
        if is_numeric(f):number(a);number(b)
        if f['type'] in {'select','yes_no','checkbox_group'}:
            def option_id(v):
                option=next((o for o in f.get('options',[]) if v in {o['id'],o['label']}),None)
                if not option:fail('قيمة مصدر لا تطابق خيارًا موجودًا.')
                return option['id']
            a=[option_id(v) for v in a] if f['type']=='checkbox_group' else option_id(a)
        if op=='eq':return a==b
        if op=='ne':return a!=b
        if op=='contains':return str(b).casefold() in str(a).casefold()
        if op=='includes':return b in a
        if f['type'].startswith('date_'):
            def date_key(v):
                parts=re.split(r'[-/]',str(v))
                if len(parts)!=3 or not all(x.isdigit() for x in parts):fail('قيمة تاريخ غير صالحة.')
                return tuple(map(int,parts))
            a,b=date_key(a),date_key(b)
        return {'gt':lambda:a>b,'gte':lambda:a>=b,'lt':lambda:a<b,'lte':lambda:a<=b}[op]()

    def rows(self, source, ctx, owner=None):
        source=source or {};owner=owner or {};kind=source.get('kind','profiles');out=[]
        profiles=[ctx['profile']] if kind=='current_cards' else self.records
        if kind=='current_group':out=list(ctx.get('group',[]))
        elif kind in {'current_profile','current_card','current_row'}:out=[ctx]
        elif kind=='profiles':out=[{**ctx,'profile':p,'card':None,'category':None,'row':True} for p in profiles]
        else:
            for p in profiles:
                for card in p.get('related',{}).get(source['category'],[]):
                    if ctx.get('card') and str(card.get('parent_child_id',''))!=str(ctx['card'].get('_child_id','')):continue
                    out.append({**ctx,'profile':p,'card':card,'category':source['category'],'row':True})
        out=[r for r in out if self.matches(owner.get('filter'),r)]
        for sort in reversed(owner.get('sort',[])):
            def sortkey(r):
                v=self.value(sort['ref'],r)
                if v is None or v=='':return (0,'')
                if is_numeric(self.field(sort['ref'])[1]):return (1,number(v))
                return (1,str(v))
            out.sort(key=sortkey,reverse=sort.get('direction')=='desc')
        if owner.get('limit') and len(out)>owner['limit']:
            self.trace.append({'element':owner.get('id'),'matched':len(out),'included':owner['limit'],'note':'حد صريح اختاره المستخدم'})
            out=out[:owner['limit']]
        return [{**r,'index':i+1,'total':len(out),'first':i==0,'last':i==len(out)-1} for i,r in enumerate(out)]

    def reduce(self, op, values, rows):
        clean=[v for v in values if v is not None and v!='' and v!=[]]
        if op=='count':return len(rows)
        if op=='profile_count':return len({r['profile']['id'] for r in rows})
        if op=='nonempty':return len(clean)
        if op=='distinct':return len({json.dumps(v,sort_keys=True) for v in clean})
        nums=[number(v) for v in clean]
        if not nums:return 0 if op=='sum' else None
        return {'sum':sum,'average':statistics.mean,'min':min,'max':max,'median':statistics.median}[op](nums)

    def calc(self, calc, ctx):
        kind=calc['kind']
        if kind=='literal':return number(calc['value'])
        if kind=='parameter':return number(self.parameters[calc['id']])
        if kind=='ref':return self.calc(self.t['calculations'][calc['id']],ctx)
        if kind in {'age','days'}:
            try:start=date.fromisoformat(str(self.value(calc['ref'],ctx)));end=date.fromisoformat(calc.get('end') or date.today().isoformat())
            except ValueError:fail('تاريخ غير صالح لحساب المدة.')
            return end.year-start.year-((end.month,end.day)<(start.month,start.day)) if kind=='age' else (end-start).days
        if kind=='aggregate':
            rows=self.rows(calc.get('source'),ctx,calc);values=[self.value(calc['ref'],r) for r in rows] if calc.get('ref') else []
            value=self.reduce(calc['op'],values,rows)
            self.trace.append({'calculation':copy.deepcopy(calc),'matched_rows':len(rows),'profiles':sorted({r['profile']['id'] for r in rows}),'value':value})
            return value
        a,b=self.calc(calc['left'],ctx),self.calc(calc['right'],ctx)
        if a is None or b is None:return None
        if kind in {'ratio','percentage'} and b==0:
            self.trace.append({'warning':'المقام صفر؛ النتيجة غير معرّفة.'});return None
        value={'add':lambda:a+b,'subtract':lambda:a-b,'multiply':lambda:a*b,'ratio':lambda:a/b,'percentage':lambda:a/b*100}[kind]()
        return number(value)

    def text(self, content, ctx):
        result=[]
        for token in content:
            kind=token['type'];v=''
            if kind=='text':v=token['text']
            elif kind=='parameter':v=self.parameters.get(token['id'],'')
            elif kind=='calculation':v=self.calc(token['calculation'],ctx)
            elif kind=='system':
                name=token['name']
                if name=='date':v=date.today().isoformat()
                elif name=='profile_id':v=ctx.get('profile',{}).get('id','')
                elif name=='current_page':v='[[SC_PAGE]]'
                elif name=='total_pages':v='[[SC_TOTAL_PAGES]]'
                else:v=ctx.get(name,'')
            elif kind=='join':v=token.get('separator','، ').join(self.formatted(self.value(token['ref'],r),token,token['ref']) for r in self.rows(token.get('source'),ctx,token))
            elif kind=='field':v=self.value(token['ref'],ctx)
            text = self.formatted(v,token,token.get('ref'))+(str(token.get('suffix','')) if kind=='calculation' and v is not None else '')
            if kind == 'calculation' and token.get('show_description') is True:
                text = describe_calculation(token['calculation'], self.schema, self.t, self.t.get('locale', 'ar')) + ' = ' + text
            result.append(text)
        return ''.join(result)

    def formatted(self, value, token, ref=None):
        if value is None or value=='' or value==[]:
            if token.get('required'):fail('قيمة مطلوبة مفقودة: '+(self.field(ref)[1]['label'] if ref else token.get('id','')))
            return token.get('empty','—')
        if token.get('decimals') is not None:return f"{number(value):.{max(0,min(8,int(token['decimals'])))}f}"
        if ref:return self.display(self.field(ref)[1],value)
        if isinstance(value,list):return '، '.join(map(str,value))
        return str(value)

    def render(self, profile=None):
        self.parameter_values()
        def blocks(items,ctx):
            out=[]
            for b in items:
                self.emitted+=1
                if self.emitted>10000:fail('تجاوز التقرير 10000 عنصر. ضيّق التحديد؛ لم يتم اقتطاع النتائج.')
                if not self.matches(b.get('when'),ctx):continue
                kind=b['type'];n={**copy.deepcopy(b),'text':self.text(b.get('content',[]),ctx)}
                if kind=='repeat':
                    rows=self.rows(b.get('source'),ctx,b)
                    if not rows:out.append({'type':'paragraph','text':b.get('empty','لا توجد بيانات.')})
                    for i,row in enumerate(rows):
                        if i and b.get('page_each'):out.append({'type':'pagebreak'})
                        out.extend(blocks(b.get('children',[]),row))
                    continue
                if kind=='section':n['children']=blocks(b.get('children',[]),ctx)
                if kind=='row':n['cells']=[{**c,'children':blocks(c.get('children',[]),ctx)} for c in b['cells']]
                if kind=='table':
                    rows=self.rows(b.get('source'),ctx,b);n['rows']=[]
                    for col in n['columns']:
                        if col.get('calculation') and col.get('show_description') is True:
                            description = describe_calculation(col['calculation'], self.schema, self.t, self.t.get('locale', 'ar'))
                            col['label'] = (col.get('label', '') + '\n' + description).strip()
                    for row in ([] if b.get('group_by') else rows):n['rows'].append([self.formatted(self.value(c['ref'],row),c,c['ref']) if c.get('ref') else self.formatted(self.calc(c['calculation'],row),c) if c.get('calculation') else str(row['index']) for c in b['columns']])
                    if any(c.get('total') for c in b['columns']):n['rows'].append([self.formatted(self.reduce(c['total'],[self.value(c['ref'],r) for r in rows] if c.get('ref') else [],rows),c) if c.get('total') else '' for c in b['columns']])
                    if b.get('group_by'):
                        groups={}
                        for row in rows:groups.setdefault(self.formatted(self.value(b['group_by'],row),{},b['group_by']),[]).append(row)
                        n['rows']=[]
                        for title,group in groups.items():
                            n['rows'].append([title]+['']*(len(b['columns'])-1))
                            for row in group:n['rows'].append([self.formatted(self.value(c['ref'],row),c,c['ref']) if c.get('ref') else self.formatted(self.calc(c['calculation'],{**row,'group':group}),c) if c.get('calculation') else str(row['index']) for c in b['columns']])
                            n['rows'].append([self.formatted(self.reduce(c['total'],[self.value(c['ref'],r) for r in group] if c.get('ref') else [],group),c) if c.get('total') else 'المجموع الفرعي' if i==0 else '' for i,c in enumerate(b['columns'])])
                    self.trace.append({'element':b['id'],'rows':len(rows),'profiles':sorted({r['profile']['id'] for r in rows})})
                if kind=='chart':
                    rows=self.rows(b.get('source'),ctx,b);groups={}
                    for r in rows:
                        val=self.value(b['category'],r);label=self.formatted(val,{},b['category'])
                        if b.get('date_group') and val:
                            d=date.fromisoformat(str(val));unit=b['date_group'];label=str(d.year) if unit=='year' else f'{d.year}-Q{(d.month-1)//3+1}' if unit=='quarter' else f'{d.year}-{d.month:02}' if unit=='month' else f'{d.isocalendar().year}-W{d.isocalendar().week:02}' if unit=='week' else d.isoformat()
                        groups.setdefault(label,[]).append(r)
                    measure=b['measure']
                    def reduce_group(rr):return self.reduce(measure['op'],[self.value(measure['ref'],r) for r in rr] if measure.get('ref') else [],rr)
                    n['data']=[{'label':label,'value':reduce_group(rr)} for label,rr in groups.items()]
                    if b.get('top_n') and len(n['data'])>b['top_n']:
                        n['data'].sort(key=lambda x:x['value'] or 0,reverse=True)
                        retained=n['data'][:b['top_n']];other=[r for entry in n['data'][b['top_n']:] for r in groups[entry['label']]]
                        if b.get('other',True):retained.append({'label':'أخرى','value':reduce_group(other)});groups['أخرى']=other
                        else:self.trace.append({'element':b['id'],'omitted_categories':len(n['data'])-b['top_n'],'note':'Top N صريح بدون أخرى'})
                        n['data']=retained
                    if b.get('series'):
                        series=sorted({self.formatted(self.value(b['series'],r),{},b['series']) for r in rows})
                        if len(series)>12:fail('الرسم يتجاوز 12 سلسلة؛ ضيّق المرشح.')
                        n['series']=[{'label':label,'values':[reduce_group([r for r in groups[item['label']] if self.formatted(self.value(b['series'],r),{},b['series'])==label]) or 0 for item in n['data']]} for label in series]
                        if b.get('chart')=='stacked100':
                            for i in range(len(n['data'])):
                                total=sum(s['values'][i] for s in n['series'])
                                if any(s['values'][i]<0 for s in n['series']):fail('الرسم النسبي المكدس لا يدعم القيم السالبة.')
                                for s in n['series']:s['values'][i]=s['values'][i]/total*100 if total else 0
                    if len(n['data'])>60:fail('الرسم يتجاوز 60 فئة. ضيّق المرشح؛ لم يتم حذف فئات.')
                if kind in {'calculation','percentage'}:
                    n['value']=self.calc(b['calculation'],ctx)
                    if b.get('show_description') is True:
                        n['calculation_description'] = describe_calculation(b['calculation'], self.schema, self.t, self.t.get('locale', 'ar'))
                out.append(n)
            return out
        ctx={'profile':profile} if profile else {}
        chrome_ctx={**ctx,'page_chrome':True}
        return {'title':self.t['title'],'blocks':blocks(self.t.get('blocks',[]),ctx),'header':blocks(self.t.get('header',[]),chrome_ctx),'footer':blocks(self.t.get('footer',[]),chrome_ctx),'first_header':blocks(self.t.get('first_header',[]),chrome_ctx),'first_footer':blocks(self.t.get('first_footer',[]),chrome_ctx),'page':self.t.get('page',{}),'trace':self.trace}

def pdf_bytes(document, font_path, _total=None):
    """Render structured nodes directly, without Markdown or HTML interpretation."""
    try:
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, HRFlowable
        from reportlab.platypus.tableofcontents import TableOfContents
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, A3, LETTER, LEGAL, landscape
        from reportlab.platypus.doctemplate import LayoutError
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.graphics.shapes import Drawing, Rect, String
        from reportlab.graphics.charts.barcharts import VerticalBarChart, HorizontalBarChart
        from reportlab.graphics.charts.linecharts import HorizontalLineChart
        from reportlab.graphics.charts.piecharts import Pie
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith('reportlab'):
            fail('مكوّن إنشاء PDF غير مثبت (ReportLab). على Linux شغّل: python -m pip install -r requirements.txt ثم أعد تشغيل التطبيق.')
        raise
    from schemacraft_advanced import _pdf_text, _pdf_visual_line
    from xml.sax.saxutils import escape
    font='SchemaCraftDocument'
    with LOCK:
        if font not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(font,str(font_path)))
        for suffix,filename in [('Bold','DejaVuSans-Bold.ttf'),('Italic','DejaVuSans-Oblique.ttf'),('BoldItalic','DejaVuSans-BoldOblique.ttf')]:
            path=Path(font_path).with_name(filename)
            if font+suffix not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(font+suffix,str(path if path.exists() else font_path)))
    page=document.get('page',{})
    sizes={'A4':A4,'A3':A3,'Letter':LETTER,'Legal':LEGAL}
    size=sizes.get(page.get('size','A4'),A4)
    if page.get('orientation','portrait')=='landscape':size=landscape(size)
    margin=max(12,min(30,float(page.get('margin',18))))*72/25.4;width=size[0]-2*margin
    def para(text,level=0,available=width,align='right',bold=False,italic=False):
        fs=(22,17,14)[max(0,min(2,level-1))] if level else max(9,min(16,float(page.get('font_size',11))))
        face=font+('BoldItalic' if bold and italic else 'Bold' if bold or level else 'Italic' if italic else '')
        sty=ParagraphStyle('document',fontName=face,fontSize=fs,leading=fs*1.65,alignment={'right':2,'center':1,'left':0}.get(align,2),spaceAfter=8,keepWithNext=bool(level))
        return Paragraph(_pdf_text(str(text),max_width=available,measure=lambda s:pdfmetrics.stringWidth(s,face,fs)),sty)
    class Contents(TableOfContents):
        def wrap(self,w,h):
            rows=[[para(str(page),available=35),Paragraph(('<a href="#'+key+'">'+title+'</a>') if key else title,ParagraphStyle('toc',fontName=font,fontSize=11,leading=18,alignment=2))] for level,title,page,key in (self._lastEntries or [(0,'المحتويات',0,None)])]
            self._table=Table(rows,colWidths=[40,w-40]);self.width,self.height=self._table.wrapOn(self.canv,w,h);return self.width,self.height
    def flow(nodes,w=width,chrome=False):
        result=[]
        for n in nodes:
            kind=n['type'];text=n.get('text','')
            if kind in {'paragraph','heading','section'}:
                if n.get('new_page'):result.append(PageBreak())
                p=para(text,int(n.get('level',1)) if kind!='paragraph' else 0,w,n.get('align','right'),n.get('bold',False),n.get('italic',False))
                if kind!='paragraph' and n.get('toc',True):p.report_heading=(max(0,min(2,int(n.get('level',1))-1)),text)
                result.append(p)
                if kind=='section':result.extend(flow(n.get('children',[]),w,chrome))
            elif kind=='toc':result.extend([para('المحتويات',1),Contents()])
            elif kind=='pagebreak':result.append(PageBreak())
            elif kind=='divider':result.append(HRFlowable(width=w,color=colors.HexColor('#aab5c4')))
            elif kind=='spacer':result.append(Spacer(1,max(1,min(200,float(n.get('height',18))))))
            elif kind=='row':
                weights=[c.get('weight',1) for c in n['cells']];widths=[w*x/sum(weights) for x in weights]
                cells=[flow(c['children'],cw-12,chrome) for c,cw in zip(n['cells'],widths)]
                t=Table([list(reversed(cells))],colWidths=list(reversed(widths)),splitByRow=1,splitInRow=1);t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP')]))
                result.append(t)
            elif kind=='image':
                data=base64.b64decode(n['data'].split(',',1)[1],validate=True)
                from PIL import Image as PILImage
                with PILImage.open(io.BytesIO(data)) as im:
                    if im.width*im.height>16000000:fail('الصورة كبيرة جدًا.')
                    iw=min(w,max(20,float(n.get('width',150))));ih=iw*im.height/im.width
                if ih>500:fail('الصورة أطول من الصفحة. قلّل عرضها.')
                result.append(Image(io.BytesIO(data),width=iw,height=ih,hAlign='RIGHT'))
            elif kind=='table':
                cols=n['columns'];weights=[max(1,float(c.get('width',1))) for c in cols];widths=[w*x/sum(weights) for x in weights]
                rows=[[c.get('label','') for c in cols]]+n.get('rows',[])
                if len(rows)==1:result.append(para(n.get('empty','لا توجد بيانات.'),available=w));continue
                t=Table([list(reversed([para(v,available=cw-12) for v,cw in zip(row,widths)])) for row in rows],colWidths=list(reversed(widths)),repeatRows=1,splitInRow=1)
                t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e9f0f8')),('GRID',(0,0),(-1,-1),.3,colors.HexColor('#c8d3e0')),('VALIGN',(0,0),(-1,-1),'TOP')]))
                if text:result.append(para(text,available=w))
                result.append(t)
            elif kind in {'calculation','percentage'}:
                if n.get('calculation_description'): result.append(para(n['calculation_description'], available=w))
                value=n.get('value');result.append(para(text+' '+('—' if value is None else format(value,'.6g')),available=w))
                if kind=='percentage' and value is not None:
                    d=Drawing(w,22);d.add(Rect(0,2,w,14,fillColor=colors.HexColor('#e7edf4'),strokeColor=None));filled=w*max(0,min(100,value))/100;d.add(Rect(w-filled,2,filled,14,fillColor=colors.HexColor('#2875bd'),strokeColor=None));result.append(d)
            elif kind=='chart':
                if text:result.append(para(text,available=w))
                data=n.get('data',[])
                if not data:result.append(para('لا توجد بيانات.'));continue
                values=[x['value'] or 0 for x in data];typ=n.get('chart','bar');d=Drawing(w,220)
                chart=Pie() if typ in {'pie','donut'} else HorizontalBarChart() if typ=='horizontal' else HorizontalLineChart() if typ=='line' else VerticalBarChart()
                chart.x=45;chart.y=35;chart.width=w-65;chart.height=170
                if typ in {'pie','donut'}:
                    if any(v<0 for v in values):fail('الرسم الدائري لا يدعم القيم السالبة.')
                    chart.data=values;chart.labels=[str(i+1) for i in range(len(data))]
                    if typ=='donut':chart.innerRadiusFraction=.55
                else:
                    chart.data=[s['values'] for s in n.get('series',[])] or [values];chart.categoryAxis.categoryNames=[str(i+1) for i in range(len(data))];chart.valueAxis.valueMin=min(0,min(values));chart.valueAxis.valueMax=max(1,max(values))
                    if typ in {'stacked','stacked100'}:
                        chart.categoryAxis.style='stacked';chart.valueAxis.valueMax=100 if typ=='stacked100' else max(1,max(sum(s[i] for s in chart.data) for i in range(len(data))))
                d.add(chart);result.append(d)
                for i,item in enumerate(data):result.append(para(f"{i+1}. {item['label']} — {item['value'] if item['value'] is not None else '—'}",available=w))
                for series in n.get('series',[]):result.append(para(series['label']+' : '+' / '.join(format(v,'.6g') for v in series['values']),available=w))
        return result
    def page_tokens(nodes,current,total):
        nodes=copy.deepcopy(nodes)
        def replace(items):
            for node in items:
                if isinstance(node.get('text'),str):node['text']=node['text'].replace('[[SC_PAGE]]',str(current)).replace('[[SC_TOTAL_PAGES]]',str(total or ''))
                if node.get('children'):replace(node['children'])
                for cell in node.get('cells',[]):replace(cell.get('children',[]))
        replace(nodes);return nodes
    page_cfg=document.get('page',{})
    first_header_mode=page_cfg.get('first_header_mode','same');first_footer_mode=page_cfg.get('first_footer_mode','same')
    regular_header=document.get('header',[]);regular_footer=document.get('footer',[])
    first_header=[] if first_header_mode=='none' else document.get('first_header',[]) if first_header_mode=='different' else regular_header
    first_footer=[] if first_footer_mode=='none' else document.get('first_footer',[]) if first_footer_mode=='different' else regular_footer
    def chrome_items(nodes,current=888,total=888):return flow(page_tokens(nodes,current,total),chrome=True)
    def chrome_height(nodes):return sum(f.wrap(width,800)[1] for f in chrome_items(nodes))
    hh=max(chrome_height(regular_header),chrome_height(first_header));fh=max(chrome_height(regular_footer),chrome_height(first_footer))
    if hh>120 or fh>100:fail('رأس الصفحة أو تذييلها كبير جدًا؛ قلّل المحتوى.')
    stream=io.BytesIO()
    class Doc(SimpleDocTemplate):
        def afterFlowable(self,f):
            if hasattr(f,'report_heading'):
                level,title=f.report_heading;anchor='h'+str(self.seq.nextf('heading'));self.canv.bookmarkPage(anchor);self.notify('TOCEntry',(level,escape(_pdf_visual_line(title)),self.page,anchor))
    def chrome(canvas,doc):
        canvas.saveState()
        hnodes=first_header if doc.page==1 else regular_header;fnodes=first_footer if doc.page==1 else regular_footer
        headers=chrome_items(hnodes,doc.page,_total);footers=chrome_items(fnodes,doc.page,_total)
        for items,y in [(headers,size[1]-margin+8),(footers,margin+fh)]:
            for f in items:
                _,h=f.wrap(width,800);y-=h;f.drawOn(canvas,margin,y)
        if page_cfg.get('automatic_page_number',True):
            canvas.setFont(font,9);canvas.drawString(margin,20,str(doc.page)+' / '+str(_total or ''))
        canvas.restoreState()
    doc=Doc(stream,pagesize=size,rightMargin=margin,leftMargin=margin,topMargin=margin+hh+12,bottomMargin=margin+fh+12,title=document['title'],author='SchemaCraft')
    try:
        doc.multiBuild(flow(document['blocks']) or [para(document['title'])],onFirstPage=chrome,onLaterPages=chrome)
    except LayoutError as exc:
        fail('تعذر توزيع أحد عناصر التقرير على الصفحات. صغّر العنصر أو قسّم محتواه: '+str(exc).splitlines()[0][:240])
    except ReportError:raise
    except Exception as exc:
        fail('تعذر إنشاء PDF بسبب عنصر غير صالح أو غير قابل للرسم: '+type(exc).__name__)
    if _total is None:
        try:
            from pypdf import PdfReader
            return pdf_bytes(document,font_path,len(PdfReader(io.BytesIO(stream.getvalue())).pages))
        except ReportError:raise
        except Exception as exc:fail('تعذر قراءة PDF أثناء حساب عدد الصفحات: '+type(exc).__name__)
    return stream.getvalue()


def handle(app, manager, payload):
    """All actions, including reads/downloads, inherit require_builder_access()."""
    store=Store(manager.data_dir);action=payload['action'][7:]
    def schema_for(t):
        with app.use_context(manager.context(t.get('schema_id'))):return copy.deepcopy(app.read_schema_file())
    component_versions={}
    def expand(t):
        t=copy.deepcopy(t)
        def nodes(items,stack=()):
            out=[]
            for b in items:
                if b.get('type')=='component':
                    key=b.get('component')
                    if key in stack:fail('حلقة اعتماد بين المكونات.')
                    candidates=[c for c in store.list('components') if c['component_id']==key]
                    if b.get('version') and b['version']!='latest':candidates=[c for c in candidates if c['id']==b['version']]
                    if not candidates:fail('المكون المحذوف أو نسخته غير موجودة.')
                    component=max(candidates,key=lambda x:x['number']);component_versions[b['id']]=component['id']
                    if component['schema_id']!=t['schema_id']:fail('المكون ينتمي إلى تصميم آخر.')
                    body=copy.deepcopy(component['blocks'])
                    def rekey(children):
                        for child in children:
                            child['id']=b['id']+'_'+child['id'][:32]
                            if child.get('children'):rekey(child['children'])
                            for cell in child.get('cells',[]):rekey(cell['children'])
                    rekey(body);out.extend(nodes(body,stack+(key,)))
                else:
                    if b.get('children'):b['children']=nodes(b['children'],stack)
                    for c in b.get('cells',[]):c['children']=nodes(c['children'],stack)
                    out.append(b)
            return out
        for zone in ['blocks','header','footer','first_header','first_footer']:t[zone]=nodes(t.get(zone,[]))
        return t
    def engine(t,records=None,params=None):return Engine(expand(t),schema_for(t),records,params,app.field_display_value)
    def validated(t):
        e=engine(t);problems=e.validate()
        if any(p['severity']=='error' for p in problems):fail('\n'.join(p['message'] for p in problems if p['severity']=='error'))
        return e
    if action=='list':
        runs=store.list('runs')
        # Interrupted process runs are explicit failures, never reported as completed.
        for run in runs:
            if run['state'] in {'Queued','Generating'} and run['id'] not in JOBS:
                run.update(state='Failed',error='توقف التطبيق أثناء الإنشاء. أعد التشغيل من النسخة المحفوظة.');save_json(store.root/'runs'/(run['id']+'.json'),run)
        return {'drafts':store.list('drafts'),'versions':store.list('versions'),'presets':store.list('presets'),'components':store.list('components'),'settings':store.list('settings'),'runs':[{k:v for k,v in r.items() if k not in {'template','schema','snapshot','documents'}} for r in runs]}
    if action=='delete_template':
        draft_id=ident(payload.get('id'))
        # A template deletion removes the editable template and its saved versions,
        # but never touches immutable generated artifacts/history.
        for v in store.list('versions'):
            if v.get('draft_id')==draft_id:
                store.delete('versions',v['id'])
        store.delete('drafts',draft_id)
        return {'ok':True}
    if action=='delete_run':
        run_id=ident(payload.get('id'))
        run=store.read('runs',run_id)
        if run.get('state') in {'Queued','Generating'}:fail('ألغِ التشغيل الجاري قبل حذفه.')
        import shutil
        directory=store.root/'outputs'/run_id
        if directory.is_dir():shutil.rmtree(directory)
        store.delete('runs',run_id)
        try:
            app.delete_advanced_report_history_for_run(run_id)
        except Exception:
            app.LOGGER.exception('Failed to remove unified export history for report run %s',run_id)
        return {'ok':True}
    if action=='settings_save':
        settings=payload.get('settings',{})
        for name,low,high in [('font_size',9,16),('margin',12,30),('max_profiles',1,5000)]:
            if not low<=number(settings.get(name,DEFAULTS[name]))<=high:fail('إعداد عام خارج النطاق الآمن: '+name)
        if settings.get('page_size',DEFAULTS['page_size']) not in {'A4','A3','Letter','Legal'}:fail('حجم الصفحة الافتراضي غير مدعوم.')
        if settings.get('orientation',DEFAULTS['orientation']) not in {'portrait','landscape'}:fail('اتجاه الصفحة الافتراضي غير صالح.')
        return {'saved':store.write('settings',{'settings':{**DEFAULTS,**settings}},'global',payload.get('revision'))}
    if action=='component_save':
        t=payload.get('template');validated(t)
        key=payload.get('component_id') or uuid.uuid4().hex;ident(key)
        with LOCK:
            versions=[c for c in store.list('components') if c['component_id']==key]
            c=store.write('components',{'component_id':key,'number':len(versions)+1,'title':str(payload.get('title','مكون'))[:160],'schema_id':t['schema_id'],'required_context':payload.get('required_context','collection'),'blocks':t['blocks'],'kind':payload.get('kind','block'),'state':'Ready'})
        return {'component':c}
    if action=='validate':return {'problems':engine(payload.get('template')).validate()}
    if action=='save':
        t=payload.get('template')
        # Drafts may contain incomplete elements, so errors are returned, not discarded.
        problems=engine(t).validate()
        return {'saved':store.write('drafts',{'template':t},payload.get('id'),payload.get('revision')),'problems':problems}
    if action=='publish':
        draft=store.read('drafts',payload.get('id'))
        if draft['revision']!=payload.get('revision'):fail('احفظ أحدث مسودة قبل اعتماد النسخة.')
        validated(draft['template'])
        with LOCK:
            versions=[v for v in store.list('versions') if v['draft_id']==draft['id']]
            saved=store.write('versions',{'template':draft['template'],'draft_id':draft['id'],'number':len(versions)+1,'state':'Ready','author':app.current_audit_user()})
        return {'version':saved}
    if action=='restore':
        version=store.read('versions',payload.get('version'))
        return {'saved':store.write('drafts',{'template':version['template']},version['draft_id'],payload.get('revision'))}
    if action=='preset_save':
        config=copy.deepcopy(payload.get('config',{}))
        if not isinstance(config,dict):fail('إعدادات التشغيل غير صالحة.')
        for name in config.get('prompt',[]):config.get('parameters',{}).pop(name,None)
        return {'saved':store.write('presets',{'title':str(payload.get('title','تشغيل متكرر'))[:160],'config':config},payload.get('id'),payload.get('revision'))}
    if action in {'status','cancel','download','inspect'}:
        run=store.read('runs',payload.get('id'))
        if action=='inspect':
            offset=payload.get('offset',0)
            if type(offset) is not int or offset<0:fail('إزاحة غير صالحة.')
            return {'template_version':run['template_version'],'parameters':run['parameters'],'selection':run['selection'],'component_versions':run['component_versions'],'profiles':run['resolved_profiles'],'documents':[{'profile':d.get('profile_id'),'trace':d.get('trace',[])} for d in run.get('documents',[])],'snapshot':run['snapshot'][offset:offset+20],'total_snapshot':len(run['snapshot']),'offset':offset}
        if action=='cancel':
            with LOCK:
                JOBS.get(run['id'],threading.Event()).set()
            return {'ok':True}
        if action=='download':
            output=next((o for o in run.get('outputs',[]) if o['name']==payload.get('name')),None)
            if not output:fail('المخرج غير موجود.')
            path=store.root/'outputs'/run['id']/output['name']
            return {'data':base64.b64encode(path.read_bytes()).decode('ascii'),'name':output['name']}
        return {'run':{k:v for k,v in run.items() if k not in {'snapshot','schema','template','documents'}}}
    if action not in {'preview','preflight','run'}:fail('إجراء محرر المستند غير صالح.')
    version=store.read('versions',payload['version']) if payload.get('version') else None
    if action=='run' and not version:fail('الإنشاء النهائي يحتاج نسخة جاهزة محفوظة.')
    t=version['template'] if version else payload.get('template');e=validated(t);t=e.t
    selection=payload.get('selection',{});params=payload.get('parameters',{})
    if not isinstance(selection,dict) or not isinstance(params,dict):fail('إعدادات التشغيل غير صالحة.')
    e.parameters=params;e.parameter_values();e.check_filter(selection.get('filter'),{'profile':True})
    with app.WORKBOOK_LOCK,app.use_context(manager.context(t['schema_id'])):
        snap=app._dataset_snapshot_unlocked(e.schema)
        selected=selection.get('ids')
        if selected is not None and (not isinstance(selected,list) or any(not isinstance(x,str) for x in selected)):fail('قائمة الملفات غير صالحة.')
        records=[]
        for code in (list(dict.fromkeys(selected)) if selected is not None else list(snap.records_by_code)):
            app.validate_person_code(code)
            record=snap.records_by_code.get(code)
            if record is None:fail('ملف محدد غير موجود: '+code)
            if record.get('archived') and not selection.get('include_archived'):
                if selected is not None:fail('ملف محدد مؤرشف: '+code)
                continue
            record={**copy.deepcopy(record),'id':code}
            query=selection.get('query','')
            if not isinstance(query,str) or len(query)>120:fail('نص البحث غير صالح.')
            try:
                description=' · '.join(str(app.field_display_value(f,record.get('values',{}).get(f['id'],''))) for c in e.schema.get('categories',[]) if c['kind']=='main' for f in c.get('fields',[]) if f['type'] not in app.SYSTEM_FIELD_TYPES and f['type'] not in {'file','spacer','field_group'})
            except Exception:
                # Search descriptions are convenience-only and must never break report preview.
                app.LOGGER.exception('Failed to build Advanced Reports profile description for %s',code)
                description=code
            if query.casefold() not in (code+' '+description).casefold():continue
            if e.matches(selection.get('filter'),{'profile':record}):records.append(record)
    if not records and t['mode']=='per_profile':fail('اختر ملفًا واحدًا على الأقل.')
    settings=store.list('settings');limit=settings[0]['settings'].get('max_profiles',5000) if settings else 5000
    if len(records)>limit:fail('عدد الملفات يتجاوز الحد المسموح؛ ضيّق التحديد. لم يتم اقتطاع النتائج.')
    e.records=records
    for p in t.get('parameters',[]):
        if p['type'] in {'profile','profiles'}:
            vals=e.parameters[p['id']];vals=vals if isinstance(vals,list) else [vals]
            if any(v and v not in snap.records_by_code for v in vals):fail('معامل يشير إلى ملف غير موجود.')
    documents=[];errors=[];total_elements=0
    for profile in (records if t['mode']=='per_profile' else [None]):
        try:
            item=Engine(t,e.schema,records,params,app.field_display_value)
            doc=item.render(profile);doc['profile_id']=profile['id'] if profile else None
            total_elements+=item.emitted
            if total_elements>50000:fail('التشغيل يتجاوز 50000 عنصر. قسّم التحديد إلى تشغيلات أصغر.')
            documents.append(doc)
        except (ReportError,TypeError,ValueError) as exc:errors.append({'profile':profile['id'] if profile else None,'message':str(exc)})
    if action=='preflight':return {'profiles':len(records),'documents':len(documents),'errors':errors,'problems':e.problems}
    if errors and (payload.get('strict',True) or action=='preview'):fail('\n'.join((err['profile'] or 'التقرير')+': '+err['message'] for err in errors))
    if not documents:fail('لا توجد مستندات صالحة للإنشاء.')
    if action=='preview':
        if len(documents)>20:fail('المعاينة تدعم حتى 20 مستندًا. اختر عينة؛ الإنشاء النهائي يدعم التحديد الكامل.')
        try:
            from pypdf import PdfReader,PdfWriter
            writer=PdfWriter()
            for doc in documents:writer.append(PdfReader(io.BytesIO(pdf_bytes(doc,app.PDF_FONT_PATH))))
            stream=io.BytesIO();writer.write(stream)
        except ReportError:
            raise
        except Exception as exc:
            try:
                app.LOGGER.exception('Advanced Reports PDF preview failed')
            except Exception:
                pass
            detail=str(exc).strip().replace('\n',' ')[:500]
            message='تعذر إنشاء معاينة PDF: '+type(exc).__name__
            if detail:
                message+=' — '+detail
            fail(message+'. سُجلت التفاصيل في data/logs/application.log.')
        return {'pdf':base64.b64encode(stream.getvalue()).decode('ascii'),'problems':e.problems}
    output=payload.get('output','combined')
    if output not in {'combined','separate','zip'}:fail('نوع المخرج غير صالح.')
    filename=payload.get('filename',[{'type':'text','text':t['title']}])
    # Filename tokens receive the same reference/context validation as body tokens.
    ft=copy.deepcopy(t);ft['blocks']=[{'id':'filename','type':'paragraph','content':filename}];fe=Engine(ft,e.schema)
    if any(p['severity']=='error' for p in fe.validate()):fail('صيغة اسم الملف تحتوي مرجعًا غير صالح.')
    if len(JOBS)>=2:fail('يوجد تشغيلان قيد الإنشاء. انتظر اكتمالهما قبل بدء تشغيل جديد.')
    run=store.write('runs',{'state':'Queued','template':t,'template_version':version['id'],'version_number':version['number'],'schema':e.schema,'snapshot':records,'parameters':e.parameters,'selection':selection,'resolved_profiles':[r['id'] for r in records],'author':app.current_audit_user(),'component_versions':component_versions,'errors':errors,'warnings':e.problems,'outputs':[],'completed':0,'total':len(documents),'output':output})
    event=threading.Event();JOBS[run['id']]=event
    font_path=app.PDF_FONT_PATH
    def worker():
        path=store.root/'runs'/(run['id']+'.json');directory=store.root/'outputs'/run['id'];directory.mkdir(parents=True,exist_ok=True)
        def update():
            with LOCK:save_json(path,run)
        try:
            run['state']='Generating';update();parts=[];used=set()
            for doc in documents:
                if event.is_set():run['state']='Cancelled';update();return
                try:
                    raw=pdf_bytes(doc,font_path)
                    profile=next((r for r in records if r['id']==doc.get('profile_id')),None)
                    base=safe_name(e.text(filename,{'profile':profile} if profile else {}));name=base;index=1
                    while name.casefold() in used:index+=1;name=base+'-'+str(index)
                    used.add(name.casefold());parts.append((name+'.pdf',raw))
                    run.setdefault('documents',[]).append(doc)
                except Exception as exc:
                    run['errors'].append({'profile':doc.get('profile_id'),'message':str(exc)})
                    if payload.get('strict',True):raise
                run['completed']+=1;update()
            if event.is_set():run['state']='Cancelled';update();return
            if not parts:fail('فشلت كل المستندات.')
            if output=='combined':
                from pypdf import PdfReader,PdfWriter
                writer=PdfWriter()
                for _,raw in parts:writer.append(PdfReader(io.BytesIO(raw)))
                stream=io.BytesIO();writer.write(stream);parts=[(safe_name(t['title'])+'.pdf',stream.getvalue())]
            elif output=='zip':
                stream=io.BytesIO()
                with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
                    for name,raw in parts:z.writestr(name,raw)
                parts=[(safe_name(t['title'])+'.zip',stream.getvalue())]
            for name,raw in parts:
                target=directory/name;target.write_bytes(raw)
                run['outputs'].append({'name':name,'bytes':len(raw),'checksum':__import__('hashlib').sha256(raw).hexdigest()})
            run['state']='Partial' if run['errors'] else 'Completed';update()
            try:
                app.record_advanced_report_run_history(run,directory,t.get('schema_id'))
            except Exception:
                # The generated report remains valid even if history bookkeeping fails.
                app.LOGGER.exception('Failed to merge advanced report run %s into export history',run['id'])
        except Exception as exc:run.update(state='Failed',error=str(exc));update()
        finally:JOBS.pop(run['id'],None)
    threading.Thread(target=worker,name='report-'+run['id'],daemon=True).start()
    return {'run':{'id':run['id'],'state':'Queued','total':len(documents)}}
