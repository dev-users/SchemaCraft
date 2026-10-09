/* Visual document studio. DOM-only rendering, shared PDF engine, explicit overrides. */
(() => {
'use strict';
const host=document.getElementById('advanced-export-panel');if(!host)return;
const $=id=>document.getElementById(id), copy=x=>JSON.parse(JSON.stringify(x));
const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const opt=(v,t)=>{const e=node('option',t);e.value=v;return e;};
const kinds={field:'قيمة حقل فردي',heading:'عنوان',text:'نص وتعليق',metric:'مؤشر مرتبط',table:'جدول ديناميكي',repeat:'قسم متكرر',chart:'رسم مؤشرات',cover:'غلاف',toc:'فهرس الصفحات',pagebreak:'فاصل صفحة'};
let cleanTemplateSnapshot=null;
let catalog=[],templates=[],model=null,identity=null,draft=null,draftIdentity=null,bindings={},active=null,tab='blocks',dirty=false,templateDirty=false,undo=[],redo=[],busy=false,pdfURL=null;
const dialog=node('dialog','','editor-dialog report-studio');dialog.id='report-studio';dialog.dir='rtl';document.body.append(dialog);
const titlebar=node('div','','dialog-heading');const headingText=node('div','','studio-heading-text');const heading=node('h2','استوديو التقارير','studio-title');heading.id='studio-heading';dialog.setAttribute('aria-labelledby',heading.id);headingText.append(heading,node('p','صمّم القالب · اربط البيانات · راجع النتيجة','studio-heading-subtitle'));const saveBadge=node('span','قالب جديد','studio-save-badge');saveBadge.id='studio-save-badge';titlebar.append(headingText,saveBadge);const close=node('button','×','dialog-close');close.setAttribute('aria-label','إغلاق الاستوديو');close.onclick=()=>closeStudio();titlebar.append(close);dialog.append(titlebar);
const toolbar=node('div','','studio-topbar');dialog.append(toolbar);
const stateLine=node('p','','studio-status');stateLine.id='studio-status';stateLine.setAttribute('role','status');stateLine.setAttribute('aria-live','polite');dialog.append(stateLine);
const tabs=node('nav','','studio-tabs');tabs.setAttribute('aria-label','خطوات التقرير');dialog.append(tabs);
const body=node('div','','dialog-content studio-body');dialog.append(body);
const navigation=node('div','','dialog-actions studio-footer');navigation.append(btn('الخطوة السابقة',()=>{tab=['blocks','data','metrics','run'][Math.max(0,['blocks','data','metrics','run'].indexOf(tab)-1)];render();}),btn('الخطوة التالية',()=>{tab=['blocks','data','metrics','run'][Math.min(3,['blocks','data','metrics','run'].indexOf(tab)+1)];render();}),btn('عودة إلى الصفحة',closeStudio));dialog.append(navigation);
const status=(text,error=false)=>{stateLine.textContent=text;stateLine.classList.toggle('report-warning',error);if(!dialog.open){const line=$('studio-page-status');if(line){line.textContent=text;line.classList.toggle('report-warning',error);}}syncSaveBadge();if(error)showFailure(text);};
function syncSaveBadge(){const templateLabel=templateDirty?'قالب غير محفوظ':identity?'القالب محفوظ':'قالب جديد';saveBadge.textContent=templateLabel+(draft?' · '+(dirty?'مسودة غير محفوظة':draftIdentity?'المسودة محفوظة':'مسودة جديدة'):'');saveBadge.classList.toggle('is-dirty',templateDirty||!!draft&&dirty);const snapshot=body.querySelector('.studio-snapshot');if(snapshot&&draft)snapshot.textContent='لقطة البيانات: '+new Date(draft.generated_at).toLocaleString('ar')+' · '+Object.keys(draft.document_state.overrides).length+' تعديل يدوي · '+(dirty?'تغييرات المسودة لم تُحفظ':draftIdentity?'مسودة محفوظة':'احفظ المسودة للعودة إليها لاحقًا');}
function showFailure(message){
 let d=document.getElementById('studio-failure-dialog');
 if(d){d.querySelector('.studio-failure-message').textContent=message;return;}
 d=node('dialog','','editor-dialog studio-small-dialog studio-failure-dialog');d.id='studio-failure-dialog';d.dir='rtl';d.setAttribute('aria-labelledby','studio-failure-title');
 const h=node('div','','dialog-heading'),title=node('h2','تعذّر إكمال العملية');title.id='studio-failure-title';h.append(title);
 const c=node('div','','dialog-content');c.append(node('strong','يرجى معالجة الخطأ ثم إعادة المحاولة.','studio-failure-lead'));const detail=node('p',message,'studio-failure-message');detail.setAttribute('role','alert');c.append(detail,node('p','إذا كنت تصدّر PDF، تحقق من اختيار الملفات وإعدادات الحساب ومكان الحفظ. يمكنك العودة لتصحيح التقرير؛ النسخة المفتوحة باقية.','studio-property-help'));
 const actions=node('div','','dialog-actions');actions.append(btn('العودة لتصحيح التقرير',()=>d.close(),true));d.append(h,c,actions);d.onclose=()=>d.remove();document.body.append(d);d.showModal();actions.querySelector('button').focus();
}
async function api(data,path='/api/reports'){
 let r;try{r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}catch(e){throw Error('تعذّر الاتصال بالتطبيق. تحقق من أنه يعمل ثم أعد المحاولة.');}
 let j;try{j=await r.json();}catch(e){throw Error('أعاد التطبيق استجابة غير مكتملة (HTTP '+r.status+'). أعد المحاولة؛ إذا تكرر الخطأ أعد تشغيل التطبيق بعد حفظ عملك.');}
 if(!r.ok)throw Error(j.error||'تعذرت العملية (HTTP '+r.status+').');return j;
}
function btn(text,fn,primary=false){const b=node('button',text,'button '+(primary?'button-primary':'button-secondary'));b.type='button';b.onclick=async()=>{if(busy)return;b.disabled=true;try{await fn();}catch(e){status(text+' — '+e.message,true);}finally{b.disabled=false;}};return b;}
function label(text,control){if(control.matches('input,select,textarea'))control.setAttribute('aria-label',text);const l=node('label','','field');l.append(node('span',text),control);return l;}
function input(value,change,type='text'){const n=node(type==='textarea'?'textarea':'input','','control');if(type!=='textarea')n.type=type;else n.rows=5;n.value=value??'';let started=false;n.onfocus=()=>{started=false;};n.oninput=()=>{if(!started&&model&&tab!=='run'&&dialog.contains(n)&&!['search','file'].includes(type)){remember();started=true;}change(n.value);syncSaveBadge();};return n;}
function select(value,values,change){const n=node('select','','control');n.append(...values.map(([v,t])=>opt(v,t)));n.value=value??'';n.onchange=()=>{if(model&&tab!=='run'&&dialog.contains(n)&&n.id!=='studio-template-select')remember();return change(n.value);};return n;}
function check(text,value,change){const n=node('input');n.type='checkbox';n.checked=!!value;n.onchange=()=>{if(model&&tab!=='run'&&dialog.contains(n))remember();change(n.checked);};const l=node('label','','check-field');l.append(n,node('span',text));return l;}
function uid(prefix,collection){let i=1;while(collection[prefix+i]||(Array.isArray(collection)&&collection.some(b=>b.id===prefix+i)))i++;return prefix+i;}
function remember(){if(!model)return;const snapshot=copy(model);if(!undo.length||JSON.stringify(undo[undo.length-1])!==JSON.stringify(snapshot))undo.push(snapshot);if(undo.length>40)undo.shift();redo=[];}
function markTemplateClean(){templateDirty=false;cleanTemplateSnapshot=model?JSON.stringify(model):null;}
function changed(){templateDirty=JSON.stringify(model)!==cleanTemplateSnapshot;refreshBlockSample();const u=toolbar.querySelector('[data-studio-undo]'),r=toolbar.querySelector('[data-studio-redo]');if(u)u.disabled=!undo.length;if(r)r.disabled=!redo.length;status(templateDirty?'تعديلات القالب لم تُحفظ. المعاينة النهائية تستخدم البيانات الفعلية.':'القالب مطابق لآخر نسخة محفوظة.');}
function mutate(fn,redraw=true){remember();fn();changed();if(redraw)render();}
function blank(){return {title:'تقرير مرئي جديد',body:'',options:{orientation:'portrait',font_size:11,accent:'blue',header:'',footer:''},document:{version:2,datasets:{},metrics:{},blocks:[{id:'heading1',type:'heading',text:'تقرير جديد'},{id:'text1',type:'text',text:'اكتب مقدمة التقرير هنا.'}]}};}
function hasUnsaved(){return dirty||templateDirty;}
async function ask(title,message,controls=null,validate=null){
 return new Promise(resolve=>{const d=node('dialog','','editor-dialog studio-small-dialog');d.dir='rtl';const h=node('div','','dialog-heading');const titleEl=node('h2',title);titleEl.id='studio-prompt-'+Math.random().toString(16).slice(2);d.setAttribute('aria-labelledby',titleEl.id);h.append(titleEl,btn('×',()=>finish(false)));h.lastChild.setAttribute('aria-label','إغلاق الحوار');const c=node('div','','dialog-content');c.append(node('p',message));if(controls)c.append(controls);const error=node('p','','studio-dialog-error');error.setAttribute('role','alert');error.hidden=true;c.append(error);const a=node('div','','dialog-actions');const finish=v=>{d.close();d.remove();resolve(v);};a.append(btn('إلغاء',()=>finish(false)),btn('اعتماد',async()=>{try{if(validate)await validate();finish(true);}catch(e){error.hidden=false;error.textContent=e.message;error.scrollIntoView({block:'nearest'});}},true));d.append(h,c,a);d.oncancel=e=>{e.preventDefault();finish(false);};document.body.append(d);d.showModal();});
}
async function closeStudio(){if(busy)return;if(hasUnsaved()&&!await ask('إغلاق الاستوديو','توجد تعديلات غير محفوظة. إغلاق مع الاحتفاظ بها أثناء الجلسة؟'))return;dialog.close();}
async function open(){if(busy)return;if(!model){model=blank();markTemplateClean();}if(!dialog.open)dialog.showModal();render();await working('جارٍ تحميل القوالب ومصادر البيانات…',async()=>{catalog=(await api({action:'catalog'})).schemas;await loadTemplates();});render();}
async function loadTemplates(){templates=(await api({action:'list'})).templates.filter(t=>t.document);renderTemplateShelf();}
const launch=node('section','','studio-launch');const launchText=node('div');launchText.append(node('h3','محرر التقرير المرئي'),node('p','اسحب الكتل، اختر بياناتها، ثم راجع التقرير. القوالب والمسودات والوصفات كلها هنا.'));launch.append(launchText,btn('فتح الاستوديو المرئي',open,true));($('studio-launch-slot')||host).append(launch);
const pageStatus=node('p','','studio-page-status');pageStatus.id='studio-page-status';pageStatus.setAttribute('role','status');
const pageActions=node('div','','studio-page-actions');
pageActions.append(btn('القوالب المحفوظة',async()=>{await open();$('studio-template-select').focus();}),btn('المسودات المحفوظة',async()=>{await open();tab='run';render();await draftsDialog();}),btn('وصفات التشغيل',async()=>{await open();tab='run';render();await recipesDialog();}));
launchText.append(pageActions);
const shelf=node('section','','studio-template-shelf');shelf.setAttribute('aria-label','قوالبك المرئية');host.append(shelf,pageStatus);
function renderTemplateShelf(){
 shelf.replaceChildren();const heading=node('div','','studio-shelf-heading');heading.append(node('h3','قوالبك المرئية'),node('span',templates.length+' قوالب'));shelf.append(heading);
 if(!templates.length){shelf.append(node('p','احفظ أول قالب من الاستوديو ليظهر هنا ويمكن استخدامه مع ملفات أخرى.','muted-text'));return;}
 const grid=node('div','','studio-template-grid');
 for(const t of templates.slice(0,6)){
  const c=node('article','','studio-template-tile');const meta=t.document?.blocks?.length;
  c.append(node('div','≡','studio-template-mark'),node('h4',t.title),node('p',meta?meta+' كتل · قالب قابل لإعادة الاستخدام':'قالب مرئي محفوظ'));
  c.append(btn('فتح القالب',async()=>{await open();const picker=$('studio-template-select');picker.value=t.id;picker.dispatchEvent(new Event('change',{bubbles:true}));}));grid.append(c);
 }
 shelf.append(grid);
 if(templates.length>6)shelf.append(btn('عرض كل القوالب',async()=>{await open();$('studio-template-select').focus();}));
}
let landingRequest=null;
function refreshLanding(){if(landingRequest)return landingRequest;landingRequest=loadTemplates().catch(e=>{pageStatus.textContent='تعذّر تحميل القوالب: '+e.message;}).finally(()=>{landingRequest=null;});return landingRequest;}
const shelfRefresh=btn('تحديث القوالب',refreshLanding);pageActions.append(shelfRefresh);
new MutationObserver(()=>{if(!host.hidden)refreshLanding();}).observe(host,{attributes:true,attributeFilter:['hidden']});
if(!host.hidden)refreshLanding();
dialog.addEventListener('click',e=>{if(!e.target.closest('.studio-file-menu'))toolbar.querySelector('.studio-file-menu')?.removeAttribute('open');});
dialog.addEventListener('keydown',e=>{if(e.key==='Escape'&&toolbar.querySelector('.studio-file-menu[open]')){e.preventDefault();e.stopPropagation();toolbar.querySelector('.studio-file-menu').open=false;}});

dialog.oncancel=e=>{e.preventDefault();closeStudio();};
window.addEventListener('beforeunload',e=>{if(hasUnsaved()){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(!dialog.open||[...document.querySelectorAll('dialog[open]')].at(-1)!==dialog)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();if(busy)return;(tab==='run'&&draft?saveDraft():saveTemplate()).catch(err=>status(err.message,true));}},true);
function top(){
 syncSaveBadge();toolbar.replaceChildren();const title=input(model.title,v=>{model.title=v;changed();});title.id='studio-document-title';title.maxLength=160;title.setAttribute('aria-label','اسم التقرير');toolbar.append(title);
 const pick=select(identity?.id||'',[['','القوالب المرئية المحفوظة'],...templates.map(t=>[t.id,t.title])],async id=>{try{if(!id)return;if(hasUnsaved()&&!await ask('فتح قالب','ترك التعديلات الحالية وفتح القالب؟')){pick.value=identity?.id||'';return;}model=copy(templates.find(t=>t.id===id));identity={id:model.id,revision:model.revision};draft=null;draftIdentity=null;bindings={};undo=[];redo=[];dirty=false;markTemplateClean();active=null;tab='blocks';render();}catch(e){status(e.message,true);}});pick.id='studio-template-select';pick.setAttribute('aria-label','اختيار قالب محفوظ');const fileActions=node('details','','studio-file-menu');fileActions.append(node('summary','خيارات القالب'));const fileButtons=node('div');fileActions.append(fileButtons);toolbar.append(pick);fileButtons.append(btn('قالب جديد',async()=>{if(hasUnsaved()&&!await ask('قالب جديد','ترك التعديلات الحالية؟'))return;model=blank();identity=null;draft=null;draftIdentity=null;bindings={};active=null;dirty=false;markTemplateClean();undo=[];redo=[];tab='blocks';render();}),btn('نسخة مستقلة',async()=>{identity=null;model.title+=' — نسخة';await saveTemplate();}),btn('تنزيل .md',download),btn('استيراد',importTemplate),btn('حذف القالب',deleteTemplate));toolbar.append(btn('حفظ القالب .md',saveTemplate,true),btn('معاينة التقرير',()=>{tab='run';body.scrollTop=0;render();}),fileActions);
 const back=btn('تراجع',()=>{if(undo.length){redo.push(copy(model));model=undo.pop();changed();render();}}),forward=btn('إعادة',()=>{if(redo.length){undo.push(copy(model));model=redo.pop();changed();render();}});back.dataset.studioUndo='';forward.dataset.studioRedo='';back.disabled=!undo.length;forward.disabled=!redo.length;toolbar.append(back,forward);
 tabs.replaceChildren();for(const [id,text] of [['blocks','1 · المستند'],['data','2 · البيانات'],['metrics','3 · المؤشرات'],['run','4 · التطبيق والتحديث']]){const b=btn(text,()=>{tab=id;body.scrollTop=0;render();});b.classList.toggle('is-active',tab===id);b.setAttribute('aria-current',tab===id?'step':'false');tabs.append(b);}
}
async function saveTemplate(){if(busy)return;await working('جارٍ حفظ القالب…',async()=>{await api({action:'document_validate',template:model});const r=await api({action:'save',template:model,id:identity?.id,revision:identity?.revision});identity={id:r.template.id,revision:r.template.revision};model=copy(r.template);markTemplateClean();const scroll=body.scrollTop;render();body.scrollTop=scroll;await loadTemplates();top();status('حُفظ القالب المرئي كملف Markdown.');});}
function download(){const meta={version:2,title:model.title,document:model.document,placeholders:{},options:model.options};const text='<!-- SchemaCraftReport '+JSON.stringify(meta).replaceAll('-->','\\u002d\\u002d>')+' -->\n'+model.document.blocks.map(b=>b.text||b.title||'['+b.type+']').join('\n\n');const a=node('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));a.download=model.title.replace(/[\\/:*?"<>|]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function importTemplate(){const f=input('',()=>{},'file');f.accept='.md';f.onchange=async()=>{try{if(!f.files[0])return;if(hasUnsaved()&&!await ask('استيراد قالب','ترك تعديلات القالب الحالي؟'))return;const text=await f.files[0].text();const meta=text.match(/<!-- SchemaCraftReport ([\s\S]*?) -->/);if(!meta||!JSON.parse(meta[1]).document)throw Error('اختر قالب .md من المحرر المرئي. القوالب النصية القديمة محفوظة دون تغيير، لكنها لا تُفتح في هذا المحرر.');const r=await api({action:'import',markdown:text});model=r.template;identity={id:model.id,revision:model.revision};draft=null;draftIdentity=null;dirty=false;markTemplateClean();undo=[];redo=[];active=null;await loadTemplates();render();}catch(e){status(e.message,true);}};f.click();}
function render(){top();const index=['blocks','data','metrics','run'].indexOf(tab);navigation.children[0].disabled=index===0;navigation.children[1].disabled=index===3;body.replaceChildren();if(tab==='blocks')renderBlocks();else if(tab==='data')renderData();else if(tab==='metrics')renderMetrics();else renderRun();}
function card(title){const c=node('section','','studio-card');if(title)c.append(node('h3',title));return c;}
function fieldOptions(dataset,includeIdentity=false){const d=model.document.datasets[dataset];const schema=catalog.find(s=>s.id===d?.schema_id);return [...(includeIdentity?[['id','ID'],['card_id','رقم البطاقة'],['parent_id','مرجع البطاقة الأم']]:[]),...(schema?.fields||[]).filter(f=>!f.repeated||(d?.scope==='card'&&f.category_id===d.category_id)).map(f=>[f.id,f.label])];}
function multi(values,options,change){const box=node('div','','studio-checks');const search=input('',v=>box.querySelectorAll('[data-search]').forEach(l=>l.hidden=!l.dataset.search.includes(v.toLocaleLowerCase())),'search');search.placeholder='ابحث…';box.append(search);for(const [id,name] of options){const l=check(name,values.includes(id),checked=>change(checked?[...values.filter(x=>x!==id),id]:values.filter(x=>x!==id)));l.dataset.search=name.toLocaleLowerCase();box.append(l);}return box;}
const blockHelp = {
 heading:'عنوان يقسّم التقرير إلى أجزاء واضحة.', text:'اكتب الجملة وضع المؤشر حيث تريد، ثم أدرج اسمًا أو قيمة أو حسابًا. يمكنك جمع عدة قيم ونصوص في السطر نفسه.',
 field:'اعرض قيمة حقل من ملف واحد. اختر مصدر البيانات والحقل، ثم حدد ID واحدًا عند المعاينة.',
 table:'كل صف يأتي من ملف أو بطاقة. اختر الأعمدة ورتّبها، ثم فعّل إجمالي الأعمدة الرقمية عند الحاجة.',
 repeat:'يتكرر هذا النص لكل ملف أو بطاقة مطابقة. أدرج الحقول من القائمة لتعبئتها تلقائيًا.',
 metric:'اعرض حسابًا محفوظًا يمكن استخدامه في أكثر من موضع. تفسير الرقم متاح بعد إنشاء التقرير.',
 chart:'اختر مؤشراتك المحفوظة لمقارنتها في رسم أعمدة أو خطي أو دائري.', cover:'صفحة تقديم للتقرير؛ أضف العنوان والتاريخ واسم الجهة.',
 toc:'فهرس بالعناوين وأرقام الصفحات؛ تُحسب أرقام الصفحات في معاينة PDF.',pagebreak:'ابدأ الجزء التالي على صفحة جديدة في PDF.'
};
let dragged=null,dragPointer=null,dragFrame=null;
function scrollWhileDragging(){
 if(!dragged){dragFrame=null;return;}
 if(dragPointer){const rect=body.getBoundingClientRect();if(dragPointer.y>rect.top&&dragPointer.y<rect.bottom){const shift=dragPointer.y<rect.top+60?-12:dragPointer.y>rect.bottom-60?12:0;if(shift)body.scrollTop+=shift;}}
 dragFrame=requestAnimationFrame(scrollWhileDragging);
}
dialog.addEventListener('dragover',e=>{if(dragged)dragPointer={x:e.clientX,y:e.clientY};});
function makeBlock(type){
 const b={id:uid('block',model.document.blocks),type,title:'',text:['heading','text','cover','repeat'].includes(type)?(type==='heading'?'عنوان جديد':'اكتب النص هنا.') : ''};
 if(['table','repeat','field'].includes(type)){b.dataset=Object.keys(model.document.datasets)[0]||'';b.columns=['id'];}
 if(type==='metric')b.metric=Object.keys(model.document.metrics)[0]||'';
 if(type==='chart'){b.chart='bar';b.metrics=Object.keys(model.document.metrics).slice(0,2);}
 return b;
}
function selectBlock(id){const scroll=body.scrollTop;active=id;render();body.scrollTop=scroll;if(window.matchMedia('(max-width: 1100px)').matches)body.querySelector('.studio-properties')?.scrollIntoView({block:'nearest'});}
function addBlock(type,index=model.document.blocks.length){
 if(!kinds[type])return;
 mutate(()=>{const b=makeBlock(type);model.document.blocks.splice(index,0,b);active=b.id;});
 status('أُضيفت '+kinds[type]+'. اضبط محتواها في لوحة الإعدادات.');
 body.querySelector(`[data-block="${active}"]`)?.scrollIntoView({block:'nearest',behavior:'auto'});
}
function moveBlock(id,index){
 const from=model.document.blocks.findIndex(b=>b.id===id);if(from<0)return;
 const destination=index-(from<index?1:0);if(from===destination)return;
 mutate(()=>{const [b]=model.document.blocks.splice(from,1);model.document.blocks.splice(destination,0,b);active=id;});
 status('نُقلت الكتلة إلى الموضع '+(destination+1)+'. يمكن التراجع عن النقل.');
}
function dragStart(e,payload){
 if(busy){e.preventDefault();return;}
 dragged=payload;e.dataTransfer.effectAllowed=payload.kind?'copy':'move';
 e.dataTransfer.setData('application/x-schemacraft-block',JSON.stringify(payload));
 dialog.classList.add('studio-dragging');if(!dragFrame)dragFrame=requestAnimationFrame(scrollWhileDragging);
}
function endDrag(){dragged=null;dragPointer=null;if(dragFrame)cancelAnimationFrame(dragFrame);dragFrame=null;dialog.classList.remove('studio-dragging');dialog.querySelectorAll('.drop-active').forEach(e=>e.classList.remove('drop-active'));}
dialog.addEventListener('dragend',endDrag);
function dropZone(index){
 const zone=node('div','','studio-drop-zone');zone.dataset.dropIndex=index;
 const insert=btn('+',()=>{const d=inspectDialog('إضافة كتلة في هذا الموضع');const choices=node('div','','studio-insert-grid');for(const [type,name] of Object.entries(kinds))choices.append(btn(name,()=>{d.dialog.close();addBlock(type,index);}));d.content.append(choices);});
 insert.setAttribute('aria-label','إضافة كتلة في الموضع '+(index+1));zone.append(insert,node('span','أفلت الكتلة هنا'));
 zone.ondragover=e=>{if(!dragged||busy)return;e.preventDefault();e.dataTransfer.dropEffect=dragged.kind?'copy':'move';zone.classList.add('drop-active');};
 zone.ondragleave=e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drop-active');};
 zone.ondrop=e=>{e.preventDefault();e.stopPropagation();const payload=dragged;endDrag();if(!payload||busy)return;if(payload.kind)addBlock(payload.kind,index);else moveBlock(payload.id,index);};
 return zone;
}
function blockIssue(b){
 if(['field','table','repeat'].includes(b.type)&&!model.document.datasets[b.dataset])return 'اختر مصدر البيانات';
 if(b.type==='field'&&!b.field)return 'اختر الحقل';
 if(b.type==='table'&&!b.columns?.length)return 'اختر أعمدة الجدول';
 if(b.type==='metric'&&!model.document.metrics[b.metric])return 'اختر المؤشر';
 if(b.type==='chart'&&!b.metrics?.length)return 'اختر مؤشرات الرسم';
 return '';
}
function sampleInto(p,b){
 p.replaceChildren();p.classList.toggle('studio-sample-unconfigured',!!blockIssue(b));
 if(b.title)p.append(node('h3',b.title));
 const metricName=n=>model.document.metrics[n]?.title||n;
 const friendly=text=>String(text||'').replace(/\{\{([^}]+)\}\}/g,(_,key)=>'⟦ '+(key.startsWith('value:')?inlineLabel(key):key==='date'?'التاريخ':metricName(key)!==key?metricName(key):fieldOptions(b.dataset,true).find(([id])=>id===key.replace(/^field:/,''))?.[1]||key)+' ⟧');
 if(['text','heading','cover','repeat'].includes(b.type)){
  const content=node(b.type==='heading'?'h2':'div');
  if(b.type==='heading')content.textContent=friendly(b.text)||'عنوان جديد';
  else window.ReportRendering.renderMarkdown(friendly(b.text)||'اكتب محتوى هذه الكتلة…',content,[]);
  p.append(content);if(b.type==='repeat')p.append(node('small','↻ يتكرر لكل '+(model.document.datasets[b.dataset]?.scope==='card'?'بطاقة':'ملف')+' مطابق','studio-sample-caption'));
 }else if(b.type==='table'){
  const table=node('table','','studio-sample-table'),head=node('tr');
  (b.columns?.length?b.columns:['id']).forEach(id=>head.append(node('th',fieldOptions(b.dataset,true).find(f=>f[0]===id)?.[1]||id)));table.append(head);
  for(let i=0;i<2;i++){const row=node('tr');for(const id of b.columns?.length?b.columns:['id'])row.append(node('td','—'));table.append(row);}p.append(table,node('small','تُملأ الصفوف من الملفات المختارة عند المعاينة.','studio-sample-caption'));
 }else if(b.type==='metric')p.append(node('small',metricName(b.metric)||'مؤشر مرتبط'),node('strong','⟦ القيمة المحسوبة ⟧','studio-metric-sample'));
 else if(b.type==='field')p.append(node('small',fieldOptions(b.dataset).find(f=>f[0]===b.field)?.[1]||'اختر الحقل'),node('strong','⟦ قيمة من الملف ⟧','studio-metric-sample'));
 else if(b.type==='chart'){
  const chart=node('div','','studio-chart-sample');chart.setAttribute('aria-hidden','true');
  if(b.chart==='pie')chart.append(node('div','','studio-pie-sample'));
  else{chart.classList.add(b.chart==='line'?'is-line':'is-bar');[40,75,55,90].forEach(height=>{const bar=node('i');bar.style.height=height+'%';chart.append(bar);});}
  p.append(chart,node('small',(b.metrics||[]).map(metricName).join(' · ')||'اختر المؤشرات','studio-sample-caption'),node('small','شكل توضيحي؛ القيم الفعلية تظهر في المعاينة.','studio-sample-caption'));
 }else if(b.type==='toc')p.append(node('p','فهرس المحتويات'),node('small','العناوين ................................ أرقام الصفحات','studio-sample-caption'));
 else p.append(node('p','فاصل صفحة','studio-page-break'));
 const issue=blockIssue(b);if(issue)p.append(node('small',issue,'studio-block-issue'));
}
function refreshBlockSample(){
 if(tab!=='blocks'||!model)return;
 const b=model.document.blocks.find(b=>b.id===active),sample=body.querySelector('.studio-block.selected .studio-block-sample');
 if(b&&sample)sampleInto(sample,b);
}
function renderBlocks(){
 const intro=node('div','','studio-design-heading');intro.append(node('div','اسحب · رتّب · خصّص','studio-title'),node('p','اسحب من مكتبة الكتل إلى علامة + بين العناصر. اضغط كتلة لتعديلها.','muted-text'));
 const starters=node('div','','studio-starters');starters.append(node('span','ابدأ أسرع:'),btn('ملخص مع مؤشرات',()=>starter('summary')),btn('جدول ملفات',()=>starter('table')),btn('ملف تفصيلي',()=>starter('profile')));intro.append(starters);body.append(intro);
 const layout=node('div','','studio-layout'),palette=card('مكتبة الكتل');palette.classList.add('studio-palette');
 for(const [group,types] of [['نص وتنسيق',['heading','text','cover','toc','pagebreak']],['بيانات وحسابات',['field','table','repeat','metric','chart']]]){
  palette.append(node('h4',group));for(const type of types){const add=btn('+ '+kinds[type],()=>addBlock(type,model.document.blocks.some(b=>b.id===active)?model.document.blocks.findIndex(b=>b.id===active)+1:undefined));add.draggable=true;add.dataset.paletteType=type;add.ondragstart=e=>dragStart(e,{kind:type});add.setAttribute('aria-description',blockHelp[type]+' يمكن السحب أو الضغط لإضافتها.');palette.append(add);}
 }
 const canvas=node('div','','studio-canvas');canvas.id='studio-block-list';canvas.setAttribute('aria-label','ترتيب كتل المستند');
 canvas.append(node('div','معاينة التصميم · البيانات الفعلية في خطوة التطبيق','studio-paper-label'));
 if(!model.document.blocks.length)canvas.append(node('p','صفحة فارغة — اسحب أول كتلة هنا، أو اختر تخطيطًا جاهزًا.','studio-empty-canvas'));
 canvas.append(dropZone(0));
 model.document.blocks.forEach((b,i)=>{
  const c=node('section','','studio-block'+(b.id===active?' selected':''));c.dataset.block=b.id;
  const heading=node('div','','studio-block-heading'),handle=btn('⠿',()=>{active=b.id;render();});handle.draggable=true;handle.classList.add('studio-drag-handle');handle.setAttribute('aria-label','سحب '+kinds[b.type]+' في الموضع '+(i+1));handle.ondragstart=e=>dragStart(e,{id:b.id});
  const choose=btn((i+1)+' · '+kinds[b.type],()=>selectBlock(b.id));choose.setAttribute('aria-pressed',b.id===active?'true':'false');
  const up=btn('↑',()=>moveBlock(b.id,i-1)),down=btn('↓',()=>moveBlock(b.id,i+2));up.disabled=i===0;down.disabled=i===model.document.blocks.length-1;up.setAttribute('aria-label','نقل الكتلة إلى أعلى');down.setAttribute('aria-label','نقل الكتلة إلى أسفل');
  heading.append(handle,choose,up,down,btn('نسخ',()=>mutate(()=>{const clone={...copy(b),id:uid('block',model.document.blocks)};model.document.blocks.splice(i+1,0,clone);active=clone.id;})),btn('حذف',()=>mutate(()=>{model.document.blocks.splice(i,1);active=model.document.blocks[Math.min(i,model.document.blocks.length-1)]?.id||null;})));
  const sample=node('div','','studio-block-sample');sampleInto(sample,b);sample.onclick=()=>selectBlock(b.id);c.append(heading,sample);canvas.append(c,dropZone(i+1));
 });
 const props=card('إعدادات الكتلة المختارة');props.classList.add('studio-properties');const block=model.document.blocks.find(b=>b.id===active);
 if(block){props.append(node('div',kinds[block.type],'studio-selected-kind'));blockProps(props,block);}else props.append(node('p','اضغط كتلة داخل الصفحة لتظهر إعداداتها هنا.'),node('p','يمكنك أيضًا إضافة كتلة بالضغط على اسمها، ونقلها بأزرار أعلى وأسفل.','muted-text'));
 layout.append(palette,canvas,props);body.append(layout);
}
async function setupData(block=null,mode=null){
 if(!catalog.length)throw Error('أضف تصميمًا يحتوي على حقول أولًا.');
 const existing=model.document.datasets[block?.dataset];let schemaId=existing?.schema_id||catalog[0].id,scope=existing?.scope||'profile',categoryId=existing?.category_id||'',name=existing?.title||'',numeric='';
 const wrap=node('div'),categoryBox=node('div'),numericBox=node('div');
 const updateChoices=()=>{const schema=catalog.find(s=>s.id===schemaId);categoryBox.replaceChildren();if(scope==='card')categoryBox.append(label('الفئة المتكررة',select(categoryId,[['','اختر الفئة'],...(schema?.categories||[]).filter(c=>c.kind!=='main').map(c=>[c.id,c.label])],v=>{categoryId=v;updateNumeric();})));updateNumeric();};
 const updateNumeric=()=>{numericBox.replaceChildren();if(mode!=='summary')return;const fields=(catalog.find(s=>s.id===schemaId)?.fields||[]).filter(f=>f.type==='number'&&(!f.repeated||scope==='card'&&f.category_id===categoryId));if(!fields.some(f=>f.id===numeric))numeric=fields[0]?.id||'';numericBox.append(label('حقل رقمي للتلخيص (اختياري)',select(numeric,[['','عدد الملفات فقط'],...fields.map(f=>[f.id,f.label])],v=>{numeric=v;})));};
 wrap.append(label('التصميم الذي يحتوي على البيانات',select(schemaId,catalog.map(s=>[s.id,s.name]),v=>{schemaId=v;categoryId='';updateChoices();})),label('ماذا يمثل كل صف؟',select(scope,[['profile','ملف واحد لكل شخص'],['card','بطاقة من فئة متكررة']],v=>{scope=v;updateChoices();})),categoryBox,numericBox,label('اسم مجموعة البيانات',input(name,v=>{name=v;})),node('p','ستختار الأشخاص في خطوة التطبيق. يمكنك إضافة الشروط وترتيب الصفوف من خطوة البيانات.','studio-help'));updateChoices();
 if(!await ask(mode?'إعداد التخطيط الجاهز':'مصدر بيانات الكتلة','اختر المصدر، وسنربط الكتل به تلقائيًا.',wrap,()=>{if(scope==='card'&&!categoryId)throw Error('اختر الفئة المتكررة قبل المتابعة.');}))return;
 mutate(()=>{
  const sameSource=existing&&existing.schema_id===schemaId&&existing.scope===scope&&(scope!=='card'||existing.category_id===categoryId);
  const id=sameSource?block.dataset:uid('data',model.document.datasets);model.document.datasets[id]={...(sameSource?copy(existing):{}),title:name.trim()||catalog.find(s=>s.id===schemaId).name,schema_id:schemaId,scope,category_id:scope==='card'?categoryId:'',slot:existing?.slot||'الملفات',criteria:sameSource?copy(existing.criteria||[]):[]};
  if(block){block.dataset=id;if(!sameSource){block.columns=['id'];block.field='';block.sum_fields=[];}active=block.id;return;}
  const ds=model.document.datasets[id],fields=fieldOptions(id).slice(0,4).map(f=>f[0]);
  const blocks=[{id:'heading1',type:'heading',text:model.title},{id:'text1',type:'text',text:'أُعدّ التقرير في {{date}}.'}];
  if(mode==='summary'){
   const count=uid('metric',model.document.metrics);model.document.metrics[count]={title:'عدد الملفات',kind:'aggregate',dataset:id,function:'profile_count',decimals:0,suffix:''};blocks.push({id:'count1',type:'metric',metric:count});
   if(numeric){const total=uid('metric',model.document.metrics);model.document.metrics[total]={title:'المجموع',kind:'aggregate',dataset:id,field:numeric,function:'sum',decimals:2,suffix:''};blocks.push({id:'total1',type:'metric',metric:total});}
  }
  if(mode==='profile')blocks.push({id:'repeat1',type:'repeat',dataset:id,row_title:'ملف {{id}}',text:fields.map(f=>(fieldOptions(id).find(x=>x[0]===f)?.[1]||f)+': {{field:'+f+'}}').join('\n\n'),page_per_row:true});
  else blocks.push({id:'table1',type:'table',title:'تفاصيل الملفات',dataset:id,columns:['id',...fields],sum_fields:numeric?[numeric].filter(f=>fields.includes(f)):[]});
  model.document.blocks=blocks;active=blocks[blocks.length-1].id;
 });status('التخطيط جاهز. خصّص الكتل أو انتقل إلى التطبيق لاختيار الملفات.');
}
async function starter(mode){
 if((model.document.blocks.length>2||Object.keys(model.document.datasets).length)&&!await ask('تخطيط جاهز','استبدال ترتيب الكتل الحالي؟ تبقى مصادر البيانات والمؤشرات، ويمكن التراجع.'))return;
 await setupData(null,mode);
}
async function deleteTemplate(){
 if(!identity)throw Error('اختر قالبًا محفوظًا أولًا.');
 if(!await ask('حذف القالب','حذف القالب المحفوظ؟ ستبقى النسخة المفتوحة ويمكن حفظها باسم جديد.'))return;
 await api({action:'delete',id:identity.id,revision:identity.revision});identity=null;templateDirty=true;await loadTemplates();top();status('حُذف القالب المحفوظ؛ النسخة المفتوحة باقية.');
}

function inlineLabel(token){const [,ds,f]=token.split(':');return (model.document.datasets[ds]?.title||ds)+' / '+(fieldOptions(ds,true).find(x=>x[0]===f)?.[1]||f);}
async function insertLiveValue(ta,b,update){
 const start=ta.selectionStart,end=ta.selectionEnd;
 const wrap=node('div'),choices=node('div'),preview=node('p','','studio-help');let type='field',dataset=Object.keys(model.document.datasets)[0]||'',field='',metric=Object.keys(model.document.metrics)[0]||'',query='';
 const redraw=()=>{
  choices.replaceChildren();searchField.hidden=!['field','row'].includes(type);
  if(type==='field'){
   choices.append(label('مصدر القيمة',select(dataset,[['','اختر مجموعة البيانات'],...Object.entries(model.document.datasets).map(([id,d])=>[id,d.title])],v=>{dataset=v;field='';redraw();})));
   const available=fieldOptions(dataset,true).filter(([id])=>model.document.datasets[dataset]?.scope==='card'||!['card_id','parent_id'].includes(id));
   const filtered=available.filter(([id,name])=>(name+' '+id).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
   choices.append(label('الحقل داخل الجملة',select(field,[['','اختر الحقل'],...filtered],v=>{field=v;updatePreview();})));
   if(!dataset)choices.append(node('p','أضف مجموعة من خطوة البيانات أولًا. يمكنك تخصيص مجموعة لشخص واحد ومجموعة أخرى للإحصاءات.','studio-property-help'));
  }else if(type==='metric')choices.append(label('الحساب داخل الجملة',select(metric,[['','اختر المؤشر'],...Object.entries(model.document.metrics).map(([id,m])=>[id,m.title])],v=>{metric=v;updatePreview();})));
  else if(type==='row')choices.append(label('حقل الصف الحالي',select(field,[['','اختر الحقل'],...fieldOptions(b.dataset,true).filter(([id,name])=>(name+' '+id).toLocaleLowerCase().includes(query.toLocaleLowerCase()))],v=>{field=v;updatePreview();})));
  updatePreview();
 };
 const token=()=>type==='date'?'date':type==='metric'?metric:type==='row'?(['id','card_id','parent_id'].includes(field)?field:'field:'+field):'value:'+dataset+':'+field;
 const updatePreview=()=>{preview.textContent=type==='field'?'تظهر القيمة في موضع المؤشر داخل الجملة. يجب أن تعيد هذه المجموعة صفًا واحدًا؛ حدد ID واحدًا أو شروطًا دقيقة.':type==='row'?'تتغير القيمة لكل ملف أو بطاقة في القسم المتكرر.':'أدرج عدة قيم في الجملة نفسها. ستُحسب عند إنشاء التقرير.';};
 const searchField=label('البحث عن حقل',input('',v=>{query=v;field='';redraw();},'search'));
 wrap.append(label('نوع القيمة',select(type,[['field','قيمة حقل من ملف'],['metric','حساب محفوظ'],['date','تاريخ التقرير'],...(b.type==='repeat'?[['row','حقل من الصف المتكرر']]:[])],v=>{type=v;field='';redraw();})),searchField,choices,preview);redraw();
 if(!await ask('إدراج قيمة داخل النص','ضع المؤشر بين الكلمات ثم اختر القيمة. يبقى النص والقيم في السطر نفسه.',wrap,()=>{if(type==='field'&&(!model.document.datasets[dataset]||!field))throw Error('اختر مصدر القيمة والحقل.');if(type==='row'&&!field)throw Error('اختر حقل الصف.');if(type==='metric'&&!model.document.metrics[metric])throw Error('أنشئ أو اختر مؤشرًا من خطوة المؤشرات.');}))return;
 remember();ta.setSelectionRange(start,end);ta.setRangeText('{{'+token()+'}}',start,end,'end');update('text',ta.value);ta.focus();
}
function blockProps(c,b){
 const update=(k,v)=>{b[k]=v;changed();};
 c.append(node('p',blockHelp[b.type]||'', 'studio-property-help'));
 if(['field','table','repeat'].includes(b.type))c.append(btn(b.dataset?'تغيير / إعداد مصدر البيانات':'اختيار بيانات هذه الكتلة',()=>setupData(b)));
 if(['metric','chart'].includes(b.type))c.append(btn('إعداد المؤشرات',()=>{tab='metrics';render();}));
 if(!['pagebreak','toc'].includes(b.type))c.append(label('عنوان الكتلة',input(b.title,v=>update('title',v))));
 if(['heading','text','cover','repeat'].includes(b.type)){
 const ta=input(b.text,v=>update('text',v),'textarea');ta.id='studio-block-text';c.append(label('محتوى الكتلة',ta));c.append(btn('إدراج قيمة داخل النص',()=>insertLiveValue(ta,b,update),true),node('small','مثال: المستفيد ⟦الاسم⟧ لديه ⟦عدد الطلبات⟧ طلبات. اكتب النص حول القيم بحرية.','studio-inline-example'));const chips=node('div','','studio-chips');chips.append(btn('التاريخ',()=>{remember();ta.setRangeText('{{date}}',ta.selectionStart,ta.selectionEnd,'end');update('text',ta.value);ta.focus();}));Object.entries(model.document.metrics).forEach(([n,m])=>chips.append(btn(m.title,()=>{remember();ta.setRangeText('{{'+n+'}}',ta.selectionStart,ta.selectionEnd,'end');update('text',ta.value);ta.focus();})));[['نص بارز','**نص**'],['قائمة','\n- عنصر'],['عنوان فرعي','\n### عنوان']].forEach(([name,token])=>chips.append(btn(name,()=>{remember();ta.setRangeText(token,ta.selectionStart,ta.selectionEnd,'end');update('text',ta.value);ta.focus();})));c.append(chips);
 }
 if(['table','repeat','field'].includes(b.type)){
 c.append(label('مجموعة البيانات',select(b.dataset,[['','اختر البيانات'],...Object.entries(model.document.datasets).map(([k,d])=>[k,d.title])],v=>mutate(()=>{b.dataset=v;b.columns=['id'];b.sum_fields=[];b.text=b.type==='repeat'?'ملف {{id}}':'';}))));
 if(b.type==='field'){c.append(label('الحقل الفردي — صف مطابق واحد',select(b.field||'',[['','اختر الحقل'],...fieldOptions(b.dataset)],v=>{b.field=v;changed();})));}
 else if(b.type==='table'){
 c.append(label('الأعمدة بالترتيب المحدد',multi(b.columns||[],fieldOptions(b.dataset,true),v=>mutate(()=>{b.columns=v;b.sum_fields=(b.sum_fields||[]).filter(f=>v.includes(f));}))));
 const order=node('div','','studio-column-order');(b.columns||[]).forEach((id,i)=>{const row=node('div');const up=btn('↑',()=>mutate(()=>{[b.columns[i-1],b.columns[i]]=[id,b.columns[i-1]];}));up.disabled=!i;up.setAttribute('aria-label','تقديم العمود '+(fieldOptions(b.dataset,true).find(f=>f[0]===id)?.[1]||id));row.append(node('span',fieldOptions(b.dataset,true).find(f=>f[0]===id)?.[1]||id),up);order.append(row);});c.append(order);
 c.append(label('إجمالي الأعمدة الرقمية',multi(b.sum_fields||[],fieldOptions(b.dataset).filter(([id])=>(b.columns||[]).includes(id)),v=>mutate(()=>{b.sum_fields=v;}))));
 }else{
 c.append(label('عنوان كل صف',input(b.row_title||'ملف {{id}} — بطاقة {{card_id}}',v=>update('row_title',v))),check('صفحة مستقلة لكل صف',b.page_per_row,v=>update('page_per_row',v)));
 const picker=select('',[['','أدرج حقلًا في النص'],...fieldOptions(b.dataset,true)],v=>{if(!v)return;const ta=$('studio-block-text');const token=['id','card_id','parent_id'].includes(v)?v:'field:'+v;remember();ta.setRangeText('{{'+token+'}}',ta.selectionStart,ta.selectionEnd,'end');update('text',ta.value);ta.focus();});c.append(picker);
 }
 }
 if(b.type==='metric')c.append(label('المؤشر',select(b.metric,[['','اختر المؤشر'],...Object.entries(model.document.metrics).map(([k,m])=>[k,m.title])],v=>mutate(()=>{b.metric=v;}))));
 if(b.type==='chart'){c.append(label('نوع الرسم',select(b.chart||'bar',[['bar','أعمدة'],['line','خطي'],['pie','دائري']],v=>mutate(()=>{b.chart=v;}))),label('المؤشرات المتصلة',multi(b.metrics||[],Object.entries(model.document.metrics).map(([k,m])=>[k,m.title]),v=>mutate(()=>{b.metrics=v;}))));}
 const conditional=node('details');conditional.append(node('summary','عرض مشروط'));conditional.append(label('اعرض إذا كان المؤشر',select(b.when?.metric||'',[['','عرض دائم'],...Object.entries(model.document.metrics).map(([k,m])=>[k,m.title])],v=>mutate(()=>{b.when=v?{metric:v,op:'gt',value:0}:null;}))));if(b.when){conditional.append(select(b.when.op,[['gt','>'],['gte','≥'],['lt','<'],['lte','≤'],['eq','='],['ne','≠']],v=>{b.when.op=v;changed();}),input(b.when.value,v=>{b.when.value=Number(v);changed();},'number'));}c.append(conditional);
}
function renderData(){
 body.append(node('p','حدد وحدة الصف بوضوح: ملف واحد أو بطاقة واحدة. شروط البطاقات تُطبّق على البطاقة نفسها. حقول الفئات الرئيسية متاحة في كلا النطاقين.','studio-help'));
 body.append(btn('+ مجموعة بيانات',()=>mutate(()=>{const id=uid('data',model.document.datasets);model.document.datasets[id]={title:'بيانات جديدة',schema_id:catalog[0]?.id||'',slot:'الملفات',scope:'profile',criteria:[]};}),true));
 const grid=node('div','','studio-form-grid');for(const [id,d] of Object.entries(model.document.datasets)){
 const c=card(d.title);c.append(label('الاسم',input(d.title,v=>{d.title=v;changed();})),label('التصميم',select(d.schema_id,catalog.map(s=>[s.id,s.name]),v=>mutate(()=>{d.schema_id=v;d.category_id='';d.scope='profile';d.criteria=[];d.sort_field='';}))),label('كل صف يمثل',select(d.scope,[['profile','ملفًا واحدًا'],['card','بطاقة متكررة واحدة']],v=>mutate(()=>{d.scope=v;d.criteria=[];}))));
 if(d.scope==='card')c.append(label('الفئة المتكررة',select(d.category_id||'',[['','اختر الفئة'],...(catalog.find(s=>s.id===d.schema_id)?.categories||[]).filter(x=>x.kind!=='main').map(x=>[x.id,x.label])],v=>mutate(()=>{d.category_id=v;d.criteria=[];}))));
 c.append(label('الملفات التي تدخل في التقرير',select(d.selection||'selected',[['selected','IDs أحددها عند التطبيق'],['all','كل ملفات هذا التصميم']],v=>mutate(()=>{d.selection=v;}))));if(d.selection==='all')c.append(check('تضمين الملفات المؤرشفة',!!d.include_archived,v=>{d.include_archived=v;changed();}),node('p','يقرأ أحدث الملفات عند الإنشاء والتحديث. تُطبق الشروط التالية على هذه الملفات. الحد 5000 صف لكل مجموعة.','studio-property-help'));
 const advanced=node('details','','studio-data-advanced');advanced.append(node('summary','شروط البيانات وترتيبها — اختياري'),label('مجموعة الملفات المستخدمة',input(d.slot,v=>{d.slot=v;changed();})),node('p','المجموعات التي تحمل الاسم نفسه تستخدم IDs نفسها عند التطبيق.','studio-property-help'));
 advanced.append(label('ترتيب الصفوف حسب',select(d.sort_field||'',[['','ترتيب المصدر'],...fieldOptions(id,true)],v=>{d.sort_field=v;changed();})),select(d.sort_direction||'asc',[['asc','تصاعدي'],['desc','تنازلي']],v=>{d.sort_direction=v;changed();}),label('مطابقة الشروط',select(d.condition_mode||'all',[['all','كل الشروط AND'],['any','أي شرط OR']],v=>{d.condition_mode=v;changed();})));
 (d.criteria||[]).forEach((r,i)=>{const row=node('div','','studio-filter');row.append(select(r.field,fieldOptions(id),v=>{r.field=v;changed();}),select(r.op,[['eq','يساوي'],['ne','لا يساوي'],['contains','يحتوي'],['gt','>'],['gte','≥'],['lt','<'],['lte','≤']],v=>{r.op=v;changed();}),input(r.value,v=>{r.value=v;changed();}),btn('×',()=>mutate(()=>d.criteria.splice(i,1))));advanced.append(row);});
 advanced.append(btn('+ شرط على الصف',()=>mutate(()=>{d.criteria.push({field:fieldOptions(id)[0]?.[0]||'',op:'eq',value:''});})),btn('حذف المجموعة',async()=>{if(await ask('حذف بيانات','ستحتاج إلى تعديل الكتل والمؤشرات التي تعتمد على هذه المجموعة. متابعة؟'))mutate(()=>delete model.document.datasets[id]);}));advanced.open=!!d.criteria?.length;c.append(advanced);grid.append(c);
 }body.append(grid);
}
const reducerChoices=[['profile_count','عدد الملفات دون تكرار'],['row_count','عدد الصفوف / البطاقات'],['count','عدد القيم غير الفارغة'],['empty_count','عدد القيم الفارغة'],['distinct_count','عدد القيم المختلفة'],['sum','المجموع'],['average','المتوسط'],['median','الوسيط'],['min','الأدنى'],['max','الأعلى']];
const conditionChoices=[['eq','يساوي'],['ne','لا يساوي'],['contains','يحتوي'],['gt','أكبر من'],['gte','أكبر أو يساوي'],['lt','أصغر من'],['lte','أصغر أو يساوي'],['empty','فارغ'],['not_empty','غير فارغ']];
function metricConditions(c,m){
 const box=node('details','','studio-metric-conditions');box.open=!!m.criteria?.length;box.append(node('summary','شروط هذا الحساب فقط · '+(m.criteria?.length||0)),node('p','تُطبّق بعد شروط مجموعة البيانات. مثال: عدد الملفات التي حالتها «نشط»، دون تغيير بقية المؤشرات.','studio-property-help'),label('طريقة مطابقة شروط الحساب',select(m.condition_mode||'all',[['all','كل الشروط AND'],['any','أي شرط OR']],v=>{m.condition_mode=v;changed();})));
 (m.criteria||[]).forEach((r,i)=>{const row=node('div','','studio-filter studio-metric-filter');row.append(label('حقل الشرط',select(r.field,fieldOptions(m.dataset,true),v=>{r.field=v;changed();})),label('المقارنة',select(r.op,conditionChoices,v=>mutate(()=>{r.op=v;}))));if(!['empty','not_empty'].includes(r.op))row.append(label('قيمة الشرط',input(r.value,v=>{r.value=v;changed();})));row.append(btn('حذف الشرط',()=>mutate(()=>m.criteria.splice(i,1))));box.append(row);});
 box.append(btn('+ شرط لهذا الحساب',()=>mutate(()=>{(m.criteria||=[]).push({field:fieldOptions(m.dataset,true)[0]?.[0]||'id',op:'eq',value:''});})));c.append(box);
}
function renderMetrics(){
 body.append(node('p','عرّف المؤشر مرة واحدة واستخدمه في النص والجداول والرسوم. المعادلات تقبل رموز المؤشرات والأرقام و + − * / والأقواس؛ القسمة على صفر تظهر كقيمة غير محسوبة.','studio-help'));
 body.append(btn('+ مؤشر',()=>mutate(()=>{const id=uid('metric',model.document.metrics);model.document.metrics[id]={title:'مؤشر جديد',kind:'aggregate',dataset:Object.keys(model.document.datasets)[0]||'',field:'',function:'sum',decimals:2,suffix:''};}),true));
 body.append(btn('+ عدد الملفات',()=>mutate(()=>{const id=uid('metric',model.document.metrics);model.document.metrics[id]={title:'عدد الملفات',kind:'aggregate',dataset:Object.keys(model.document.datasets)[0]||'',function:'profile_count',decimals:0,criteria:[]};})));
 const grid=node('div','','studio-form-grid');for(const [id,m] of Object.entries(model.document.metrics)){
 const c=card(m.title);const code=node('code',id,'studio-code');code.title='رمز المؤشر عند إدراجه في معادلة';c.append(label('الاسم الظاهر',input(m.title,v=>{m.title=v;changed();})),label('نوع الحساب',select(m.kind||'aggregate',[['aggregate','تجميع بيانات'],['formula','معادلة من مؤشرات أخرى']],v=>mutate(()=>{m.kind=v;m.expression=m.expression||'';}))));
 if(m.kind==='formula'){c.append(node('p','اضغط أسماء المؤشرات لإدراجها، ثم أضف عملية حسابية مثل ÷ أو ×.','studio-property-help'));const exp=input(m.expression,v=>{m.expression=v;changed();});exp.dir='ltr';exp.placeholder='metric1 / metric2 * 100';c.append(label('المعادلة',exp));const chips=node('div','','studio-chips');for(const [n,item] of Object.entries(model.document.metrics)){if(n!==id)chips.append(btn(item.title+' · '+n,()=>{remember();exp.setRangeText(n,exp.selectionStart,exp.selectionEnd,'end');m.expression=exp.value;changed();exp.focus();}));}c.append(chips);}
 else {
 c.append(node('p','اختر ما تريد عدّه أو حسابه؛ أضف شروطًا خاصة بالمؤشر عند الحاجة.','studio-property-help'),label('البيانات',select(m.dataset,[['','اختر البيانات'],...Object.entries(model.document.datasets).map(([k,d])=>[k,d.title])],v=>mutate(()=>{m.dataset=v;m.field='';m.criteria=[];}))),label('الدالة',select(m.function,reducerChoices,v=>mutate(()=>{m.function=v;if(['profile_count','row_count','count','empty_count','distinct_count'].includes(v))m.decimals=0;}))));
 if(!['profile_count','row_count'].includes(m.function))c.append(label('الحقل',select(m.field,[['','اختر الحقل'],...fieldOptions(m.dataset)],v=>{m.field=v;changed();})));
 c.append(node('p',m.function==='profile_count'?'يُعدّ كل ID مرة واحدة، حتى مع وجود عدة بطاقات مطابقة. في بيانات البطاقات لا يدخل الملف الذي ليس له بطاقة مطابقة.':m.function==='row_count'?'كل صف مطابق يُعدّ مرة واحدة، بما في ذلك الصفوف ذات الحقول الفارغة.':'تُطبّق الدالة على الحقل المختار من الصفوف المطابقة. الصفر قيمة موجودة؛ الخلية الفارغة ليست صفرًا.','studio-property-help'));metricConditions(c,m);
 }
 c.append(label('المنازل العشرية',input(m.decimals??2,v=>{m.decimals=Number(v);changed();},'number')),label('الوحدة / اللاحقة',input(m.suffix,v=>{m.suffix=v;changed();})),btn('حذف المؤشر',async()=>{if(await ask('حذف مؤشر','قد تعتمد كتل أو معادلات أخرى على هذا المؤشر. متابعة؟'))mutate(()=>delete model.document.metrics[id]);}));grid.append(c);
 }body.append(grid);
}
async function chooseProfiles(slot,schemas){
 const d=node('dialog','','editor-dialog studio-small-dialog');d.dir='rtl';const h=node('div','','dialog-heading');h.append(node('h2','اختيار الملفات · '+slot));const c=node('div','','dialog-content');const chosen=new Set(bindings[slot]||[]);let offset=0,query='',archived=false,seq=0;
 const search=input('',v=>{query=v;offset=0;load().catch(e=>status(e.message,true));},'search');search.placeholder='ID أو المعلومات العامة';const list=node('div','','report-picker-rows'),footer=node('div','','dialog-actions'),count=node('span');let pageRows=[];
 const prev=btn('السابق',async()=>{offset=Math.max(0,offset-40);await load();}),next=btn('التالي',async()=>{offset+=40;await load();});
 const load=async()=>{const n=++seq;const r=await api({action:'profiles',schema_ids:schemas,query,offset,include_archived:archived});if(n!==seq||!d.open)return;list.replaceChildren();pageRows=r.profiles;r.profiles.forEach(p=>list.append(check(p.id+' · '+p.description,chosen.has(p.id),v=>{v?chosen.add(p.id):chosen.delete(p.id);count.textContent=chosen.size+' محدد / '+r.total+' نتيجة';})));prev.disabled=!offset;next.disabled=!r.has_more;count.textContent=chosen.size+' محدد / '+r.total+' نتيجة';};
 c.append(search,check('تضمين المؤرشفة',false,v=>{archived=v;offset=0;load().catch(e=>status(e.message,true));}),btn('تحديد الصفحة',async()=>{pageRows.forEach(p=>chosen.add(p.id));await load();}),list);footer.append(prev,count,next,btn('إلغاء',()=>d.close()),btn('اعتماد',()=>{if(chosen.size>500)throw Error('الحد 500 ملف للمجموعة.');bindings[slot]=[...chosen];dirty=true;d.close();render();},true));d.append(h,c,footer);d.onclose=()=>d.remove();document.body.append(d);d.showModal();await load();
}
function renderRun(){
 const issues=model.document.blocks.map((b,i)=>({b,i,message:blockIssue(b)})).filter(x=>x.message);
 if(issues.length){const checklist=node('section','','studio-readiness');checklist.append(node('strong','أكمل إعداد '+issues.length+' كتل قبل إنشاء التقرير'));issues.forEach(({b,i,message})=>checklist.append(btn((i+1)+' · '+kinds[b.type]+' — '+message,()=>{tab='blocks';active=b.id;render();body.querySelector('.studio-properties')?.scrollIntoView({block:'nearest'});})));body.append(checklist);}
 if(draft&&(JSON.stringify(model.document)!==JSON.stringify(draft.document_state.template.document)||JSON.stringify(bindings)!==JSON.stringify(draft.document_state.bindings)))body.append(node('p','المعاينة أدناه من آخر إنشاء. استخدم «إنشاء من القالب الحالي» لتطبيق تغييرات التصميم أو الملفات المختارة؛ تحديث البيانات يحافظ على إعدادات هذه المسودة.','studio-version-note'));
 const setup=card('');setup.classList.add('studio-run-setup');
 const slots=new Map();for(const d of Object.values(model.document.datasets)){if(d.selection==='all')continue;if(!slots.has(d.slot))slots.set(d.slot,new Set());slots.get(d.slot).add(d.schema_id);}
 const groups=node('div','','studio-form-grid');for(const d of Object.values(model.document.datasets).filter(d=>d.selection==='all'))groups.append(node('p',d.title+' · كل الملفات'+(d.include_archived?' مع المؤرشفة':' غير المؤرشفة'),'studio-help'));for(const [slot,schemas] of slots){const c=node('div','','report-binding-card');const ta=input((bindings[slot]||[]).join(', '),v=>{bindings[slot]=[...new Set(v.trim().split(/[\s,،;؛]+/).filter(Boolean).map(x=>x.toUpperCase()))];dirty=true;},'textarea');ta.rows=2;ta.dir='ltr';ta.dataset.studioSlot=slot;c.append(label(slot,ta),btn('اختيار من الملفات',()=>chooseProfiles(slot,[...schemas])));groups.append(c);}
 const settings=node('details');settings.append(node('summary','تصميم الصفحات'));const grid=node('div','','studio-form-grid');grid.append(label('اتجاه الصفحة',select(model.options.orientation,[['portrait','A4 عمودي'],['landscape','A4 أفقي']],v=>{model.options.orientation=v;applyOptions();})),label('لون العناوين',select(model.options.accent,[['blue','أزرق'],['teal','أخضر'],['slate','رمادي']],v=>{model.options.accent=v;applyOptions();})),label('حجم الخط',select(String(model.options.font_size),[9,10,11,12,14,16].map(n=>[String(n),String(n)]),v=>{model.options.font_size=Number(v);applyOptions();})),label('رأس الصفحة',input(model.options.header,v=>{model.options.header=v;applyOptions();})),label('تذييل الصفحة',input(model.options.footer,v=>{model.options.footer=v;applyOptions();})));settings.append(grid);const folding=node('details');folding.open=!draft;folding.append(node('summary','اختيار الملفات وإعداد الصفحة'),groups,settings);setup.append(folding);
 const actions=node('div','','report-toolbar');actions.append(btn('إنشاء من القالب الحالي',generate,true),btn('حفظ وصفة تشغيل',saveRecipe),btn('الوصفات والتصدير الجماعي',recipesDialog),btn('المسودات المحفوظة',draftsDialog));setup.append(actions);body.append(setup);
 if(!draft){body.append(node('p','أنشئ التقرير لعرض البيانات الفعلية ومصادر الأرقام. القالب لا يكتب أي تغييرات إلى الملفات.','report-empty'));return;}
 body.append(label('عنوان هذه النسخة',input(draft.title,v=>{draft.title=v;dirty=true;})));
 const tools=node('div','','studio-draft-actions');tools.append(btn('تحديث البيانات مع حفظ التعديلات',refreshDraft),btn('حفظ المسودة',()=>saveDraft()),btn('حفظ نسخة',()=>saveDraft(true)),btn('معاينة PDF',previewPDF),btn('تصدير PDF',exportPDF,true),btn('سجل التعديلات',historyDialog));body.append(tools);
 const state=draft.document_state;body.append(node('p','لقطة البيانات: '+new Date(draft.generated_at).toLocaleString('ar')+' · '+Object.keys(state.overrides).length+' تعديل يدوي · '+(draftIdentity?'مسودة محفوظة':'احفظ المسودة للعودة إليها لاحقًا'),'studio-snapshot'));
 if(draft.warnings.length)body.append(node('p',draft.warnings.join('\n'),'report-warning'));
 const counts=node('div','','studio-metric-strip');for(const [id,ds] of Object.entries(state.datasets))counts.append(btn(ds.definition.title+' · '+ds.rows.length+' صف مطابق',()=>datasetDialog(id)));body.append(counts);
 const page=node('article','','report-paper studio-preview');page.id='studio-preview';page.style.fontSize=draft.options.font_size+'pt';page.dataset.accent=draft.options.accent;page.dataset.orientation=draft.options.orientation;
 for(const b of state.rendered){const section=node('section','','studio-rendered-block');section.dataset.renderedBlock=b.id;const controls=node('div','','studio-inline-tools');
 if(['text','heading','cover','repeat'].includes(b.type))controls.append(btn(b.override?'تعديل يدوي · تحرير':'تحرير هذه النسخة',()=>overrideDialog('block:'+b.id)));
 if(b.type==='metric')controls.append(btn('تفسير الرقم',()=>metricDialog(b.metric)));
 if(b.type==='chart')b.metrics.forEach(n=>controls.append(btn('تفسير '+state.metrics[n].title,()=>metricDialog(n))));
 const definition=state.template.document.blocks.find(x=>x.id===b.id);
 const tokens=[...new Set([...((definition?.text||'')+' '+(definition?.title||'')+' '+(definition?.row_title||'')).matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]).filter(n=>state.metrics[n]))];
 for(const n of tokens)controls.append(btn('تفسير '+state.metrics[n].title,()=>metricDialog(n)));
 for(const ref of b.inline_sources||[])controls.append(btn('مصدر القيمة: '+(state.datasets[ref.dataset].labels[ref.field]||ref.field)+' · '+ref.id,()=>datasetDialog(ref.dataset)));
 if(b.cell_key)controls.append(btn('تحرير القيمة مع السبب',()=>overrideDialog(b.cell_key)));
 if(b.dataset)controls.append(btn('فحص الصفوف والقيم',()=>datasetDialog(b.dataset)));
 if(b.override)controls.append(node('span','معدّل يدويًا','studio-override-badge'));
 section.append(controls);const content=node('div');window.ReportRendering.renderMarkdown(b.body,content,draft.charts);section.append(content);page.append(section);
 }body.append(page);
}
function applyOptions(){changed();if(draft){draft.options=copy(model.options);dirty=true;}}
async function working(message,fn){busy=true;body.inert=true;toolbar.inert=true;tabs.inert=true;status(message);try{return await fn();}finally{busy=false;body.inert=false;toolbar.inert=false;tabs.inert=false;}}
async function generate(){if(draft&&(dirty||Object.keys(draft.document_state.overrides).length||draft.title!==draft.document_state.template.title)&&!await ask('إعادة إنشاء','الإنشاء من القالب الحالي يبدأ نسخة جديدة دون تعديلات المسودة. استخدم تحديث البيانات للحفاظ عليها. متابعة؟'))return;await working('جارٍ قراءة الصفوف وحساب المؤشرات…',async()=>{const r=await api({action:'document_generate',template:model,bindings});draft=r.draft;draftIdentity=null;dirty=true;});render();status('تم إنشاء التقرير. اضغط تفسير الرقم أو فحص الصفوف لمراجعة مصادره.');}
async function saveDraft(asCopy=false){if(!draft)throw Error('أنشئ التقرير أولًا.');await working('جارٍ حفظ المسودة…',async()=>{const r=await api({action:'draft_save',draft,id:asCopy?undefined:draftIdentity?.id,revision:asCopy?undefined:draftIdentity?.revision});draftIdentity={id:r.saved.id,revision:r.saved.revision};dirty=false;});status('حُفظت المسودة مع مصادر الأرقام والتعديلات.');}
async function previewPDF(){if(!draft)throw Error('أنشئ التقرير أولًا.');await working('جارٍ تجهيز الفهرس وصفحات PDF…',async()=>{const r=await api({action:'pdf_preview',draft});if(pdfURL)URL.revokeObjectURL(pdfURL);pdfURL=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.pdf),c=>c.charCodeAt(0))],{type:'application/pdf'}));});const d=node('dialog','','editor-dialog report-pdf-dialog');const heading=node('div','','dialog-heading');heading.append(node('h2','الصفحات الفعلية — PDF'),btn('إغلاق',()=>d.close()));const frame=node('iframe');frame.title='معاينة التقرير';frame.src=pdfURL;frame.style.cssText='width:100%;height:75vh;border:0';const content=node('div','','dialog-content');content.append(frame);const actions=node('div','','dialog-actions');actions.append(btn('إغلاق المعاينة',()=>d.close()));d.append(heading,content,actions);d.onclose=()=>{URL.revokeObjectURL(pdfURL);pdfURL=null;d.remove();};document.body.append(d);d.showModal();status('معاينة PDF جاهزة.');}
async function exportPDF(){if(!draft)throw Error('أنشئ التقرير أولًا.');const r=await working('جارٍ إنشاء PDF واختيار مكان الحفظ…',()=>api({type:'advanced_report',draft},'/api/export/save'));status(r.cancelled?'أُلغي التصدير؛ المسودة باقية.':'تم تصدير '+r.filename);}
function inspectDialog(title){const d=node('dialog','','editor-dialog studio-inspect');d.dir='rtl';const h=node('div','','dialog-heading');h.append(node('h2',title),btn('إغلاق',()=>d.close()));const c=node('div','','dialog-content');d.append(h,c);d.onclose=()=>d.remove();document.body.append(d);d.showModal();return {dialog:d,content:c};}
async function metricDialog(name){const s=draft.document_state,m=s.metrics[name],{content:c}=inspectDialog('تفسير الرقم · '+m.title);c.append(node('div',m.formatted,'studio-big-number'),node('p',m.definition.kind==='formula'?'المعادلة: '+m.definition.expression:'الدالة: '+(reducerChoices.find(x=>x[0]===m.definition.function)?.[1]||m.definition.function)+' · البيانات: '+s.datasets[m.definition.dataset].definition.title),node('p','القيمة المحسوبة قبل تجاوز المؤشر: '+String(s.baseline['metric:'+name]??'—')));
 if(m.matched_rows!=null)c.append(node('p',m.matched_rows+' صف مطابق · '+m.matched_profiles+' ملف دون تكرار.','studio-help'));
 if(m.override)c.append(node('p','تعديل يدوي: '+m.override.reason,'studio-override-badge'));
 c.append(btn('تعديل المؤشر مع السبب',()=>overrideDialog('metric:'+name)),...(m.override?[btn('استعادة الحساب',()=>resetOverride('metric:'+name))]:[]));
 for(const dep of m.dependencies)c.append(btn('المؤشر المصدر: '+s.metrics[dep].title+' = '+s.metrics[dep].formatted,()=>metricDialog(dep)));
 if(m.definition.dataset){const ds=s.datasets[m.definition.dataset];const describe=owner=>(owner.criteria||[]).map(r=>(ds.labels[r.field]||r.field)+' '+(conditionChoices.find(x=>x[0]===r.op)?.[1]||r.op)+' '+(r.value||'')).join(owner.condition_mode==='any'?' أو ':' و ')||'بدون شروط';c.append(node('p','شروط الحساب: '+describe(m.definition)),node('p',m.definition.function==='profile_count'?'كل مرجع أدناه يمثل ملفًا واحدًا بعد إزالة تكرار البطاقات.':''));c.append(node('p','شروط المجموعة: '+describe(ds.definition)),node('p',m.sources.length+' قيمة/مرجع مساهم في الحساب. الأرقام تعرض القيم الفعلية المستخدمة بعد تعديلات المسودة.'),btn('عرض الصفوف الأصلية والتعديلات',()=>datasetDialog(m.definition.dataset)));pagedTable(c,m.sources,['id','card_id','parent_id','value'],['ID','البطاقة','الأم','القيمة المستخدمة'],(r,k)=>r[k]);}
}
function pagedTable(host,rows,columns,labels,value,click){let offset=0;const wrapper=node('div','','studio-data-scroll'),footer=node('div','','report-toolbar');host.append(wrapper,footer);const render=()=>{wrapper.replaceChildren();const table=node('table','','studio-data-table'),thead=node('thead'),head=node('tr');labels.forEach(l=>head.append(node('th',l)));thead.append(head);table.append(thead);const tbody=node('tbody');rows.slice(offset,offset+40).forEach(row=>{const tr=node('tr');columns.forEach(k=>{const td=node('td');if(click&&click(row,k))td.append(btn(String(value(row,k)??'—'),()=>click(row,k)()));else td.textContent=String(value(row,k)??'—');tr.append(td);});tbody.append(tr);});table.append(tbody);wrapper.append(table);footer.replaceChildren();const prev=btn('السابق',()=>{offset=Math.max(0,offset-40);render();}),next=btn('التالي',()=>{offset+=40;render();});prev.disabled=!offset;next.disabled=offset+40>=rows.length;footer.append(prev,node('span',(rows.length?offset+1:0)+'–'+Math.min(offset+40,rows.length)+' / '+rows.length),next);};render();}
async function datasetDialog(name){const ds=draft.document_state.datasets[name],source=draft.document_state.sources[name],{content:c}=inspectDialog('مصادر البيانات · '+ds.definition.title);c.append(node('p','اضغط قيمة لتعديلها في هذه المسودة مع السبب. يعاد حساب المؤشرات والجداول والأقسام والرسوم المرتبطة. لا تتغير السجلات الأصلية.'));const cols=['id','card_id',...Object.keys(ds.labels).filter(k=>source.rows.some(r=>k in r.values))];const labels=cols.map(k=>({id:'ID',card_id:'البطاقة'}[k]||ds.labels[k]));pagedTable(c,ds.rows,cols,labels,(r,k)=>['id','card_id'].includes(k)?r[k]:r.values[k],(r,k)=>['id','card_id'].includes(k)?null:()=>overrideDialog('cell:'+name+':'+r.key+':'+k));
 const details=node('details');details.append(node('summary','مقارنة القيم الأصلية والتعديلات'));for(const [k,o] of Object.entries(draft.document_state.overrides).filter(([k])=>k.startsWith('cell:'+name+':'))){details.append(node('p',k+' · الأصل: '+String(draft.document_state.baseline[k]??'—')+' → '+o.value+' · السبب: '+o.reason),btn('استعادة الأصل',()=>resetOverride(k)));}c.append(details);
}
async function overrideDialog(key){
 const state=draft.document_state,o=state.overrides[key];const wrap=node('div');let value=o?.value??state.baseline[key],reason=o?.reason||'';const numeric=key.startsWith('metric:')||typeof state.baseline[key]==='number';wrap.append(node('p','القيمة الأصلية: '+String(state.baseline[key]??'—')),label('القيمة في هذه النسخة',input(value,v=>{value=numeric&&v!==''?Number(v):v;},key.startsWith('block:')?'textarea':numeric?'number':'text')),label('سبب التعديل',input(reason,v=>{reason=v;})));
 if(await ask('تعديل يدوي موثّق','سيبقى هذا التعديل عند تحديث البيانات. ستظهر مراجعة إذا تغيّر المصدر.',wrap,()=>{if(!reason.trim())throw Error('اكتب سبب التعديل قبل اعتماده.');if(numeric&&(typeof value!=='number'||!Number.isFinite(value)))throw Error('أدخل قيمة رقمية صالحة.');})){
 const r=await working('جارٍ إعادة حساب التعديل…',()=>api({action:'document_edit',draft,changes:[{key,value,reason}]}));draft=r.draft;dirty=true;render();status('تم التعديل وإعادة حساب العناصر المرتبطة.');}
}
async function resetOverride(key){const r=await working('جارٍ استعادة القيمة…',()=>api({action:'document_edit',draft,changes:[{key,reset:true}]}));draft=r.draft;dirty=true;render();status('استُعيدت القيمة المحسوبة وأُعيد حساب العناصر المرتبطة.');}
async function refreshDraft(){
 const r=await working('جارٍ مقارنة أحدث البيانات بالمسودة…',()=>api({action:'document_refresh',draft}));const candidate=r.draft,s=candidate.document_state;const wrap=node('div');wrap.append(node('p',s.changes.length+' قيم تغيرت في المصدر · '+s.conflicts.length+' تعارضات مع تعديلات يدوية. تحديث البيانات يستخدم نسخة القالب واختيارات الملفات الأصلية التي أُنشئت منها المسودة.'));
 const decisions=new Map();for(const conflict of s.conflicts){const row=card(conflict.key);row.append(node('p','السابق: '+String(conflict.old??'—')+' · المصدر الجديد: '+String(conflict.new??'صف محذوف')+' · التعديل اليدوي: '+conflict.override));if(conflict.missing){decisions.set(conflict.key,'source');row.append(node('p','الصف لم يعد موجودًا؛ سيُزال تجاوزه من المسودة.'));}else{decisions.set(conflict.key,'keep');row.append(select('keep',[['keep','احتفظ بالتعديل اليدوي'],['source','استخدم المصدر الجديد']],v=>decisions.set(conflict.key,v)));}wrap.append(row);}
 const details=node('details');details.append(node('summary','كل التغييرات'));pagedTable(details,s.changes,['key','old','new'],['الموضع','السابق','الجديد'],(row,k)=>row[k]);wrap.append(details);
 if(!await ask('مراجعة تحديث البيانات','لن تُستبدل المسودة قبل اعتماد هذه المراجعة. التعليقات والتعديلات غير المتعارضة تبقى.',wrap)){status('أُلغي التحديث؛ المسودة الحالية لم تتغير.');return;}
 for(const [key,choice] of decisions)if(choice==='source')delete s.overrides[key];s.conflicts=[];s.history.push({key:'refresh',at:new Date().toISOString(),changes:s.changes.length,decisions:Object.fromEntries(decisions)});s.history=s.history.slice(-50);
 draft=(await api({action:'document_recompute',draft:candidate})).draft;dirty=true;render();status('اعتُمد التحديث مع الحفاظ على التعليقات والاختيارات.');
}
function historyDialog(){const {content}=inspectDialog('سجل تعديلات هذه المسودة');const s=draft.document_state;content.append(node('p','آخر 50 عملية في المسودة؛ تتضمن التعديلات وأسبابها وقرارات تحديث البيانات.'),node('p','نسخة القالب: '+s.template_revision),node('p','نسخة البيانات: '+s.source_revision));for(const e of [...s.history].reverse()){const c=card(e.key);c.append(node('small',new Date(e.at).toLocaleString('ar')),node('p',e.after?'القيمة: '+e.after.value+' · السبب: '+e.after.reason:e.key==='refresh'?'تحديث البيانات: '+e.changes+' تغييرات':'استعادة القيمة المحسوبة'));content.append(c);}}
async function draftsDialog(){const rows=(await api({action:'draft_list'})).drafts.filter(r=>r.document);const {dialog:d,content:c}=inspectDialog('المسودات المحفوظة');for(const row of rows){const cardEl=card(row.title);cardEl.append(node('small',new Date(row.updated_at).toLocaleString('ar')),btn('فتح',async()=>{const saved=(await api({action:'draft_read',id:row.id})).saved;if(!saved.draft.document_state)throw Error('هذه مسودة من المحرر النصي السابق، وليست مسودة مرئية.');if(hasUnsaved()&&!await ask('فتح مسودة','ترك التعديلات غير المحفوظة؟'))return;draft=saved.draft;draftIdentity={id:saved.id,revision:saved.revision};model=copy(draft.document_state.template);bindings=copy(draft.document_state.bindings);identity=null;dirty=false;markTemplateClean();tab='run';active=null;undo=[];redo=[];d.close();render();}),btn('حذف',async()=>{if(!await ask('حذف المسودة','حذف هذه النسخة المحفوظة؟'))return;await api({action:'draft_delete',id:row.id,revision:row.revision});if(draftIdentity?.id===row.id){draftIdentity=null;dirty=true;}cardEl.remove();}));c.append(cardEl);}if(!rows.length)c.append(node('p','لا توجد مسودات محفوظة.'));}
async function saveRecipe(){let title=model.title;const controls=label('اسم وصفة التشغيل',input(title,v=>{title=v;}));if(!await ask('حفظ وصفة تشغيل','تحفظ نسخة القالب واختيارات IDs وإعدادات الصفحة. إعادة تشغيلها تقرأ البيانات الأحدث؛ لا تتضمن تعديلات المسودة.',controls))return;await api({action:'document_validate',template:model});await api({action:'recipe_save',title,template:model,bindings});status('حُفظت الوصفة لإعادة التشغيل والتصدير الجماعي.');}
async function recipesDialog(){
 const rows=(await api({action:'recipe_list'})).recipes;const {dialog:d,content:c}=inspectDialog('وصفات التشغيل المتكرر');const selected=new Set();const progress=node('p');progress.setAttribute('role','status');let cancelled=false,running=false;
 c.append(node('p','كل وصفة تحفظ القالب واختيارات الملفات وتقرأ البيانات الأحدث عند تشغيلها. حدد عدة وصفات لتصدير PDF مستقل لكل وصفة داخل ZIP.'),btn('تصدير المحدد ZIP',async()=>{
 if(running)return;if(!selected.size)throw Error('حدد وصفة واحدة على الأقل.');if(selected.size>20)throw Error('الحد 20 وصفة في العملية.');cancelled=false;running=true;const documents=[];try{for(const id of [...selected]){if(cancelled)break;progress.textContent='إنشاء التقرير '+(documents.length+1)+' من '+selected.size+'…';const saved=(await api({action:'recipe_read',id})).saved;const recipe=saved.draft.recipe;const r=await api({action:'document_generate',template:recipe.template,bindings:recipe.bindings});documents.push(r.draft);}if(cancelled){progress.textContent='أُلغي التصدير؛ لم يُحفظ ملف.';return;}progress.textContent='تجهيز حزمة PDF…';const r=await api({type:'advanced_report_batch',drafts:documents},'/api/export/save');progress.textContent=r.cancelled?'أُلغي الحفظ.':'تم الحفظ: '+r.filename;}finally{running=false;}
 },true),btn('إيقاف بعد التقرير الحالي',()=>{cancelled=true;}),progress);
 for(const row of rows){const section=card(row.title);section.append(check('تضمين في التصدير',false,v=>{if(running)return;v?selected.add(row.id):selected.delete(row.id);}),btn('فتح الوصفة',async()=>{if(running)return;if(hasUnsaved()&&!await ask('فتح وصفة','ترك التعديلات الحالية؟'))return;const saved=(await api({action:'recipe_read',id:row.id})).saved;model=copy(saved.draft.recipe.template);bindings=copy(saved.draft.recipe.bindings);identity=null;draft=null;draftIdentity=null;dirty=false;markTemplateClean();tab='run';active=null;undo=[];redo=[];d.close();render();status('الوصفة جاهزة؛ يمكنك تغيير IDs أو الشروط ثم إنشاء التقرير.');}),btn('حذف',async()=>{if(running)return;if(!await ask('حذف وصفة','حذف وصفة التشغيل؟'))return;await api({action:'recipe_delete',id:row.id,revision:row.revision});section.remove();selected.delete(row.id);}));c.append(section);}
 d.addEventListener('close',()=>{cancelled=true;});
}
window.ReportStudio={open};
})();
