"""Offline Markdown report templates, safe data evaluation and PDF rendering.

No executable expressions, HTML, external images or remote resources are accepted.
"""
from __future__ import annotations
import copy
import hashlib
import io
import json
import math
import os
import re
import tempfile
import threading
import uuid
import statistics
from datetime import datetime
from datetime import date
from pathlib import Path

class ReportError(ValueError):
    pass

LOCK = threading.RLock()
TOKEN = re.compile(r'\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}')
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}$')
FUNCTIONS = {'sum', 'average', 'count', 'min', 'max', 'sumifs', 'averageifs', 'countifs', 'median', 'distinct_count', 'profile_count'}
OPS = {'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'}
RESERVED = {'date', 'toc', 'pagebreak'}

def validate_template(raw):
    if not isinstance(raw, dict): raise ReportError('القالب غير صالح.')
    if 'document' in raw:
        from schemacraft_report_document import validate_document
        return validate_document(raw)
    data = copy.deepcopy(raw)
    if not isinstance(data.get('title'), str) or not data['title'].strip() or len(data['title']) > 160:
        raise ReportError('أدخل اسم القالب (حتى 160 حرفًا).')
    if not isinstance(data.get('body'), str) or len(data['body']) > 200000:
        raise ReportError('نص القالب غير صالح أو كبير جدًا.')
    definitions = data.get('placeholders', {})
    if not isinstance(definitions, dict) or len(definitions) > 100:
        raise ReportError('الحد الأقصى 100 عنصر نائب.')
    for name, item in definitions.items():
        if not NAME.fullmatch(name) or name in RESERVED or not isinstance(item, dict): raise ReportError('اسم عنصر نائب غير صالح.')
        if item.get('type') not in {'field', 'chart', 'aggregate'}: raise ReportError('نوع عنصر نائب غير صالح.')
        for key in ('schema_id', 'slot'):
            if not isinstance(item.get(key), str) or not item[key].strip() or len(item[key]) > 120: raise ReportError('حدد التصميم ومجموعة IDs لكل عنصر.')
        fields = item.get('fields', [])
        if not isinstance(fields, list) or not fields or len(fields) > 12 or any(not isinstance(f, str) for f in fields):
            raise ReportError('اختر من حقل واحد إلى 12 حقلًا.')
        if item.get('condition_mode','all') not in {'all','any'}: raise ReportError('طريقة مطابقة الشروط غير صالحة.')
        precision=item.get('decimals')
        if precision is not None and (isinstance(precision,bool) or not isinstance(precision,int) or not 0<=precision<=8): raise ReportError('الدقة يجب أن تكون بين 0 و8.')
        for affix in ('prefix','suffix'):
            if not isinstance(item.get(affix,''),str) or len(item.get(affix,''))>40: raise ReportError('بادئة/لاحقة القيمة طويلة جدًا.')
        if item.get('sort','none') not in {'none','label','asc','desc'}: raise ReportError('ترتيب الرسم غير صالح.')
        top=item.get('top_n')
        if top is not None and (isinstance(top,bool) or not isinstance(top,int) or not 1<=top<=60): raise ReportError('حد الرسم يجب أن يكون بين 1 و60.')
        if item['type'] != 'chart' and len(fields) != 1: raise ReportError('اختر حقلًا واحدًا للقيمة أو الدالة.')
        if item['type'] == 'chart' and (not isinstance(item.get('title',''),str) or len(item.get('title',''))>200): raise ReportError('عنوان الرسم غير صالح.')
        if item['type'] == 'chart' and item.get('mode','values') not in {'values','distribution','grouped'}: raise ReportError('طريقة الرسم غير صالحة.')
        if item['type'] == 'chart' and item.get('mode') == 'distribution' and len(fields)!=1: raise ReportError('توزيع القيم يتطلب حقلًا واحدًا.')
        if item['type']=='chart' and item.get('mode')=='grouped':
            if not isinstance(item.get('group_field'),str) or not item['group_field']: raise ReportError('اختر حقل التجميع.')
            if item.get('reducer','sum') not in {'sum','average','count'}: raise ReportError('دالة الرسم غير صالحة.')
        if item['type'] == 'chart' and item.get('chart') not in {'bar','pie','line'}: raise ReportError('نوع الرسم غير صالح.')
        if item['type'] == 'chart' and item.get('chart') == 'pie' and len(fields) != 1: raise ReportError('الدائرة تتطلب حقلًا واحدًا.')
        if item['type'] == 'aggregate' and item.get('function') not in FUNCTIONS: raise ReportError('الدالة غير صالحة.')
        criteria = item.get('criteria', [])
        if not isinstance(criteria, list) or len(criteria) > 20: raise ReportError('الشروط غير صالحة.')
        for c in criteria:
            if not isinstance(c, dict) or not isinstance(c.get('field'), str) or c.get('op') not in OPS or not isinstance(c.get('value'), (str, int, float)):
                raise ReportError('شرط غير صالح.')
            if c['op'] in {'gt','gte','lt','lte'} and not numbers([c['value']]): raise ReportError('أدخل قيمة رقمية للمقارنة.')
        if item['type']=='aggregate' and item.get('function', '').endswith('ifs') and not criteria: raise ReportError('أضف شرطًا واحدًا على الأقل للدالة الشرطية.')
    unknown = set(TOKEN.findall(data['body'])) - set(definitions) - RESERVED
    if unknown: raise ReportError('عناصر غير معرّفة: ' + ', '.join(sorted(unknown)))
    remainder = TOKEN.sub('', data['body'])
    if '{{' in remainder or '}}' in remainder: raise ReportError('صيغة عنصر نائب غير مكتملة.')
    for name, item in definitions.items():
        if item['type'] == 'chart' and '{{'+name+'}}' in data['body']:
            if any('{{'+name+'}}' in line and line.strip() != '{{'+name+'}}' for line in data['body'].splitlines()):
                raise ReportError('ضع عنصر الرسم في سطر مستقل.')
    return {'title': data['title'].strip(), 'body':data['body'], 'placeholders':definitions,'options':validate_options(data.get('options',{}))}

def encode_template(data):
    data = validate_template(data)
    meta = json.dumps({'version':2 if 'document' in data else 1,'title':data['title'],'placeholders':data['placeholders'],'options':data['options'],**({'document':data['document']} if 'document' in data else {})},ensure_ascii=False).replace('-->', '\\u002d\\u002d>')
    return '<!-- SchemaCraftReport ' + meta + ' -->\n' + data['body']

def decode_template(text):
    if not isinstance(text,str) or len(text)>300000: raise ReportError('ملف القالب كبير أو غير صالح.')
    match = re.match(r'\A<!-- SchemaCraftReport (.*?) -->\r?\n',text)
    if not match: raise ReportError('اختر قالب Markdown صادرًا من SchemaCraft.')
    try: meta=json.loads(match[1])
    except ValueError as exc: raise ReportError('بيانات القالب غير صالحة.') from exc
    if not isinstance(meta,dict) or meta.get('version') not in {1,2}: raise ReportError('إصدار قالب غير مدعوم.')
    return validate_template({**meta,'body':text[match.end():]})

class TemplateStore:
    def __init__(self, folder): self.folder=Path(folder)
    def path(self, key):
        if not isinstance(key,str) or not re.fullmatch(r'[a-f0-9]{32}',key): raise ReportError('معرّف القالب غير صالح.')
        return self.folder/(key+'.md')
    def read(self,key):
        try: content=self.path(key).read_text(encoding='utf-8')
        except OSError as exc: raise ReportError('القالب غير موجود أو تعذّر قراءته.') from exc
        return {**decode_template(content),'id':key,'revision':hashlib.sha256(content.encode()).hexdigest()}
    def list(self):
        result=[]
        for path in sorted(self.folder.glob('*.md')):
            try: result.append(self.read(path.stem))
            except ReportError: continue
        return result
    def save(self,raw,key=None,revision=None):
        content=encode_template(raw)
        with LOCK:
            if key and self.read(key)['revision'] != revision: raise ReportError('تغيّر القالب. أعد فتحه قبل الحفظ.')
            key=key or uuid.uuid4().hex
            path=self.path(key); self.folder.mkdir(parents=True,exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.folder,delete=False) as f:
                temporary=Path(f.name); f.write(content)
            try: os.replace(temporary,path)
            finally: temporary.unlink(missing_ok=True)
        return self.read(key)
    def delete(self,key,revision):
        with LOCK:
            if self.read(key)['revision']!=revision: raise ReportError('تغيّر القالب. أعد فتحه قبل الحذف.')
            self.path(key).unlink()

def numbers(values):
    result=[]
    for v in values:
        if v is None or v=='': continue
        try:
            n=float(str(v).translate(str.maketrans('٠١٢٣٤٥٦٧٨٩٫٬','0123456789.,')).replace(',',''))
        except (ValueError,TypeError): raise ReportError('قيمة غير رقمية في حقل مستخدم للحساب أو الرسم: '+str(v)[:60])
        if not math.isfinite(n): raise ReportError('القيم غير المحدودة غير مدعومة.')
        result.append(n)
    return result

def matches(values, criterion):
    op=criterion['op']; target=str(criterion['value'])
    if op=='eq': return any(str(v)==target for v in values)
    if op=='ne': return all(str(v)!=target for v in values)
    if op=='contains': return any(target.casefold() in str(v).casefold() for v in values)
    comparison={'gt':lambda a,b:a>b,'gte':lambda a,b:a>=b,'lt':lambda a,b:a<b,'lte':lambda a,b:a<=b}[op]
    return any(comparison(n,numbers([target])[0]) for n in numbers(values))

def validate_options(raw):
    if not isinstance(raw,dict): raise ReportError('إعدادات الصفحة غير صالحة.')
    options={'orientation':'portrait','font_size':11,'accent':'blue','header':'','footer':''}
    options.update({k:raw[k] for k in options if k in raw})
    if options['orientation'] not in {'portrait','landscape'} or options['accent'] not in {'blue','teal','slate'}: raise ReportError('إعدادات الصفحة غير صالحة.')
    size=options['font_size']
    if isinstance(size,bool) or not isinstance(size,int) or not 9<=size<=16: raise ReportError('حجم النص يجب أن يكون بين 9 و16.')
    for key in ('header','footer'):
        if not isinstance(options[key],str) or len(options[key])>100 or '\n' in options[key]: raise ReportError('الرأس والتذييل: سطر واحد حتى 100 حرف.')
    return options


def finish_chart(chart, item, warnings, name):
    indices=list(range(len(chart['labels'])))
    order=item.get('sort','none')
    if order=='label': indices.sort(key=lambda i:chart['labels'][i].casefold())
    elif order in {'asc','desc'}: indices.sort(key=lambda i:chart['series'][0]['values'][i],reverse=order=='desc')
    limit=item.get('top_n')
    if len(indices)>60 and limit is None: raise ReportError('الرسم يتجاوز 60 فئة؛ حدد أعلى عدد من النتائج أو أضف شروطًا.')
    omitted=max(0,len(indices)-(limit or 60))
    indices=indices[:limit or 60]
    chart['labels']=[chart['labels'][i] for i in indices]
    for series in chart['series']:
        series['values']=[series['values'][i] for i in indices]
        if any(not math.isfinite(v) or abs(v)>1e15 for v in series['values']): raise ReportError('قيمة الرسم أكبر من الحد المدعوم.')
    if chart['type']=='pie' and any(v<0 for v in chart['series'][0]['values']): raise ReportError('الدائرة لا تقبل قيمًا سالبة.')
    chart['note']=f'عُرضت {len(indices)} فئات؛ استُبعدت {omitted}. النسب تخص الفئات المعروضة.' if omitted else ''
    if omitted: warnings.append(name+': '+chart['note'])
    if not indices: warnings.append(name+': لا توجد بيانات مطابقة.')
    return chart


class DraftStore:
    """Durable detached drafts with revision checks; never modifies source records."""
    def __init__(self,folder): self.folder=Path(folder)
    def path(self,key):
        if not isinstance(key,str) or not re.fullmatch(r'[a-f0-9]{32}',key): raise ReportError('معرّف المسودة غير صالح.')
        return self.folder/(key+'.json')
    def read(self,key):
        try:
            content=self.path(key).read_bytes()
            if len(content)>2000000: raise ReportError('المسودة كبيرة جدًا.')
            result=json.loads(content)
            validate_draft(result['draft'])
        except (OSError,ValueError,KeyError,TypeError) as exc: raise ReportError('تعذّر قراءة المسودة.') from exc
        return {**result,'id':key,'revision':hashlib.sha256(content).hexdigest()}
    def list(self):
        result=[]
        for path in self.folder.glob('*.json'):
            try:
                item=self.read(path.stem)
                result.append({'id':item['id'],'revision':item['revision'],'title':item['draft']['title'],'updated_at':item['updated_at'],'document':bool(item['draft'].get('document_state'))})
            except ReportError: continue
        return sorted(result,key=lambda x:x['updated_at'],reverse=True)
    def save(self,draft,key=None,revision=None):
        validate_draft(draft)
        result={'draft':copy.deepcopy(draft),'updated_at':datetime.now().astimezone().isoformat(timespec='seconds')}
        try: content=json.dumps(result,ensure_ascii=False,allow_nan=False).encode()
        except (ValueError,TypeError) as exc: raise ReportError('المسودة تحتوي بيانات غير صالحة.') from exc
        if len(content)>2000000: raise ReportError('المسودة كبيرة جدًا؛ الحد 2 MB.')
        with LOCK:
            if key and self.read(key)['revision']!=revision: raise ReportError('تغيّرت المسودة في نافذة أخرى. افتحها مجددًا أو احفظ نسخة.')
            self.folder.mkdir(parents=True,exist_ok=True)
            if not key and len(list(self.folder.glob('*.json')))>=200: raise ReportError('بلغ عدد المسودات 200؛ احذف مسودات قديمة.')
            key=key or uuid.uuid4().hex
            with tempfile.NamedTemporaryFile(dir=self.folder,delete=False) as f: temporary=Path(f.name);f.write(content)
            try: os.replace(temporary,self.path(key))
            finally: temporary.unlink(missing_ok=True)
        return self.read(key)
    def delete(self,key,revision):
        with LOCK:
            if self.read(key)['revision']!=revision: raise ReportError('تغيّرت المسودة؛ حدّث القائمة قبل الحذف.')
            self.path(key).unlink()


def resolve_report(raw, bindings, loader):
    """loader(schema_id, ids) returns field labels and ordered per-profile values.

    Criteria select profiles; all repeated values of selected profiles participate.
    """
    template=validate_template(raw)
    if not isinstance(bindings,dict): raise ReportError('مجموعات IDs غير صالحة.')
    warnings=[]; charts={}; resolved={}; cache={}; used=set(); profile_keys=set()
    active=set(TOKEN.findall(template['body']))-RESERVED
    for name,item in template['placeholders'].items():
        if name not in active: continue
        ids=bindings.get(item['slot'],[])
        if not isinstance(ids,list) or not ids or len(ids)>500 or any(not isinstance(i,str) or not i.strip() or len(i)>80 for i in ids):
            raise ReportError('أدخل من 1 إلى 500 ID للمجموعة: '+item['slot'])
        ids=list(dict.fromkeys(i.strip().upper() for i in ids))
        if item['type']=='field' and len(ids)!=1: raise ReportError('مجموعة الحقل الفردي تتطلب ID واحدًا: '+item['slot'])
        key=(item['schema_id'],tuple(ids))
        if key not in cache: cache[key]=loader(item['schema_id'],ids)
        labels,records=cache[key]
        used.add(item['schema_id']); profile_keys.update((item['schema_id'],i) for i in ids)
        for field in item['fields']+[c['field'] for c in item.get('criteria',[])]+([item['group_field']] if item.get('mode')=='grouped' else []):
            if field not in labels: raise ReportError('حقل محذوف أو غير موجود: '+field)
        criteria=item.get('criteria',[])
        compare=any if item.get('condition_mode')=='any' else all
        filtered=[r for r in records if not criteria or compare(matches(r['values'].get(c['field'],[]),c) for c in criteria)]
        if item['type']=='field':
            values=filtered[0]['values'].get(item['fields'][0],[]) if filtered else []
            resolved[name]=' | '.join(str(v) for v in values if v is not None and v!='') or '—'
        elif item['type']=='aggregate':
            fn=item['function'].removesuffix('ifs'); field=item['fields'][0]
            values=[v for r in filtered for v in r['values'].get(field,[]) if v is not None and v!='']
            if fn=='count': value=len(values)
            elif fn=='profile_count': value=len(filtered)
            elif fn=='distinct_count': value=len({str(v) for v in values})
            else:
                nums=numbers(values)
                if not nums and fn!='sum': value=None; warnings.append(name+': لا توجد قيم رقمية؛ لم يُحسب المتوسط/الحد.')
                else: value={'sum':lambda:sum(nums),'average':lambda:sum(nums)/len(nums),'min':lambda:min(nums),'max':lambda:max(nums),'median':lambda:statistics.median(nums)}[fn]()
            if value is not None and not math.isfinite(value): raise ReportError('نتيجة الحساب أكبر من الحد العددي المدعوم.')
            formatted='—' if value is None else format(value,f".{item['decimals']}f" if item.get('decimals') is not None else '.12g')
            resolved[name]=item.get('prefix','')+formatted+item.get('suffix','')
        else:
            if item.get('mode') == 'distribution':
                counts={}
                for row in filtered:
                    for v in row['values'].get(item['fields'][0],[]):
                        if v is not None and v!='': counts[str(v)]=counts.get(str(v),0)+1
                # Slicing and sorting are applied consistently by finish_chart.
                charts[name]={'type':item['chart'],'title':item.get('title') or name,'labels':list(counts),'series':[{'label':'عدد القيم','values':list(counts.values())}]}
                charts[name]=finish_chart(charts[name],item,warnings,name)
                resolved[name]='{{chart:'+name+'}}'
                continue
            series=[]
            if item.get('mode')=='grouped':
                groups={}
                for row in filtered:
                    labels_for_row=list(dict.fromkeys(str(v) for v in row['values'].get(item['group_field'],[]) if v is not None and v!=''))
                    if len(labels_for_row)>1: raise ReportError('حقل التجميع يجب أن يحتوي قيمة واحدة لكل ملف لتجنب العد المزدوج.')
                    group=labels_for_row[0] if labels_for_row else 'غير محدد'
                    groups.setdefault(group,[]).append(row)
                chart_labels=list(groups)
                for field in item['fields']:
                    values=[]
                    for rows in groups.values():
                        raw_values=[v for row in rows for v in row['values'].get(field,[]) if v is not None and v!='']
                        reducer=item.get('reducer','sum')
                        nums=numbers(raw_values) if reducer!='count' else []
                        if reducer=='average' and not nums: raise ReportError('مجموعة بلا قيم رقمية؛ لا يمكن رسم متوسطها. استخدم شرطًا لاستبعادها.')
                        values.append(len(raw_values) if reducer=='count' else sum(nums)/len(nums) if reducer=='average' else sum(nums))
                    series.append({'label':labels[field],'values':values})
            else:
                chart_labels=[r['id'] for r in filtered]
                for field in item['fields']:
                    values=[sum(numbers(r['values'].get(field,[]))) for r in filtered]
                    series.append({'label':labels[field], 'values':values})
            if item['chart']=='pie' and any(v<0 for v in series[0]['values']): raise ReportError('الرسم الدائري لا يقبل قيمًا سالبة.')
            if not filtered: warnings.append(name+': لا توجد ملفات مطابقة للرسم.')
            charts[name]={'type':item['chart'],'title':item.get('title') or name,'labels':chart_labels,'series':series}
            charts[name]=finish_chart(charts[name],item,warnings,name)
            resolved[name]='{{chart:'+name+'}}'
    body=TOKEN.sub(lambda m: date.today().isoformat() if m[1]=='date' else '{{'+m[1]+'}}' if m[1] in {'toc','pagebreak'} else resolved[m[1]],template['body'])
    # Values are plain Markdown text, never evaluated a second time as expressions.
    return {'title':template['title'],'body':body,'charts':charts,'warnings':warnings,'schema_ids':sorted(used),'record_count':len(profile_keys),'options':template['options'],'generated_at':datetime.now().astimezone().isoformat(timespec='seconds')}

def validate_draft(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('title'),str) or not raw['title'].strip() or len(raw['title'])>160 or not isinstance(raw.get('body'),str) or len(raw['body'])>200000: raise ReportError('مسودة التقرير غير صالحة.')
    validate_options(raw.get('options',{}))
    if 'document_state' in raw:
        from schemacraft_report_document import recompute_document
        recompute_document(raw)
    charts=raw.get('charts',{})
    if not isinstance(charts,dict) or len(charts)>100: raise ReportError('بيانات الرسم غير صالحة.')
    for key,c in charts.items():
        if not NAME.fullmatch(key) or not isinstance(c,dict) or c.get('type') not in {'bar','line','pie'}: raise ReportError('رسم غير صالح.')
        if not isinstance(c.get('title'),str) or len(c['title'])>200: raise ReportError('عنوان الرسم غير صالح.')
        if not isinstance(c.get('note',''),str) or len(c.get('note',''))>300: raise ReportError('ملاحظة الرسم غير صالحة.')
        labels=c.get('labels'); series=c.get('series')
        if not isinstance(labels,list) or len(labels)>60 or any(not isinstance(v,str) or len(v)>160 for v in labels): raise ReportError('تسميات الرسم غير صالحة.')
        if not isinstance(series,list) or not 1<=len(series)<=12: raise ReportError('سلاسل الرسم غير صالحة.')
        if c['type']=='pie' and len(series)!=1: raise ReportError('الرسم الدائري يتطلب سلسلة واحدة.')
        for s in series:
            if not isinstance(s,dict) or not isinstance(s.get('label'),str) or len(s['label'])>160 or not isinstance(s.get('values'),list) or len(s['values'])!=len(labels): raise ReportError('أبعاد الرسم غير متطابقة.')
            if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>1e15 for v in s['values']): raise ReportError('قيم الرسم غير صالحة أو كبيرة جدًا.')
            if c['type']=='pie' and any(v<0 for v in s['values']): raise ReportError('قيم الدائرة لا يمكن أن تكون سالبة.')
    for key in re.findall(r'\{\{chart:([^}]+)\}\}',raw['body']):
        if key not in charts: raise ReportError('الرسم غير موجود: '+key)
    for line in raw['body'].splitlines():
        if '{{chart:' in line and not re.fullmatch(r'\{\{chart:[A-Za-z][A-Za-z0-9_]{0,63}\}\}',line.strip()): raise ReportError('ضع الرسم في سطر مستقل.')
    return raw

PALETTE=['#2875bd','#25a18e','#e9ac44','#9868c6','#db6575','#627d98']

def pdf_bytes(raw,font_path):
    draft=validate_draft(raw)
    if 'document_state' in draft:
        from schemacraft_report_document import recompute_document
        draft=recompute_document(draft)
        if draft['document_state'].get('conflicts'): raise ReportError('راجع تعارضات التحديث قبل تصدير التقرير.')
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.charts.linecharts import HorizontalLineChart
    from reportlab.graphics.charts.piecharts import Pie
    from schemacraft_advanced import _pdf_text, _pdf_visual_line
    from xml.sax.saxutils import escape
    font='SchemaCraftReportArabic'
    with LOCK:
        if font not in pdfmetrics.getRegisteredFontNames(): pdfmetrics.registerFont(TTFont(font,str(font_path)))
        bold_path=Path(font_path).with_name('DejaVuSans-Bold.ttf')
        if font+'Bold' not in pdfmetrics.getRegisteredFontNames(): pdfmetrics.registerFont(TTFont(font+'Bold',str(bold_path if bold_path.is_file() else font_path)))
        pdfmetrics.registerFontFamily(font,normal=font,bold=font+'Bold',italic=font,boldItalic=font+'Bold')
    options=validate_options(draft.get('options',{}))
    page_size=(842,595) if options['orientation']=='landscape' else (595,842)
    width=page_size[0]-112
    accent={'blue':'#164a78','teal':'#147d70','slate':'#475569'}[options['accent']]
    def style(size=11, **kw): return ParagraphStyle('report',fontName=font,fontSize=size,leading=size*1.65,alignment=2,spaceAfter=8,**kw)
    normal=style(options['font_size']); headings=[style(22,textColor=colors.HexColor(accent),keepWithNext=True),style(17,keepWithNext=True),style(13,keepWithNext=True)]
    def para(text,sty=normal,available=width):
        text=str(text)
        emphasis=re.findall(r'\*\*(.*?)\*\*',text)
        clean=text.replace('**','')
        # Wrap in logical order first so multi-line Arabic remains top-to-bottom.
        markup=_pdf_text(clean,max_width=available,measure=lambda t:pdfmetrics.stringWidth(t,font+'Bold' if emphasis else font,sty.fontSize))
        for phrase in emphasis:
            visual=escape(_pdf_visual_line(phrase))
            if visual and visual in markup:
                markup=markup.replace(visual,'<b>'+visual+'</b>',1)
        return Paragraph(markup,sty)
    structured='document_state' in draft
    if structured:
        from reportlab.platypus.tableofcontents import TableOfContents
        class ArabicContents(TableOfContents):
            def wrap(self,availWidth,availHeight):
                entries=self._lastEntries or [(0,'المحتويات',0,None)]
                rows=[]
                for level,title,page,anchor in entries:
                    link=('<a href="#'+anchor+'">'+title+'</a>') if anchor else title
                    title_style=style(11 if level==0 else 10,rightIndent=level*12)
                    page_style=ParagraphStyle('toc-page',parent=normal,alignment=0,fontSize=10)
                    rows.append([Paragraph(str(page),page_style),Paragraph(link,title_style)])
                self._table=Table(rows,colWidths=[40,availWidth-40],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.25,colors.HexColor('#e3ebf2'))]))
                self.width,self.height=self._table.wrapOn(self.canv,availWidth,availHeight)
                return self.width,self.height
        toc_flowable=ArabicContents()
    story=[]
    lines=draft['body'].splitlines(); toc=[re.sub(r'^#{1,3}\s+','',l) for l in lines if re.match(r'^#{1,3}\s+',l)]
    i=0
    while i<len(lines):
        line=lines[i].strip(); i+=1
        if not line: story.append(Spacer(1,6)); continue
        if line=='{{pagebreak}}': story.append(PageBreak()); continue
        if line=='{{toc}}':
            story.append(para('المحتويات',headings[1]))
            if structured: story.append(toc_flowable)
            else:
                for n,title in enumerate(toc,1): story.append(para(f'{n}. {title}'))
            continue
        match=re.fullmatch(r'\{\{chart:(\w+)\}\}',line)
        if match:
            c=draft['charts'][match[1]]; chart_heading=para(c['title'],headings[2]);chart_heading.report_heading=(2,c['title']);story.append(chart_heading)
            if not c['labels'] or not any(any(v for v in s['values']) for s in c['series']): story.append(para('لا توجد قيم للرسم.')); continue
            d=Drawing(width,215)
            chart=Pie() if c['type']=='pie' else VerticalBarChart() if c['type']=='bar' else HorizontalLineChart()
            chart.x=48; chart.y=35; chart.width=width-75; chart.height=165
            if c['type']=='pie':
                chart.width=165; chart.x=(width-165)/2; chart.data=c['series'][0]['values']; chart.labels=[str(n+1) for n in range(len(c['labels']))]
                chart.slices.fontName=font
                for n in range(len(c['labels'])): chart.slices[n].fillColor=colors.HexColor(PALETTE[n%len(PALETTE)])
            else:
                chart.data=[s['values'] for s in c['series']]
                all_values=[v for s in c['series'] for v in s['values']]
                chart.valueAxis.valueMin=min(0,min(all_values))
                chart.valueAxis.valueMax=max(0,max(all_values)) or 1
                chart.categoryAxis.categoryNames=[str(n+1) for n in range(len(c['labels']))]
                chart.categoryAxis.labels.fontName=font; chart.categoryAxis.labels.fontSize=7
                chart.valueAxis.labels.fontName=font; chart.valueAxis.labels.fontSize=8
                if c['type']=='bar':
                    for n in range(len(c['series'])): chart.bars[n].fillColor=colors.HexColor(PALETTE[n%len(PALETTE)])
                else:
                    for n in range(len(c['series'])): chart.lines[n].strokeColor=colors.HexColor(PALETTE[n%len(PALETTE)])
            d.add(chart); story.append(d)
            if c.get('note'): story.append(para(c['note'],style(9)))
            # A full data table supplies accessible labels and exact figures, even for crowded charts.
            table_rows=[[para('الفئة / ID',available=100)]+[para(s['label'],style(10,textColor=colors.HexColor(PALETTE[c['series'].index(s)%len(PALETTE)])),available=(width-112)/len(c['series'])-12) for s in c['series']]]
            for n,label in enumerate(c['labels']): table_rows.append([para(f'{n+1}. {label}',available=100)]+[para(format(s['values'][n],'.10g'),available=(width-112)/len(c['series'])-12) for s in c['series']])
            table=Table([list(reversed(row)) for row in table_rows],colWidths=[(width-112)/len(c['series'])]*len(c['series'])+[112],repeatRows=1,hAlign='RIGHT',splitInRow=1)
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf2fa')),('GRID',(0,0),(-1,-1),.3,colors.HexColor('#d5dfeb')),('VALIGN',(0,0),(-1,-1),'TOP')]))
            story.append(table); continue
        heading=re.match(r'^(#{1,3})\s+(.*)',line)
        if heading:
            p=para(heading[2],headings[len(heading[1])-1]);p.report_heading=(len(heading[1])-1,heading[2]);story.append(p);continue
        if line.startswith('|') and line.endswith('|'):
            rows=[line]
            while i<len(lines) and lines[i].strip().startswith('|') and lines[i].strip().endswith('|'): rows.append(lines[i].strip()); i+=1
            cells=[[v.strip() for v in r.strip('|').split('|')] for r in rows if not re.fullmatch(r'[|\s:\-]+',r)]
            if not cells: continue
            columns=max(map(len,cells))
            if columns>12: raise ReportError('الجدول يدعم حتى 12 عمودًا.')
            table=Table([[para(v,available=width/columns-12) for v in reversed(row+['']*(columns-len(row)))] for row in cells],colWidths=[width/columns]*columns,repeatRows=1,splitInRow=1)
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf2fa')),('GRID',(0,0),(-1,-1),.3,colors.HexColor('#d5dfeb')),('VALIGN',(0,0),(-1,-1),'TOP')]))
            story.append(table); continue
        if line=='---': story.append(Spacer(1,12)); continue
        story.append(para(re.sub(r'^[-*]\s+','• ',line)))
    if not story: story=[para(draft['title'])]
    stream=io.BytesIO()
    class ReportDocument(SimpleDocTemplate):
        def afterFlowable(self,flowable):
            if structured and hasattr(flowable,'report_heading'):
                level,title=flowable.report_heading
                anchor='heading-'+str(self.seq.nextf('report-heading'))
                self.canv.bookmarkPage(anchor)
                self.notify('TOCEntry',(level,escape(_pdf_visual_line(title)),self.page,anchor))
    doc=ReportDocument(stream,pagesize=page_size,rightMargin=56,leftMargin=56,topMargin=48,bottomMargin=48,title=draft['title'],author='SchemaCraft')
    def footer(canvas,doc):
        canvas.saveState()
        canvas.setFont(font,9); canvas.setFillColor(colors.HexColor('#617389'))
        canvas.drawString(56,25,str(doc.page))
        def caption(text,y,available):
            if not text: return
            visual=_pdf_visual_line(text)
            size=min(9,9*available/max(1,pdfmetrics.stringWidth(visual,font,9)))
            canvas.setFont(font,size);canvas.drawRightString(page_size[0]-56,y,visual)
        caption(options['header'],page_size[1]-25,width)
        caption(options['footer'],25,width-70)
        canvas.restoreState()
    if structured: doc.multiBuild(story,onFirstPage=footer,onLaterPages=footer)
    else: doc.build(story,onFirstPage=footer,onLaterPages=footer)
    return stream.getvalue()
