"""Workspace adapter for structured reports; called behind export authorization."""
import copy
from schemacraft_reports import ReportError, DraftStore
from schemacraft_report_document import validate_document, required_fields, resolve_document, recompute_document, update_document

def handle(app,manager,payload):
    action=payload.get('action')
    recipes=DraftStore(manager.data_dir/'report-recipes')
    if action=='recipe_list': return {'recipes':recipes.list()}
    if action=='recipe_read': return {'saved':recipes.read(payload.get('id'))}
    if action=='recipe_delete':
        recipes.delete(payload.get('id'),payload.get('revision'));return {'ok':True}
    if action=='recipe_save':
        template=validate_document(payload.get('template'));bindings=payload.get('bindings')
        if not isinstance(bindings,dict): raise ReportError('اختيارات الوصفة غير صالحة.')
        title=payload.get('title')
        return {'saved':recipes.save({'title':title,'body':'','charts':{},'recipe':{'template':template,'bindings':bindings}},payload.get('id'),payload.get('revision'))}
    if action=='document_edit': return {'draft':update_document(payload.get('draft'),payload.get('changes'))}
    if action=='document_recompute': return {'draft':recompute_document(payload.get('draft'))}
    if action not in {'document_generate','document_refresh','document_validate'}: raise ReportError('إجراء المستند غير صالح.')
    previous=payload.get('draft') if action=='document_refresh' else None
    if previous:
        previous=recompute_document(previous);template=previous['document_state']['template'];bindings=previous['document_state']['bindings']
    else: template=validate_document(payload.get('template'));bindings=payload.get('bindings',{})
    def load(d,ids,needed):
        with app.use_context(manager.context(d['schema_id'])):
            schema=app.read_schema_file();categories={c['id']:c for c in schema.get('categories',[])}
            category=categories.get(d.get('category_id')) if d.get('scope')=='card' else None
            if d.get('scope')=='card' and (not category or category['kind']=='main'): raise ReportError('الفئة المتكررة غير موجودة.')
            fields={f['id']:f for c in categories.values() for f in c.get('fields',[]) if f['type']!='file' and f['type'] not in app.SYSTEM_FIELD_TYPES and (c['kind']=='main' or c is category)}
            if needed-fields.keys(): raise ReportError('حقول غير موجودة في نطاق البيانات: '+', '.join(sorted(needed-fields.keys())))
            labels={f['id']:f['label'] for f in fields.values()}
            if action=='document_validate': return labels,[]
            snapshot=app._dataset_snapshot_unlocked(schema);rows=[]
            # Keep raw scalar numeric values, and format dates/lists for display.
            def values(raw):
                result={}
                for fid in needed:
                    field=fields[fid];value=raw.get(fid,'')
                    result[fid]=app.field_display_value(field,value) if field['type'] not in {'number','integer','decimal'} else value
                    if not isinstance(result[fid],(str,int,float)) or isinstance(result[fid],bool): result[fid]=str(result[fid] or '')
                return result
            if ids is None:
                ids=[code for code,record in snapshot.records_by_code.items() if d.get('include_archived') or not record.get('archived')]
                if len(ids)>5000: raise ReportError('المصدر يتجاوز 5000 ملف؛ استخدم مجموعة IDs محددة أو قسّم التقرير.')
            for code in ids:
                app.validate_person_code(code);record=snapshot.records_by_code.get(code)
                if record is None: raise ReportError('لم يُعثر على ID '+code)
                if category:
                    for card in record.get('related',{}).get(category['id'],[]):
                        card_key=str(card.get('_child_id') or card.get('minor_id'))
                        rows.append({'key':code+'/'+card_key,'id':code,'card_id':str(card.get('minor_id','')),'parent_id':str(card.get('parent_child_id','')),'values':values({**record.get('values',{}),**card.get('values',{})})})
                else: rows.append({'key':code,'id':code,'card_id':'','parent_id':'','values':values(record.get('values',{}))})
            return labels,rows
    with app.WORKBOOK_LOCK:
        if action=='document_validate':
            for name,d in template['document']['datasets'].items(): load(d,[],required_fields(template,name))
            return {'ok':True}
        draft=resolve_document(template,bindings,load,previous)
    if previous:
        draft['title']=previous['title'];draft['options']=copy.deepcopy(previous['options'])
    return {'draft':draft}
