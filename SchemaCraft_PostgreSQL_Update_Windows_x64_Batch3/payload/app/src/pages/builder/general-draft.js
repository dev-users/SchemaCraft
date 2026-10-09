// General-definition edits are a draft until the explicit Save action.
function generalDraftDirty() { return Boolean(state.generalDraftBaseline); }
function updateGeneralSaveState() {
  const dirty = generalDraftDirty();
  if (elements.builderGlobalSaveState) elements.builderGlobalSaveState.textContent = state.savingGeneralDefinitions
    ? scText('جارٍ حفظ التعريفات العامة…') : dirty ? scText('توجد تغييرات عامة غير محفوظة.') : scText('كل التعريفات العامة محفوظة.');
  const save = document.getElementById('save-general-definitions');
  const discard = document.getElementById('discard-general-definitions');
  if (save) save.disabled = !dirty || Boolean(state.savingGeneralDefinitions || state.globalEditor);
  if (discard) discard.disabled = !dirty || Boolean(state.savingGeneralDefinitions || state.globalEditor);
}

async function requestGlobalDefinitionMutation(payload) {
  if (state.savingGeneralDefinitions) throw new Error(scText('انتظر اكتمال حفظ التعريفات العامة.'));
  if (state.mode !== 'builder' || state.builderScope !== 'global') {
    if (generalDraftDirty()) throw new Error(scText('احفظ تغييرات التعريفات العامة أو تجاهلها أولًا.'));
    const response = await fetch('/api/global-definitions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...payload, expected_revision:state.globalDefinitions?.revision})});
    return responseJson(response);
  }
  const collectionName = payload.kind === 'category' ? 'categories' : 'fields';
  const collection = state.globalDefinitions[collectionName];
  const ref = payload.global_ref;
  if (payload.action === 'reorder') {
    const keys = Object.keys(collection), index = keys.indexOf(ref);
    const target = index + (payload.direction === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= keys.length) return {global_definitions:state.globalDefinitions,moved:false};
  }
  state.generalDraftBaseline ||= deepClone(state.globalDefinitions);
  if (payload.action === 'save') {
    collection[ref] = {...collection[ref], id:ref, definition:deepClone(payload.definition)};
  } else if (payload.action === 'delete') {
    delete collection[ref];
  } else if (payload.action === 'reorder_all') {
    const keys = payload.order;
    if (!Array.isArray(keys) || keys.length !== Object.keys(collection).length || new Set(keys).size !== keys.length || keys.some(key => !Object.hasOwn(collection, key))) throw new Error(scText('ترتيب التعريفات غير صالح.'));
    state.globalDefinitions[collectionName] = Object.fromEntries(keys.map(key => [key, collection[key]]));
  } else if (payload.action === 'reorder') {
    const keys = Object.keys(collection), index = keys.indexOf(ref);
    const target = index + (payload.direction === 'up' ? -1 : 1);
    [keys[index],keys[target]] = [keys[target],keys[index]];
    state.globalDefinitions[collectionName] = Object.fromEntries(keys.map(key => [key,collection[key]]));
  }
  updateGeneralSaveState();
  return {ok:true, staged:true, moved:payload.action === 'reorder', definition:collection[ref], global_definitions:state.globalDefinitions, updated_schema_ids:[]};
}

async function saveGeneralDefinitions() {
  if (!generalDraftDirty() || state.savingGeneralDefinitions || state.globalEditor) return false;
  const target = deepClone(state.globalDefinitions);
  let confirmed = deepClone(state.generalDraftBaseline);
  const affected = new Set();
  state.savingGeneralDefinitions = true;
  updateGeneralSaveState();
  try {
    const send = async payload => {
      const response = await fetch('/api/global-definitions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...payload, expected_revision:confirmed.revision})});
      const result = await responseJson(response);
      confirmed = result.global_definitions;
      state.generalDraftBaseline = deepClone(confirmed);
      state.generalLoadedDefinitions = deepClone(confirmed);
      for (const id of [...(result.updated_schema_ids || []), ...(result.detached_schema_ids || [])]) affected.add(id);
    };
    for (const [kind, key] of [['category','categories'],['field','fields']]) {
      for (const [ref, item] of Object.entries(target[key])) {
        if (JSON.stringify(item.definition) !== JSON.stringify(confirmed[key][ref]?.definition)) await send({action:'save',kind,global_ref:ref,definition:item.definition});
      }
      for (const ref of Object.keys(confirmed[key])) {
        if (!target[key][ref]) await send({action:'delete',kind,global_ref:ref});
      }
      const order = Object.keys(target[key]);
      if (JSON.stringify(order) !== JSON.stringify(Object.keys(confirmed[key]))) await send({action:'reorder_all',kind,order});
    }
    const changes = state.generalDraftHistory || [];
    state.generalDraftBaseline = null;
    state.generalDraftHistory = [];
    state.generalLoadedDefinitions = null;
    state.globalDefinitions = confirmed;
    if (affected.size) await refreshAdvancedWorkspace({reloadSchema:affected.has(state.activeSchemaId)});
    renderGlobalDefinitions();
    rememberBuilderHistory('__global__',scText('التعريفات العامة'),changes);
    showToast(scText('تم حفظ التعريفات العامة.'));
    return true;
  } catch (error) {
    // Successful requests remain committed; retry compares the remaining draft
    // with the last acknowledged revision, so it never repeats a deletion.
    state.globalDefinitions = {...target, revision:confirmed.revision};
    state.generalDraftBaseline = confirmed;
    if (affected.size) await refreshAdvancedWorkspace({reloadSchema:affected.has(state.activeSchemaId)});
    showToast(scText`تعذّر إكمال الحفظ. التغييرات المتبقية محفوظة كمسودة: ${error.message}`, 'error');
    return false;
  } finally {
    state.savingGeneralDefinitions = false;
    updateGeneralSaveState();
  }
}

async function discardGeneralDefinitions() {
  if (!generalDraftDirty() || state.savingGeneralDefinitions || state.globalEditor) return;
  if (!(await requestConfirmation(scText('تجاهل التغييرات العامة غير المحفوظة؟'), {title:scText('تجاهل التغييرات'),confirmLabel:scText('تجاهل')}))) return;
  state.globalDefinitions = deepClone(state.generalLoadedDefinitions || state.generalDraftBaseline);
  state.generalDraftBaseline = null;
  state.generalLoadedDefinitions = null;
  state.generalDraftHistory = [];
  renderGlobalDefinitions();
  updateGeneralSaveState();
}

document.getElementById('save-general-definitions')?.addEventListener('click', () => void saveGeneralDefinitions());
document.getElementById('discard-general-definitions')?.addEventListener('click', () => void discardGeneralDefinitions());
