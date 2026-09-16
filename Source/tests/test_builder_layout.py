"""Persisted placement, conditional layout and Boolean display regressions."""
import copy
import unittest
import SchemaCraft as APP
from schemacraft_advanced import readonly_pdf_grid
from test_backend import configured_schema, FLD_NAME, FLD_FATHER, FLD_VERIFIED, CAT_IDENTITY

class BuilderLayoutTests(unittest.TestCase):
    def test_schema_round_trip_preserves_layout_and_checkbox_meanings(self):
        schema = configured_schema()
        fields = schema['categories'][0]['fields']
        checkbox = next(field for category in schema['categories'] for field in category['fields'] if field['id'] == FLD_VERIFIED)
        checkbox.update(checkbox_true_label='معتمد', checkbox_false_label='قيد المراجعة', start_new_line=True)
        fields[1]['start_new_line'] = True
        before = [field['id'] for field in fields]
        saved = APP.validate_schema(schema)
        reopened = APP.validate_schema(copy.deepcopy(saved))
        self.assertEqual([f['id'] for f in reopened['categories'][0]['fields']], before)
        self.assertTrue(reopened['categories'][0]['fields'][1]['start_new_line'])
        check = next(f for c in reopened['categories'] for f in c['fields'] if f['id'] == FLD_VERIFIED)
        for raw, expected in [(True, 'معتمد'), (False, 'قيد المراجعة'), ('false', 'قيد المراجعة')]:
            self.assertEqual(APP.field_display_value(check, raw), expected)
        # Display labels must never change the canonical workbook representation.
        for value in [True, False]:
            stored = APP.excel_value(value, check)
            self.assertEqual(APP.normalize_field_value(stored, check), value)

    def test_conditional_spacer_is_layout_only_and_survives_normalization(self):
        schema = configured_schema()
        spacer = {'id':'fld_987654321001','type':'spacer','width':'2','start_new_line':True}
        schema['categories'][0]['fields'].insert(1, spacer)
        schema['conditions'].append({'id':'cond_987654321001','target_type':'field','target_id':spacer['id'],'source_field_id':FLD_NAME,'operator':'equals','value':'show'})
        saved = APP.validate_schema(schema)
        self.assertEqual(saved['categories'][0]['fields'][1]['type'], 'spacer')
        self.assertTrue(saved['categories'][0]['fields'][1]['start_new_line'])
        self.assertIn(spacer['id'], [r['target_id'] for r in saved['conditions']])
        self.assertNotIn(spacer['id'], [f['id'] for f in APP.data_fields(saved['categories'][0])])

    def test_pdf_line_break_preserves_order_and_rtl_columns(self):
        fields=[{'label':'A','width':'2'}, {'label':'B','width':'2','start_new_line':True}, {'label':'C','width':'1'}]
        rows=readonly_pdf_grid(fields)
        self.assertEqual([[f['label'] for _,_,f in row] for row in rows],[['A'],['B','C']])
        self.assertEqual([[(column,span) for column,span,_ in row] for row in rows],[[(4,2)],[(4,2),(3,1)]])
        fields[0]['width']='full'
        self.assertEqual(len(readonly_pdf_grid(fields)),2, 'No blank row when the field already starts a line')

    def test_pdf_sections_carry_layout_and_display_meanings(self):
        schema={'categories':[{'id':'main','kind':'main','label':'Main','fields':[
            {'id':'a','type':'text','label':'A','width':'2'},
            {'id':'b','type':'checkbox','label':'B','width':'2','start_new_line':True,'checkbox_true_label':'Approved','checkbox_false_label':'Pending'}]}],'conditions':[]}
        sections=APP._record_report_sections(schema,{'values':{'a':'Text','b':False},'related':{}},set(),set())
        fields=sections[0]['cards'][0]['fields']
        self.assertEqual(fields[1]['value'],'Pending')
        self.assertTrue(fields[1]['start_new_line'])
        self.assertEqual(len(readonly_pdf_grid(fields)),2)
