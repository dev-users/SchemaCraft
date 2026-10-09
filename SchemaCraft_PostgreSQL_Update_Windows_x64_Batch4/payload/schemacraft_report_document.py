"""Structured report documents. Pure evaluation; no source record writes or eval()."""
from __future__ import annotations
import ast
import copy
import hashlib
import json
import math
import re
import statistics
from datetime import datetime, date
from schemacraft_reports import ReportError, NAME, numbers, matches, validate_options

KINDS = {'heading', 'text', 'metric', 'table', 'repeat', 'chart', 'pagebreak', 'toc', 'cover', 'field'}
REDUCERS = {'sum', 'average', 'count', 'profile_count', 'row_count', 'empty_count', 'distinct_count', 'min', 'max', 'median'}

def fail(message): raise ReportError(message)
def bounded(value, maximum=200, label='النص'):
    if not isinstance(value, str) or len(value)>maximum: fail(label+' غير صالح أو طويل جدًا.')
    return value

def key(value):
    if not isinstance(value,str) or not NAME.fullmatch(value): fail('رمز غير صالح؛ استخدم الحروف الإنجليزية والأرقام والشرطة السفلية.')
    return value

def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def numeric(value):
    if isinstance(value,bool): fail('القيمة المنطقية ليست رقمًا.')
    nums=numbers([value])
    if not nums: fail('أدخل قيمة رقمية.')
    if abs(nums[0])>1e15: fail('القيمة أكبر من الحد العددي المدعوم.')
    return nums[0]

def expression(text):
    bounded(text,500,'المعادلة')
    try: tree=ast.parse(text,mode='eval')
    except (SyntaxError,ValueError,RecursionError): fail('المعادلة غير مكتملة.')
    nodes=list(ast.walk(tree))
    if len(nodes)>100: fail('المعادلة معقدة جدًا.')
    allowed=(ast.Expression,ast.BinOp,ast.UnaryOp,ast.Name,ast.Load,ast.Constant,ast.Add,ast.Sub,ast.Mult,ast.Div,ast.USub,ast.UAdd)
    if any(not isinstance(n,allowed) for n in nodes): fail('المعادلة تقبل أسماء المؤشرات والأرقام و + - * / والأقواس فقط.')
    for n in nodes:
        if isinstance(n,ast.Constant):
            if type(n.value) not in (int,float): fail('الثوابت في المعادلة يجب أن تكون أرقامًا.')
            numeric(n.value)
    return tree, {n.id for n in nodes if isinstance(n,ast.Name)}

def calculate(tree, lookup):
    def visit(n):
        if isinstance(n,ast.Expression): return visit(n.body)
        if isinstance(n,ast.Constant): return numeric(n.value)
        if isinstance(n,ast.Name): return lookup(n.id)
        if isinstance(n,ast.UnaryOp):
            v=visit(n.operand); return None if v is None else (-v if isinstance(n.op,ast.USub) else v)
        a,b=visit(n.left),visit(n.right)
        if a is None or b is None: return None
        if isinstance(n.op,ast.Div) and b==0: return None
        v=a+b if isinstance(n.op,ast.Add) else a-b if isinstance(n.op,ast.Sub) else a*b if isinstance(n.op,ast.Mult) else a/b
        if not math.isfinite(v) or abs(v)>1e15: fail('نتيجة المعادلة أكبر من الحد المدعوم.')
        return v
    return visit(tree)

IDENTITY_FIELDS = {'id', 'card_id', 'parent_id'}

def validate_criteria(owner):
    criteria=owner.get('criteria',[])
    if not isinstance(criteria,list) or len(criteria)>20: fail('الحد 20 شرطًا.')
    if owner.get('condition_mode','all') not in {'all','any'}: fail('طريقة الشروط غير صالحة.')
    for c in criteria:
        if not isinstance(c,dict) or not isinstance(c.get('field'),str) or not c['field'] or c.get('op') not in {'eq','ne','contains','gt','gte','lt','lte','empty','not_empty'}: fail('شرط غير صالح.')
        bounded(c.get('value',''),200,'قيمة الشرط')
        if c['op'] in {'gt','gte','lt','lte'}: numeric(c.get('value',''))

def row_value(row,field):
    return row.get(field,'') if field in IDENTITY_FIELDS else row['values'].get(field,'')

def row_matches(row,owner):
    def match(c):
        value=row_value(row,c['field'])
        if c['op']=='empty': return value is None or value==''
        if c['op']=='not_empty': return value is not None and value!=''
        return matches([value],c)
    criteria=owner.get('criteria',[])
    return not criteria or (any if owner.get('condition_mode')=='any' else all)(match(c) for c in criteria)

def inline_reference(token,datasets):
    parts=token.split(':')
    if len(parts)!=3 or parts[0]!='value' or parts[1] not in datasets or not parts[2]: fail('قيمة داخل النص غير صالحة: '+token)
    bounded(parts[2],120,'الحقل داخل النص')
    return parts[1],parts[2]

def validate_document(raw):
    if not isinstance(raw,dict): fail('المستند غير صالح.')
    t=copy.deepcopy(raw)
    bounded(t.get('title'),160,'اسم التقرير')
    if not t['title'].strip(): fail('أدخل اسم التقرير.')
    doc=t.get('document')
    if not isinstance(doc,dict) or doc.get('version')!=2: fail('إصدار المستند غير صالح.')
    datasets=doc.get('datasets',{}); metrics=doc.get('metrics',{}); blocks=doc.get('blocks',[])
    if not isinstance(datasets,dict) or len(datasets)>20: fail('الحد 20 مجموعة بيانات.')
    if not isinstance(metrics,dict) or len(metrics)>100: fail('الحد 100 مؤشر.')
    if not isinstance(blocks,list) or not 1<=len(blocks)<=150: fail('أضف من كتلة واحدة إلى 150 كتلة.')
    for name,d in datasets.items():
        key(name)
        if not isinstance(d,dict): fail('مجموعة البيانات غير صالحة.')
        for attr in ('title','schema_id','slot'): bounded(d.get(attr),120,attr)
        if not d['schema_id'] or not d['slot']: fail('حدد التصميم ومجموعة IDs.')
        if d.get('scope','profile') not in {'profile','card'}: fail('اختر ملفات أو بطاقات.')
        if d.get('scope')=='card' and not isinstance(d.get('category_id'),str): fail('اختر الفئة المتكررة.')
        validate_criteria(d)
        if d.get('selection','selected') not in {'selected','all'}: fail('اختيار الملفات غير صالح.')
        if type(d.get('include_archived',False)) is not bool: fail('خيار الأرشفة غير صالح.')
        bounded(d.get('sort_field',''),120)
        if d.get('sort_direction','asc') not in {'asc','desc'}: fail('ترتيب البيانات غير صالح.')
    deps={}
    for name,m in metrics.items():
        key(name)
        if not isinstance(m,dict): fail('المؤشر غير صالح.')
        bounded(m.get('title'),160)
        if m.get('kind','aggregate')=='formula':
            _,deps[name]=expression(m.get('expression'))
            if deps[name]-metrics.keys(): fail('مؤشر غير معروف في المعادلة: '+', '.join(deps[name]-metrics.keys()))
        elif m.get('kind','aggregate')=='aggregate':
            if m.get('dataset') not in datasets or m.get('function') not in REDUCERS: fail('حدد بيانات المؤشر ودالته.')
            bounded(m.get('field',''),120)
            if m.get('function') not in {'profile_count','row_count'} and not m.get('field'): fail('اختر حقل المؤشر: '+name)
            validate_criteria(m)
            deps[name]=set()
        else: fail('نوع المؤشر غير صالح.')
        if type(m.get('decimals',2)) is not int or not 0<=m.get('decimals',2)<=8: fail('المنازل العشرية بين 0 و8.')
        bounded(m.get('suffix',''),40)
    seen=set(); visiting=set()
    def check(n):
        if n in visiting: fail('حلقة اعتماد في المؤشرات: '+n)
        if n in seen: return
        visiting.add(n)
        for child in deps[n]: check(child)
        visiting.remove(n);seen.add(n)
    for name in metrics: check(name)
    if sum(b.get('type')=='toc' for b in blocks if isinstance(b,dict))>1: fail('استخدم فهرس صفحات واحدًا في المستند.')
    ids=set()
    for b in blocks:
        if not isinstance(b,dict) or b.get('type') not in KINDS: fail('نوع كتلة غير صالح.')
        key(b.get('id'))
        if b['id'] in ids: fail('رمز كتلة مكرر.')
        ids.add(b['id'])
        bounded(b.get('text',''),15000);bounded(b.get('title',''),300);bounded(b.get('row_title',''),1000)
        if b['type'] in {'table','repeat','field'}:
            if b.get('dataset') not in datasets: fail('حدد بيانات الجدول أو القسم المتكرر.')
        if b['type']=='field':
            bounded(b.get('field'),120,'الحقل')
            if not b['field']: fail('اختر حقلًا للكتلة.')
        if b['type']=='table':
            cols=b.get('columns',[])
            if not isinstance(cols,list) or not 1<=len(cols)<=12 or any(not isinstance(c,str) for c in cols): fail('اختر من عمود واحد إلى 12 عمودًا.')
            sums=b.get('sum_fields',[])
            if not isinstance(sums,list) or any(c not in cols for c in sums): fail('أعمدة الإجمالي غير صالحة.')
        if b['type']=='metric' and b.get('metric') not in metrics: fail('اختر المؤشر للكتلة.')
        if b['type']=='chart':
            if b.get('chart','bar') not in {'bar','line','pie'}: fail('نوع الرسم غير صالح.')
            names=b.get('metrics',[])
            if not isinstance(names,list) or not 1<=len(names)<=60 or any(n not in metrics for n in names): fail('اختر مؤشرات الرسم.')
        if b.get('when'):
            w=b['when']
            if not isinstance(w,dict) or w.get('metric') not in metrics or w.get('op') not in {'eq','ne','gt','gte','lt','lte'}: fail('شرط عرض الكتلة غير صالح.')
            numeric(w.get('value'))
        for token in re.findall(r'\{\{([^{}]+)\}\}',b.get('text','')+' '+b.get('title','')+' '+b.get('row_title','')):
            if token.startswith('value:'):
                inline_reference(token,datasets)
                continue
            if token not in {'date','id','card_id','parent_id'} and not token.startswith('field:') and token not in metrics: fail('عنصر غير معروف في الكتلة: '+token)
            if (token.startswith('field:') or token in {'id','card_id','parent_id'}) and b['type']!='repeat': fail('حقول الصف تُستخدم داخل القسم المتكرر.')
    body='\n\n'.join(('# ' if b['type'] in {'heading','cover'} else '')+(b.get('text') or b.get('title') or '['+b['type']+']') for b in blocks)
    result={'title':t['title'].strip(),'body':body,'placeholders':{},'options':validate_options(t.get('options',{})),'document':doc}
    if len(json.dumps(result,ensure_ascii=False))>280000: fail('القالب كبير جدًا.')
    return result

def required_fields(t,dataset):
    doc=t['document'];d=doc['datasets'][dataset]
    needed={c['field'] for c in d.get('criteria',[])}
    if d.get('sort_field'): needed.add(d['sort_field'])
    for m in doc['metrics'].values():
        if m.get('dataset')==dataset:
            if m.get('field'): needed.add(m['field'])
            needed.update(c['field'] for c in m.get('criteria',[]))
    for b in doc['blocks']:
        for token in re.findall(r'\{\{(value:[^{}]+)\}\}',b.get('text','')+' '+b.get('title','')+' '+b.get('row_title','')):
            source,field=inline_reference(token,doc['datasets'])
            if source==dataset: needed.add(field)
        if b.get('dataset')==dataset:
            needed.update(b.get('columns',[]))
            if b.get('field'): needed.add(b['field'])
            needed.update(re.findall(r'\{\{field:([^{}]+)\}\}',b.get('text','')+' '+b.get('title','')+' '+b.get('row_title','')))
    return needed-{'id','card_id','parent_id'}

def reduce_values(fn,values,rows):
    clean=[v for v in values if v is not None and v!='']
    if fn=='count': return len(clean)
    if fn=='row_count': return len(rows)
    if fn=='empty_count': return len(values)-len(clean)
    if fn=='profile_count': return len({r['id'] for r in rows})
    if fn=='distinct_count': return len({str(v) for v in clean})
    nums=numbers(clean)
    if not nums: return 0 if fn=='sum' else None
    result={'sum':sum,'average':statistics.mean,'median':statistics.median,'min':min,'max':max}[fn](nums)
    return numeric(result)

def format_number(v,m=None):
    if v is None: return '—'
    m=m or {};return format(v,f".{m.get('decimals',2)}f")+m.get('suffix','')

def cell_key(dataset,row,field): return 'cell:'+dataset+':'+row['key']+':'+field

def validate_overrides(overrides):
    if not isinstance(overrides,dict) or len(overrides)>1000: fail('التعديلات اليدوية غير صالحة أو كثيرة جدًا.')
    for k,v in overrides.items():
        bounded(k,400)
        if not isinstance(v,dict) or not isinstance(v.get('reason'),str) or not v['reason'].strip(): fail('أدخل سبب التعديل اليدوي.')
        bounded(v['reason'],500)
        if not isinstance(v.get('value'),(str,int,float)) or isinstance(v.get('value'),bool): fail('قيمة التعديل غير صالحة.')
        if isinstance(v['value'],str): bounded(v['value'],15000)
        else: numeric(v['value'])

def resolve_document(raw,bindings,loader,previous=None,overrides=None):
    t=validate_document(raw);doc=t['document']
    if not isinstance(bindings,dict): fail('اختيارات الملفات غير صالحة.')
    sources={}; schema_ids=set();identities=set()
    for name,d in doc['datasets'].items():
        ids=bindings.get(d['slot'],[])
        if d.get('selection')=='all': ids=None
        else:
            if not isinstance(ids,list) or not 1<=len(ids)<=500 or any(not isinstance(i,str) or not i.strip() or len(i)>80 for i in ids): fail('حدد من 1 إلى 500 ID للمجموعة '+d['slot'])
            ids=list(dict.fromkeys(i.strip().upper() for i in ids))
        labels,rows=loader(d,ids,required_fields(t,name))
        if len(rows)>5000: fail('تجاوزت مجموعة البيانات 5000 صف؛ ضيّق اختيار الملفات.')
        sources[name]={'labels':labels,'rows':rows,'definition':d}
        schema_ids.add(d['schema_id']);identities.update(r['id'] for r in rows)
    snapshot=digest(sources)
    result={'title':t['title'],'body':'','charts':{},'options':t['options'],'warnings':[], 'schema_ids':sorted(schema_ids),'record_count':len(identities),'generated_at':datetime.now().astimezone().isoformat(timespec='seconds'),
            'document_state':{'version':2,'template':t,'template_revision':digest(t),'bindings':copy.deepcopy(bindings),'sources':sources,'source_revision':snapshot,'overrides':copy.deepcopy(overrides if overrides is not None else (previous or {}).get('document_state',{}).get('overrides',{})),'history':copy.deepcopy((previous or {}).get('document_state',{}).get('history',[]))[-49:]}}
    result=recompute_document(result)
    old=(previous or {}).get('document_state',{})
    conflicts=[]; changes=[]
    for k,v in result['document_state']['baseline'].items():
        if k in old.get('baseline',{}) and old['baseline'][k]!=v: changes.append({'key':k,'old':old['baseline'][k],'new':v})
    for k,o in result['document_state']['overrides'].items():
        base=result['document_state']['baseline']
        if k not in base or (k in old.get('baseline',{}) and old['baseline'][k]!=base.get(k)):
            conflicts.append({'key':k,'old':old.get('baseline',{}).get(k),'new':base.get(k),'override':o['value'],'missing':k not in base})
    result['document_state']['conflicts']=conflicts
    result['document_state']['changes']=changes
    return result

def recompute_document(raw):
    out=copy.deepcopy(raw);state=out.get('document_state')
    if not isinstance(state,dict) or state.get('version')!=2: fail('المسودة المرئية غير صالحة.')
    t=validate_document(state.get('template'));doc=t['document'];overrides=state.get('overrides',{});validate_overrides(overrides)
    source=state.get('sources')
    if not isinstance(source,dict) or set(source)!=set(doc['datasets']): fail('لقطة البيانات غير صالحة.')
    if digest(source)!=state.get('source_revision'): fail('تغيرت لقطة المصدر؛ استخدم التعديلات الموثقة أو تحديث البيانات.')
    report_date=out.get('generated_at',date.today().isoformat())[:10]
    baseline={};datasets={};provenance={};warnings=[]
    for name,s in source.items():
        if not isinstance(s,dict) or not isinstance(s.get('rows'),list) or len(s['rows'])>5000: fail('صفوف البيانات غير صالحة.')
        d=doc['datasets'][name];rows=[]
        for original in s['rows']:
            row=copy.deepcopy(original)
            if not isinstance(row,dict) or not isinstance(row.get('values'),dict) or not isinstance(row.get('key'),str): fail('صف بيانات غير صالح.')
            for f,v in row['values'].items():
                k=cell_key(name,row,f);baseline[k]=v
                if k in overrides: row['values'][f]=overrides[k]['value']
            if row_matches(row,d): rows.append(row)
        field=d.get('sort_field')
        if field:
            def sort_key(r):
                v=r.get(field) if field in {'id','card_id','parent_id'} else r['values'].get(field,'')
                try: return (0,numeric(v))
                except ReportError: return (1,str(v).casefold())
            rows.sort(key=sort_key,reverse=d.get('sort_direction')=='desc')
        datasets[name]={'labels':s['labels'],'rows':rows,'definition':d,'source_count':len(s['rows'])}
    metrics={};visiting=set()
    def evaluate(name):
        if name in metrics: return metrics[name]['value']
        if name in visiting: fail('حلقة اعتماد في المؤشرات.')
        visiting.add(name);m=doc['metrics'][name];refs=[];dependencies=[]
        if m.get('kind')=='formula':
            tree,names=expression(m['expression']);dependencies=sorted(names)
            value=calculate(tree,evaluate)
        else:
            ds=datasets[m['dataset']];rows=[r for r in ds['rows'] if row_matches(r,m)];field=m.get('field','')
            values=[row_value(r,field) for r in rows]
            value=reduce_values(m['function'],values,rows)
            contributed=rows
            if m['function'] in {'count','distinct_count','sum','average','median','min','max'}: contributed=[r for r in rows if row_value(r,field) not in ('',None)]
            elif m['function']=='empty_count': contributed=[r for r in rows if row_value(r,field) in ('',None)]
            # Profile counts show one contributing reference per distinct person.
            if m['function']=='profile_count': contributed=list({r['id']:r for r in reversed(rows)}.values())[::-1]
            refs=[{'row':r['key'],'id':r['id'],'card_id':r.get('card_id',''),'parent_id':r.get('parent_id',''),'value':1 if m['function'] in {'profile_count','row_count'} else row_value(r,field)} for r in contributed]
        k='metric:'+name;baseline[k]=value
        if k in overrides: value=numeric(overrides[k]['value'])
        if value is None: warnings.append(m['title']+': لا توجد قيمة قابلة للحساب أو المقسوم عليه صفر.')
        metrics[name]={'value':value,'formatted':format_number(value,m),'title':m['title'],'definition':m,'dependencies':dependencies,'sources':refs,'override':overrides.get(k),'matched_rows':len(rows) if m.get('kind')!='formula' else None,'matched_profiles':len({r['id'] for r in rows}) if m.get('kind')!='formula' else None}
        provenance[k]=metrics[name];visiting.remove(name);return value
    for name in doc['metrics']: evaluate(name)
    def safe(v): return str('—' if v is None or v=='' else v).replace('|',' / ').replace('\r',' ').replace('\n',' ')
    inline_sources=[]
    def text(value,row=None):
        def sub(match):
            n=match[1]
            if n=='date': return report_date
            if n.startswith('value:'):
                name,field=inline_reference(n,datasets);ds=datasets[name];rows=ds['rows']
                if len(rows)!=1: fail('القيمة داخل النص «'+ds['definition']['title']+' / '+ds['labels'].get(field,field)+'» تتطلب صفًا واحدًا، لكن المصدر أعاد '+str(len(rows))+' صفوف. حدد ID واحدًا أو ضيّق الشروط، أو استخدم قسمًا متكررًا.')
                value=row_value(rows[0],field)
                inline_sources.append({'dataset':name,'field':field,'id':rows[0]['id'],'row':rows[0]['key'],'cell_key':cell_key(name,rows[0],field) if field not in IDENTITY_FIELDS else None,'value':value})
                return safe(value)
            if row and n in {'id','card_id','parent_id'}: return safe(row.get(n,''))
            if row and n.startswith('field:'): return safe(row['values'].get(n[6:],''))
            return metrics[n]['formatted'] if n in metrics else match[0]
        return re.sub(r'\{\{([^{}]+)\}\}',sub,value)
    chunks=[];rendered=[];charts={}
    for b in doc['blocks']:
        inline_sources=[]
        k='block:'+b['id'];baseline[k]=b.get('text','')
        value=str(overrides.get(k,{}).get('value',b.get('text','')))
        if b.get('when'):
            w=b['when'];v=metrics[w['metric']]['value']
            if v is None: continue
            target=numeric(w['value']);op=w['op']
            if not {'eq':v==target,'ne':v!=target,'gt':v>target,'gte':v>=target,'lt':v<target,'lte':v<=target}[op]: continue
        title=text(b.get('title',''));kind=b['type'];content='';info={'id':b['id'],'type':kind,'title':title,'override':overrides.get(k)}
        if kind=='heading': content='## '+text(value)
        elif kind=='text': content=text(value)
        elif kind=='cover': content='# '+(title or t['title'])+'\n\n'+text(value)+'\n\n'+report_date+'\n\n{{pagebreak}}'
        elif kind in {'toc','pagebreak'}: content='{{'+kind+'}}'
        elif kind=='metric':
            m=metrics[b['metric']];content='### '+(title or m['title'])+'\n'+m['formatted'];info['metric']=b['metric']
        elif kind=='field':
            ds=datasets[b['dataset']];rows=ds['rows']
            if len(rows)!=1: fail('كتلة الحقل الفردي تتطلب صفًا مطابقًا واحدًا: '+b['id'])
            info['dataset']=b['dataset'];info['cell_key']=cell_key(b['dataset'],rows[0],b['field'])
            content='### '+(title or ds['labels'].get(b['field'],b['field']))+'\n'+safe(rows[0]['values'].get(b['field'],''))
        elif kind=='chart':
            chart={'title':title,'type':b.get('chart','bar'),'labels':[metrics[n]['title'] for n in b['metrics']],'series':[{'label':'القيمة','values':[metrics[n]['value'] if metrics[n]['value'] is not None else 0 for n in b['metrics']]}]}
            if any(metrics[n]['value'] is None for n in b['metrics']): fail('لا يمكن رسم مؤشر غير محسوب؛ صحح البيانات أو المعادلة.')
            if chart['type']=='pie' and any(v<0 for v in chart['series'][0]['values']): fail('الرسم الدائري لا يقبل القيم السالبة.')
            charts[b['id']]=chart;content='{{chart:'+b['id']+'}}';info['metrics']=b['metrics']
        else:
            ds=datasets[b['dataset']];rows=ds['rows'];info['dataset']=b['dataset'];info['row_count']=len(rows)
            if title: content='## '+title+'\n\n'
            if kind=='table':
                cols=b['columns'];labels=[{'id':'ID','card_id':'البطاقة','parent_id':'البطاقة الأم'}.get(c,ds['labels'].get(c,c)) for c in cols]
                content+='| '+' | '.join(safe(x) for x in labels)+' |\n| '+' | '.join('---' for _ in cols)+' |\n'
                for row in rows: content+='| '+' | '.join(safe(row.get(c,'') if c in {'id','card_id','parent_id'} else row['values'].get(c,'')) for c in cols)+' |\n'
                sums={f:reduce_values('sum',[r['values'].get(f,'') for r in rows],rows) for f in b.get('sum_fields',[])}
                if sums:
                    content+='| '+' | '.join(format_number(sums[c]) if c in sums else 'الإجمالي' if i==0 else '' for i,c in enumerate(cols))+' |\n'
                    info['totals']=sums
                info['columns']=cols
            else:
                parts=[]
                for row in rows:
                    heading=text(b.get('row_title','ملف {{id}} — بطاقة {{card_id}}'),row)
                    parts.append('### '+heading+'\n\n'+text(value,row))
                content+=('\n\n{{pagebreak}}\n\n' if b.get('page_per_row') else '\n\n').join(parts)
            if not rows: content+='\nلا توجد صفوف مطابقة.\n'
        info['inline_sources']=inline_sources
        info['body']=content;rendered.append(info);chunks.append(content)
    state.update(template=t,datasets=datasets,metrics=metrics,baseline=baseline,provenance=provenance,rendered=rendered)
    out.update(body='\n\n'.join(chunks),charts=charts,warnings=warnings)
    if len(out['body'])>200000: fail('التقرير طويل جدًا؛ ضيّق نطاق البيانات أو قسّمه.')
    if len(json.dumps(out,ensure_ascii=False,allow_nan=False).encode())>2000000: fail('التقرير وبيانات تفسيره يتجاوزان 2 MB؛ ضيّق النطاق.')
    return out


def update_document(raw,changes):
    result=recompute_document(raw);state=result['document_state']
    if not isinstance(changes,list) or len(changes)>100: fail('طلبات التعديل غير صالحة.')
    for change in changes:
        if not isinstance(change,dict) or change.get('key') not in state['baseline']: fail('موضع التعديل غير موجود.')
        k=change['key'];before=copy.deepcopy(state['overrides'].get(k))
        if change.get('reset'): state['overrides'].pop(k,None)
        else:
            v={'value':change.get('value'),'reason':change.get('reason'),'at':datetime.now().astimezone().isoformat(timespec='seconds')}
            validate_overrides({k:v});state['overrides'][k]=v
        state['history'].append({'key':k,'before':before,'after':copy.deepcopy(state['overrides'].get(k)),'at':datetime.now().astimezone().isoformat(timespec='seconds')})
    state['history']=state['history'][-50:]
    return recompute_document(result)
