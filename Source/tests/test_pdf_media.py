import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
import SchemaCraft as APP
from schemacraft_advanced import AdvancedFeatureError, profile_pdf_bytes


class PdfMediaTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        Image.new('RGB',(100,160),'#406080').save(self.root/'portrait.png')
        document = canvas.Canvas(str(self.root/'attached.pdf'))
        document.drawString(30,700,'Attachment page ONE')
        document.showPage()
        document.setPageSize((700,400))
        document.drawString(30,300,'Attachment page TWO')
        document.save()
        self.schema = {'categories':[{'id':'category','label':'Personal','kind':'main','fields':[
            {'id':'name','label':'Name','type':'text','width':'3'},
            {'id':'photo','label':'Photo','type':'file','image_display':'profile','width':'1'},
            {'id':'document','label':'Document','type':'file','width':'2'},
        ]}], 'conditions':[]}
        self.record = {'record_code':'A1234567','values':{'name':'Test name','photo':'attachments/portrait.png','document':'attachments/attached.pdf'},'related':{}}

    def tearDown(self):
        self.temporary.cleanup()

    def render(self, photo=False, attachments=False):
        sections=APP._record_report_sections(self.schema,self.record,{'name'},set())
        with mock.patch.object(APP,'attachments_directory',return_value=self.root):
            media=APP._profile_pdf_media(self.schema,self.record,sections,show_profile_image=photo,show_attachments=attachments)
        content=profile_pdf_bytes('Test',[{'title':'Test A1234567','schema_name':'Schema','sections':sections,'attachments':media}],APP.PDF_FONT_PATH)
        return PdfReader(io.BytesIO(content)),sections

    def test_options_are_independent_and_pdf_pages_keep_their_size(self):
        plain,_=self.render()
        self.assertEqual(len(plain.pages),1)
        self.assertEqual(len(plain.pages[0].images),0)
        photo,sections=self.render(photo=True)
        self.assertEqual(len(photo.pages),1)
        self.assertEqual(len(photo.pages[0].images),1)
        self.assertEqual(sections[0]['profile_image'],self.root/'portrait.png')
        appended,_=self.render(attachments=True)
        self.assertEqual(len(appended.pages),4)
        self.assertEqual(len(appended.pages[0].images),0)
        self.assertEqual(len(appended.pages[1].images),1)
        self.assertIn('Attachment page ONE',appended.pages[2].extract_text())
        self.assertIn('Attachment page TWO',appended.pages[3].extract_text())
        self.assertEqual(float(appended.pages[3].mediabox.width),700)
        both,_=self.render(photo=True,attachments=True)
        self.assertEqual(len(both.pages),4)
        self.assertEqual(len(both.pages[0].images),1)

    def test_missing_or_encrypted_attachment_does_not_silently_disappear(self):
        writer=PdfWriter();writer.add_blank_page(width=300,height=400);writer.encrypt('secret')
        with (self.root/'attached.pdf').open('wb') as stream:writer.write(stream)
        with self.assertRaisesRegex(AdvancedFeatureError,'كلمة مرور'):
            self.render(attachments=True)
        (self.root/'portrait.png').unlink()
        with self.assertRaisesRegex(APP.ApplicationError,'العثور'):
            self.render(photo=True)

    def test_media_can_add_a_category_when_its_text_fields_are_not_selected(self):
        with mock.patch.object(APP,'attachments_directory',return_value=self.root):
            sections=[]
            APP._profile_pdf_media(self.schema,self.record,sections,show_profile_image=True)
        self.assertEqual(len(sections),1)
        self.assertEqual(sections[0]['profile_image'],self.root/'portrait.png')
