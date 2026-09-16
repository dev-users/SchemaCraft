import copy
import io
import tempfile
import unittest
from pathlib import Path
import schemacraft_reports as R
import SchemaCraft as APP
import test_multischema as fixtures
from test_backend import FLD_NAME
from test_advanced_reports import template,loader

class ReportV2Tests(unittest.TestCase):
    def test_additional_calculations_and_number_formatting(self):
        for fn,result in [('median','20.00 kg'),('distinct_count','3.00 kg'),('profile_count','2.00 kg')]:
            t=template(fn=fn);t['placeholders']['value'].update(decimals=2,suffix=' kg')
            self.assertTrue(R.resolve_report(t,{'people':['A','B']},loader)['body'].endswith(result))
    def test_grouped_summaries_and_top_results_preserve_pairs(self):
        t=template('chart');t['placeholders']['value'].update(mode='grouped',group_field='status',reducer='average',sort='desc',top_n=1)
        d=R.resolve_report(t,{'people':['A','B']},loader);chart=d['charts']['value']
        self.assertEqual(chart['labels'],['no']);self.assertEqual(chart['series'][0]['values'],[30]);self.assertTrue(chart['note']);self.assertTrue(d['warnings'])
        t['placeholders']['value']['top_n']=2
        c=R.resolve_report(t,{'people':['A','B']},loader)['charts']['value']
        self.assertEqual(c['series'][0]['values'],[30,15])
    def test_ambiguous_repeated_group_rejected(self):
        t=template('chart');t['placeholders']['value'].update(mode='grouped',group_field='score')
        with self.assertRaisesRegex(R.ReportError,'العد المزدوج'):R.resolve_report(t,{'people':['A']},loader)
    def test_or_conditions_and_empty_conditions(self):
        t=template();t['placeholders']['value'].update(condition_mode='any',criteria=[{'field':'status','op':'eq','value':'yes'},{'field':'score','op':'eq','value':'30'}])
        self.assertTrue(R.resolve_report(t,{'people':['A','B']},loader)['body'].endswith('60'))
        t['placeholders']['value']['criteria']=[]
        self.assertTrue(R.resolve_report(t,{'people':['A','B']},loader)['body'].endswith('60'))
    def test_drafts_survive_reopen_and_reject_stale_writes_deletes(self):
        d=R.resolve_report(template('chart'),{'people':['A','B']},loader)
        with tempfile.TemporaryDirectory() as folder:
            store=R.DraftStore(folder);saved=store.save(d);other=R.DraftStore(folder)
            self.assertEqual(other.read(saved['id'])['draft'],d)
            d['title']='Manual edit';updated=other.save(d,saved['id'],saved['revision'])
            with self.assertRaises(R.ReportError):store.save(d,saved['id'],saved['revision'])
            with self.assertRaises(R.ReportError):store.delete(saved['id'],saved['revision'])
            self.assertEqual(store.list()[0]['title'],'Manual edit');store.delete(updated['id'],updated['revision']);self.assertEqual(store.list(),[])
    def test_template_options_roundtrip_and_pdf_landscape(self):
        from pypdf import PdfReader
        t=template();t['options']={'orientation':'landscape','font_size':14,'header':'مؤسسة الاختبار','footer':'نسخة مراجعة','accent':'teal'}
        self.assertEqual(R.decode_template(R.encode_template(t))['options'],t['options'])
        d=R.resolve_report(t,{'people':['A']},loader);pdf=R.pdf_bytes(d,APP.PDF_FONT_PATH)
        page=PdfReader(io.BytesIO(pdf)).pages[0];self.assertGreater(page.mediabox.width,page.mediabox.height)
        for opt in [{'font_size':True},{'orientation':'bad'},{'header':'x\ny'}]:
            with self.assertRaises(R.ReportError):R.validate_options(opt)

class ReportV2IntegrationTests(unittest.TestCase):
    setUp=fixtures.MultiSchemaWorkspaceTests.setUp
    tearDown=fixtures.MultiSchemaWorkspaceTests.tearDown
    def test_picker_drafts_and_exact_pdf_preview_do_not_modify_records(self):
        APP.initialize_workspace();manager=APP.require_workspace();context=manager.context();before=context.workbook_path.read_bytes()
        result=APP.report_api({'action':'profiles','schema_ids':[context.schema_id],'query':'طالب','offset':0})
        self.assertEqual([p['id'] for p in result['profiles']],['M0000001'])
        self.assertEqual(APP.report_api({'action':'profiles','schema_ids':[context.schema_id],'query':'missing'})['total'],0)
        t=template('field');t['placeholders']['value'].update(schema_id=context.schema_id,fields=[FLD_NAME])
        self.assertTrue(APP.report_api({'action':'validate','template':t})['ok'])
        saved=APP.report_api({'action':'save','template':t})['template']
        draft=APP.report_api({'action':'generate','id':saved['id'],'bindings':{'people':['M0000001']}})['draft']
        preview=APP.report_api({'action':'pdf_preview','draft':draft})
        self.assertTrue(preview['pdf'].startswith('JVBER'))
        saved=APP.report_api({'action':'draft_save','draft':draft})['saved']
        restored=APP.report_api({'action':'draft_read','id':saved['id']})['saved'];self.assertEqual(restored['draft'],draft)
        self.assertEqual(before,context.workbook_path.read_bytes())
        with self.assertRaises(APP.ApplicationError):APP.report_api({'action':'profiles','schema_ids':[context.schema_id],'offset':True})
