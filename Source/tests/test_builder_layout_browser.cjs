// Run against an isolated real backend; CHROMIUM_EXECUTABLE selects the local browser.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('child_process');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'builder-layout-'));
const out=process.env.BUILDER_TEST_OUTPUT||'/tmp/builder-layout-qa';fs.mkdirSync(out,{recursive:true});
const schema=JSON.parse(execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['-c',"import sys,json;sys.path.insert(0,'tests');from test_backend import configured_schema;print(json.dumps(configured_schema()))"],{cwd:root,encoding:'utf8'}));
const ids={main:'cat_000000000001',cards:'cat_000000000002',name:'fld_000000000001',father:'fld_000000000002',check:'fld_000000000011'};
schema.categories[0].fields[0].required=true;
schema.categories[1].card_name_prefix='وثيقة';schema.categories[1].card_title_field_id=null;
fs.writeFileSync(path.join(data,'schema.json'),JSON.stringify(schema));
const server=spawn(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['tests/test_server.py',data,'--builder'],{cwd:root,stdio:['ignore','pipe','pipe']});
const port=new Promise((resolve,reject)=>{server.stdout.on('data',b=>{const m=String(b).match(/PORT=(\d+)/);if(m)resolve(m[1]);});server.on('exit',c=>reject(Error('Server exited '+c)));});
(async()=>{let browser;try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+await port);await page.waitForFunction(()=>document.querySelector('#audit-user-dialog')?.open || document.querySelector('#app-status')?.classList.contains('status-ready'));
 if(await page.locator('#audit-user-dialog').evaluate(e=>e.open)){await page.fill('#audit-user-input','اختبار التصميم');await page.click('#confirm-audit-user');}
 await page.waitForSelector('#app-status.status-ready',{state:'attached'});
 await page.evaluate(()=>performSwitchMode('builder'));
 await page.evaluate(()=>openNewFieldCategoryDialog('schema'));
 await page.selectOption('#new-field-category',ids.main);await page.selectOption('#new-field-after',ids.father);await page.click('#confirm-new-field-category');
 assert.equal(await page.inputValue('#field-after'),ids.father);
 await page.fill('#field-label','بداية سطر جديد');await page.check('#field-start-new-line');await page.selectOption('#field-width','2');await page.click('#confirm-field-button');
 await page.waitForFunction(()=>!document.querySelector('#field-dialog').open);
 const newId=await page.evaluate(()=>state.draftSchema.categories[0].fields.find(f=>f.label==='بداية سطر جديد').id);
 let order=await page.evaluate(()=>state.draftSchema.categories[0].fields.map(f=>f.id));assert.equal(order.indexOf(newId),order.indexOf(ids.father)+1);
 await page.evaluate(({main,id})=>openFieldDialog(main,id),{main:ids.main,id:newId});
 assert.equal(await page.inputValue('#field-after'),ids.father);assert.equal(await page.isChecked('#field-start-new-line'),true);
 await page.click('#confirm-field-button');assert.deepEqual(await page.evaluate(()=>state.draftSchema.categories[0].fields.map(f=>f.id)),order);
 // Checkbox meanings are edited with ordinary settings, then saved through the backend.
 await page.evaluate(({main,check})=>openFieldDialog(main,check),ids);
 await page.fill('#field-checkbox-true-label','معتمد');await page.fill('#field-checkbox-false-label','قيد المراجعة');await page.click('#confirm-field-button');
 // Category placement remains available after creation, and reopening is a no-op.
 await page.evaluate(id=>openCategoryDialog(id),ids.main);assert.equal(await page.locator('#category-placement-wrapper').isVisible(),true);
 const placement=await page.inputValue('#category-placement');await page.evaluate(()=>saveCategoryFromDialog());
 await page.evaluate(id=>openCategoryDialog(id),ids.main);assert.equal(await page.inputValue('#category-placement'),placement);await page.evaluate(()=>saveCategoryFromDialog());
 assert.equal(await page.locator('#builder-preview-card-tab-'+ids.cards).innerText(),'وثيقة 1');
 await page.evaluate(id=>{categoryById(id).card_title_field_id='fld_00000000000b';renderBuilder();},ids.cards);
 assert.equal(await page.locator('#builder-preview-card-tab-'+ids.cards).innerText(),await page.evaluate(()=>fieldById('fld_00000000000b').label));
 // Spacer settings expose appearance rules and persist them as layout-only definitions.
 await page.evaluate(id=>openFieldDialog(id),ids.main);await page.selectOption('#field-type','spacer');
 assert.equal(await page.locator('#add-field-condition-button').isVisible(),true);await page.check('#field-start-new-line');await page.click('#confirm-field-button');
 const spacer=await page.evaluate(({main,name})=>{const f=categoryById(main).fields.find(f=>f.type==='spacer');state.draftSchema.conditions.push({id:randomDefinitionId('cond'),target_type:'field',target_id:f.id,source_field_id:name,operator:'equals',value:'show'});return f.id;},ids);
 assert.equal(await page.evaluate(()=>saveSchema()),true);
 await page.evaluate(()=>loadSchema({preservePage:true,resetRecord:false}));
 assert.equal(await page.evaluate(id=>fieldById(id).start_new_line,newId),true);
 await page.evaluate(()=>performSwitchMode('entry'));
 const input=page.locator(`[data-value-control][data-scope="main"][data-field-id="${ids.name}"]`);
 await input.fill('');await input.focus();await page.locator(`[data-value-control][data-scope="main"][data-field-id="${ids.father}"]`).focus();
 const wrapper=page.locator(`#record-form [data-field-wrapper="${ids.name}"]`);await wrapper.locator('.field-error-inside').waitFor();
 const inside=await wrapper.evaluate(e=>{const a=e.querySelector('.entry-control-surface').getBoundingClientRect(),b=e.querySelector('[data-field-error]').getBoundingClientRect();return b.top>=a.top&&b.bottom<=a.bottom&&b.left>=a.left&&b.right<=a.right;});assert.equal(inside,true);
 await page.screenshot({path:path.join(out,'required-inside.png')});
 await input.fill('show');assert.equal(await wrapper.locator('[data-field-error]').count(),0);
 assert.equal(await page.locator(`#record-form [data-field-wrapper="${spacer}"]`).evaluate(e=>e.hidden),false);
 await input.fill('hide');assert.equal(await page.locator(`#record-form [data-field-wrapper="${spacer}"]`).evaluate(e=>e.hidden),true);
 const checkbox=page.locator(`[data-value-control][data-scope="main"][data-field-id="${ids.check}"]`);
 await checkbox.check();assert.equal(await checkbox.locator('..').locator('.checkbox-meaning').innerText(),'معتمد');
 await checkbox.uncheck();assert.ok(await checkbox.locator('..').locator('span').first().evaluate(e=>e.getBoundingClientRect().width>30));assert.equal(await checkbox.locator('..').locator('.checkbox-meaning').innerText(),'قيد المراجعة');
 assert.equal(await page.evaluate(id=>collectMainPayload().then(p=>p[id]),ids.check),false);
 // A controlled six-column sample checks actual RTL auto-placement, including no extra blank row.
 await page.evaluate(()=>{const area=document.createElement('div');area.id='layout-probe';document.querySelector('#record-form').prepend(area);const grid=document.createElement('div');grid.className='field-grid';area.append(grid);for(const f of [{id:'p1',width:'2'},{id:'p2',width:'2',start_new_line:true},{id:'p3',width:'1'}])grid.append(createFieldElement({...f,label:f.id,type:'text'},'main','probe'));});
 const boxes=await page.locator('#layout-probe [data-field-wrapper]').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right};}));
 assert.ok(boxes[1].y>boxes[0].y);assert.ok(Math.abs(boxes[1].right-boxes[0].right)<2);assert.ok(Math.abs(boxes[2].y-boxes[1].y)<2);assert.ok(boxes[2].x<boxes[1].x);
 await page.screenshot({path:path.join(out,'rtl-new-line.png')});
 await page.setViewportSize({width:1000,height:1000});assert.equal(await page.locator('#layout-probe .field-grid').evaluate(e=>e.scrollWidth>e.clientWidth+2),false);
 await page.setViewportSize({width:650,height:950});assert.equal(await page.locator('#layout-probe .field-grid').evaluate(e=>e.scrollWidth>e.clientWidth+2),false);
 await page.evaluate(()=>document.querySelector('#layout-probe').remove());
 // The general editor preserves stable placement keys and stages changes for Save / Discard.
 await page.evaluate(()=>{state.mode='builder';state.builderScope='global';state.globalDefinitions={revision:0,categories:{gcat_111111111111:{id:'gcat_111111111111',definition:{label:'فئة عامة',kind:'main',fields:[{label:'أول',type:'text',width:'1'},{label:'ثاني',type:'text',width:'1'}]}}},fields:{gfld_111111111111:{id:'gfld_111111111111',definition:{label:'منفصل أول',type:'text'}},gfld_222222222222:{id:'gfld_222222222222',definition:{label:'منفصل ثان',type:'text'}}}};openNewFieldCategoryDialog('global');});
 await page.selectOption('#new-field-after','gfld_111111111111');await page.click('#confirm-new-field-category');assert.equal(await page.inputValue('#field-after'),'gfld_111111111111');
 await page.fill('#field-label','منفصل وسط');await page.click('#confirm-field-button');await page.waitForFunction(()=>!state.globalEditor);
 assert.deepEqual(await page.evaluate(()=>Object.values(state.globalDefinitions.fields).map(f=>f.definition.label)),['منفصل أول','منفصل وسط','منفصل ثان']);
 await page.evaluate(()=>openNewFieldCategoryDialog('global'));await page.selectOption('#new-field-category','gcat_111111111111::category-1');await page.selectOption('#new-field-after','category-1-field-1');await page.click('#confirm-new-field-category');
 await page.fill('#field-label','وسط');await page.click('#confirm-field-button');await page.waitForFunction(()=>!state.globalEditor);
 assert.deepEqual(await page.evaluate(()=>globalCategoryTree(state.globalDefinitions.categories.gcat_111111111111.definition)[0].fields.map(f=>f.definition.label)),['أول','وسط','ثاني']);
 assert.deepEqual(errors,[]);console.log('Builder placement, required errors, checkbox meanings, spacer conditions and responsive RTL browser checks passed.');
} finally {if(browser)await browser.close();server.kill();fs.rmSync(data,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
