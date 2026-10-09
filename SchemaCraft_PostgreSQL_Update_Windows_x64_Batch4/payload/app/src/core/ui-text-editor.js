/* Administrator UI-wording editor. Previews are script-free, schema-free copies
 * of shipped markup; the live application is never used as an editable canvas. */
(() => {
  'use strict';
  const api = window.SchemaCraftI18n;
  const text = api.t;
  let active = false, opening = false, lease = '', revision = '', defaults = {}, draft = {}, initial = '';
  let dialog, frame, notice, changes, language = api.language, selected = '', fields = {}, previewRecords = [];
  let previewElements = new WeakMap(), search, list, panel, saveButton, discardButton, pageSelect, windowSelect;
  let heartbeat, oldTimers = {}, templateCache = {}, renderSerial = 0, currentPage = 'settings';
  const editableAttributes = ['title', 'placeholder', 'aria-label', 'alt', 'data-tooltip'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const keys = () => Object.keys(defaults);
  const getText = (key, lang) => draft[key]?.[lang] ?? defaults[key]?.[lang] ?? key;
  const make = (tag, content = '', cls = '') => {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (cls) node.className = cls;
    return node;
  };
  const button = (label, action, cls = 'button button-secondary') => {
    const node = make('button', text(label), cls);
    node.type = 'button'; node.addEventListener('click', action); return node;
  };
  async function request(action, extra = {}) {
    const response = await fetch('/api/ui-text', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action, token: lease, ...extra}),
    });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || String(response.status)); error.status = response.status; throw error; }
    return result;
  }
  function status(message, error = false) {
    notice.textContent = message; notice.classList.toggle('is-error', error);
  }
  function updateDirty() {
    const dirty = JSON.stringify(draft) !== initial;
    changes.textContent = text(dirty ? 'تغييرات غير محفوظة' : 'لا توجد تغييرات');
    changes.classList.toggle('is-dirty', dirty);
  }
  function validateValue(key, value, lang) {
    if (value === defaults[key]?.[lang]) return "";
    if (!value.trim()) return '';
    if (value.length > 6000) return text('نص الواجهة أطول من الحد المسموح.');
    if (/[<>&"'`\\\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return text('أدخل نصًا فقط دون رموز HTML أو اقتباسات برمجية؛ يمكن استخدام « » للاقتباس.');
    const slots = source => JSON.stringify((source.match(/\{\d+\}/g) || []).sort());
    if (slots(key) !== slots(value)) return text('احتفظ بعلامات القيم مثل {0} كما هي في النص الأصلي.');
    return '';
  }
  function updateValue(lang) {
    const value = fields[lang].value;
    const error = validateValue(selected, value, lang);
    fields[lang].setAttribute('aria-invalid', String(Boolean(error)));
    if (error) { status(error, true); saveButton.disabled = true; return; }
    draft[selected] ||= {};
    if (!value.trim() || value === defaults[selected][lang]) delete draft[selected][lang];
    else draft[selected][lang] = value;
    if (!Object.keys(draft[selected]).length) delete draft[selected];
    saveButton.disabled = Object.entries(fields).some(([locale, input]) => Boolean(validateValue(selected, input.value, locale)));
    status(text('معاينة آمنة؛ وظائف التطبيق متوقفة.'));
    paintPreview(); updateDirty();
  }
  function selectText(key) {
    if (!defaults[key]) return;
    // Invalid input is kept visible; navigation must not silently discard it.
    if (selected && Object.values(fields).some(input => input.getAttribute('aria-invalid') === 'true')) {
      status(text('أدخل نصًا فقط دون رموز HTML أو اقتباسات برمجية؛ يمكن استخدام « » للاقتباس.'), true); return;
    }
    selected = key; panel.hidden = false;
    dialog.querySelector('#ui-text-source').textContent = key;
    for (const lang of ['ar', 'fa']) {
      fields[lang].value = draft[key]?.[lang] ?? defaults[key][lang];
      fields[lang].placeholder = defaults[key][lang];
      fields[lang].setAttribute('aria-invalid', 'false');
    }
    frame.contentDocument?.querySelectorAll('.ui-text-selected').forEach(node => node.classList.remove('ui-text-selected'));
    for (const record of previewRecords) if (record.key === key) record.element?.classList.add('ui-text-selected');
  }
  function renderCatalog() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = keys().filter(key => !query || [key, getText(key, 'ar'), getText(key, 'fa')].some(value => value.toLocaleLowerCase().includes(query)));
    list.replaceChildren();
    dialog.querySelector('#ui-text-result-count').textContent = String(matches.length);
    // Limit DOM work per page, not the searchable catalog.
    let shown = 0;
    const more = button('التالي', () => appendBatch());
    const appendBatch = () => {
      more.remove();
      for (const key of matches.slice(shown, shown + 100)) {
        const row = button('', () => selectText(key), 'ui-text-catalog-item');
        row.textContent = getText(key, language); row.title = key; row.dataset.uiSource = key;
        list.append(row);
      }
      shown += 100;
      if (shown < matches.length) list.append(more);
    };
    appendBatch();
  }
  function paintPreview() {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.documentElement.lang = language;
    // Both languages remain RTL. No class, icon, style or geometry changes.
    for (const record of previewRecords) {
      const value = getText(record.key, language);
      if (record.node) record.node.nodeValue = record.leading + value + record.trailing;
      else record.element.setAttribute(record.attribute, value);
    }
  }
  function addRecord(record) {
    previewRecords.push(record);
    const records = previewElements.get(record.element) || [];
    records.push(record); previewElements.set(record.element, records);
    record.element.dataset.uiTextEditable = '';
    if (!record.element.matches('input,select,textarea,button,a,option')) record.element.tabIndex = 0;
  }
  function registerPreview(doc) {
    // Re-registering a native toolbar must not lose the original keys of the
    // unchanged, already translated nodes elsewhere in the preview.
    for (const record of previewRecords) {
      if (record.element?.ownerDocument !== doc || !record.element.isConnected) continue;
      if (record.node) record.node.nodeValue = record.leading + record.key + record.trailing;
      else record.element.setAttribute(record.attribute, record.key);
    }
    previewRecords = []; previewElements = new WeakMap();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element || element.closest('script,style,svg,textarea,[data-no-translate],[data-ui-content]')) continue;
      const raw = node.nodeValue, trimmed = raw.replace(/\s+/g, ' ').trim();
      const key = defaults[raw] ? raw : trimmed;
      if (!defaults[key]) continue;
      addRecord({node, element, key, leading: defaults[raw] ? '' : raw.match(/^\s*/)[0], trailing: defaults[raw] ? '' : raw.match(/\s*$/)[0]});
    }
    doc.querySelectorAll('*').forEach(element => {
      if (element.closest('svg,[data-no-translate],[data-ui-content]')) return;
      for (const attribute of editableAttributes) {
        const key = element.getAttribute(attribute)?.replace(/\s+/g, ' ').trim();
        if (defaults[key]) addRecord({element, attribute, key});
      }
    });
  }
  async function template(view) {
    if (templateCache[view]) return templateCache[view];
    const response = await fetch(`/api/ui-text?preview=${encodeURIComponent(view)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return templateCache[view] = result.html;
  }
  function safeDocument(html, view) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Source is a shipped template, NOT outerHTML from the populated live app.
    doc.querySelectorAll('script,noscript,iframe,object,embed,audio,video,base,meta[http-equiv]').forEach(node => node.remove());
    doc.querySelectorAll('*').forEach(element => {
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (element.matches('input,textarea')) { element.value = ''; element.removeAttribute('value'); element.textContent = ''; element.readOnly = true; }
      if (element.matches('form')) { element.removeAttribute('action'); element.removeAttribute('method'); }
      if (element.matches('button')) { element.type = 'button'; element.disabled = false; }
      if (element.matches('a')) element.removeAttribute('href');
      for (const attribute of ['href', 'src']) {
        const value = element.getAttribute(attribute);
        if (value && !value.startsWith('#') && !value.startsWith('data:')) {
          const resolved = new URL(value, window.location.href);
          if (resolved.origin !== window.location.origin) element.removeAttribute(attribute);
          else element.setAttribute(attribute, resolved.href);
        }
      }
    });
    // Slots whose text belongs to the user stay empty even if a future shipped
    // template supplies an illustrative name. Static setting captions remain.
    doc.querySelectorAll('#app-title,#header-context-title,#schema-title,#current-audit-user,#audit-user-name,#schema-summary,#record-code,#record-title,#app-language-editor,#schema-language-editor,#category-language-editor,#field-language-editor,[data-ui-content]').forEach(node => { node.textContent = ''; node.dataset.uiContent = ''; });
    doc.querySelectorAll('#session-privacy-screen,#toast').forEach(node => node.remove());
    doc.body.classList.remove('session-pending'); doc.body.classList.add('session-authenticated', 'ui-text-preview');
    if (view === 'main') {
      const appStyle = document.documentElement.getAttribute('style');
      if (appStyle) doc.documentElement.setAttribute('style', appStyle);
      // Copy only already-defined decorative SVGs; never copy user-visible text.
      doc.querySelectorAll('button[id]').forEach(button => {
        if (button.querySelector('svg')) return;
        const icon = document.getElementById(button.id)?.querySelector('svg');
        if (icon) button.prepend(icon.cloneNode(true));
      });
    }
    // Serialized inline styles are blocked by the application's CSP. Restore
    // trusted template styles through the CSSOM after loading, like the live UI.
    doc.querySelectorAll('[style]').forEach(element => { element.dataset.uiInlineStyle = element.getAttribute('style'); element.removeAttribute('style'); });
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('ui-text-preview.css', window.location.href).href; doc.head.append(link);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }
  const pages = [
    ['home', 'الرئيسية'], ['entry', 'إدخال البيانات'], ['search', 'البحث'], ['import', 'الاستيراد'],
    ['export', 'التصدير'], ['profile-export', 'تقرير شخص PDF'], ['builder', 'تصميم التطبيق'], ['settings', 'الإعدادات'],
    ['report', 'التقارير المتقدمة'], ['startup', 'تسجيل الدخول'], ['closing', 'إغلاق التطبيق'], ['viewer', 'عارض المرفقات'],
  ];
  function previewPage(doc, page) {
    if (page === 'report') { showWindow(doc, 'writer-editor-dialog'); return; }
    if (['startup', 'closing', 'viewer'].includes(page)) return;
    const selectedPage = page === 'settings' ? 'home' : page === 'profile-export' ? 'export' : page;
    const views = {home: 'home-view', entry: 'entry-view', search: 'full-search-view', import: 'import-view', export: 'export-view', builder: 'builder-view'};
    for (const [name, id] of Object.entries(views)) { const node = doc.getElementById(id); if (node) node.hidden = name !== selectedPage; }
    for (const id of ['loading-view', 'readonly-view']) { const node = doc.getElementById(id); if (node) node.hidden = true; }
    for (const mode of ['entry', 'builder', 'import', 'export']) {
      const rail = doc.getElementById(mode + '-action-rail'); if (rail) rail.hidden = mode !== selectedPage;
    }
    doc.body.classList.toggle('home-mode-active', selectedPage === 'home');
    doc.body.classList.toggle('page-tab-bar-active', selectedPage !== 'home');
    const workspace = doc.getElementById('app-workspace'); if (workspace) workspace.dataset.mode = selectedPage;
    doc.querySelectorAll('button[data-mode]').forEach(node => { node.hidden = false; node.classList.toggle('mode-button-active', node.dataset.mode === selectedPage); });
    // No schema/category/field names or values are loaded into these strips.
    doc.querySelectorAll('#workspace-schema-strip,#header-schema-navigation,#category-navigator,#ui-text-admin-setting').forEach(node => node.hidden = true);
    if (selectedPage === 'export') {
      const mode = page === 'profile-export' ? 'profile' : 'table';
      doc.querySelectorAll('[data-export-panel]').forEach(n => n.hidden = n.dataset.exportPanel !== mode);
      doc.querySelectorAll('[data-export-rail-action]').forEach(n => n.hidden = n.dataset.exportRailAction !== mode);
      const selector = doc.getElementById('schema-export-mode-selector'); if (selector) selector.hidden = mode === 'profile';
    }
    if (page === 'settings') showWindow(doc, 'settings-view');
  }
  function showWindow(doc, id) {
    doc.querySelectorAll('dialog[open]').forEach(node => node.close());
    const node = doc.getElementById(id);
    if (node?.tagName === 'DIALOG') { node.hidden = false; node.showModal(); }
  }
  async function renderPage(page) {
    const serial = ++renderSerial; currentPage = page; pageSelect.value = page;
    const view = ['startup', 'closing', 'viewer', 'report'].includes(page) ? page : 'main';
    try {
      const html = await template(view);
      if (!active || serial !== renderSerial) return;
      frame.onload = () => {
        if (!active || serial !== renderSerial) return;
        const doc = frame.contentDocument;
        doc.querySelectorAll('[data-ui-inline-style]').forEach(element => {
          const parsed = document.createElement('span').style; parsed.cssText = element.dataset.uiInlineStyle;
          for (const property of parsed) element.style.setProperty(property, parsed.getPropertyValue(property), parsed.getPropertyPriority(property));
          delete element.dataset.uiInlineStyle;
        });
        registerPreview(doc); previewPage(doc, page);
        windowSelect.replaceChildren(new Option(text('بدون نافذة'), ''));
        doc.querySelectorAll('dialog[id]').forEach(node => {
          const title = node.querySelector('h2,h3')?.textContent.trim() || node.id;
          windowSelect.append(new Option(defaults[title] ? getText(title, language) : title, node.id));
        });
        windowSelect.value = page === 'settings' ? 'settings-view' : page === 'report' ? 'writer-editor-dialog' : '';
        windowSelect.disabled = windowSelect.options.length < 2;
        const pick = event => {
          const target = event.target.closest?.('[data-ui-text-editable]');
          const records = target ? previewElements.get(target) || [] : [];
          const range = doc.caretRangeFromPoint?.(event.clientX || 0, event.clientY || 0);
          const clicked = records.find(record => record.node === range?.startContainer) || records[0];
          if (clicked) selectText(clicked.key);
        };
        doc.addEventListener('click', event => {
          event.preventDefault(); event.stopImmediatePropagation(); pick(event);
          const nav = event.target.closest?.('button[data-mode]');
          if (nav && pages.some(([name]) => name === nav.dataset.mode)) { void renderPage(nav.dataset.mode); return; }
          const tab = event.target.closest?.('[data-settings-category-tab]');
          if (tab) {
            const category = tab.dataset.settingsCategoryTab;
            doc.querySelectorAll('[data-settings-category]').forEach(node => node.hidden = node.dataset.settingsCategory !== category);
            doc.querySelectorAll('[data-settings-category-tab]').forEach(node => { node.classList.toggle('is-active', node === tab); node.setAttribute('aria-selected', String(node === tab)); });
            doc.querySelectorAll('[data-settings-footer-action]').forEach(node => node.hidden = node.dataset.settingsFooterAction !== category);
          }
          const exportTab = event.target.closest?.('[data-export-mode]');
          if (exportTab) {
            const mode = exportTab.dataset.exportMode;
            if (mode === 'advanced') { void renderPage('report'); return; }
            doc.querySelectorAll('[data-export-mode]').forEach(n => n.classList.toggle('is-active', n === exportTab));
            doc.querySelectorAll('[data-export-panel]').forEach(n => n.hidden = n.dataset.exportPanel !== mode);
            doc.querySelectorAll('[data-export-rail-action]').forEach(n => n.hidden = n.dataset.exportRailAction !== mode);
          }
          const importTab = event.target.closest?.('[data-import-mode]');
          if (importTab) {
            doc.querySelectorAll('[data-import-mode]').forEach(n => n.classList.toggle('is-active', n === importTab));
            doc.querySelectorAll('[data-import-panel]').forEach(n => n.hidden = n.dataset.importPanel !== importTab.dataset.importMode);
          }
          const ribbon = event.target.closest?.('[data-preview-ribbon]');
          if (ribbon) {
            const source = doc.querySelector(`template[data-ribbon-template="${ribbon.dataset.previewRibbon}"]`);
            if (source) { doc.querySelector('.writer-format').replaceChildren(source.content.cloneNode(true)); registerPreview(doc); paintPreview(); }
          }
          const summary = event.target.closest?.('summary'); if (summary) summary.parentElement.open = !summary.parentElement.open;
        }, true);
        doc.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
        doc.addEventListener('keydown', event => {
          if (event.key === 'Tab') return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (event.key === 'Enter' || event.key === ' ') pick(event);
        }, true);
        doc.addEventListener('mousedown', event => {
          if (event.target.closest?.('input,select,textarea')) { event.preventDefault(); pick(event); }
        }, true);
        doc.addEventListener('cancel', event => event.preventDefault(), true);
        paintPreview();
        if (selected) selectText(selected);
      };
      frame.srcdoc = safeDocument(html, view);
    } catch (error) { status(error.message, true); }
  }
  function buildDialog() {
    dialog = make('dialog', '', 'ui-text-editor-dialog'); dialog.id = 'ui-text-editor';
    const heading = make('div', '', 'dialog-heading');
    heading.append(make('h2', text('تعديل نصوص الواجهة')));
    const actions = make('div', '', 'ui-text-editor-actions');
    saveButton = button('حفظ دائم والخروج', () => void finish(true), 'button button-primary'); saveButton.id = 'ui-text-save';
    discardButton = button('تجاهل والخروج', () => void finish(false)); discardButton.id = 'ui-text-discard';
    actions.append(saveButton, discardButton); heading.append(actions);
    const toolbar = make('div', '', 'ui-text-editor-toolbar');
    pageSelect = make('select', '', 'control'); pageSelect.id = 'ui-text-page'; pageSelect.setAttribute('aria-label', text('الصفحة'));
    for (const [value, label] of pages) pageSelect.append(new Option(text(label), value));
    pageSelect.addEventListener('change', () => void renderPage(pageSelect.value));
    windowSelect = make('select', '', 'control'); windowSelect.id = 'ui-text-window'; windowSelect.setAttribute('aria-label', text('النوافذ'));
    windowSelect.addEventListener('change', () => showWindow(frame.contentDocument, windowSelect.value));
    const toggle = make('div', '', 'language-switch'); toggle.setAttribute('role', 'radiogroup'); toggle.setAttribute('aria-label', text('لغة الواجهة'));
    for (const lang of ['ar', 'fa']) {
      const option = button('', () => {
        language = lang; paintPreview(); renderCatalog();
        toggle.querySelectorAll('button').forEach(node => { node.classList.toggle('is-active', node.lang === lang); node.setAttribute('aria-checked', String(node.lang === lang)); });
      }, 'language-option');
      option.textContent = lang === 'ar' ? 'عربي' : 'فارسی'; option.lang = lang; option.dataset.noTranslate = '';
      option.id = 'ui-text-language-' + lang; option.setAttribute('role', 'radio'); option.setAttribute('aria-checked', String(lang === language)); option.classList.toggle('is-active', lang === language); toggle.append(option);
    }
    changes = make('span', '', 'ui-text-changes'); toolbar.append(pageSelect, windowSelect, toggle, changes);
    notice = make('p', text('معاينة آمنة؛ وظائف التطبيق متوقفة.'), 'ui-text-editor-notice'); notice.setAttribute('role', 'status');
    const layout = make('div', '', 'ui-text-editor-layout');
    frame = make('iframe', '', 'ui-text-editor-preview'); frame.id = 'ui-text-preview'; frame.title = text('معاينة');
    frame.setAttribute('sandbox', 'allow-same-origin'); // Deliberately NO allow-scripts, forms, popups or downloads.
    const sidebar = make('aside', '', 'ui-text-editor-sidebar');
    sidebar.append(make('p', text('اختر صفحة أو نافذة، ثم انقر على نص لتعديله.'), 'field-help'));
    panel = make('section', '', 'ui-text-editor-fields'); panel.hidden = true;
    const original = make('p', '', 'ui-text-original'); const sourceLabel = make('strong', text('النص الأصلي')); const source = make('span'); source.id = 'ui-text-source'; original.append(sourceLabel, source); panel.append(original);
    for (const lang of ['ar', 'fa']) {
      const label = make('label', '', 'field'); label.append(make('span', text(lang === 'ar' ? 'النص العربي' : 'النص الفارسي')));
      const field = make('textarea', '', 'control'); field.id = 'ui-text-' + lang; field.lang = lang; field.dir = 'rtl'; field.maxLength = 6000; field.rows = 3;
      field.addEventListener('input', () => updateValue(lang)); fields[lang] = field; label.append(field); panel.append(label);
    }
    panel.append(make('p', text('تُطبّق التغييرات على كل مواضع هذا النص. اتركه فارغًا لاستخدام النص الافتراضي.'), 'field-help'));
    panel.append(button('استعادة النص الافتراضي', () => {
      if (!selected) return; delete draft[selected];
      for (const input of Object.values(fields)) input.setAttribute('aria-invalid', 'false');
      saveButton.disabled = false; selectText(selected); paintPreview(); updateDirty();
    }));
    const catalog = make('details', '', 'ui-text-catalog'); catalog.open = true;
    catalog.append(make('summary', text('جميع نصوص الواجهة')));
    search = make('input', '', 'control'); search.type = 'search'; search.id = 'ui-text-search'; search.placeholder = text('ابحث في النصوص العربية والفارسية'); search.setAttribute('aria-label', search.placeholder); search.addEventListener('input', renderCatalog);
    const count = make('span', '', 'ui-text-result-count'); count.id = 'ui-text-result-count';
    list = make('div', '', 'ui-text-catalog-list'); catalog.append(search, count, list);
    sidebar.append(panel, catalog); layout.append(frame, sidebar);
    dialog.append(heading, toolbar, notice, layout); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); status(text('احفظ أو تجاهل التغييرات للخروج من وضع تعديل النصوص.')); });
    dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saveButton.disabled) void finish(true); }
    });
    dialog.showModal(); updateDirty(); renderCatalog();
  }
  function pauseTimers() {
    for (const key of ['draftTimer', 'builderAutosaveTimer']) { oldTimers[key] = Boolean(state[key]); clearInterval(state[key]); state[key] = null; }
  }
  function resumeTimers() {
    if (oldTimers.draftTimer) state.draftTimer = setInterval(saveDraftLocally, RECORD_DRAFT_AUTOSAVE_MS);
    if (oldTimers.builderAutosaveTimer) state.builderAutosaveTimer = setInterval(autosaveBuilder, BUILDER_AUTOSAVE_MS);
    oldTimers = {};
  }
  async function start() {
    if (active || opening || !builderUnlocked()) return;
    if (hasUnsavedWorkspaceChanges() || window.SchemaCraftWriterHasPendingChanges?.()) { showToast(text('احفظ أو تجاهل تغييرات العمل قبل تعديل نصوص الواجهة.'), 'error'); return; }
    if (state.activeRequests) { showToast(text('انتظر اكتمال العملية الحالية ثم افتح محرر النصوص.'), 'error'); return; }
    opening = true;
    try {
      const response = await request('start');
      lease = response.token; revision = response.revision; defaults = response.defaults;
      draft = clone(response.overrides); initial = JSON.stringify(draft); selected = ''; language = api.language;
      active = true; pauseTimers(); buildDialog();
      heartbeat = setInterval(async () => {
        try { await request('touch'); }
        catch (error) { if (active) status(error.status === 403 ? text('انتهت جلسة التعديل. يمكنك تجاهل التغييرات والعودة.') : text('فقد الاتصال بالمحرر؛ احتفظ بهذه النافذة لاستعادة الاتصال أو تجاهل التغييرات.'), true); }
      }, 20000);
      await renderPage('settings');
    } catch (error) {
      if (active) { try { await request('discard'); } catch (_) {} active = false; resumeTimers(); dialog?.remove(); }
      showToast(error.message, 'error');
    } finally { opening = false; }
  }
  async function finish(save) {
    if (!active) return;
    if (save && saveButton.disabled) return;
    saveButton.disabled = discardButton.disabled = true;
    try {
      if (save) await request('save', {revision, overrides: draft});
      else { try { await request('discard'); } catch (error) { if (error.status !== 403) throw error; } }
      clearInterval(heartbeat); active = false; lease = ''; dialog.close(); dialog.remove(); resumeTimers();
      if (save) { sessionStorage.setItem('schemacraft-reopen-settings', 'interface'); window.location.reload(); }
      else document.getElementById('edit-ui-text-button')?.focus();
    } catch (error) { status(error.message, true); saveButton.disabled = discardButton.disabled = false; }
  }
  window.SchemaCraftUITextEditor = Object.freeze({start, get active() { return active; }});
  document.getElementById('edit-ui-text-button')?.addEventListener('click', () => void start());
  window.addEventListener('beforeunload', event => { if (active) { event.preventDefault(); event.returnValue = ''; } });
  // Return to the same settings section after a successful language/text save.
  let attempts = 0;
  const reopen = setInterval(() => {
    if (++attempts > 120) { clearInterval(reopen); return; }
    if (!state.schema || document.body.classList.contains('session-pending')) return;
    clearInterval(reopen);
    const category = sessionStorage.getItem('schemacraft-reopen-settings');
    if (category) { sessionStorage.removeItem('schemacraft-reopen-settings'); switchMode('settings'); setSettingsCategory(category); }
  }, 100);
})();
