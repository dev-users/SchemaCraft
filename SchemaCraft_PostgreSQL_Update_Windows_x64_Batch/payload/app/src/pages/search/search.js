function createSchemaSearchFilterCategory(label, categoryId, variant = "field") {
  const group = document.createElement("section");
  group.className = "selection-category-group schema-search-filter-category";
  group.dataset.schemaSearchFilterCategory = categoryId;
  group.dataset.schemaSearchFilterVariant = variant;
  const heading = document.createElement("strong");
  heading.className = "schema-search-filter-category-title";
  heading.textContent = label;
  const grid = document.createElement("div");
  grid.className = "field-grid schema-search-category-field-grid";
  group.append(heading, grid);
  return { group, grid };
}

function updateCategorizedFilterScrolling(container) {
  if (!container) return;
  const categoryCount = container.querySelectorAll(
    ".schema-search-filter-category:not([hidden])",
  ).length;
  container.classList.toggle("is-scrollable", categoryCount > 5);
  container.dataset.visibleCategoryCount = String(categoryCount);
}

function updateSchemaSearchFilterScrolling() {
  updateCategorizedFilterScrolling(elements.schemaSearchFilterGroups);
}

function defaultFullSearchFieldIds(schema = state.schema) {
  const mainFieldIds = new Set(
    (schema?.categories || [])
      .filter((category) => category.kind === "main")
      .flatMap((category) => (category.fields || []).filter((field) => field.type !== "spacer").map((field) => field.id)),
  );
  return defaultSearchFieldIds(schema).filter((fieldId) => mainFieldIds.has(fieldId));
}

function activeFullSearchFieldIds(schema = state.schema) {
  const eligible = new Set(
    eligibleSearchFields(schema).map(({ field }) => field.id),
  );
  const selected = Array.isArray(state.fullSearchFieldIds)
    ? state.fullSearchFieldIds
    : defaultFullSearchFieldIds(schema);
  return selected.filter((fieldId) => eligible.has(fieldId));
}

function defaultFullSearchColumnIds(schema = state.schema) {
  const eligible = eligibleSearchFields(schema)
    .filter(({ category }) => category.kind === "main");
  const configured = eligible
    .filter(({ field }) => field.show_in_results && !field.result_title)
    .map(({ field }) => field.id);
  if (configured.length) {
    return configured;
  }
  return eligible
    .slice(0, 4)
    .map(({ field }) => field.id);
}

function activeFullSearchColumnIds(schema = state.schema) {
  const eligible = new Set(
    eligibleSearchFields(schema).map(({ field }) => field.id),
  );
  const selected = Array.isArray(state.fullSearchColumnIds)
    ? state.fullSearchColumnIds
    : defaultFullSearchColumnIds(schema);
  return selected.filter((fieldId) => eligible.has(fieldId));
}

function activeFullSearchOptionIds(optionKind) {
  const selected = optionKind === "filter"
    ? activeFullSearchFieldIds()
    : activeFullSearchColumnIds();
  const includeRecordId = optionKind === "filter"
    ? state.fullSearchRecordIdFilter
    : state.fullSearchRecordIdColumn;
  const system = includeRecordId ? [FULL_SEARCH_RECORD_CODE_OPTION] : [];
  return [...system, ...selected];
}

function defaultFullSearchOptionIds(optionKind) {
  const selected = optionKind === "filter"
    ? defaultFullSearchFieldIds()
    : defaultFullSearchColumnIds();
  return [
    FULL_SEARCH_RECORD_CODE_OPTION,
    ...selected,
  ];
}

function fullSearchControlValues() {
  return sharedFilterCriteria(elements.fullSearchFields);
}

function fullSearchEmptyFieldIds() {
  return new Set(
    Object.entries(sharedFilterCriteria(elements.fullSearchFields))
      .filter(([_fieldId, criterion]) => criterion?.operator === "empty")
      .map(([fieldId]) => fieldId),
  );
}

function updateFullSearchOptionsSummary() {
  const optionLabel = (optionId) => {
    if (optionId === FULL_SEARCH_RECORD_CODE_OPTION) return "ID";
    return displayLabel(fieldById(optionId, state.schema)) || "";
  };
  const renderLabels = (container, optionIds, emptyText) => {
    if (!container) return;
    container.replaceChildren();
    const remaining = new Set(optionIds);
    let rendered = 0;
    const appendGroup = (label, ids) => {
      const available = ids.filter((id) => remaining.has(id) && optionLabel(id));
      if (!available.length) return;
      const group = document.createElement("section");
      group.className = "selection-category-group";
      const heading = document.createElement("strong");
      heading.textContent = label;
      const chips = document.createElement("div");
      chips.className = "selection-chip-list";
      available.forEach((id) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "selection-chip selection-chip-button";
        chip.dataset.removeFullSearchColumn = id;
        chip.title = scText("إزالة من حقول النتائج");
        chip.textContent = optionLabel(id);
        chips.append(chip);
        remaining.delete(id);
        rendered += 1;
      });
      group.append(heading, chips);
      container.append(group);
    };
    appendGroup(scText("بيانات السجل"), [FULL_SEARCH_RECORD_CODE_OPTION]);
    for (const category of allCategories(state.schema)) {
      appendGroup(displayLabel(category), (category.fields || []).filter((field) => field.type !== "spacer").map((field) => field.id));
    }
    appendGroup(scText("خيارات إضافية"), [...remaining]);
    if (!rendered) {
      const empty = document.createElement("span");
      empty.className = "selection-chip selection-chip-empty";
      empty.textContent = emptyText;
      container.append(empty);
    }
  };
  const filterIds = activeFullSearchOptionIds("filter");
  if (elements.fullSearchIncludeArchived?.checked) filterIds.push("__include_archived__");
  const originalOptionLabel = optionLabel;
  const archiveAwareLabel = (optionId) => optionId === "__include_archived__" ? scText("إظهار المؤرشف") : originalOptionLabel(optionId);
  const renderArchiveAware = (container, optionIds, emptyText) => {
    if (!container) return;
    container.replaceChildren();
    const labels = optionIds.map(archiveAwareLabel).filter(Boolean);
    if (!labels.length) {
      const empty = document.createElement("span");
      empty.className = "selection-chip selection-chip-empty";
      empty.textContent = emptyText;
      container.append(empty);
      return;
    }
    optionIds.forEach((optionId) => {
      const label = archiveAwareLabel(optionId);
      if (!label) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "selection-chip selection-chip-button";
      chip.dataset.removeFullSearchFilter = optionId;
      chip.title = scText("إزالة من حقول المطابقة");
      chip.textContent = label;
      container.append(chip);
    });
  };
  renderArchiveAware(elements.schemaFilterSelectionSummary, filterIds, scText("لا توجد مرشحات"));
  renderLabels(elements.fullSearchOptionsSummary, activeFullSearchOptionIds("column"), scText("لا توجد حقول نتائج"));
}

function removeFullSearchResultField(optionId) {
  if (optionId === FULL_SEARCH_RECORD_CODE_OPTION) {
    state.fullSearchRecordIdColumn = false;
  } else {
    state.fullSearchColumnIds = activeFullSearchColumnIds().filter(
      (fieldId) => fieldId !== optionId,
    );
  }
  updateFullSearchOptionsSummary();
}

function removeFullSearchFilter(optionId) {
  if (optionId === FULL_SEARCH_RECORD_CODE_OPTION) {
    state.fullSearchRecordIdFilter = false;
  } else if (optionId === "__include_archived__") {
    elements.fullSearchIncludeArchived.checked = false;
  } else {
    state.fullSearchFieldIds = activeFullSearchFieldIds().filter(
      (fieldId) => fieldId !== optionId,
    );
    delete state.fixedSearchFilters[optionId];
  }
  renderFullSearchFilters();
}

function renderFullSearchFilters(options = {}) {
  if (!state.schema) {
    return;
  }
  const previousCriteria = options.preserveValues === false
    ? deepClone(options.criteria || {})
    : sharedFilterCriteria(elements.fullSearchFields);
  const selectedIds = activeFullSearchFieldIds();
  const selected = new Set(selectedIds);
  renderSharedFilterControls({
    container: elements.fullSearchFields,
    schema: state.schema,
    fieldIds: [...selected],
    criteria: previousCriteria,
    context: "search",
    schemaId: state.activeSchemaId,
  });
  elements.fullSearchRecordIdField.hidden = !state.fullSearchRecordIdFilter;
  elements.fullSearchSystemFields.hidden =
    !state.fullSearchRecordIdFilter;
  const hasVisibleFilters = Boolean(
    selectedIds.length ||
    state.fullSearchRecordIdFilter,
  );
  elements.fullSearchFieldsEmpty.hidden = hasVisibleFilters;
  updateSchemaSearchFilterScrolling();
  updateFullSearchOptionsSummary();
}

function renderFullSearchOptionGroups(container, selectedIds, optionKind) {
  container.replaceChildren();
  const selected = new Set(selectedIds);
  const appendGroup = (categoryId, categoryLabel, fields) => {
    if (!fields.length) {
      return;
    }
    const group = document.createElement("details");
    group.className = "search-field-option-group tree-option-group";
    group.dataset.fullSearchOptionCategory = categoryId;
    group.dataset.fullSearchOptionKind = optionKind;
    const heading = document.createElement("summary");
    heading.className = "search-field-option-category";
    const headingLabel = document.createElement("label");
    headingLabel.className = "check-field";
    const categoryCheckbox = document.createElement("input");
    categoryCheckbox.type = "checkbox";
    categoryCheckbox.dataset.fullSearchCategoryOption = categoryId;
    categoryCheckbox.dataset.fullSearchOptionKind = optionKind;
    const headingText = document.createElement("span");
    headingText.textContent = categoryLabel;
    headingLabel.append(categoryCheckbox, headingText);
    heading.append(headingLabel);
    const grid = document.createElement("div");
    grid.className = "search-field-option-grid";
    fields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "search-option-row";
      const label = document.createElement("label");
      label.className = "check-field";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute(`data-full-search-${optionKind}-option`, field.id);
      checkbox.checked = selected.has(field.id);
      const text = document.createElement("span");
      text.textContent = displayLabel(field);
      label.append(checkbox, text);
      row.append(label);
      grid.append(row);
    });
    group.append(heading, grid);
    container.append(group);
    syncFullSearchCategoryToggle(group);
  };

  appendGroup("system", scText("بيانات السجل"), [
    { id: FULL_SEARCH_RECORD_CODE_OPTION, label: "ID" },
  ]);
  for (const category of allCategories(state.schema)) {
    const fields = category.fields.filter((field) => !["file", "spacer"].includes(field.type));
    appendGroup(category.id, displayLabel(category), fields);
  }
}

function syncFullSearchCategoryToggle(group) {
  const optionKind = group.dataset.fullSearchOptionKind;
  const master = group.querySelector("[data-full-search-category-option]");
  const fields = [
    ...group.querySelectorAll(`[data-full-search-${optionKind}-option]`),
  ];
  if (!master || !fields.length) {
    return;
  }
  const selected = fields.filter((field) => field.checked).length;
  master.checked = selected === fields.length;
  master.indeterminate = selected > 0 && selected < fields.length;
}

function handleFullSearchOptionChange(event) {
  const globalMaster = event.target.closest("[data-global-category-option]");
  if (globalMaster) {
    const group = globalMaster.closest("[data-global-option-category]");
    group?.querySelectorAll('.search-field-option-grid input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = globalMaster.checked;
    });
    globalMaster.indeterminate = false;
    return;
  }
  const globalGroup = event.target.closest("[data-global-option-category]");
  if (globalGroup) {
    const master = globalGroup.querySelector("[data-global-category-option]");
    const fields = [...globalGroup.querySelectorAll('.search-field-option-grid input[type="checkbox"]')];
    const selected = fields.filter((field) => field.checked).length;
    master.checked = selected === fields.length;
    master.indeterminate = selected > 0 && selected < fields.length;
    return;
  }
  const master = event.target.closest("[data-full-search-category-option]");
  if (master) {
    const group = master.closest("[data-full-search-option-category]");
    const optionKind = group.dataset.fullSearchOptionKind;
    group
      .querySelectorAll(`[data-full-search-${optionKind}-option]`)
      .forEach((checkbox) => {
        checkbox.checked = master.checked;
      });
    master.indeterminate = false;
    return;
  }
  const group = event.target.closest("[data-full-search-option-category]");
  if (group) {
    syncFullSearchCategoryToggle(group);
  }
}

function renderFullSearchOptions() {
  renderFullSearchOptionGroups(
    elements.fullSearchFilterOptions,
    activeFullSearchOptionIds("filter"),
    "filter",
  );
  renderFullSearchOptionGroups(
    elements.fullSearchColumnOptions,
    activeFullSearchOptionIds("column"),
    "column",
  );
}

function openFullSearchFilterDialog() {
  if (state.searchType === "global") {
    elements.searchFilterDialogTitle.textContent = scText("حقول المطابقة في البحث العام");
    renderGlobalSchemaFieldSettings("filter");
  } else {
    elements.searchFilterDialogTitle.textContent = scText("مرشحات البحث داخل التصميم");
    renderFullSearchOptionGroups(
      elements.fullSearchFilterOptions,
      activeFullSearchOptionIds("filter"),
      "filter",
    );
  }
  elements.fullSearchFilterDialog.showModal();
}

function openFullSearchFieldsDialog() {
  if (state.searchType === "global") {
    elements.searchFieldsDialogTitle.textContent = scText("حقول نتائج البحث العام");
    renderGlobalSchemaFieldSettings("column");
  } else {
    elements.searchFieldsDialogTitle.textContent = scText("حقول نتائج البحث داخل التصميم");
    renderFullSearchOptionGroups(
      elements.fullSearchColumnOptions,
      activeFullSearchOptionIds("column"),
      "column",
    );
  }
  elements.fullSearchFieldsDialog.showModal();
}

function fullSearchOptionSelection(container, optionKind) {
  return [
    ...container.querySelectorAll(
      `[data-full-search-${optionKind}-option]:checked`,
    ),
  ].map((checkbox) =>
    checkbox.getAttribute(`data-full-search-${optionKind}-option`),
  );
}

function resetFullSearchFilters() {
  if (state.searchType === "global") {
    renderGlobalSchemaFieldSettings("filter", { reset: true });
    return;
  }
  renderFullSearchOptionGroups(elements.fullSearchFilterOptions, defaultFullSearchOptionIds("filter"), "filter");
}

function resetFullSearchFields() {
  if (state.searchType === "global") {
    renderGlobalSchemaFieldSettings("column", { reset: true });
    return;
  }
  renderFullSearchOptionGroups(elements.fullSearchColumnOptions, defaultFullSearchOptionIds("column"), "column");
}

function applyFullSearchFilters() {
  if (state.searchType === "global") {
    applyGeneralSearchSettings("filter");
    elements.fullSearchFilterDialog.close();
    return;
  }
  const filterOptions = fullSearchOptionSelection(
    elements.fullSearchFilterOptions,
    "filter",
  );
  state.fullSearchRecordIdFilter = filterOptions.includes(
    FULL_SEARCH_RECORD_CODE_OPTION,
  );
  const filters = filterOptions.filter(
    (fieldId) => fieldId !== FULL_SEARCH_RECORD_CODE_OPTION,
  );
  state.fixedSearchFilters = {};
  state.fullSearchFilterModes = Object.fromEntries(filters.map((fieldId) => [fieldId, { mode: "free", value: "" }]));
  state.fullSearchFieldIds = sameFieldSelection(
    filters,
    defaultFullSearchFieldIds(),
  ) ? null : filters;
  renderFullSearchFilters();
  elements.fullSearchFilterDialog.close();
}

function applyFullSearchFields() {
  if (state.searchType === "global") {
    applyGeneralSearchSettings("column");
    elements.fullSearchFieldsDialog.close();
    return;
  }
  const columnOptions = fullSearchOptionSelection(elements.fullSearchColumnOptions, "column");
  state.fullSearchRecordIdColumn = columnOptions.includes(FULL_SEARCH_RECORD_CODE_OPTION);
  const columns = columnOptions.filter((fieldId) => fieldId !== FULL_SEARCH_RECORD_CODE_OPTION);
  state.fullSearchColumnIds = sameFieldSelection(columns, defaultFullSearchColumnIds()) ? null : columns;
  updateFullSearchOptionsSummary();
  elements.fullSearchFieldsDialog.close();
}

function setFullSearchOptionGroup(target, checked) {
  const container = target === "columns"
    ? elements.fullSearchColumnOptions
    : elements.fullSearchFilterOptions;
  container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = checked;
    checkbox.indeterminate = false;
  });
}

function fullSearchValues() {
  const fieldCriteria = sharedFilterCriteria(elements.fullSearchFields);
  const criteria = {
    _allow_empty: true,
    _record_code: state.fullSearchRecordIdFilter
      ? elements.fullSearchRecordId.value.trim()
      : "",
    _include_archived: elements.fullSearchIncludeArchived.checked,
    _search_field_ids: [...new Set([...activeFullSearchFieldIds(), ...Object.keys(state.fixedSearchFilters || {})])],
    _result_field_ids: activeFullSearchColumnIds(),
  };
  Object.assign(criteria, fieldCriteria);
  Object.assign(criteria, deepClone(state.fixedSearchFilters || {}));
  return criteria;
}

function fullSearchResultColumns() {
  return activeFullSearchColumnIds()
    .map((fieldId) => fieldById(fieldId, state.schema))
    .filter(Boolean)
    .map((field) => ({ id: field.id, label: field.label }));
}

function renderFullSearchResults() {
  const columns = fullSearchResultColumns();
  const headerRow = document.createElement("tr");
  [
    ...(state.fullSearchRecordIdColumn ? ["ID"] : []),
    scText("السجل"),
    scText("الحالة"),
    ...columns.map((column) => displayLabel(column)),
    scText("الإجراءات"),
  ]
    .forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    });
  elements.fullSearchTableHead.replaceChildren(headerRow);
  elements.fullSearchTableBody.replaceChildren();
  state.fullSearchMatches.forEach((match) => {
    const row = document.createElement("tr");
    const code = document.createElement("td");
    code.textContent = match.record_code;
    code.dir = "ltr";
    const title = document.createElement("td");
    title.textContent = displayRecordTitle(match);
    const status = document.createElement("td");
    status.textContent = match.archived ? scText("مؤرشف") : scText("نشط");
    if (match.archived) {
      const archived = document.createElement("span");
      archived.className = "archived-badge";
      archived.textContent = scText("مؤرشف");
      status.replaceChildren(archived);
    }
    if (state.fullSearchRecordIdColumn) {
      row.append(code);
    }
    row.append(title, status);
    const details = new Map((match.details || []).map((item) => [item.field_id, displayResultValue(item)]));
    columns.forEach((column) => {
      const cell = document.createElement("td");
      cell.textContent = details.get(column.id) ?? "";
      row.append(cell);
    });
    const actions = document.createElement("td");
    actions.className = "record-row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-secondary";
    edit.dataset.editRecord = match.record_code;
    edit.textContent = scText("تعديل");
    const readonly = document.createElement("button");
    readonly.type = "button";
    readonly.className = "button button-quiet";
    readonly.dataset.readonlyRecord = match.record_code;
    readonly.textContent = scText("قراءة فقط");
    actions.append(edit, readonly);
    row.append(actions);
    elements.fullSearchTableBody.append(row);
  });
  if (!state.fullSearchMatches.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3 + columns.length + (state.fullSearchRecordIdColumn ? 1 : 0);
    cell.className = "table-empty";
    cell.textContent = scText("لا توجد نتائج مطابقة.");
    row.append(cell);
    elements.fullSearchTableBody.append(row);
  }
  const pageSize = Number(state.schema?.app?.search_page_size || 50);
  const currentPage = Math.floor(state.fullSearchOffset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(state.fullSearchTotal / pageSize));
  elements.fullSearchSummary.textContent = scText`عدد النتائج: ${state.fullSearchTotal}`;
  if (state.mode === "search") {
    updateHeaderContext("search");
  }
  elements.fullSearchPageLabel.textContent = `${currentPage} / ${pages}`;
  const pagination = elements.fullSearchPrevious.closest(".table-pagination");
  if (pagination) {
    pagination.hidden = pages <= 1;
  }
  elements.fullSearchPrevious.disabled = state.fullSearchOffset <= 0;
  elements.fullSearchNext.disabled =
    state.fullSearchOffset + state.fullSearchMatches.length >= state.fullSearchTotal;
}

function prepareSearchResultsWindow() {
  const popup = window.open(
    "",
    `SchemaCraft-search-results-${Date.now()}`,
    "popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes",
  );
  state.pendingSearchResultsWindow = popup;
  if (popup) {
    popup.document.title = scText("جاري تجهيز نتائج البحث…");
    popup.document.body.textContent = scText("جاري تجهيز نتائج البحث…");
    popup.document.body.dir = "rtl";
  }
  return popup;
}

function failPendingSearchResultsWindow(message) {
  const popup = state.pendingSearchResultsWindow;
  state.pendingSearchResultsWindow = null;
  if (!popup || popup.closed) return;
  popup.document.title = scText("تعذّر البحث");
  popup.document.body.dir = "rtl";
  popup.document.body.textContent = message;
}

function openSearchResultsWindow(title, sourcePanel) {
  const pending = state.pendingSearchResultsWindow;
  state.pendingSearchResultsWindow = null;
  const popup = pending && !pending.closed ? pending : window.open(
    "",
    `SchemaCraft-search-results-${Date.now()}`,
    "popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes",
  );
  if (!popup) {
    showToast(scText("اسمح للنظام بفتح نافذة نتائج البحث."), "error");
    return null;
  }
  const doc = popup.document;
  doc.open();
  doc.write("<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title></title><link rel=\"stylesheet\" href=\"/styles.css\"></head><body class=\"search-results-popup\"></body></html>");
  doc.close();
  doc.title = title;
  const shell = doc.createElement("main");
  shell.className = "search-results-window";
  const container = doc.createElement("section");
  container.className = "search-results-window-container workspace-panel";
  const heading = doc.createElement("div");
  heading.className = "dialog-heading";
  const headingText = doc.createElement("h1");
  headingText.textContent = title;
  const tools = doc.createElement("div");
  tools.className = "builder-actions";
  const print = doc.createElement("button");
  print.type = "button";
  print.className = "button button-secondary";
  print.textContent = scText("طباعة");
  print.addEventListener("click", () => popup.print());
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "button button-primary";
  close.textContent = scText("إغلاق النافذة");
  close.addEventListener("click", () => popup.close());
  tools.append(print, close);
  heading.append(headingText, tools);
  const content = sourcePanel.cloneNode(true);
  content.hidden = false;
  content.removeAttribute("id");
  content.classList.add("search-results-window-content");
  const previousPage = content.querySelector("#full-search-previous");
  const nextPage = content.querySelector("#full-search-next");
  if (previousPage) previousPage.dataset.popupSearchPage = "previous";
  if (nextPage) nextPage.dataset.popupSearchPage = "next";
  content.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  content.addEventListener("click", (event) => {
    const page = event.target.closest("[data-popup-search-page]");
    if (page) {
      const pageSize = Number(state.schema?.app?.search_page_size || 50);
      state.fullSearchOffset = page.dataset.popupSearchPage === "next"
        ? state.fullSearchOffset + pageSize
        : Math.max(0, state.fullSearchOffset - pageSize);
      state.pendingSearchResultsWindow = popup;
      popup.document.body.textContent = scText("جاري تحميل صفحة النتائج…");
      void runFullSearch({ notes: "" });
      return;
    }
    const edit = event.target.closest("[data-edit-record]");
    if (edit) {
      const match = state.fullSearchMatches.find(
        (candidate) => candidate.record_code === edit.dataset.editRecord,
      );
      openRecordForEditing(edit.dataset.editRecord, match?.title || "");
      window.focus();
      return;
    }
    const readonly = event.target.closest("[data-readonly-record]");
    if (readonly) {
      openReadonlyRecord(readonly.dataset.readonlyRecord);
      return;
    }
    const multi = event.target.closest("[data-open-multi-record]");
    if (multi) {
      void switchActiveSchema(multi.dataset.openMultiSchema, {
        mode: "entry",
        openCode: multi.dataset.openMultiRecord,
      });
      window.focus();
      return;
    }
    const multiReadonly = event.target.closest("[data-readonly-multi-record]");
    if (multiReadonly) {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("view", "readonly");
      url.searchParams.set("record", multiReadonly.dataset.readonlyMultiRecord);
      url.searchParams.set("schema_id", multiReadonly.dataset.openMultiSchema);
      window.open(url.toString(), `SchemaCraft-readonly-${Date.now()}`);
    }
  });
  container.append(heading, content);
  shell.append(container);
  doc.body.append(shell);
  popup.focus();
  return popup;
}

async function runFullSearch(options = {}) {
  if (!state.schema || state.fullSearchLoading) {
    return;
  }
  if (options.resetPage && !Object.prototype.hasOwnProperty.call(options, "notes")) {
    const notes = await requestSearchNotes();
    if (notes === null) return;
    return runFullSearch({ ...options, notes });
  }
  if (options.resetPage) {
    state.fullSearchOffset = 0;
  }
  state.fullSearchLoading = true;
  elements.fullSearchSubmitButton.disabled = true;
  elements.fullSearchSummary.textContent = scText("جاري البحث…");
  if (elements.searchLiveLog) elements.searchLiveLog.textContent = scText("يعمل البحث…");
  try {
    const criteria = fullSearchValues();
    state.fullSearchCriteria = deepClone(criteria);
    criteria._offset = state.fullSearchOffset;
    criteria._limit = Number(state.schema.app.search_page_size || 50);
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(criteria),
    });
    const result = await responseJson(response);
    state.fullSearchMatches = Array.isArray(result.matches) ? result.matches : [];
    state.fullSearchTotal = Number(result.total || 0);
    renderFullSearchResults();
    elements.singleSchemaResultsPanel.hidden = false;
    elements.multiSchemaResults.hidden = true;
    openSearchResultsWindow(
      scText`نتائج ${state.schema?.schema_name || scText("البحث")}`,
      elements.singleSchemaResultsPanel,
    );
    if (options.resetPage === true) {
      let historyMatches = deepClone(state.fullSearchMatches);
      if (state.fullSearchTotal > historyMatches.length) {
        try {
          const snapshotCriteria = { ...deepClone(state.fullSearchCriteria), _offset: 0, _limit: Math.min(250, state.fullSearchTotal) };
          const snapshotResponse = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snapshotCriteria),
          });
          const snapshot = await responseJson(snapshotResponse);
          historyMatches = deepClone(snapshot.matches || historyMatches);
        } catch (_error) {
          // The visible search has already succeeded. Keep its current page as
          // a useful history snapshot if the expanded snapshot cannot load.
        }
      }
      rememberSearchHistory({
        mode: "schema",
        name: "",
        notes: options.notes || "",
        schema_id: state.activeSchemaId,
        schema_name: state.schema?.schema_name || "",
        filters: { criteria: deepClone(state.fullSearchCriteria), filter_ids: activeFullSearchFieldIds(), fixed: deepClone(state.fixedSearchFilters), record_id_filter: state.fullSearchRecordIdFilter },
        headers: { column_ids: activeFullSearchColumnIds(), record_id_column: state.fullSearchRecordIdColumn },
        result_total: state.fullSearchTotal,
        results: { matches: historyMatches, total: state.fullSearchTotal },
      });
      renderSearchHistory();
    }
  } catch (error) {
    failPendingSearchResultsWindow(error.message);
    showToast(error.message, "error");
    elements.fullSearchSummary.textContent = error.message;
    if (elements.searchLiveLog) elements.searchLiveLog.textContent = scText`مشكلة مع الخادم: ${error.message}`;
  } finally {
    state.fullSearchLoading = false;
    elements.fullSearchSubmitButton.disabled = false;
    if (elements.searchLiveLog && !elements.searchLiveLog.textContent.startsWith(scText("مشكلة"))) elements.searchLiveLog.textContent = scText`اكتمل البحث: ${state.fullSearchTotal} نتيجة.`;
  }
}

function clearFullSearch() {
  elements.fullSearchRecordId.value = "";
  elements.fullSearchIncludeArchived.checked = false;
  clearSharedFilterValues(elements.fullSearchFields);
  state.fullSearchMatches = [];
  state.fullSearchTotal = 0;
  state.fullSearchCriteria = null;
  renderFullSearchResults();
  updateFullSearchOptionsSummary();
  if (elements.searchLiveLog) elements.searchLiveLog.textContent = scText("مُسحت قيم المرشحات. شغّل البحث عند الجاهزية.");
}

function renderSearchHistory() {
  if (!elements.searchHistoryList) return;
  const historyQuery = elements.searchHistoryQuery?.value.trim().toLocaleLowerCase("ar") || "";
  const matchingEntries = readRecentSearches().filter((item) => {
    if (!historyQuery) return true;
    return [item.name, item.notes, item.user_name, displaySchemaName(item), item.created_at, historyDate(item.created_at)]
      .join(" ").toLocaleLowerCase("ar").includes(historyQuery);
  });
  const configuredLimit = state.workspaceSettings?.search_history_limit || 20;
  const entries = configuredLimit === "all"
    ? matchingEntries
    : matchingEntries.slice(0, Number(configuredLimit) || 20);
  if (!entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "table-empty";
    cell.textContent = scText("لا توجد عمليات بحث سابقة.");
    row.append(cell);
    elements.searchHistoryList.replaceChildren(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  entries.forEach((item) => {
    const row = document.createElement("tr");
    row.className = "search-history-record";
    row.dataset.searchHistoryId = item.id;
    [
      historyDate(item.created_at),
      item.user_name || "—",
      displaySchemaName(item) || (item.mode === "global" ? scText("بحث عام") : "—"),
      item.notes || "—",
      String(item.result_total ?? item.results?.total ?? item.results?.results?.reduce((sum, result) => sum + Number(result.total || 0), 0) ?? "—"),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    prepareHistoryRow(row, "search", item.id);
    fragment.append(row);
  });
  elements.searchHistoryList.replaceChildren(fragment);
}

function startNewSearchOperation() {
  state.searchType = "schema";
  state.fullSearchFieldIds = null;
  state.fullSearchColumnIds = null;
  state.fixedSearchFilters = {};
  state.fullSearchFilterModes = {};
  state.fullSearchRecordIdFilter = true;
  state.fullSearchRecordIdColumn = true;
  state.fullSearchMatches = [];
  state.fullSearchTotal = 0;
  state.fullSearchOffset = 0;
  if (elements.searchResultsDialog?.open) elements.searchResultsDialog.close();
  if (elements.searchOperationName) elements.searchOperationName.value = "";
  if (elements.searchOperationNotes) elements.searchOperationNotes.value = "";
  elements.fullSearchIncludeArchived.checked = false;
  renderFullSearchFilters({ preserveValues: false });
  renderFullSearchResults();
  syncGeneralSearchMode();
  elements.searchLiveLog.textContent = scText("بحث جديد جاهز.");
}

function requestSearchNotes() {
  return new Promise((resolve) => {
    const dialog = elements.searchNotesDialog;
    elements.searchNotesInput.value = "";
    const finish = (value) => {
      elements.confirmSearchNotes.removeEventListener("click", confirm);
      elements.cancelSearchNotes.removeEventListener("click", cancel);
      elements.cancelSearchNotesX.removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancelEvent);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const confirm = () => {
      prepareSearchResultsWindow();
      finish(elements.searchNotesInput.value.trim());
    };
    const cancel = () => finish(null);
    const cancelEvent = (event) => { event.preventDefault(); finish(null); };
    elements.confirmSearchNotes.addEventListener("click", confirm);
    elements.cancelSearchNotes.addEventListener("click", cancel);
    elements.cancelSearchNotesX.addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancelEvent);
    dialog.showModal();
    elements.searchNotesInput.focus();
  });
}

function restoreSingleSchemaSearch(item) {
  const filters = item.filters || item;
  const headers = item.headers || item;
  const restoredFilterIds = [...new Set([...(filters.filter_ids || []), ...Object.keys(filters.fixed || {})])];
  state.fullSearchFieldIds = restoredFilterIds.length ? restoredFilterIds : null;
  state.fixedSearchFilters = {};
  state.fullSearchColumnIds = Array.isArray(headers.column_ids) ? deepClone(headers.column_ids) : null;
  state.fullSearchRecordIdFilter = filters.record_id_filter !== false;
  state.fullSearchRecordIdColumn = headers.record_id_column !== false;
  const criteria = filters.criteria || item.criteria || {};
  renderFullSearchFilters({ preserveValues: false, criteria });
  elements.fullSearchRecordId.value = criteria._record_code || "";
  elements.fullSearchIncludeArchived.checked = Boolean(criteria._include_archived);
}

function importSearchHistoryPart(itemId, part) {
  const item = readRecentSearches().find((entry) => entry.id === itemId);
  if (!item) return;
  if (item.mode === "global") {
    if (part === "filters") {
      elements.globalSearchQuery.value = item.query || "";
      const schemaSet = new Set(item.schema_ids || []);
      activeWorkspaceSchemas().forEach((schema) => { globalQueryConfig(schema.id).selected = schemaSet.has(schema.id); });
      (item.filters?.schemas || []).forEach((saved) => { globalQueryConfig(saved.schema_id).searchFieldIds = deepClone(saved.search_field_ids || []); });
      elements.fullSearchIncludeArchived.checked = (item.filters?.schemas || []).some((saved) => saved.include_archived);
    } else {
      Object.entries(item.headers || {}).forEach(([schemaId, ids]) => { globalQueryConfig(schemaId).displayFieldIds = deepClone(ids || []); });
    }
    state.searchType = "global";
    renderMultiSchemaSearch();
    return;
  }
  const apply = () => {
    if (part === "filters") {
      const filters = item.filters || {};
      state.fullSearchFieldIds = [...new Set([...(filters.filter_ids || []), ...Object.keys(filters.fixed || {})])];
      state.fixedSearchFilters = {};
      state.fullSearchRecordIdFilter = filters.record_id_filter !== false;
      const criteria = filters.criteria || {};
      renderFullSearchFilters({ preserveValues: false, criteria });
      elements.fullSearchRecordId.value = criteria._record_code || "";
      elements.fullSearchIncludeArchived.checked = Boolean(criteria._include_archived);
    } else {
      state.fullSearchColumnIds = deepClone(item.headers?.column_ids || []);
      state.fullSearchRecordIdColumn = item.headers?.record_id_column !== false;
      updateFullSearchOptionsSummary();
    }
  };
  if (item.schema_id && item.schema_id !== state.activeSchemaId) void switchActiveSchema(item.schema_id, { mode: "search" }).then((ok) => { if (ok) apply(); });
  else apply();
}

function viewSearchHistoryResults(itemId) {
  const item = readRecentSearches().find((entry) => entry.id === itemId);
  if (!item?.results) {
    showToast(scText("لا تحتوي هذه العملية القديمة على نسخة محفوظة من النتائج."), "error");
    return;
  }
  prepareSearchResultsWindow();
  if (item.mode === "global") {
    const resultItems = Array.isArray(item.results.results) ? item.results.results : [];
    state.multiSearchResults = new Map(resultItems.map((result) => [result.schema_id, deepClone(result)]));
    renderMultiResults();
    elements.singleSchemaResultsPanel.hidden = true;
    elements.multiSchemaResults.hidden = false;
    openSearchResultsWindow(scText("نتائج محفوظة من البحث العام"), elements.multiSchemaResults);
    return;
  }
  const show = () => {
    state.fullSearchMatches = deepClone(item.results.matches || []);
    const originalTotal = Number(item.results.total || item.result_total || state.fullSearchMatches.length);
    state.fullSearchTotal = state.fullSearchMatches.length;
    state.fullSearchOffset = 0;
    state.fullSearchColumnIds = deepClone(item.headers?.column_ids || []);
    state.fullSearchRecordIdColumn = item.headers?.record_id_column !== false;
    renderFullSearchResults();
    elements.singleSchemaResultsPanel.hidden = false;
    elements.multiSchemaResults.hidden = true;
    openSearchResultsWindow(
      scText`نتائج محفوظة — ${item.schema_name || scText("البحث")} (${originalTotal})`,
      elements.singleSchemaResultsPanel,
    );
  };
  if (item.schema_id && item.schema_id !== state.activeSchemaId) {
    void switchActiveSchema(item.schema_id, { mode: "search" }).then((ok) => { if (ok) show(); });
  } else {
    show();
  }
}

async function removeSearchHistoryItem(itemId) {
  if (!(await requestConfirmation(scText("حذف عملية البحث من السجل؟"), {
    title: scText("حذف عملية بحث"),
    confirmLabel: scText("حذف العملية"),
  }))) return;
  try {
    const response = await fetch(`/api/search/history/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    await responseJson(response);
    state.searchHistoryEntries = state.searchHistoryEntries.filter((item) => item.id !== itemId);
    try { localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY); } catch (_error) { /* remove legacy cache */ }
    renderSearchHistory();
    renderRecentSearches();
  } catch (error) { showToast(error.message, "error"); }
}

function applySearchHistoryItem(itemId) {
  const item = readRecentSearches().find((entry) => entry.id === itemId);
  if (!item) return;
  const apply = () => {
    performSwitchMode("search");
    if (item.mode === "schema") restoreSingleSchemaSearch(item);
    else if (typeof restoreMultiSchemaSearchHistory === "function") restoreMultiSchemaSearchHistory(item);
  };
  if (item.mode === "schema" && item.schema_id && item.schema_id !== state.activeSchemaId) {
    void switchActiveSchema(item.schema_id, { mode: "search" }).then((ok) => { if (ok) apply(); });
  } else apply();
}

function openRecordForEditing(code, title = "") {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{7}$/.test(normalized)) {
    showToast(scText("أدخل ID صالحًا من 8 أحرف."), "error");
    return;
  }
  const open = () => {
    if (elements.searchResultsDialog?.open) elements.searchResultsDialog.close();
    state.pageSchemaIds.entry = state.activeSchemaId;
    performSwitchMode("entry");
    void performLoadRecord(normalized, {
      skipNavigationGuard: true,
      title,
    });
  };
  if (state.recordDirty) {
    queueRecordNavigation(open);
  } else {
    open();
  }
}

function openReadonlyRecord(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("view", "readonly");
  url.searchParams.set("record", code);
  if (state.activeSchemaId) {
    url.searchParams.set("schema_id", state.activeSchemaId);
  }
  window.open(url.toString(), `SchemaCraft-readonly-${code}-${Date.now()}`);
}

function readonlyDisplayValue(field, value) {
  if (field.type === "checkbox") {
    return checkboxDisplayMeaning(field, value);
  }
  if (field.type === "checkbox_group") {
    return displayFieldValue(field, value);
  }
  if (field.type === "file") {
    return storedFilename(value);
  }
  if (field.type === "number") {
    return workspace.formatNumber(value, field);
  }
  return displayFieldValue(field, value);
}

function readonlyValueIsEmpty(field, value) {
  if (value == null) {
    return true;
  }
  if (Array.isArray(value)) {
    return !value.some((item) => String(item ?? "").trim() !== "");
  }
  if (field.type === "file") {
    return storedFilename(value).trim() === "";
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
}

function renderReadonlyRecord(record) {
  elements.readonlyTitle.textContent = `${entityName()} ${record.record_code}`;
  elements.readonlyContent.replaceChildren();
  for (const category of state.schema.categories) {
    const rows = category.kind === "main"
      ? [{
          values: record.main || {},
        }]
      : record.related?.[category.id] || [];
    const visibleRows = rows
      .map((row) => {
        const fields = category.fields.filter((field) => {
          if (isSystemField(field) || field.type === "spacer") {
            return false;
          }
          return !readonlyValueIsEmpty(field, row.values?.[field.id]);
        });
        return { row, fields };
      })
      .filter(({ fields }) => fields.length);
    if (!visibleRows.length) {
      continue;
    }
    const section = document.createElement("section");
    section.className = "readonly-section workspace-panel";
    section.dataset.readonlyCategory = category.id;
    section.dataset.categoryId = category.id;
    section.id = `readonly-category-${category.id}`;
    section.tabIndex = -1;
    const heading = document.createElement("h3");
    heading.textContent = displayLabel(category);
    section.append(heading);
    visibleRows.forEach(({ row, fields }, index) => {
      const card = document.createElement("div");
      card.className = "readonly-card";
      if (category.kind === "repeatable") {
        card.classList.add("readonly-card-repeatable");
        const cardTitle = document.createElement("strong");
        const titleField = fieldById(category.card_title_field_id, state.schema);
        const customTitle = titleField
          ? readonlyDisplayValue(titleField, row.values?.[titleField.id]).trim()
          : "";
        cardTitle.textContent = customTitle || `${displayLabel(category, "card_name_prefix") || displayLabel(category)} ${index + 1}`;
        card.append(cardTitle);
      } else {
        card.classList.add("readonly-card-main");
      }
      if (fields.length) {
        const grid = document.createElement("dl");
        grid.className = "readonly-field-grid";
        fields.forEach((field) => {
          const item = document.createElement("div");
          const legacyWidths = { normal: "1", wide: "4", long: "4" };
          const width = legacyWidths[field.width] || field.width || "1";
          item.className = `readonly-field readonly-width-${width}`;
          applyFieldLineStart(item, field, width);
          item.dataset.fieldId = field.id;
          const term = document.createElement("dt");
          term.textContent = displayLabel(field);
          const description = document.createElement("dd");
          const value = row.values?.[field.id];
          if (field.type === "file" && value) {
            const link = document.createElement("a");
            link.href = isImageAttachment(value)
              ? attachmentViewerUrl(value)
              : attachmentApiUrl(value);
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = storedFilename(value);
            description.append(link);
          } else {
            description.textContent = readonlyDisplayValue(field, value);
          }
          item.append(term, description);
          grid.append(item);
        });
        card.append(grid);
      }
      section.append(card);
    });
    elements.readonlyContent.append(section);
  }
  if (!elements.readonlyContent.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "readonly-report-empty";
    empty.textContent = scText("لا يحتوي هذا السجل على بيانات معروضة.");
    elements.readonlyContent.append(empty);
  }
  refreshCategoryNavigation();
}

async function loadReadonlyRecord(code) {
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    const record = await responseJson(response);
    renderReadonlyRecord(record);
    document.title = `${record.record_code} — ${state.schema.app.title}`;
  } catch (error) {
    elements.readonlyContent.textContent = error.message;
    showToast(error.message, "error");
  }
}
