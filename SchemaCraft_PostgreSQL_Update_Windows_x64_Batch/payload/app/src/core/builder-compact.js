/* Compact Builder shell. Existing controls and collectors remain authoritative.
 * Detailed windows edit only the parent draft. Cancel/ESC restore both DOM inputs
 * and private editor models; no API save is performed by this layout layer. */
window.SCBuilderCompact = (() => {
  'use strict';
  const {T,clone,el,field,select,input,check}=SCFinance;
  const $=id=>document.getElementById(id);
  const roots={field:$('field-dialog'),category:$('category-dialog')};
  const sessions=new Map();
  let restoring=false;
  const stateKeys=['fieldOptionsDraft','filePartsDraft','optionFilterDraft','compositionDraft','categoryFieldsDraft'];
  const keyFor=id=>id.replace(/^compact-/,'');
  const gateInput=key=>key==='field-search'?elements.fieldSearchable:$('compact-'+key+'-enabled');
  const staticControls=kind=>[...roots[kind].querySelectorAll('input,select,textarea')];
  function capture(kind){
    const stored={};for(const key of stateKeys)stored[key]=clone(state[key]??null);
    const lang=$(kind+'-language-editor')?.scLanguageEditor?.read();
    return {kind,controls:staticControls(kind).map(n=>({id:n.id,node:n,value:n.value,checked:n.checked})),stored,
      conditions:clone(state.draftSchema?.conditions||[]),finance:SCFinance.checkpoint(),rules:SCFieldRules.checkpoint(),
      choices:SCRecordChoices.checkpoint(),delivery:SCTransactionDelivery.checkpoint(),alerts:SCAlerts.checkpoint(kind),lang};
  }
  function restore(s){
    restoring=true;
    try{
      for(const [key,value] of Object.entries(s.stored))state[key]=clone(value);
      state.draftSchema.conditions=clone(s.conditions);
      SCFinance.restoreCheckpoint(s.finance);SCFieldRules.restoreCheckpoint(s.rules);
      SCRecordChoices.restoreCheckpoint(s.choices);SCTransactionDelivery.restoreCheckpoint(s.delivery);
      const native=()=>{for(const {id,node,value,checked} of s.controls){const c=id?$(id):(node?.isConnected?node:null);if(!c)continue;c.value=value;if(c.type==='checkbox'||c.type==='radio')c.checked=checked;c.setCustomValidity?.('');}};
      native();$(s.kind+'-language-editor')?.scLanguageEditor?.restore(s.lang);
      if(s.kind==='field'){
        updateFieldDialogType();renderOptionFilterMatrix();renderFileParts();renderCompositionEditor();
        renderFieldConditionEditor();native();updateAutoUpdateEditor();
      }else{updateCategoryDialogType();fillCategoryCardOptions();renderCategoryImportFields();renderCategoryConditionEditor();native();}
      SCAlerts.restoreCheckpoint(s.kind,s.alerts);
    }finally{restoring=false;}
    refreshField();refreshCategory();
  }
  function hasDetail(kind){return [...sessions.values()].some(x=>x.kind===kind);}
  function languageEnabled(kind){return !!$(kind+'-language-editor')?.querySelector('[data-localized-names-enabled]')?.checked;}
  function setLanguage(kind,on){const c=$(kind+'-language-editor')?.querySelector('[data-localized-names-enabled]');if(c){c.checked=!!on;c.dispatchEvent(new Event('change',{bubbles:true}));}}
  function validationPresent(){return ['validation-min-length','validation-max-length','validation-pattern','validation-min-number','validation-max-number','validation-min-date','validation-max-date','validation-compare-field'].some(id=>String($(id)?.value||'').trim());}
  function setFeature(key,on){
    if(key==='field-option-filter'){if(!on){state.optionFilterDraft=null;elements.optionFilterSource.value='';const second=$('option-filter-source-second');if(second)second.value='';updateFieldDialogType();}}
    else if(key==='field-lookup'){if(!on){elements.relatedPersonSourceField.value='';elements.relatedPersonSourceCheckbox.value='';}SCFinance.setLookupEnabled(on);}
    else if(key==='field-records')SCRecordChoices.setEnabled(on);
    else if(key.endsWith('-language'))setLanguage(key.split('-')[0],on);
    else if(key==='field-auto'&&!on){elements.fieldAutoSource.value='';updateAutoUpdateEditor();}
    else if(key==='field-validation'&&!on){for(const id of ['validation-min-length','validation-max-length','validation-pattern','validation-min-number','validation-max-number','validation-min-date','validation-max-date','validation-compare-field'])$(id).value='';}
    else if(key==='field-search'){elements.fieldSearchable.checked=!!on;elements.fieldSearchMatchWrapper.hidden=!on;}
  }
  function open(key,{enable=false,previous=false}={}){
    const d=$('compact-'+key);if(!d||d.open)return;
    const kind=key.split('-')[0];if(!roots[kind]?.open)return;
    const snapshot=capture(kind),toggle=gateInput(key);
    if(enable&&toggle){const saved=snapshot.controls.find(c=>c.id===toggle.id);if(saved)saved.checked=previous;}
    const session={kind,key,snapshot,trigger:document.activeElement};sessions.set(key,session);
    if(enable)setFeature(key,true);
    // Live source panels contain legacy switches; their single controlling switch
    // is in the parent overview, never a second visible editable checkbox.
    refreshField();refreshCategory();
    d.showModal();d.querySelector(':scope > .dialog-content')?.scrollTo(0,0);
  }
  function validateDetail(key){
    if(key==='field-type'){
      if(elements.fieldType.value==='composed_text')collectComposition();
      SCFinance.collectField();
      const p=$('compact-finance-precision');if(p&&(!Number.isInteger(Number(p.value))||Number(p.value)<0||Number(p.value)>12))throw Error(T('المنازل العشرية يجب أن تكون عددًا صحيحًا من 0 إلى 12.'));
      const plain=$('compact-number-decimal-places');if(plain&&plain.value!==''&&(!Number.isInteger(Number(plain.value))||Number(plain.value)<0||Number(plain.value)>12))throw Error(T('المنازل العشرية يجب أن تكون عددًا صحيحًا من 0 إلى 12.'));
      if(elements.fieldType.value==='select'&&elements.fieldListMode.value==='custom'&&!SCRecordChoices.enabled()&&!reconcileFieldOptions().length)throw Error(T('أضف خيارًا واحدًا على الأقل للحقل.'));
    }
    if(key==='field-option-filter'){
      if(!elements.optionFilterSource.value)throw Error(T('اختر الحقل المتحكم لتفعيل تصفية الخيارات.'));
      state.optionFilterDraft=collectOptionFilter();
    }
    if(key==='field-auto'&&!elements.fieldAutoSource.value)throw Error(T('اختر الحقل المتحكم لتفعيل التحديث التلقائي.'));
    if(key==='field-validation'){
      const v=collectValidation(selectedBuilderFieldType());
      if(!validationPresent())throw Error(T('أضف قيد تحقق واحدًا على الأقل، أو ألغِ النافذة.'));
      if(v.min_length!=null&&v.max_length!=null&&v.min_length>v.max_length)throw Error(T('الحد الأدنى لطول النص أكبر من الحد الأعلى.'));
      if(v.min!=null&&v.max!=null&&v.min>v.max)throw Error(T('الحد الأدنى للرقم أكبر من الحد الأعلى.'));
      if(v.pattern){try{new RegExp(v.pattern);}catch{throw Error(T('نمط التحقق النصي غير صالح.'));}}
    }
    if(key==='field-lookup')SCFinance.collectField();
    if(key==='field-records'){
      const f={id:state.editingFieldId,type:selectedBuilderFieldType()};
      SCRecordChoices.collect(f,SCFinance.collectField());SCTransactionDelivery.validateFieldDraft();
    }
    if(key==='category-type'){SCFinance.collectCategory();SCAlerts.validateDraft('category');}
  }
  function finish(key,commit){
    const session=sessions.get(key),d=$('compact-'+key);if(!session||!d)return;
    if(commit){try{validateDetail(key);}catch(e){showToast(e.message,'error');return;}}
    sessions.delete(key);
    if(!commit)restore(session.snapshot);
    d.close(commit?'apply':'cancel');
    if(session.kind==='field'){if(key==='field-option-filter')updateFieldDialogType();SCFieldRules.render();refreshField();}else refreshCategory();
    const back=session.trigger;if(back?.isConnected&&!back.disabled)back.focus({preventScroll:true});
  }
  function wrapExistingFlag(){
    const label=elements.fieldSearchable.closest('.check-field');if(label.parentElement?.classList.contains('compact-flag-row'))return;
    const row=el('div','compact-flag-row');row.id='compact-field-search-row';label.before(row);row.append(label);
    const b=SCFinance.iconButton('إعدادات لوحة البحث','settings',()=>open('field-search'));b.dataset.compactEdit='field-search';row.append(b);
    // Its own handler above opens the same window; the delegated handler ignores it.
    b.dataset.compactBound='true';
  }
  function clearFinanceField(){for(const id of ['compact-finance-type','compact-finance-lookup','compact-number-exact-slot','compact-number-precision-slot'])$(id)?.replaceChildren();}
  function routeFinanceField(){
    const host=$('finance-field-editor');if(!host)return;
    const isNumeric=['number','current_budget','calculation'].includes(elements.fieldType.value);
    const finance=['current_budget','calculation'].includes(elements.fieldType.value);
    for(const n of [...host.children]){
      if(n.matches('.check-field'))$('compact-number-exact-slot').append(n);
      else (finance?$('compact-finance-type'):$('compact-finance-lookup')).append(n);
    }
    const p=$('compact-finance-type')?.querySelector('[data-compact-finance-precision]');if(p){const from=p.parentElement;$('compact-number-precision-slot').append(p);if(!from.children.length)from.hidden=true;}
    const legacy=$('compact-finance-lookup')?.querySelector('.finance-config-body > .check-field');if(legacy)legacy.hidden=true;
    // Numeric storage choices that cannot apply to derived outputs are unavailable,
    // not accepted and silently discarded after pressing Save.
    elements.numberPreserveLeadingZeros.disabled=finance;
    elements.numberBehaviorEditor.querySelectorAll('[data-number-special]').forEach(c=>c.disabled=finance);
  }
  function recordSourceConfigured(){const s=SCRecordChoices.checkpoint();const sources=s?.draft?.sources||[];return SCRecordChoices.enabled()&&sources.length>0&&sources.every(x=>!!x.field_id);}
  function defaultOptions(f=null){return (f?.options||state.fieldOptionsDraft||[]).map(o=>({...o,display:displayLabel(o),aliases:labelVariants(o)}));}
  function defaultLabels(f=null){return {checked:f?.checkbox_true_label||elements.fieldCheckboxTrueLabel.value||T('محدد'),unchecked:f?.checkbox_false_label||elements.fieldCheckboxFalseLabel.value||T('غير محدد'),recordChoices:SCRecordChoices.enabled()};}
  function validateDefault(meta,f){
    if(meta.defaultToday)return;
    if(meta.defaultInputType===f.type&&Object.hasOwn(meta,'defaultInputText')){
      try{const v=SCBuilderValueControls.resolveDefault(meta.defaultInputText,f.type,defaultOptions(f),defaultLabels(f));meta.defaultEnabled=v.enabled;meta.defaultValue=v.value;}
      catch{throw Error(T('القيمة الافتراضية لا تطابق نوع الحقل أو خياراته؛ اختر قيمة صحيحة أو اتركها فارغة.'));}
    }
    if(meta.defaultEnabled&&SCBuilderValueControls.empty(meta.defaultValue)){meta.defaultEnabled=false;}
  }
  function renderFieldRules(meta){
    const typ=selectedBuilderFieldType(),ui=elements.fieldType.value;
    const manual=['text','textarea','number','select','yes_no','checkbox','checkbox_group',...SCFieldLogic.dates].includes(typ)&&!['current_budget','calculation','composed_text'].includes(ui)&&!(ui==='date'&&elements.fieldDateMode.value==='automatic_checkbox');
    const basic=$('compact-field-default'),reserve=$('compact-preserve-space'),numeric=$('compact-number-separator-slot');
    basic.replaceChildren();reserve.replaceChildren();numeric.replaceChildren();
    basic.hidden=false;basic.classList.toggle('compact-default-unavailable',!manual);
    reserve.append(check('الاحتفاظ بمساحة الحقل عندما يخفيه شرط الظهور',meta.reserveSpace,on=>meta.reserveSpace=on));
    const rh=$('compact-record-options');rh.replaceChildren();
    if(manual){SCRecordChoices.render(rh);SCTransactionDelivery.renderField(rh);}
    const originalToggle=rh.querySelector('#record-choice-settings > .finance-config-body > .check-field');if(originalToggle)originalToggle.hidden=true;
    if(manual){
      const label=el('label','',T('قيمة افتراضية')),holder=el('div','compact-default-controls');
      label.htmlFor='compact-default-value';
      const opts=defaultOptions(),labels=defaultLabels();
      if(typ==='checkbox_group'){
        const c=el('div','compact-default-multiple');c.id='compact-default-value';
        let values=Array.isArray(meta.defaultValue)?meta.defaultValue:[];
        for(const o of state.fieldOptionsDraft||[]){const ch=check('',values.includes(o.id),on=>{values=on?[...values,o.id]:values.filter(v=>v!==o.id);meta.defaultValue=values;meta.defaultEnabled=values.length>0;});SCFinance.named(ch.lastChild,displayLabel(o));c.append(ch);}
        holder.append(c);
      }else{
        const shown=meta.defaultInputType===typ&&Object.hasOwn(meta,'defaultInputText')?meta.defaultInputText:SCBuilderValueControls.defaultText(meta.defaultEnabled?meta.defaultValue:'',typ,opts,labels);
        const c=input(shown,v=>{meta.defaultInputText=v;meta.defaultInputType=typ;meta.defaultEnabled=!!v.trim();meta.defaultValue=v;meta.defaultToday=false;});
        c.id='compact-default-value';c.placeholder=T('أدخل قيمة افتراضية');c.setAttribute('aria-label',T('قيمة افتراضية'));holder.append(c);
        if(typ==='number'){c.inputMode='decimal';c.dir='ltr';}
        if(['checkbox','select','yes_no'].includes(typ)){
          const list=el('datalist');list.id='compact-default-choices';
          const choices=typ==='checkbox'?[labels.checked,labels.unchecked]:opts.map(o=>o.display||o.label);
          for(const v of choices)list.append(new Option(v,v));c.setAttribute('list',list.id);holder.append(list);
        }
        if(SCFieldLogic.dates.has(typ)){
          c.dir=meta.defaultToday?'rtl':'ltr';c.readOnly=!!meta.defaultToday;
          if(meta.defaultToday)c.value=T('تاريخ اليوم عند إنشاء سجل أو بطاقة');
          const today=SCFinance.iconButton('تاريخ اليوم عند إنشاء سجل أو بطاقة','calendar',()=>{
            meta.defaultToday=!meta.defaultToday;meta.defaultEnabled=false;meta.defaultValue='';delete meta.defaultInputText;delete meta.defaultInputType;renderFieldRules(meta);
          });today.id='compact-default-today';today.classList.toggle('is-active',meta.defaultToday);today.setAttribute('aria-pressed',String(!!meta.defaultToday));
          const clear=SCFinance.iconButton('مسح القيمة الافتراضية','clear',()=>{meta.defaultToday=false;meta.defaultEnabled=false;meta.defaultValue='';delete meta.defaultInputText;delete meta.defaultInputType;renderFieldRules(meta);});clear.id='compact-default-clear';
          holder.classList.add('compact-default-date');holder.append(today,clear);
        }
      }
      basic.append(label,holder);
    }
    let typeExtra=$('compact-type-rule-extras');if(!typeExtra){typeExtra=el('div','compact-type-rule-extras');typeExtra.id='compact-type-rule-extras';$('compact-field-type-content').append(typeExtra);}typeExtra.replaceChildren();
    if(['select','yes_no','checkbox_group'].includes(typ))typeExtra.append(check('السماح بإضافة خيارات من صفحة إدخال البيانات',meta.allowNew,on=>meta.allowNew=on));
    const priorToday=$('compact-date-today-setting');if(priorToday)priorToday.remove();
    if(manual&&SCFieldLogic.dates.has(typ)){const choice=check('إدخال تاريخ اليوم عند التأكيد إذا كان الحقل مطلوبًا وفارغًا',meta.today,on=>meta.today=on);choice.id='compact-date-today-setting';elements.fieldDateMode.closest('.field').after(choice);}
    if(typ==='number'){
      const g=el('div','compact-settings-grid');
      g.append(field('فاصل الآلاف',select([[',',T('فاصلة')],['٬',T('فاصل آلاف عربي')],[' ',T('مسافة')]],meta.display.group_separator||',',v=>meta.display.group_separator=v)),field('الفاصل العشري',select([['.',T('نقطة')],['٫',T('فاصل عشري عربي')]],meta.display.decimal_separator||'.',v=>meta.display.decimal_separator=v)));
      numeric.append(g);
      if(!['current_budget','calculation'].includes(ui)){
        const n=input(meta.display.decimal_places??'',v=>{if(v==='')delete meta.display.decimal_places;else meta.display.decimal_places=Number(v);},'number');n.min='0';n.max='12';n.step='1';n.id='compact-number-decimal-places';n.placeholder=T('تلقائي');
        g.append(field('المنازل العشرية',n));
      }
    }
    refreshField();
  }
  function updateFlag(key,on,available=true){
    const row=$('compact-'+key+'-row'),c=gateInput(key);if(row)row.hidden=!available;
    if(c&&!sessions.has(key))c.checked=!!on;
    const b=row?.querySelector('[data-compact-edit]');if(b)b.hidden=!c?.checked||(key==='field-records'&&!recordSourceConfigured());
  }
  function refreshField(){
    if(!roots.field)return;
    const ui=elements.fieldType.value,type=selectedBuilderFieldType();
    $('compact-list-flags').hidden=!['select','yes_no','checkbox_group'].includes(type);
    const fileAdd=$('add-file-part-button');if(fileAdd)fileAdd.hidden=elements.fileTemplateEditor.hidden;
    $('compact-field-type-button').disabled=['system_record_code','spacer'].includes(ui);
    updateFlag('field-search',elements.fieldSearchable.checked,!elements.fieldSearchableWrapper.hidden);
    updateFlag('field-auto',!!elements.fieldAutoSource.value,!elements.fieldAutoUpdateEditor.hidden);
    updateFlag('field-validation',validationPresent(),!elements.fieldValidationEditor.hidden);
    updateFlag('field-lookup',SCFinance.checkpoint().fieldDraft?.mode==='lookup'||!!elements.relatedPersonSourceField.value,!!$('compact-finance-lookup').children.length||!elements.relatedPersonFieldEditor.hidden);
    updateFlag('field-records',SCRecordChoices.enabled(),!!$('compact-record-options').children.length);
    updateFlag('field-language',languageEnabled('field'),type!=='spacer');
    updateFlag('field-option-filter',!!elements.optionFilterSource.value,type==='select');
    $('field-language-editor')?.scLanguageEditor?.setVisibleProperties(['label',...(!elements.fieldPlaceholder.disabled?['placeholder']:[]),...(type==='checkbox'?['checkbox_true_label','checkbox_false_label']:[])]);
    const old=$('field-language-editor')?.querySelector('.localized-names-toggle');if(old)old.hidden=true;
    const details=$('field-language-editor')?.querySelector('details');if(details)details.open=true;
    if(SCRecordChoices.enabled())elements.fieldOptionsWrapper.hidden=true;
  }
  function refreshCategory(){
    const kind=elements.categoryKind.value;
    $('compact-category-type-button').hidden=!['repeatable','view_table'].includes(kind);
    updateFlag('category-language',languageEnabled('category'));
    $('category-language-editor')?.scLanguageEditor?.setVisibleProperties(['label','description',...(kind==='repeatable'?['add_label','card_name_prefix']:[])]);
    const placement=$('category-parent-field-wrapper'),slot=$('compact-category-parent-field-slot');if(placement&&slot){slot.classList.toggle('is-reserved',placement.hidden);slot.setAttribute('aria-hidden',String(placement.hidden));}
    const old=$('category-language-editor')?.querySelector('.localized-names-toggle');if(old)old.hidden=true;
    const details=$('category-language-editor')?.querySelector('details');if(details)details.open=true;
    // A disabled placeholder is not a selectable "no parent" entry.
    const blank=elements.categoryParent.querySelector('option[value=""]');if(blank){blank.textContent=T('اختر الفئة الأم');blank.hidden=true;blank.disabled=true;}
  }
  function prepareField(){refreshField();roots.field.querySelector(':scope > .dialog-content').scrollTop=0;}
  function prepareCategory(){refreshCategory();roots.category.querySelector(':scope > .dialog-content').scrollTop=0;}
  wrapExistingFlag();
  document.querySelectorAll('[data-compact-gate]').forEach(c=>c.addEventListener('change',()=>{
    const key=c.dataset.compactGate;
    if(c.checked)open(key,{enable:true,previous:false});else{setFeature(key,false);refreshField();refreshCategory();}
  }));
  elements.fieldSearchable.addEventListener('change',()=>{if(elements.fieldSearchable.checked)open('field-search',{enable:true,previous:false});});
  document.addEventListener('click',event=>{
    const op=event.target.closest('[data-compact-open]');if(op){event.preventDefault();open(keyFor(op.dataset.compactOpen));return;}
    const edit=event.target.closest('[data-compact-edit]');if(edit&&!edit.dataset.compactBound){event.preventDefault();open(edit.dataset.compactEdit);return;}
    const apply=event.target.closest('[data-compact-apply]');if(apply){event.preventDefault();finish(keyFor(apply.dataset.compactApply),true);return;}
    const cancel=event.target.closest('[data-compact-cancel]');if(cancel){event.preventDefault();finish(keyFor(cancel.dataset.compactCancel),false);}
  });
  for(const d of document.querySelectorAll('.compact-detail-dialog')){
    d.setAttribute('aria-labelledby',d.id+'-title');
    const key=keyFor(d.id);
    d.addEventListener('cancel',e=>{e.preventDefault();finish(key,false);});
    d.addEventListener('close',()=>{if(sessions.has(key)){const s=sessions.get(key);sessions.delete(key);restore(s.snapshot);}});
    // Context Save belongs to the innermost detailed editor, not to the hidden
    // field/category footer or to the schema Save action.
    d.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&window.SCDialogStack.top()===d){e.preventDefault();e.stopPropagation();finish(key,true);}});
  }
  for(const [kind,root] of Object.entries(roots))root.addEventListener('close',()=>{
    for(const [key,s] of sessions)if(s.kind===kind){sessions.delete(key);$('compact-'+key)?.close();}
  });
  return {validateDefault,capture,restore,open,finish,hasDetail,clearFinanceField,routeFinanceField,renderFieldRules,refreshField,refreshCategory,prepareField,prepareCategory};
})();
