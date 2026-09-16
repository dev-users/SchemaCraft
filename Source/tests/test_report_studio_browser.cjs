const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=path.resolve(__dirname,'..'),out=process.env.REPORT_TEST_OUTPUT||'/tmp/studio-qa';fs.mkdirSync(out,{recursive:true});
const engine=p=>JSON.parse(execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON,['-c',`
import sys,json,base64
sys.path.insert(0,${JSON.stringify(root)})
from schemacraft_report_document import *
import schemacraft_reports as R
import SchemaCraft as A
p=json.load(sys.stdin)
def loader(d,ids,needed):
 return {'name':'الاسم','amount':'المبلغ','month':'الشهر'},[{'key':i+'/'+str(k),'id':i,'card_id':str(k),'parent_id':'','values':{'name':'طالب '+i,'amount':v+p.get('increment',0),'month':m}} for i in (ids if ids is not None else ['A0000001','B0000002']) for k,v,m in ([(1,100,'January'),(2,200,'February')] if d.get('scope')=='card' else [(1,100,'January')])]
a=p.get('action')
if a in ['save','document_validate']: r={'template':validate_document(p['template']),'ok':True}
elif a=='document_generate': r={'draft':resolve_document(p['template'],p['bindings'],loader)}
elif a=='document_refresh': r={'draft':resolve_document(p['draft']['document_state']['template'],p['draft']['document_state']['bindings'],loader,previous=p['draft'])}
elif a=='document_edit': r={'draft':update_document(p['draft'],p['changes'])}
elif a=='document_recompute': r={'draft':recompute_document(p['draft'])}
elif a=='pdf_preview' or p.get('type')=='advanced_report': r={'pdf':base64.b64encode(R.pdf_bytes(p['draft'],A.PDF_FONT_PATH)).decode(),'filename':'report.pdf'}
else: r={}
print(json.dumps(r,ensure_ascii=False))
`],{input:JSON.stringify(p),encoding:'utf8'}));
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});try{
const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let templates=[],drafts=[],recipes=[],rev=0,increment=0,failExport=false;
const original=fs.readFileSync(root+'/app/src/pages/exchange/exchange.html','utf8'),start=original.indexOf('  <section class="workspace-panel exchange-section" data-export-panel="advanced"'),end=original.indexOf('  <section class="exchange-history-panel',start);const html=original.slice(start,end).replace('data-export-panel="advanced" hidden','data-export-panel="advanced"');
await page.route('http://studio.test/**',async route=>{if(route.request().method()!=='POST')return route.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body>'+html+'</body></html>'});const p=route.request().postDataJSON();try{let r={};
if(p.action==='catalog')r={schemas:[{id:'schema',name:'الطلاب',categories:[{id:'payments',label:'الدفعات',kind:'repeated'}],fields:[{id:'name',label:'الاسم',type:'text',repeated:false},{id:'amount',label:'المبلغ',type:'number',repeated:true,category_id:'payments'},{id:'month',label:'الشهر',type:'text',repeated:true,category_id:'payments'}]}]};
else if(p.action==='list')r={templates};
else if(p.action==='save'){const t={...engine(p).template,id:p.id||'t'+(++rev),revision:String(++rev)};templates=templates.filter(x=>x.id!==t.id).concat(t);r={template:t};}
else if(p.action==='draft_save'){const s={id:p.id||'d'+(++rev),revision:String(++rev),draft:p.draft,updated_at:new Date().toISOString()};drafts=drafts.filter(x=>x.id!==s.id).concat(s);r={saved:s};}
else if(p.action==='draft_list')r={drafts:drafts.map(x=>({...x,title:x.draft.title,document:true}))};
else if(p.action==='draft_read')r={saved:drafts.find(x=>x.id===p.id)};
else if(p.action==='recipe_save'){const s={id:'r'+(++rev),revision:String(rev),draft:{title:p.title,recipe:{template:p.template,bindings:p.bindings}}};recipes.push(s);r={saved:s};}
else if(p.action==='recipe_list')r={recipes:recipes.map(x=>({...x,title:x.draft.title}))};
else if(p.action==='recipe_read')r={saved:recipes.find(x=>x.id===p.id)};
else if(p.type==='advanced_report'&&failExport)throw Error('تعذّر حفظ PDF: الملف مفتوح في برنامج آخر. أغلقه أو اختر اسمًا آخر.');
else if(p.type==='advanced_report_batch'){assert.equal(p.drafts.length,1);r={filename:'batch.zip'};}
else r=engine({...p,increment});if(r.pdf)fs.writeFileSync(out+'/studio.pdf',Buffer.from(r.pdf,'base64'));await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
}catch(e){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:e.message})});}});
await page.goto('http://studio.test/');await page.addStyleTag({path:root+'/app/styles.css'});await page.addScriptTag({path:root+'/app/src/pages/exchange/reports.js'});await page.addScriptTag({path:root+'/app/src/pages/exchange/report-studio.js'});
await page.screenshot({path:out+'/report-home.png'});await page.getByRole('button',{name:'فتح الاستوديو المرئي'}).click();const studio=page.locator('#report-studio');await studio.waitFor({state:'visible'});const click=async name=>studio.getByRole('button',{name,exact:true}).click();
assert.equal(await page.locator('#report-template-dialog').count(),0,'the legacy editor is absent');
await page.setViewportSize({width:1500,height:1500});
let blockCount=await studio.locator('[data-block]').count();
await studio.locator('[data-palette-type="text"]').dragTo(studio.locator('[data-drop-index="0"]'));
assert.equal(await studio.locator('[data-block]').count(),blockCount+1,'palette drop creates a block');
let firstId=await studio.locator('[data-block]').first().getAttribute('data-block');
await page.fill('#studio-block-text','نص مباشر من المحرر');
assert.match(await studio.locator('[data-block]').first().locator('.studio-block-sample').innerText(),/نص مباشر/);
await studio.locator('[data-block]').first().locator('.studio-drag-handle').scrollIntoViewIfNeeded();
const handleRect=await studio.locator('[data-block]').first().locator('.studio-drag-handle').boundingBox();
await page.mouse.move(handleRect.x+handleRect.width/2,handleRect.y+handleRect.height/2);await page.mouse.down();
await page.mouse.move(handleRect.x+handleRect.width/2+20,handleRect.y+handleRect.height/2+10,{steps:5});
const zoneRect=await studio.locator(`[data-drop-index="${blockCount+1}"]`).boundingBox();
await page.mouse.move(zoneRect.x+zoneRect.width/2,zoneRect.y+zoneRect.height/2,{steps:12});await page.mouse.up();
assert.equal(await studio.locator('[data-block]').last().getAttribute('data-block'),firstId,'handle moves to end without cloning');
await click('تراجع');assert.equal(await studio.locator('[data-block]').first().getAttribute('data-block'),firstId);
await click('إعادة');assert.equal(await studio.locator('[data-block]').last().getAttribute('data-block'),firstId);
await studio.locator('[data-block]').last().getByRole('button',{name:'حذف',exact:true}).click();
assert.equal(await studio.locator('[data-block]').count(),blockCount);
await page.setViewportSize({width:1500,height:1050});await page.screenshot({path:out+'/studio-clean-editor.png'});
await page.fill('#studio-document-title','تقرير المدفوعات والمراجعة');await click('2 · البيانات');await click('+ مجموعة بيانات');await studio.getByLabel('كل صف يمثل').selectOption('card');await studio.getByLabel('الفئة المتكررة').selectOption('payments');await studio.locator('.studio-data-advanced summary').click();await click('+ شرط على الصف');let filter=studio.locator('.studio-filter');await filter.locator('select').first().selectOption('month');await filter.locator('input').fill('January');
await click('3 · المؤشرات');await click('+ مؤشر');await studio.getByLabel('الاسم الظاهر').fill('المجموع');await studio.getByLabel('الحقل',{exact:true}).selectOption('amount');await click('+ مؤشر');let cards=studio.locator('.studio-form-grid .studio-card');await cards.nth(1).getByLabel('الاسم الظاهر').fill('ضعف المجموع');await cards.nth(1).getByLabel('نوع الحساب').selectOption('formula');await cards.nth(1).getByLabel('المعادلة').fill('metric1 * 2');
await click('1 · المستند');await click('+ جدول ديناميكي');await studio.getByLabel('عنوان الكتلة').fill('تفاصيل الدفعات');let props=studio.locator('.studio-properties');let checks=props.locator('.studio-checks').first();await checks.getByText('المبلغ',{exact:true}).click();checks=studio.locator('.studio-properties .studio-checks').first();await checks.getByText('الشهر',{exact:true}).click();await studio.locator('.studio-properties .studio-checks').nth(1).getByText('المبلغ',{exact:true}).click();
await click('+ قسم متكرر');await page.fill('#studio-block-text','دفعة بقيمة {{field:amount}} · المجموع {{metric1}}');await click('+ مؤشر مرتبط');await click('+ رسم مؤشرات');await studio.getByLabel('عنوان الكتلة').fill('المؤشرات المتصلة');await click('+ فهرس الصفحات');await page.screenshot({path:out+'/studio-blocks.png'});
await click('حفظ القالب .md');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظ القالب'));assert.equal(templates.length,1);assert.equal(templates[0].document.blocks.length,7);
// Saving must rebind controls to the newly returned model; subsequent edits must persist.
await studio.locator('[data-block]').filter({hasText:'تفاصيل الدفعات'}).locator('[aria-pressed]').click();
await studio.getByLabel('عنوان الكتلة').fill('تفاصيل الدفعات بعد الحفظ');
await click('حفظ القالب .md');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظ القالب'));
assert.equal(templates[0].document.blocks.find(b=>b.type==='table').title,'تفاصيل الدفعات بعد الحفظ');
const expectedColumns=templates[0].document.blocks.find(b=>b.type==='table').columns;
await studio.getByRole('button',{name:'تغيير / إعداد مصدر البيانات',exact:true}).click();await page.locator('.studio-small-dialog[open]').last().getByRole('button',{name:'اعتماد',exact:true}).click();
await click('حفظ القالب .md');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظ القالب'));
assert.equal(Object.keys(templates[0].document.datasets).length,1,'editing a source does not add duplicate datasets');
assert.deepEqual(templates[0].document.blocks.find(b=>b.type==='table').columns,expectedColumns);
assert.equal(Object.values(templates[0].document.datasets)[0].criteria[0].value,'January');

await studio.getByLabel('عنوان الكتلة').fill('تعديل غير محفوظ');
await page.selectOption('#studio-template-select',templates[0].id);let cancel=page.locator('.studio-small-dialog[open]').last();await cancel.getByRole('button',{name:'إلغاء',exact:true}).click();assert.equal(await page.inputValue('#studio-template-select'),templates[0].id);
await click('تراجع');assert.equal(await studio.getByLabel('عنوان الكتلة').inputValue(),'تفاصيل الدفعات بعد الحفظ');
await click('4 · التطبيق والتحديث');await studio.locator('[data-studio-slot]').fill('A0000001');await click('إنشاء من القالب الحالي');await page.waitForSelector('#studio-preview');assert.match(await page.locator('#studio-preview').innerText(),/100.00/);assert.doesNotMatch(await page.locator('#studio-preview').innerText(),/February/);
await click('تفسير الرقم');let inspect=page.locator('.studio-inspect[open]').last();await inspect.getByRole('button',{name:'تعديل المؤشر مع السبب'}).click();let edit=page.locator('.studio-small-dialog[open]').last();await edit.getByLabel('القيمة في هذه النسخة').fill('150');await edit.getByRole('button',{name:'اعتماد',exact:true}).click();await edit.locator('.studio-dialog-error').waitFor();assert.equal(await edit.getByLabel('القيمة في هذه النسخة').inputValue(),'150');await edit.getByLabel('سبب التعديل').fill('تصحيح موثق');await edit.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('إعادة حساب'));await inspect.getByRole('button',{name:'إغلاق',exact:true}).click();assert.match(await page.locator('#studio-preview').innerText(),/300/);
await click('تحديث البيانات مع حفظ التعديلات');let review=page.locator('.studio-small-dialog[open]').last();await review.getByRole('button',{name:'إلغاء',exact:true}).click();assert.match(await page.locator('#studio-preview').innerText(),/300/);
increment=10;await click('تحديث البيانات مع حفظ التعديلات');review=page.locator('.studio-small-dialog[open]').last();await review.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('اعتُمد'));assert.match(await page.locator('#studio-preview').innerText(),/300/);
await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظت المسودة'));assert.match(await studio.locator('.studio-snapshot').innerText(),/مسودة محفوظة/);assert.equal(drafts.length,1);assert.equal(drafts[0].draft.document_state.metrics.metric1.value,150);assert.equal(drafts[0].draft.document_state.metrics.metric2.value,300);assert.equal(drafts[0].draft.document_state.conflicts.length,0);
await click('حفظ وصفة تشغيل');await page.locator('.studio-small-dialog[open]').last().getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظت الوصفة'));assert.equal(recipes.length,1);
await page.screenshot({path:out+'/studio-preview.png'});await click('معاينة PDF');await page.waitForSelector('.report-pdf-dialog[open]');await page.locator('.report-pdf-dialog[open]').getByRole('button',{name:'إغلاق',exact:true}).click();
await click('الوصفات والتصدير الجماعي');inspect=page.locator('.studio-inspect[open]').last();await inspect.getByLabel('تضمين في التصدير').check();await inspect.getByRole('button',{name:'تصدير المحدد ZIP',exact:true}).click();await inspect.getByText('تم الحفظ: batch.zip',{exact:true}).waitFor();await inspect.getByRole('button',{name:'إغلاق',exact:true}).click();
await click('المسودات المحفوظة');inspect=page.locator('.studio-inspect[open]').last();await inspect.getByRole('button',{name:'فتح',exact:true}).click();await page.waitForSelector('.studio-inspect[open]',{state:'detached'});assert.match(await page.locator('#studio-preview').innerText(),/300/);
await page.setViewportSize({width:800,height:900});await click('1 · المستند');await page.screenshot({path:out+'/studio-narrow.png'});assert.equal(await studio.evaluate(e=>e.scrollWidth>e.clientWidth+2),false);await studio.getByRole('button',{name:'ملخص مع مؤشرات',exact:true}).click();
let prompt=page.locator('.studio-small-dialog[open]').last();await prompt.getByRole('button',{name:'اعتماد',exact:true}).click();
prompt=page.locator('.studio-small-dialog[open]').last();await prompt.getByLabel('ماذا يمثل كل صف؟').selectOption('card');await prompt.getByRole('button',{name:'اعتماد',exact:true}).click();await prompt.locator('.studio-dialog-error').waitFor();await page.screenshot({path:out+'/source-dialog.png'});await prompt.getByLabel('الفئة المتكررة').selectOption('payments');await prompt.getByRole('button',{name:'اعتماد',exact:true}).click();
assert.equal(await studio.locator('[data-block]').count(),5,'guided summary builds connected blocks');
await click('حفظ القالب .md');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('حُفظ القالب'));
await page.setViewportSize({width:600,height:900});await page.screenshot({path:out+'/studio-mobile.png'});assert.equal(await studio.evaluate(e=>e.scrollWidth>e.clientWidth+2),false);

// Compose multiple live elements on one line, with two independent profile counts.
await page.setViewportSize({width:1500,height:1050});
await studio.locator('.studio-file-menu summary').click();await click('قالب جديد');
let pending=page.locator('.studio-small-dialog[open]');if(await pending.count())await pending.last().getByRole('button',{name:'اعتماد',exact:true}).click();
await page.fill('#studio-document-title','اختبار القيم داخل الجملة');await click('2 · البيانات');await click('+ مجموعة بيانات');
await studio.getByLabel('الاسم',{exact:true}).fill('المستفيد');await studio.locator('.studio-data-advanced summary').click();await studio.getByLabel('مجموعة الملفات المستخدمة').fill('المستفيد');
await click('+ مجموعة بيانات');let dataCards=studio.locator('.studio-form-grid > .studio-card');
await dataCards.last().getByLabel('الاسم',{exact:true}).fill('الطلبات');await dataCards.last().getByLabel('كل صف يمثل').selectOption('card');await dataCards.last().getByLabel('الفئة المتكررة').selectOption('payments');await dataCards.last().getByLabel('الملفات التي تدخل في التقرير').selectOption('all');
await click('3 · المؤشرات');await click('+ عدد الملفات');let metricCards=studio.locator('.studio-form-grid > .studio-card');await metricCards.first().getByLabel('البيانات',{exact:true}).selectOption('data2');await metricCards.first().getByLabel('الاسم الظاهر').fill('الملفات المطابقة');
await metricCards.first().locator('.studio-metric-conditions summary').click();await metricCards.first().getByRole('button',{name:'+ شرط لهذا الحساب',exact:true}).click();await metricCards.first().getByLabel('حقل الشرط').selectOption('month');await metricCards.first().getByLabel('قيمة الشرط').fill('January');
await click('+ عدد الملفات');await metricCards.last().getByLabel('البيانات',{exact:true}).selectOption('data2');await metricCards.last().getByLabel('الاسم الظاهر').fill('كل الملفات');
assert.equal(await metricCards.first().getByLabel('الحقل',{exact:true}).count(),0,'profile counts do not require an unrelated field');
await page.screenshot({path:out+'/conditional-counts.png'});
await click('1 · المستند');await studio.locator('[data-block]').nth(1).locator('[aria-pressed]').click();await page.fill('#studio-block-text','ملف  يشمل  ملفات مطابقة.');await page.locator('#studio-block-text').evaluate(e=>{e.focus();e.setSelectionRange(4,4);});
await click('إدراج قيمة داخل النص');let insert=page.locator('.studio-small-dialog[open]').last();await insert.getByLabel('مصدر القيمة').selectOption('data1');await insert.getByLabel('الحقل داخل الجملة').selectOption('name');await insert.getByRole('button',{name:'اعتماد',exact:true}).click();
await page.locator('#studio-block-text').evaluate(e=>{const p=e.value.indexOf(' ملفات مطابقة');e.focus();e.setSelectionRange(p,p);});await click('إدراج قيمة داخل النص');insert=page.locator('.studio-small-dialog[open]').last();await insert.getByLabel('نوع القيمة').selectOption('metric');await insert.getByLabel('الحساب داخل الجملة').selectOption('metric1');await page.screenshot({path:out+'/inline-picker.png'});await insert.getByRole('button',{name:'اعتماد',exact:true}).click();
assert.equal(await page.inputValue('#studio-block-text'),'ملف {{value:data1:name}} يشمل {{metric1}} ملفات مطابقة.');
await click('4 · التطبيق والتحديث');await click('إنشاء من القالب الحالي');let failure=page.locator('#studio-failure-dialog');await failure.waitFor();assert.match(await failure.innerText(),/حدد من 1 إلى 500 ID/);await failure.getByRole('button',{name:'العودة لتصحيح التقرير'}).click();
assert.equal(await studio.locator('[data-studio-slot]').count(),1,'all-profiles dataset does not ask for IDs');await studio.locator('[data-studio-slot]').fill('A0000001');await click('إنشاء من القالب الحالي');await page.waitForSelector('#studio-preview');assert.match(await page.locator('#studio-preview').innerText(),/ملف طالب A0000001 يشمل 2 ملفات مطابقة/);
await click('تفسير الملفات المطابقة');let explain=page.locator('.studio-inspect[open]').last();assert.match(await explain.innerText(),/January/);assert.match(await explain.innerText(),/2 ملف دون تكرار/);await explain.getByRole('button',{name:'إغلاق',exact:true}).click();
const sentence=await page.locator('#studio-preview').innerText();failExport=true;await click('تصدير PDF');await failure.waitFor();assert.match(await failure.innerText(),/الملف مفتوح/);await page.screenshot({path:out+'/export-error.png'});assert.equal(await failure.evaluate(e=>e.getBoundingClientRect().bottom<innerHeight),true);await failure.getByRole('button',{name:'العودة لتصحيح التقرير'}).click();assert.equal(await page.locator('#studio-preview').innerText(),sentence);
failExport=false;await click('تصدير PDF');await page.waitForFunction(()=>document.querySelector('#studio-status').textContent.includes('تم تصدير report.pdf'));await page.screenshot({path:out+'/inline-result.png'});
assert.deepEqual(errors,[]);console.log('Report workflow, inline fields, conditional profile counts and export recovery passed: post-save edits, undo, cancel, retained modal validation, contextual keyboard save, drag/drop, refresh and PDF.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
