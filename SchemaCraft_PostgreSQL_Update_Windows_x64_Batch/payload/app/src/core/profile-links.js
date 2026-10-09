/* Optional explicit links: matching suggests; the user chooses; saving persists.
   Unmatched text is never replaced by an automatic lookup or a phantom record. */
const SCProfileLinks = (() => {
  'use strict';
  const {T,clone,id,el,named,button,iconButton,select,field,panel,check,dialog}=SCFinance;
  let draft={enabled:false,sources:[]};
  function fields(s,cid='',mainOnly=false){return (s?.categories||[]).flatMap(c=>(c.fields||[]).filter(f=>(mainOnly?c.kind==='main':c.kind==='main'||c.id===cid)&&!['file','spacer','field_group','system_created_at','system_updated_at'].includes(f.type)).map(f=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`]));}
  const code=()=>[['$record_code',T('معرّف السجل')]];
  function localSchema(){const schema=clone(state.draftSchema);const cat=schema.categories.find(c=>c.id===state.editingCategoryId);if(cat)cat.fields=clone(state.categoryFieldsDraft||cat.fields);else schema.categories.push({id:state.editingCategoryId,kind:'repeatable',label:elements.categoryLabel.value,fields:clone(state.categoryFieldsDraft||[])});return schema;}
  function init(category){draft=clone(category?.profile_linking||{enabled:false,sources:[]});render();SCFinance.fetchSchemas().then(()=>{if(elements.categoryDialog.open)render();}).catch(e=>showToast(e.message,'error'));}
  function config(category){
    const owners=(category?.fields||[]).filter(f=>Object.hasOwn(f,'transaction_linking'));
    return owners[0]?.transaction_linking||category?.profile_linking||{};
  }
  function render(){
    // Relationship configuration lives only in its source field. No category editor.
    document.getElementById('category-profile-linking')?.remove();
  }
  function collect(){
    const cat=categoryById(state.editingCategoryId);
    if((state.categoryFieldsDraft||cat?.fields||[]).some(f=>Object.hasOwn(f,'transaction_linking')))return null;
    // Preserve pre-existing legacy data while unrelated category settings are edited.
    return cat?.profile_linking ? clone(cat.profile_linking) : null;
  }
  function read(card){try{return card.dataset.profileLink?JSON.parse(card.dataset.profileLink):null;}catch{return null;}}
  function formPayload(card){const snap=collectDraftSnapshot();return {category_id:card.dataset.categoryId,main:snap.main,values:snap.related[card.dataset.categoryId]?.find(r=>r._child_id===card.dataset.childId)?.values||{},record_code:snap.record_code||snap.selected_record_code,child_id:card.dataset.childId};}
  const post=(url,payload)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(responseJson);
  function decorate(card,category,row){
    if(row?.profile_link)card.dataset.profileLink=JSON.stringify(row.profile_link);
    if(row?.transaction_origin||SCTransactionDelivery.recipientBindings(category.id).length)return;
    if(!config(category)?.enabled&&!read(card))return;
    const host=el('div','profile-link-entry');host.dataset.profileLinkEntry='';const status=el('span','profile-link-status');
    const search=button('مطابقة واختيار سجل',()=>openPicker(card,category),'search');search.disabled=!config(category)?.enabled;
    const clear=iconButton('إلغاء الربط مع إبقاء القيم','clear',()=>{delete card.dataset.profileLink;redraw();scheduleDraftSave();});
    function redraw(){const link=read(card);named(status,link?`${link.schema_name||''} — ${link.record_title||T('سجل مرتبط')} · ${link.record_code}${link.row_title?' — '+link.row_title:''}`:T('بدون ربط — تُحفظ القيم المدخلة'));clear.hidden=!link;}
    host.append(status,search,clear);card.querySelector(':scope > .dialog-content')?.prepend(host);if(!host.parentNode)card.prepend(host);card._renderProfileLink=redraw;redraw();
  }
  async function openPicker(card,category){
    const d=dialog('مطابقة الحركة مع سجل'),toolbar=el('div','profile-link-search');const srcOptions=[['',T('جميع التصاميم المسموحة')],...config(category).sources.map(s=>{const remote=s.schema_id?SCFinance.schemas[s.schema_id]?.schema:state.schema;const schemaName=s.schema_id?(SCFinance.schemas[s.schema_id]?.name||T('تصميم مصدر')):displaySchemaName(state.schema);const cat=remote?.categories?.find(c=>c.id===s.category_id);return [s.id,[schemaName,cat?displayLabel(cat):T('حقول الملف الرئيسي')].filter(Boolean).join(' — ')];})];
    const source=select(srcOptions,'',()=>void search(false));const q=el('input','control');q.placeholder=T('البحث اليدوي بالاسم أو معرّف السجل');const manual=button('بحث يدوي',()=>search(true),'search');toolbar.append(source,q,manual);const status=el('p','muted-text'),list=el('div','profile-link-candidates');d.body.append(toolbar,status,list);d.foot.append(button('إبقاء القيم دون ربط',()=>d.root.close()),button('تحديث المطابقة',()=>search(false),'refresh'));let request=0;
    async function search(manualMode){const seq=++request;list.replaceChildren();status.textContent=T('جارٍ البحث…');try{const result=await post('/api/profile-links/matches',{...formPayload(card),source_id:source.value,search:q.value,manual:manualMode});if(seq!==request||!d.root.open)return;status.textContent=result.total===1?T('تطابق واحد — اختر السجل لتأكيد الربط'):result.total?`${T('سجلات مطابقة؛ اختر سجلًا واحدًا')} · ${result.total}`:T('لا يوجد تطابق؛ ابحث يدويًا أو احفظ القيم دون ربط.');
      for(const candidate of result.items){const line=el('div','profile-link-candidate'),label=named(el('span'),`${candidate.schema_name} — ${candidate.record_title} · ${candidate.record_code}${candidate.row_title?' — '+candidate.row_title:''}`);const choose=button('اختيار وربط',async()=>{choose.disabled=true;const session=card._financeEdit;try{const response=await post('/api/profile-links/select',{...formPayload(card),link:candidate});if(!d.root.open||!card.isConnected||card._financeEdit!==session)return;for(const [fid,value] of Object.entries(response.values)){const c=directCardControls(card).find(c=>c.dataset.fieldId===fid);if(c)setControlValue(c,value);}card.dataset.profileLink=JSON.stringify(response.link);card._renderProfileLink?.();refreshAllDependentOptions();applyAutoUpdateRules();SCFinanceEntry.schedule();scheduleDraftSave();d.root.close();}finally{choose.disabled=false;}},'check');line.append(label,choose);list.append(line);}
      if(result.total>result.items.length)list.append(el('p','muted-text',T('نتائج كثيرة؛ ضيّق البحث بالاسم أو المعرّف.')));
    }catch(e){if(seq===request){status.textContent=e.message;status.classList.add('finance-error');}}}
    q.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void search(true);}});d.root.showModal();await SCFinance.fetchSchemas();await search(false);
  }
  async function applyCandidate(card,candidate){
    const session=card._financeEdit,request=(card._profileLinkRequest||0)+1;card._profileLinkRequest=request;
    const response=await post('/api/profile-links/select',{...formPayload(card),link:candidate});
    if(!card.isConnected||card._financeEdit!==session||card._profileLinkRequest!==request||card.matches('dialog')&&!card.open)return false;
    for(const [fid,value] of Object.entries(response.values)){const c=directCardControls(card).find(c=>c.dataset.fieldId===fid);if(c)setControlValue(c,value);}
    card.dataset.profileLink=JSON.stringify(response.link);card._renderProfileLink?.();refreshAllDependentOptions();applyAutoUpdateRules();SCFinanceEntry.schedule();scheduleDraftSave();return true;
  }
  return {config,init,render,collect,read,decorate,applyCandidate,getDraft:()=>clone(draft),setDraft:cfg=>{draft=clone(cfg);render();}};
})();
