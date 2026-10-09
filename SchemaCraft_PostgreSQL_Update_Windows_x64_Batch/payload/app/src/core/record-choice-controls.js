/* Saved-record choice sources. Names are visible; identity stays in data/API keys.
   Selection is explicit. Typing alone never chooses a person or writes remotely. */
const SCRecordChoices = (() => {
  'use strict';
  const {T,clone,id,el,named,button,iconButton,select,field,panel,check}=SCFinance;
  let draft=null, active=false, incomingSequence=0;
  let incomingLinks=new Map();
  function linksForRow(categoryId,childId){return incomingLinks.get(categoryId+'|'+childId)||[];}
  const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(responseJson);
  function init(f){
    active=!!f?.record_options;draft=clone(f?.record_options||{sources:[],allow_unmatched:true});
    SCFinance.fetchSchemas().then(()=>{if(elements.fieldDialog.open)SCFieldRules.render();}).catch(e=>showToast(e.message,'error'));
  }
  function enabled(){return active;}
  function render(host){
    if(!['text','select'].includes(selectedBuilderFieldType())||['current_budget','calculation','composed_text'].includes(elements.fieldType.value))return;
    if(selectedBuilderFieldType()==='select'&&active)elements.fieldOptionsWrapper.hidden=true;
    const p=panel('مصدر الخيارات من سجلات التصاميم');p.root.id='record-choice-settings';
    p.body.append(check('اختيار قيم حقل من تصميم واحد أو أكثر',active,on=>{active=on;SCFieldRules.render();}));
    if(active){
      p.body.append(check('السماح بحفظ النص دون مطابقة أو ربط',draft.allow_unmatched!==false,on=>draft.allow_unmatched=on));
      draft.sources.forEach((source,index)=>{
        const line=el('div','record-choice-source');
        const sc=!source.schema_id||source.schema_id===state.activeSchemaId?state.draftSchema:SCFinance.schemas[source.schema_id]?.schema;
        line.append(field('التصميم المصدر',select([['',T('التصميم الحالي')],...Object.entries(SCFinance.schemas).filter(([k])=>k!==state.activeSchemaId).map(([k,v])=>[k,v.name])],source.schema_id,v=>{source.schema_id=v;source.category_id='';source.field_id='';SCFieldRules.render();})));
        line.append(field('صف المصدر',select([['',T('حقول الملف الرئيسي')],...(sc?.categories||[]).filter(c=>c.kind==='repeatable').map(c=>[c.id,displayLabel(c)])],source.category_id||'',v=>{source.category_id=v;source.field_id='';SCFieldRules.render();})));
        const choices=(sc?.categories||[]).filter(c=>c.kind==='main'||c.id===source.category_id).flatMap(c=>(c.fields||[]).filter(f=>!['file','spacer','field_group','checkbox_group'].includes(f.type)).map(f=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`]));
        line.append(field('الحقل الذي يزوّد الخيارات',select([['',T('اختر حقلًا')],['$record_code',T('معرّف السجل')],...choices],source.field_id,v=>source.field_id=v)),iconButton('حذف المصدر','trash',()=>{draft.sources.splice(index,1);SCFieldRules.render();},true));
        p.body.append(line);
      });
      p.actions.append(button('إضافة مصدر خيارات',()=>{draft.sources.push({id:id('choices'),schema_id:'',category_id:'',field_id:''});SCFieldRules.render();},'plus'));p.body.append(el('p','muted-text',T('تُقرأ القيم من السجلات المحفوظة. اختر اقتراحًا لتأكيد الهوية؛ الكتابة وحدها لا تربط سجلًا.')));
    }
    
    host.append(p.root);
  }
  function collect(f,finance){
    delete f.record_options;
    if(!active||!['text','select'].includes(f.type))return;
    if(finance?.financial||f.composition||f.auto_update||f.option_filter)throw Error(T('لا تجمع اختيار السجلات مع مصدر تلقائي أو قائمة تابعة للحقل نفسه.'));
    if(!draft.sources.length||draft.sources.length>16||draft.sources.some(s=>!s.field_id))throw Error(T('اختر مصدر قيم واحدًا على الأقل وأكمل حقوله.'));
    f.record_options=clone(draft);f.allow_new_options=false;
  }
  function numericConstant(value,change){
    const c=el('input','control numeric-constant-input');c.type='text';c.inputMode='decimal';c.dir='ltr';
    try{c.value=SCFieldLogic.constantDisplay(value??'0');}catch{c.value=String(value??'');}
    const allowed=s=>/^[0-9٠-٩۰-۹+−\-.,٬٫\s]*$/.test(s);
    c.addEventListener('beforeinput',e=>{if(e.data&&!allowed(e.data))e.preventDefault();});
    c.addEventListener('paste',e=>{const text=e.clipboardData?.getData('text');if(text&&!allowed(text)){e.preventDefault();c.setCustomValidity(T('أدخل قيمة عددية فقط؛ الفواصل لتجميع الآلاف.'));c.reportValidity();}});
    c.addEventListener('input',()=>{try{const raw=SCFieldLogic.constantNumber(c.value);c.setCustomValidity('');change(raw);}catch{change(c.value);c.setCustomValidity(T('أدخل قيمة عددية فقط؛ الفواصل لتجميع الآلاف.'));}});
    c.addEventListener('blur',()=>{try{const raw=SCFieldLogic.constantNumber(c.value);change(raw);c.value=SCFieldLogic.constantDisplay(raw);c.setCustomValidity('');}catch{c.setCustomValidity(T('أدخل قيمة عددية فقط؛ الفواصل لتجميع الآلاف.'));}});
    return c;
  }
  function control(f,scope,cid){
    const root=el('div','editable-list-control record-choice-control'),c=el('input','control'),menu=el('div','editable-list-menu record-choice-menu');
    c.type='text';c.autocomplete='off';c.placeholder=displayLabel(f,'placeholder')||T('اكتب للبحث في قيم السجلات');c.required=!!f.required;
    setControlDataset(c,f,scope,cid);c.dataset.recordChoice='true';
    menu.id=id('record-choices');menu.hidden=true;menu.setAttribute('role','listbox');c.setAttribute('role','combobox');c.setAttribute('aria-autocomplete','list');c.setAttribute('aria-controls',menu.id);c.setAttribute('aria-expanded','false');
    let seq=0,timer=null,index=-1;
    const close=()=>{seq++;menu.hidden=true;c.setAttribute('aria-expanded','false');c.removeAttribute('aria-activedescendant');SCFieldRules.closeMenuLayout(menu,c);};
    const origin=item=>[item.schema_name,item.record_title,item.record_code,item.row_title].filter(Boolean).join(' · ');
    async function choose(item){
      const card=c.closest('.related-card'),category=categoryById(cid,state.schema),cfg=SCProfileLinks.config(category);
      const linkOwner=SCTransactionDelivery.ownerField(category),mayLink=!linkOwner||linkOwner.id===f.id;
      const validSources=(cfg?.enabled&&mayLink?cfg.sources:[]).filter(s=>(s.schema_id||state.activeSchemaId)===(item.schema_id||state.activeSchemaId)&&(s.category_id||'')===(item.category_id||''));
      c.value=item.value;c._recordChoiceInvalid=false;c.setCustomValidity('');close();
      // Do not allow an old identity to survive choosing a different value.
      if(card&&mayLink&&cfg?.enabled){delete card.dataset.profileLink;card._renderProfileLink?.();}
      async function link(source){return SCProfileLinks.applyCandidate(card,{...item,source_id:source.id});}
      try{
        if(card&&validSources.length===1){if(await link(validSources[0])===false)return;}
        else if(card&&validSources.length>1){
          const d=SCFinance.dialog('اختيار طريقة ربط القيمة');
          validSources.forEach((source,i)=>d.body.append(button(`${T('ربط')} ${i+1}`,async()=>{await link(source);d.root.close();},'link')));
          d.foot.append(button('إبقاء القيم دون ربط',()=>d.root.close()));d.root.showModal();
        }
        c.dispatchEvent(new Event('change',{bubbles:true}));scheduleDraftSave();
      }catch(e){showToast(e.message,'error');}
    }
    async function search(){
      const run=++seq;if(!c.isConnected||document.activeElement!==c)return;
      try{
        const result=await post('/api/profile-links/options',{field_id:f.id,search:c.value});
        if(run!==seq||!c.isConnected||document.activeElement!==c)return;
        menu.replaceChildren();index=-1;
        for(const [i,item] of result.items.entries()){
          const b=el('button','editable-list-option record-choice-option');b.type='button';b.tabIndex=-1;b.id=menu.id+'-'+i;b.setAttribute('role','option');
          b.append(named(el('strong'),item.value),named(el('small'),origin(item)));b.title=origin(item);b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('click',()=>void choose(item));menu.append(b);
        }
        if(!result.items.length){const hint=el('div','record-choice-empty',T(result.allow_unmatched?'لا يوجد تطابق؛ يمكنك الاحتفاظ بالنص دون ربط.':'لا يوجد تطابق؛ اختر قيمة من السجلات.'));menu.append(hint);}
        if(result.has_more)menu.append(el('div','record-choice-empty',T('نتائج كثيرة؛ اكتب المزيد لتضييق الخيارات.')));
        c._recordChoiceInvalid=!result.allow_unmatched&&!!c.value.trim()&&c.value!==c._recordChoiceOriginal&&!result.exact_match;
        menu.hidden=false;c.setAttribute('aria-expanded','true');SCFieldRules.menuBounds(menu,c);
      }catch(e){if(run===seq){menu.replaceChildren(el('div','record-choice-empty finance-error',e.message));menu.hidden=false;c.setAttribute('aria-expanded','true');SCFieldRules.menuBounds(menu,c);}}
    }
    c.addEventListener('focus',()=>void search());
    c.addEventListener('input',()=>{
      c._recordChoiceInvalid=false;c.setCustomValidity('');const card=c.closest('.related-card');const cat=categoryById(cid,state.schema),owner=SCTransactionDelivery.ownerField(cat);const mayLink=!!SCProfileLinks.config(cat).enabled&&(!owner||owner.id===f.id);if(card&&mayLink)card._profileLinkRequest=(card._profileLinkRequest||0)+1;if(mayLink&&card?.dataset.profileLink){delete card.dataset.profileLink;card._renderProfileLink?.();}
      seq++;clearTimeout(timer);timer=setTimeout(search,180);
    });
    c.addEventListener('blur',close);
    c.addEventListener('keydown',e=>{
      const items=[...menu.querySelectorAll('button')];
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(menu.hidden){void search();return;}if(!items.length)return;index=(index+(e.key==='ArrowDown'?1:items.length-1)+items.length)%items.length;items.forEach((n,i)=>{n.classList.toggle('is-active',i===index);n.setAttribute('aria-selected',String(i===index));});c.setAttribute('aria-activedescendant',items[index].id);items[index].scrollIntoView({block:'nearest'});}
      else if(e.key==='Enter'&&!menu.hidden&&index>=0){e.preventDefault();items[index]?.click();}
      else if(e.key==='Escape')close();
    });
    c._closeListMenu=close;root.append(c,menu);queueMicrotask(()=>SCFieldRules.bindMenu(menu,c));return {root,control:c};
  }
  function clearIncoming(){incomingSequence++;incomingLinks.clear();document.getElementById('profile-incoming-links')?.remove();}
  async function refreshIncoming(){
    // A saved link is effective immediately, independent of which side created it.
    // Inbound links decorate existing original rows; never create a second table,
    // monetary copy, or recipient approval workflow.
    clearIncoming();
    const code=state.selectedRecordCode,sid=state.activeSchemaId,run=incomingSequence;
    if(!code)return;
    try{
      const result=await post('/api/profile-links/incoming',{record_code:code});
      if(run!==incomingSequence||code!==state.selectedRecordCode||sid!==state.activeSchemaId)return;
      for(const group of result.groups||[])for(const row of group.rows||[]){
        if(!row.target_category_id||!row.target_child_id)continue;
        const key=row.target_category_id+'|'+row.target_child_id;
        if(!incomingLinks.has(key))incomingLinks.set(key,[]);
        incomingLinks.get(key).push({schema_id:group.schema_id,schema_name:group.schema_name,
          record_id:row.record_id,record_code:row.record_code,record_title:row.record_title,
          category_id:group.category_id,child_id:row.child_id});
      }
      document.querySelectorAll('[data-related-records]').forEach(records=>{
        if(SCFinanceEntry.isTable(categoryById(records.dataset.relatedRecords,state.schema)))SCFinanceEntry.renderTable(records);
      });
    }catch(error){if(run===incomingSequence)showToast(T('تعذر تحميل روابط السجل: ')+error.message,'error');}
  }
  function checkpoint(){return clone({active,draft});}
  function restoreCheckpoint(value){active=value.active;draft=clone(value.draft);}
  function setEnabled(on){active=!!on;SCFieldRules.render();}
  return {configuration:()=>active?clone(draft):null,checkpoint,restoreCheckpoint,setEnabled,init,enabled,render,collect,numericConstant,control,clearIncoming,refreshIncoming,linksForRow};
})();
