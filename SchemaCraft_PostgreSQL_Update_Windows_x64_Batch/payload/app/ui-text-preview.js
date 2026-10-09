/* Isolated, data-free preview of the real application. Loaded before all app code. */
(function () {
  'use strict';
  let config;
  try { config = window.parent !== window && window.parent.SchemaCraftTextEditor?.previewState(); } catch (_) {}
  if (!config) { document.documentElement.hidden = true; throw new Error('UI preview requires its administrator editor.'); }
  window.__SC_UI_TEXT_PREVIEW__ = true;
  window.__SC_PREVIEW_LANGUAGE__ = config.language;
  window.__SC_PREVIEW_OVERRIDES__ = config.overrides;
  const copy = value => JSON.parse(JSON.stringify(value));
  const memoryStorage = () => {
    const values = new Map();
    return { get length() { return values.size; }, key: i => [...values.keys()][i] || null,
      getItem: k => values.has(String(k)) ? values.get(String(k)) : null,
      setItem: (k,v) => values.set(String(k),String(v)), removeItem: k => values.delete(String(k)), clear: () => values.clear() };
  };
  // A preview must never read or overwrite live drafts/history/preferences.
  Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
  window.BroadcastChannel = class { postMessage() {} addEventListener() {} removeEventListener() {} close() {} };
  window.open = () => null;
  Object.defineProperty(navigator, 'sendBeacon', { value: () => false });
  window.XMLHttpRequest = class { open() { throw new Error('Preview network is disabled'); } };
  window.WebSocket = class { constructor() { throw new Error('Preview network is disabled'); } };
  const schema = {
    schema_version: 1, revision: 0, schema_id: '', schema_name: '', developer_mode: true,
    builder_access: { configured: true, unlocked: true }, categories: [], conditions: [],
    app: { title: '', entity_singular: '', entity_plural: '', direction: 'rtl', language: 'ar',
      primary_color: config.appearance.primary_color || '#1F5F95', background_color: '#F4F7FB',
      surface_color: '#FFFFFF', startup_page: 'home', search_page_size: 50,
      show_entry_search: true, draft_autosave: false },
    stats: { record_count: 0, field_count: 0, category_count: 0 },
    archive_stats: { active_record_count: 0, archived_record_count: 0 }
  };
  const requests = [];
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    requests.push({ path: url.pathname, method });
    let body = {}, status = 200;
    let payload = {}; try { payload = JSON.parse(options.body || '{}'); } catch (_) {}
    if (url.pathname === '/api/session/status') body = { ok: true, authenticated: true };
    else if (url.pathname === '/api/workspace') body = { schemas: [], definitions: {}, active_schema_id: '',
      global_definitions: { categories: {}, fields: {}, revision: 0 }, workspace_settings: copy(config.appearance) };
    else if (url.pathname === '/api/schema') body = copy(schema);
    else if (url.pathname === '/api/home/schema') body = { schema: copy(schema), signature: 'ui-preview' };
    else if (url.pathname === '/api/heartbeat') body = { ok: true };
    else if (url.pathname === '/api/global-definitions') body = { categories: {}, fields: {}, revision: 0 };
    else if (url.pathname === '/api/language') body = { language: config.language, languages: ['ar','fa'] };
    else if (url.pathname === '/api/reports' && payload.action === 'catalog') body = { schemas: [] };
    else if (url.pathname === '/api/reports' && payload.action === 'writer_list') body = { drafts: [], versions: [], components: [], recipes: [], runs: [] };
    else if (url.pathname === '/api/reports' && payload.action === 'writer_validate') body = { valid: true, errors: [], warnings: [], issues: [] };
    else if (url.pathname === '/api/reports' && payload.action === 'profiles') body = { profiles: [], total: 0, has_more: false };
    else if (method === 'GET' && /history|records|search|dashboard|backups/.test(url.pathname))
      body = { records: [], results: [], items: [], history: [], entries: [], backups: [], fields: [], total: 0, count: 0, has_more: false };
    else { status = 423; body = { error: 'وظائف التطبيق متوقفة أثناء تعديل نصوص الواجهة.' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const host = () => window.parent.SchemaCraftTextEditor;
  let ready = false, currentPage = 'home';
  let outlined;
  function outlineElement(element) {
    if (outlined === element) return;
    outlined?.classList.remove('ui-text-preview-highlight');
    outlined = element;
    outlined?.classList.add('ui-text-preview-highlight');
  }
  function knownKeys(text) {
    return (window.SchemaCraftI18n?.lookup(text) || []).filter(key => Object.prototype.hasOwnProperty.call(config.defaults.ar, key));
  }
  function candidates(target, event) {
    if (!target || target.closest('[data-no-translate], svg, script, style, .ui-text-preview-outline')) {
      // Icon buttons still expose their fixed tooltip / accessible label.
      target = target?.closest('button');
      if (!target) return [];
    }
    const api = window.SchemaCraftI18n, found = new Map();
    const add = (key, text, kind) => {
      if (Object.prototype.hasOwnProperty.call(config.defaults.ar, key)) found.set(key, { key, text, kind });
    };
    const addText = node => {
      if (!node?.nodeValue?.trim() || node.parentElement?.closest('svg,[data-no-translate],textarea')) return;
      const source = api?.sourceForNode(node);
      if (source) {
        const normalized = source.replace(/\s+/g,' ').trim();
        if (Object.prototype.hasOwnProperty.call(config.defaults.ar, source)) add(source,node.nodeValue,'text');
        else if (Object.prototype.hasOwnProperty.call(config.defaults.ar, normalized)) add(normalized,node.nodeValue,'text');
      }
      knownKeys(node.nodeValue).forEach(key => add(key,node.nodeValue,'text'));
    };
    // Prefer the exact text under the pointer over another label in the same row.
    if (event && document.caretRangeFromPoint) {
      const node = document.caretRangeFromPoint(event.clientX,event.clientY)?.startContainer;
      if (node?.nodeType === Node.TEXT_NODE && target.contains(node)) addText(node);
    }
    for (const node of target.childNodes) if (node.nodeType === Node.TEXT_NODE) addText(node);
    if (target.matches('button,label,summary,h1,h2,h3,h4,p,small,span,th,td,option,a')) {
      const walker = document.createTreeWalker(target,NodeFilter.SHOW_TEXT); let n, count = 0;
      while ((n = walker.nextNode()) && count++ < 40) addText(n);
    }
    for (const element of [target,target.closest('button')].filter(Boolean)) {
      for (const attribute of ['aria-label','title','placeholder','data-tooltip','alt']) {
        const value = element.getAttribute(attribute); if (!value) continue;
        const source = api?.sourceForAttribute(element,attribute);
        if (source) add(source,value,attribute);
        knownKeys(value).forEach(key => add(key,value,attribute));
      }
    }
    return [...found.values()];
  }
  function closeDialogs() {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    outlineElement(null);
  }
  function clearUserValues() {
    for (const id of ['setting-title','setting-singular','setting-plural','record-code','audit-user-input','startup-user','category-label','field-label']) {
      const input = document.getElementById(id); if (input) input.value = '';
    }
    document.querySelectorAll('#app-language-editor, .localized-name-slot').forEach(n => n.hidden = true);
    // No synthetic schema name masquerades as an actual editable UI label.
    document.querySelectorAll('.schema-tab:not(.schema-tab-global):not([data-search-type]):not([data-export-profile-tab]),#audit-user-name').forEach(n => {
      if (n.matches('.schema-tab')) n.hidden = true; else n.textContent = '';
    });
  }
  async function navigate(page = currentPage, dialogId = '') {
    if (!ready) return;
    closeDialogs(); currentPage = page;
    if (typeof switchMode === 'function') {
      switchMode(['home','entry','search','import','export','builder','settings'].includes(page) ? page : 'home', true);
      if (page === 'export') { state.exportMode = config.exportMode || 'advanced'; renderExchangePage(); }
      if (page === 'builder' && config.builderScope === 'global') { state.builderScope = 'global'; renderBuilderScope(); }
      if (page === 'settings' && config.settingsCategory) setSettingsCategory(config.settingsCategory);
    }
    if (dialogId === 'writer-editor-dialog') await window.SchemaCraftWriterTextPreview?.open();
    else if (dialogId === 'category-dialog' && typeof openCategoryDialog === 'function') openCategoryDialog();
    else if (dialogId) {
      const dialog = document.getElementById(dialogId);
      if (dialog?.tagName === 'DIALOG') { dialog.hidden = false; dialog.showModal(); }
    }
    clearUserValues(); publishDialogs();
  }
  function publishDialogs() {
    const dialogs = [...document.querySelectorAll('dialog[id]')].map(dialog => ({ id:dialog.id,
      label: dialog.querySelector('h2,h3')?.textContent.trim() || dialog.getAttribute('aria-label') || dialog.id }));
    host()?.previewReady({ dialogs, page:currentPage });
  }
  function navigateClick(target) {
    const button = target.closest('button');
    const pageIds = { 'home-mode-button':'home','entry-mode-button':'entry','search-page-button':'search',
      'import-page-button':'import','export-page-button':'export','settings-page-button':'settings','builder-mode-button':'builder','open-builder-button':'builder' };
    if (pageIds[button?.id]) { host()?.navigate(pageIds[button.id]); return true; }
    if (target.closest('[data-close-dialog],.dialog-close')) { target.closest('dialog')?.close(); return true; }
    if (button?.dataset.settingsCategoryTab) { setSettingsCategory(button.dataset.settingsCategoryTab); host()?.previewLocation({ settingsCategory:button.dataset.settingsCategoryTab }); return true; }
    if (button?.dataset.exportMode) { state.exportMode = button.dataset.exportMode; renderExchangePage(); host()?.previewLocation({ exportMode:state.exportMode }); return true; }
    if (button?.id === 'writer-open-editor') { window.SchemaCraftWriterTextPreview?.open(); return true; }
    if (button?.dataset.uiLanguage) { host()?.setPreviewLanguage(button.dataset.uiLanguage); return true; }
    if (button?.id === 'builder-sidebar-add-category-button') { openCategoryDialog(); clearUserValues(); return true; }
    const summary = target.closest('summary'); if (summary) { summary.parentElement.open = !summary.parentElement.open; return true; }
    if (button?.closest('.writer-ribbon-tabs')) { window.SchemaCraftWriterTextPreview?.ribbon(button); return true; }
    return false;
  }
  // Disabled controls keep their original appearance. Pointer events still let
  // an administrator edit their wording without enabling the underlying action.
  document.addEventListener('pointerdown', event => {
    const target = event.target.closest?.('button:disabled,input:disabled,select:disabled,textarea:disabled');
    if (!ready || !target || host()?.interaction !== 'edit') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const options = candidates(target,event);
    if (options.length) host()?.chooseText(options); else host()?.previewNotice();
  }, true);
  // Capture phase prevents every application action (including global shortcuts).
  document.addEventListener('click', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!ready) return;
    if (host()?.interaction === 'navigate' && navigateClick(target)) return;
    const options = candidates(target,event);
    if (options.length) host()?.chooseText(options);
    else host()?.previewNotice();
  }, true);
  ['submit','input','change','drop','dragstart','contextmenu','dblclick'].forEach(type =>
    document.addEventListener(type, e => { e.preventDefault(); e.stopImmediatePropagation(); }, true));
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) return;
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key) && !e.target.matches('input,textarea,select,[contenteditable]')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') closeDialogs();
    else if (['Enter',' '].includes(e.key)) {
      if (host()?.interaction === 'navigate' && navigateClick(e.target)) return;
      const options = candidates(e.target); if (options.length) host()?.chooseText(options);
    }
  },true);
  document.addEventListener('mouseover', e => {
    if (host()?.interaction !== 'edit' || !ready) { outlineElement(null); return; }
    const target = e.target.closest('button,label,summary,h1,h2,h3,h4,p,small,span,th,td,input,textarea,select,a');
    outlineElement(target && candidates(target).length ? target : null);
  },true);
  document.addEventListener('scroll',()=>outlineElement(null),true);
  window.SchemaCraftTextPreview = Object.freeze({ navigate, get requests() { return copy(requests); } });
  document.addEventListener('DOMContentLoaded', async () => {
    if (!document.querySelector('.ui-text-preview-style')) {
      const link = document.createElement('link'); link.rel='stylesheet'; link.href='/ui-text-editor.css'; link.className='ui-text-preview-style';
      // Lifecycle pages keep their own original CSS; this scoped rule is in styles.css.
      document.head.append(link);
    }
    if (document.getElementById('app-workspace')) {
      for (let i=0;i<200&&!document.body.classList.contains('session-authenticated');i++) await new Promise(r=>setTimeout(r,25));
      if (!document.body.classList.contains('session-authenticated')) { host()?.previewError(); return; }
      clearInterval(state.draftTimer); clearInterval(state.builderAutosaveTimer); clearInterval(state.heartbeatTimer);
    } else {
      const enter = document.getElementById('startup-continue');
      if (enter) { enter.disabled = false; enter.textContent = window.SchemaCraftI18n.t('فتح مساحة العمل'); }
    }
    ready = true;
    await navigate(config.page,config.dialog);
  });
})();
