import copy
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import schemacraft_reports as R
import SchemaCraft as APP
import test_multischema as fixtures
from test_backend import FLD_NAME

ROOT=Path(__file__).resolve().parents[1]

def template(kind='aggregate', fn='sum'):
    return {'title':'تقرير الاختبار','body':'# تقرير\n{{date}}\n{{toc}}\n## النتائج\n{{value}}',
            'placeholders':{'value':{'type':kind,'schema_id':'schema','slot':'people','fields':['score'],'function':fn,'chart':'bar'}}}

def loader(schema,ids):
    return {'score':'الدرجة','status':'الحالة'},[{'id':i,'values':{'score':{'A':['10','20'],'B':['30'],'C':[]}[i],'status':['yes' if i=='A' else 'no']}} for i in ids]

class ReportTests(unittest.TestCase):
    def test_markdown_roundtrip_and_optimistic_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            store=R.TemplateStore(folder);t=store.save(template());self.assertEqual(len(list(Path(folder).glob('*.md'))),1)
            self.assertEqual(R.decode_template(R.encode_template(t))['body'],t['body'])
            t2=copy.deepcopy(t);t2['body']+='\ntext';store.save(t2,t['id'],t['revision'])
            with self.assertRaises(R.ReportError):store.save(t,t['id'],t['revision'])
            with self.assertRaises(R.ReportError):store.delete(t['id'],t['revision'])
            with self.assertRaises(R.ReportError):store.read('../escape')
    def test_aggregation_and_repeated_values(self):
        for fn,expected in [('sum','60'),('average','20'),('count','3'),('min','10'),('max','30')]:
            self.assertTrue(R.resolve_report(template(fn=fn),{'people':['A','B','A']},loader)['body'].endswith(expected))
    def test_all_criteria_select_profiles(self):
        t=template(fn='sumifs');t['placeholders']['value']['criteria']=[{'field':'status','op':'eq','value':'yes'},{'field':'score','op':'gt','value':15}]
        self.assertTrue(R.resolve_report(t,{'people':['A','B']},loader)['body'].endswith('30'))
    def test_distribution_chart_counts_text_and_blank_numeric_criterion_errors(self):
        t=template('chart');t['placeholders']['value'].update(mode='distribution',fields=['status'])
        d=R.resolve_report(t,{'people':['A','B','C']},loader)
        self.assertEqual(d['charts']['value']['labels'],['yes','no'])
        self.assertEqual(d['charts']['value']['series'][0]['values'],[1,2])
        t['placeholders']['value']['criteria']=[{'field':'score','op':'gt','value':''}]
        with self.assertRaises(R.ReportError):R.validate_template(t)

    def test_empty_average_is_not_zero_and_invalid_number_rejected(self):
        d=R.resolve_report(template(fn='average'),{'people':['C']},loader);self.assertTrue(d['warnings']);self.assertTrue(d['body'].endswith('—'))
        with self.assertRaises(R.ReportError):R.numbers(['oops'])
        with self.assertRaises(R.ReportError):R.numbers(['NaN'])
        self.assertEqual(R.numbers(['١٢٫٥']),[12.5])
    def test_single_field_requires_one_id_and_missing_field_errors(self):
        with self.assertRaises(R.ReportError):R.resolve_report(template('field'),{'people':['A','B']},loader)
        t=template();t['placeholders']['value']['fields']=['removed']
        with self.assertRaises(R.ReportError):R.resolve_report(t,{'people':['A']},loader)
    def test_unknown_token_and_bad_nested_payloads(self):
        t=template();t['body']='{{missing}}'
        with self.assertRaises(R.ReportError):R.validate_template(t)
        for value in [None,[],{'title':'x','body':'x','placeholders':{'x':None}}]:
            with self.assertRaises(R.ReportError):R.validate_template(value)
        with self.assertRaises(R.ReportError):R.decode_template('<!-- SchemaCraftReport [] -->\n')
    def test_chart_and_manual_draft_export(self):
        from pypdf import PdfReader
        for chart in ['bar','pie','line']:
            t=template('chart');t['placeholders']['value']['chart']=chart
            d=R.resolve_report(t,{'people':['A','B']},loader)
            self.assertEqual(d['charts']['value']['series'][0]['values'],[30,30])
            d['charts']['value']['series'][0]['values'][0]=42
            d['body']+='\n**Bold text** و **نص بارز**\n## مراجعة يدوية\nنص عربي تم تعديله.\n| اسم | قيمة |\n| --- | --- |\n| مثال | 12 |\n{{pagebreak}}\n# النهاية'
            data=R.pdf_bytes(d,APP.PDF_FONT_PATH)
            self.assertGreaterEqual(len(PdfReader(io.BytesIO(data)).pages),2)
    def test_invalid_draft_chart_cannot_export(self):
        d=R.resolve_report(template('chart'),{'people':['A']},loader)
        d['charts']['value']['series'][0]['values']=[float('inf')]
        with self.assertRaises(R.ReportError):R.pdf_bytes(d,APP.PDF_FONT_PATH)
    def test_installer_stages_and_eta(self):
        spec=importlib.util.spec_from_file_location('builder',ROOT/'build-windows-gui.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        now=[0];p=m.BuildProgress([1]*6,clock=lambda:now[0]);self.assertIsNone(p.snapshot()[2])
        p.feed('[1/6] Start');now[0]=.5;self.assertGreater(p.snapshot()[0],0)
        p.feed('[5/6] Build');now[0]=30;self.assertLess(p.snapshot()[0],100);self.assertIsNone(p.snapshot()[2])
        p.feed('[2/6] stale');self.assertEqual(p.stage,4)
        p.feed('[6/6] Package');p.complete();self.assertEqual(p.snapshot()[0],100)

class ReportIntegrationTests(unittest.TestCase):
    setUp=fixtures.MultiSchemaWorkspaceTests.setUp
    tearDown=fixtures.MultiSchemaWorkspaceTests.tearDown
    def test_template_generate_and_save_pdf_preserves_record_bytes(self):
        APP.initialize_workspace();manager=APP.require_workspace();context=manager.context();before=context.workbook_path.read_bytes()
        catalog=APP.report_api({'action':'catalog'})['schemas'];self.assertTrue(catalog)
        t=template('field');t['placeholders']['value'].update(schema_id=context.schema_id,fields=[FLD_NAME])
        saved=APP.report_api({'action':'save','template':t})['template']
        d=APP.report_api({'action':'generate','id':saved['id'],'bindings':{'people':['M0000001']}})['draft']
        self.assertIn('طالب أول',d['body']);d['body']+='\nManual edit'
        self.assertTrue(APP.create_advanced_report_export({'draft':d})[1].startswith(b'%PDF'))
        destination=self.root/'advanced-report.pdf'
        result=APP.save_export({'type':'advanced_report','draft':d,'destination':str(destination)})
        self.assertTrue(result['ok']);self.assertTrue(destination.read_bytes().startswith(b'%PDF'))
        old=destination.read_bytes()
        with self.assertRaises(APP.ApplicationError):APP.save_export({'type':'advanced_report','draft':{'title':'broken','body':'{{chart:missing}}'},'destination':str(destination)})
        self.assertEqual(old,destination.read_bytes())
        self.assertEqual(before,context.workbook_path.read_bytes())
        with self.assertRaises(APP.ApplicationError):APP.report_api({'action':'generate','id':saved['id'],'bindings':{'people':['M0000099']}})
        with mock.patch.object(APP,'require_builder_access',side_effect=APP.ApplicationError('locked')):
            with self.assertRaises(APP.ApplicationError):APP.report_api({'action':'list'})
