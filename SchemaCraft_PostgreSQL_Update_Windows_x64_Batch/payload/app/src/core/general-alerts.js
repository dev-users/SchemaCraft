/* Alerts belonging to reusable definitions: no live-record evaluation here.
 * Mutations use the existing general-definition draft/save/discard workflow. */
const SCGeneralAlerts = (() => {
  'use strict';
  const t=s=>scText(s);
  function definitions() {
    const copies=[];
    for(const [ref,item]of Object.entries(state.globalDefinitions?.fields||{})) copies.push({kind:'field',ref,definition:deepClone(item.definition)});
    for(const [ref,item]of Object.entries(state.globalDefinitions?.categories||{})) {
      const definition=deepClone(item.definition);definition.category_tree=globalCategoryTree(definition);copies.push({kind:'category',ref,definition});
    }
    return copies;
  }
  function rowsFrom(copies) {
    const rows=[];
    const add=(copy,owner,kind,nodeKey='',fieldKey='',categoryLabel='')=>{
      for(const rule of owner.alerts||[])rows.push({copy,owner,kind,nodeKey,fieldKey,categoryLabel,rule,key:[copy.kind,copy.ref,nodeKey,fieldKey,rule.id].join('|')});
    };
    for(const copy of copies){
      if(copy.kind==='field')add(copy,copy.definition,'field');
      else for(const node of copy.definition.category_tree){add(copy,node.definition||{},'category',node.key);for(const entry of node.fields||[])add(copy,entry.definition||entry,'field',node.key,entry.key,displayLabel(node.definition||{}));}
    }
    return rows.sort((a,b)=>(Number(b.rule.priority)||0)-(Number(a.rule.priority)||0));
  }
  function updateMirrors(copy) {
    if(copy.kind!=='category')return;
    const root=copy.definition.category_tree.find(n=>!n.parent_key)||copy.definition.category_tree[0];
    copy.definition.fields=(root?.fields||[]).map(f=>deepClone(f.definition||f));
    copy.definition.alerts=deepClone(root?.definition?.alerts||[]);
  }
  async function saveCopies(copies) {
    for(const copy of copies){updateMirrors(copy);await saveGlobalDefinition(copy.kind,copy.ref,copy.definition);}
    renderGlobalDefinitions();updateGeneralSaveState();
  }
  async function change(rowKey,delta) {
    if(!builderUnlocked()||state.globalEditor||state.savingGeneralDefinitions)return;
    const copies=definitions(),rows=rowsFrom(copies),index=rows.findIndex(r=>r.key===rowKey);
    if(index<0)return;
    try {
      if(delta===null){
        if(!await requestConfirmation(t('هل تريد حذف هذا التنبيه من المسودة؟'),{title:t('حذف التنبيه'),confirmLabel:t('حذف')}))return;
        const row=rows[index];row.owner.alerts=row.owner.alerts.filter(r=>r.id!==row.rule.id);await saveCopies([row.copy]);
      }else{
        const next=index+delta;if(next<0||next>=rows.length)return;
        [rows[index],rows[next]]=[rows[next],rows[index]];
        rows.forEach((row,i)=>row.rule.priority=rows.length-i);await saveCopies(copies);
      }
    }catch(error){showToast(error.message,'error');}
  }
  function edit(row) {
    if(!builderUnlocked()||state.globalEditor)return;
    if(row.copy.kind==='field')openGlobalDefinitionEditor('field',row.copy.ref);
    else openGlobalCategoryPackageEditor(row.kind,row.copy.ref,{nodeKey:row.nodeKey,fieldKey:row.fieldKey});
    SCAlerts.openRule(row.kind,row.rule.id);
  }
  function render() {
    const root=document.getElementById('global-alerts-list');if(!root)return;root.replaceChildren();
    const rows=rowsFrom(definitions());
    for(const [index,row]of rows.entries()){
      const tr=document.createElement('tr');tr.dataset.generalAlert=row.key;
      const values=[displayLabel(row.rule,'name')||row.rule.name,[displayLabel(row.copy.definition),row.categoryLabel,displayLabel(row.owner)].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · '),SCAlerts.brief(row.rule)];
      for(const value of values){const cell=document.createElement('td');cell.textContent=value;cell.dataset.i18nSkip='true';cell.setAttribute('translate','no');tr.append(cell);}
      const cell=document.createElement('td'),controls=document.createElement('div');controls.className='builder-actions general-alert-actions';
      for(const [label,icon,fn,disabled,danger]of [[t('رفع أولوية التنبيه'),'up',()=>change(row.key,-1),index===0,false],[t('خفض أولوية التنبيه'),'down',()=>change(row.key,1),index===rows.length-1,false],[t('تعديل التنبيه'),'edit',()=>edit(row),false,false],[t('حذف التنبيه'),'trash',()=>change(row.key,null),false,true]]){
        const button=globalDefinitionActionButton(label,icon,fn,danger);button.disabled=disabled;controls.append(button);
      }
      cell.append(controls);tr.append(cell);root.append(tr);
    }
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.className='table-empty';td.textContent=t('لا توجد تنبيهات في التعريفات العامة.');tr.append(td);root.append(tr);}
  }
  return {render,rows:()=>rowsFrom(definitions())};
})();
