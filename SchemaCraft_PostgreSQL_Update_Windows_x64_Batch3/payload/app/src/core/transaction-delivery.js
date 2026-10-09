/* Source-side configuration. Recipient rows are normal persisted category rows,
   owned by the original transaction; there is no person-side approval surface. */
const SCTransactionDelivery = (() => {
  'use strict';
  const {T,clone,id,el,named,button,iconButton,select,field,panel,check,dialog}=SCFinance;
  let fieldDraft=null;
  function recipientBindings(cid){return SCFinance.schemas[state.activeSchemaId]?.destination_bindings?.[cid]||[];}
  function options(schema,cid){return (schema?.categories||[]).filter(c=>c.kind==='main'||c.id===cid).flatMap(c=>(c.fields||[]).filter(f=>!['file','spacer','field_group'].includes(f.type)).map(f=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`]));}
  function render(host,source,remote,local,cid,rerender){
    const p=panel('نسخ الحركة إلى جدول السجل المقصد');p.root.classList.add('transaction-delivery-settings');
    p.body.append(check('إضافة صف مرتبط إلى جدول الشخص عند حفظ الحركة',!!source.destination,on=>{if(on)source.destination={category_id:'',mappings:[]};else delete source.destination;rerender();}));
    if(source.destination){
      const d=source.destination;
      const cats=(remote?.categories||[]).filter(c=>c.kind==='repeatable'&&!c.view_table);
      p.body.append(field('جدول المقصد داخل ملف الشخص',select([['',T('اختر فئة متكررة')],...cats.map(c=>[c.id,displayLabel(c)])],d.category_id,v=>{d.category_id=v;d.mappings=[];rerender();})));
      const cat=cats.find(c=>c.id===d.category_id);
      const targetOptions=(cat?.fields||[]).filter(f=>!['file','spacer','field_group','system_record_code','system_created_at','system_updated_at','user_name'].includes(f.type)&&!f.financial&&!f.composition&&!f.auto_update).map(f=>[f.id,displayLabel(f)]);
      const sourceOptions=[['$record_code',T('معرّف السجل')],...options(local,cid)];
      for(const [i,m] of d.mappings.entries()){
        const row=el('div','profile-link-map');row.append(field('القيمة من الحركة المالية',select([['',T('اختر حقلًا')],...sourceOptions],m.source_field_id,v=>m.source_field_id=v)),field('الحقل داخل جدول الشخص',select([['',T('اختر حقلًا')],...targetOptions],m.target_field_id,v=>m.target_field_id=v)),iconButton('حذف الربط','trash',()=>{d.mappings.splice(i,1);rerender();},true));p.body.append(row);
      }
      p.actions.append(button('إضافة حقل منسوخ إلى المقصد',()=>{d.mappings.push({source_field_id:'',target_field_id:''});rerender();},'plus'));
      p.body.append(el('p','muted-text',T('يُضاف الصف بعد حفظ السجل المالي فقط، بلا موافقة أخرى من الشخص. تُعدّل القيم المرتبطة من الحركة الأصلية ولا تتكرر عند إعادة الحفظ.')));
    }
    host.append(p.root);
  }
  function validate(cfg){
    for(const s of cfg?.sources||[]){if(!s.destination)continue;const d=s.destination;if(!d.category_id||!d.mappings?.length||d.mappings.some(m=>!m.source_field_id||!m.target_field_id)||new Set(d.mappings.map(m=>m.target_field_id)).size!==d.mappings.length)throw Error(T('أكمل جدول المقصد وحقول النسخ، ولا تكرر حقل المقصد.'));}
  }
  function ownerField(cat){
    const own=(cat?.fields||[]).find(f=>Object.hasOwn(f,'transaction_linking'));
    if(own)return own;
    const ids=(cat?.profile_linking?.sources||[]).flatMap(s=>(s.matches||[]).map(m=>m.local_field_id));
    return (cat?.fields||[]).find(f=>ids.includes(f.id)&&f.record_options)
      ||(cat?.fields||[]).find(f=>ids.includes(f.id))
      ||(cat?.profile_linking?(cat.fields||[]).find(f=>['text','select','number'].includes(f.type)):null);
  }
  function resetField(){fieldDraft=null;}
  function getFieldDraft(cat){
    if(fieldDraft?.fieldId===state.editingFieldId)return fieldDraft;
    const own=ownerField(cat),isOwner=!own||own.id===state.editingFieldId;
    const f=(cat.fields||[]).find(f=>f.id===state.editingFieldId);
    const cfg=isOwner?clone(f?.transaction_linking||cat.profile_linking||{enabled:false,sources:[]}):{enabled:false,sources:[]};
    fieldDraft={categoryId:cat.id,fieldId:state.editingFieldId,cfg,modified:false,isOwner,commit:false};return fieldDraft;
  }
  function renderField(host){
    const cat=categoryById(state.editingFieldCategoryId);
    if(!cat||cat.kind!=='repeatable'||state.globalEditor||recipientBindings(cat.id).length)return;
    if(!['text','select','number','date_gregorian','date_persian','date_hijri'].includes(selectedBuilderFieldType()))return;
    const own=ownerField(cat),draft=getFieldDraft(cat);
    if(own&&own.id!==state.editingFieldId)return;
    const p=panel('مطابقة السجلات وربط الحركة');p.root.id='field-transaction-linking';
    const mode=select([['names',T('اختيار الأسماء أو القيم فقط — دون ربط')],['link',T('ربط الحركة وإضافة صف إلى جدول الشخص')]],draft.cfg.enabled?'link':'names',v=>{
      draft.cfg.enabled=v==='link';draft.cfg.delivery_required=true;draft.modified=true;SCFieldRules.render();
    });mode.id='field-transaction-link-mode';p.body.append(field('استخدام المطابقة',mode));
    if(draft.cfg.enabled){
      const b=button('إعداد المطابقة وحقول النسخ',()=>openForField(cat),'settings');b.id='field-transaction-link-config';p.body.append(b);
      p.body.append(el('p','muted-text',T('يُحفظ إعداد الربط هنا فقط. بعد اختيار الشخص وحفظ السجل المالي يُضاف الصف إلى جدول المقصد دون موافقة ثانية.')));
    }else {p.body.append(el('p','muted-text',T('اختيار الاسم يملأ هذا الحقل فقط؛ لا يربط الشخص ولا ينسخ قيمًا ولا ينشئ صفًا في ملفه.')));if(draft.modified&&draft.cfg.sources?.length)p.body.append(el('p','muted-text',T('التحويل إلى اختيار الأسماء فقط يفك روابط هذا الجدول وصفوفه المنسوخة عند حفظ السجل المالي لاحقًا؛ لا تُحذف قيم الحركة الأصلية.')));}
    host.append(p.root);
  }
  // Compatibility alias; the field renderer owns the single visible entry.
  function fieldButton(){}
  async function openForField(cat){
    const ownerId=state.editingFieldId;
    await SCFinance.fetchSchemas(true);
    if(!elements.fieldDialog.open||ownerId!==state.editingFieldId)return;
    const draft=getFieldDraft(cat),cfg=clone(draft.cfg);
    const choices=SCRecordChoices.configuration();
    if(!cfg.sources.length&&choices?.sources?.length)cfg.sources=choices.sources.map(s=>({id:id('link'),schema_id:s.schema_id||'',category_id:s.category_id||'',matches:[{local_field_id:ownerId,remote_field_id:s.field_id}],copies:[]}));
    cfg.enabled=true;
    const local=clone(state.draftSchema),lc=local.categories.find(c=>c.id===cat.id);
    const current={...(lc.fields.find(f=>f.id===ownerId)||{}),id:ownerId,label:elements.fieldLabel.value||T('الاسم'),type:selectedBuilderFieldType()};
    if(!lc.fields.some(f=>f.id===ownerId))lc.fields.push(current);else Object.assign(lc.fields.find(f=>f.id===ownerId),current);
    const d=dialog('إعداد المطابقة وحقول النسخ');d.root.dataset.deliveryFieldDialog='true';
    function draw(){
      d.body.replaceChildren();
      cfg.sources.forEach((source,index)=>{
        const box=panel('مصدر المطابقة');box.root.classList.add('field-link-source');
        const schemaOptions=[['',T('التصميم الحالي')],...Object.entries(SCFinance.schemas).filter(([k])=>k!==state.activeSchemaId).map(([k,v])=>[k,v.name])];
        const top=el('div','finance-inline');top.append(select(schemaOptions,source.schema_id,v=>{source.schema_id=v;source.category_id='';source.matches=[{local_field_id:ownerId,remote_field_id:''}];source.copies=[];delete source.destination;draw();}),iconButton('حذف المصدر','trash',()=>{cfg.sources.splice(index,1);draw();},true));box.body.append(top);
        const remote=source.schema_id?SCFinance.schemas[source.schema_id]?.schema:local;
        box.body.append(field('صف المصدر للمطابقة والنسخ',select([['',T('حقول الملف الرئيسي')],...(remote?.categories||[]).filter(c=>c.kind==='repeatable').map(c=>[c.id,displayLabel(c)])],source.category_id||'',v=>{source.category_id=v;source.matches=[{local_field_id:ownerId,remote_field_id:''}];source.copies=[];draw();})));
        const remoteFields=[['$record_code',T('معرّف السجل')],...options(remote,source.category_id||'')],localFields=[['$record_code',T('معرّف السجل')],...options(local,cat.id)];
        const targets=lc.fields.filter(f=>!f.financial&&!f.composition&&!f.auto_update&&!['file','spacer','user_name','system_record_code','system_created_at','system_updated_at'].includes(f.type)).map(f=>[f.id,displayLabel(f)]);
        for(const property of ['matches','copies']){
          source[property]||=[];
          const part=panel(property==='matches'?'حقول المطابقة — جميعها يجب أن تتطابق':'القيم التي تنسخ بعد اختيار السجل');
          source[property].forEach((mapping,n)=>{
            const isMatch=property==='matches',a=isMatch?'local_field_id':'source_field_id',b=isMatch?'remote_field_id':'target_field_id',row=el('div','profile-link-map');
            row.append(field(isMatch?'حقل المطابقة هنا':'القيمة المنسوخة من المصدر',select([['',T('اختر حقلًا')],...(isMatch?localFields:remoteFields)],mapping[a],v=>mapping[a]=v)),field(isMatch?'حقل المطابقة في المصدر':'حقل الوجهة في الحركة',select([['',T('اختر حقلًا')],...(isMatch?remoteFields:targets)],mapping[b],v=>mapping[b]=v)),iconButton('حذف الربط','trash',()=>{source[property].splice(n,1);draw();},true));part.body.append(row);
          });
          part.actions.append(button(property==='matches'?'إضافة حقل مطابقة':'إضافة قيمة منسوخة',()=>{source[property].push(property==='matches'?{local_field_id:ownerId,remote_field_id:''}:{source_field_id:'',target_field_id:''});draw();},'plus'));box.body.append(part.root);
        }
        render(box.body,source,remote,local,cat.id,draw);d.body.append(box.root);
      });
      d.body.append(button('إضافة تصميم مصدر',()=>{cfg.sources.push({id:id('link'),schema_id:'',matches:[{local_field_id:ownerId,remote_field_id:''}],copies:[]});draw();},'plus'));
    }
    d.foot.append(button('حفظ',()=>{try{validateFieldConfig(cfg,ownerId);if(state.editingFieldId!==ownerId)return;fieldDraft={...draft,cfg:clone(cfg),modified:true};d.root.close();SCFieldRules.render();}catch(error){showToast(error.message,'error');}},'save'),button('إلغاء',()=>d.root.close()));draw();d.root.showModal();
  }
  function validateFieldConfig(cfg,ownerId){
    if(!cfg.enabled)return;
    if(!cfg.sources?.length)throw Error(T('اختر تصميمًا مصدرًا واحدًا على الأقل.'));
    for(const s of cfg.sources){
      if(!s.matches?.length||s.matches.some(m=>!m.local_field_id||!m.remote_field_id)||s.copies?.some(m=>!m.source_field_id||!m.target_field_id))throw Error(T('أكمل حقول المطابقة والنسخ.'));
      if(!s.matches.some(m=>m.local_field_id===ownerId))throw Error(T('يجب أن يشارك حقل المطابقة المالك في مطابقة كل مصدر.'));
      if(cfg.delivery_required&&!s.destination)throw Error(T('اختر جدول المقصد وحقول النسخ لكل مصدر لتفعيل ربط الحركة بالكامل.'));
    }
    validate(cfg);
  }
  function collectField(f){
    const cat=categoryById(state.editingFieldCategoryId);if(!cat)return;
    const draft=getFieldDraft(cat);if(!draft.isOwner)return;
    if(!draft.modified&&!Object.hasOwn(f,'transaction_linking')&&!cat.profile_linking)return;
    if(!['text','select','number','date_gregorian','date_persian','date_hijri'].includes(f.type)||f.financial||f.composition||f.auto_update)throw Error(T('إعداد الربط يجب أن يكون في حقل مطابقة يدوي داخل جدول الحركة.'));
    validateFieldConfig(draft.cfg,f.id);f.transaction_linking=clone(draft.cfg);draft.commit=true;
  }
  function commitField(){
    if(fieldDraft?.commit){const cat=categoryById(fieldDraft.categoryId);if(cat){delete cat.profile_linking;
      if(elements.categoryDialog.open&&state.editingCategoryId===cat.id){state.categoryFieldsDraft=clone(cat.fields);SCProfileLinks.setDraft({enabled:false,sources:[]});}
    }}fieldDraft=null;
  }
  function origin(card){try{return card.dataset.transactionOrigin?JSON.parse(card.dataset.transactionOrigin):null;}catch{return null;}}
  function decorate(card,row){
    if(!row?.transaction_origin)return;
    card.dataset.transactionOrigin=JSON.stringify(row.transaction_origin);
    card.dataset.deliveryReadOnly='true';
    for(const c of card.querySelectorAll('input,select,textarea,button'))c.disabled=true;
    const body=card.querySelector(':scope > .dialog-content')||card;
    const note=el('div','transaction-origin-notice');note.append(el('span','',T('حركة مرتبطة من المصدر المالي — التعديل من الحركة الأصلية.')),button('فتح الحركة الأصلية',()=>{if(card.open)card.close();return SCFinanceEntry.openRelated(origin(card));},'open'));
    body.prepend(note);
    for(const b of card.querySelectorAll(':scope > .dialog-heading button,:scope > .dialog-actions button')){if(b.textContent.includes(T('حفظ الصف')))b.hidden=true;else b.disabled=false;}
  }
  let toolbar=null,selectedRow=null;
  function hideControls(refocus=false){if(toolbar){try{if(toolbar.matches(':popover-open'))toolbar.hidePopover();}catch{}toolbar.remove();toolbar=null;}const row=selectedRow;selectedRow=null;row?.classList.remove('transaction-selected-row');if(refocus&&row?.isConnected)row.focus();}
  function rowControls(row,buttons){
    row.tabIndex=0;row.setAttribute('aria-label',T('إجراءات الصف'));row.setAttribute('aria-haspopup','true');
    function toggle(focus=false){
      if(selectedRow===row){hideControls(focus);return;}hideControls();selectedRow=row;row.classList.add('transaction-selected-row');
      toolbar=el('div','history-context-controls transaction-row-controls');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label',T('إجراءات الصف'));toolbar.setAttribute('popover','manual');
      const parent=row.closest('dialog[open]')||document.body;parent.append(toolbar);
      for(const b of buttons){b.addEventListener('click',()=>hideControls(),{capture:true,once:true});toolbar.append(b);}
      const rect=row.getBoundingClientRect();toolbar.style.left=Math.max(8,rect.left+8)+'px';toolbar.style.top=Math.min(window.innerHeight-55,rect.bottom-4)+'px';
      if(typeof toolbar.showPopover==='function')toolbar.showPopover();else toolbar.style.display='flex';if(focus)toolbar.querySelector('button')?.focus();
      toolbar.addEventListener('keydown',event=>{const choices=[...toolbar.querySelectorAll('button')];const current=choices.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();hideControls(true);}else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();choices[event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowLeft'?1:choices.length-1))%choices.length]?.focus();}});
    }
    row.addEventListener('click',event=>{if(!event.target.closest('button,input,select,a'))toggle();});
    row.addEventListener('keydown',event=>{if(event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();toggle(true);}});
  }
  document.addEventListener('click',event=>{if(toolbar&&!toolbar.contains(event.target)&&!selectedRow?.contains(event.target))hideControls();},true);
  document.addEventListener('scroll',event=>{if(toolbar&&!toolbar.contains(event.target))hideControls();},true);
  window.addEventListener('resize',()=>hideControls());
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toolbar){event.preventDefault();hideControls(true);}});
  new MutationObserver(()=>{if(selectedRow&&!selectedRow.isConnected)hideControls();}).observe(document.documentElement,{childList:true,subtree:true});
  function checkpoint(){return clone(fieldDraft);}
  function restoreCheckpoint(value){fieldDraft=clone(value);}
  function validateFieldDraft(){if(fieldDraft?.modified&&fieldDraft.cfg?.enabled)validateFieldConfig(fieldDraft.cfg,state.editingFieldId);}
  return {checkpoint,restoreCheckpoint,validateFieldDraft,rowControls,hideControls,render,validate,recipientBindings,resetField,fieldButton,renderField,collectField,ownerField,commitField,origin,decorate};
})();
