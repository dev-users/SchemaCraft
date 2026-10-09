/* Tables are projections over the existing card forms. Only the normal record Save persists data. */
const SCFinanceEntry = (() => {
  'use strict';
  const {T,el,named,button,iconButton,dialog,check}=SCFinance;
  const tableFilters=new WeakMap(),viewFilters=new Map();
  let timer=null,version=0,latest=null,errors=[],updating=false;
  const isTable=c=>c?.kind==='repeatable'&&c.table?.display==='table';
  const editing=()=>!!document.querySelector('dialog.finance-row-dialog[open]');
  const key=v=>JSON.stringify(v===null||v===undefined?'':v);
  const blank=v=>v==null||v===''||(Array.isArray(v)&&v.length===0);
  const raw=(card,fid)=>{const c=directCardControls(card).find(n=>n.dataset.fieldId===fid)||[...elements.recordForm.querySelectorAll('[data-value-control][data-scope="main"]')].find(n=>n.dataset.fieldId===fid);return c?controlValue(c):'';};
  const fieldLabel=f=>displayLabel(f)||'';
  function shown(f,v){
    if(blank(v))return '';
    if(f.type==='number')return SCFieldLogic.formatNumber(v,f);
    if(f.type==='checkbox')return checkboxDisplayMeaning(f,v===true||String(v)==='true');
    if(f.type==='file')return String(v?.name||v?.filename||v).split(/[\\/]/).pop();
    if(['select','yes_no'].includes(f.type))return displayLabel(optionForValue(f,v))||String(v);
    if(f.type==='checkbox_group')return (Array.isArray(v)?v:String(v).split(' | ')).map(x=>displayLabel(optionForValue(f,x))||String(x)).join('، ');
    return String(v);
  }
  function fitColumns(table,wrap){
    const cells=[...table.tHead?.rows?.[0]?.cells||[]];
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    if(!ctx)return;
    const fontOf=node=>{const s=getComputedStyle(node);return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;};
    const inset=node=>{const s=getComputedStyle(node);return (parseFloat(s.paddingLeft)||0)+(parseFloat(s.paddingRight)||0);};
    ctx.font=fontOf(table);
    const width=text=>Math.max(...String(text||'').split('\n').map(line=>ctx.measureText(line.slice(0,400)).width),0);
    const rows=[...table.tBodies[0]?.rows||[]];
    // At most 250 representative rows for layout. Values remain fully available.
    const sample=rows.length<=250?rows:Array.from({length:250},(_,i)=>rows[Math.floor(i*(rows.length-1)/249)]);
    let total=0;const group=el('colgroup');
    cells.forEach((cell,index)=>{
      const action=cell.dataset.financeActions==='true';
      const heading=cell.querySelector('.finance-column-heading'),label=heading?.querySelector('span')||cell;
      ctx.font=fontOf(label);
      const headerWidth=width(label.textContent);
      const headerExtra=inset(cell)+(heading?inset(heading):0)+8;
      ctx.font=fontOf(table);
      let content=0;
      for(const row of sample){const td=row.cells[index];if(!td||td.colSpan>1)continue;content=Math.max(content,action?td.querySelectorAll('button').length*40:width(td.textContent));}
      const px=Math.ceil(action?Math.max(96,Math.min(176,content+16)):Math.min(340,Math.max(96,headerWidth+headerExtra,content+inset(cell)+8)));
      const col=el('col');col.style.width=px+'px';group.append(col);total+=px;
    });
    table.querySelector(':scope > colgroup')?.remove();table.prepend(group);
    table.style.minWidth=total+'px';table.style.width='100%';
    table.dataset.contentSized='true';
  }
  async function openRelated(link){
    // Never acknowledge or save anything from the recipient side. This is navigation.
    if(editing()||hasUnsavedWorkspaceChanges()){
      showToast(T('احفظ التغييرات أو تجاهلها قبل فتح السجل المرتبط.'),'error');return;
    }
    try {
      const okay=await switchActiveSchema(link.schema_id||state.activeSchemaId,{mode:'entry',openCode:link.record_code});
      if(okay===false)return;
      if(state.selectedRecordCode!==link.record_code)throw Error(T('تعذر فتح السجل المرتبط؛ أعد المحاولة.'));
      if(link.category_id){
        let cat=categoryById(link.category_id,state.schema);const visited=new Set();while(cat?.parent_category_id&&!visited.has(cat.id)){visited.add(cat.id);cat=categoryById(cat.parent_category_id,state.schema);}
        if(cat)selectMainCategoryTab(cat.id);
        const row=[...document.querySelectorAll('.related-card')].find(c=>c.dataset.categoryId===link.category_id&&c.dataset.childId===link.child_id);
        if(row){row.dataset.linkNavigation='true';if(row.matches('dialog.finance-row-dialog')&&!SCTransactionDelivery.origin(row)&&!state.currentRecordArchived){let parent=row.parentElement?.closest('dialog.finance-row-dialog');if(parent&&!parent.open)open(parent);open(row);}else{const visible=[...document.querySelectorAll('[data-finance-child]')].find(n=>n.dataset.financeChild===row.dataset.childId);if(visible){visible.classList.add('transaction-navigation-highlight');visible.scrollIntoView({block:'center'});visible.focus();}else row.scrollIntoView({block:'center'});}}
        else if(link.child_id)showToast(T('الحركة المرتبطة لم تعد متاحة في الجدول.'),'error');
      }
    } catch(error) {showToast(error.message,'error');}
  }
  function relationshipAction(card){
    let direct=null;try{direct=card.dataset.profileLink?JSON.parse(card.dataset.profileLink):null;}catch{}
    const delivered=SCTransactionDelivery.origin(card);
    const candidates=[...(delivered?.record_code?[delivered]:[]),...(SCRecordChoices.linksForRow(card.dataset.categoryId,card.dataset.childId)||[]),...(direct?.record_code?[direct]:[])];
    const seen=new Set(),links=candidates.filter(link=>{const key=[link.schema_id,link.record_id||link.record_code].join('|');if(seen.has(key))return false;seen.add(key);return true;});
    if(!links.length)return null;
    const b=iconButton('فتح ملف صاحب الحركة المرتبطة','open',()=>{
      if(links.length===1){void openRelated(links[0]);return;}
      const d=dialog('السجلات المرتبطة بالحركة');
      for(const link of links){const choice=button('',()=>{d.root.close();void openRelated(link);},'open');named(choice,[link.schema_name,link.record_title,link.record_code].filter(Boolean).join(' — '));d.body.append(choice);}
      d.foot.append(button('إغلاق',()=>d.root.close()));d.root.showModal();
    });
    b.dataset.openLinkedProfile='true';
    b.title=T('فتح ملف صاحب الحركة المرتبطة')+' — '+links.map(l=>l.record_title||l.record_code).join('، ');
    return b;
  }
  function numberParts(v){
    let s=String(v??'').replace(/[٠-٩۰-۹]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)<0?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace('٫','.').replace('−','-').trim();
    if(s.length>80||!/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d{1,2}))?$/.test(s))return null;
    const m=s.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d{1,2}))?$/),[a,b='']=m[2].split('.'),exp=Number(m[3]||0);let n=BigInt((a||'0')+b)*(m[1]==='-'?-1n:1n),scale=b.length-exp;
    if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,scale};
  }
  function compare(a,b,numeric){if(numeric){a=numberParts(a);b=numberParts(b);if(!a||!b)return NaN;const scale=Math.max(a.scale,b.scale),x=a.n*10n**BigInt(scale-a.scale),y=b.n*10n**BigInt(scale-b.scale);return x<y?-1:x>y?1:0;}return String(a??'').normalize('NFKC').trim().toLocaleLowerCase().localeCompare(String(b??'').normalize('NFKC').trim().toLocaleLowerCase());}
  function matches(rule,value,f){const op=rule.operator;if(op==='empty')return blank(value);if(op==='not_empty')return !blank(value);if(blank(value))return false;const expected=rule.value??'',numeric=SCFinance.numeric(f);if(Array.isArray(value)){const found=value.some(x=>compare(shown(f,x),shown(f,expected),false)===0);return ['not_equals','not_contains'].includes(op)?!found:found;}if(op==='contains')return shown(f,value).toLocaleLowerCase().includes(shown(f,expected).toLocaleLowerCase());if(op==='not_contains')return !matches({...rule,operator:'contains'},value,f);if(f.type==='checkbox'){value=value===true||String(value)==='true';return op==='not_equals'?value!==(String(expected)==='true'):value===(String(expected)==='true');}const result=compare(value,expected,numeric);if(Number.isNaN(result))return false;return ({equals:result===0,not_equals:result!==0,gt:result>0,gte:result>=0,lt:result<0,lte:result<=0,between:result>=0&&compare(value,rule.upper,numeric)<=0})[op]||false;}
  function filtersFor(records){if(!tableFilters.has(records))tableFilters.set(records,new Map());return tableFilters.get(records);}
  function visibleCards(records,fields){const filters=filtersFor(records);return directRelatedCards(records).filter(card=>[...filters].every(([fid,choices])=>choices==null||choices.includes(key(raw(card,fid)))));}
  function snapshot(card){
    return {controls:[...card.querySelectorAll('input,select,textarea')].map(n=>({n,value:n.value,checked:n.checked,selected:n.tagName==='SELECT'?[...n.options].map(o=>o.selected):null,dataset:{...n.dataset},file:n._selectedFile,upload:n._uploadName})),containers:[...card.querySelectorAll('[data-related-records]')].map(n=>({n,nodes:[...n.children]})),cards:[card,...card.querySelectorAll('.related-card')].map(n=>({n,dataset:{...n.dataset}}))};
  }
  function restore(snap){
    for(const x of snap.containers)x.n.replaceChildren(...x.nodes);
    for(const x of snap.cards){for(const k of Object.keys(x.n.dataset))delete x.n.dataset[k];Object.assign(x.n.dataset,x.dataset);x.n._renderProfileLink?.();}
    for(const x of snap.controls){if(x.n.type!=='file')x.n.value=x.value;x.n.checked=x.checked;if(x.selected)[...x.n.options].forEach((o,i)=>o.selected=x.selected[i]||false);for(const k of Object.keys(x.n.dataset))delete x.n.dataset[k];Object.assign(x.n.dataset,x.dataset);x.n._selectedFile=x.file;x.n._uploadName=x.upload;if(x.n.dataset.valueControl!==undefined&&fieldById(x.n.dataset.fieldId,state.schema)?.type==='file')refreshFileSummary(x.n);x.n._syncCheckboxMeaning?.();}
    for(const x of snap.containers)renumberRelatedCards(x.n,true);
  }
  function decorate(card,category,isNew){
    card.classList.add('editor-dialog','finance-row-dialog');card.dataset.financeRow='';
    const body=el('div','dialog-content finance-row-body');while(card.firstChild)body.append(card.firstChild);
    const head=el('div','dialog-heading'),title=named(el('h2'),fieldLabel(category));
    const cancel=()=>{card.returnValue='cancel';card.close();};const x=button('',cancel);x.textContent='×';x.className='dialog-close';x.setAttribute('aria-label',T('إلغاء'));head.append(title,x);
    const foot=el('div','dialog-actions');const save=button('حفظ الصف',async()=>{
      if(save.disabled)return;save.disabled=true;
      try { SCFieldRules.fillDates(card);if(!(await refresh(true)))return;
      try {await SCFieldRules.validateRow(card);} catch(error){showToast(error.message,'error');return;}
      const invalid=[...card.querySelectorAll('[data-value-control]')].find(c=>!validateEntryControl(c,true));
      if(invalid){const nested=invalid.closest('dialog.finance-row-dialog');if(nested&&nested!==card&&!nested.open)open(nested);invalid.focus();return;}
      card.returnValue='save';card.close();
      } finally {save.disabled=false;}
    },'save');save.className='button button-primary';foot.append(save,button('إلغاء',cancel));card.append(head,body,foot);
    card.addEventListener('close',()=>{
      const session=card._financeEdit;if(!session)return;card._financeEdit=null;
      if(card.returnValue!=='save'){
        if(session.isNew)card.remove();else restore(session.snapshot);
      }
      const records=session.records;if(records.isConnected)renderTable(records);
      refreshAllDependentOptions(false);updateConditionalVisibility();
      if(card.returnValue==='save'||session.priorDirty)scheduleDraftSave();else schedule();
    });
    card.addEventListener('cancel',()=>{card.returnValue='cancel';});
    if(isNew)queueMicrotask(()=>{if(card.isConnected&&!state.restoringDraft)open(card,true);});
  }
  function open(card,isNew=false){if(!card||card.open)return;card.hidden=false;card._financeEdit={snapshot:snapshot(card),isNew,records:card.parentElement,priorDirty:state.recordDirty};card.returnValue='';card.showModal();clearTimeout(state.draftDebounceTimer);const first=directCardControls(card).find(c=>!c.disabled&&!c.readOnly&&c.type!=='hidden');first?.focus();}
  async function remove(card){
    if(!(await requestConfirmation(T('هل تريد حذف هذا الصف؟'),{title:T('حذف الصف'),confirmLabel:T('حذف')})))return;
    const records=card.parentElement;card.remove();renumberRelatedCards(records);scheduleDraftSave();
  }
  async function bulk(records,f,value){
    const rows=visibleCards(records).filter(c=>!SCTransactionDelivery.origin(c));if(!rows.length)return;
    const category=categoryById(records.dataset.relatedRecords,state.schema);
    if(f.financial)return;
    if(value&&f.unique_checked_across_cards&&rows.length>1){showToast(T('هذا الحقل لا يسمح بتحديد أكثر من بطاقة واحدة.'),'error');return;}
    if(!(await requestConfirmation(`${T(value?'تحديد كل الصفوف الظاهرة':'إلغاء تحديد كل الصفوف الظاهرة')} — ${rows.length}`,{title:fieldLabel(f),confirmLabel:T('تأكيد'),danger:!value})))return;
    if(state.currentRecordArchived)return;
    for(const row of rows){const control=directCardControls(row).find(c=>c.dataset.fieldId===f.id);if(!control||control.disabled)continue;setControlValue(control,value);}
    applyAutoUpdateRules();updateConditionalVisibility();renderTable(records);scheduleDraftSave();
  }
  function valuePicker(f,options,current,apply){
    const d=dialog('تصفية العمود'),search=el('input','control');search.placeholder=T('بحث في القيم');d.body.append(named(el('strong'),fieldLabel(f)),search);
    const picked=new Set(current??options.map(o=>o.key));const list=el('div','finance-value-list');
    const redraw=()=>{list.replaceChildren();for(const o of options){if(!o.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))continue;const row=check('',picked.has(o.key),on=>{on?picked.add(o.key):picked.delete(o.key);});row.append(named(el('span'),o.label));list.append(row);}};
    search.addEventListener('input',redraw);
    d.body.append(button('تحديد الكل',()=>{options.forEach(o=>picked.add(o.key));redraw();}),button('إلغاء الكل',()=>{picked.clear();redraw();}),list);
    d.foot.append(button('تطبيق',()=>{apply(picked.size===options.length?null:[...picked]);d.root.close();},'check'),button('إزالة المرشح',()=>{apply(null);d.root.close();}),button('إلغاء',()=>d.root.close()));redraw();d.root.showModal();
  }
  function optionsFrom(rows,f,get= r=>r[f.id]){const map=new Map();for(const r of rows){const v=get(r);map.set(key(v),{key:key(v),value:v,label:blank(v)?T('فارغ'):shown(f,v)});}return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));}
  function renderTable(records){
    const category=categoryById(records.dataset.relatedRecords,state.schema);if(!isTable(category))return false;
    const fields=category.fields.filter(f=>!isLayoutField(f)&&(!category.table.columns?.length||category.table.columns.includes(f.id)));
    records.classList.add('finance-form-store');records.parentElement.classList.add('finance-table-workspace');
    const rail=records.parentElement.querySelector(':scope > .related-add-row');if(rail){rail.classList.add('finance-table-rail');rail.querySelectorAll('[data-related-tab]').forEach(n=>n.remove());}
    let host=records.parentElement.querySelector(':scope > .finance-table-host');if(!host){host=el('div','finance-table-host');records.before(host);}host.replaceChildren();
    const filters=filtersFor(records),rows=visibleCards(records);const top=el('div','finance-table-status');top.append(el('span','muted-text',`${rows.length} / ${directRelatedCards(records).length}`));if(filters.size)top.append(button('مسح مرشحات الجدول',()=>{tableFilters.delete(records);renderTable(records);},'filter'));
    const wrap=el('div','finance-table-scroll'),table=el('table','data-table finance-entry-table'),head=el('thead'),tr=el('tr');
    for(const f of fields){const th=el('th'),line=el('div','finance-column-heading');line.append(named(el('span'),fieldLabel(f)));const filter=iconButton('تصفية العمود','filter',()=>valuePicker(f,optionsFrom(directRelatedCards(records),f,r=>raw(r,f.id)),filters.get(f.id),chosen=>{chosen===null?filters.delete(f.id):filters.set(f.id,chosen);renderTable(records);}));filter.classList.toggle('is-active',filters.has(f.id));line.append(filter);th.append(line);
      if(f.type==='checkbox'&&!f.financial){const tools=el('div','finance-checkbox-tools');for(const [value,caption,icon] of [[true,'تحديد كل الصفوف الظاهرة','check'],[false,'إلغاء تحديد كل الصفوف الظاهرة','close']]){const b=iconButton(caption,icon,()=>bulk(records,f,value));b.disabled=!!state.currentRecordArchived||!rows.length;tools.append(b);}th.append(tools);}tr.append(th);}
    head.append(tr);table.append(head);const tbody=el('tbody');
    for(const card of rows){const row=el('tr');row.dataset.financeChild=card.dataset.childId;if(card.dataset.linkNavigation==='true')row.classList.add('transaction-navigation-highlight');const highlight=(category.table.row_rules||[]).find(rule=>{const results=(rule.filters||[]).map(cond=>matches(cond,raw(card,cond.field_id),fieldById(cond.field_id,state.schema)||{}));return results.length&&(rule.match==='any'?results.some(Boolean):results.every(Boolean));});if(highlight){row.style.setProperty('--finance-row-color',highlight.color);row.classList.add('finance-highlight');}
      for(const f of fields){const td=el('td');const display=shown(f,raw(card,f.id));named(td,display);td.title=display;if(SCFinance.numeric(f))td.classList.add('finance-number');row.append(td);}const actions=[];
      const origin=SCTransactionDelivery.origin(card),linked=relationshipAction(card);
      if(origin){const original=iconButton('فتح الحركة الأصلية','open',()=>openRelated(origin));original.dataset.openOriginalTransaction='true';actions.push(original);row.classList.add('transaction-delivered-row');row.setAttribute('title',T('حركة مرتبطة من المصدر المالي — التعديل من الحركة الأصلية.'));}
      else{if(linked)actions.push(linked);const edit=iconButton('تحرير الصف','edit',()=>open(card));edit.disabled=!!state.currentRecordArchived;actions.push(edit);const del=iconButton('حذف الصف','trash',()=>remove(card),true);del.disabled=!!state.currentRecordArchived;actions.push(del);}
      SCTransactionDelivery.rowControls(row,actions);tbody.append(row);}
    if(!rows.length){const tr=el('tr'),td=el('td','empty-state',T('لا توجد صفوف مطابقة.'));td.colSpan=fields.length;tr.append(td);tbody.append(tr);}table.append(tbody);wrap.append(table);host.append(wrap,top);fitColumns(table,wrap);return true;
  }
  function createView(category){const section=el('section','form-section finance-view-section');section.dataset.mainCategory=category.id;section.dataset.entryCategory=category.id;section.dataset.categoryId=category.id;section.id=`entry-category-${category.id}`;section.append(createSectionHeading(category));const host=el('div','finance-view-host');host.dataset.financeView=category.id;host.append(el('p','muted-text',T('جارٍ حساب جدول العرض…')));section.append(host);return section;}
  function renderView(view){
    const host=document.querySelector(`[data-finance-view="${CSS.escape(view.category_id)}"]`);if(!host)return;host.replaceChildren();if(view.error){host.append(el('p','finance-error',view.error));return;}
    const active=viewFilters.get(view.category_id)||{},top=el('div','finance-table-status');top.append(el('span','muted-text',`${view.count} / ${view.base_count??view.count} · ${T('عرض للقراءة فقط')}`));if(Object.keys(active).length)top.append(button('مسح مرشحات الجدول',()=>{viewFilters.delete(view.category_id);schedule();},'filter'));
    const wrap=el('div','finance-table-scroll'),table=el('table','data-table finance-view-table'),thead=el('thead'),tr=el('tr');
    for(const col of view.columns){const th=el('th'),line=el('div','finance-column-heading');line.append(named(el('span'),col.label));const b=iconButton('تصفية العمود','filter',()=>valuePicker(col,(view.options?.[col.id]||optionsFrom(view.rows,col,r=>r.values[col.id])).map(o=>({...o,key:key(o.value),label:blank(o.value)?T('فارغ'):o.label})),active[col.id],chosen=>{if(chosen===null)delete active[col.id];else active[col.id]=chosen;viewFilters.set(view.category_id,active);schedule();}));b.classList.toggle('is-active',!!active[col.id]);line.append(b);th.append(line);tr.append(th);}thead.append(tr);table.append(thead);const tbody=el('tbody');
    for(const r of view.rows){const tr=el('tr');for(const c of view.columns){const format=view.formats?.[r.format_keys?.[c.id]||c.format_key];const display=format?shown(format,r.values[c.id]):(r.display[c.id]??r.values[c.id]??'');const td=named(el('td',c.type==='number'?'finance-number':''),display);td.title=display;tr.append(td);}tbody.append(tr);}if(!view.rows.length){const tr=el('tr'),td=el('td','empty-state',T('لا توجد صفوف مطابقة.'));td.colSpan=view.columns.length;tr.append(td);tbody.append(tr);}table.append(tbody);wrap.append(table);host.append(wrap);fitColumns(table,wrap);
    if(view.totals?.length){const sums=el('div','finance-view-totals');for(const t of view.totals){const p=el('div','finance-view-total');p.append(named(el('span'),t.label),named(el('strong','finance-number'),`${view.formats?.[t.format_key]?SCFieldLogic.formatNumber(t.value,view.formats[t.format_key]):(t.display??t.value)}${t.currency?' '+t.currency:''}`));sums.append(p);}host.append(sums);}
  }
  function enabled(){return !!state.schema?.categories?.some(c=>c.view_table||c.fields?.some(f=>f.financial));}
  function applyResult(result){
    updating=true;try{
      for(const c of elements.recordForm.querySelectorAll('[data-value-control]')){let value;if(c.dataset.scope==='main'){if(!Object.hasOwn(result.main||{},c.dataset.fieldId))continue;value=result.main[c.dataset.fieldId];}else{const card=c.closest('.related-card');const r=result.related?.[c.dataset.categoryId]?.find(r=>r._child_id===card?.dataset.childId);if(!r||!Object.hasOwn(r.values,c.dataset.fieldId))continue;value=r.values[c.dataset.fieldId];}setControlValue(c,value);}
      document.querySelectorAll('.finance-compute-error').forEach(n=>n.remove());for(const error of result.errors||[]){const controls=[...elements.recordForm.querySelectorAll('[data-value-control]')].filter(c=>c.dataset.fieldId===error.field_id&&(!error.child_id||c.closest('.related-card')?.dataset.childId===error.child_id));for(const c of controls)c.closest('[data-field-wrapper]')?.append(el('p','field-error finance-compute-error',error.message));}
      for(const records of document.querySelectorAll('[data-related-records]'))if(isTable(categoryById(records.dataset.relatedRecords,state.schema)))renderTable(records);for(const v of result.views||[])renderView(v);
    }finally{updating=false;}
  }
  async function refresh(showErrors=false){
    clearTimeout(timer);if(!enabled())return true;
    const run=++version,sid=state.activeSchemaId;const snap=collectDraftSnapshot(),vf={};
    for(const [cid,filters] of viewFilters)vf[cid]=Object.entries(filters).map(([fid,values])=>({field_id:fid,operator:'in',values:values.map(s=>JSON.parse(s))}));
    latest=(async()=>{try{const r=await fetch('/api/schema-finance/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({main:snap.main,related:snap.related,record_code:snap.record_code||snap.selected_record_code,view_filters:vf})}).then(responseJson);if(run!==version||sid!==state.activeSchemaId)return false;errors=r.errors||[];applyResult(r);if(showErrors&&errors.length)showToast(errors.map(e=>`${e.label}: ${e.message}`).join('\n'),'error');return !errors.length;}catch(e){if(run===version){errors=[{message:e.message}];if(showErrors)showToast(e.message,'error');for(const h of document.querySelectorAll('[data-finance-view]'))h.replaceChildren(el('p','finance-error',e.message));}return false;}})();return latest;
  }
  function schedule(){if(updating)return;clearTimeout(timer);timer=setTimeout(()=>void refresh(),180);}
  function reset(){version++;viewFilters.clear();errors=[];clearTimeout(timer);}
  function sync(){document.querySelectorAll('[data-related-records]').forEach(r=>{if(isTable(categoryById(r.dataset.relatedRecords,state.schema)))renderTable(r);});schedule();}
  return {isTable,editing,decorate,open,openRelated,renderTable,createView,refresh,schedule,reset,sync,compare,matches};
})();
