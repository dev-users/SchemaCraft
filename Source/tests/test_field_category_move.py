import copy
import unittest
import SchemaCraft as APP
from test_backend import CAT_IDENTITY, FLD_NAME, CAT_CHILDREN

class CategoryMoveTests(unittest.TestCase):
    from test_multischema import MultiSchemaWorkspaceTests as Fixture
    setUp=Fixture.setUp
    tearDown=Fixture.tearDown
    def test_main_category_move_preserves_saved_profile_values(self):
        APP.initialize_workspace();ctx=APP.require_workspace().context()
        with APP.use_context(ctx):
            old=APP.read_schema_file();before=copy.deepcopy(APP.load_record('M0000001'))
            updated=copy.deepcopy(old)
            source=next(c for c in updated['categories'] if c['id']==CAT_IDENTITY)
            item=next(f for f in source['fields'] if f['id']==FLD_NAME)
            source['fields'].remove(item)
            destination={'id':'cat_aaaaaaaabbbb','label':'فئة الوجهة','kind':'main','fields':[item]}
            updated['categories'].append(destination)
            APP.save_schema(updated)
            after=APP.load_record('M0000001')
            self.assertEqual(after['main'],before['main'])
            self.assertEqual(after['related'],before['related'])
            saved=APP.read_schema_file()
            self.assertEqual(APP.schema_indexes(saved)['field_categories'][FLD_NAME],destination['id'])
            # Saving the moved record retains its original name.
            APP.save_record({'mode':'update','record_code':'M0000001','main':after['main'],'related':after['related']})
            self.assertEqual(APP.load_record('M0000001')['main'][FLD_NAME],before['main'][FLD_NAME])

    def test_populated_repeated_scope_move_is_not_silently_migrated(self):
        APP.initialize_workspace();ctx=APP.require_workspace().context()
        with APP.use_context(ctx):
            old=APP.read_schema_file();updated=copy.deepcopy(old)
            source=next(c for c in updated['categories'] if c['id']==CAT_IDENTITY)
            target=next(c for c in updated['categories'] if c['id']==CAT_CHILDREN)
            item=next(f for f in source['fields'] if f['id']==FLD_NAME);source['fields'].remove(item);target['fields'].append(item)
            before=ctx.workbook_path.read_bytes()
            records=list(APP._dataset_snapshot_unlocked(old).records_by_code.values())
            with self.assertRaisesRegex(APP.ApplicationError,'ترحيل قيم البطاقات'):APP.migrate_records_to_schema(old,updated,records)
            self.assertEqual(ctx.workbook_path.read_bytes(),before)
            self.assertEqual(APP.schema_indexes(APP.read_schema_file())['field_categories'][FLD_NAME],CAT_IDENTITY)
