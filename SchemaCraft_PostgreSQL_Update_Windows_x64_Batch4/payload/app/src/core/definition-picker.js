/* Reusable category/field picker. Opaque keys only occur in state, never captions. */
window.SCDefinitionPicker = (() => {
  const t=s=>scText(s);
  function node(tag,text='',cls=''){const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;}
  function user(n){n.dataset.i18nSkip='true';n.setAttribute('translate','no');return n;}
  function mainItems(schema){
    const items=[{id:'record_code',label:t('معرّف السجل'),category:t('معلومات السجل')}];
    for(const c of schema?.categories||[])if(c.kind==='main')for(const f of c.fields||[])if(!['file','spacer','horizontal_line','separator','field_group'].includes(f.type))items.push({id:f.id,label:displayLabel(f),category:displayLabel(c)});
    return labelItems(items);
  }
  function labelItems(items){
    const counts=new Map();items.forEach(i=>counts.set(i.label,(counts.get(i.label)||0)+1));const used=new Set();
    return items.map((i,index)=>{let token=counts.get(i.label)>1?`${i.category} / ${i.label}`:i.label;if(used.has(token))token+=` (${index+1})`;used.add(token);return {...i,token};});
  }
  function toNames(template,items){const map=new Map(items.map(i=>[i.id,i.token]));return String(template||'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key===undefined?all:map.has(key)?'{'+map.get(key)+'}':/^(fld_|cat_|sch_)/.test(key)?'{'+t('حقل غير متاح')+'}':key==='ID'?'{'+t('معرّف السجل')+'}':all);}
  function toKeys(template,items){const map=new Map(items.map(i=>[i.token,i.id]));return String(template||'').replace(/\{\{|\}\}|\{([^{}]+)\}/g,(all,key)=>key===undefined?all:map.has(key.trim())?'{'+map.get(key.trim())+'}':all);}
  function insert(input,selected,items){
    const map=new Map(items.map(i=>[i.id,i]));const value=selected.map(id=>map.get(id)).filter(Boolean).map(i=>'{'+i.token+'}').join(' ');
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    input.setRangeText(value,start,end,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
  }
  function open({items,title=t('اختيار الحقول'),selected=[],onSelect,validateSelection=null,confirmLabel=t('إضافة الحقول المحددة')}){
    const old=document.getElementById('sc-definition-picker');if(old)old.remove();
    const dialog=node('dialog','','editor-dialog editor-dialog-wide selection-tree-dialog');dialog.id='sc-definition-picker';
    const heading=node('div','','dialog-heading');heading.append(node('h2',title));
    const close=node('button','×','dialog-close');close.type='button';close.setAttribute('aria-label',t('إغلاق'));close.onclick=()=>dialog.close();heading.append(close);
    const content=node('div','','dialog-content');const toolbar=node('div','','export-selection-toolbar');toolbar.append(node('strong',t('الفئات والحقول')));
    const actions=node('div','','compact-option-actions'),checks=[];
    for(const [label,value] of [['تحديد الكل',true],['إلغاء الكل',false]]){const b=node('button',t(label),'button button-secondary');b.type='button';b.onclick=()=>checks.forEach(c=>c.checked=value);actions.append(b);}toolbar.append(actions);content.append(toolbar);
    const search=node('input','','control');search.type='search';search.placeholder=t('بحث عن حقل');search.setAttribute('aria-label',t('بحث عن حقل'));content.append(search);
    const cats=new Map();for(const item of items){if(!cats.has(item.category))cats.set(item.category,[]);cats.get(item.category).push(item);}
    const rows=[];
    for(const [category,fields] of cats){const group=node('details','','definition-picker-category');group.open=true;group.append(user(node('summary',category)));const grid=node('div','','definition-picker-fields');
      for(const item of fields){const row=node('label','','check-field');const check=node('input');check.type='checkbox';check.value=item.id;check.checked=selected.includes(item.id);row.append(check,user(node('span',item.label)));grid.append(row);checks.push(check);rows.push([row,`${category} ${item.label}`.toLocaleLowerCase()]);}group.append(grid);content.append(group);}
    search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();rows.forEach(([row,text])=>row.hidden=!!q&&!text.includes(q));};
    const footer=node('div','','dialog-actions');const save=node('button',confirmLabel,'button button-primary');save.type='button';save.onclick=()=>{const chosen=checks.filter(c=>c.checked).map(c=>c.value);try{validateSelection?.(chosen);}catch(error){showToast(error.message,'error');return;}dialog.close();onSelect(chosen);};const cancel=node('button',t('إلغاء'),'button button-secondary');cancel.type='button';cancel.onclick=()=>dialog.close();footer.append(save,cancel);
    dialog.append(heading,content,footer);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();search.focus();
  }
  return {open,mainItems,labelItems,toNames,toKeys,insert};
})();
