/* Optional rules integrate with the existing Builder dialogs and entry controls. */
const SCFieldRules = (() => {
  'use strict';
  const L=SCFieldLogic, {T,el,named,button,iconButton,select,input,field,check,panel}=SCFinance;
  const $=id=>document.getElementById(id);let meta={};
  function init(f){SCRecordChoices.init(f);meta={reserveSpace:!!f?.preserve_hidden_space,defaultToday:!!f?.default_today,defaultEnabled:Object.hasOwn(f||{},'default_value'),defaultValue:SCFinance.clone(f?.default_value??''),allowNew:f?.allow_new_options!==false,today:!!f?.fill_today_when_required,display:SCFinance.clone(f?.number_display||{})};render();}
  function render(){
    if(window.SCBuilderCompact?.renderFieldRules){window.SCBuilderCompact.renderFieldRules(meta);return;}
    let host=$('field-rule-options');if(!host){host=el('div','field-rules-editor');host.id='field-rule-options';$('finance-field-editor').after(host);}
    host.replaceChildren();const typ=selectedBuilderFieldType(),manual=['text','textarea','number','select','yes_no','checkbox','checkbox_group',...L.dates].includes(typ)&&!['current_budget','calculation','composed_text'].includes(elements.fieldType.value)&&!(elements.fieldType.value==='date'&&elements.fieldDateMode.value==='automatic_checkbox');
    host.append(check('الاحتفاظ بمساحة الحقل عندما يخفيه شرط الظهور',meta.reserveSpace,on=>meta.reserveSpace=on));
    if(!manual)return;
    SCRecordChoices.render(host);SCTransactionDelivery.renderField(host);
    const p=panel('سلوك الإدخال والقيم الافتراضية');
    if(['select','yes_no','checkbox_group'].includes(typ))p.body.append(check('السماح بإضافة خيارات من صفحة إدخال البيانات',meta.allowNew,on=>meta.allowNew=on));
    if(L.dates.has(typ))p.body.append(check('إدخال تاريخ اليوم عند التأكيد إذا كان الحقل مطلوبًا وفارغًا',meta.today,on=>meta.today=on));
    if(L.dates.has(typ))p.body.append(field('التاريخ الافتراضي',select([['none',T('بدون قيمة افتراضية')],['fixed',T('تاريخ ثابت')],['today',T('تاريخ اليوم عند إنشاء سجل أو بطاقة')]],meta.defaultToday?'today':meta.defaultEnabled?'fixed':'none',v=>{meta.defaultToday=v==='today';meta.defaultEnabled=v==='fixed';render();})));
    else p.body.append(check('قيمة افتراضية للسجلات والبطاقات الجديدة فقط',meta.defaultEnabled,on=>{meta.defaultEnabled=on;render();}));
    if(meta.defaultEnabled){let c;
      if(typ==='checkbox')c=select([['false',T('غير محدد')],['true',T('محدد')]],String(meta.defaultValue===true),v=>meta.defaultValue=v==='true');
      else if(['select','yes_no'].includes(typ)&&!SCRecordChoices.enabled()){const opts=state.fieldOptionsDraft||[];c=select([['',T('بدون قيمة')],...opts.map(o=>[o.id,displayLabel(o)])],meta.defaultValue,v=>meta.defaultValue=v);}
      else if(typ==='checkbox_group'){c=el('div','field-rules-default-options');let values=Array.isArray(meta.defaultValue)?meta.defaultValue:[];for(const o of state.fieldOptionsDraft||[])c.append(check('',values.includes(o.id),on=>{values=on?[...values,o.id]:values.filter(v=>v!==o.id);meta.defaultValue=values;}),named(el('span'),displayLabel(o)));}
      else{c=input(meta.defaultValue,v=>meta.defaultValue=v);if(L.dates.has(typ)){c.placeholder='YYYY-MM-DD';c.dir='ltr';}if(typ==='number'){c.inputMode='decimal';c.dir='ltr';}}
      p.body.append(field('القيمة الافتراضية',c));
    }
    if(typ==='number'){
      const g=el('div','finance-config-grid');g.append(field('فاصل الآلاف',select([[',',T('فاصلة')],['٬',T('فاصل آلاف عربي')],[' ',T('مسافة')]],meta.display.group_separator||',',v=>meta.display.group_separator=v)),field('الفاصل العشري',select([['.',T('نقطة')],['٫',T('فاصل عشري عربي')]],meta.display.decimal_separator||'.',v=>meta.display.decimal_separator=v)));
      p.body.append(g,el('p','muted-text',T('تُعرض فواصل الآلاف عند تفعيل تنسيق الآلاف في إعدادات العدد. لا تتغير القيمة المخزنة.')));
    }
    host.append(p.root);
  }
  function collect(f,financeMeta){
    for(const k of ['default_value','default_today','preserve_hidden_space','allow_new_options','fill_today_when_required','number_display'])delete f[k];
    if(['select','yes_no','checkbox_group'].includes(f.type))f.allow_new_options=meta.allowNew;
    f.preserve_hidden_space=meta.reserveSpace;
    SCRecordChoices.collect(f,financeMeta);
    if(f.type==='number'){f.number_display={group_separator:meta.display.group_separator||',',decimal_separator:meta.display.decimal_separator||'.'};if(meta.display.decimal_places!=null){if(!Number.isInteger(meta.display.decimal_places)||meta.display.decimal_places<0||meta.display.decimal_places>12)throw Error(scText('المنازل العشرية يجب أن تكون عددًا صحيحًا من 0 إلى 12.'));f.number_display.decimal_places=meta.display.decimal_places;}}
    const manual=!financeMeta?.financial&&!f.composition&&!f.auto_update&&!['user_name','file','spacer','system_record_code','system_created_at','system_updated_at'].includes(f.type)&&(!L.dates.has(f.type)||!f.date_value_mode||f.date_value_mode==='manual');
    if(manual)window.SCBuilderCompact?.validateDefault(meta,f);
    if(manual&&L.dates.has(f.type)&&meta.defaultToday)f.default_today=true;
    if(manual&&meta.defaultEnabled&&!f.default_today){let v=SCFinance.clone(meta.defaultValue);if(f.type==='checkbox')v=v===true||v==='true';if(L.dates.has(f.type)&&!L.blank(v))L.parseDay(v,f.type);if(f.type==='number'&&!L.blank(v)&&f.number_behavior?.storage_mode!=='text')L.numberCompare(v,0);f.default_value=v;}
    if(manual&&L.dates.has(f.type)&&meta.today)f.fill_today_when_required=true;
  }
  function secondarySource(){
    let holder=$('option-filter-second-holder');if(!holder){holder=el('label','field');holder.id='option-filter-second-holder';holder.append(el('span','',T('الحقل المتحكم الثاني — اختياري')));const c=select([], '',v=>{const first=elements.optionFilterSource.value;state.optionFilterDraft={source_field_id:first,...(v?{source_field_ids:[first,v]}:{}),mappings:{},unmatched:'none'};renderOptionFilterMatrix();});c.id='option-filter-source-second';holder.append(c);elements.optionFilterSource.closest('.field').after(holder);}
    const current=state.optionFilterDraft?.source_field_ids?.[1]||'';const c=$('option-filter-source-second');c.replaceChildren(new Option(T('بدون حقل ثانٍ'),''),...compatibleOptionFilterSources(state.editingFieldCategoryId,state.editingFieldId).filter(x=>x.field.id!==elements.optionFilterSource.value).map(({category:c,field:f})=>new Option(`${displayLabel(c)} — ${displayLabel(f)}`,f.id)));c.value=current;holder.hidden=!elements.optionFilterSource.value;
  }
  function sourceTokens(first){const second=$('option-filter-source-second')?.value;if(!second)return optionSourceTokens(first);const f2=fieldById(second);if(!f2)return [];
    const a=optionSourceTokens(first),b=optionSourceTokens(f2);if(a.length*b.length>2000){showToast(T('عدد تركيبات القائمة يتجاوز 2000؛ قلّل خيارات المصدر.'),'error');return [];}
    return a.flatMap(x=>b.map(y=>({id:JSON.stringify([x.id,y.id]),label:`${displayLabel(x)} × ${displayLabel(y)}`})));
  }
  function compareOptions(source,cid,schema=state.draftSchema){return (schema?.categories||[]).flatMap(c=>(c.fields||[]).filter(f=>(c.kind==='main'||c.id===cid)&&L.compatible(source,f)).map(f=>[f.id,`${displayLabel(c)} — ${displayLabel(f)}`]));}
  function conditionField(fid){
    const existing=fieldById(fid);if(existing)return existing;
    if(fid!==state.editingFieldId)return null;
    return {id:fid,label:elements.fieldLabel.value,type:selectedBuilderFieldType(),options:state.fieldOptionsDraft||[],record_options:SCRecordChoices.enabled()?{}:undefined,number_behavior:selectedBuilderFieldType()==='number'?collectNumberBehavior('number'):{}};
  }
  function appearanceCompare(){
    const toggle=elements.conditionCompareEnabled;
    const source=conditionField(elements.conditionSource.value);
    const needs=SCAppearanceCondition.requiresValue(elements.conditionOperator.value);
    const label=$('condition-value-label');
    toggle.disabled=!needs||!source;
    if(toggle.disabled){state.conditionCompareEnabled=false;state.conditionCompareFieldId='';}
    toggle.checked=!!state.conditionCompareEnabled;
    elements.conditionValueWrapper.hidden=false;
    if(!toggle.checked){label.textContent=T('القيمة');return false;}
    label.textContent=T('الحقل المقارن');
    const target=state.conditionTargetType==='category'?categoryById(state.conditionTargetId):fieldCategory(state.conditionTargetId)||categoryById(state.editingFieldCategoryId);
    const options=compareOptions(source,target?.id);
    if(!options.some(([id])=>id===state.conditionCompareFieldId))state.conditionCompareFieldId='';
    const c=select([['',T('اختر حقلًا')],...options],state.conditionCompareFieldId,v=>state.conditionCompareFieldId=v);
    c.id='condition-compare-field';c.setAttribute('aria-labelledby','condition-value-label');
    elements.conditionValueControl.append(c);
    return true;
  }
  function alertCompare(wrap,subject,rule,set,refresh){
    const op=$('alert-rule-operator').value;if(!['equals','not_equals','contains','gt','gte','lt','lte'].includes(op))return false;
    const cid=subject._categoryId||state.editingFieldCategoryId,options=compareOptions(subject,cid);const toggle=check('مقارنة مع قيمة حقل آخر',!!rule.compare_field_id,on=>{set(on?(options[0]?.[0]||''):'');refresh();});wrap.append(toggle);
    if(!rule.compare_field_id)return false;const c=select([['',T('اختر حقلًا')],...options],rule.compare_field_id,set);c.id='alert-rule-compare-field';wrap.append(field('الحقل المقارن',c));return true;
  }
  function fillDates(root=elements.recordForm){
    for(const c of root.querySelectorAll('[data-value-control]')){const f=fieldById(c.dataset.fieldId,state.schema);if(!f?.required||!f.fill_today_when_required||!L.blank(controlValue(c)))continue;
      if(c.closest('[data-field-wrapper]')?.hidden)continue;const card=c.closest('.related-card'),cid=c.dataset.categoryId;if(cid&&!targetVisible('category',cid,mainValues(),card?cardValues(card):null))continue;
      setControlValue(c,L.today(f.type));c.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function initializeMain(){if(state.selectedRecordCode)return;const fields=state.schema.categories.filter(c=>c.kind==='main').flatMap(c=>c.fields);const controls=[...elements.recordForm.querySelectorAll('[data-value-control][data-scope="main"]')];const initial=Object.fromEntries(controls.map(c=>[c.dataset.fieldId,controlValue(c)]));for(const f of fields){if(Object.hasOwn(f,'default_value'))initial[f.id]=SCFinance.clone(f.default_value);else if(f.default_today)initial[f.id]=L.today(f.type);}populateControlsInDependencyOrder(controls,initial);}
  function valueMissing(f,c){const v=controlValue(c);if(f.type==='file')return !(c._selectedFile||v);if(f.type==='checkbox')return v!==true&&v!=='true';return L.blank(v);}
  async function validateRow(card){
    fillDates(card);const snap=collectDraftSnapshot(),cid=card.dataset.categoryId,row=snap.related[cid]?.find(r=>r._child_id===card.dataset.childId);if(!row)throw Error(T('بيانات الصف غير صالحة.'));
    for(const c of directCardControls(card)){const f=fieldById(c.dataset.fieldId,state.schema);if(f?.type==='file'&&c._selectedFile)row.values[f.id]={selected:true,name:c._selectedFile.name};}
    const response=await fetch('/api/field-rules/validate-row',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({main:snap.main,row,category_id:cid,new_row:card.dataset.fieldRulesNew==='true',record_code:state.selectedRecordCode||''})}).then(responseJson);
    // Only server-filled dates are applied here; files remain staged native controls.
    for(const c of directCardControls(card)){const f=fieldById(c.dataset.fieldId,state.schema);if(f?.fill_today_when_required&&L.blank(controlValue(c))&&response.values[f.id])setControlValue(c,response.values[f.id]);}
    return true;
  }
  function closeMenuLayout(menu,control){
    // Menus are paint-only overlays. Opening/closing them must never add scroll
    // space to the row dialog or move neighbouring fields/footer controls.
  }
  function menuBounds(menu,control){
    const d=control.closest('dialog');if(!d?.open||menu.hidden)return;
    const r=control.getBoundingClientRect(),viewportWidth=document.documentElement.clientWidth||window.innerWidth;
    menu.classList.add('field-rules-contained-menu');
    menu.style.position='fixed';
    const minimum=menu.classList.contains('record-choice-menu')?Math.max(r.width,330):r.width;
    const width=Math.min(minimum,Math.max(180,viewportWidth-16));
    menu.style.width=width+'px';
    menu.style.left=Math.max(8,Math.min(r.left,viewportWidth-width-8))+'px';
    menu.style.right='auto';menu.style.bottom='auto';menu.style.zIndex='2147483000';
    if(d.classList.contains('finance-row-dialog')){
      const items=[...menu.children].filter(n=>!n.hidden),visible=items.slice(0,4);
      const css=getComputedStyle(menu),padding=(parseFloat(css.paddingTop)||0)+(parseFloat(css.paddingBottom)||0)+2;
      const height=visible.reduce((sum,n)=>sum+n.getBoundingClientRect().height,0)+padding;
      menu.classList.add('four-choice-menu');
      menu.style.maxHeight=Math.max(32,height)+'px';
      menu.style.overflowY=items.length>4?'auto':'hidden';
      // Always anchor under the control. The menu may extend outside the dialog;
      // it must not resize or scroll the dialog itself.
      menu.style.top=(r.bottom+3)+'px';
      return;
    }
    const dr=d.getBoundingClientRect();const bottom=d.querySelector(':scope > .dialog-actions')?.getBoundingClientRect().top||dr.bottom;
    const below=Math.max(0,bottom-r.bottom-6),above=Math.max(0,r.top-(d.querySelector(':scope > .dialog-heading')?.getBoundingClientRect().bottom||dr.top)-6);
    const up=below<140&&above>below;menu.style.maxHeight=Math.max(40,Math.min(260,up?above:below))+'px';menu.style.top=up?(r.top-Math.min(260,above))+'px':(r.bottom+3)+'px';
  }
  const menuBindings=new WeakMap();
  function bindMenu(menu,control){
    const d=control.closest('dialog');if(!d)return;
    if(!menuBindings.has(d)){
      const entries=new Set();menuBindings.set(d,entries);
      const update=()=>{if(!d.isConnected)return;for(const e of entries){if(!e.control.isConnected){entries.delete(e);continue;}if(!e.menu.hidden)menuBounds(e.menu,e.control);}};
      d.addEventListener('scroll',update,true);
      new ResizeObserver(update).observe(d);
    }
    menuBindings.get(d).add({menu,control});
  }
  function resolveList(c,f){if(f.allow_new_options!==false||!c.value.trim())return;const options=allowedOptionsForControl(c),typed=normalizedComparison(c.value);const exact=options.filter(o=>o.id===c.value||labelVariants(o).some(l=>normalizedComparison(l)===typed));const matches=exact.length?exact:options.filter(o=>labelVariants(o).some(l=>normalizedComparison(l).includes(typed)));if(matches.length===1)c._chooseListOption(matches[0]);else{c.dataset.selectedOptionId='';c.setCustomValidity(T(matches.length?'توجد خيارات متعددة؛ اختر قيمة واحدة من القائمة.':'اختر قيمة موجودة؛ إضافة خيارات جديدة غير مسموحة.'));validateEntryControl(c,true);}}
  function expressionEditor(host,cfg,rerender){
    cfg.expression||=cfg.operands.flatMap((_,i)=>i?['+', {operand:i}]:[{operand:i}]);const p=panel('ترتيب العمليات والأقواس');const rail=el('div','field-expression-tokens');
    let cursor=cfg.expression.length;const show=()=>{rail.replaceChildren();cfg.expression.forEach((token,i)=>{const b=button('',()=>{cursor=i;show();});b.classList.add('field-expression-token');b.classList.toggle('is-active',cursor===i);b.dataset.expressionIndex=i;let label=typeof token==='string'?({'*':'×','/':'÷',sum:'Σ',average:T('متوسط'),count:T('عدد'),min:T('أصغر قيمة'),max:T('أكبر قيمة')}[token]||token):operandLabel(cfg.operands[token.operand],token.operand);named(b,label);rail.append(b);});const end=button('نهاية الصيغة',()=>{cursor=cfg.expression.length;show();});end.classList.toggle('is-active',cursor===cfg.expression.length);rail.append(end);};
    const choices=el('div','field-expression-choices');function insert(t){if(cfg.expression.length>=256)throw Error(T('الصيغة طويلة جدًا.'));cfg.expression.splice(cursor++,0,t);show();}
    cfg.operands.forEach((o,i)=>{const b=button('',()=>insert({operand:i}));named(b,operandLabel(o,i));choices.append(b);});for(const t of ['+','-','*','/','(',')',',','sum','average','count','min','max'])choices.append(button(({ '*':'×','/':'÷',sum:'Σ',average:'متوسط',count:'عدد',min:'أصغر قيمة',max:'أكبر قيمة'})[t]||t,()=>insert(t)));
    p.body.append(rail,choices,button('حذف العنصر المحدد',()=>{if(cursor<cfg.expression.length)cfg.expression.splice(cursor,1);else cfg.expression.pop();cursor=Math.min(cursor,cfg.expression.length);show();},'trash',true));host.append(p.root);show();
  }
  function operandLabel(o,i){if(o?.kind==='field')return displayLabel(fieldById(o.field_id))||T('اختر حقلًا');if(o?.kind==='constant')return String(o.value||'0');return `${T('تجميع من جدول بشروط')} ${i+1}`;}
  function remap(owner,map,categoryMap){
    const linking=owner.transaction_linking||owner.profile_linking;
    if(linking?.incoming_fields)linking.incoming_fields=linking.incoming_fields.map(k=>map.get(k)||k);
    if(owner.option_filter?.source_field_ids)owner.option_filter.source_field_ids=owner.option_filter.source_field_ids.map(k=>map.get(k)||k);
    for(const r of owner.alerts||[]){if(r.compare_field_id)r.compare_field_id=map.get(r.compare_field_id)||r.compare_field_id;for(const c of r.conditions||[])if(c.compare_field_id)c.compare_field_id=map.get(c.compare_field_id)||c.compare_field_id;}
    if(linking)for(const src of linking.sources||[]){const local=!src.schema_id||src.schema_id===state.activeSchemaId;if(local&&src.category_id)src.category_id=categoryMap.get(src.category_id)||src.category_id;for(const m of src.matches||[]){m.local_field_id=map.get(m.local_field_id)||m.local_field_id;if(local)m.remote_field_id=map.get(m.remote_field_id)||m.remote_field_id;}for(const m of src.copies||[]){m.target_field_id=map.get(m.target_field_id)||m.target_field_id;if(local)m.source_field_id=map.get(m.source_field_id)||m.source_field_id;}if(src.destination){const d=src.destination;if(local)d.category_id=categoryMap.get(d.category_id)||d.category_id;for(const m of d.mappings||[]){m.source_field_id=map.get(m.source_field_id)||m.source_field_id;if(local)m.target_field_id=map.get(m.target_field_id)||m.target_field_id;}}}
  }
  function checkpoint(){return SCFinance.clone(meta);}
  function restoreCheckpoint(value){meta=SCFinance.clone(value);}
  return {checkpoint,restoreCheckpoint,conditionField,compareOptions,init,render,collect,secondarySource,sourceTokens,appearanceCompare,alertCompare,fillDates,initializeMain,valueMissing,validateRow,closeMenuLayout,menuBounds,bindMenu,resolveList,expressionEditor,remap};
})();
