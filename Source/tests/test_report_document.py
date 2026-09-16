import copy
import io
import tempfile
import unittest
from pathlib import Path
import schemacraft_reports as R
import schemacraft_report_document as D

def template():
    return {'title':'تقرير المدفوعات','body':'','options':{},'document':{'version':2,'datasets':{'payments':{'title':'المدفوعات','schema_id':'schema','slot':'people','scope':'card','category_id':'payments','criteria':[{'field':'month','op':'eq','value':'January'}]}},'metrics':{'total':{'title':'المجموع','dataset':'payments','field':'amount','function':'sum'},'double':{'title':'ضعف المجموع','kind':'formula','expression':'total * 2'}},'blocks':[{'id':'intro','type':'text','text':'المجموع {{total}} و {{double}}'}, {'id':'table','type':'table','title':'التفاصيل','dataset':'payments','columns':['id','card_id','amount','month'],'sum_fields':['amount']},{'id':'repeat','type':'repeat','dataset':'payments','text':'القيمة {{field:amount}}','row_title':'ملف {{id}}'}, {'id':'chart','type':'chart','title':'مقارنة','metrics':['total','double'],'chart':'bar'}]}}

def loader(d,ids,needed):
    return {'amount':'المبلغ','month':'الشهر'},[{'key':code+'/'+str(i),'id':code,'card_id':str(i),'parent_id':'','values':{'amount':v,'month':m}} for code in ids for i,v,m in [(1,100,'January'),(2,200,'February')]]

class DocumentTests(unittest.TestCase):
    def generate(self,t=None): return D.resolve_document(t or template(),{'people':['A']},loader)
    def test_row_filters_prevent_cross_card_sum_and_conditions(self):
        d=self.generate();self.assertEqual(d['document_state']['metrics']['total']['value'],100)
        self.assertEqual(len(d['document_state']['datasets']['payments']['rows']),1)
        self.assertNotIn('February',d['body']);self.assertEqual(d['charts']['chart']['series'][0]['values'],[100,200])
        t=template();t['document']['datasets']['payments']['criteria'].append({'field':'amount','op':'eq','value':'200'})
        self.assertEqual(self.generate(t)['document_state']['metrics']['total']['value'],0)
    def test_formula_graph_reused_in_text_chart_and_override(self):
        d=self.generate();baseline=copy.deepcopy(d)
        d=D.update_document(d,[{'key':'metric:total','value':150,'reason':'تصحيح للمراجعة'}])
        self.assertEqual(d['document_state']['metrics']['double']['value'],300)
        self.assertIn('150.00',d['body']);self.assertEqual(d['charts']['chart']['series'][0]['values'],[150,300])
        self.assertEqual(baseline['document_state']['sources'],d['document_state']['sources'])
        d=D.update_document(d,[{'key':'metric:total','reset':True}]);self.assertEqual(d['document_state']['metrics']['double']['value'],200)
    def test_cell_override_updates_all_consumers_and_provenance(self):
        d=D.update_document(self.generate(),[{'key':'cell:payments:A/1:amount','value':125,'reason':'تصحيح تجريبي'}])
        self.assertEqual(d['document_state']['metrics']['total']['value'],125)
        self.assertEqual(d['document_state']['metrics']['total']['sources'][0]['card_id'],'1')
        self.assertIn('125',d['body']);self.assertEqual(d['document_state']['rendered'][1]['totals']['amount'],125)
    def test_refresh_preserves_commentary_and_flags_source_conflicts(self):
        d=D.update_document(self.generate(),[{'key':'block:intro','value':'ملاحظة {{total}}','reason':'تعليق'}, {'key':'cell:payments:A/1:amount','value':125,'reason':'تصحيح'}])
        def changed(*args):
            labels,rows=loader(*args);rows[0]['values']['amount']=110;return labels,rows
        new=D.resolve_document(template(),{'people':['A']},changed,previous=d)
        self.assertIn('ملاحظة',new['body']);self.assertEqual(new['document_state']['metrics']['total']['value'],125)
        self.assertTrue(new['document_state']['conflicts']);self.assertNotEqual(d['document_state']['source_revision'],new['document_state']['source_revision'])
    def test_removed_card_override_conflict(self):
        d=D.update_document(self.generate(),[{'key':'cell:payments:A/1:amount','value':125,'reason':'تصحيح'}])
        def gone(*a): return {'amount':'amount','month':'month'},[]
        n=D.resolve_document(template(),{'people':['A']},gone,previous=d)
        self.assertTrue(n['document_state']['conflicts'][0]['missing'])
    def test_formula_cycles_code_and_invalid_numbers_rejected(self):
        for expr in ['double + 1','__import__("os")','2 ** 100000','total[0]','True + 1','"hello"']:
            t=template();t['document']['metrics']['total']={'title':'bad','kind':'formula','expression':expr}
            with self.subTest(expr=expr),self.assertRaises(R.ReportError):D.validate_document(t)
        t=template();t['document']['metrics']['double']['expression']='total / 0'
        t['document']['blocks']=t['document']['blocks'][:1]
        d=self.generate(t);self.assertIsNone(d['document_state']['metrics']['double']['value']);self.assertTrue(d['warnings'])
    def test_md_and_draft_roundtrip(self):
        t=D.validate_document(template());self.assertEqual(R.decode_template(R.encode_template(t)),t)
        with tempfile.TemporaryDirectory() as tmp:
            ts=R.TemplateStore(Path(tmp)/'t');saved=ts.save(t);self.assertEqual(ts.read(saved['id'])['document'],t['document'])
            ds=R.DraftStore(Path(tmp)/'d');draft=self.generate();saved=ds.save(draft);self.assertEqual(ds.read(saved['id'])['draft'],draft)
    def test_pdf_renders_dynamic_tables_and_page_index(self):
        import SchemaCraft as APP
        from pypdf import PdfReader
        t=template();t['document']['blocks'].insert(0,{'id':'toc','type':'toc'})
        d=self.generate(t);pdf=R.pdf_bytes(d,APP.PDF_FONT_PATH);self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertGreaterEqual(len(PdfReader(io.BytesIO(pdf)).pages),1)
    def test_invalid_override_requires_reason_and_cell_key(self):
        for change in [{'key':'metric:total','value':5,'reason':''},{'key':'missing','value':1,'reason':'test'}]:
            with self.assertRaises(R.ReportError): D.update_document(self.generate(),[change])

if __name__=='__main__': unittest.main()

class DocumentIntegrationTests(unittest.TestCase):
    from test_multischema import MultiSchemaWorkspaceTests as Fixture
    setUp=Fixture.setUp
    tearDown=Fixture.tearDown
    def test_real_card_rows_provenance_refresh_recipe_and_batch(self):
        import SchemaCraft as APP
        from test_backend import CAT_CHILDREN, FLD_CHILD_NAME, FLD_NAME
        APP.initialize_workspace();ctx=APP.require_workspace().context()
        with APP.use_context(ctx):
            loaded=APP.load_record('M0000001')
            APP.save_record({'mode':'update','record_code':'M0000001','main':loaded['main'],'related':{CAT_CHILDREN:[{'values':{FLD_CHILD_NAME:'سارة'}},{'values':{FLD_CHILD_NAME:'علي'}}]}})
        before=ctx.workbook_path.read_bytes()
        t=template();d=t['document'];d['datasets']['payments'].update(schema_id=ctx.schema_id,category_id=CAT_CHILDREN,criteria=[{'field':FLD_CHILD_NAME,'op':'eq','value':'سارة'}])
        d['metrics']={'total':{'title':'عدد الأبناء','dataset':'payments','field':FLD_CHILD_NAME,'function':'count'}}
        d['blocks']=[{'id':'table','type':'table','dataset':'payments','columns':['id','card_id',FLD_NAME,FLD_CHILD_NAME]}, {'id':'repeated','type':'repeat','dataset':'payments','text':'{{field:'+FLD_CHILD_NAME+'}}'}]
        self.assertTrue(APP.report_api({'action':'document_validate','template':t})['ok'])
        saved=APP.report_api({'action':'save','template':t})['template']
        result=APP.report_api({'action':'document_generate','template':saved,'bindings':{'people':['M0000001']}})['draft']
        self.assertEqual(result['document_state']['metrics']['total']['value'],1)
        row=result['document_state']['datasets']['payments']['rows'][0]
        self.assertTrue(row['key'].startswith('M0000001/'));self.assertEqual(row['values'][FLD_NAME],'طالب أول')
        recipe=APP.report_api({'action':'recipe_save','title':'الوصفة','template':t,'bindings':{'people':['M0000001']}})['saved']
        self.assertTrue(APP.report_api({'action':'recipe_read','id':recipe['id']})['saved']['draft']['recipe'])
        name,content,count,schemas=APP.create_advanced_report_batch({'drafts':[result,result]})
        import zipfile
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            self.assertEqual(len(z.namelist()),2);self.assertTrue(all(z.read(n).startswith(b'%PDF') for n in z.namelist()))
        self.assertEqual(before,ctx.workbook_path.read_bytes())
        bad=copy.deepcopy(t);bad['document']['datasets']['payments']['scope']='profile'
        with self.assertRaises(APP.ApplicationError):APP.report_api({'action':'document_validate','template':bad})
