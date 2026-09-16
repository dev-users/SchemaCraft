"""Mixed inline values, conditional aggregates, and all-profile report sources."""
import copy
import unittest
import schemacraft_report_document as D
import schemacraft_reports as R


def template():
    return {'title':'تقرير مختلط','options':{},'document':{'version':2,'datasets':{
        'person':{'title':'المستفيد','schema_id':'s','slot':'person','scope':'profile'},
        'cards':{'title':'الطلبات','schema_id':'s','slot':'people','scope':'card','category_id':'cards'}},
        'metrics':{'total':{'title':'عدد الملفات','dataset':'cards','function':'profile_count','decimals':0},
                   'active':{'title':'نشط','dataset':'cards','function':'profile_count','decimals':0,'criteria':[{'field':'status','op':'eq','value':'active'}]},
                   'share':{'title':'النسبة','kind':'formula','expression':'active / total * 100','suffix':'%'}},
        'blocks':[{'id':'sentence','type':'text','text':'المستفيد {{value:person:name}} ورقمه {{value:person:id}}: {{active}} من {{total}} بنسبة {{share}}.'}]}}


def loader(d,ids,needed):
    if d['scope']=='profile':
        return {'name':'الاسم'},[{'key':i,'id':i,'values':{'name':'سارة'}} for i in ids]
    raw=[('A','1',0,'active'),('A','2',10,'active'),('A','3',20,'inactive'),('B','1','', 'inactive'),('C','1',None,'active')]
    return {'amount':'القيمة','status':'الحالة'},[{'key':i+'/'+c,'id':i,'card_id':c,'parent_id':'','values':{'amount':a,'status':s}} for i,c,a,s in raw if ids is None or i in ids]


class InlineReportTests(unittest.TestCase):
    def generate(self,t=None): return D.resolve_document(t or template(),{'person':['A'],'people':['A','B','C']},loader)

    def test_inline_sentence_is_single_paragraph_and_has_provenance(self):
        t=template();d=self.generate(t)
        self.assertEqual(d['body'],'المستفيد سارة ورقمه A: 2 من 3 بنسبة 66.67%.')
        refs=d['document_state']['rendered'][0]['inline_sources']
        self.assertEqual(refs[0]['cell_key'],'cell:person:A:name')
        self.assertEqual(refs[1]['field'],'id')
        self.assertEqual(D.required_fields(D.validate_document(t),'person'),{'name'})
        self.assertIn('status',D.required_fields(D.validate_document(t),'cards'))
        self.assertEqual(R.decode_template(R.encode_template(D.validate_document(t)))['document'],t['document'])

    def test_inline_ambiguity_and_invalid_sources_are_actionable(self):
        with self.assertRaisesRegex(R.ReportError,'صفًا واحدًا'):
            D.resolve_document(template(),{'person':['A','B'],'people':['A']},loader)
        for token in ['value:missing:name','value:person','value:person:']:
            t=template();t['document']['blocks'][0]['text']='{{'+token+'}}'
            with self.subTest(token=token),self.assertRaises(R.ReportError): D.validate_document(t)
        def empty(d,ids,needed): return ({'name':'الاسم'},[]) if d['scope']=='profile' else loader(d,ids,needed)
        with self.assertRaisesRegex(R.ReportError,'0 صفوف'):D.resolve_document(template(),{'person':['A'],'people':['A']},empty)

    def test_profile_count_deduplicates_contributing_references(self):
        d=self.generate()['document_state']['metrics']
        self.assertEqual(d['active']['value'],2)
        self.assertEqual(d['active']['matched_rows'],3)
        self.assertEqual({r['id'] for r in d['active']['sources']},{'A','C'})
        self.assertEqual(len(d['active']['sources']),2)
        self.assertEqual(d['total']['value'],3)

    def test_counts_empties_zero_and_own_conditions(self):
        t=template();metrics=t['document']['metrics']
        for fn in ['row_count','empty_count','count','distinct_count','sum','average']:
            metrics[fn]={'title':fn,'dataset':'cards','field':'amount','function':fn}
        metrics['sum']['criteria']=[{'field':'status','op':'eq','value':'active'}]
        d=self.generate(t)['document_state']['metrics']
        for fn,value in {'row_count':5,'empty_count':2,'count':3,'distinct_count':3,'sum':10,'average':10}.items():self.assertEqual(d[fn]['value'],value)
        self.assertEqual(d['count']['sources'][0]['value'],0)
        self.assertEqual(len(d['empty_count']['sources']),2)

    def test_all_any_same_card_and_blank_conditions(self):
        t=template();m=t['document']['metrics']['active'];m['criteria']=[{'field':'status','op':'eq','value':'active'},{'field':'amount','op':'eq','value':'20'}]
        self.assertEqual(self.generate(t)['document_state']['metrics']['active']['value'],0)
        m['condition_mode']='any';self.assertEqual(self.generate(t)['document_state']['metrics']['active']['value'],2)
        m['criteria']=[{'field':'amount','op':'empty'}];self.assertEqual(self.generate(t)['document_state']['metrics']['active']['value'],2)
        m['criteria']=[{'field':'amount','op':'not_empty'}];self.assertEqual(self.generate(t)['document_state']['metrics']['active']['value'],1)
        m['criteria']=[{'field':'amount','op':'gt','value':'abc'}]
        with self.assertRaises(R.ReportError):D.validate_document(t)

    def test_inline_cell_override_and_refresh_are_connected(self):
        d=D.update_document(self.generate(),[{'key':'cell:person:A:name','value':'علي','reason':'تصحيح العرض'}])
        self.assertIn('علي',d['body']);self.assertEqual(d['document_state']['rendered'][0]['inline_sources'][0]['value'],'علي')
        def changed(source,ids,needed):
            labels,rows=loader(source,ids,needed)
            if source['scope']=='profile': rows[0]['values']['name']='حسن'
            return labels,rows
        newer=D.resolve_document(template(),{'person':['A'],'people':['A','B','C']},changed,previous=d)
        self.assertIn('علي',newer['body']);self.assertEqual(newer['document_state']['conflicts'][0]['key'],'cell:person:A:name')

    def test_all_selection_uses_live_source_and_no_binding(self):
        t=template();t['document']['datasets']['cards']['selection']='all'
        d=D.resolve_document(t,{'person':['A']},loader)
        self.assertEqual(d['document_state']['metrics']['total']['value'],3)


class AllProfilesIntegrationTests(unittest.TestCase):
    from test_multischema import MultiSchemaWorkspaceTests as Fixture
    setUp=Fixture.setUp
    tearDown=Fixture.tearDown
    def test_all_profiles_archive_and_current_source(self):
        import SchemaCraft as APP
        APP.initialize_workspace();ctx=APP.require_workspace().context()
        t={'title':'كل الملفات','options':{},'document':{'version':2,'datasets':{'people':{'title':'الملفات','schema_id':ctx.schema_id,'scope':'profile','slot':'all','selection':'all'}},'metrics':{'n':{'title':'عدد الملفات','dataset':'people','function':'profile_count'}},'blocks':[{'id':'n','type':'metric','metric':'n'}]}}
        with APP.use_context(ctx):
            records=APP._dataset_snapshot_unlocked(APP.read_schema_file()).records_by_code
            expected=sum(not r.get('archived') for r in records.values())
        d=APP.report_api({'action':'document_generate','template':t,'bindings':{}})['draft']
        self.assertEqual(d['document_state']['metrics']['n']['value'],expected)
        self.assertEqual(d['record_count'],expected)
        with APP.use_context(ctx): APP.archive_record('M0000001',True)
        refreshed=APP.report_api({'action':'document_refresh','draft':d})['draft']
        self.assertEqual(refreshed['document_state']['metrics']['n']['value'],expected-1)
        t['document']['datasets']['people']['include_archived']=True
        all_rows=APP.report_api({'action':'document_generate','template':t,'bindings':{}})['draft']
        self.assertEqual(all_rows['document_state']['metrics']['n']['value'],len(records))
