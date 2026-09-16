import re
import unittest

import SchemaCraft as APP
from schemacraft_advanced import profile_pdf_bytes, readonly_pdf_grid, _pdf_visual_line


class ReadonlyExportTests(unittest.TestCase):
    def test_sections_preserve_readonly_fields_widths_and_empty_rules(self):
        fields = [
            {'id':'f1','label':'Number','type':'number','width':'2'},
            {'id':'f2','label':'Check','type':'checkbox','width':'1'},
            {'id':'f3','label':'Attachment','type':'file','width':'3'},
            {'id':'blank','label':'Blank','type':'text','width':'1'},
            {'id':'gap','label':'','type':'spacer','width':'1'},
            {'id':'sys','label':'ID','type':'system_record_code','width':'1'},
        ]
        schema = {'categories':[{'id':'main','label':'Main','kind':'main','fields':fields},
            {'id':'repeat','label':'Repeated','kind':'repeatable','card_name_prefix':'Card','fields':[{'id':'rf','label':'Text','type':'text','width':'full'}]}], 'conditions':[]}
        record = {'record_code':'A1234567', 'values':{'f1':0,'f2':False,'f3':'attachments/photo.jpeg','blank':'  ','gap':'bad','sys':'A1234567'},
            'related':{'repeat':[{'values':{'rf':''}}, {'values':{'rf':'first\nsecond'}}]}}
        sections = APP._record_report_sections(schema, record, set(), set())
        self.assertEqual([(f['value'],f['width']) for f in sections[0]['cards'][0]['fields']], [('0','2'),('لا','1'),('photo.jpeg','3')])
        self.assertEqual(sections[1]['cards'][0]['title'],'Card 1')
        self.assertEqual(sections[1]['cards'][0]['fields'][0]['value'],'first\nsecond')
        selected = APP._record_report_sections(schema, record, {'f3'}, set())
        self.assertEqual(len(selected),1)
        self.assertEqual([f['field_id'] for f in selected[0]['cards'][0]['fields']],['f3'])

    def test_arabic_filenames_preserve_latin_extensions_and_ids(self):
        visual = _pdf_visual_line('مرفق-A1234567.jpeg')
        self.assertIn('A1234567.jpeg', visual)
        self.assertNotIn('gepj', visual)

    def test_grid_preserves_rtl_order_without_backfilling(self):
        fields = [{'width':w,'label':str(i)} for i,w in enumerate(['4','3','1','full','2'])]
        rows = readonly_pdf_grid(fields)
        self.assertEqual([[(col,span,item['label']) for col,span,item in row] for row in rows],
            [[(2,4,'0')],[(3,3,'1'),(2,1,'2')],[(0,6,'3')],[(4,2,'4')]])

    def test_long_full_width_value_paginates_without_giant_empty_rows(self):
        value = 'دراسة علمية وعملية في برمجة الحاسوب وأنظمة الذكاء الاصطناعي. ' * 120
        pdf = profile_pdf_bytes('Test', [{'title':'سجل A1234567','sections':[{'label':'الفئة','kind':'repeatable','cards':[{'title':'البطاقة 1','fields':[{'label':'ملاحظات','width':'full','value':value}]}]}]}], APP.PDF_FONT_PATH)
        self.assertTrue(pdf.startswith(b'%PDF-'))
        count = len(re.findall(rb'/Type\s*/Page\b',pdf))
        self.assertGreater(count,1)
        self.assertLessEqual(count,4)
