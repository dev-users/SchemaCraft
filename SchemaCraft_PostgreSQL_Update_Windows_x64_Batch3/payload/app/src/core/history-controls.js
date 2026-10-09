/* One contextual toolbar for Search / Import / Export history. Rows contain
 * data only; destructive operations still require the original confirmation.
 * The toolbar is outside scrolling tables, so it is never clipped by a cell. */
let searchHistoryControlRow = null;
function prepareHistoryRow(row, kind, id) {
  row.classList.add('history-context-row');
  if (kind === 'search') row.classList.add('search-history-record');
  row.dataset.historyKind = kind; row.dataset.historyEntryId = id;
  row.tabIndex = 0; row.setAttribute('aria-expanded', 'false');
  row.setAttribute('aria-controls', 'search-history-controls');
  row.title = scText('اضغط لإظهار الإجراءات');
}
function historyEntry(kind, id) {
  const entries = kind === 'search' ? readRecentSearches() :
    kind === 'import' ? state.importHistoryEntries : state.exportHistoryEntries;
  return (entries || []).find(item => item.id === id);
}
function historyControlActions(kind, entry) {
  if (!entry) return [];
  const actions = [];
  if (kind === 'search') actions.push(
    ['results', 'عرض النتائج', 'table'],
    ['filters', 'استعادة المرشحات', 'filter'],
    ['headers', 'استعادة حقول النتائج', 'fields']);
  if (kind === 'import') {
    actions.push(['details', 'فتح التفاصيل', 'fields']);
    if (entry.source_archive) actions.push(['open', 'فتح الملف', 'open-record']);
  }
  if (kind === 'export') {
    actions.push(['open', 'فتح الملف', 'open-record']);
    if (!['advanced_report_v3','finance_view'].includes(entry.type) && entry.configuration &&
        Object.keys(entry.configuration).length) {
      actions.push(['restore', 'استعادة إعدادات التصدير', 'restore']);
    }
  }
  actions.push(['delete', 'حذف', 'trash']);
  return actions;
}
function hideSearchHistoryControls(refocus = false) {
  const row = searchHistoryControlRow;
  if (row) { row.classList.remove('search-history-selected'); row.setAttribute('aria-expanded', 'false'); }
  document.getElementById('search-history-controls')?.setAttribute('hidden', '');
  searchHistoryControlRow = null;
  if (refocus && row?.isConnected) row.focus({preventScroll: true});
}
function positionSearchHistoryControls() {
  const row = searchHistoryControlRow, menu = document.getElementById('search-history-controls');
  if (!row?.isConnected || !row.getClientRects().length || !menu || menu.hidden) return hideSearchHistoryControls();
  const bounds = row.getBoundingClientRect(), size = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(bounds.right - size.width - 8, window.innerWidth - size.width - 8))}px`;
  menu.style.top = `${bounds.bottom + size.height + 8 < window.innerHeight ? bounds.bottom + 3 : Math.max(8, bounds.top - size.height - 3)}px`;
}
function toggleSearchHistoryControls(row, keyboard = false) {
  if (searchHistoryControlRow === row) return hideSearchHistoryControls();
  hideSearchHistoryControls();
  const kind = row.dataset.historyKind || 'search', id = row.dataset.historyEntryId || row.dataset.searchHistoryId;
  const entry = historyEntry(kind, id), menu = document.getElementById('search-history-controls');
  if (!entry || !menu) return;
  menu.replaceChildren(); menu.dataset.entryId = id; menu.dataset.historyKind = kind;
  menu.setAttribute('aria-label', scText('إجراءات السجل'));
  for (const [action, source, icon] of historyControlActions(kind, entry)) {
    const button = document.createElement('button'), label = scText(source);
    button.type = 'button'; button.className = `button ${action === 'delete' ? 'button-danger-quiet' : 'button-secondary'} workflow-icon-only`;
    button.dataset.historyControl = action; button.setAttribute('aria-label', label); button.title = label;
    // Use existing icon symbols; this never changes with interface language.
    button.append(actionIcon(icon));
    button.addEventListener('click', async () => {
      hideSearchHistoryControls(true);
      try { await performHistoryControl(kind, id, action); }
      catch (error) { showToast(error.message, 'error'); }
    });
    menu.append(button);
  }
  searchHistoryControlRow = row; row.classList.add('search-history-selected'); row.setAttribute('aria-expanded', 'true');
  menu.hidden = false; positionSearchHistoryControls();
  if (keyboard) menu.querySelector('button')?.focus();
}
async function performHistoryControl(kind, id, action) {
  const entry = historyEntry(kind, id);
  if (!entry) throw new Error(scText('تعذر العثور على العملية المحفوظة.'));
  if (!historyControlActions(kind, entry).some(item => item[0] === action)) return;
  if (kind === 'search') {
    if (action === 'delete') return removeSearchHistoryItem(id);
    if (action === 'results') return viewSearchHistoryResults(id);
    return importSearchHistoryPart(id, action);
  }
  // Header/admin gates are not the only boundary; endpoints also authorize.
  if (!builderUnlocked()) return;
  if (action === 'details') return openImportHistoryDetails(id);
  if (action === 'restore') return restoreExportHistoryConfiguration(entry);
  if (action === 'open') {
    await fetch(`/api/${kind}/history/open`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}),
    }).then(responseJson);
    showToast(scText('تم إرسال الملف إلى التطبيق الافتراضي.'));
    return;
  }
  if (action !== 'delete') return;
  const advanced = kind === 'export' && entry.type === 'advanced_report_v3';
  const question = kind === 'import' ? scText('حذف عملية الاستيراد من السجل ونسختها المؤرشفة؟') :
    advanced ? scText('حذف التقرير المتقدم من السجل وحذف نسخته المحفوظة داخل SchemaCraft؟') :
      scText('حذف عملية التصدير من السجل؟ لن يُحذف الملف الخارجي نفسه.');
  if (!(await requestConfirmation(question, {
    title: kind === 'import' ? scText('حذف عملية استيراد') : advanced ? scText('حذف تقرير متقدم') : scText('حذف عملية تصدير'),
    confirmLabel: advanced ? scText('حذف التقرير') : scText('حذف العملية'),
  }))) return;
  await fetch(`/api/${kind}/history/${encodeURIComponent(id)}`, {method: 'DELETE'}).then(responseJson);
  if (kind === 'import') await loadImportHistory();
  else {
    try { localStorage.removeItem(RECENT_EXPORTS_STORAGE_KEY); } catch (_) { /* optional legacy cache */ }
    await loadExportHistory();
  }
  renderHome();
}
function installSearchHistoryControls() {
  if (document.getElementById('search-history-controls')) return;
  const menu = document.createElement('div'); menu.id = 'search-history-controls';
  menu.className = 'search-history-context-controls history-context-controls'; menu.hidden = true;
  menu.setAttribute('role', 'toolbar'); menu.setAttribute('aria-label', scText('إجراءات السجل'));
  document.body.append(menu);
  for (const container of [elements.searchHistoryList, elements.importHistoryBody, elements.exportHistoryBody].filter(Boolean)) {
    container.addEventListener('click', event => {
      if (event.target.closest('button,a,input,textarea,select')) return;
      const row = event.target.closest('[data-history-entry-id]');
      if (row) toggleSearchHistoryControls(row);
    });
    container.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key) || event.target.closest('button,a,input,textarea,select')) return;
      const row = event.target.closest('[data-history-entry-id]');
      if (row) { event.preventDefault(); toggleSearchHistoryControls(row, true); }
    });
    new MutationObserver(() => {
      if (searchHistoryControlRow && !searchHistoryControlRow.isConnected) hideSearchHistoryControls();
    }).observe(container, {childList: true});
  }
  menu.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...menu.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
    if (buttons.length) buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (i + (event.key === 'ArrowLeft' ? 1 : buttons.length - 1)) % buttons.length].focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchHistoryControlRow) { event.preventDefault(); hideSearchHistoryControls(true); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#search-history-controls, [data-history-entry-id]')) hideSearchHistoryControls();
  }, true);
  document.addEventListener('scroll', () => { if (searchHistoryControlRow) hideSearchHistoryControls(); }, true);
  window.addEventListener('resize', () => hideSearchHistoryControls());
}
