/* Per-rule message field values: visible names, stable internal references.
 * Legacy literal messages are only templated after a reference is inserted.
 * This module never evaluates code or reads file contents. */
const SCAlertMessageFields = (() => {
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)),t=s=>scText(s);
  let items=[], templated=false, initialTexts=[];
  function parse(value) {
    const text=String(value||''),parts=[];let end=0,count=0;
    for(const m of text.matchAll(/\{\{|\}\}|\{([^{}]+)\}/g)){
      const literal=text.slice(end,m.index);if(/[{}]/.test(literal))throw Error(t('أقواس رسالة التنبيه غير متوازنة. استخدم {{ و }} للأقواس العادية.'));
      if(literal)parts.push(['text',literal]);
      if(m[1]===undefined)parts.push(['text',m[0][0]]);else{if(++count>64)throw Error(t('الحد الأقصى 64 مرجع حقل في رسالة التنبيه.'));parts.push(['field',m[1].trim()]);}
      end=m.index+m[0].length;
    }
    const last=text.slice(end);if(/[{}]/.test(last))throw Error(t('أقواس رسالة التنبيه غير متوازنة. استخدم {{ و }} للأقواس العادية.'));if(last)parts.push(['text',last]);return parts;
  }
  function sources(kind) {
    const catId=kind==='category'?state.editingCategoryId:state.editingFieldCategoryId;
    const standalone=state.globalEditor&&!state.globalEditor.packageMode&&!state.globalEditor.parentCategoryRef;
    const result=[{id:'record_code',label:t('معرّف السجل'),category:t('معلومات السجل')}];
    if(!standalone)for(const cat of state.draftSchema?.categories||[]){
      if(cat.kind!=='main'&&!(kind==='field'&&cat.id===catId))continue;
      for(const f of cat.fields||[])if(!['spacer','separator','horizontal_line','field_group'].includes(f.type))result.push({id:f.id,label:displayLabel(f),category:displayLabel(cat)});
    }
    return SCDefinitionPicker.labelItems(result);
  }
  function insertTo(input) {
    // Preserve the insertion range before the nested picker takes focus.
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    SCDefinitionPicker.open({items,title:t('اختيار حقول رسالة التنبيه'),onSelect:ids=>{
      if(!ids.length)return;templated=true;input.setSelectionRange(start,end);SCDefinitionPicker.insert(input,ids,items);
    }});
  }
  function setup(rule,kind) {
    items=sources(kind);templated=!!rule.message_template;
    initialTexts=[rule.message,...['ar','fa'].map(lang=>rule.i18n?.[lang]?.message||'')].map(v=>String(v||'').trim());
    const input=document.getElementById('alert-rule-message');
    input.value=templated?SCDefinitionPicker.toNames(rule.message||'',items):(rule.message||'');
    document.getElementById('alert-rule-message-fields').onclick=()=>insertTo(input);
    for(const old of document.querySelectorAll('#alert-rule-language .alert-language-field-insert'))old.remove();
    for(const field of document.querySelectorAll('#alert-rule-language [data-localized-property="message"]')){
      if(templated)field.value=SCDefinitionPicker.toNames(field.value,items);
      const b=document.createElement('button');b.type='button';b.className='button button-secondary alert-language-field-insert';b.textContent=t('إدراج قيم حقول السجل');b.onclick=()=>insertTo(field);field.parentElement.append(b);
    }
  }
  function encode(value) {
    const result=SCDefinitionPicker.toKeys(value,items);
    if(result.length>2000)throw Error(t('صيغة رسالة التنبيه غير صالحة؛ الحد الأقصى 2000 حرف.'));
    const allowed=new Set(items.map(i=>i.id));
    for(const [kind,key]of parse(result))if(kind==='field'&&!allowed.has(key))throw Error(t('اختر حقولًا موجودة من السجل الرئيسي أو البطاقة نفسها لرسالة التنبيه؛ المرجع غير متاح أو الاسم مكرر.'));
    return result;
  }
  function collect(rule) {
    // Recognize a manually typed known field token too, without reinterpreting
    // arbitrary braces in legacy plain messages.
    const texts=[rule.message,...['ar','fa'].map(lang=>rule.i18n?.[lang]?.message||'')];
    const recognized=texts.some(text=>items.some(item=>String(text).includes('{'+item.token+'}')));
    const changed=texts.some((text,i)=>String(text||'').trim()!==initialTexts[i]);
    if(templated||(recognized&&changed)){
      rule.message_template=true;rule.message=encode(rule.message||'');
      for(const lang of ['ar','fa'])if(rule.i18n?.[lang]?.message)rule.i18n[lang].message=encode(rule.i18n[lang].message);
    }
    return rule;
  }
  function remapOwner(owner,mapping,strict=true) {
    for(const rule of owner.alerts||[])if(rule.message_template){
      const convert=value=>parse(value).map(([kind,key])=>{
        if(kind==='text')return key.replaceAll('{','{{').replaceAll('}','}}');
        if(key==='record_code')return '{record_code}';
        const mapped=typeof mapping?.get==='function'?mapping.get(key):mapping[key];
        if(mapped)return '{'+mapped+'}';
        if(strict)throw Error(t('رسالة التنبيه تشير إلى حقل خارج التعريف العام؛ أدرج الفئة التي تحتوي حقول الرسالة.'));
        return '{'+key+'}';
      }).join('');
      rule.message=convert(rule.message||'');for(const lang of ['ar','fa'])if(rule.i18n?.[lang]?.message)rule.i18n[lang].message=convert(rule.i18n[lang].message);
    }
    return owner;
  }
  function checkpoint(){return {items:clone(items),templated,initialTexts:[...initialTexts]};}
  function restoreCheckpoint(saved){if(!saved)return;items=clone(saved.items);templated=saved.templated;initialTexts=[...saved.initialTexts];}
  return {setup,collect,parse,remapOwner,sources,checkpoint,restoreCheckpoint};
})();
