function renderExchangePage() {
  if (!state.schema || !builderUnlocked()) return;
  [elements.importTargetSchema, elements.exportTableSchema, elements.exportPortableSchema].forEach(fillExchangeSchemaSelect);
  const selectedSchemaId = elements.exportTableSchema?.value || elements.exportPortableSchema?.value;
  if (selectedSchemaId) {
    elements.exportTableSchema.value = selectedSchemaId;
    elements.exportPortableSchema.value = selectedSchemaId;
  }
  renderExchangeTopTabs();
  renderExportFields();
  renderExportFilters();
  renderExportFilterValues();
  renderExportLocations();
  if (state.mode === "export") void loadExportHistory();
  if (state.mode === "import") void loadImportHistory();
}

function exchangeSchemaChoices() {
  const schemas = activeWorkspaceSchemas();
  if (!schemas.length && state.schema) {
    schemas.push({ id: state.activeSchemaId || "legacy", name: state.schema.schema_name || state.schema.app?.entity_plural || "التصميم الحالي" });
  }
  return schemas;
}

function renderExchangeTopTabs() {
  const schemas = exchangeSchemaChoices();
  if (elements.importSchemaTabs) {
    elements.importSchemaTabs.replaceChildren();
    schemas.forEach((schema) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `schema-tab${schema.id === elements.importTargetSchema.value ? " is-active" : ""}`;
      button.dataset.importSchemaTab = schema.id;
      button.textContent = schema.name;
      elements.importSchemaTabs.append(button);
    });
  }
  if (elements.exportScopeTabs) {
    elements.exportScopeTabs.replaceChildren();
    const profileButton = document.createElement("button");
    profileButton.type = "button";
    profileButton.className = `schema-tab schema-tab-global${state.exportMode === "profile" ? " is-active" : ""}`;
    profileButton.dataset.exportProfileTab = "true";
    profileButton.textContent = "تقرير شخص PDF";
    const divider = document.createElement("span");
    divider.className = "schema-tab-divider";
    divider.setAttribute("aria-hidden", "true");
    elements.exportScopeTabs.append(profileButton, divider);
    schemas.forEach((schema) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `schema-tab${state.exportMode !== "profile" && schema.id === elements.exportTableSchema.value ? " is-active" : ""}`;
      button.dataset.exportSchemaTab = schema.id;
      button.textContent = schema.name;
      elements.exportScopeTabs.append(button);
    });
  }
  enhancePageSchemaTabs(elements.importSchemaTabs);
  enhancePageSchemaTabs(elements.exportScopeTabs);
  syncExportWorkflowView();
}

function selectedExchangeSchemaName() {
  return exchangeSchemaChoices().find((schema) => schema.id === elements.exportTableSchema?.value)?.name || "التصميم المختار";
}

function syncExportWorkflowView() {
  const mode = state.exportMode || "profile";
  document.querySelectorAll("[data-export-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.exportMode === mode));
  document.querySelectorAll("[data-export-panel]").forEach((panel) => { panel.hidden = panel.dataset.exportPanel !== mode; });
  if (elements.schemaExportModeSelector) elements.schemaExportModeSelector.hidden = mode === "profile";
  document.querySelectorAll("[data-export-rail-action]").forEach((button) => { button.hidden = button.dataset.exportRailAction !== mode; });
  const schemaName = selectedExchangeSchemaName();
  if (elements.tableExportSchemaLabel) elements.tableExportSchemaLabel.textContent = `التصميم: ${schemaName}`;
  if (elements.portableExportSchemaLabel) elements.portableExportSchemaLabel.textContent = `التصميم: ${schemaName}`;
}

function selectExportSchema(schemaId) {
  if (!schemaId) return;
  const changed = elements.exportTableSchema.value !== schemaId;
  elements.exportTableSchema.value = schemaId;
  elements.exportPortableSchema.value = schemaId;
  if (changed) {
    state.exportFilterIds = [];
    state.exportDestinations.table = "";
    state.exportDestinations.portable = "";
    renderExportFields();
    renderExportFilters();
    renderExportFilterValues();
    renderExportLocations();
  }
  if (state.exportMode === "profile") state.exportMode = "table";
  renderExchangeTopTabs();
}

function fillExchangeSchemaSelect(select) {
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  const schemas = exchangeSchemaChoices();
  schemas.forEach((schema) => select.append(new Option(schema.name, schema.id)));
  select.value = schemas.some((schema) => schema.id === previous) ? previous : (schemas.some((schema) => schema.id === state.activeSchemaId) ? state.activeSchemaId : schemas[0]?.id || "");
  const toggles = document.querySelector(`[data-schema-toggle-for="${CSS.escape(select.id)}"]`);
  if (toggles) {
    toggles.replaceChildren();
    schemas.forEach((schema) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `schema-tab${schema.id === select.value ? " is-active" : ""}`;
      button.textContent = schema.name;
      button.addEventListener("click", () => {
        select.value = schema.id;
        toggles.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      toggles.append(button);
    });
  }
}

function exchangeSchema(schemaId) {
  return state.workspaceDefinitions?.[schemaId] || (schemaId === state.activeSchemaId ? state.schema : null);
}

function selectedExportSchemaId(kind = "table") {
  return kind === "portable" ? elements.exportPortableSchema?.value : elements.exportTableSchema?.value;
}

function exchangeHeaders(schemaId) {
  return { "Content-Type": "application/json", "X-Schema-ID": schemaId || state.activeSchemaId };
}

function renderExportFields(options = {}) {
  elements.exportFieldList.replaceChildren();
  const schema = exchangeSchema(selectedExportSchemaId()) || state.schema;
  const selected = new Set(options.fresh ? [] : (state.exportFieldIds || []));
  for (const category of schema.categories) {
    const fields = category.fields.filter((field) => !["file", "spacer"].includes(field.type) && !isSystemField(field));
    if (!fields.length) continue;
    const group = document.createElement("details");
    group.className = "tree-option-group export-field-group";
    group.open = false;
    const summary = document.createElement("summary");
    const categoryToggle = document.createElement("label");
    categoryToggle.className = "check-field export-category-toggle";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.checked = false;
    master.dataset.exportCategory = category.id;
    categoryToggle.append(master, document.createTextNode(category.label));
    summary.append(categoryToggle);
    const grid = document.createElement("div");
    grid.className = "export-category-fields";
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = "check-field";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(field.id);
      checkbox.dataset.exportField = field.id;
      checkbox.dataset.exportCategoryField = category.id;
      label.append(checkbox, document.createTextNode(field.label));
      grid.append(label);
    });
    group.append(summary, grid);
    elements.exportFieldList.append(group);
    syncExportCategoryToggle(group);
  }
  renderExportSelectionSummaries();
}

function renderExportFilters(options = {}) {
  elements.exportFilterBuilder.replaceChildren();
  const schema = exchangeSchema(selectedExportSchemaId()) || state.schema;
  const selected = new Set(options.fresh ? [] : (state.exportFilterIds || []));
  (schema.categories || []).forEach((category) => {
    const fields = (category.fields || []).filter((field) => !["file", "spacer"].includes(field.type) && !isSystemField(field));
    if (!fields.length) return;
    const group = document.createElement("details");
    group.className = "tree-option-group";
    const summary = document.createElement("summary");
    const categoryLabel = document.createElement("label");
    categoryLabel.className = "check-field";
    const categoryToggle = document.createElement("input");
    categoryToggle.type = "checkbox";
    categoryToggle.dataset.exportFilterCategory = category.id;
    const categoryText = document.createElement("span");
    categoryText.textContent = category.label;
    categoryLabel.append(categoryToggle, categoryText);
    summary.append(categoryLabel);
    const list = document.createElement("div");
    list.className = "search-field-option-grid";
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = "check-field";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(field.id);
      input.dataset.exportFilterOption = field.id;
      label.append(input, document.createTextNode(field.label));
      list.append(label);
    });
    group.append(summary, list);
    elements.exportFilterBuilder.append(group);
    syncExportFilterCategoryToggle(group);
  });
}

function syncExportFilterCategoryToggle(group) {
  const master = group.querySelector("[data-export-filter-category]");
  const fields = [...group.querySelectorAll("[data-export-filter-option]")];
  if (!master || !fields.length) return;
  const selected = fields.filter((field) => field.checked).length;
  master.checked = selected === fields.length;
  master.indeterminate = selected > 0 && selected < fields.length;
}

function handleExportFilterSelection(event) {
  const master = event.target.closest("[data-export-filter-category]");
  if (master) {
    master.closest("details").querySelectorAll("[data-export-filter-option]").forEach((field) => { field.checked = master.checked; });
    master.indeterminate = false;
    return;
  }
  const field = event.target.closest("[data-export-filter-option]");
  if (field) syncExportFilterCategoryToggle(field.closest("details"));
}

function renderExportFilterValues(restoredCriteria = null) {
  if (!elements.exportFilterValues) return;
  const schema = exchangeSchema(selectedExportSchemaId()) || state.schema;
  const criteria = restoredCriteria || sharedFilterCriteria(elements.exportFilterValues);
  renderSharedFilterControls({
    container: elements.exportFilterValues,
    schema,
    fieldIds: state.exportFilterIds || [],
    criteria,
    context: "export",
    schemaId: selectedExportSchemaId(),
  });
}

function renderExportSelectionSummaries() {
  const schema = exchangeSchema(selectedExportSchemaId()) || state.schema;
  const render = (container, labels, emptyText) => {
    if (!container) return;
    container.replaceChildren();
    if (!labels.length) {
      const empty = document.createElement("span");
      empty.className = "selection-chip selection-chip-empty";
      empty.textContent = emptyText;
      container.append(empty);
      return;
    }
    labels.forEach((labelText) => {
      const chip = document.createElement("span");
      chip.className = "selection-chip";
      chip.textContent = labelText;
      container.append(chip);
    });
  };
  elements.exportSelectedFieldSummary.replaceChildren();
  let selectedFieldCount = 0;
  (schema.categories || []).forEach((category) => {
    const fields = (category.fields || []).filter(
      (field) => (state.exportFieldIds || []).includes(field.id),
    );
    if (!fields.length) return;
    selectedFieldCount += fields.length;
    const group = document.createElement("section");
    group.className = "selection-category-group";
    const title = document.createElement("strong");
    title.textContent = category.label;
    const chips = document.createElement("div");
    chips.className = "selection-chip-list";
    fields.forEach((field) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "selection-chip selection-chip-button";
      chip.dataset.removeExportResultField = field.id;
      chip.title = "إزالة من حقول النتائج";
      chip.textContent = field.label;
      chips.append(chip);
    });
    group.append(title, chips);
    elements.exportSelectedFieldSummary.append(group);
  });
  if (!selectedFieldCount) render(elements.exportSelectedFieldSummary, [], "لا توجد حقول");
}

function applyExportFilters() {
  state.exportFilterIds = [...elements.exportFilterBuilder.querySelectorAll("[data-export-filter-option]:checked")].map((input) => input.dataset.exportFilterOption);
  renderExportFilterValues();
  renderExportSelectionSummaries();
  elements.exportFilterDialog.close();
}

function applyExportFields() {
  state.exportFieldIds = [...elements.exportFieldList.querySelectorAll("[data-export-field]:checked")].map((input) => input.dataset.exportField);
  renderExportSelectionSummaries();
  elements.exportFieldsDialog.close();
}

function exportCriteria() {
  return {
    _allow_empty: true,
    _include_archived: false,
    _search_field_ids: [...(state.exportFilterIds || [])],
    ...sharedFilterCriteria(elements.exportFilterValues),
  };
}

function syncExportCategoryToggle(group) {
  const master = group.querySelector("[data-export-category]");
  const fields = [...group.querySelectorAll("[data-export-field]")];
  const selected = fields.filter((checkbox) => checkbox.checked).length;
  master.checked = selected === fields.length;
  master.indeterminate = selected > 0 && selected < fields.length;
}

function handleExportFieldSelection(event) {
  const category = event.target.closest("[data-export-category]");
  if (category) {
    category.closest(".export-field-group").querySelectorAll("[data-export-field]").forEach((checkbox) => { checkbox.checked = category.checked; });
    category.indeterminate = false;
    return;
  }
  const field = event.target.closest("[data-export-field]");
  if (field) syncExportCategoryToggle(field.closest(".export-field-group"));
}

function setAllExportCategories(checked) {
  elements.exportFieldList.querySelectorAll("[data-export-category], [data-export-field]").forEach((checkbox) => {
    checkbox.checked = checked;
    checkbox.indeterminate = false;
  });
}

function renderExportLocations() {
  const render = (element, value) => {
    if (!element) return;
    element.textContent = value || "لم يُحدّد مكان بعد.";
    element.dir = value ? "ltr" : "rtl";
  };
  render(elements.profileExportLocation, state.exportDestinations.profile);
  render(elements.tableExportLocation, state.exportDestinations.table);
  render(elements.portableExportLocation, state.exportDestinations.portable);
}

async function chooseExportDestination(kind) {
  if (kind === "profile" && !profileExportInputMatchesInspection()) return showToast("افحص قائمة IDs الحالية أولًا.", "error");
  const exportType = kind === "profile" ? profilePdfExportType() : kind === "portable" ? "portable_zip" : "table";
  const statusElement = kind === "profile" ? elements.profileExportStatus : kind === "portable" ? elements.portableExportStatus : elements.exportStatus;
  statusElement.textContent = "جاري فتح نافذة اختيار مكان الحفظ…";
  try {
    const response = await fetch("/api/export/destination", {
      method: "POST",
      headers: exchangeHeaders(kind === "profile" ? state.activeSchemaId : selectedExportSchemaId(kind)),
      body: JSON.stringify({ type: exportType, record_code: state.profileExportInspection?.record_code || "", record_codes: state.profileExportInspection?.record_codes || [], schema_id: selectedExportSchemaId(kind), include_attachments: elements.exportIncludeAttachments?.checked === true }),
    });
    const result = await responseJson(response);
    if (result.cancelled) {
      statusElement.textContent = "أُلغي اختيار مكان الحفظ.";
      return;
    }
    state.exportDestinations[kind] = result.destination;
    renderExportLocations();
    statusElement.textContent = "تم تحديد مكان الحفظ. استخدم زر التصدير في اللوحة اليسرى.";
  } catch (error) {
    statusElement.textContent = error.message;
    showToast(error.message, "error");
  }
}

async function saveExportRequest(payload, statusElement) {
  const kind = ["profile_pdf", "profile_pdf_batch"].includes(payload.type) ? "profile" : payload.type === "portable_zip" ? "portable" : "table";
  const destination = state.exportDestinations[kind];
  if (!destination) {
    showToast("اختر مكان الحفظ أولًا من الصفحة.", "error");
    return null;
  }
  statusElement.textContent = "جاري إنشاء الملف في المكان المحدد…";
  const response = await fetch("/api/export/save", {
    method: "POST",
    headers: exchangeHeaders(payload.schema_id),
    body: JSON.stringify({ ...payload, destination, notes: elements.exportNotes?.value || "" }),
  });
  const result = await responseJson(response);
  if (result.cancelled) {
    statusElement.textContent = "أُلغي اختيار مكان الحفظ.";
    return null;
  }
  statusElement.textContent = `تم الحفظ: ${result.filename}`;
  state.exportDestinations[kind] = "";
  renderExportLocations();
  rememberRecentExport(result.filename);
  await loadExportHistory();
  if (elements.exportNotes) elements.exportNotes.value = "";
  if (elements.exportNotesDialogInput) elements.exportNotesDialogInput.value = "";
  return result;
}

function requestExportNotes() {
  return new Promise((resolve) => {
    const dialog = elements.exportNotesDialog;
    elements.exportNotesDialogInput.value = elements.exportNotes.value || "";
    const finish = (value) => {
      elements.confirmExportNotes.removeEventListener("click", confirm);
      elements.cancelExportNotes.removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancelEvent);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const confirm = () => { elements.exportNotes.value = elements.exportNotesDialogInput.value; finish(elements.exportNotes.value); };
    const cancel = () => finish(null);
    const cancelEvent = (event) => { event.preventDefault(); finish(null); };
    elements.confirmExportNotes.addEventListener("click", confirm);
    elements.cancelExportNotes.addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancelEvent);
    dialog.showModal();
    elements.exportNotesDialogInput.focus();
  });
}

async function exportCurrentResults() {
  if (!state.exportDestinations.table) return showToast("اختر مكان حفظ جدول Excel أولًا.", "error");
  const fieldIds = [...(state.exportFieldIds || [])];
  const schema = exchangeSchema(selectedExportSchemaId("table")) || state.schema;
  const repeatableIds = new Set((schema.categories || []).filter((category) => category.kind === "repeatable").map((category) => category.id));
  const relatedCategoryIds = (schema.categories || []).filter((category) => repeatableIds.has(category.id) && (category.fields || []).some((field) => fieldIds.includes(field.id))).map((category) => category.id);
  if (!fieldIds.length) return showToast("اختر حقلًا واحدًا على الأقل.", "error");
  if (await requestExportNotes() === null) return;
  elements.exportButton.disabled = true;
  try {
    const result = await saveExportRequest({ type: "table", schema_id: selectedExportSchemaId("table"), criteria: exportCriteria(), field_ids: fieldIds, include_related: elements.exportIncludeRelated.checked, related_category_ids: relatedCategoryIds, include_attachments: elements.exportIncludeAttachments.checked }, elements.exportStatus);
    if (result) showToast("تم تصدير جدول Excel القابل للاستيراد.");
  } catch (error) {
    elements.exportStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.exportButton.disabled = false;
  }
}

function appendProfileExportFieldCategory(container, { title, schemaId = "", schemaName = "", fields, global = false }) {
  if (!fields.length) return;
  const group = document.createElement("details");
  group.className = "tree-option-group profile-export-field-category";
  group.open = false;
  const summary = document.createElement("summary");
  const categoryLabel = document.createElement("label");
  categoryLabel.className = "check-field";
  const master = document.createElement("input");
  master.type = "checkbox";
  master.checked = false;
  master.dataset.profileExportCategoryOption = `${schemaId}:${title}`;
  categoryLabel.append(master, document.createTextNode(title));
  summary.append(categoryLabel);
  const list = document.createElement("div");
  list.className = "search-field-option-grid";
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = false;
    if (global) input.dataset.profileExportGlobalChoice = field.global_ref;
    else {
      input.dataset.profileExportField = field.field_id;
      input.dataset.profileExportFieldSchema = schemaId;
    }
    input.dataset.profileExportFieldLabel = field.label;
    input.dataset.profileExportFieldCategory = title;
    input.dataset.profileExportSchemaName = schemaName || "مشترك";
    label.append(input, document.createTextNode(field.label));
    list.append(label);
  });
  group.append(summary, list);
  container.append(group);
}

function syncProfileExportCategory(group) {
  const master = group.querySelector("[data-profile-export-category-option]");
  const fields = [...group.querySelectorAll('.search-field-option-grid input[type="checkbox"]')];
  if (!master || !fields.length) return;
  const selected = fields.filter((field) => field.checked).length;
  master.checked = selected === fields.length;
  master.indeterminate = selected > 0 && selected < fields.length;
}

function renderProfileExportFieldTags() {
  if (!elements.profileExportFieldTags) return;
  elements.profileExportFieldTags.replaceChildren();
  const selectedSchemas = selectedProfileExportSchemaIds();
  const groups = new Map();
  (state.profileExportInspection?.profiles || []).forEach((profile) => {
    if (!selectedSchemas.has(profile.schema_id)) return;
    const selected = new Set(state.profileReportFieldIdsBySchema.get(profile.schema_id) || []);
    profile.fields.forEach((field) => {
      const isShared = field.global_ref && state.profileReportGlobalRefs.has(field.global_ref);
      if (!selected.has(field.field_id) && !isShared) return;
      const key = `${profile.schema_name} — ${field.category}`;
      if (!groups.has(key)) groups.set(key, []);
      if (!groups.get(key).some((item) => item.fieldId === field.field_id)) {
        groups.get(key).push({
          fieldId: field.field_id,
          globalRef: isShared ? field.global_ref : "",
          label: field.label,
          schemaId: profile.schema_id,
        });
      }
    });
  });
  groups.forEach((fields, titleText) => {
    const group = document.createElement("section");
    group.className = "selection-category-group";
    const title = document.createElement("strong");
    title.textContent = titleText;
    const chips = document.createElement("div");
    chips.className = "selection-chip-list";
    fields.forEach((field) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "selection-chip selection-chip-button";
      chip.dataset.removeProfileExportField = field.fieldId;
      chip.dataset.removeProfileExportSchema = field.schemaId;
      if (field.globalRef) chip.dataset.removeProfileExportGlobal = field.globalRef;
      chip.title = "إزالة من حقول النتائج";
      chip.textContent = field.label;
      chips.append(chip);
    });
    group.append(title, chips);
    elements.profileExportFieldTags.append(group);
  });
  if (!groups.size) {
    const empty = document.createElement("span");
    empty.className = "selection-chip selection-chip-empty";
    empty.textContent = "لا توجد حقول مختارة.";
    elements.profileExportFieldTags.append(empty);
  }
}

function profileFieldDisplay(field) {
  return (field.display_values || field.values || [])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("، ");
}

function profileInfoText(profile) {
  const selectedIds = new Set(state.profileInfoFieldIdsBySchema.get(profile.schema_id) || []);
  const selectedFields = profile.fields.filter((field) => selectedIds.has(field.field_id));
  if (!selectedFields.length) return "";
  const template = String(state.profileInfoFormatBySchema.get(profile.schema_id) || "").trim();
  if (!template) return selectedFields.map(profileFieldDisplay).filter(Boolean).join(" — ");
  const valuesByLabel = new Map(selectedFields.map((field) => [field.label, profileFieldDisplay(field)]));
  return template.replace(/\{([^{}]+)\}/g, (_match, rawLabel) => valuesByLabel.get(String(rawLabel).trim()) || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([،؛:,.!?-])/g, "$1")
    .trim();
}

function selectedProfileExportInputs() {
  return [...elements.profileExportProfileTableBody.querySelectorAll('[data-profile-export-schema]:checked')]
    .filter(input => input.closest('tr').querySelector('[data-profile-export-identity]')?.checked);
}

function syncProfileExportMatrix() {
  const body = elements.profileExportProfileTableBody;
  const table = body.closest('table');
  const identities = [...body.querySelectorAll('[data-profile-export-identity]:not(:disabled)')];
  body.querySelectorAll('[data-profile-export-identity]').forEach(identity => {
    const row = identity.closest('tr');
    row.classList.toggle('profile-export-excluded', !identity.checked);
    row.querySelectorAll('[data-profile-export-schema]').forEach(input => { input.disabled = !identity.checked; });
  });
  const syncMaster = (master, inputs) => {
    if (!master) return;
    const count = inputs.filter(input => input.checked).length;
    master.checked = inputs.length > 0 && count === inputs.length;
    master.indeterminate = count > 0 && count < inputs.length;
    master.disabled = inputs.length === 0;
  };
  syncMaster(table.querySelector('[data-profile-export-all-identities]'), identities);
  const cells = [...body.querySelectorAll('[data-profile-export-schema]')];
  table.querySelectorAll('[data-profile-export-schema-column]').forEach(master => {
    // Column choices also update remembered choices for excluded IDs, without including them.
    syncMaster(master, cells.filter(input => input.dataset.profileExportSchema === master.dataset.profileExportSchemaColumn));
  });
}

function handleProfileExportMatrixChange(event) {
  const target = event.target;
  const body = elements.profileExportProfileTableBody;
  if (target.matches('[data-profile-export-all-identities]')) {
    body.querySelectorAll('[data-profile-export-identity]:not(:disabled)').forEach(input => { input.checked = target.checked; });
  } else if (target.matches('[data-profile-export-schema-column]')) {
    body.querySelectorAll('[data-profile-export-schema]').forEach(input => {
      if (input.dataset.profileExportSchema === target.dataset.profileExportSchemaColumn) input.checked = target.checked;
    });
  } else if (!target.matches('[data-profile-export-schema], [data-profile-export-identity]')) return;
  syncProfileExportMatrix();
  renderProfileExportFieldTags();
}

function renderProfileInspectionTable() {
  const result = state.profileExportInspection;
  if (!result) return;
  const body = elements.profileExportProfileTableBody;
  const head = body.closest('table').tHead;
  const oldCells = new Map([...body.querySelectorAll('[data-profile-export-schema]')]
    .map(input => [`${input.dataset.profileExportRecord}:${input.dataset.profileExportSchema}`, input.checked]));
  const oldRows = new Map([...body.querySelectorAll('[data-profile-export-identity]')]
    .map(input => [input.dataset.profileExportIdentity, input.checked]));
  const schemas = new Map();
  const byRecord = new Map();
  // Include unmatched IDs in the matrix so their absence is explicit.
  (result.record_codes || [result.record_code]).forEach(code => byRecord.set(code, new Map()));
  result.profiles.forEach(profile => {
    const code = profile.record_code || result.record_code;
    if (!byRecord.has(code)) byRecord.set(code, new Map());
    byRecord.get(code).set(profile.schema_id, profile);
    schemas.set(profile.schema_id, profile.schema_name);
  });
  const header = document.createElement('tr');
  const includeHeading = document.createElement('th');
  includeHeading.scope = 'col';
  const allLabel = document.createElement('label'); allLabel.className = 'check-field';
  const all = document.createElement('input'); all.type = 'checkbox'; all.dataset.profileExportAllIdentities = '';
  all.setAttribute('aria-label', 'تضمين جميع IDs');
  allLabel.append(all, document.createTextNode('تضمين')); includeHeading.append(allLabel); header.append(includeHeading);
  const idHeading = document.createElement('th'); idHeading.scope = 'col'; idHeading.textContent = 'ID'; header.append(idHeading);
  schemas.forEach((name, id) => {
    const heading = document.createElement('th'); heading.scope = 'col'; heading.className = 'profile-export-schema-heading';
    const label = document.createElement('label'); label.className = 'check-field';
    const master = document.createElement('input'); master.type = 'checkbox'; master.dataset.profileExportSchemaColumn = id;
    master.setAttribute('aria-label', `اختيار ${name} لجميع IDs التي لديها هذا التصميم`);
    const text = document.createElement('span'); text.textContent = name;
    label.append(master, text); heading.append(label); header.append(heading);
  });
  const infoHeading = document.createElement('th'); infoHeading.scope = 'col'; infoHeading.textContent = 'معلومات عامة'; header.append(infoHeading);
  head.replaceChildren(header);
  const fragment = document.createDocumentFragment();
  byRecord.forEach((profiles, code) => {
    const row = document.createElement('tr');
    const includeCell = document.createElement('td');
    const include = document.createElement('input'); include.type = 'checkbox'; include.dataset.profileExportIdentity = code;
    include.checked = profiles.size > 0 && (oldRows.get(code) ?? true);
    include.disabled = profiles.size === 0; include.setAttribute('aria-label', `تضمين ${code}`);
    includeCell.append(include); row.append(includeCell);
    const idCell = document.createElement('th'); idCell.scope = 'row'; idCell.dir = 'ltr'; idCell.textContent = code; row.append(idCell);
    schemas.forEach((name, id) => {
      const cell = document.createElement('td'); cell.className = 'profile-export-schema-cell';
      if (profiles.has(id)) {
        const input = document.createElement('input'); input.type = 'checkbox';
        input.dataset.profileExportRecord = code; input.dataset.profileExportSchema = id;
        input.checked = oldCells.get(`${code}:${id}`) ?? true;
        input.setAttribute('aria-label', `${name} — ${code}`); cell.append(input);
      } else {
        const absent = document.createElement('span'); absent.textContent = '—';
        absent.setAttribute('aria-label', `لا يوجد ملف في ${name} للمعرّف ${code}`); cell.append(absent);
      }
      row.append(cell);
    });
    const info = document.createElement('td'); info.className = 'profile-export-info-cell';
    profiles.forEach(profile => {
      const value = profileInfoText(profile);
      if (!value) return;
      const item = document.createElement('div');
      const name = document.createElement('small'); name.textContent = profile.schema_name;
      const text = document.createElement('span'); text.className = 'profile-export-info-text'; text.textContent = value;
      item.append(name, text); info.append(item);
    });
    if (!info.childElementCount) info.textContent = profiles.size ? 'اختر حقول المعلومات العامة' : 'لا توجد ملفات مطابقة';
    row.append(info); fragment.append(row);
  });
  body.replaceChildren(fragment);
  syncProfileExportMatrix();
}

function appendProfileInfoFieldCategory(container, profile, categoryName, fields) {
  if (!fields.length) return;
  const group = document.createElement("details");
  group.className = "tree-option-group profile-info-field-category";
  const summary = document.createElement("summary");
  const label = document.createElement("label");
  label.className = "check-field";
  const master = document.createElement("input");
  master.type = "checkbox";
  master.dataset.profileInfoCategory = `${profile.schema_id}:${categoryName}`;
  label.append(master, document.createTextNode(categoryName));
  summary.append(label);
  const list = document.createElement("div");
  list.className = "search-field-option-grid";
  fields.forEach((field) => {
    const fieldLabel = document.createElement("label");
    fieldLabel.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.profileInfoField = field.field_id;
    input.dataset.profileInfoSchema = profile.schema_id;
    input.checked = (state.profileInfoFieldIdsBySchema.get(profile.schema_id) || []).includes(field.field_id);
    fieldLabel.append(input, document.createTextNode(field.label));
    list.append(fieldLabel);
  });
  group.append(summary, list);
  container.append(group);
  const selectedCount = [...list.querySelectorAll("[data-profile-info-field]:checked")].length;
  master.checked = selectedCount === fields.length;
  master.indeterminate = selectedCount > 0 && selectedCount < fields.length;
}

function renderProfileInfoFormatTokens(section, profile) {
  const tokenList = section.querySelector("[data-profile-info-format-tokens]");
  const formatInput = section.querySelector("[data-profile-info-format-schema]");
  if (!tokenList || !formatInput) return;
  const selectedIds = new Set(
    [...section.querySelectorAll("[data-profile-info-field]:checked")]
      .map((input) => input.dataset.profileInfoField),
  );
  const selectedFields = (profile.fields || []).filter((field) => selectedIds.has(field.field_id));
  tokenList.replaceChildren();
  selectedFields.forEach((field) => {
    const token = document.createElement("button");
    token.type = "button";
    token.className = "selection-chip selection-chip-button profile-info-token";
    token.dataset.profileInfoTokenSchema = profile.schema_id;
    token.dataset.profileInfoToken = `{${field.label}}`;
    token.textContent = field.label;
    token.title = `إدراج {${field.label}} في الصيغة`;
    tokenList.append(token);
  });
  if (!selectedFields.length) {
    const empty = document.createElement("span");
    empty.className = "selection-chip selection-chip-empty";
    empty.textContent = "اختر حقولًا أولًا لتظهر هنا.";
    tokenList.append(empty);
  }
  formatInput.placeholder = selectedFields.length
    ? `مثال: ${selectedFields.slice(0, 3).map((field) => `{${field.label}}`).join(" - ")}`
    : "اختر حقول المعلومات العامة أولًا.";
}

function refreshProfileInfoFormatTokens(root = elements.profileInfoFieldSelection) {
  root?.querySelectorAll("[data-profile-info-schema-section]").forEach((section) => {
    const profile = (state.profileExportInspection?.profiles || []).find(
      (item) => item.schema_id === section.dataset.profileInfoSchemaSection,
    );
    if (profile) renderProfileInfoFormatTokens(section, profile);
  });
}

function renderProfileInfoFieldPicker() {
  elements.profileInfoFieldSelection.replaceChildren();
  selectedProfileExportDefinitions().forEach((profile) => {
    const section = document.createElement("section");
    section.className = "global-schema-config-section profile-export-schema-fields";
    section.dataset.profileInfoSchemaSection = profile.schema_id;
    const title = document.createElement("h3");
    title.textContent = profile.schema_name;
    section.append(title);
    const selectionPart = document.createElement("section");
    selectionPart.className = "profile-info-dialog-part profile-info-selection-part";
    const selectionHeading = document.createElement("div");
    selectionHeading.className = "profile-info-dialog-part-heading";
    const selectionTitle = document.createElement("h4");
    selectionTitle.textContent = "اختيار حقول المعلومات العامة";
    const selectionHint = document.createElement("p");
    selectionHint.className = "muted-text";
    selectionHint.textContent = "اختر الحقول التي ستكوّن النص المختصر لهذا التصميم.";
    selectionHeading.append(selectionTitle, selectionHint);
    const categorySelection = document.createElement("div");
    categorySelection.className = "profile-info-category-selection";
    const groups = new Map();
    profile.fields.forEach((field) => {
      if (!groups.has(field.category)) groups.set(field.category, []);
      groups.get(field.category).push(field);
    });
    groups.forEach((fields, categoryName) => appendProfileInfoFieldCategory(categorySelection, profile, categoryName, fields));
    selectionPart.append(selectionHeading, categorySelection);

    const formatPart = document.createElement("section");
    formatPart.className = "profile-info-dialog-part profile-info-format-part";
    const formatHeading = document.createElement("div");
    formatHeading.className = "profile-info-dialog-part-heading";
    const formatTitle = document.createElement("h4");
    formatTitle.textContent = "صيغة كتابة الحقول المختارة";
    const formatHeadingHint = document.createElement("p");
    formatHeadingHint.className = "muted-text";
    formatHeadingHint.textContent = "لا تظهر هنا إلا الحقول المحددة أعلاه، وتتحدث القائمة فورًا.";
    formatHeading.append(formatTitle, formatHeadingHint);
    const formatField = document.createElement("label");
    formatField.className = "field profile-info-format-field";
    const formatLabel = document.createElement("span");
    formatLabel.textContent = "صيغة عرض المعلومات العامة";
    const formatInput = document.createElement("textarea");
    formatInput.className = "control";
    formatInput.rows = 2;
    formatInput.dataset.profileInfoFormatSchema = profile.schema_id;
    formatInput.value = state.profileInfoFormatBySchema.get(profile.schema_id) || "";
    const tokenList = document.createElement("div");
    tokenList.className = "profile-info-format-tokens";
    tokenList.dataset.profileInfoFormatTokens = profile.schema_id;
    const formatHint = document.createElement("small");
    formatHint.className = "muted-text";
    formatHint.textContent = "اكتب النص وعلامات الفصل بالترتيب المطلوب، وانقر أسماء الحقول لإدراجها في موضع المؤشر.";
    formatField.append(formatLabel, formatInput, tokenList, formatHint);
    formatPart.append(formatHeading, formatField);
    section.append(selectionPart, formatPart);
    elements.profileInfoFieldSelection.append(section);
    renderProfileInfoFormatTokens(section, profile);
  });
}

function applyProfileInfoFieldSelection() {
  state.profileInfoFieldIdsBySchema = new Map();
  state.profileInfoFormatBySchema = new Map();
  elements.profileInfoFieldSelection.querySelectorAll("[data-profile-info-field]:checked").forEach((input) => {
    const ids = state.profileInfoFieldIdsBySchema.get(input.dataset.profileInfoSchema) || [];
    ids.push(input.dataset.profileInfoField);
    state.profileInfoFieldIdsBySchema.set(input.dataset.profileInfoSchema, ids);
  });
  elements.profileInfoFieldSelection.querySelectorAll("[data-profile-info-format-schema]").forEach((input) => {
    const value = input.value.trim();
    if (value) state.profileInfoFormatBySchema.set(input.dataset.profileInfoFormatSchema, value);
  });
  renderProfileInspectionTable();
  elements.profileInfoFieldsDialog.close();
}

function selectedProfileExportSchemaIds() {
  return new Set(selectedProfileExportInputs().map(input => input.dataset.profileExportSchema));
}

function renderProfileExportFieldPicker() {
  const profiles = selectedProfileExportDefinitions();
  elements.profileExportSelection.replaceChildren();
  const sharedGlobals = new Map();
    profiles.forEach((profile) => profile.fields.forEach((field) => {
      if (field.global_ref && !sharedGlobals.has(field.global_ref)) sharedGlobals.set(field.global_ref, field);
    }));
    appendProfileExportFieldCategory(elements.profileExportSelection, { title: "الحقول العامة المشتركة", fields: [...sharedGlobals.values()], global: true });
    profiles.forEach((profile) => {
      const section = document.createElement("section");
      section.className = "global-schema-config-section profile-export-schema-fields";
      const title = document.createElement("h3");
      title.textContent = profile.schema_name;
      section.append(title);
      const categoryGroups = new Map();
      profile.fields.filter((field) => !field.global_ref).forEach((field) => {
        if (!categoryGroups.has(field.category)) categoryGroups.set(field.category, []);
        categoryGroups.get(field.category).push(field);
      });
      categoryGroups.forEach((fields, categoryName) => appendProfileExportFieldCategory(section, { title: categoryName, schemaId: profile.schema_id, schemaName: profile.schema_name, fields }));
      elements.profileExportSelection.append(section);
    });
  elements.profileExportSelection.querySelectorAll('[data-profile-export-field]').forEach(input => {
    input.checked = (state.profileReportFieldIdsBySchema.get(input.dataset.profileExportFieldSchema) || []).includes(input.dataset.profileExportField);
  });
  elements.profileExportSelection.querySelectorAll('[data-profile-export-global-choice]').forEach(input => {
    input.checked = state.profileReportGlobalRefs.has(input.dataset.profileExportGlobalChoice);
  });
  elements.profileExportSelection.querySelectorAll('.profile-export-field-category').forEach(syncProfileExportCategory);
  if (!profiles.length) elements.profileExportSelection.textContent = 'اختر تصميمًا من جدول الملفات أولًا.';
}

document.getElementById('confirm-profile-pdf-appearance')?.addEventListener('click', () => {
  document.getElementById('profile-pdf-appearance-dialog').close('export');
});

function requestProfilePdfAppearance() {
  const dialog = document.getElementById('profile-pdf-appearance-dialog');
  if (dialog.open) return Promise.resolve(null);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'export' ? {
      show_profile_image: document.getElementById('profile-pdf-show-image').checked,
      show_attachments: document.getElementById('profile-pdf-show-attachments').checked,
    } : null), {once:true});
    dialog.showModal();
  });
}

function profileExportCodes() {
  const codes = [...new Set(elements.profileExportRecordCode.value.toUpperCase().split(/[\s,;،؛]+/).filter(Boolean))];
  if (!codes.length || codes.some(code => !/^[A-Z][A-Z0-9]{7}$/.test(code))) {
    throw new Error("أدخل IDs صالحة، مفصولة بفاصلة أو مسافة أو سطر جديد.");
  }
  return codes;
}

function profileExportInputMatchesInspection() {
  if (!state.profileExportInspection) return false;
  try {
    return JSON.stringify(profileExportCodes()) === JSON.stringify(state.profileExportInspection.record_codes || [state.profileExportInspection.record_code]);
  } catch (_error) { return false; }
}

function profilePdfExportType() {
  return (state.profileExportInspection?.record_codes?.length || 1) > 1 ? "profile_pdf_batch" : "profile_pdf";
}

function selectedProfileExportDefinitions() {
  const selected = selectedProfileExportSchemaIds();
  const profiles = new Map();
  (state.profileExportInspection?.profiles || []).forEach(profile => {
    if (selected.has(profile.schema_id) && !profiles.has(profile.schema_id)) profiles.set(profile.schema_id, profile);
  });
  return [...profiles.values()];
}

async function inspectProfileExport() {
  let codes;
  try { codes = profileExportCodes(); }
  catch (error) { return showToast(error.message, "error"); }
  const inspectButton = document.getElementById('inspect-profile-export');
  inspectButton.disabled = true;
  elements.profileExportRecordCode.disabled = true;
  state.profileExportInspection = null;
  state.exportDestinations.profile = "";
  elements.chooseProfileExportLocation.disabled = true;
  elements.openProfileExportFields.disabled = true;
  elements.openProfileInfoFields.disabled = true;
  elements.profileExportProfileTableBody.replaceChildren();
  elements.profileExportProfileTableBody.closest("table").tHead.innerHTML = "<tr><th>تضمين</th><th>ID</th><th>معلومات عامة</th></tr>";
  elements.profileExportSelection.replaceChildren();
  elements.profileExportFieldTags.replaceChildren();
  elements.profileExportResultCount.textContent = "جاري البحث…";
  renderExportLocations();
  try {
    const profiles = [];
    const missing = [];
    for (const [index, code] of codes.entries()) {
      elements.profileExportStatus.textContent = `جاري فحص ${code} (${index + 1}/${codes.length})…`;
      const response = await fetch("/api/identities/inspect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_code: code, target_schema_id: "__none__", include_files:true }),
      });
      const result = await responseJson(response);
      if (!result.profiles.length) missing.push(code);
      profiles.push(...result.profiles.map(profile => ({...profile, record_code:code})));
    }
    state.profileExportInspection = {record_code:codes[0], record_codes:codes, profiles};
    state.profileInfoFieldIdsBySchema = new Map();
    state.profileInfoFormatBySchema = new Map();
    state.profileReportFieldIdsBySchema = new Map();
    state.profileReportGlobalRefs = new Set();
    renderProfileInspectionTable();
    renderProfileExportFieldPicker();
    elements.profileExportResultCount.textContent = `${profiles.length} ملف — ${codes.length - missing.length} ID`;
    elements.openProfileExportFields.disabled = !profiles.length;
    elements.openProfileInfoFields.disabled = !profiles.length;
    elements.chooseProfileExportLocation.disabled = !profiles.length;
    renderProfileExportFieldTags();
    const format = codes.length > 1 ? "سيُحفظ PDF مستقل لكل ID داخل ملف ZIP واحد." : "سيُحفظ تقرير PDF واحد.";
    elements.profileExportStatus.textContent = (profiles.length ? `اختر الملفات والحقول ومكان الحفظ. ${format}` : "لم يُعثر على ملفات مطابقة.")
      + (missing.length ? ` لا توجد ملفات للمعرّفات: ${missing.join('، ')}.` : "");
  } catch (error) {
    elements.profileExportStatus.textContent = error.message;
    elements.profileExportResultCount.textContent = "تعذّر البحث";
    showToast(error.message, "error");
  } finally {
    inspectButton.disabled = false;
    elements.profileExportRecordCode.disabled = false;
  }
}

async function exportProfilePdf() {
  if (!profileExportInputMatchesInspection()) return showToast("افحص قائمة IDs الحالية أولًا.", "error");
  if (!state.exportDestinations.profile) return showToast("اختر مكان حفظ تقرير PDF أولًا.", "error");
  const schemaIds = [...selectedProfileExportSchemaIds()];
  const schemasByRecord = {};
  selectedProfileExportInputs().forEach(input => {
    const code = input.dataset.profileExportRecord || state.profileExportInspection.record_code;
    (schemasByRecord[code] ||= []).push(input.dataset.profileExportSchema);
  });
  if (!schemaIds.length) return showToast("اختر ملفًا واحدًا على الأقل من جدول النتائج.", "error");
  const emptyIds = [...elements.profileExportProfileTableBody.querySelectorAll('[data-profile-export-identity]:checked')]
    .filter(input => !input.closest('tr').querySelector('[data-profile-export-schema]:checked'))
    .map(input => input.dataset.profileExportIdentity);
  if (emptyIds.length) return showToast(`اختر تصميمًا لكل ID مضمّن أو ألغِ تضمينه: ${emptyIds.join('، ')}`, "error");
  const appearance = await requestProfilePdfAppearance();
  if (!appearance || await requestExportNotes() === null) return;
  const fieldsBySchema = {};
  const globalRefs = new Set(state.profileReportGlobalRefs);
  schemaIds.forEach((schemaId) => {
    fieldsBySchema[schemaId] = [...(state.profileReportFieldIdsBySchema.get(schemaId) || [])];
  });
  try {
    const result = await saveExportRequest({ type: profilePdfExportType(), ...appearance, schema_id: state.activeSchemaId, record_code: state.profileExportInspection.record_code, record_codes: Object.keys(schemasByRecord), schema_ids_by_record: schemasByRecord, schema_ids: schemaIds, field_ids_by_schema: fieldsBySchema, global_refs: [...globalRefs] }, elements.profileExportStatus);
    if (result) showToast(profilePdfExportType() === "profile_pdf_batch" ? `تم إنشاء ${Object.keys(schemasByRecord).length} تقارير PDF مستقلة داخل ملف ZIP.` : "تم إنشاء تقرير PDF واحد.");
  } catch (error) {
    elements.profileExportStatus.textContent = error.message;
    showToast(error.message, "error");
  }
}

async function exportPortablePackage() {
  if (!state.exportDestinations.portable) return showToast("اختر مكان حفظ حزمة ZIP أولًا.", "error");
  if (await requestExportNotes() === null) return;
  elements.portableExportButton.disabled = true;
  try {
    const result = await saveExportRequest({ type: "portable_zip", schema_id: selectedExportSchemaId("portable") }, elements.portableExportStatus);
    if (result) showToast("تم إنشاء الحزمة المحمولة.");
  } catch (error) {
    elements.portableExportStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.portableExportButton.disabled = false;
  }
}

async function loadExportHistory() {
  if (!elements.exportHistoryBody || !builderUnlocked()) return;
  try {
    const limit = state.workspaceSettings?.export_history_limit || 20;
    const response = await fetch('/api/export/history?limit=all', { cache: "no-store" });
    const result = await responseJson(response);
    state.exportHistoryEntries = result.entries || [];
    renderExportHistoryRows();
    elements.exportHistorySummary.textContent = `${result.total} عملية تصدير محفوظة في السجل.`;
  } catch (error) {
    elements.exportHistorySummary.textContent = error.message;
  }
}

function historyMatches(entry, query) {
  if (!query) return true;
  const haystack = [entry.created_at, historyDate(entry.created_at), entry.filename, entry.notes, entry.schema_name, entry.user_name, entry.type, entry.status, entry.destination, entry.row_count, entry.added, entry.updated, entry.skipped, entry.rejected, entry.status === "success" ? "ناجح" : "", ...(entry.schema_names || []), ...(entry.schemas || [])].join(" ").toLocaleLowerCase("ar");
  return haystack.includes(query.toLocaleLowerCase("ar"));
}

function renderExportHistoryRows() {
  if (!elements.exportHistoryBody) return;
  const query = elements.exportHistorySearch?.value.trim() || "";
  const limit = state.workspaceSettings?.export_history_limit || 20;
  const entries = (state.exportHistoryEntries || []).filter((entry) => historyMatches(entry, query)).slice(0, limit === "all" ? undefined : Number(limit));
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
      const row = document.createElement("tr");
      row.dataset.restoreExportHistory = entry.id;
      row.title = entry.configuration ? "انقر لاستعادة إعدادات هذا التصدير" : "لا تتوفر إعدادات محفوظة لهذا التصدير القديم";
      const destination = String(entry.destination || "").replace(/[\\/][^\\/]+$/, "") || "—";
      [historyDate(entry.created_at), entry.user_name || "—", (entry.type === "advanced_report" ? "تقرير متقدم PDF" : entry.type), entry.filename, String(entry.row_count), destination, entry.notes || "—"].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      const actions = document.createElement("td");
      actions.className = "history-actions-cell";
      const actionButtons = document.createElement("div");
      actionButtons.className = "history-action-buttons";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "button button-quiet";
      open.textContent = "فتح الملف";
      open.dataset.openExportHistory = entry.id;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button-danger-quiet";
      remove.textContent = "حذف";
      remove.dataset.deleteExportHistory = entry.id;
      actionButtons.append(open, remove);
      actions.append(actionButtons);
      row.append(actions);
      fragment.append(row);
    });
  if (!entries.length) fragment.append(historyEmptyRow(8, query ? "لا توجد عمليات تصدير تطابق البحث." : "لا توجد عمليات تصدير محفوظة."));
  elements.exportHistoryBody.replaceChildren(fragment);
}

function restoreExportHistoryConfiguration(entry) {
  const config = entry?.configuration;
  if (!config || typeof config !== "object" || !Object.keys(config).length) {
    showToast("هذا السجل أُنشئ قبل حفظ إعدادات التصدير، لذلك لا يمكن استعادته.", "error");
    return;
  }
  const type = config.type || entry.type;
  if (type === "advanced_report") { setExportMode("advanced"); showToast("اختر القالب وأعد إنشاء التقرير؛ النسخة المصدّرة متاحة بزر فتح الملف."); return; }
  if (type === "table") {
    const schemaId = config.schema_id || entry.schemas?.[0];
    if (!exchangeSchemaChoices().some((schema) => schema.id === schemaId)) {
      showToast("التصميم المرتبط بهذا التصدير لم يعد متاحًا.", "error");
      return;
    }
    state.exportMode = "table";
    selectExportSchema(schemaId);
    const schema = exchangeSchema(schemaId) || state.schema;
    const validFields = new Set((schema.categories || []).flatMap((category) => category.fields || []).map((field) => field.id));
    state.exportFieldIds = (config.field_ids || []).filter((fieldId) => validFields.has(fieldId));
    state.exportFilterIds = (config.criteria?._search_field_ids || []).filter((fieldId) => validFields.has(fieldId));
    elements.exportIncludeRelated.checked = config.include_related !== false;
    elements.exportIncludeAttachments.checked = config.include_attachments === true;
    renderExportFields();
    renderExportFilters();
    renderExportFilterValues(config.criteria || {});
    renderExportSelectionSummaries();
    renderExchangeTopTabs();
    elements.exportStatus.textContent = "تمت استعادة الحقول والمرشحات. اختر مكان الحفظ ثم نفّذ التصدير.";
    showToast("تمت استعادة إعدادات التصدير.");
    return;
  }
  if (type === "portable_zip") {
    state.exportMode = "portable";
    selectExportSchema(config.schema_id || entry.schemas?.[0]);
    renderExchangeTopTabs();
    showToast("تمت استعادة إعداد حزمة التصميم. اختر مكان الحفظ.");
    return;
  }
  state.exportMode = "profile";
  elements.profileExportRecordCode.value = (config.record_codes?.length ? config.record_codes : entry.person_ids?.length ? entry.person_ids : [config.record_code || entry.person_id || ""]).join("\n");
  renderExchangeTopTabs();
  showToast("تمت استعادة IDs التقارير؛ شغّل البحث لتحديث الملفات المتاحة.");
}

function historyEmptyRow(columnCount, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.className = "table-empty";
  cell.textContent = message;
  row.append(cell);
  return row;
}

function importTargetOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function importSheetConfigurations() {
  return [...elements.importMappingList.querySelectorAll('[data-import-sheet]')].flatMap(section => {
    const category=section.querySelector('[data-import-sheet-category]').value;
    if (category==='__ignore__') return [];
    const mapping={};
    section.querySelectorAll('[data-import-column]').forEach(input=>{if(input.value && input.value!=='__ignore__') mapping[input.dataset.importColumn]=input.value;});
    return [{sheet_name:section.dataset.importSheet,category_id:category,repeated_mode:section.querySelector('[data-import-repeat-mode]').value,mapping}];
  });
}

function renderImportSheetColumns(section, sheet) {
  const category=section.querySelector('[data-import-sheet-category]').value;
  const definition=state.importInspection.categories.find(item=>item.id===category);
  const repeated=definition?.kind==='repeatable';
  section.querySelector('[data-import-repeat-options]').hidden=!repeated;
  const target=section.querySelector('[data-import-sheet-columns]');target.replaceChildren();
  if(!category || category==='__ignore__') return;
  const fields=state.importInspection.all_fields.filter(field=>field.category_id===category || category==='__main__'&&field.kind==='main');
  sheet.columns.forEach(column=>{
    const row=document.createElement('div');row.className='import-mapping-row';
    const source=document.createElement('strong');source.textContent=column.header;
    const examples=[...new Set((sheet.preview||[]).map(row=>String(row.values[column.column-1]??'')).filter(Boolean))].slice(0,2);
    if(examples.length){const example=document.createElement('small');example.className='import-column-example';example.textContent=examples.join(' · ');source.append(example);}
    const select=document.createElement('select');select.className='control';select.dataset.importColumn=column.column;
    select.setAttribute('aria-label',`${sheet.sheet_name} — ${column.header}`);
    select.append(importTargetOption('__ignore__','تجاهل هذا العمود'),importTargetOption('__record_code__','ID الشخص (للربط بين الأوراق)'),importTargetOption('__archived__','حالة الأرشفة'));
    if(repeated) select.append(importTargetOption('__minor_id__','رقم البطاقة (فارغ = بطاقة جديدة)'),importTargetOption('__linked_record_code__','ID الشخص المرتبط'),importTargetOption('__parent_minor_id__','رقم بطاقة الفئة الأم'),importTargetOption('__parent_child_id__','معرّف البطاقة الأم الداخلي'));
    const groups=new Map();
    fields.forEach(field=>{
      if(!groups.has(field.category)){const group=document.createElement('optgroup');group.label=field.category;groups.set(field.category,group);select.append(group);}
      groups.get(field.category).append(importTargetOption(field.id,field.label));
    });
    const suggested=column.suggested_target;
    if([...select.options].some(option=>option.value===suggested)) select.value=suggested;
    else {
      const matches=fields.filter(field=>field.id===column.technical_header || field.label===column.header || `${field.category} — ${field.label}`===column.header);
      if(matches.length===1) select.value=matches[0].id;
    }
    row.append(source,select);target.append(row);
  });
}

function renderMultiSheetImport(inspection) {
  elements.importMappingArea.hidden=false;elements.importMappingPlaceholder.hidden=true;
  elements.importSummary.textContent=`${inspection.sheet_inspections.length} أوراق — اربط كل ورقة بفئتها أو تجاهلها. تُجمع البيانات بحسب ID.`;
  elements.importMappingList.replaceChildren();
  inspection.sheet_inspections.forEach(sheet=>{
    const section=document.createElement('details');section.className='import-sheet-card';section.dataset.importSheet=sheet.sheet_name;section.open=true;
    const summary=document.createElement('summary');summary.textContent=`${sheet.sheet_name} — ${sheet.data_rows} صف`;
    const label=document.createElement('label');label.className='field';const text=document.createElement('span');text.textContent='الفئة المقابلة لهذه الورقة';
    const category=document.createElement('select');category.className='control';category.dataset.importSheetCategory='';
    category.append(importTargetOption('','اختر الفئة'),importTargetOption('__ignore__','تجاهل هذه الورقة'),importTargetOption('__main__','حقول من عدة فئات رئيسية'));
    inspection.categories.forEach(item=>category.append(importTargetOption(item.id,`${item.label} — ${item.kind==='repeatable'?'متكررة':'رئيسية'}`)));
    category.value=sheet.category_id || '';label.append(text,category);
    const options=document.createElement('div');options.dataset.importRepeatOptions='';
    const mode=document.createElement('select');mode.className='control';mode.dataset.importRepeatMode='';mode.setAttribute('aria-label','طريقة استيراد البطاقات');
    mode.append(importTargetOption('merge','دمج: تحديث أرقام البطاقات المطابقة وإضافة البطاقات ذات الرقم الفارغ'),importTargetOption('replace','استبدال كل بطاقات الفئة لهذا ID (تظهر المحذوفات في المراجعة)'));
    const hint=document.createElement('p');hint.className='muted-text';hint.textContent='كل صف يمثل بطاقة. اربط ID الشخص؛ رقم البطاقة يحدد البطاقة الموجودة. رقم بطاقة الأم يربط الفئات المتكررة المتداخلة.';
    options.append(mode,hint);const columns=document.createElement('div');columns.dataset.importSheetColumns='';
    section.append(summary,label,options,columns);elements.importMappingList.append(section);
    renderImportSheetColumns(section,sheet);
  });
  renderImportMatchingProblems();
}

function validateMultiSheetImport() {
  const configs=importSheetConfigurations();const problems=[];
  if(!configs.length) problems.push('اختر ورقة واحدة على الأقل.');
  configs.forEach(config=>{
    const targets=Object.values(config.mapping);
    if(!config.category_id) problems.push(`${config.sheet_name}: اختر الفئة أو تجاهل الورقة.`);
    if(new Set(targets).size!==targets.length) problems.push(`${config.sheet_name}: الحقل نفسه مرتبط بأكثر من عمود.`);
    if(!targets.some(value=>!value.startsWith('__'))) problems.push(`${config.sheet_name}: اربط حقل بيانات واحدًا على الأقل.`);
    const repeated=state.importInspection.categories.find(item=>item.id===config.category_id)?.kind==='repeatable';
    if((configs.length>1||repeated||!elements.importGenerateMissingIds.checked)&&!targets.includes('__record_code__')) problems.push(`${config.sheet_name}: اربط عمود ID. لا يمكن ربط أوراق متعددة دون ID.`);
  });
  elements.importInspectionProblems.replaceChildren();
  problems.forEach(message=>{const p=document.createElement('p');p.textContent=message;elements.importInspectionProblems.append(p);});
  elements.importInspectionProblems.hidden=!problems.length;
  elements.commitImportButton.disabled=problems.length>0 || Boolean(state.importOperationCompleted);
  return problems.length>0;
}

function importReviewValue(value) {
  if(value===null || value===undefined || value==='') return '—';
  if(typeof value==='boolean') return value?'نعم':'لا';
  if(Array.isArray(value)) return value.map(importReviewValue).join('، ');
  if(typeof value==='object') return Object.entries(value).map(([key,item])=>`${key}: ${importReviewValue(item)}`).join('\n');
  return String(value);
}

function renderImportChangeLog(container, entries, editable=false) {
  container.replaceChildren();
  const actions={added:'إضافة ملف',updated:'تحديث ملف',unchanged:'بلا تغيير',skipped:'مستبعد'};
  entries.forEach(entry=>{
    const card=document.createElement('details');card.className='import-review-card';card.dataset.importReviewRecord=entry.record_code;card.open=editable && entry.action==='updated' && entries.length<=8;
    const summary=document.createElement('summary');
    if(editable){const include=document.createElement('input');include.type='checkbox';include.checked=entry.action!=='unchanged';include.disabled=entry.action==='unchanged';include.dataset.importReviewInclude='';include.setAttribute('aria-label',`اعتماد ${entry.record_code}`);include.addEventListener('click',event=>event.stopPropagation());summary.append(include);}
    const title=document.createElement('strong');title.textContent=`${entry.record_code} — ${actions[entry.action]||entry.message||''}`;summary.append(title);card.append(summary);
    if(entry.sources?.length){const sources=document.createElement('p');sources.className='muted-text';sources.textContent=entry.sources.join(' · ');card.append(sources);}
    if(entry.changes?.length){
      const scroll=document.createElement('div');scroll.className='table-scroll';const table=document.createElement('table');table.className='data-table import-change-table';
      const head=document.createElement('thead');const tr=document.createElement('tr');
      ['اعتماد','الفئة / الحقل','القيمة السابقة','القيمة الجديدة'].forEach(label=>{const th=document.createElement('th');th.scope='col';th.textContent=label;tr.append(th);});head.append(tr);table.append(head);
      const body=document.createElement('tbody');
      entry.changes.forEach(change=>{
        const row=document.createElement('tr');if(change.before!==null&&change.before!==undefined&&change.before!==''&&entry.action==='updated') row.className='import-value-conflict';
        const selectCell=document.createElement('td');
        if(editable){const check=document.createElement('input');check.type='checkbox';check.checked=true;check.disabled=entry.action==='added';check.dataset.importReviewChange=change.id;check.setAttribute('aria-label',`اعتماد ${change.label}`);selectCell.append(check);}else selectCell.textContent='✓';
        row.append(selectCell);[change.label,importReviewValue(change.before),importReviewValue(change.after)].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});body.append(row);
      });table.append(body);scroll.append(table);card.append(scroll);
    }
    container.append(card);
  });
}

async function reviewInspectedImport() {
  elements.commitImportButton.disabled=true;
  try {
    const payload={file_data:state.importFileData,filename:elements.importFile.files?.[0]?.name||'',schema_id:elements.importTargetSchema.value,schema_revision:state.importInspection.schema_revision,sheet_mappings:importSheetConfigurations(),duplicate_policy:elements.importDuplicatePolicy.value,generate_missing_ids:elements.importGenerateMissingIds.checked,clear_blank_values:elements.importClearBlanks.checked};
    elements.importResult.textContent='جاري إعداد معاينة التغييرات دون حفظ…';
    const response=await fetch('/api/import/preview',{method:'POST',headers:exchangeHeaders(payload.schema_id),body:JSON.stringify(payload)});
    const result=await responseJson(response);state.importReview={...result,schema_id:payload.schema_id};
    document.getElementById('import-review-search').value='';
    const dialog=document.getElementById('import-review-dialog');
    renderImportChangeLog(document.getElementById('import-review-entries'),result.entries,true);
    const summary=document.getElementById('import-review-summary');summary.textContent=`إضافة ${result.entries.filter(e=>e.action==='added').length} · تحديث ${result.entries.filter(e=>e.action==='updated').length} · بلا تغيير ${result.entries.filter(e=>e.action==='unchanged').length} · رفض ${result.rejected} · تخطي ${result.skipped}`;
    const errors=document.getElementById('import-review-errors');errors.replaceChildren();
    (result.errors||[]).forEach(error=>{const p=document.createElement('p');p.textContent=`${error.record_code||''} ${error.sources?.join(' · ')||`الصف ${error.row||'—'}`}: ${error.message}`;errors.append(p);});
    document.getElementById('apply-import-review').disabled=!result.entries.some(entry=>entry.action!=='unchanged');
    document.getElementById('import-review-status').textContent='';dialog.showModal();elements.importResult.textContent='راجع القيم القديمة والجديدة ثم اعتمد الاختيارات للحفظ.';
  }catch(error){elements.importResult.textContent=error.message;showToast(error.message,'error');}
  finally{renderImportMatchingProblems();}
}

async function applyReviewedImport() {
  if(!state.importReview) return;
  const selections=[...document.querySelectorAll('[data-import-review-record]')].filter(card=>card.querySelector('[data-import-review-include]')?.checked).map(card=>({record_code:card.dataset.importReviewRecord,change_ids:[...card.querySelectorAll('[data-import-review-change]:checked')].map(input=>input.dataset.importReviewChange)}));
  const button=document.getElementById('apply-import-review');button.disabled=true;
  const status=document.getElementById('import-review-status');status.textContent='جاري التحقق والحفظ…';
  try {
    const schemaId=state.importReview.schema_id;
    const response=await fetch('/api/import/apply-review',{method:'POST',headers:exchangeHeaders(schemaId),body:JSON.stringify({schema_id:schemaId,review_token:state.importReview.review_token,selections})});
    const result=await responseJson(response);state.importOperationCompleted=true;state.importReview=null;
    document.getElementById('import-review-dialog').close();
    elements.importResult.textContent=`أضيف ${result.imported}، حُدّث ${result.updated}، بلا تغيير ${result.unchanged}، رُفض ${result.rejected}.`;
    await refreshAfterPageLocalImport(schemaId,state.selectedRecordCode);showImportResultDialog(result);
  }catch(error){status.textContent=error.message;showToast(error.message,'error');}
  finally{button.disabled=false;renderImportMatchingProblems();}
}

document.getElementById('import-review-search')?.addEventListener('input',event=>{
  const query=event.target.value.trim().toLocaleLowerCase();
  document.querySelectorAll('#import-review-entries .import-review-card').forEach(card=>{card.hidden=!card.textContent.toLocaleLowerCase().includes(query);});
});
document.querySelectorAll('[data-import-review-bulk]').forEach(button=>button.addEventListener('click',()=>{
  const action=button.dataset.importReviewBulk;
  document.querySelectorAll('#import-review-entries .import-review-card').forEach(card=>{
    if(card.hidden) return;
    if(action==='keep') card.querySelectorAll('.import-value-conflict [data-import-review-change]:not(:disabled)').forEach(input=>{input.checked=false;});
    else {const include=card.querySelector('[data-import-review-include]');if(include&&!include.disabled) include.checked=action==='all';}
  });
}));

document.getElementById('apply-import-review')?.addEventListener('click',()=>void applyReviewedImport());

function renderImportMatchingProblems() {
  if(state.importInspection?.sheet_inspections) return validateMultiSheetImport();
  if (!elements.importInspectionProblems || !state.importInspection) {
    if (elements.commitImportButton) elements.commitImportButton.disabled = true;
    return true;
  }
  const controls = [...elements.importMappingList.querySelectorAll("[data-import-column]")];
  const resolvedColumns = new Set(
    controls.filter((control) => control.value).map((control) => Number(control.dataset.importColumn)),
  );
  const problems = (Array.isArray(state.importInspection.problems) ? state.importInspection.problems : [])
    .filter((problem) => !resolvedColumns.has(Number(problem.column)));
  const targets = new Map();
  controls.forEach((control) => {
    if (!control.value || control.value === "__ignore__") return;
    if (targets.has(control.value)) {
      problems.push({
        code: "duplicate_target",
        column: Number(control.dataset.importColumn),
        message: `الحقل «${control.selectedOptions[0]?.textContent || control.value}» مرتبط بأكثر من عمود. اختر هدفًا مختلفًا لكل عمود.`,
      });
    } else {
      targets.set(control.value, Number(control.dataset.importColumn));
    }
  });
  (state.importInspection.fields || []).filter((field) => field.required).forEach((field) => {
    if (!targets.has(field.id)) {
      problems.push({
        code: "required_field_unmapped",
        column: 0,
        message: `الحقل المطلوب «${field.category} — ${field.label}» غير مرتبط بأي عمود، وستُرفض الصفوف التي لا توفر قيمته.`,
      });
    }
  });
  const unique = [];
  const seen = new Set();
  problems.forEach((problem) => {
    const key = `${problem.code || "problem"}:${problem.column || 0}:${problem.message || problem}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(problem);
  });
  elements.importInspectionProblems.replaceChildren();
  const hasProblems = unique.length > 0;
  elements.importInspectionProblems.hidden = !hasProblems;
  elements.commitImportButton.disabled = hasProblems;
  elements.commitImportButton.title = hasProblems
    ? "عالج جميع مشكلات المطابقة قبل تطبيق الاستيراد."
    : "";
  if (!hasProblems) return false;
  const heading = document.createElement("strong");
  heading.textContent = `مشكلات المطابقة (${unique.length})`;
  const list = document.createElement("ul");
  unique.forEach((problem) => {
    const item = document.createElement("li");
    item.textContent = problem.message || String(problem);
    list.append(item);
  });
  elements.importInspectionProblems.append(heading, list);
  return true;
}

function renderImportInspection(inspection) {
  if(inspection.sheet_inspections) return renderMultiSheetImport(inspection);
  elements.importMappingArea.hidden = false;
  elements.importMappingPlaceholder.hidden = true;
  elements.importSummary.textContent = `${inspection.data_rows} صف بيانات. راجع كل مطابقة يدويًا.`;
  elements.importMappingList.replaceChildren();
  inspection.columns.forEach((column) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    const source = document.createElement("strong");
    source.textContent = column.header;
    const select = document.createElement("select");
    select.className = "control";
    select.dataset.importColumn = String(column.column);
    select.append(
      importTargetOption("", "اختر المطابقة أو التجاهل"),
      importTargetOption("__ignore__", "تجاهل هذا العمود"),
      importTargetOption("__record_code__", "ID السجل"),
      importTargetOption("__archived__", "حالة الأرشفة"),
    );
    const groups = new Map();
    inspection.fields.forEach((field) => {
      if (!groups.has(field.category)) {
        const group = document.createElement("optgroup");
        group.label = field.category;
        groups.set(field.category, group);
        select.append(group);
      }
      groups.get(field.category).append(importTargetOption(field.id, field.label));
    });
    select.value = column.suggested_target || "__ignore__";
    row.append(source, select);
    elements.importMappingList.append(row);
  });
  renderImportMatchingProblems();
}

function ignoreAllImportFields() {
  elements.importMappingList
    .querySelectorAll("[data-import-column]")
    .forEach((select) => {
      select.value = "__ignore__";
    });
  renderImportMatchingProblems();
}

async function inspectSelectedImport() {
  const file = elements.importFile.files?.[0];
  if (!file) return showToast("اختر ملف .xlsx أولًا.", "error");
  elements.inspectImportButton.disabled = true;
  elements.commitImportButton.disabled = true;
  elements.importResult.textContent = "جاري الفحص…";
  try {
    state.importFileData = await workspace.fileAsBase64(file);
    const response = await fetch("/api/import/inspect", { method: "POST", headers: exchangeHeaders(elements.importTargetSchema.value), body: JSON.stringify({ file_data: state.importFileData, schema_id: elements.importTargetSchema.value }) });
    state.importInspection = await responseJson(response);
    state.importOperationCompleted = false;
    renderImportInspection(state.importInspection);
    elements.importResult.textContent = "";
  } catch (error) {
    elements.importResult.textContent = error.message;
    elements.commitImportButton.disabled = true;
  } finally {
    elements.inspectImportButton.disabled = false;
  }
}

async function commitInspectedImport() {
  if (!state.importInspection || !state.importFileData) return;
  if (renderImportMatchingProblems()) {
    return showToast("عالج جميع مشكلات المطابقة قبل تطبيق الاستيراد.", "error");
  }
  if(state.importInspection.sheet_inspections) return reviewInspectedImport();
  const previouslySelectedRecord = state.selectedRecordCode;
  const mapping = {};
  elements.importMappingList.querySelectorAll("[data-import-column]").forEach((select) => {
    if (select.value && select.value !== "__ignore__") {
      mapping[select.dataset.importColumn] = select.value;
    }
  });
  const idColumnEntry = Object.entries(mapping).find(([, target]) => target === "__record_code__");
  const idColumnOffset = idColumnEntry ? Number(idColumnEntry[0]) - 1 : -1;
  const previewHasMissingId = idColumnOffset < 0 || state.importInspection.preview?.some(
    (row) => !String(row.values?.[idColumnOffset] ?? "").trim(),
  );
  if (previewHasMissingId && !elements.importGenerateMissingIds.checked) {
    return showToast("أكّد توليد ID للصفوف التي لا تحتوي على ID.", "error");
  }
  elements.commitImportButton.disabled = true;
  try {
    const response = await fetch("/api/import/commit", {
      method: "POST",
      headers: exchangeHeaders(elements.importTargetSchema.value),
      body: JSON.stringify({ file_data: state.importFileData, filename: elements.importFile.files?.[0]?.name || "", schema_id: elements.importTargetSchema.value, sheet_name: state.importInspection.sheet_name, schema_revision: state.importInspection.schema_revision, mapping, duplicate_policy: elements.importDuplicatePolicy.value, generate_missing_ids: elements.importGenerateMissingIds.checked, clear_blank_values: elements.importClearBlanks.checked }),
    });
    const result = await responseJson(response);
    state.importOperationCompleted = true;
    elements.importResult.textContent = `أضيف ${result.imported}، حُدّث ${result.updated || 0}، تخطي ${result.skipped}، رُفض ${result.rejected}.`;
    await refreshAfterPageLocalImport(elements.importTargetSchema.value, previouslySelectedRecord);
    showImportResultDialog(result);
    showToast("اكتمل استيراد Excel.");
  } catch (error) {
    elements.importResult.textContent = error.message;
    void logImportStatus("failed", elements.importFile.files?.[0]?.name || "", [{ message: error.message }]);
    showToast(error.message, "error");
  } finally {
    elements.commitImportButton.disabled = renderImportMatchingProblems();
  }
}

async function inspectPortableImportFile() {
  const file = elements.portableImportFile.files?.[0];
  if (!file) return showToast("اختر ملف ZIP أولًا.", "error");
  elements.inspectPortableImport.disabled = true;
  try {
    state.portableImportData = await workspace.fileAsBase64(file);
    const response = await fetch("/api/import/portable/inspect", { method: "POST", headers: exchangeHeaders(elements.importTargetSchema.value), body: JSON.stringify({ file_data: state.portableImportData, schema_id: elements.importTargetSchema.value }) });
    const result = await responseJson(response);
    state.portableImportInspection = result;
    state.importOperationCompleted = false;
    elements.portableImportSummary.textContent = `${result.manifest.schema_name}: ${result.record_count} سجل، ${result.new_count} جديد، ${result.matching_count} مطابق، ${result.attachment_count} مرفق.`;
    elements.commitPortableImport.disabled = !result.can_import;
  } catch (error) {
    elements.portableImportStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.inspectPortableImport.disabled = false;
  }
}

async function commitPortableImportFile() {
  if (!state.portableImportData || !state.portableImportInspection) return;
  const previouslySelectedRecord = state.selectedRecordCode;
  if (!(await requestConfirmation("ستُنشأ نسخة احتياطية ثم تُطبّق الحزمة.", {
    title: "تطبيق الحزمة المحمولة",
    confirmLabel: "إنشاء النسخة والتطبيق",
  }))) return;
  elements.commitPortableImport.disabled = true;
  try {
    const response = await fetch("/api/import/portable/commit", { method: "POST", headers: exchangeHeaders(elements.importTargetSchema.value), body: JSON.stringify({ file_data: state.portableImportData, filename: elements.portableImportFile.files?.[0]?.name || "", schema_id: elements.importTargetSchema.value, conflict_policy: elements.portableConflictPolicy.value }) });
    const result = await responseJson(response);
    state.importOperationCompleted = true;
    elements.portableImportStatus.textContent = `أضيف ${result.created}، حُدّث ${result.updated}، تخطي ${result.skipped}.`;
    await refreshAfterPageLocalImport(elements.importTargetSchema.value, previouslySelectedRecord);
    showImportResultDialog(result);
    showToast("اكتمل تطبيق الحزمة.");
  } catch (error) {
    elements.portableImportStatus.textContent = error.message;
    void logImportStatus("failed", elements.portableImportFile.files?.[0]?.name || "", [{ message: error.message }]);
    showToast(error.message, "error");
  } finally {
    elements.commitPortableImport.disabled = false;
  }
}

async function refreshAfterPageLocalImport(schemaId, selectedRecordCode = "") {
  await loadWorkspaceMetadata();
  if (!state.workspace || schemaId === state.activeSchemaId) {
    await loadSchema({ preservePage: true, resetRecord: false });
    if (selectedRecordCode) {
      await performLoadRecord(selectedRecordCode, { force: true, silent: true, scroll: false, skipNavigationGuard: true });
    }
  }
  renderExchangePage();
}

function showImportResultDialog(result) {
  state.pendingImportHistoryId = result.history?.id || "";
  elements.importResultSummary.textContent = `أضيف ${result.imported ?? result.created ?? 0} · حُدّث ${result.updated || 0} · تخطي ${result.skipped || 0} · رُفض ${result.rejected || 0}`;
  elements.importResultDetails.replaceChildren();
  renderImportChangeLog(elements.importResultDetails,result.changes||[]);
  const details = result.errors || [];
  if (!details.length && !(result.changes||[]).length) emptyDashboard(elements.importResultDetails, "لم تسجّل أخطاء في هذه العملية.");
  details.forEach((item) => {
    const row = document.createElement("p");
    row.textContent = `الصف ${item.row || "—"}${item.record_code ? ` · ${item.record_code}` : ""}: ${item.message || ""}`;
    elements.importResultDetails.append(row);
  });
  elements.importResultNotes.value = "";
  elements.importResultDialog.showModal();
}

async function finalizeImportResult() {
  const id = state.pendingImportHistoryId;
  if (id) {
    try {
      const response = await fetch("/api/history/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "import", id, notes: elements.importResultNotes.value }) });
      await responseJson(response);
    } catch (error) {
      return showToast(error.message, "error");
    }
  }
  state.pendingImportHistoryId = "";
  elements.importResultDialog.close();
  await loadImportHistory();
}

async function loadImportHistory() {
  if (!elements.importHistoryBody || !builderUnlocked()) return;
  try {
    const limit = state.workspaceSettings?.import_history_limit || 20;
    const response = await fetch('/api/import/history?limit=all', { cache: "no-store" });
    const result = await responseJson(response);
    state.importHistoryEntries = result.entries || [];
    renderImportHistoryRows();
    elements.importHistorySummary.textContent = `${result.total} عملية استيراد محفوظة في السجل.`;
  } catch (error) {
    elements.importHistorySummary.textContent = error.message;
  }
}

function renderImportHistoryRows() {
  const query = elements.importHistorySearch?.value.trim() || "";
  const limit = state.workspaceSettings?.import_history_limit || 20;
  const entries = (state.importHistoryEntries || []).filter((entry) => historyMatches(entry, query)).slice(0, limit === "all" ? undefined : Number(limit));
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    [historyDate(entry.created_at), entry.user_name || "—", entry.status === "success" ? "ناجح" : entry.status, entry.filename, entry.schema_name, entry.added, entry.updated, entry.skipped, entry.rejected, entry.notes || "—"].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "");
      row.append(cell);
    });
    const actionCell = document.createElement("td");
    actionCell.className = "history-actions-cell";
    const actionButtons = document.createElement("div");
    actionButtons.className = "history-action-buttons";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button button-quiet";
    action.textContent = "فتح التفاصيل";
    action.dataset.importHistoryDetails = entry.id;
    actionButtons.append(action);
    if (entry.source_archive) {
      const source = document.createElement("button");
      source.type = "button";
      source.className = "button button-quiet";
      source.dataset.openImportSource = entry.id;
      source.textContent = "فتح الملف";
      actionButtons.append(source);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger-quiet";
    remove.textContent = "حذف";
    remove.dataset.deleteImportHistory = entry.id;
    actionButtons.append(remove);
    actionCell.append(actionButtons);
    row.append(actionCell);
    fragment.append(row);
  });
  if (!entries.length) fragment.append(historyEmptyRow(11, query ? "لا توجد عمليات استيراد تطابق البحث." : "لا توجد عمليات استيراد محفوظة."));
  elements.importHistoryBody.replaceChildren(fragment);
}

function openImportHistoryDetails(entryId) {
  const entry = (state.importHistoryEntries || []).find((item) => item.id === entryId);
  if (!entry) return;
  state.pendingImportHistoryId = entry.id;
  elements.importResultSummary.textContent = `${entry.status === "success" ? "ناجح" : entry.status} · أضيف ${entry.added || 0} · حُدّث ${entry.updated || 0} · تخطي ${entry.skipped || 0} · رُفض ${entry.rejected || 0}`;
  renderImportChangeLog(elements.importResultDetails,(entry.details||[]).filter(item=>item.changes));
  if (!(entry.details || []).length) emptyDashboard(elements.importResultDetails, "لا توجد تفاصيل إضافية.");
  (entry.details || []).filter(item=>!item.changes).forEach((item) => {
    const row = document.createElement("p");
    row.textContent = `الصف ${item.row || "—"}${item.record_code ? ` · ${item.record_code}` : ""}: ${item.message || ""}`;
    elements.importResultDetails.append(row);
  });
  elements.importResultNotes.value = entry.notes || "";
  elements.importResultDialog.showModal();
}

function resetImportWorkflow() {
  const unfinishedFilename = elements.importTypeSelect?.value === "portable"
    ? elements.portableImportFile?.files?.[0]?.name
    : elements.importFile?.files?.[0]?.name;
  if (unfinishedFilename && state.importOperationCompleted === false) {
    void logImportStatus("aborted", unfinishedFilename, []);
  }
  state.importFileData = "";
  state.importInspection = null;
  state.portableImportData = "";
  state.portableImportInspection = null;
  elements.importFile.value = "";
  elements.portableImportFile.value = "";
  elements.importFileNameDisplay.textContent = "لم يُختر ملف";
  elements.portableImportFileName.textContent = "لم يُختر ملف";
  elements.importMappingArea.hidden = true;
  elements.importMappingPlaceholder.hidden = false;
  elements.importResult.textContent = "";
  elements.portableImportSummary.textContent = "";
  elements.portableImportStatus.textContent = "";
  elements.commitPortableImport.disabled = true;
  elements.commitImportButton.disabled = true;
  elements.commitImportButton.title = "";
  state.importOperationCompleted = null;
}

async function logImportStatus(status, filename, details) {
  try {
    await fetch("/api/import/history/log", {
      method: "POST",
      headers: exchangeHeaders(elements.importTargetSchema.value),
      body: JSON.stringify({ schema_id: elements.importTargetSchema.value, type: elements.importTypeSelect.value, status, filename, details }),
    });
    if (state.mode === "import") await loadImportHistory();
  } catch (_error) { /* history must never interrupt the workflow */ }
}

function resetExportWorkflow() {
  elements.profileExportRecordCode.value = "";
  elements.profileExportSelection.replaceChildren();
  elements.profileExportProfileTableBody.innerHTML = '<tr><td class="table-empty" colspan="3">أدخل IDs ثم شغّل البحث.</td></tr>';
  elements.profileExportProfileTableBody.closest('table').tHead.innerHTML = '<tr><th>تضمين</th><th>ID</th><th>معلومات عامة</th></tr>';
  elements.profileExportResultCount.textContent = "لم يُجرَ بحث";
  elements.openProfileExportFields.disabled = true;
  elements.openProfileInfoFields.disabled = true;
  elements.chooseProfileExportLocation.disabled = true;
  elements.profileExportFieldTags.innerHTML = '<span class="selection-chip selection-chip-empty">تظهر الحقول بعد البحث.</span>';
  elements.profileExportStatus.textContent = "";
  state.profileExportInspection = null;
  state.exportFilterIds = [];
  state.exportFieldIds = [];
  state.profileInfoFieldIdsBySchema = new Map();
  state.profileInfoFormatBySchema = new Map();
  state.profileReportFieldIdsBySchema = new Map();
  state.profileReportGlobalRefs = new Set();
  state.exportDestinations = { profile: "", table: "", portable: "" };
  renderExportFields();
  renderExportFilters();
  renderExportFilterValues();
  elements.exportStatus.textContent = "";
  elements.portableExportStatus.textContent = "";
  elements.exportNotes.value = "";
  elements.exportIncludeAttachments.checked = false;
  renderExportLocations();
}

function setExportMode(mode) {
  if (!new Set(["table", "portable", "advanced"]).has(mode)) return;
  state.exportMode = mode;
  syncExportWorkflowView();
  renderExchangeTopTabs();
}

function setImportMode(mode) {
  if (elements.importTypeSelect) elements.importTypeSelect.value = mode;
  document.querySelectorAll("[data-import-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.importMode === mode));
  document.querySelectorAll("[data-import-panel]").forEach((panel) => { panel.hidden = panel.dataset.importPanel !== mode; });
  document.querySelectorAll("[data-import-rail-action]").forEach((button) => { button.hidden = button.dataset.importRailAction !== mode; });
}

document.querySelectorAll("[data-export-mode]").forEach((button) => button.addEventListener("click", () => setExportMode(button.dataset.exportMode)));
document.querySelectorAll("[data-import-mode]").forEach((button) => button.addEventListener("click", () => setImportMode(button.dataset.importMode)));
elements.openExportFilterDialog?.addEventListener("click", () => { renderExportFilters(); elements.exportFilterDialog.showModal(); });
elements.openExportFieldsDialog?.addEventListener("click", () => { renderExportFields(); elements.exportFieldsDialog.showModal(); });
elements.applyExportFilters?.addEventListener("click", applyExportFilters);
elements.applyExportFields?.addEventListener("click", applyExportFields);
elements.exportFilterBuilder?.addEventListener("change", handleExportFilterSelection);
elements.exportFilterDialog?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-export-filter-action]")?.dataset.exportFilterAction;
  if (!action) return;
  const checked = action === "select";
  elements.exportFilterBuilder.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = checked; input.indeterminate = false; });
});
elements.openProfileExportFields?.addEventListener("click", () => {
  renderProfileExportFieldPicker();
  elements.profileExportSelection.querySelectorAll("details").forEach((details) => { details.open = false; });
  elements.profileExportOptionsDialog.showModal();
});
elements.applyProfileExportFields?.addEventListener("click", () => {
  selectedProfileExportSchemaIds().forEach(id => state.profileReportFieldIdsBySchema.set(id, []));
  elements.profileExportSelection.querySelectorAll('[data-profile-export-global-choice]').forEach(input => {
    if (input.checked) state.profileReportGlobalRefs.add(input.dataset.profileExportGlobalChoice);
    else state.profileReportGlobalRefs.delete(input.dataset.profileExportGlobalChoice);
  });
  elements.profileExportSelection.querySelectorAll("[data-profile-export-field-schema]:checked").forEach((input) => {
    const ids = state.profileReportFieldIdsBySchema.get(input.dataset.profileExportFieldSchema) || [];
    ids.push(input.dataset.profileExportField);
    state.profileReportFieldIdsBySchema.set(input.dataset.profileExportFieldSchema, ids);
  });
  renderProfileExportFieldTags();
  elements.profileExportOptionsDialog.close();
});
elements.openProfileInfoFields?.addEventListener("click", () => { renderProfileInfoFieldPicker(); elements.profileInfoFieldsDialog.showModal(); });
elements.applyProfileInfoFields?.addEventListener("click", applyProfileInfoFieldSelection);
document.querySelectorAll("[data-profile-field-action]").forEach((button) => button.addEventListener("click", () => {
  const container = button.dataset.profileFieldTarget === "info"
    ? elements.profileInfoFieldSelection
    : elements.profileExportSelection;
  const checked = button.dataset.profileFieldAction === "select";
  container?.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
    input.indeterminate = false;
  });
  if (button.dataset.profileFieldTarget === "info") refreshProfileInfoFormatTokens(container);
}));
elements.profileInfoFieldSelection?.addEventListener("change", (event) => {
  const master = event.target.closest("[data-profile-info-category]");
  const group = event.target.closest(".profile-info-field-category");
  if (!group) return;
  const fields = [...group.querySelectorAll("[data-profile-info-field]")];
  if (master) {
    fields.forEach((field) => { field.checked = master.checked; });
    master.indeterminate = false;
    refreshProfileInfoFormatTokens(elements.profileInfoFieldSelection);
    return;
  }
  const categoryToggle = group.querySelector("[data-profile-info-category]");
  const checked = fields.filter((field) => field.checked).length;
  categoryToggle.checked = checked === fields.length;
  categoryToggle.indeterminate = checked > 0 && checked < fields.length;
  refreshProfileInfoFormatTokens(elements.profileInfoFieldSelection);
});
elements.profileInfoFieldSelection?.addEventListener("click", (event) => {
  const token = event.target.closest("[data-profile-info-token]");
  if (!token) return;
  const input = elements.profileInfoFieldSelection.querySelector(
    `[data-profile-info-format-schema="${CSS.escape(token.dataset.profileInfoTokenSchema)}"]`,
  );
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const spacer = start > 0 && !/\s$/.test(input.value.slice(0, start)) ? " " : "";
  const insertion = `${spacer}${token.dataset.profileInfoToken}`;
  input.setRangeText(insertion, start, end, "end");
  input.focus();
});
elements.profileExportSelection?.addEventListener("change", (event) => {
  const master = event.target.closest("[data-profile-export-category-option]");
  if (master) {
    master.closest("details").querySelectorAll('.search-field-option-grid input[type="checkbox"]').forEach((field) => { field.checked = master.checked; });
    master.indeterminate = false;
    return;
  }
  const group = event.target.closest(".profile-export-field-category");
  if (group) syncProfileExportCategory(group);
});
elements.profileExportProfileTableBody?.closest("table").addEventListener("change", handleProfileExportMatrixChange);
elements.profileExportFieldTags?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-profile-export-field]");
  if (!chip) return;
  const globalRef = chip.dataset.removeProfileExportGlobal;
  if (globalRef) {
    state.profileReportGlobalRefs.delete(globalRef);
    elements.profileExportFieldOptions
      ?.querySelectorAll(`[data-profile-export-global-choice="${CSS.escape(globalRef)}"]`)
      .forEach((input) => { input.checked = false; });
  } else {
    const schemaId = chip.dataset.removeProfileExportSchema;
    state.profileReportFieldIdsBySchema.set(
      schemaId,
      (state.profileReportFieldIdsBySchema.get(schemaId) || []).filter(
        (fieldId) => fieldId !== chip.dataset.removeProfileExportField,
      ),
    );
    elements.profileExportFieldOptions
      ?.querySelectorAll(
        `[data-profile-export-field-schema="${CSS.escape(schemaId)}"]` +
        `[data-profile-export-field="${CSS.escape(chip.dataset.removeProfileExportField)}"]`,
      )
      .forEach((input) => { input.checked = false; });
  }
  renderProfileExportFieldTags();
});
elements.chooseProfileExportLocation?.addEventListener("click", () => void chooseExportDestination("profile"));
elements.chooseTableExportLocation?.addEventListener("click", () => void chooseExportDestination("table"));
elements.choosePortableExportLocation?.addEventListener("click", () => void chooseExportDestination("portable"));
elements.exportIncludeAttachments?.addEventListener("change", () => {
  state.exportDestinations.table = "";
  renderExportLocations();
  elements.exportStatus.textContent = "أعد اختيار مكان الحفظ ليتوافق امتداد الملف مع خيار المرفقات.";
});
elements.exportFilterValues?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-export-filter-chip]");
  if (!chip) return;
  const selected = !chip.classList.contains("is-selected");
  chip.classList.toggle("is-selected", selected);
  chip.setAttribute("aria-pressed", String(selected));
});
elements.exportSelectedFieldSummary?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-export-result-field]");
  if (!chip) return;
  state.exportFieldIds = (state.exportFieldIds || []).filter(
    (fieldId) => fieldId !== chip.dataset.removeExportResultField,
  );
  renderExportFields();
  renderExportSelectionSummaries();
});
elements.exportFilterValues?.addEventListener("mousedown", (event) => {
  const option = event.target.closest("select[multiple] option");
  if (!option) return;
  event.preventDefault();
  option.selected = !option.selected;
  option.parentElement.dispatchEvent(new Event("change", { bubbles: true }));
});
installSharedFilterInteractions(elements.exportFilterValues, {
  schema: () => exchangeSchema(selectedExportSchemaId()) || state.schema,
  schemaId: () => selectedExportSchemaId(),
  onRemove: (fieldId) => {
    state.exportFilterIds = (state.exportFilterIds || []).filter((candidate) => candidate !== fieldId);
    renderExportFilters();
    renderExportFilterValues();
    renderExportSelectionSummaries();
  },
});
elements.importTypeSelect?.addEventListener("change", () => { resetImportWorkflow(); setImportMode(elements.importTypeSelect.value); });
elements.importMappingList?.addEventListener("change", event=>{
  if(event.target.matches('[data-import-sheet-category]')){
    const section=event.target.closest('[data-import-sheet]');
    const sheet=state.importInspection.sheet_inspections.find(item=>item.sheet_name===section.dataset.importSheet);
    renderImportSheetColumns(section,sheet);
  }
  renderImportMatchingProblems();
});
elements.importGenerateMissingIds?.addEventListener('change',renderImportMatchingProblems);
elements.ignoreAllImportFields?.addEventListener("click", ignoreAllImportFields);
elements.importTargetSchema?.addEventListener("change", resetImportWorkflow);
elements.exportTableSchema?.addEventListener("change", () => {
  state.exportFilterIds = [];
  state.exportFieldIds = [];
  renderExportFields();
  renderExportFilters();
  renderExportFilterValues();
});
elements.exportPortableSchema?.addEventListener("change", () => { elements.portableExportStatus.textContent = ""; });
elements.importSchemaTabs?.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-import-schema-tab]");
  if (!tab) return;
  elements.importTargetSchema.value = tab.dataset.importSchemaTab;
  resetImportWorkflow();
  renderExchangeTopTabs();
});
elements.exportScopeTabs?.addEventListener("click", (event) => {
  if (event.target.closest("[data-export-profile-tab]")) {
    state.exportMode = "profile";
    renderExchangeTopTabs();
    return;
  }
  const tab = event.target.closest("[data-export-schema-tab]");
  if (tab) selectExportSchema(tab.dataset.exportSchemaTab);
});
elements.clearImportHistory?.addEventListener("click", () => void clearApplicationHistory("import"));
elements.clearExportHistory?.addEventListener("click", () => void clearApplicationHistory("export"));
elements.importHistorySearch?.addEventListener("input", renderImportHistoryRows);
elements.importHistorySearchButton?.addEventListener("click", renderImportHistoryRows);
elements.importHistoryBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-import-history-details]");
  if (button) openImportHistoryDetails(button.dataset.importHistoryDetails);
  const source = event.target.closest("[data-open-import-source]");
  if (source) {
    void fetch("/api/import/history/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.dataset.openImportSource }),
    })
      .then(responseJson)
      .then(() => showToast("تم فتح ملف الاستيراد المحفوظ في التطبيق الافتراضي."))
      .catch((error) => showToast(error.message, "error"));
  }
  const remove = event.target.closest("[data-delete-import-history]");
  if (remove && await requestConfirmation("حذف عملية الاستيراد من السجل ونسختها المؤرشفة؟", {
    title: "حذف عملية استيراد",
    confirmLabel: "حذف العملية",
  })) {
    void fetch(`/api/import/history/${encodeURIComponent(remove.dataset.deleteImportHistory)}`, { method: "DELETE" })
      .then(responseJson).then(async () => { await loadImportHistory(); renderHome(); }).catch((error) => showToast(error.message, "error"));
  }
});
elements.exportHistoryBody?.addEventListener("click", async (event) => {
  const open = event.target.closest("[data-open-export-history]");
  if (open) {
    void fetch("/api/export/history/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: open.dataset.openExportHistory }) })
      .then(responseJson).then(() => showToast("تم إرسال الملف إلى التطبيق الافتراضي.")).catch((error) => showToast(error.message, "error"));
  }
  const remove = event.target.closest("[data-delete-export-history]");
  if (remove && await requestConfirmation("حذف عملية التصدير من السجل؟ لن يُحذف الملف نفسه.", {
    title: "حذف عملية تصدير",
    confirmLabel: "حذف العملية",
  })) {
    void fetch(`/api/export/history/${encodeURIComponent(remove.dataset.deleteExportHistory)}`, { method: "DELETE" })
      .then(responseJson).then(async () => { try { localStorage.removeItem(RECENT_EXPORTS_STORAGE_KEY); } catch (_error) { /* remove legacy cache */ } await loadExportHistory(); renderHome(); }).catch((error) => showToast(error.message, "error"));
  }
  if (!open && !remove) {
    const row = event.target.closest("[data-restore-export-history]");
    const entry = (state.exportHistoryEntries || []).find((item) => item.id === row?.dataset.restoreExportHistory);
    if (entry) restoreExportHistoryConfiguration(entry);
  }
});
elements.exportHistorySearch?.addEventListener("input", renderExportHistoryRows);
elements.exportHistorySearchButton?.addEventListener("click", renderExportHistoryRows);
elements.finalizeImportResult?.addEventListener("click", () => void finalizeImportResult());
elements.newImportButton?.addEventListener("click", () => { resetImportWorkflow(); document.querySelector(`[data-import-mode="${elements.importTypeSelect.value}"]`)?.focus(); });
elements.clearImportButton?.addEventListener("click", resetImportWorkflow);
elements.newExportButton?.addEventListener("click", () => { resetExportWorkflow(); state.exportMode = "profile"; renderExchangeTopTabs(); elements.profileExportRecordCode?.focus(); });
elements.clearExportButton?.addEventListener("click", resetExportWorkflow);
