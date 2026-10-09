/* Computed text is a normal text field with a non-executable format. */
const SCComposite = (() => {
  const T = text => typeof scText === 'function' ? scText(text) : text;
  const is = field => field?.type === 'text' && field.composition && typeof field.composition === 'object';
  function parse(template, count, {draft=false}={}) {
    if (typeof template !== 'string' || (!draft && !template.trim()) || template.length > 4000) throw Error(T('صيغة النص المركب مطلوبة وبحد أقصى 4000 حرف.'));
    const out = []; let literal = '', i = 0, uses = 0;
    while (i < template.length) {
      const c = template[i];
      if (c === '{' || c === '}') {
        if (template[i + 1] === c) { literal += c; i += 2; continue; }
        if (c === '}') throw Error(T('استخدم الأقواس المزدوجة لكتابة قوس حرفي.'));
        const end = template.indexOf('}', i + 1), key = end < 0 ? '' : template.slice(i + 1, end);
        if (!/^[1-9][0-9]*$/.test(key) || Number(key) > count) throw Error(T('أحد رموز النص المركب لا يطابق حقل مصدر مختارًا.'));
        if (literal) out.push(['text', literal]); literal = ''; out.push(['source', Number(key) - 1]);
        if (++uses > 256) throw Error(T('عدد رموز النص المركب يتجاوز الحد المسموح.'));
        i = end + 1; continue;
      }
      if (c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)) throw Error(T('صيغة النص المركب تحتوي على محارف تحكم غير مسموحة.'));
      literal += c; i += 1;
    }
    if (literal) out.push(['text',literal]);
    if (!uses && !draft) throw Error(T('أضف رمز حقل واحد على الأقل إلى صيغة النص المركب.'));
    return out;
  }
  function display(value, field) {
    if (value == null || value === '' || Array.isArray(value) && !value.length) return '';
    if (field.type === 'file') {
      if (Array.isArray(value)) return value.map(x => display(x,field)).filter(Boolean).join('، ');
      if (typeof value === 'object') value = value.name || value.original_name || value.filename || value.path || '';
      return String(value).replaceAll('\\','/').split('/').at(-1);
    }
    if (field.type === 'checkbox') {
      const yes = value === true || value === 1 || ['true','1','yes','نعم'].includes(String(value).toLowerCase());
      return yes ? field.checkbox_true_label || 'نعم' : field.checkbox_false_label || 'لا';
    }
    const choice = v => (field.options || []).find(o => o.id === v || o.label === String(v))?.label ?? String(v);
    if (Array.isArray(value)) return value.map(choice).join('، ');
    if (['select','yes_no','checkbox_group'].includes(field.type)) return choice(value);
    return typeof value === 'object' ? '' : String(value).trim();
  }
  function render(composition, values) {
    const parts = parse(composition.template, composition.field_ids.length);
    if (!parts.some(([k,v]) => k === 'source' && values[v])) return '';
    const result = parts.map(([k,v]) => k === 'text' ? v : values[v]).join('').trim();
    if ([...result].length > 32767) throw Error(T('النص المركب الناتج أطول من الحد المسموح.'));
    return result;
  }
  function order(schema) {
    const map = new Map((schema?.categories || []).flatMap(c => c.fields.map(f => [f.id, [c,f]])));
    const active = new Set(), done = new Set(), out = [];
    function visit(id) {
      if (done.has(id) || !is(map.get(id)?.[1])) return;
      if (active.has(id)) throw Error(T('يوجد اعتماد دائري بين النصوص المركبة أو قواعد التعبئة.'));
      active.add(id); map.get(id)[1].composition.field_ids.forEach(visit);
      active.delete(id); done.add(id); out.push(map.get(id));
    }
    for (const id of map.keys()) visit(id);
    return out;
  }
  function evaluate(schema, main, related, metadata = {}) {
    const map = new Map((schema.categories || []).flatMap(c => c.fields.map(f => [f.id,[c,f]])));
    const system = {system_record_code:'record_code',system_created_at:'created_at',system_updated_at:'updated_at'};
    let changed = false;
    for (const [category,field] of order(schema)) {
      const rows = category.kind === 'main' ? [null] : related[category.id] || [];
      for (const row of rows) {
        const target = row ? row.values || row : main;
        const values = field.composition.field_ids.map(id => {
          const [sourceCategory,source] = map.get(id) || [];
          if (!source) throw Error(T('أحد مصادر النص المركب محذوف أو ليس حقل قيمة.'));
          const data = sourceCategory.kind === 'main' ? main : target;
          const raw = system[source.type] ? metadata[system[source.type]] ?? data[id] ?? '' : data[id];
          return display(raw, source);
        });
        const value = render(field.composition, values);
        if (target[field.id] !== value) { target[field.id] = value; changed = true; }
      }
    }
    return changed;
  }
  // Keep existing token identities when the picker removes a source. New choices
  // append to the configured order. Invalid templates must be corrected first;
  // they are never silently rebound to different field IDs.
  function selectSources(composition, selected) {
    if (!Array.isArray(selected) || selected.length > 64 || new Set(selected).size !== selected.length)
      throw Error(T('اختر حتى 64 حقلًا مختلفًا للنص المركب.'));
    const old = composition.field_ids || [];
    const ids = [...old.filter(id => selected.includes(id)), ...selected.filter(id => !old.includes(id))];
    if (ids.length === old.length && ids.every((id, i) => id === old[i]))
      return {...composition, field_ids:[...old]};
    let template = String(composition.template || '');
    if (template.trim()) {
      const parts = parse(template, old.length);
      template = parts.map(([kind, value]) => {
        if (kind === 'text') return value.replaceAll('{','{{').replaceAll('}','}}');
        const index = ids.indexOf(old[value]);
        return index < 0 ? '' : '{' + (index + 1) + '}';
      }).join('');
    }
    if (!template.trim()) template = ids.map((_, i) => '{' + (i + 1) + '}').join(' ');
    return {...composition, field_ids:ids, template};
  }
  function formatParts(template, count) {
    return parse(String(template||''),count,{draft:true});
  }
  function serializeParts(parts, count) {
    let result='';
    for(const [kind,value] of parts){
      if(kind==='text')result+=String(value).replaceAll('{','{{').replaceAll('}','}}');
      else if(kind==='source'&&Number.isInteger(value)&&value>=0&&value<count)result+='{'+(value+1)+'}';
      else throw Error(T('أحد رموز النص المركب لا يطابق حقل مصدر مختارًا.'));
    }
    if(result.length>4000)throw Error(T('صيغة النص المركب مطلوبة وبحد أقصى 4000 حرف.'));
    return result;
  }
  function chooseNamedSources(composition, selected) {
    const old=composition.field_ids||[];
    if(!Array.isArray(selected)||selected.length>64||new Set(selected).size!==selected.length)
      throw Error(T('اختر حتى 64 حقلًا مختلفًا للنص المركب.'));
    const ids=[...old.filter(id=>selected.includes(id)),...selected.filter(id=>!old.includes(id))];
    const parts=formatParts(composition.template,old.length).flatMap(([kind,value])=>{
      if(kind==='text')return [[kind,value]];
      const index=ids.indexOf(old[value]);return index<0?[]:[[kind,index]];
    });
    // New choices appear immediately as locked names inside the format itself.
    for(const id of ids.filter(id=>!old.includes(id))){
      if(parts.length&&!/\s$/.test(parts.at(-1)[0]==='text'?parts.at(-1)[1]:''))parts.push(['text',' ']);
      parts.push(['source',ids.indexOf(id)]);
    }
    return {...composition,field_ids:ids,template:serializeParts(parts,ids.length)};
  }
  return {is, parse, display, render, order, evaluate, selectSources, formatParts, serializeParts, chooseNamedSources};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SCComposite;

function initCompositionEditor(field) {
  state.compositionDraft = deepClone(field?.composition || {field_ids:[],template:''});
  const input = document.getElementById('composition-template');
  input.value = state.compositionDraft.template;
  input.readOnly = true; input.hidden = true;
  input.oninput = null;
}
function compositionPickerItems() {
  const category = categoryById(state.editingFieldCategoryId), items=[];
  for (const c of state.draftSchema.categories || []) {
    if (c.kind !== 'main' && c.id !== category?.id) continue;
    for (const f of c.fields || []) {
      if (f.id === state.editingFieldId || isLayoutField(f)) continue;
      items.push({id:f.id, label:displayLabel(f), category:displayLabel(c)});
    }
  }
  return items;
}
function openCompositionFieldPicker() {
  const draft = state.compositionDraft;
  if (!draft || !document.getElementById('compact-field-type')?.open) return;
  const items=compositionPickerItems(), allowed=new Set(items.map(i=>i.id));
  let next=null;
  SCDefinitionPicker.open({items, title:scText('اختيار حقول النص المركب'), selected:draft.field_ids,
    confirmLabel:scText('تطبيق اختيار الحقول'),
    validateSelection:selected=>{
      if(state.compositionDraft!==draft || !document.getElementById('compact-field-type')?.open)
        throw Error(scText('أعد فتح إعدادات النص المركب.'));
      if(selected.some(id=>!allowed.has(id)))throw Error(scText('أحد مصادر النص المركب محذوف أو ليس حقل قيمة.'));
      next=SCComposite.chooseNamedSources(draft,selected);
    },
    onSelect:()=>{
      state.compositionDraft=next;
      document.getElementById('composition-template').value=next.template;
      renderCompositionEditor();
    }
  });
}
function renderCompositionEditor() {
  const host=document.getElementById('composition-sources');if(!host)return;
  const draft=state.compositionDraft||={field_ids:[],template:''};
  const input=document.getElementById('composition-template');input.hidden=true;input.readOnly=true;input.value=draft.template;
  const choose=document.getElementById('composition-choose-fields');if(choose)choose.onclick=openCompositionFieldPicker;
  // Move the existing host into the format control. No duplicate selected list.
  if(host.parentElement!==input.parentElement)input.before(host);
  host.className='composition-format-field';host.setAttribute('role','group');host.setAttribute('aria-label',scText('صيغة النص المركب'));
  const labels=new Map(SCDefinitionPicker.labelItems(compositionPickerItems()).map(i=>[i.id,i]));
  host.replaceChildren();let parts;
  try {parts=SCComposite.formatParts(draft.template,draft.field_ids.length);}
  catch(error){const message=document.createElement('p');message.className='message-error';message.textContent=error.message;host.append(message);renderCompositionPreview();return;}
  // One literal input before/between/after every occurrence, including repeated
  // source references in older valid formats. Adjacent literals are coalesced.
  const model=[['text','']];
  for(const part of parts){if(part[0]==='text')model.at(-1)[1]+=part[1];else model.push(part,['text','']);}
  const commit=()=>{draft.template=SCComposite.serializeParts(model,draft.field_ids.length);input.value=draft.template;renderCompositionPreview();};
  model.forEach((part,index)=>{
    if(part[0]==='text'){
      const literal=document.createElement('textarea');literal.className='control composition-literal';literal.rows=1;literal.maxLength=4000;literal.value=part[1];literal.dataset.compositionLiteral=String(index);literal.setAttribute('aria-label',scText('النص قبل الحقول أو بينها أو بعدها'));literal.placeholder=scText('نص أو فاصل');
      const size=()=>{literal.style.width=Math.min(36,Math.max(7,[...literal.value].length+2))+'ch';literal.style.height='auto';literal.style.height=Math.min(112,Math.max(34,literal.scrollHeight))+'px';};
      literal.oninput=()=>{const old=part[1];part[1]=literal.value;try{commit();literal.setCustomValidity('');}catch(error){part[1]=old;literal.value=old;showToast(error.message,'error');}size();};
      host.append(literal);size();
    }else{
      const fid=draft.field_ids[part[1]],item=labels.get(fid),token=document.createElement('span');token.className='composition-selected-token composition-name-token';token.dataset.compositionSelected=fid;token.dataset.compositionOccurrence=String(index);token.setAttribute('contenteditable','false');token.setAttribute('draggable','false');
      const name=document.createElement('span');name.dataset.i18nSkip='true';name.textContent=item?.token||scText('حقل غير متاح');name.setAttribute('translate','no');
      const remove=SCFinance.iconButton('إلغاء اختيار الحقل','clear',()=>{state.compositionDraft=SCComposite.chooseNamedSources(draft,draft.field_ids.filter(id=>id!==fid));renderCompositionEditor();document.querySelector('#composition-sources .composition-literal')?.focus();});remove.dataset.compositionRemove=fid;
      remove.setAttribute('aria-label',scText('إلغاء اختيار الحقل')+' — '+name.textContent);
      token.addEventListener('keydown',e=>{if(e.target===token&&['Delete','Backspace'].includes(e.key)){e.preventDefault();remove.click();}});token.tabIndex=0;
      token.addEventListener('dragstart',e=>e.preventDefault());token.append(name,remove);host.append(token);
    }
  });
  renderCompositionPreview();
}

function renderCompositionPreview() {
  const output = document.getElementById('composition-preview'); if (!output) return;
  const draft = state.compositionDraft;
  try {
    output.textContent = SCComposite.render(draft,draft.field_ids.map(id => displayLabel(fieldById(id)) || scText('حقل غير متاح')));
    output.classList.remove('composition-error');
  } catch (error) { output.textContent = error.message; output.classList.add('composition-error'); }
}
function collectComposition() {
  const draft = deepClone(state.compositionDraft);
  draft.template = document.getElementById('composition-template').value;
  if (draft.field_ids.length < 2 || draft.field_ids.length > 64 || new Set(draft.field_ids).size !== draft.field_ids.length) throw Error(scText('اختر حقلين مختلفين على الأقل للنص المركب.'));
  SCComposite.parse(draft.template,draft.field_ids.length); return draft;
}
function compositionBlocksRemoval(ids) {
  const removed = new Set(ids);
  const dependents = (state.draftSchema?.categories || []).flatMap(c=>c.fields).filter(f=>!removed.has(f.id)&&SCComposite.is(f)&&f.composition.field_ids.some(id=>removed.has(id)));
  if (!dependents.length) return false;
  showToast(scText('عدّل مصادر النصوص المركبة التابعة قبل حذف حقول المصدر.')+' '+dependents.map(f=>displayLabel(f)).join('، '),'error'); return true;
}
function refreshCompositeControls() {
  if (!state.schema || !elements.recordForm) return false;
  const main = mainValues(), related = {}, cards = new Map();
  elements.recordForm.querySelectorAll('.related-card[data-category-id]').forEach(card => {
    const row = {values:cardValues(card)};
    (related[card.dataset.categoryId] ||= []).push(row); cards.set(row,card);
  });
  try {
    const changed = SCComposite.evaluate(state.schema,main,related,state.recordMetadata || {});
    for (const [category,field] of SCComposite.order(state.schema)) {
      const rows = category.kind === 'main' ? [null] : related[category.id] || [];
      for (const row of rows) {
        const scope = row ? cards.get(row) : elements.recordForm;
        const candidates = scope.querySelectorAll(`[data-value-control][data-field-id="${CSS.escape(field.id)}"]`);
        candidates.forEach(control => {
          if (row && control.closest('.related-card') !== scope) return;
          setControlValue(control,(row ? row.values : main)[field.id] || '');
          control.readOnly = true; control.setCustomValidity?.('');
        });
      }
    }
    return changed;
  } catch (error) {
    elements.recordForm.querySelectorAll('[data-computed-text]').forEach(c=>c.setCustomValidity(error.message));
    return false;
  }
}
