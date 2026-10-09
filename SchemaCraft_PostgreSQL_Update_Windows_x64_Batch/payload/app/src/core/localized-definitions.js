/* Display aliases are deliberately separate from canonical schema properties. */
function uiLanguage() { return window.SchemaCraftI18n?.language || 'ar'; }
function displayLabel(entity, key = 'label') {
  let definition = entity;
  if (entity && !entity.i18n && key === 'label') {
    const id = entity.field_id || (/^(fld|cat)_/.test(entity.id || '') ? entity.id : entity.category_id);
    if (typeof id === 'string' && /^(fld|cat)_/.test(id)) {
      const schema = entity.schema_id ? (state.workspaceDefinitions?.[entity.schema_id] || state.schema) : (state.draftSchema || state.schema);
      for (const category of schema?.categories || []) {
        const source = category.id === id ? category : (category.fields || []).find(field => field.id === id);
        if (source) { definition = { ...entity, i18n: source.i18n }; break; }
      }
    }
  }
  return window.SchemaCraftI18n?.display(definition, key) ?? String(definition?.[key] ?? '');
}
function labelVariants(entity, key = 'label') {
  return window.SchemaCraftI18n?.variants(entity, key) || [String(entity?.[key] ?? '')];
}
function displaySchemaName(schema) {
  if (typeof schema === 'string') schema = (state.workspace?.schemas || []).find(item => item.id === schema) || { id: schema };
  if (!schema) return '';
  const id = schema.id || schema.schema_id || '';
  const definition = state.workspaceDefinitions?.[id] || (state.schema?.schema_id === id ? state.schema : null);
  const catalog = (state.workspace?.schemas || []).find(item => item.id === id);
  return displayLabel({ name: schema.name || schema.schema_name || catalog?.name || definition?.schema_name || '',
    i18n: definition?.i18n || schema.i18n || catalog?.i18n }, 'name');
}
function newNameMetadata() {
  return { enabled: false, source_language: uiLanguage(), ar: {}, fa: {} };
}

function renderLanguageNameEditor(container, entity, properties, getters = {}) {
  if (!container) return;
  container.replaceChildren();
  const model = deepClone(entity?.i18n || (entity ? { enabled: false, source_language: 'ar', ar: {}, fa: {} } : newNameMetadata()));
  model.source_language = ['ar', 'fa'].includes(model.source_language) ? model.source_language : 'ar';
  model.ar ||= {};
  model.fa ||= {};
  const details = document.createElement('details');
  details.className = 'localized-names-editor';
  details.open = model.enabled === true;
  const summary = document.createElement('summary');
  summary.textContent = scText('أسماء ونصوص حسب اللغة');
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'check-field localized-names-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = model.enabled === true;
  toggle.dataset.localizedNamesEnabled = '';
  const toggleText = document.createElement('span');
  toggleText.textContent = scText('استخدام نصوص مختلفة للعربية والفارسية');
  toggleLabel.append(toggle, toggleText);
  const help = document.createElement('p');
  help.className = 'field-help';
  help.textContent = scText('هذه أسماء للعرض فقط. لا تتغير المعرّفات أو البيانات. إذا تُرك نص فارغًا، يُستخدم النص المتاح باللغة الأخرى، ثم النص الأساسي.');
  const columns = document.createElement('div');
  columns.className = 'localized-names-columns';
  const inputs = {};
  for (const language of ['ar', 'fa']) {
    const column = document.createElement('fieldset');
    column.className = 'localized-names-language';
    const legend = document.createElement('legend');
    legend.textContent = language === 'ar' ? 'عربي' : 'فارسی';
    legend.lang = language;
    column.append(legend);
    inputs[language] = {};
    for (const [key, label] of properties) {
      const wrapper = document.createElement('label');
      wrapper.className = 'field';
      wrapper.dataset.localizedPropertyRow = key;
      const title = document.createElement('span');
      title.textContent = label;
      const input = document.createElement(['description','message'].includes(key) ? 'textarea' : 'input');
      if (input.tagName === 'INPUT') input.type = 'text';
      input.className = 'control';
      input.lang = language;
      input.dir = 'rtl';
      input.maxLength = 2000;
      input.dataset.localizedProperty = key;
      input.dataset.localizedLanguage = language;
      input.value = model[language][key] || '';
      input.placeholder = scText('استخدام النص المتاح عند تركه فارغًا');
      input.setAttribute('aria-label', `${label} — ${language === 'ar' ? 'عربي' : 'فارسی'}`);
      inputs[language][key] = input;
      wrapper.append(title, input);
      column.append(wrapper);
    }
    columns.append(column);
  }
  function synchronize(seed = false) {
    columns.hidden = !toggle.checked;
    if (toggle.checked && seed) {
      for (const [key] of properties) {
        if (!inputs.ar[key].value.trim() && !inputs.fa[key].value.trim()) {
          inputs[model.source_language][key].value = String(getters[key]?.() ?? entity?.[key] ?? '');
        }
      }
    }
  }
  toggle.addEventListener('change', () => synchronize(true));
  synchronize(false);
  details.append(summary, toggleLabel, help, columns);
  container.append(details);
  container.scLanguageEditor = {
    // Visibility is type-specific; hidden translations stay in the draft so a
    // type change or Cancel never silently discards previously entered wording.
    setVisibleProperties(keys) {
      const allowed = new Set(keys);
      columns.querySelectorAll('[data-localized-property-row]').forEach(row => { row.hidden = !allowed.has(row.dataset.localizedPropertyRow); });
    },
    restore(value) {
      toggle.checked=value?.enabled===true;model.source_language=value?.source_language||model.source_language;
      for(const language of ['ar','fa'])for(const [key] of properties)inputs[language][key].value=value?.[language]?.[key]||'';
      synchronize(false);details.open=toggle.checked;
    },
    read() {
      const result = { enabled: toggle.checked, source_language: model.source_language, ar: {}, fa: {} };
      for (const language of ['ar', 'fa']) for (const [key] of properties) {
        const value = inputs[language][key].value.trim();
        if (value) result[language][key] = value;
      }
      return result;
    },
  };
}
function readLanguageNameEditor(id) { return document.getElementById(id)?.scLanguageEditor?.read() || newNameMetadata(); }

function createLanguageNamesDialog(title) {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog editor-dialog-wide language-names-dialog';
  const heading = document.createElement('div');
  heading.className = 'dialog-heading';
  const text = document.createElement('h2');
  text.textContent = title;
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×';
  close.setAttribute('aria-label', scText('إغلاق')); close.onclick = () => dialog.close();
  heading.append(text, close);
  const content = document.createElement('div'); content.className = 'dialog-content';
  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary'; save.textContent = scText('حفظ الأسماء');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button button-secondary'; cancel.textContent = scText('إلغاء'); cancel.onclick = () => dialog.close();
  actions.append(save, cancel); dialog.append(heading, content, actions);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  return { dialog, content, save };
}

function editSchemaLanguageNames() {
  if (!builderUnlocked() || !state.draftSchema) return;
  // This participates in the existing builder draft/save/discard workflow.
  const editor = createLanguageNamesDialog(scText('أسماء التصميم حسب اللغة'));
  const base = document.createElement('p'); base.className = 'field-help';
  base.textContent = `${scText('الاسم الأساسي')}: ${state.schema?.schema_name || ''}`;
  const slot = document.createElement('div');
  const entity = { name: state.schema?.schema_name || '', i18n: state.draftSchema.i18n };
  editor.content.append(base, slot);
  renderLanguageNameEditor(slot, entity, [['name', scText('اسم التصميم')]]);
  editor.save.onclick = () => {
    state.draftSchema.i18n = slot.scLanguageEditor.read();
    markDirty();
    editor.dialog.close();
    showToast(scText('أُضيفت الأسماء إلى مسودة التصميم. احفظ التصميم لتطبيقها.'));
  };
  editor.dialog.showModal();
}

function editOptionLanguageNames() {
  const type = selectedBuilderFieldType();
  if (!['select', 'yes_no', 'checkbox_group'].includes(type)) return;
  if (type === 'yes_no' && !(state.fieldOptionsDraft || []).length) {
    // Keep the original Arabic values/IDs used by the yes/no field type.
    state.fieldOptionsDraft = ['نعم', 'لا'].map(label => ({ id: randomDefinitionId('opt'), label, active: true, i18n: newNameMetadata() }));
    elements.fieldOptions.value = state.fieldOptionsDraft.map(option => option.label).join('\n');
  } else if (type !== 'yes_no') reconcileFieldOptions();
  const options = state.fieldOptionsDraft || [];
  if (!options.length) return showToast(scText('أضف خيارات القائمة أولًا.'), 'error');
  const editor = createLanguageNamesDialog(scText('أسماء خيارات القائمة حسب اللغة'));
  const note = document.createElement('p'); note.className = 'field-help';
  note.textContent = scText('تتغير النصوص المعروضة فقط؛ يظل كل خيار مرتبطًا بمعرّفه وقيمته الأصلية، بما في ذلك السجلات السابقة والشروط.');
  editor.content.append(note);
  // One option per row, with exactly two language columns. Canonical labels,
  // option IDs, active flags, and references are never rewritten here.
  editor.dialog.classList.add('compact-option-names-dialog');
  const table = document.createElement('table');table.className='data-table compact-option-names-table';
  const head=document.createElement('thead'),heading=document.createElement('tr');
  for(const [lang,text] of [['ar','عربي'],['fa','فارسی']]){const th=document.createElement('th');th.scope='col';th.lang=lang;th.textContent=text;heading.append(th);}
  head.append(heading);const body=document.createElement('tbody');table.append(head,body);editor.content.append(table);
  const drafts=new Map();
  for(const option of options){
    const row=document.createElement('tr');const model=deepClone(option.i18n||{enabled:false,source_language:'ar',ar:{},fa:{}});
    model.source_language=['ar','fa'].includes(model.source_language)?model.source_language:'ar';model.ar||={};model.fa||={};
    const inputs={};let dirty=false;
    for(const lang of ['ar','fa']){
      const cell=document.createElement('td'),input=document.createElement('input');input.type='text';input.className='control';input.lang=lang;input.dir='rtl';input.maxLength=2000;
      input.dataset.optionLanguage=lang;input.setAttribute('aria-label',`${option.label} — ${lang==='ar'?'عربي':'فارسی'}`);
      input.value=model[lang].label||((lang===model.source_language&&!model.ar.label&&!model.fa.label)?option.label:'');
      input.placeholder=scText('استخدام النص المتاح عند تركه فارغًا');input.addEventListener('input',()=>dirty=true);inputs[lang]=input;cell.append(input);row.append(cell);
    }
    body.append(row);drafts.set(option.id,()=>{
      if(!dirty)return option.i18n;
      for(const lang of ['ar','fa']){const v=inputs[lang].value.trim();if(v)model[lang].label=v;else delete model[lang].label;}
      model.enabled=!!(model.ar.label||model.fa.label);return model;
    });
  }
  editor.save.onclick = () => {
    state.fieldOptionsDraft = state.fieldOptionsDraft.map(option => {
      const meta=drafts.get(option.id)?.();return meta?{...option,i18n:meta}:option;
    });
    editor.dialog.close();
  };
  editor.dialog.showModal();
}

document.getElementById('schema-language-names-button')?.addEventListener('click', editSchemaLanguageNames);
document.getElementById('field-option-languages')?.addEventListener('click', editOptionLanguageNames);

// Resolve by stable field ID, never by translated text.
function displayFieldDefinition(fieldId, schemaId = '') {
  const schema = schemaId ? (state.workspaceDefinitions?.[schemaId] || (state.schema?.schema_id === schemaId ? state.schema : null)) : state.schema;
  for (const category of schema?.categories || []) {
    const field = (category.fields || []).find(item => item.id === fieldId);
    if (field) return field;
  }
  return null;
}
function displayFieldValue(field, value) {
  if (!field) return Array.isArray(value) ? value.join('، ') : String(value ?? '');
  if (['select', 'yes_no'].includes(field.type)) return optionLabelForValue(field, value);
  if (field.type === 'checkbox_group') {
    let values = value;
    if (!Array.isArray(values) && typeof values === 'string' && values.trim().startsWith('[')) {
      try { values = JSON.parse(values); } catch (_) { /* Legacy plain labels stay intact. */ }
    }
    return (Array.isArray(values) ? values : [values]).filter(item => item != null && item !== '').map(item => optionLabelForValue(field, item)).join('، ');
  }
  if (field.type === 'checkbox') return checkboxDisplayMeaning(field, value === true || ['true', '1', 'yes', 'on', 'نعم'].includes(String(value).toLowerCase()));
  if (field.type === 'number') return workspace.formatNumber(value, field);
  return Array.isArray(value) ? value.join('، ') : String(value ?? '');
}
function displayResultValue(item, schemaId = '') {
  if (!item) return '';
  const field = displayFieldDefinition(item.field_id || item.id, item.schema_id || schemaId);
  if (Array.isArray(item.raw_values)) return item.raw_values.map(value => displayFieldValue(field, value)).join(' | ');
  const value = Object.prototype.hasOwnProperty.call(item, 'raw_value') ? item.raw_value : item.value;
  return displayFieldValue(field, value);
}
function displayRecordTitle(match, schemaId = '') {
  return (match.title_details || []).map(item => displayResultValue(item, schemaId)).filter(Boolean).join(' ') || match.title || match.record_code || '';
}
