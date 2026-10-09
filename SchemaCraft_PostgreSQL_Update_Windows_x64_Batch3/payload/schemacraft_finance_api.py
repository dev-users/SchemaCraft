"""Integration for schema-native derived fields and virtual view categories."""
from __future__ import annotations
import schemacraft_link_config as LC
import copy
import json
import schemacraft_finance as F
from contextvars import ContextVar
TRANSACTION_SNAPSHOTS = ContextVar("sc_transaction_snapshots", default={})


def definitions(app, *, annotate=True):
    result={}
    manager=app.WORKSPACE_MANAGER
    if manager is None:
        s=app.read_schema_file();result[app.current_schema_id() or '']={'schema':s,'name':s.get('app',{}).get('title','')}
    else:
        for item in manager.response().get('schemas',[]):
            if item.get('archived'):continue
            with app.use_context(manager.context(item['id'])):
                s=app.read_schema_file()
            result[item['id']]={'schema':s,'name':item['name']}
    if annotate:
        import schemacraft_transaction_delivery as D
        incoming = D.bindings(result)
        for sid, item in result.items():
            item['destination_bindings'] = {cid: sources for (dsid,cid),sources in incoming.items() if dsid==sid}
    return result


def remote_schema_map(app, schema):
    wanted=set()
    def visit(obj):
        if isinstance(obj,list):
            for x in obj:visit(x)
        elif isinstance(obj,dict):
            if obj.get('schema_id'):wanted.add(str(obj['schema_id']))
            for x in obj.values():visit(x)
    for cat in schema.get('categories',[]):
        visit(cat.get('view_table'))
        visit(LC.config(cat))
        for field in cat.get('fields',[]):
            visit(field.get('financial'))
            visit(field.get('record_options'))
    current=app.current_schema_id();result={}
    for sid in wanted:
        if sid==current:continue
        if app.WORKSPACE_MANAGER is None:raise F.FinanceError('التصميم المصدر غير متاح.')
        try:
            context=app.WORKSPACE_MANAGER.context(sid)
            if context.archived:raise F.FinanceError('التصميم المصدر مؤرشف.')
            # Schema validation itself never walks remote schemas.
            with app.use_context(context):result[sid]=app.read_schema_file()
        except app.WorkspaceError as exc:raise F.FinanceError('التصميم المصدر غير متاح.') from exc
    return result


def resolver_for(app,schema,records=None):
    current=app.current_schema_id() or ''
    cache={}
    def resolve(sid):
        sid=sid or current
        if sid in TRANSACTION_SNAPSHOTS.get():return TRANSACTION_SNAPSHOTS.get()[sid]
        if sid in cache:return cache[sid]
        if sid==current:
            with app.WORKBOOK_LOCK:
                rows=records if records is not None else list(app._dataset_snapshot_unlocked(schema).records)
            result=(schema,rows)
        else:
            if app.WORKSPACE_MANAGER is None:raise F.FinanceError('التصميم المصدر غير متاح.')
            try:ctx=app.WORKSPACE_MANAGER.context(sid)
            except app.WorkspaceError as exc:raise F.FinanceError('التصميم المصدر غير متاح.') from exc
            if ctx.archived:raise F.FinanceError('التصميم المصدر مؤرشف.')
            with app.use_context(ctx),app.WORKBOOK_LOCK:
                remote=app.read_schema_file();rows=list(app._dataset_snapshot_unlocked(remote).records)
            result=(remote,rows)
        cache[sid]=result
        return result
    return resolve


def recompute(app,schema,record,*,strict=True,records=None):
    if not F.enabled(schema):return [],None
    sid=app.current_schema_id() or ''
    engine=F.Engine(schema,record,sid,resolver_for(app,schema,records))
    errors=engine.recompute(strict)
    # A text-composition may display a calculated numeric value.
    app._recompute_composed_values(schema,record.setdefault('values',{}),record.setdefault('related',{}),record)
    return errors,engine


def preview(app,payload):
    if not isinstance(payload,dict):raise F.FinanceError('بيانات المعاينة غير صالحة.')
    schema=app.read_schema_file()
    main=payload.get('main',{})
    related=payload.get('related',{})
    if not isinstance(main,dict) or not isinstance(related,dict):raise F.FinanceError('بيانات المعاينة غير صالحة.')
    count=0
    for rows in related.values():
        if not isinstance(rows,list):raise F.FinanceError('قائمة البطاقات غير صالحة.')
        count+=len(rows)
        if any(not isinstance(r,dict) or not isinstance(r.get('values',{}),dict) for r in rows):raise F.FinanceError('بيانات صف الجدول غير صالحة.')
    if count>F.MAX_ROWS:raise F.FinanceError('عدد صفوف المعاينة يتجاوز الحد المسموح.')
    record={'record_code':str(payload.get('record_code') or ''),'values':copy.deepcopy(main),'related':copy.deepcopy(related)}
    # Keep identity/provenance authoritative even for an unsaved financial preview.
    # A client cannot forge an origin to hide an amount by duplicate suppression.
    with app.WORKBOOK_LOCK:
        saved = next((r for r in app._dataset_snapshot_unlocked(schema).records if r.get('record_code') == record['record_code']), None)
    if saved:
        for k in ('_record_id','created_at','updated_at'):
            if k in saved: record[k] = saved[k]
    for cid, rows in record['related'].items():
        previous = {r['_child_id']:r for r in (saved or {}).get('related',{}).get(cid,[])}
        for row in rows:
            row.pop('transaction_origin', None)
            origin = previous.get(row.get('_child_id'),{}).get('transaction_origin')
            if origin: row['transaction_origin'] = copy.deepcopy(origin)
    errors,engine=recompute(app,schema,record,strict=False)
    views=[]
    if engine:
        requested=payload.get('view_filters',{})
        if not isinstance(requested,dict):raise F.FinanceError('مرشحات العرض غير صالحة.')
        for category in schema['categories']:
            if category.get('view_table'):
                try:
                    base = engine.view(category['id'])
                    data = engine.view(category['id'], requested.get(category['id'])) if requested.get(category['id']) else base
                    options = {}
                    for col in base['columns']:
                        choices = {}
                        for row in base['rows']:
                            value = row['values'].get(col['id'], '')
                            choices[json.dumps(value, sort_keys=True, ensure_ascii=False)] = {'value': value, 'label': row['display'].get(col['id']) or 'فارغ'}
                        options[col['id']] = list(choices.values())
                    data.update(options=options, base_count=base['count'])
                    views.append(data)
                except F.FinanceError as exc:views.append({'category_id':category['id'],'label':category['label'],'error':str(exc),'rows':[],'columns':[],'totals':[]})
    derived={fid for fid,(c,f) in F.fields(schema).items() if f.get('financial') or f.get('composition')}
    return {'main':{k:v for k,v in record['values'].items() if k in derived},'related':{cid:[{'_child_id':r.get('_child_id',''),'values':{k:v for k,v in r.get('values',{}).items() if k in derived}} for r in rows] for cid,rows in record['related'].items()},'views':views,'errors':errors}


def snapshot(app, schema, *, strict=False):
    """Fresh derived values for read-only consumers; never publish into the live cache."""
    base=app._dataset_snapshot_unlocked(schema)
    if not F.enabled(schema):return base
    original=copy.deepcopy(list(base.records));result=copy.deepcopy(original)
    for record in result:
        try:errors,_=recompute(app,schema,record,strict=strict,records=original)
        except F.FinanceError as exc:raise app.ApplicationError(str(exc)) from exc
        if errors:record['_finance_errors']=errors
    return app._build_dataset_snapshot(schema,result)
