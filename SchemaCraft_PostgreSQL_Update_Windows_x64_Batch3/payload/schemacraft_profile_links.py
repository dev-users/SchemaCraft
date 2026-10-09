"""Explicit, optional transaction-row → profile relationships.

Matching is read-only. A unique match is never an authorization to link. The
user selects a profile; normal record Save persists the relationship and copied
values. Old code-based related-person behavior remains independent. Recipient-table copying is delegated to the source-owned delivery module,
when explicitly configured, after the source record is saved.
"""
from __future__ import annotations
import copy
import json
import hashlib
import re
import schemacraft_finance as F
import schemacraft_finance_api as API
import schemacraft_field_rules as R
import schemacraft_link_config as LC
from schemacraft_value_presentation import wire_value

class LinkError(ValueError): pass
HEADER = '_profile_link'


def scoped(schema,cat):
    return {fid:(c,f) for fid,(c,f) in F.fields(schema).items() if c['kind']=='main' or c['id']==cat['id']}


def normalize(schema,raw=None,schemas=None,schema_id=''):
    raw=raw or schema
    import schemacraft_record_choices as C
    C.normalize(schema, raw, schemas, schema_id)
    source_cats={c['id']:c for c in raw.get('categories',[])}
    for cat in schema['categories']:
        raw_cat=source_cats.get(cat['id'],{})
        try:
            owned=LC.owner(raw_cat)
        except ValueError as exc:
            raise LinkError(str(exc)) from exc
        cfg=owned.get(LC.FIELD_KEY) if owned is not None else raw_cat.get('profile_linking')
        if cfg is None and owned is None:continue
        if owned is not None:
            if not isinstance(cfg,dict) or not isinstance(cfg.get('enabled',False),bool) or not isinstance(cfg.get('delivery_required',False),bool):
                raise LinkError('إعداد استخدام المطابقة غير صالح.')
            if owned.get('type') not in {'text','select','number','date_gregorian','date_persian','date_hijri'} or owned.get('financial') or owned.get('composition') or owned.get('auto_update'):
                raise LinkError('إعداد الربط يجب أن يكون في حقل مطابقة يدوي داخل جدول الحركة.')
            # A new field setting is authoritative; never keep an editable second copy.
            cat.pop('profile_linking', None)
            target_owner=next((f for f in cat['fields'] if f['id']==owned['id']),None)
            if target_owner is None:raise LinkError('حقل المطابقة غير موجود.')
        else:
            target_owner=None
        if cat['kind']!='repeatable' or not isinstance(cfg,dict):raise LinkError('ربط المعاملات متاح للفئات المتكررة فقط.')
        sources=cfg.get('sources',[])
        if not isinstance(sources,list) or not (0 if cfg.get('enabled') is False else 1)<=len(sources)<=16:raise LinkError('اختر مصدر ربط واحدًا على الأقل؛ الحد الأقصى 16.')
        result=[];used=set();local=scoped(schema,cat)
        for source in sources:
            if not isinstance(source,dict):raise LinkError('تعريف مصدر الربط غير صالح.')
            sid=str(source.get('schema_id') or '')
            ident=str(source.get('id') or '')
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',ident) or ident in used:raise LinkError('مصدر الربط غير صالح أو مكرر.')
            used.add(ident)
            remote=schema if not sid or sid==schema_id else (schemas or {}).get(sid)
            if remote is None and schemas is not None:raise LinkError('تصميم الربط المصدر غير متاح.')
            remote_category_id = str(source.get('category_id') or '')
            if remote is not None and remote_category_id:
                rc = next((c for c in remote['categories'] if c['id'] == remote_category_id), None)
                if not rc or rc['kind'] != 'repeatable':
                    raise LinkError('اختر فئة متكررة صالحة لمطابقة الصفوف.')
            remote_fields={fid:f for fid,(c,f) in F.fields(remote).items() if c['kind']=='main' or c['id']==remote_category_id} if remote else None
            keys=source.get('matches',[]);copies=source.get('copies',[])
            if not isinstance(keys,list) or not 1<=len(keys)<=16:raise LinkError('اختر حقل مطابقة واحدًا على الأقل.')
            if not isinstance(copies,list) or len(copies)>64:raise LinkError('قائمة حقول النسخ غير صالحة.')
            clean_keys=[];clean_copies=[];targets=set()
            for key in keys:
                if not isinstance(key,dict):raise LinkError('حقل مطابقة غير صالح.')
                lf,rf=key.get('local_field_id'),key.get('remote_field_id')
                if lf not in local and lf!='$record_code':raise LinkError('حقل المطابقة المحلي محذوف أو من بطاقة أخرى.')
                if remote_fields is not None and rf not in remote_fields and rf!='$record_code':raise LinkError('حقل مطابقة السجل المصدر غير متاح.')
                if remote_fields is not None:
                    a={'type':'text'} if lf=='$record_code' else local[lf][1]
                    b={'type':'text'} if rf=='$record_code' else remote_fields[rf]
                    if not R.compatible(a,b) or a['type'] in {'file','spacer','checkbox_group'}:raise LinkError('نوعا حقلي المطابقة غير متوافقين.')
                clean_keys.append({'local_field_id':lf,'remote_field_id':rf})
            for mapping in copies:
                if not isinstance(mapping,dict):raise LinkError('حقل النسخ غير صالح.')
                src,dest=mapping.get('source_field_id'),mapping.get('target_field_id')
                dest_pair=local.get(dest)
                if not dest_pair or dest_pair[0]['id']!=cat['id'] or dest in targets:raise LinkError('اختر وجهات نسخ مختلفة من حقول بطاقة المعاملة.')
                target=dest_pair[1]
                if target['type'] in {'file','spacer','system_record_code','system_created_at','system_updated_at','user_name'} or target.get('financial') or target.get('composition') or target.get('auto_update'):
                    raise LinkError('وجهة النسخ يجب أن تكون حقل إدخال يدويًا.')
                if remote_fields is not None:
                    if src!='$record_code' and src not in remote_fields:raise LinkError('حقل النسخ المصدر محذوف.')
                    sf={'type':'text'} if src=='$record_code' else remote_fields[src]
                    if sf['type']=='file' or (not R.compatible(target,sf) and target['type'] not in {'text','textarea'}):raise LinkError('نوعا المصدر والوجهة غير متوافقين.')
                targets.add(dest);clean_copies.append({'source_field_id':src,'target_field_id':dest})
            clean_source={'id':ident,'schema_id':sid,'matches':clean_keys,'copies':clean_copies, **({'category_id':remote_category_id} if remote_category_id else {})}
            import schemacraft_transaction_delivery as D
            try:
                destination=D.normalize_destination(schema,cat,clean_source,remote,source.get('destination'),schema_id)
            except ValueError as exc: raise LinkError(str(exc)) from exc
            if destination: clean_source['destination']=destination
            result.append(clean_source)
        incoming = cfg.get('incoming_fields')
        if incoming is not None and (not isinstance(incoming, list) or len(incoming) > 64 or any(fid not in local or local[fid][0]['id'] != cat['id'] or local[fid][1]['type'] in {'file', 'spacer'} for fid in incoming)):
            raise LinkError('أعمدة الحركات المرتبطة غير صالحة.')
        clean_config={'enabled':cfg.get('enabled',True) is not False,'sources':result,
            **({'incoming_fields': list(dict.fromkeys(incoming))} if incoming is not None else {})}
        if target_owner is not None:
            if clean_config['enabled']:
                if any(not any(m['local_field_id']==target_owner['id'] for m in source['matches']) for source in result):
                    raise LinkError('يجب أن يشارك حقل المطابقة المالك في مطابقة كل مصدر.')
                if cfg.get('delivery_required') and any(not s.get('destination') for s in result):
                    raise LinkError('اختر جدول المقصد وحقول النسخ لكل مصدر لتفعيل ربط الحركة بالكامل.')
            clean_config['delivery_required']=bool(cfg.get('delivery_required',False))
            target_owner[LC.FIELD_KEY]=clean_config
        else:
            cat['profile_linking']=clean_config
    return schema


def read_link(value):
    if not value:return None
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:raise LinkError('تعذر قراءة رابط السجل المحفوظ.') from None
    if not isinstance(value,dict):raise LinkError('رابط السجل غير صالح.')
    result={k:value.get(k,'') for k in ('source_id','schema_id','record_id','record_code','record_title','schema_name','source_updated_at','source_revision','category_id','child_id','row_title')}
    if any(not isinstance(v,str) or len(v)>1000 for v in result.values()) or not result['source_id'] or not result['record_code'] or not re.fullmatch('[a-fA-F0-9]{32}',result['record_id']):
        raise LinkError('رابط السجل غير صالح.')
    return result


def title(schema,record):
    fields=F.fields(schema)
    chosen=[f for c,f in fields.values() if c['kind']=='main' and f.get('result_title')]
    if not chosen:chosen=[f for c,f in fields.values() if c['kind']=='main' and f.get('type') in {'text','textarea'}][:2]
    return (' · '.join(F.label(f,record.get('values',{}).get(f['id'],'')) for f in chosen if not F.blank(record.get('values',{}).get(f['id']))) or record.get('record_code',''))[:900]


def revision(record):
    # Timestamps may have only second resolution. Bind review to actual content.
    return hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), default=str).encode()).hexdigest()


def source_name(app, schema, sid):
    if app.WORKSPACE_MANAGER:
        return next((x['name'] for x in app.WORKSPACE_MANAGER.response().get('schemas', [])
                     if x['id'] == sid), schema.get('app', {}).get('title', ''))
    return schema.get('app', {}).get('title', '')


def record_value(schema,record,fid,row=None):
    if fid=='$record_code':return record.get('record_code',''),{'type':'text'}
    pair=F.fields(schema).get(fid)
    if not pair:raise LinkError('حقل مصدر الربط محذوف.')
    values = record.get('values',{}) if pair[0]['kind']=='main' else (row or {}).get('values',{})
    return values.get(fid,''),pair[1]


def copy_values(app,schema,cat,remote,record,source,row=None):
    result={};lookup=F.fields(schema)
    for m in source['copies']:
        value,sf=record_value(remote,record,m['source_field_id'],row);target=lookup[m['target_field_id']][1]
        if R.empty(value):value=False if target['type']=='checkbox' else [] if target['type']=='checkbox_group' else ''
        elif sf['type'] in R.DATE_TYPES and target['type'] in R.DATE_TYPES:value=R.convert_date(value,sf['type'],target['type'])
        elif target['type'] in {'text','textarea'}:value=F.label(sf,value)
        elif target['type'] in R.OPTION_TYPES:
            value=[F.label(sf,v) for v in value] if isinstance(value,list) else F.label(sf,value)
        result[target['id']]=app.normalize_field_value(value,target)
    return result


def source_rows(schema, record, source):
    """One main profile or each actual row of an explicitly selected category."""
    cid = source.get('category_id', '')
    if not cid:
        return [None]
    cat = next((c for c in schema['categories'] if c['id'] == cid and c['kind'] == 'repeatable'), None)
    if not cat:
        raise LinkError('فئة صف المطابقة غير متاحة.')
    return record.get('related', {}).get(cid, [])


def row_title(schema, source, row, record=None):
    if row is None:
        return ''
    cat = next(c for c in schema['categories'] if c['id'] == source['category_id'])
    values = [F.label(f, row.get('values', {}).get(f['id'], '')) for f in cat['fields']
              if f['type'] not in {'file','spacer','field_group'} and not F.blank(row.get('values', {}).get(f['id']))][:3]
    ordinal = next((i for i,r in enumerate((record or {}).get('related',{}).get(cat['id'],[]),1) if r.get('_child_id')==row.get('_child_id')),0)
    prefix = cat['label'] + (f' · {ordinal}' if ordinal else '')
    return (prefix + (' — ' + ' · '.join(values) if values else ''))[:900]


def candidate(app, remote, record, source, sid, row=None):
    return {'source_id':source['id'], 'schema_id':sid, 'record_id':record['_record_id'],
            'record_code':record['record_code'], 'record_title':title(remote, record),
            'schema_name':source_name(app,remote,sid), 'source_updated_at':record.get('updated_at',''),
            'source_revision':revision(record),
            **({'category_id':source['category_id'], 'child_id':row['_child_id'],
                'row_title':row_title(remote,source,row,record)} if row is not None else {})}


def selected_row(remote, record, source, link):
    cid = source.get('category_id','')
    if cid != link.get('category_id',''):
        raise LinkError('فئة صف المطابقة تغيّرت؛ أعد الاختيار.')
    if not cid:
        if link.get('child_id'): raise LinkError('صف المطابقة غير مسموح.')
        return None
    row = next((r for r in source_rows(remote, record, source) if r.get('_child_id') == link.get('child_id')), None)
    if row is None:
        raise LinkError('صف المطابقة المختار غير متاح؛ أعد الاختيار.')
    return row


def candidates(app,payload):
    if not isinstance(payload,dict):raise LinkError('طلب المطابقة غير صالح.')
    schema=app.read_schema_file();cat=next((c for c in schema['categories'] if c['id']==payload.get('category_id')),None)
    if not cat or not LC.config(cat).get('enabled'):raise LinkError('ربط المعاملات غير مفعّل لهذه الفئة.')
    values=payload.get('values',{});main=payload.get('main',{})
    if not isinstance(values,dict) or not isinstance(main,dict):raise LinkError('قيم المطابقة غير صالحة.')
    import schemacraft_transaction_delivery as D
    if D.is_recipient(app,cat['id']):raise LinkError('الربط يُنشأ من الحركة المالية المصدر فقط؛ لا يلزم اختيار حركة من السجل المقصد.')
    claims=claimed_rows(app,schema)
    owner=(app.current_schema_id() or '',str(payload.get('record_code') or ''),cat['id'],str(payload.get('child_id') or ''))
    cfg=LC.config(cat);resolver=API.resolver_for(app,schema);local=scoped(schema,cat)
    search=F._text(str(payload.get('search') or '')[:200]);manual=payload.get('manual') is True
    result=[];total=0;missing=False;scanned=0
    for source in cfg['sources']:
        if payload.get('source_id') and source['id']!=payload['source_id']:continue
        sid=source['schema_id'] or app.current_schema_id() or ''
        remote,records=resolver(sid)
        for record in records:
            if record.get('archived'):continue
            for row in source_rows(remote,record,source):
                if not available_row(claims,sid,record,source,row,owner):continue
                scanned += 1
                if scanned > 100000: raise LinkError('نتائج كثيرة؛ قلّل نطاق مصادر المطابقة.')
                if manual:
                    text = title(remote,record)+' '+record['record_code']+' '+row_title(remote,source,row,record)
                    if search and search not in F._text(text):continue
                else:
                    match=True
                    for pair in source['matches']:
                        lf=pair['local_field_id']
                        if lf=='$record_code':left=payload.get('record_code','');left_field={'type':'text'}
                        else:
                            lc,left_field=local[lf];left=(main if lc['kind']=='main' else values).get(lf,'')
                        right,right_field=record_value(remote,record,pair['remote_field_id'],row)
                        if R.empty(left):missing=True;match=False;break
                        if not R.compare_values(left,right,left_field,right_field,'equals'):match=False;break
                    if not match:continue
                total+=1
                if len(result)<100: result.append(candidate(app,remote,record,source,sid,row))
    return {'items':result,'total':total,'has_more':total>len(result),'missing_match_values':missing}


def select(app,payload):
    schema=app.read_schema_file();cat=next((c for c in schema['categories'] if c['id']==payload.get('category_id')),None)
    link=read_link(payload.get('link'))
    if not cat or not LC.config(cat).get('enabled') or not link:raise LinkError('اختر سجلًا للربط.')
    source=next((s for s in LC.config(cat)['sources'] if s['id']==link['source_id']),None)
    if not source or (source['schema_id'] or app.current_schema_id() or '')!=link['schema_id']:raise LinkError('مصدر الربط غير مسموح.')
    remote,records=API.resolver_for(app,schema)(link['schema_id'])
    record=next((r for r in records if r['_record_id']==link['record_id'] and r['record_code']==link['record_code'] and not r.get('archived')),None)
    if not record:raise LinkError('السجل المختار غير متاح؛ أعد الاختيار.')
    if link.get('source_updated_at') and link['source_updated_at']!=record.get('updated_at',''):raise LinkError('تغيّر السجل المصدر؛ أعد المطابقة والاختيار.')
    if link.get('source_revision') and link['source_revision']!=revision(record):raise LinkError('تغيّر السجل المصدر؛ أعد المطابقة والاختيار.')
    link['source_revision']=revision(record)
    link['schema_name']=source_name(app,remote,link['schema_id'])
    link['source_updated_at']=record.get('updated_at','')
    link['record_title']=title(remote,record)
    import schemacraft_transaction_delivery as D
    if D.is_recipient(app,cat['id']):raise LinkError('الربط يُنشأ من الحركة المالية المصدر فقط.')
    row=selected_row(remote,record,source,link)
    owner=(app.current_schema_id() or '',str(payload.get('record_code') or ''),cat['id'],str(payload.get('child_id') or ''))
    if not available_row(claimed_rows(app,schema),link['schema_id'],record,source,row,owner):raise LinkError('هذه الحركة مرتبطة بالفعل؛ حدّث قائمة المطابقة.')
    link['row_title']=row_title(remote,source,row,record)
    return {'link':link,'values':wire_value(copy_values(app,schema,cat,remote,record,source,row))}


def apply_selected(app,schema,payload,existing=None):
    """Revalidate new links on Save; unchanged historical copies do not drift."""
    resolver=API.resolver_for(app,schema)
    claims = None
    pending_claims = {}
    for cat in schema['categories']:
        if cat['kind']!='repeatable':continue
        old={r.get('_child_id'):r for r in (existing or {}).get('related',{}).get(cat['id'],[])}
        for row in payload.get('related',{}).get(cat['id'],[]):
            if not isinstance(row,dict):continue
            link=read_link(row.get('profile_link'))
            previous=read_link(old.get(row.get('_child_id'),{}).get('profile_link'))
            if LC.owner(cat) is not None and not LC.config(cat).get('enabled') and link:
                if previous and all(link.get(k,'')==previous.get(k,'') for k in ('source_id','schema_id','record_id','record_code','child_id','category_id')):
                    # Administrator explicitly switched this source field to names-only.
                    # Keep entered/copied values; withdraw only its stored relationship.
                    row.pop('profile_link',None);continue
                raise LinkError('حقل المطابقة مضبوط لاختيار الأسماء فقط؛ لا يمكن حفظ ربط جديد.')
            if not link:
                row.pop('profile_link',None);continue
            if link.get('category_id') and link.get('child_id'):
                claim_key = (link['schema_id'],link['record_id'],link['category_id'],link['child_id'])
                owner_key = (cat['id'],row.get('_child_id'))
                prior_claim = pending_claims.setdefault(claim_key,owner_key)
                if prior_claim != owner_key:
                    raise LinkError('لا يمكن ربط الحركة نفسها بصفين في عملية حفظ واحدة.')
            # Existing relations survive configuration removal and source archiving.
            # Only explicitly reselecting refreshes copied values.
            if previous and all(link.get(k,'')==previous.get(k,'') for k in ('source_id','schema_id','record_id','record_code','source_updated_at','source_revision','category_id','child_id','row_title')):
                row['profile_link']=previous;continue
            if not LC.config(cat).get('enabled'):raise LinkError('ربط المعاملات غير مفعّل.')
            source=next((s for s in LC.config(cat)['sources'] if s['id']==link['source_id']),None)
            if not source or (source['schema_id'] or app.current_schema_id() or '')!=link['schema_id']:raise LinkError('مصدر الربط غير مسموح.')
            remote,records=resolver(link['schema_id'])
            rec=next((r for r in records if r['_record_id']==link['record_id'] and r['record_code']==link['record_code'] and not r.get('archived')),None)
            if not rec:raise LinkError('السجل المختار غير متاح؛ أعد الاختيار أو ألغِ الربط.')
            if link.get('source_updated_at') and link['source_updated_at']!=rec.get('updated_at',''):raise LinkError('تغيّر السجل المصدر؛ أعد المطابقة والاختيار.')
            if link.get('source_revision') and link['source_revision']!=revision(rec):raise LinkError('تغيّر السجل المصدر؛ أعد المطابقة والاختيار.')
            link['source_revision']=revision(rec)
            link['schema_name']=source_name(app,remote,link['schema_id'])
            link['source_updated_at']=rec.get('updated_at','')
            link['record_title']=title(remote,rec)
            import schemacraft_transaction_delivery as D
            if D.is_recipient(app,cat['id']):raise LinkError('الربط يُنشأ من الحركة المالية المصدر فقط.')
            remote_row=selected_row(remote,rec,source,link)
            owner=(app.current_schema_id() or '',str(payload.get('record_code') or ''),cat['id'],str(row.get('_child_id') or ''))
            if remote_row is not None and claims is None: claims = claimed_rows(app,schema)
            if not available_row(claims or {},link['schema_id'],rec,source,remote_row,owner):raise LinkError('هذه الحركة مرتبطة بالفعل؛ حدّث قائمة المطابقة.')
            link['row_title']=row_title(remote,source,remote_row,rec)
            row['profile_link']=link
            row.setdefault('values',{}).update(copy_values(app,schema,cat,remote,rec,source,remote_row))


def claimed_rows(app, schema):
    """An explicit row relationship claims that source row, never a person name."""
    result = {}
    resolver = API.resolver_for(app, schema)
    current = app.current_schema_id() or ''
    sids = [x['id'] for x in app.WORKSPACE_MANAGER.response().get('schemas', []) if not x.get('archived')] if app.WORKSPACE_MANAGER else [current]
    for sid in sids:
        remote, records = resolver(sid)
        for record in records:
            for cid, rows in record.get('related', {}).items():
                for row in rows:
                    link = row.get('profile_link') or {}
                    if isinstance(link, str): link = read_link(link) or {}
                    if link.get('category_id') and link.get('child_id'):
                        key = (link['schema_id'], link['record_id'], link['category_id'], link['child_id'])
                        result.setdefault(key, set()).add((sid, record['record_code'], cid, row['_child_id']))
    return result


def available_row(claims, sid, record, source, row, owner=None):
    if row is None:
        return True  # Many independent transactions may refer to the same person.
    if row.get('transaction_origin') or row.get('profile_link'):
        return False
    found = claims.get((sid, record['_record_id'], source.get('category_id', ''), row['_child_id']), set())
    return not found or owner is not None and found == {owner}
