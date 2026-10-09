/* Reviewed folder imports and record-owned unassigned attachments.
 * No file bytes leave the browser before explicit commit. User data is rendered
 * with textContent and excluded from automatic interface translation. */
window.SCAttachmentImport = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = source => scText(source);
  const inboxes = new Map();
  let nativeFolder = null, fieldItems = [];
  let selectedFiles = [], draft = null, fieldsGeneration = 0, profileGeneration = 0;
  let preparingCommit = false, stop = false, activeProfileRow = null, sourceTarget = null, fieldsSchema = '';
  let activePicker = null;
  const key = () => `${state.activeSchemaId || ''}:${state.selectedRecordCode || ''}`;
  const el = (tag, text = '', cls = '', user = false) => {
    const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls;
    if (user) { e.dataset.i18nSkip = 'true'; e.setAttribute('translate', 'no'); e.dir = 'auto'; }
    return e;
  };
  const button = (text, action, cls='button button-secondary') => {
    const b=el('button',t(text),cls);b.type='button';b.addEventListener('click',action);return b;
  };
  const schemaId = () => elements.importTargetSchema?.value || state.activeSchemaId || '';
  async function request(action, body={}, schema=schemaId()) {
    const response = await fetch('/api/import/attachments/'+action,{method:'POST',headers:exchangeHeaders(schema),body:JSON.stringify(body)});
    return responseJson(response);
  }
  function setPending(record) {
    if (!record || record.record_code !== state.selectedRecordCode) return;
    inboxes.set(key(), Array.isArray(record.unassigned_attachments) ? record.unassigned_attachments : []);
  }
  function pendingItems() {
    if (!state.selectedRecordCode) return [];
    const chosen = new Set([...elements.recordForm.querySelectorAll('[data-value-control]')].filter(c=>fieldById(c.dataset.fieldId,state.schema)?.type==='file' && !c._selectedFile).map(c=>c.value));
    return (inboxes.get(key()) || []).filter(item=>!chosen.has(item.path));
  }
  async function refreshPending() {
    if (!state.selectedRecordCode) return;
    const before = key();
    const r=await fetch('/api/records/'+encodeURIComponent(state.selectedRecordCode),{cache:'no-store'});
    const record=await responseJson(r);
    if (before!==key()) return;
    setPending(record);renderAttachmentGallery();
  }
  async function loadFields() {
    const id = schemaId(), generation=++fieldsGeneration;
    if (!id || !builderUnlocked()) return;
    try {
      const data=await request('fields',{},id);
      if (generation!==fieldsGeneration || id!==schemaId()) return;
      fieldsSchema=id;
      fieldItems=SCDefinitionPicker.labelItems([{id:'record_code',label:t('معرّف السجل'),category:t('معلومات السجل')},...data.fields]);
      $('attachment-import-fields').replaceChildren();
      $('attachment-import-template').value=SCDefinitionPicker.toNames($('attachment-import-template').value,fieldItems);
    } catch(error) {$('attachment-import-status').textContent=error.message;}
  }
  function invalidatePreview() { if(!state.attachmentImportBusy) draft=null; }
  function reset() {
    if(state.attachmentImportBusy)return;
    if(draft?.token)void request('cancel',{token:draft.token},draft.schema).catch(()=>{});
    draft=null;nativeFolder=null;selectedFiles=[];fieldsGeneration++;profileGeneration++;
    $('attachment-import-folder').value='';$('attachment-import-folder-label').textContent=t('لم يُختر مجلد');
    $('attachment-import-template').value='';$('attachment-import-status').textContent='';
    $('attachment-import-review').close();
    if(elements.importTypeSelect?.value==='attachments')void loadFields();
  }
  async function preview() {
    if(!selectedFiles.length)return showToast(t('اختر مجلد المرفقات أولًا.'),'error');
    const currentFiles=selectedFiles.slice(), currentSchema=schemaId(), template=$('attachment-import-template').value, folder=nativeFolder;
    const b=$('attachment-import-preview');b.disabled=true;
    try {
      const data=await request('preview',{template:SCDefinitionPicker.toKeys(template,fieldItems),folder_token:folder?.folder_token,files:currentFiles.map(f=>({name:f.name,size:f.size}))},currentSchema);
      if(currentSchema!==schemaId() || currentFiles.some((f,i)=>selectedFiles[i]!==f) || template!==$('attachment-import-template').value)return;
      draft={token:data.token,schema:currentSchema,native:!!folder,folderName:folder?.folder_name||'',files:currentFiles,rows:data.files.map((r,i)=>({...r,file:currentFiles[i],selected:r.match_count===1?r.matches[0]:null,skip:false,done:false,status:''}))};
      renderReview();$('attachment-import-review').showModal();
    }catch(error){showToast(error.message,'error');$('attachment-import-status').textContent=error.message;}
    finally{b.disabled=false;}
  }
  function updateRow(row) {
    row.tr.classList.toggle('attachment-row-skipped',row.skip);row.tr.classList.toggle('attachment-row-done',row.done);
    row.statusNode.textContent=row.status;
    row.target.replaceChildren();
    if(row.matches.length>1 && !row.done){
      const select=el('select','','control');select.setAttribute('aria-label',t('اختيار السجل المستهدف'));select.append(new Option(t('اختر سجلًا'),''));
      let choices=row.matches.slice();if(row.selected&&!choices.some(x=>x.record_code===row.selected.record_code))choices.push(row.selected);
      for(const p of choices)select.append(new Option(p.title+' — '+p.record_code,p.record_code));
      select.value=row.selected?.record_code||'';select.disabled=row.skip||!!state.attachmentImportBusy;
      select.dataset.i18nSkip='true';select.addEventListener('change',()=>{row.selected=choices.find(p=>p.record_code===select.value)||null;});row.target.append(select);
    }else row.target.append(el('strong',row.selected ? row.selected.title+' — '+row.selected.record_code : t('لم يُحدد سجل'),' ',!!row.selected));
    if(!row.done){const choose=button('اختيار سجل آخر',()=>openProfiles(row),'button button-secondary workflow-icon-only attachment-target-browse');choose.textContent='';choose.title=t('اختيار سجل آخر');choose.setAttribute('aria-label',t('اختيار سجل آخر'));const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','action-icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#icon-search');svg.append(use);choose.append(svg);choose.disabled=row.skip||!!state.attachmentImportBusy;row.target.append(choose);}
    row.exclude.disabled=row.done||!!state.attachmentImportBusy;
    updateSkipAll();
  }
  function renderReview() {
    const body=$('attachment-review-rows');body.replaceChildren();
    for(const row of draft.rows){
      row.tr=el('tr');const file=el('td','','attachment-review-file',true);file.append(el('strong',row.name,'',true));
      const relative=row.file.webkitRelativePath||row.file.relative||'';if(relative.includes('/'))file.append(el('small',relative.split('/').slice(0,-1).join('/'),'attachment-review-folder',true));
      const match=el('td', t(row.match_count===1?'مطابقة واحدة':row.match_count?'مطابقات متعددة':'لا توجد مطابقة')+(row.match_count>1?' · '+row.match_count:''));
      const targetCell=el('td');row.target=el('div','','attachment-review-target');targetCell.append(row.target);
      const skipped=el('td');row.exclude=el('input');row.exclude.type='checkbox';row.exclude.checked=row.skip;row.exclude.setAttribute('aria-label',t('تجاهل')+' '+row.name);row.exclude.addEventListener('change',()=>{row.skip=row.exclude.checked;updateRow(row);});skipped.append(row.exclude);

      row.statusNode=el('td','','attachment-review-status');row.tr.append(file,match,targetCell,skipped,row.statusNode);body.append(row.tr);updateRow(row);
    }
    $('attachment-review-progress').textContent=t('راجع المطابقات قبل الاستيراد.');
  }
  async function openProfiles(row) {
    activeProfileRow=row;$('attachment-profile-query').value='';$('attachment-profile-picker').showModal();await queryProfiles();
  }
  async function queryProfiles() {
    const generation=++profileGeneration, owner=activeProfileRow, token=draft?.token;
    if(!token)return;
    try {
      const data=await request('profiles',{token,query:$('attachment-profile-query').value},draft.schema);
      if(generation!==profileGeneration||owner!==activeProfileRow||token!==draft?.token)return;
      const list=$('attachment-profile-results');list.replaceChildren();
      $('attachment-profile-count').textContent=scText`النتائج: ${data.profiles.length} / ${data.total}`;
      for(const p of data.profiles){const b=button('',()=>{owner.selected=p;updateRow(owner);$('attachment-profile-picker').close();});b.textContent=p.title+' — '+p.record_code;b.dataset.i18nSkip='true';list.append(b);}
      if(!data.profiles.length)list.append(el('p',t('لا توجد نتائج.')));
    }catch(error){$('attachment-profile-count').textContent=error.message;}
  }
  function updateSkipAll() {
    const control=$('attachment-review-skip-all');if(!control)return;
    const unfinished=draft?.rows.filter(row=>!row.done)||[];
    const skipped=unfinished.filter(row=>row.skip).length;
    control.checked=unfinished.length>0&&skipped===unfinished.length;
    control.indeterminate=skipped>0&&skipped<unfinished.length;
    control.disabled=!!state.attachmentImportBusy||!unfinished.length;
  }
  function requestBatchNotes(batch,count) {
    return new Promise(resolve=>{
      const dialog=$('attachment-batch-notes-dialog');
      $('attachment-batch-title').value=batch.operation?.title||'';
      $('attachment-batch-notes').value=batch.operation?.notes||'';
      $('attachment-batch-error').textContent='';
      $('attachment-batch-summary').textContent=scText`سيتم إضافة ${count} مرفقًا دون إسنادها إلى حقول.`;
      let result=null;
      const confirm=()=>{result={title:$('attachment-batch-title').value.trim(),notes:$('attachment-batch-notes').value.trim()};dialog.close();};
      const close=()=>{$('attachment-batch-confirm').removeEventListener('click',confirm);resolve(result);};
      $('attachment-batch-confirm').addEventListener('click',confirm);dialog.addEventListener('close',close,{once:true});dialog.showModal();
    });
  }
  async function commit() {
    if(!draft || state.attachmentImportBusy || preparingCommit)return;
    const unresolved=draft.rows.filter(r=>!r.skip&&!r.done&&!r.selected);
    if(unresolved.length){showToast(t('اختر سجلًا صالحًا لكل مرفق أو تجاهله قبل التنفيذ.'),'error');unresolved[0].target.querySelector('button,select')?.focus();return;}
    const todo=draft.rows.filter(r=>!r.skip&&!r.done);
    if(!todo.length)return showToast(t('لا توجد مرفقات محددة للاستيراد.'));
    const batch=draft;preparingCommit=true;
    try {
      // One optional process description and explicit confirmation, after review.
      // Closing/cancelling this dialog performs no import and changes no history.
      const operation=batch.operation||await requestBatchNotes(batch,todo.length);
      if(operation===null||draft!==batch)return;
      await request('begin',{token:batch.token,...operation},batch.schema);
      batch.operation=operation;state.attachmentImportBusy=true;stop=false;
      $('attachment-review-commit').disabled=true;$('attachment-review-done').disabled=true;$('attachment-review-stop').hidden=false;
      batch.rows.forEach(updateRow);
      for(const row of todo){
        if(stop)break;
        row.status=t('جارٍ رفع المرفق…');updateRow(row);
        try {
          const data=batch.native?null:await readFileAsBase64(row.file);
          const result=await request('commit',{token:batch.token,item_id:row.id,record_code:row.selected.record_code,...(batch.native?{}:{upload:{name:row.name,data}})},batch.schema);
          row.done=true;row.status=t(result.duplicate?'موجود مسبقًا — لم يُكرر':'أضيف دون إسناد');
        }catch(error){row.status=error.message;}
        updateRow(row);
        $('attachment-review-progress').textContent=scText`تمت معالجة ${batch.rows.filter(r=>r.done).length} من ${batch.rows.filter(r=>!r.skip).length} مرفقًا.`;
      }
      try {const saved=await request('finish',{token:batch.token,skipped:batch.rows.filter(r=>r.skip).map(r=>r.id),folder:batch.folderName||batch.files[0]?.webkitRelativePath?.split('/')[0]||t('مرفقات')},batch.schema);if(saved.history_saved===false)throw new Error(t('تعذّر حفظ سجل العملية.'));}
      catch(error){showToast(scText`حُفظت المرفقات المنجزة، لكن تعذّر تسجيل ملخص العملية: ${error.message}`,'error');}
      document.dispatchEvent(new Event('schemacraft-data-changed'));
      if(state.activeSchemaId===batch.schema&&state.selectedRecordCode)await refreshPending().catch(()=>{});
      if(state.mode==='import')await loadImportHistory().catch(()=>{});
      $('attachment-import-status').textContent=scText`مرفقات منجزة: ${batch.rows.filter(r=>r.done).length}. تبقى الملفات غير المنجزة قابلة للمراجعة أو إعادة المحاولة.`;
    }catch(error){showToast(error.message,'error');}
    finally {
      preparingCommit=false;state.attachmentImportBusy=false;$('attachment-review-commit').disabled=false;$('attachment-review-done').disabled=false;$('attachment-review-stop').hidden=true;batch.rows.forEach(updateRow);
    }
  }
  function validPickerTarget(target) {
    return target && target.owner===key() && target.control.isConnected
      && !state.currentRecordArchived && state.mode!=='readonly';
  }
  function openComputerPicker(target) {
    if(activePicker || !validPickerTarget(target))return;
    const {picker}=target;
    let focusTimer=0;
    const release=()=>{
      clearTimeout(focusTimer);
      picker.removeEventListener('change',release);
      picker.removeEventListener('cancel',release);
      window.removeEventListener('focus',refocused);
      if(activePicker===target)activePicker=null;
    };
    // Older browser hosts may signal a cancelled native picker only by focus.
    const refocused=()=>{focusTimer=setTimeout(release,300);};
    activePicker=target;
    picker.addEventListener('change',release);
    picker.addEventListener('cancel',release);
    window.addEventListener('focus',refocused,{once:true});
    picker.value='';
    try {
      // Stay inside the user's click: awaiting a record request loses activation
      // and lets rapid clicks queue native windows after the request completes.
      if(typeof picker.showPicker==='function')picker.showPicker();
      else picker.click();
    }catch(error){release();showToast(error.message,'error');}
  }
  function browse(control,picker,field) {
    if(activePicker || !validPickerTarget({control,owner:key()}))return;
    const target={control,picker,field,owner:key()};
    // Loaded/saved record responses already supply the current attachment inbox.
    // Background data-change refreshes update it without blocking this click.
    if(!pendingItems().length){openComputerPicker(target);return;}
    const dialog=$('attachment-source-dialog');
    if(dialog.open)return;
    sourceTarget=target;dialog.querySelector('h2').textContent=t('مصدر المرفق')+' — '+displayLabel(field);dialog.showModal();
  }
  function validSourceTarget(){return validPickerTarget(sourceTarget);}
  function previewTile(item){
    const media=el('div','','attachment-media');
    if(isImageAttachment(item.path)){
      const image=el('img','','gallery-preview');image.src=attachmentApiUrl(item.path);image.alt=item.name;image.loading='lazy';media.append(image);
    }else if(/\.pdf$/i.test(item.name)){
      const frame=el('iframe','','attachment-pdf-preview');frame.src=attachmentApiUrl(item.path)+'#toolbar=0&navpanes=0';frame.title=item.name;frame.loading='lazy';frame.tabIndex=-1;/* The endpoint serves PDF with nosniff. Sandbox would disable the native PDF viewer; never embed arbitrary HTML here. */media.append(frame);
    }else if(/\.(txt|csv|md|log)$/i.test(item.name)){
      const text=el('pre',t('جارٍ تحميل المعاينة...'),'attachment-text-preview',true);media.append(text);
      fetch(attachmentApiUrl(item.path)+(attachmentApiUrl(item.path).includes('?')?'&':'?')+'text_preview=1').then(r=>{if(!r.ok)throw Error();return r.json();}).then(value=>{if(text.isConnected)text.textContent=value.text;}).catch(()=>{text.textContent=t('تعذّر عرض المعاينة. افتح الملف لعرضه.');});
    }else media.append(el('div',item.name.split('.').pop()?.toUpperCase()||t('ملف'),'gallery-file-icon'));
    return media;
  }
  async function removePending(item){
    if(hasUnsavedWorkspaceChanges())return showToast(t('احفظ التغييرات أو تجاهلها قبل حذف المرفق.'),'error');
    if(!await requestConfirmation(scText`هل تريد حذف المرفق غير المسند «${item.name}»؟`,{title:t('حذف المرفق'),confirmLabel:t('حذف')}))return;
    const before=key();
    try{await responseJson(await fetch('/api/records/attachments/delete-unassigned',{method:'POST',headers:exchangeHeaders(state.activeSchemaId),body:JSON.stringify({record_code:state.selectedRecordCode,id:item.id})}));if(before===key()){await refreshPending();if($('attachment-pending-picker').open)choosePending();}SCAlerts.schedule();showToast(t('حُذف المرفق غير المسند.'));}catch(error){showToast(error.message,'error');}
  }
  function choosePending(){
    if(!validSourceTarget())return;
    $('attachment-source-dialog').close();const box=$('attachment-pending-results');box.replaceChildren();
    const target=sourceTarget;
    $('attachment-pending-picker').querySelector('h2').textContent=t('اختيار مرفق غير مسند')+' — '+displayLabel(target.field);
    for(const item of pendingItems()){
      const card=el('article','','gallery-card gallery-unassigned pending-choice-card');
      const choose=button('اختيار هذا المرفق',()=>{
        if(!validSourceTarget()||target!==sourceTarget)return;
        target.control.value=item.path;target.control._selectedFile=null;target.control._uploadName='';target.picker.value='';
        refreshFileSummary(target.control);target.control.dispatchEvent(new Event('change',{bubbles:true}));
        renderAttachmentGallery();$('attachment-pending-picker').close();showToast(t('تم اختيار المرفق. احفظ السجل لإتمام الإسناد.'));
      });
      if(['profile','card'].includes(target.field.image_display)&&!isImageAttachment(item.name)){choose.disabled=true;choose.title=t('هذا الحقل يقبل صورة فقط.');}
      const body=el('div','','gallery-card-body');body.append(el('strong',item.name,'',true));if(item.notes)body.append(el('p',item.notes,'attachment-notes',true));
      const controls=el('div','','compact-option-actions');const open=el('a',t('فتح المرفق'),'button button-secondary');open.href=isImageAttachment(item.path)?attachmentViewerUrl(item.path):attachmentApiUrl(item.path);open.target='_blank';open.rel='noopener';controls.append(choose,open,button('حذف',()=>removePending(item),'button button-danger-quiet'));body.append(controls);card.append(previewTile(item),body);box.append(card);
    }
    if(!$('attachment-pending-picker').open)$('attachment-pending-picker').showModal();
  }
  function appendGallery(grid){
    for(const item of pendingItems()){
      const card=el('article','','gallery-card gallery-unassigned',true);const link=el('a','','attachment-gallery-link');link.href=isImageAttachment(item.path)?attachmentViewerUrl(item.path):attachmentApiUrl(item.path);link.target='_blank';link.rel='noopener';link.append(previewTile(item));
      const body=el('div','','gallery-card-body');body.append(el('strong',item.name,'',true),el('span',t('غير مسند إلى حقل')));if(item.notes)body.append(el('p',item.notes,'attachment-notes',true));
      const remove=button('حذف المرفق',()=>removePending(item),'button button-danger-quiet');remove.hidden=!!state.currentRecordArchived||state.mode==='readonly';body.append(remove);card.append(link,body);grid.append(card);
    }
  }
  async function chooseFolder(){
    if(state.attachmentImportBusy)return;const current=schemaId();const b=$('attachment-import-browse');b.disabled=true;
    try{const folder=await request('choose-folder',{},current);if(folder.cancelled||current!==schemaId())return;
      nativeFolder=folder;selectedFiles=folder.files;invalidatePreview();const folders=new Set(folder.files.map(f=>(f.relative||'').split('/').slice(0,-1).join('/')).filter(Boolean));$('attachment-import-folder-label').textContent=scText`${folder.folder_name} — ${folder.files.length} ملف · ${folders.size} مجلد فرعي`;
    }catch(error){showToast(error.message,'error');}finally{b.disabled=false;}
  }
  function init(){
    $('attachment-import-browse').addEventListener('click',()=>void chooseFolder());
    $('attachment-import-fields-button').addEventListener('click',async()=>{if(fieldsSchema!==schemaId())await loadFields();SCDefinitionPicker.open({items:fieldItems,title:t('اختيار حقول المطابقة'),onSelect:ids=>SCDefinitionPicker.insert($('attachment-import-template'),ids,fieldItems)});});
    $('attachment-review-skip-all').addEventListener('change',()=>{if(!draft||state.attachmentImportBusy)return;const skip=$('attachment-review-skip-all').checked;for(const row of draft.rows)if(!row.done){row.skip=skip;row.exclude.checked=skip;updateRow(row);}updateSkipAll();});
    $('attachment-import-folder').addEventListener('change',()=>{
      const chosen=Array.from($('attachment-import-folder').files||[]);
      if(chosen.length>2000||chosen.some(f=>f.size>MAX_ATTACHMENT_BYTES)){selectedFiles=[];$('attachment-import-folder').value='';$('attachment-import-folder-label').textContent=t('لم يُختر مجلد');showToast(t('الحد الأقصى 2000 ملف في الدفعة و100 ميغابايت لكل ملف.'),'error');return;}
      nativeFolder=null;selectedFiles=chosen;invalidatePreview();$('attachment-import-folder-label').textContent=chosen.length?scText`${chosen[0].webkitRelativePath.split('/')[0]||t('مرفقات')} — ${chosen.length} ملف`:t('لم يُختر مجلد');
    });
    $('attachment-import-template').addEventListener('input',invalidatePreview);
    $('attachment-import-preview').addEventListener('click',()=>void preview());
    $('attachment-review-commit').addEventListener('click',()=>void commit());
    $('attachment-review-stop').addEventListener('click',()=>{stop=true;});
    for(const id of ['attachment-review-done'])$(id).addEventListener('click',()=>{if(!state.attachmentImportBusy)$('attachment-import-review').close();});
    $('attachment-import-review').addEventListener('cancel',event=>{if(state.attachmentImportBusy)event.preventDefault();});
    let timer;$('attachment-profile-query').addEventListener('input',()=>{clearTimeout(timer);profileGeneration++;timer=setTimeout(queryProfiles,180);});
    $('attachment-source-computer').addEventListener('click',()=>{if(!validSourceTarget())return;$('attachment-source-dialog').close();openComputerPicker(sourceTarget);});
    $('attachment-source-pending').addEventListener('click',choosePending);
    elements.recordForm.addEventListener('change',event=>{if(event.target.closest('.attachment-control'))queueMicrotask(renderAttachmentGallery);});
    document.addEventListener('schemacraft-data-changed',()=>{if(state.mode==='entry')void refreshPending().catch(()=>{});});
    elements.importTargetSchema?.addEventListener('change',()=>{nativeFolder=null;selectedFiles=[];invalidatePreview();if(elements.importTypeSelect.value==='attachments')void loadFields();});
  }
  init();
  return {loadFields,reset,preview,setPending,pendingItems,refreshPending,browse,appendGallery,removePending,chooseFolder};
})();
