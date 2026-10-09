/* Arabic/Persian presentation only. No observers and no translation of user data. */
(function (root) {
  'use strict';
  const supported = ['ar', 'fa'];
  const storageKey = 'schemacraft-ui-language-v1';
  const catalog = root.__SC_FA_CATALOG__ || {};
  const overrides = root.__SC_UI_OVERRIDES__ || {};
  const custom = root.__SC_UI_CUSTOM__ || {};
  const reverseOverrides = new Map(Object.entries(overrides).filter(([a, b]) => a !== b).map(([a, b]) => [b, a]));
  let language = supported.includes(root.__SC_LANGUAGE__) ? root.__SC_LANGUAGE__ : 'ar';
  const staticText = [];
  const staticAttributes = [];
  const listeners = new Set();
  let languageSave = Promise.resolve();

  function canonical(text) { return reverseOverrides.get(text) || text; }
  function translated(source) {
    const original = String(source ?? '');
    const key = canonical(original);
    const normalizedKey = key.replace(/\s+/g, ' ').trim();
    if (typeof custom[key]?.[language] === 'string') return custom[key][language];
    if (typeof custom[normalizedKey]?.[language] === 'string') return key.match(/^\s*/)[0] + custom[normalizedKey][language] + key.match(/\s*$/)[0];
    if (language === 'ar') return overrides[key] ?? key;
    if (Object.prototype.hasOwnProperty.call(catalog, key)) return catalog[key];
    const normalized = canonical(key.replace(/\s+/g, ' ').trim());
    if (Object.prototype.hasOwnProperty.call(catalog, normalized)) {
      return key.match(/^\s*/)[0] + catalog[normalized] + key.match(/\s*$/)[0];
    }
    return key;
  }

  function t(source, ...values) {
    // Tagged templates provide placeholders without ever translating their data.
    if (Array.isArray(source) && Object.prototype.hasOwnProperty.call(source, 'raw')) {
      const key = source.map((part, index) => part + (index < values.length ? `{${index}}` : '')).join('');
      const text = translated(key);
      return text.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
    }
    return translated(source);
  }

  function sourceFor(text) {
    const value = String(text ?? '').trim();
    if (Object.prototype.hasOwnProperty.call(catalog, value)) return value;
    for (const [source, translated] of Object.entries(catalog)) if (translated.trim() === value) return source;
    for (const [source, translated] of Object.entries(overrides)) if (translated.trim() === value) return source;
    for (const [source, values] of Object.entries(custom)) if (Object.values(values).some(v => v.trim() === value)) return source;
    return value;
  }

  function display(entity, key = 'label') {
    if (!entity || typeof entity !== 'object') return '';
    const names = entity.i18n;
    if (names?.enabled === true) {
      for (const locale of [language, language === 'ar' ? 'fa' : 'ar']) {
        const value = names[locale]?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return String(entity[key] ?? '');
  }

  function variants(entity, key = 'label') {
    if (!entity || typeof entity !== 'object') return [];
    const result = [String(entity[key] ?? '')];
    if (entity.i18n?.enabled === true) {
      for (const locale of supported) {
        const value = entity.i18n[locale]?.[key];
        if (typeof value === 'string' && value.trim()) result.push(value.trim());
      }
    }
    return [...new Set(result.filter(Boolean))];
  }

  function captureStaticDocument() {
    // Only the initial shipped HTML is captured, before application code renders
    // schemas, records, filenames or reports. Later DOM mutations are not scanned.
    document.querySelectorAll('button').forEach(button => {
      button.dataset.uiOriginalText = button.textContent || '';
      button.dataset.uiOriginalLabel = button.getAttribute('aria-label') || '';
    });
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || node.parentElement.closest('script,style,textarea,[data-no-translate]')) continue;
      if (!node.nodeValue.trim()) continue;
      staticText.push({ node, source: node.nodeValue });
    }
    document.querySelectorAll('[title],[placeholder],[aria-label],[alt],[data-tooltip],option').forEach((element) => {
      if (element.closest('[data-no-translate]')) return;
      // A translated option label must not silently become a different value.
      if (element.tagName === 'OPTION' && !element.hasAttribute('value')) element.value = element.textContent;
      for (const attribute of ['title', 'placeholder', 'aria-label', 'alt', 'data-tooltip']) {
        if (element.hasAttribute(attribute)) staticAttributes.push({ element, attribute, source: element.getAttribute(attribute) });
      }
    });
  }

  function paintLanguage() {
    document.documentElement.lang = language;
    document.documentElement.dir = 'rtl';
    staticText.forEach(({ node, source }) => { if (node.isConnected) node.nodeValue = t(source); });
    staticAttributes.forEach(({ element, attribute, source }) => { if (element.isConnected) element.setAttribute(attribute, t(source)); });
    document.querySelectorAll('[data-ui-language]').forEach((button) => {
      const active = button.dataset.uiLanguage === language;
      button.setAttribute('aria-checked', String(active));
      button.classList.toggle('is-active', active);
      button.tabIndex = active ? 0 : -1;
    });
    try { root.localStorage.setItem(storageKey, language); } catch (_) { /* Optional cache only. */ }
    listeners.forEach((callback) => callback(language));
  }

  function setLanguage(value) {
    if (!supported.includes(value)) throw new Error('Unsupported interface language');
    language = value;
    paintLanguage();
  }

  function saveLanguage(value, extraHeaders = {}) {
    if (!supported.includes(value)) return Promise.reject(new Error(t('لغة الواجهة غير مدعومة.')));
    // Serialize rapid clicks so the last completed request is the last choice.
    const task = async () => {
      const response = await root.fetch('/api/language', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...extraHeaders, 'X-SchemaCraft-Language': value },
        body: JSON.stringify({ language: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('تعذّر حفظ لغة الواجهة.'));
      setLanguage(result.language);
      return result.language;
    };
    const pending = languageSave.then(task, task);
    languageSave = pending.catch(() => {});
    return pending;
  }

  function wireToggle(container, onSelect) {
    if (!container) return;
    const buttons = [...container.querySelectorAll('[data-ui-language]')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => onSelect(button.dataset.uiLanguage));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = buttons.indexOf(button);
        const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons[buttons.length - 1] : buttons[(index + 1) % buttons.length];
        next.focus();
        onSelect(next.dataset.uiLanguage);
      });
    });
    paintLanguage();
  }

  root.SchemaCraftI18n = Object.freeze({
    t, display, variants, setLanguage, saveLanguage, wireToggle, sourceFor,
    get language() { return language; },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    get catalogSize() { return Object.keys(catalog).filter(key => !key.startsWith('_')).length; },
  });
  captureStaticDocument();
  paintLanguage();
})(window);
