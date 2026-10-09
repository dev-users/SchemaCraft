function activeWorkspaceSchemas() {
  return (state.workspace?.schemas || []).filter((schema) => !schema.archived);
}

async function loadWorkspaceMetadata() {
  try {
    const response = await nativeFetch("/api/workspace", { cache: "no-store" });
    if (!response.ok) {
      state.workspace = null;
      state.activeSchemaId = "";
      return;
    }
    const workspacePayload = await response.json();
    state.workspace = workspacePayload;
    if (Array.isArray(workspacePayload.recent_record_history)) {
      state.recentRecordHistory = workspacePayload.recent_record_history.slice(0, 500);
      writeLocalHistory(RECENT_RECORDS_STORAGE_KEY, state.recentRecordHistory);
    }
    const requestedSchema = state.startupIntent?.schemaId;
    state.activeSchemaId = workspacePayload.schemas?.some(
      (schema) => schema.id === requestedSchema && !schema.archived,
    )
      ? requestedSchema
      : workspacePayload.active_schema_id || "";
    ["entry", "builder", "search"].forEach((page) => {
      if (!state.pageSchemaIds[page] || !workspacePayload.schemas?.some((schema) => schema.id === state.pageSchemaIds[page] && !schema.archived)) {
        state.pageSchemaIds[page] = state.activeSchemaId;
      }
    });
    state.workspaceDefinitions = workspacePayload.definitions || {};
    const loadedDefinitions = workspacePayload.global_definitions || { categories: {}, fields: {}, revision: 0 };
    if (generalDraftDirty()) state.generalLoadedDefinitions = loadedDefinitions;
    else state.globalDefinitions = loadedDefinitions;
    state.workspaceSettings = workspacePayload.workspace_settings || { shortcuts: {} };
    applyWorkspaceBackgroundSettings();
    state.auditUserFeatureAvailable = Boolean(workspacePayload.audit_users);
    state.auditUsers = workspacePayload.audit_users || { current_user: "", users: [] };
  } catch (_error) {
    // Release 2-compatible test servers expose only the single-schema API.
    state.workspace = null;
    state.activeSchemaId = "";
    state.auditUserFeatureAvailable = false;
  }
}

function enhancePageSchemaTabs(container) {
  if (!container) return;
  container.querySelector("[data-all-schemas]")?.remove();
  const tabs = [...container.querySelectorAll(".schema-tab")];
  tabs.forEach((tab) => { tab.title = tab.textContent.trim(); });
  if (tabs.length <= 5) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary all-schemas-button";
  button.dataset.allSchemas = "";
  button.append(actionIcon("search"), document.createTextNode(scText("كل التصاميم")));
  button.addEventListener("click", () => {
    const dialog = document.createElement("dialog");
    dialog.className = "editor-dialog schema-picker-dialog";
    dialog.setAttribute("aria-label", scText("كل التصاميم"));
    const heading = document.createElement("div");
    heading.className = "dialog-heading";
    const title = document.createElement("h2");
    title.textContent = scText("كل التصاميم");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", scText("إغلاق"));
    close.onclick = () => dialog.close();
    heading.append(title, close);
    const content = document.createElement("div");
    content.className = "dialog-content";
    const query = document.createElement("input");
    query.type = "search";
    query.className = "control";
    query.placeholder = scText("ابحث باسم التصميم");
    query.setAttribute("aria-label", query.placeholder);
    const list = document.createElement("div");
    list.className = "schema-picker-results";
    const render = () => {
      list.replaceChildren();
      tabs.filter((tab) => normalizedComparison(tab.textContent).includes(normalizedComparison(query.value))).forEach((tab) => {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = `button ${tab.classList.contains("is-active") ? "button-primary" : "button-secondary"}`;
        choice.textContent = tab.textContent;
        choice.title = tab.title;
        choice.onclick = () => { dialog.close(); tab.click(); };
        list.append(choice);
      });
      if (!list.childElementCount) list.textContent = scText("لا توجد نتائج");
    };
    query.addEventListener("input", render);
    content.append(query, list);
    dialog.append(heading, content);
    dialog.addEventListener("close", () => { dialog.remove(); if (button.isConnected) button.focus(); }, { once: true });
    document.body.append(dialog);
    render();
    dialog.showModal();
    query.focus();
  });
  container.append(button);
}

function renderSchemaTabs(container, mode) {
  if (!container) return;
  const ownerDocument = container.ownerDocument;
  if (!ownerDocument) return;
  container.replaceChildren();
  if (mode === "builder") {
    const globalButton = ownerDocument.createElement("button");
    globalButton.type = "button";
    globalButton.className = `schema-tab schema-tab-global${state.builderScope === "global" ? " is-active" : ""}`;
    globalButton.dataset.builderGlobalTab = "true";
    globalButton.textContent = scText("التعريفات العامة");
    globalButton.setAttribute("aria-current", state.builderScope === "global" ? "page" : "false");
    const divider = ownerDocument.createElement("span");
    divider.className = "schema-tab-divider";
    divider.setAttribute("aria-hidden", "true");
    container.append(globalButton, divider);
  }
  activeWorkspaceSchemas().forEach((schema) => {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "schema-tab";
    button.dataset.schemaTab = schema.id;
    button.dataset.schemaTabMode = mode;
    button.textContent = displaySchemaName(schema);
    const cached = mode === "builder"
      ? state.builderTabStates.get(schema.id)
      : state.schemaTabStates.get(schema.id);
    const dirty = schema.id === state.activeSchemaId
      ? (mode === "builder" ? state.dirty : state.recordDirty)
      : cached?.dirty;
    if (dirty) {
      button.classList.add("is-dirty");
      const indicator = ownerDocument.createElement("span");
      indicator.className = "schema-tab-dirty-indicator";
      indicator.textContent = "•";
      indicator.setAttribute("aria-label", scText("تغييرات غير محفوظة"));
      button.append(indicator);
    }
    const selectedSchemaId = state.pageSchemaIds?.[mode] || state.activeSchemaId;
    if (schema.id === selectedSchemaId && !(mode === "builder" && state.builderScope === "global")) {
      button.classList.add("is-active");
      button.setAttribute("aria-current", "page");
    }
    container.append(button);
  });
  enhancePageSchemaTabs(container);
}

function renderAllSchemaTabs() {
  renderSchemaTabs(elements.entrySchemaTabs, "entry");
  renderSchemaTabs(elements.builderSchemaTabs, "builder");
}

function preserveActiveSchemaState() {
  if (!state.activeSchemaId || !state.schema) return;
  if (state.recordDirty) saveDraftLocally();
  state.schemaTabStates.set(state.activeSchemaId, {
    dirty: state.recordDirty,
    draftSnapshot: state.recordDirty ? collectDraftSnapshot() : null,
    selectedRecordCode: state.selectedRecordCode,
    searchFieldIds: deepClone(state.searchFieldIds),
    searchMatches: deepClone(state.searchMatches),
    searchResultIndex: state.searchResultIndex,
    scrollTop: elements.page?.scrollTop || 0,
    focusId: document.activeElement?.id || "",
  });
  state.builderTabStates.set(state.activeSchemaId, {
    dirty: state.dirty,
    draftSchema: deepClone(state.draftSchema),
    activeBuilderCategoryId: state.activeBuilderCategoryId,
    scrollTop: elements.page?.scrollTop || 0,
  });
}

function restoreActiveSchemaState(mode) {
  const entry = state.schemaTabStates.get(state.activeSchemaId);
  const builder = state.builderTabStates.get(state.activeSchemaId);
  if (builder?.dirty && builder?.draftSchema) {
    state.draftSchema = deepClone(builder.draftSchema);
    state.dirty = Boolean(builder.dirty);
    state.activeBuilderCategoryId = builder.activeBuilderCategoryId || null;
    renderBuilder();
  }
  if (entry) {
    state.searchFieldIds = deepClone(entry.searchFieldIds);
    state.searchMatches = deepClone(entry.searchMatches || []);
    state.searchResultIndex = entry.searchResultIndex || 0;
    if (entry.dirty && entry.draftSnapshot) {
      // Schema tabs must preserve unsaved work even when the user has disabled
      // local draft autosave.  The localStorage draft remains a crash-recovery
      // convenience; this in-memory snapshot is the tab state itself.
      state.skipNextLocalDraftRestore = true;
      restoreDraftSnapshot(entry.draftSnapshot, { notify: false });
    } else if (entry.selectedRecordCode && !entry.dirty) {
      void performLoadRecord(entry.selectedRecordCode, {
        force: true,
        silent: true,
        scroll: false,
        skipNavigationGuard: true,
      });
    }
    window.setTimeout(() => {
      if (elements.page) elements.page.scrollTop = entry.scrollTop || 0;
    }, 0);
  }
  renderAllSchemaTabs();
}

function fillSchemaSelect(select, { includeArchived = false } = {}) {
  if (!select) return;
  select.replaceChildren();
  const schemas = (state.workspace?.schemas || []).filter(
    (schema) => includeArchived || !schema.archived,
  );
  schemas.forEach((schema) => {
    const option = document.createElement("option");
    option.value = schema.id;
    option.textContent = schema.archived
      ? scText`${displaySchemaName(schema)} (مؤرشف)`
      : displaySchemaName(schema);
    select.append(option);
  });
  select.value = state.activeSchemaId;
}

function renderWorkspaceChrome() {
  const schemas = activeWorkspaceSchemas();
  const multiple = schemas.length > 1;
  renderAllSchemaTabs();
  if (elements.builderActiveSchemaName) {
    elements.builderActiveSchemaName.textContent =
      displaySchemaName(state.schema) ||
      displaySchemaName(schemas.find((schema) => schema.id === state.activeSchemaId)) ||
      scText("التصميم الحالي");
  }
  if (elements.schemaManagementPanel) {
    elements.schemaManagementPanel.hidden = !state.workspace;
    let sourceStatus = elements.schemaManagementPanel.querySelector('.schema-follow-status');
    if (!sourceStatus) {
      sourceStatus = document.createElement('p');
      sourceStatus.className = 'muted-text schema-follow-status';
      elements.schemaManagementPanel.append(sourceStatus);
    }
    const sourceId = (state.workspace?.schemas || []).find((schema) => schema.id === state.activeSchemaId)?.profile_source_schema_id;
    sourceStatus.hidden = !sourceId;
    sourceStatus.textContent = sourceId
      ? scText`مصدر إنشاء وحذف الملفات: ${displaySchemaName((state.workspace?.schemas || []).find((schema) => schema.id === sourceId)) || sourceId}`
      : '';
  }
  const archived = (state.workspace?.schemas || []).filter((schema) => schema.archived);
  if (elements.archivedSchemaField) {
    elements.archivedSchemaField.hidden = !archived.length;
    elements.restoreSchemaButton.hidden = !archived.length;
    elements.createFromArchivedSchemaButton.hidden = !archived.length;
    elements.archivedSchemaSelect.replaceChildren();
    archived.forEach((schema) => {
      elements.archivedSchemaSelect.append(new Option(displaySchemaName(schema), schema.id));
    });
  }
  if (elements.linkExistingProfileButton) {
    elements.linkExistingProfileButton.hidden = !multiple;
  }
  renderMultiSchemaSearch();
}

async function switchActiveSchema(schemaId, options = {}) {
  const pageMode = ["entry", "builder", "search"].includes(options.mode)
    ? options.mode
    : "";
  if (!schemaId || schemaId === state.activeSchemaId) {
    if (pageMode) state.pageSchemaIds[pageMode] = schemaId;
    if (options.mode) performSwitchMode(options.mode);
    if (pageMode === "search" && state.searchType === "schema") {
      renderFullSearchFilters();
    }
    renderAllSchemaTabs();
    if(options.openCode)return await performLoadRecord(options.openCode,{force:true,skipNavigationGuard:true});
    return true;
  }
  if (state.schemaSwitching) return false;
  state.schemaSwitching = true;
  preserveActiveSchemaState();
  const previousMode = state.mode;
  try {
    if (state.workspace) {
      const response = await nativeFetch("/api/workspace/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema_id: schemaId }),
      });
      await responseJson(response);
    }
    state.activeSchemaId = schemaId;
    if (pageMode) state.pageSchemaIds[pageMode] = schemaId;
    state.searchFieldIds = null;
    state.fullSearchFieldIds = null;
    state.fullSearchColumnIds = null;
    state.fullSearchCriteria = null;
    state.recordDirty = false;
    state.dirty = false;
    state.settingsDirty = false;
    state.settingsDirtyCategory = "";
    await loadSchema({ preservePage: true, forceResetRecord: true });
    const targetMode = options.mode || previousMode;
    performSwitchMode(targetMode);
    if(!options.openCode)restoreActiveSchemaState(targetMode);
    if (options.openCode) {
      await performLoadRecord(options.openCode, {
        force: true,
        skipNavigationGuard: true,
      });
    }
    return true;
  } catch (error) {
    showToast(error.message, "error");
    renderAllSchemaTabs();
    return false;
  } finally {
    state.schemaSwitching = false;
  }
}

async function refreshWorkspaceAfterManagement(result) {
  await loadWorkspaceMetadata();
  const active = result?.schema?.active_schema_id || state.workspace?.active_schema_id;
  if (active) {
    state.activeSchemaId = active;
    state.pageSchemaIds.builder = active;
  }
  await loadSchema({ preservePage: true, forceResetRecord: true });
  renderWorkspaceChrome();
}

function requestNewSchemaDefinition() {
  const dialog = document.getElementById("create-schema-dialog");
  const form = document.getElementById("create-schema-form");
  const name = document.getElementById("create-schema-name");
  const follow = document.getElementById("create-schema-follow");
  const source = document.getElementById("create-schema-source");
  form.reset();
  source.replaceChildren(...activeWorkspaceSchemas().map((schema) => new Option(schema.name, schema.id)));
  source.value = state.activeSchemaId;
  const toggle = () => {
    document.getElementById("create-schema-source-field").hidden = !follow.checked;
    document.getElementById("create-schema-follow-description").hidden = !follow.checked;
    source.required = follow.checked;
  };
  toggle();
  return new Promise((resolve) => {
    let result = null;
    const submit = (event) => {
      event.preventDefault();
      if (!name.value.trim() || (follow.checked && !source.value)) return;
      result = { name: name.value.trim(), profile_source_schema_id: follow.checked ? source.value : "" };
      dialog.close();
    };
    follow.addEventListener("change", toggle);
    form.addEventListener("submit", submit);
    dialog.addEventListener("close", () => {
      follow.removeEventListener("change", toggle);
      form.removeEventListener("submit", submit);
      resolve(result);
    }, { once: true });
    dialog.showModal();
    name.focus();
  });
}

async function runSchemaManagement(action) {
  if (!builderUnlocked()) {
    showToast(scText("إدارة التصاميم متاحة في وضع الإدارة فقط."), "error");
    return;
  }
  let name = "";
  let profileSourceId = "";
  if (action === "create") {
    const definition = await requestNewSchemaDefinition();
    if (!definition) return;
    name = definition.name;
    profileSourceId = definition.profile_source_schema_id;
  }
  if (["duplicate", "rename"].includes(action)) {
    const currentName = state.schema?.schema_name || "";
    name = await requestText({
      title: action === "rename" ? scText("إعادة تسمية التصميم") : action === "duplicate" ? scText("نسخ بنية التصميم") : scText("تصميم جديد"),
      label: action === "rename" ? scText("الاسم الجديد") : scText("اسم التصميم"),
      value: action === "duplicate" ? scText`${currentName} - نسخة` : action === "rename" ? currentName : "",
      confirmLabel: action === "rename" ? scText("حفظ الاسم") : scText("إنشاء التصميم"),
    });
    if (name == null || !name.trim()) return;
  }
  if (action === "archive") {
    if (!(await requestConfirmation(scText("ستُنشأ نسخة احتياطية ثم يُؤرشف التصميم الحالي."), {
      title: scText("أرشفة التصميم"),
      confirmLabel: scText("إنشاء النسخة والأرشفة"),
    }))) {
      return;
    }
  }
  try {
    const response = await nativeFetch("/api/workspace/schemas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schema-ID": state.activeSchemaId,
      },
      body: JSON.stringify({
        action,
        name,
        schema_id: state.activeSchemaId,
        template_schema_id: action === "duplicate" ? state.activeSchemaId : "",
        profile_source_schema_id: profileSourceId,
        language: uiLanguage(),
      }),
    });
    const result = await responseJson(response);
    await refreshWorkspaceAfterManagement(result);
    showToast(scText("تم تحديث التصاميم بنجاح."));
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function restoreArchivedSchema() {
  const schemaId = elements.archivedSchemaSelect?.value;
  if (!schemaId || !builderUnlocked()) return;
  try {
    const response = await nativeFetch("/api/workspace/schemas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Schema-ID": state.activeSchemaId,
      },
      body: JSON.stringify({ action: "restore", schema_id: schemaId }),
    });
    const result = await responseJson(response);
    await refreshWorkspaceAfterManagement(result);
    showToast(scText("تمت استعادة التصميم المؤرشف."));
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createFromArchivedSchema() {
  const templateId = elements.archivedSchemaSelect?.value;
  if (!templateId || !builderUnlocked()) return;
  const template = (state.workspace?.schemas || []).find((schema) => schema.id === templateId);
  const name = await requestText({
    title: scText("إنشاء تصميم من بنية مؤرشفة"),
    message: scText("تُنسخ البنية فقط دون البيانات."),
    label: scText("اسم التصميم الجديد"),
    value: scText`${template?.name || scText("تصميم")} - جديد`,
    confirmLabel: scText("إنشاء التصميم"),
  });
  if (name == null || !name.trim()) return;
  try {
    const response = await nativeFetch("/api/workspace/schemas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schema-ID": state.activeSchemaId },
      body: JSON.stringify({ action: "duplicate", name, template_schema_id: templateId }),
    });
    const result = await responseJson(response);
    await refreshWorkspaceAfterManagement(result);
    showToast(scText("تم إنشاء تصميم جديد بالبنية نفسها وبيانات فارغة."));
  } catch (error) { showToast(error.message, "error"); }
}

async function deleteWorkspaceSchema() {
  if (!builderUnlocked()) return;
  const selectedArchived = elements.archivedSchemaSelect?.value;
  const targetId = selectedArchived || state.activeSchemaId;
  const target = (state.workspace?.schemas || []).find((schema) => schema.id === targetId);
  if (!target) return;
  const confirmationName = await requestText({
    title: scText("حذف التصميم نهائيًا"),
    message: scText("سيُحذف التصميم مع كل بياناته ومرفقاته، وستُنشأ نسخة احتياطية أولًا."),
    label: scText`اكتب الاسم كاملًا للتأكيد: ${target.name}`,
    confirmLabel: scText("حذف التصميم"),
  });
  if (confirmationName == null) return;
  try {
    const response = await nativeFetch("/api/workspace/schemas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Schema-ID": state.activeSchemaId },
      body: JSON.stringify({ action: "delete", schema_id: targetId, confirmation_name: confirmationName }),
    });
    const result = await responseJson(response);
    await refreshWorkspaceAfterManagement(result);
    showToast(scText("تم حذف التصميم بعد إنشاء النسخة الاحتياطية."));
  } catch (error) { showToast(error.message, "error"); }
}

function multiSearchEligibleFields(schema) {
  return (schema?.categories || []).flatMap((category) =>
    category.fields
      .filter((field) => !isSystemField(field) && field.type !== "file")
      .map((field) => ({ category, field })),
  );
}

function multiSearchConfig(schemaId) {
  if (!state.multiSearchConfigs.has(schemaId)) {
    const schema = state.workspaceDefinitions[schemaId];
    const fields = multiSearchEligibleFields(schema);
    const defaultColumns = fields
      .filter(({ field }) => field.show_in_results)
      .map(({ field }) => field.id);
    state.multiSearchConfigs.set(schemaId, {
      schemaId,
      schema,
      selected: schemaId === state.activeSchemaId,
      offset: 0,
      resultFieldIds: defaultColumns.length
        ? defaultColumns
        : fields.slice(0, 4).map(({ field }) => field.id),
    });
  }
  return state.multiSearchConfigs.get(schemaId);
}

function createMultiFilterControl(field, schemaId) {
  let control;
  if (["select", "yes_no"].includes(field.type)) {
    control = document.createElement("select");
    control.append(new Option(scText("الكل"), ""));
    (field.options || []).filter((option) => option.active !== false).forEach((option) => {
      control.append(new Option(displayLabel(option), option.id || option.label));
    });
  } else if (field.type === "checkbox") {
    control = document.createElement("select");
    control.append(new Option(scText("الكل"), ""), new Option("نعم", "true"), new Option("لا", "false"));
  } else if (field.type === "checkbox_group") {
    control = document.createElement("select");
    control.multiple = true;
    (field.options || []).filter((option) => option.active !== false).forEach((option) => {
      control.append(new Option(displayLabel(option), option.id || option.label));
    });
  } else {
    control = document.createElement("input");
    control.type = field.type === "number" ? "text" : "text";
    control.placeholder = displayLabel(field, "placeholder") || "";
  }
  control.className = "control";
  control.dataset.multiFilterField = field.id;
  control.dataset.multiSchema = schemaId;
  return control;
}

function renderMultiQueryCard(config) {
  const schema = config.schema;
  const card = document.createElement("details");
  card.className = "workspace-panel multi-schema-query-card";
  card.open = true;
  card.dataset.multiQuerySchema = config.schemaId;
  const summary = document.createElement("summary");
  summary.textContent = displaySchemaName(schema) || displayLabel(schema.app, "title") || scText("تصميم");
  card.append(summary);

  const systemGrid = document.createElement("div");
  systemGrid.className = "field-grid compact-grid multi-system-filters";
  const idField = document.createElement("label");
  idField.className = "field";
  idField.innerHTML = "<span>ID</span>";
  const idInput = document.createElement("input");
  idInput.className = "control";
  idInput.dir = "ltr";
  idInput.dataset.multiRecordCode = config.schemaId;
  idField.append(idInput);
  const archived = document.createElement("label");
  archived.className = "check-field multi-archive-filter";
  const archivedInput = document.createElement("input");
  archivedInput.type = "checkbox";
  archivedInput.dataset.multiArchived = config.schemaId;
  archived.append(archivedInput, document.createTextNode(scText(" إظهار المؤرشفة")));
  systemGrid.append(idField);
  systemGrid.append(archived);
  card.append(systemGrid);

  const fields = multiSearchEligibleFields(schema);
  const filterDetails = document.createElement("details");
  filterDetails.className = "multi-query-options";
  const filterSummary = document.createElement("summary");
  filterSummary.textContent = scText("مرشحات الحقول");
  filterDetails.append(filterSummary);
  const filterGrid = document.createElement("div");
  filterGrid.className = "field-grid compact-grid";
  fields.filter(({ field }) => field.searchable).forEach(({ category, field }) => {
    const wrapper = document.createElement("label");
    wrapper.className = "field";
    const label = document.createElement("span");
    label.textContent = `${displayLabel(category)} — ${displayLabel(field)}`;
    const control = createMultiFilterControl(field, config.schemaId);
    const emptyLabel = document.createElement("label");
    emptyLabel.className = "check-field empty-value-filter";
    const empty = document.createElement("input");
    empty.type = "checkbox";
    empty.dataset.multiEmptyField = field.id;
    empty.addEventListener("change", () => {
      control.disabled = empty.checked;
      if (empty.checked) setControlValue(control, "");
    });
    emptyLabel.append(empty, document.createTextNode(scText("القيمة فارغة")));
    wrapper.append(label, control, emptyLabel);
    filterGrid.append(wrapper);
  });
  if (!filterGrid.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = scText("لا توجد حقول معلّمة للبحث في هذا التصميم.");
    filterGrid.append(empty);
  }
  filterDetails.append(filterGrid);
  card.append(filterDetails);

  const columnDetails = document.createElement("details");
  columnDetails.className = "multi-query-options";
  const columnSummary = document.createElement("summary");
  columnSummary.textContent = scText("أعمدة جدول النتائج");
  columnDetails.append(columnSummary);
  const columnGrid = document.createElement("div");
  columnGrid.className = "multi-column-grid";
  fields.forEach(({ category, field }) => {
    const label = document.createElement("label");
    label.className = "check-field";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = config.resultFieldIds.includes(field.id);
    checkbox.dataset.multiResultField = field.id;
    checkbox.dataset.multiSchema = config.schemaId;
    label.append(checkbox, document.createTextNode(`${displayLabel(category)} — ${displayLabel(field)}`));
    columnGrid.append(label);
  });
  columnDetails.append(columnGrid);
  card.append(columnDetails);
  return card;
}

function renderGlobalSearchSettings() {
  if (!elements.globalSearchFieldOptions) return;
  const fields = Object.values(state.globalDefinitions?.fields || {});
  elements.globalSearchFieldOptions.replaceChildren();
  fields.forEach((item) => {
    const definition = item.definition || {};
    if (definition.type === "file" || isSystemField(definition)) return;
    const label = document.createElement("label");
    label.className = "check-field";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.globalSearchFieldRefs.includes(item.id);
    checkbox.dataset.globalSearchFieldOption = item.id;
    label.append(checkbox, document.createTextNode(displayLabel(definition) || item.id));
    elements.globalSearchFieldOptions.append(label);
  });
  if (!elements.globalSearchFieldOptions.childElementCount) {
    elements.globalSearchFieldOptions.textContent = scText("لا توجد حقول عامة قابلة للبحث بعد.");
  }
}

function renderGlobalSearchCriteria() {
  if (!elements.globalSearchFields) return;
  elements.globalSearchFields.replaceChildren();
  state.globalSearchFieldRefs.forEach((globalRef) => {
    const definition = state.globalDefinitions?.fields?.[globalRef]?.definition;
    if (!definition) return;
    const wrapper = document.createElement("label");
    wrapper.className = "field";
    const label = document.createElement("span");
    label.textContent = displayLabel(definition);
    const control = createMultiFilterControl(definition, "global");
    control.removeAttribute("data-multi-filter-field");
    control.dataset.globalSearchField = globalRef;
    if (["text", "textarea"].includes(definition.type)) {
      control.placeholder = scText("يمكن إدخال عدة قيم مفصولة بسطر جديد");
    }
    wrapper.append(label, control);
    elements.globalSearchFields.append(wrapper);
  });
}

function syncGeneralSearchMode() {
  document.querySelectorAll("[data-search-type]").forEach((button) => {
    const active = button.dataset.searchType === state.searchType;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.schemaSearchWorkflow.hidden = state.searchType !== "schema";
  elements.multiSchemaSearch.hidden = state.searchType !== "global";
  elements.searchSchemaChoiceList?.querySelectorAll("[data-search-schema]").forEach((button) => {
    const active = state.searchType === "schema" && button.dataset.searchSchema === (state.pageSchemaIds.search || state.activeSchemaId);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function applyGeneralSearchSettings(kind) {
  activeWorkspaceSchemas().forEach((schema) => {
    const config = globalQueryConfig(schema.id);
    if (!config.selected) return;
    if (kind === "filter") {
      config.searchFieldIds = [...elements.fullSearchFilterOptions.querySelectorAll(`[data-global-query-search-field="${CSS.escape(schema.id)}"]:checked`)].map((input) => input.value);
    } else {
      config.displayFieldIds = [...elements.fullSearchColumnOptions.querySelectorAll(`[data-global-query-display-field="${CSS.escape(schema.id)}"]:checked`)].map((input) => input.value);
    }
  });
  renderGlobalSearchSelectionSummaries();
  syncGeneralSearchMode();
}

function globalQueryConfig(schemaId) {
  if (!state.globalQueryConfigs.has(schemaId)) {
    const definition = state.workspaceDefinitions?.[schemaId];
    const mainFields = (definition?.categories || []).filter((category) => category.kind === "main").flatMap((category) => category.fields || []).filter((field) => field.type !== "file");
    const defaults = mainFields.filter((field) => field.show_in_results).map((field) => field.id);
    state.globalQueryConfigs.set(schemaId, { schemaId, selected: schemaId === (state.pageSchemaIds.search || state.activeSchemaId), searchFieldIds: [], displayFieldIds: defaults });
  }
  return state.globalQueryConfigs.get(schemaId);
}

function fieldTreeForSchema(schemaId, attribute, selectedIds) {
  const root = document.createElement("div");
  root.className = "tree-field-options";
  const definition = state.workspaceDefinitions?.[schemaId];
  (definition?.categories || []).forEach((category) => {
    const fields = (category.fields || []).filter((field) => field.type !== "file");
    if (!fields.length) return;
    const group = document.createElement("details");
    group.className = "tree-option-group search-field-option-group";
    group.dataset.globalOptionCategory = category.id;
    group.dataset.globalOptionAttribute = attribute;
    group.open = false;
    const summary = document.createElement("summary");
    summary.className = "search-field-option-category";
    const categoryLabel = document.createElement("label");
    categoryLabel.className = "check-field";
    const categoryToggle = document.createElement("input");
    categoryToggle.type = "checkbox";
    categoryToggle.dataset.globalCategoryOption = category.id;
    categoryToggle.dataset.globalCategorySchema = schemaId;
    const categoryText = document.createElement("span");
    categoryText.textContent = displayLabel(category);
    categoryLabel.append(categoryToggle, categoryText);
    summary.append(categoryLabel);
    const list = document.createElement("div");
    list.className = "search-field-option-grid";
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = "check-field";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = field.id;
      input.dataset[attribute] = schemaId;
      input.checked = selectedIds.includes(field.id);
      label.append(input, document.createTextNode(displayLabel(field)));
      const row = document.createElement("div"); row.className = "search-option-row"; row.append(label);
      list.append(row);
    });
    group.append(summary, list);
    root.append(group);
    const selectedCount = [...list.querySelectorAll('input[type="checkbox"]')].filter((input) => input.checked).length;
    categoryToggle.checked = selectedCount === fields.length;
    categoryToggle.indeterminate = selectedCount > 0 && selectedCount < fields.length;
  });
  return root;
}

function renderGlobalSchemaFieldSettings(kind, options = {}) {
  const container = kind === "filter" ? elements.fullSearchFilterOptions : elements.fullSearchColumnOptions;
  const attribute = kind === "filter" ? "globalQuerySearchField" : "globalQueryDisplayField";
  container.replaceChildren();
  activeWorkspaceSchemas().filter((schema) => globalQueryConfig(schema.id).selected).forEach((schema) => {
    const config = globalQueryConfig(schema.id);
    const definition = state.workspaceDefinitions?.[schema.id];
    const mainFields = (definition?.categories || []).filter((category) => category.kind === "main").flatMap((category) => category.fields || []).filter((field) => field.type !== "file");
    const defaults = kind === "filter" ? [] : mainFields.filter((field) => field.show_in_results).map((field) => field.id);
    const selectedIds = options.fresh
      ? []
      : (options.reset ? defaults : (kind === "filter" ? config.searchFieldIds : config.displayFieldIds));
    const section = document.createElement("section");
    section.className = "global-schema-config-section";
    const title = document.createElement("h3");
    title.textContent = displaySchemaName(schema);
    section.append(title, fieldTreeForSchema(schema.id, attribute, selectedIds));
    container.append(section);
  });
  if (!container.childElementCount) emptyDashboard(container, scText("اختر تصميمًا واحدًا على الأقل أولًا."));
}

function renderGlobalSearchSelectionSummaries() {
  const render = (container, kind) => {
    if (!container) return;
    container.replaceChildren();
    const selectedSchemas = activeWorkspaceSchemas().filter((schema) => globalQueryConfig(schema.id).selected);
    let count = 0;
    selectedSchemas.forEach((schema) => {
      const config = globalQueryConfig(schema.id);
      const ids = kind === "filter" ? config.searchFieldIds : config.displayFieldIds;
      const definition = state.workspaceDefinitions?.[schema.id];
      if (!ids.length && kind === "filter") {
        const chip = document.createElement("span");
        chip.className = "selection-chip";
        chip.textContent = scText`${displaySchemaName(schema)}: كل الحقول المناسبة`;
        container.append(chip);
        count += 1;
        return;
      }
      (definition?.categories || []).forEach((category) => {
        const fields = (category.fields || []).filter((field) => ids.includes(field.id));
        if (!fields.length) return;
        const group = document.createElement("section");
        group.className = "selection-category-group";
        const heading = document.createElement("strong");
        heading.textContent = `${displaySchemaName(schema)} — ${displayLabel(category)}`;
        const chips = document.createElement("div");
        chips.className = "selection-chip-list";
        fields.forEach((field) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "selection-chip selection-chip-button";
          if (kind === "column") {
            chip.dataset.removeGlobalResultField = field.id;
            chip.dataset.removeGlobalResultSchema = schema.id;
            chip.title = scText("إزالة من حقول النتائج");
          } else {
            chip.dataset.removeGlobalFilterField = field.id;
            chip.dataset.removeGlobalFilterSchema = schema.id;
            chip.title = scText("إزالة من حقول المطابقة");
          }
          chip.textContent = displayLabel(field);
          chips.append(chip);
          count += 1;
        });
        group.append(heading, chips);
        container.append(group);
      });
    });
    if (!count) {
      const empty = document.createElement("span");
      empty.className = "selection-chip selection-chip-empty";
      empty.textContent = scText("لا توجد اختيارات");
      container.append(empty);
    }
  };
  render(elements.globalFilterSelectionSummary, "filter");
  render(elements.globalFieldSelectionSummary, "column");
}

function renderMultiSchemaSearch() {
  if (!elements.multiSchemaSearch) return;
  const schemas = activeWorkspaceSchemas();
  elements.searchSchemaChoiceList?.replaceChildren();
  schemas.forEach((schemaInfo) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `schema-tab${state.searchType === "schema" && schemaInfo.id === (state.pageSchemaIds.search || state.activeSchemaId) ? " is-active" : ""}`;
    button.dataset.searchSchema = schemaInfo.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(state.searchType === "schema" && schemaInfo.id === (state.pageSchemaIds.search || state.activeSchemaId)));
    button.textContent = displaySchemaName(schemaInfo);
    elements.searchSchemaChoiceList?.append(button);
  });
  enhancePageSchemaTabs(elements.searchSchemaChoiceList?.closest(".search-scope-strip"));
  elements.globalQuerySchemaList?.replaceChildren();
  schemas.forEach((schemaInfo) => {
    const config = globalQueryConfig(schemaInfo.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-secondary schema-choice-button${config.selected ? " is-active" : ""}`;
    button.dataset.globalQuerySchema = schemaInfo.id;
    button.setAttribute("aria-pressed", String(config.selected));
    button.textContent = displaySchemaName(schemaInfo);
    elements.globalQuerySchemaList?.append(button);
  });
  renderGlobalSearchSelectionSummaries();
  syncGeneralSearchMode();
}

function multiControlValue(control) {
  if (control.multiple) {
    return [...control.selectedOptions].map((option) => option.value);
  }
  return control.value;
}

function collectMultiCriteria(config) {
  const root = elements.multiSchemaQueryList.querySelector(
    `[data-multi-query-schema="${CSS.escape(config.schemaId)}"]`,
  );
  const searchableIds = [];
  const criteria = {
    _record_code: root.querySelector("[data-multi-record-code]")?.value.trim() || "",
    _include_archived: Boolean(root.querySelector("[data-multi-archived]")?.checked),
    _allow_empty: true,
    _offset: config.offset || 0,
    _limit: Number(config.schema.app?.search_page_size || 50),
  };
  root.querySelectorAll("[data-multi-filter-field]").forEach((control) => {
    searchableIds.push(control.dataset.multiFilterField);
    if (root.querySelector(
      `[data-multi-empty-field="${CSS.escape(control.dataset.multiFilterField)}"]`,
    )?.checked) {
      criteria[control.dataset.multiFilterField] = { empty: true };
      return;
    }
    const value = multiControlValue(control);
    if (Array.isArray(value) ? value.length : String(value || "").trim()) {
      criteria[control.dataset.multiFilterField] = value;
    }
  });
  criteria._search_field_ids = searchableIds;
  config.resultFieldIds = [
    ...root.querySelectorAll("[data-multi-result-field]:checked"),
  ].map((control) => control.dataset.multiResultField);
  criteria._result_field_ids = config.resultFieldIds;
  return criteria;
}

function renderMultiResults() {
  elements.multiSchemaResults.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const [schemaId, result] of state.multiSearchResults) {
    const section = document.createElement("section");
    section.className = "workspace-panel multi-result-section global-result-group";
    const heading = document.createElement("div");
    heading.className = "search-table-summary";
    const title = document.createElement("strong");
    title.textContent = scText`${displaySchemaName(result)} — ${result.total} نتيجة`;
    heading.append(title);
    section.append(heading);
    const columnMap = new Map();
    (result.matches || []).forEach((match) => {
      (match.details || []).forEach((detail) => {
        const key = detail.field_id || detail.label;
        if (!columnMap.has(key)) columnMap.set(key, { id: key, label: detail.label || key, schema_id: schemaId });
      });
    });
    const columns = [...columnMap.values()];
    const tableScroll = document.createElement("div");
    tableScroll.className = "table-scroll global-result-table-scroll";
    const table = document.createElement("table");
    table.className = "data-table records-table global-result-table";
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["ID", scText("الحالة"), ...columns.map((column) => displayLabel(column)), scText("موضع المطابقة"), scText("الإجراءات")].forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement("tbody");
    (result.matches || []).forEach((match) => {
      const row = document.createElement("tr");
      const code = document.createElement("td");
      code.dir = "ltr";
      code.textContent = match.record_code;
      const status = document.createElement("td");
      status.textContent = match.archived ? scText("مؤرشف") : scText("نشط");
      if (match.archived) {
        const archived = document.createElement("span");
        archived.className = "archived-badge";
        archived.textContent = scText("مؤرشف");
        status.replaceChildren(archived);
      }
      row.append(code, status);
      const details = new Map((match.details || []).map((detail) => [detail.field_id || detail.label, displayResultValue(detail, schemaId)]));
      columns.forEach((column) => {
        const cell = document.createElement("td");
        cell.textContent = details.get(column.id) ?? "";
        row.append(cell);
      });
      const matched = document.createElement("td");
      matched.className = "global-match-locations";
      matched.textContent = (match.matched_at || []).map((item) => `${displayLabel({id:item.category_id, label:item.category, schema_id:schemaId})} ← ${displayLabel({id:item.field_id, label:item.field, schema_id:schemaId})}: ${displayResultValue(item,schemaId)}`).join(" · ");
      const actions = document.createElement("td");
      actions.className = "record-row-actions";
      const button = document.createElement("button");
      button.className = "button button-quiet";
      button.type = "button";
      button.textContent = scText("فتح");
      button.dataset.openMultiRecord = match.record_code;
      button.dataset.openMultiSchema = schemaId;
      const readonly = document.createElement("button");
      readonly.className = "button button-quiet";
      readonly.type = "button";
      readonly.textContent = scText("قراءة فقط");
      readonly.dataset.readonlyMultiRecord = match.record_code;
      readonly.dataset.openMultiSchema = schemaId;
      actions.append(button, readonly);
      row.append(matched, actions);
      body.append(row);
    });
    if (!(result.matches || []).length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "table-empty";
      cell.colSpan = 4 + columns.length;
      cell.textContent = scText("لا توجد نتائج مطابقة في هذا التصميم.");
      row.append(cell);
      body.append(row);
    }
    table.append(head, body);
    tableScroll.append(table);
    section.append(tableScroll);
    fragment.append(section);
  }
  elements.multiSchemaResults.append(fragment);
}

async function runMultiSchemaSearch(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, "notes")) {
    const notes = await requestSearchNotes();
    if (notes === null) return;
    return runMultiSchemaSearch({ notes });
  }
  const configs = activeWorkspaceSchemas().map((schema) => globalQueryConfig(schema.id)).filter((config) => config.selected);
  if (!configs.length) {
    failPendingSearchResultsWindow(scText("اختر تصميمًا واحدًا على الأقل."));
    showToast(scText("اختر تصميمًا واحدًا على الأقل."), "error");
    return;
  }
  elements.runMultiSchemaSearch.disabled = true;
  try {
    const schemas = configs.map((config) => ({
      schema_id: config.schemaId,
      search_field_ids: config.searchFieldIds,
      display_field_ids: config.displayFieldIds,
      include_archived: elements.fullSearchIncludeArchived.checked,
    }));
    const response = await fetch("/api/search/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: elements.globalSearchQuery.value.trim(), schemas }),
    });
    const result = await responseJson(response);
    state.multiSearchResults = new Map(
      result.results.map((schemaResult) => [schemaResult.schema_id, schemaResult]),
    );
    renderMultiResults();
    elements.singleSchemaResultsPanel.hidden = true;
    elements.multiSchemaResults.hidden = false;
    openSearchResultsWindow(scText("نتائج البحث العام"), elements.multiSchemaResults);
    rememberSearchHistory({
      mode: "global",
      name: "",
      notes: options.notes || "",
      query: elements.globalSearchQuery.value.trim(),
      schema_ids: schemas.map((item) => item.schema_id),
      filters: { schemas: deepClone(schemas) },
      headers: Object.fromEntries(schemas.map((item) => [item.schema_id, item.display_field_ids])),
      result_total: (result.results || []).reduce((sum, item) => sum + Number(item.total || 0), 0),
      results: { results: deepClone(result.results || []) },
    });
    renderSearchHistory();
  } catch (error) {
    failPendingSearchResultsWindow(error.message);
    showToast(error.message, "error");
  } finally {
    elements.runMultiSchemaSearch.disabled = false;
  }
}

function restoreMultiSchemaSearchHistory(item) {
  if (item.mode === "global") {
    state.generalSearchMode = "global";
    state.globalSearchFieldRefs = Array.isArray(item.global_refs) ? deepClone(item.global_refs) : [];
    renderMultiSchemaSearch();
    elements.globalSearchRecordCode.value = item.criteria?.record_code || "";
    elements.globalSearchFields.querySelectorAll("[data-global-search-field]").forEach((control) => {
      const value = item.criteria?.fields?.[control.dataset.globalSearchField];
      if (value != null) setControlValue(control, value);
    });
    void runMultiSchemaSearch();
    return;
  }
  state.generalSearchMode = "advanced";
  const queries = item.criteria?.queries || [];
  const selected = new Set(queries.map((query) => query.schema_id));
  activeWorkspaceSchemas().forEach((schema) => {
    const config = multiSearchConfig(schema.id);
    config.selected = selected.has(schema.id);
    const query = queries.find((candidate) => candidate.schema_id === schema.id);
    if (query) config.resultFieldIds = deepClone(query.criteria?._result_field_ids || config.resultFieldIds);
  });
  renderMultiSchemaSearch();
  queries.forEach((query) => {
    const root = elements.multiSchemaQueryList.querySelector(`[data-multi-query-schema="${CSS.escape(query.schema_id)}"]`);
    if (!root) return;
    const criteria = query.criteria || {};
    const id = root.querySelector("[data-multi-record-code]");
    const archived = root.querySelector("[data-multi-archived]");
    if (id) id.value = criteria._record_code || "";
    if (archived) archived.checked = Boolean(criteria._include_archived);
    root.querySelectorAll("[data-multi-filter-field]").forEach((control) => {
      if (!Object.prototype.hasOwnProperty.call(criteria, control.dataset.multiFilterField)) return;
      const saved = criteria[control.dataset.multiFilterField];
      const empty = saved && typeof saved === "object" && saved.empty === true;
      const emptyControl = root.querySelector(
        `[data-multi-empty-field="${CSS.escape(control.dataset.multiFilterField)}"]`,
      );
      if (emptyControl) emptyControl.checked = empty;
      control.disabled = empty;
      setControlValue(control, empty ? "" : saved);
    });
  });
  void runMultiSchemaSearch();
}

function openProfileLinkDialog() {
  elements.profileSourceSchema.replaceChildren();
  elements.profileSourceSchema.append(new Option(scText("اكتب ID ثم افحص الملفات"), ""));
  elements.profileSourceId.value = "";
  elements.profileMappingList.replaceChildren();
  elements.profileMappingArea.hidden = true;
  elements.profileGlobalConflicts.hidden = true;
  elements.profileGlobalConflicts.replaceChildren();
  elements.profileLinkStatus.textContent = "";
  elements.confirmProfileLinkButton.disabled = true;
  state.profileTransferInspection = null;
  elements.profileLinkDialog.showModal();
}

function profileValueText(source) {
  const values = source.values || source.display_values || [];
  if (!values.length) return "—";
  const field = displayFieldDefinition(source.field_id, source.schema_id);
  return values.map(value => displayFieldValue(field, value)).join(" | ") || "—";
}

function renderProfileGlobalConflicts(conflicts = []) {
  elements.profileGlobalConflicts.replaceChildren();
  elements.profileGlobalConflicts.hidden = !conflicts.length;
  if (!conflicts.length) return;
  const heading = document.createElement("strong");
  heading.textContent = scText("توجد قيم مختلفة في الحقول العامة — اختر ملف المصدر الذي تريد الاعتماد عليه");
  elements.profileGlobalConflicts.append(heading);
  conflicts.forEach((conflict) => {
    const item = document.createElement("div");
    item.className = "profile-global-conflict-item";
    const label = document.createElement("b");
    label.textContent = displayLabel(conflict) || conflict.global_ref;
    const values = document.createElement("ul");
    (conflict.sources || []).forEach((source) => {
      const row = document.createElement("li");
      row.textContent = `${displaySchemaName(source)}: ${profileValueText(source)}`;
      values.append(row);
    });
    item.append(label, values);
    elements.profileGlobalConflicts.append(item);
  });
}

function renderProfileMappings(inspection) {
  elements.profileMappingList.replaceChildren();
  inspection.source_fields.forEach((source) => {
    const row = document.createElement("div");
    row.className = "profile-mapping-row";
    const sourceCell = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = `${source.category} — ${displayLabel(source)}`;
    const value = document.createElement("span");
    value.textContent = profileValueText(source);
    sourceCell.append(label, value);
    const select = document.createElement("select");
    select.className = "control";
    select.dataset.profileSourceField = source.field_id;
    select.append(new Option(scText("لا تنقل هذا الحقل"), ""));
    const groups = new Map();
    inspection.target_fields.forEach((target) => {
      if (!groups.has(target.category)) {
        const group = document.createElement("optgroup");
        group.label = target.category;
        groups.set(target.category, group);
        select.append(group);
      }
      groups.get(target.category).append(new Option(`${displayLabel(target)} (${target.type})`, target.field_id));
    });
    select.value = inspection.suggestions[source.field_id] || "";
    row.append(sourceCell, select);
    elements.profileMappingList.append(row);
  });
  elements.profileMappingArea.hidden = false;
  elements.confirmProfileLinkButton.disabled = false;
}

async function inspectProfileLink() {
  const recordCode = elements.profileSourceId.value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{7}$/.test(recordCode)) {
    showToast(scText("أدخل ID صالحًا من 8 أحرف."), "error");
    return;
  }
  elements.inspectProfileLinkButton.disabled = true;
  elements.profileLinkStatus.textContent = scText("جاري تحميل الملف المصدر…");
  try {
    const identityResponse = await fetch("/api/identities/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_schema_id: state.activeSchemaId, record_code: recordCode }),
    });
    const identity = await responseJson(identityResponse);
    if (!identity.profiles.length) throw new Error(scText("لم يُعثر على ملف لهذا الشخص في تصميم آخر."));
    renderProfileGlobalConflicts(identity.global_conflicts || []);
    const previousSource = elements.profileSourceSchema.value;
    elements.profileSourceSchema.replaceChildren();
    identity.profiles.forEach((profile) => {
      elements.profileSourceSchema.append(new Option(profile.schema_name, profile.schema_id));
    });
    if (identity.profiles.some((profile) => profile.schema_id === previousSource)) {
      elements.profileSourceSchema.value = previousSource;
    }
    const response = await fetch("/api/profiles/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_schema_id: elements.profileSourceSchema.value,
        target_schema_id: state.activeSchemaId,
        record_code: recordCode,
      }),
    });
    state.profileTransferInspection = await responseJson(response);
    renderProfileMappings(state.profileTransferInspection);
    elements.profileLinkStatus.textContent = identity.global_conflicts?.length
      ? scText("اختر ملف المصدر بعد مراجعة اختلاف القيم، ثم راجع المطابقات.")
      : scText("راجع الاقتراحات وعدّل أي مطابقة يدويًا.");
  } catch (error) {
    elements.profileLinkStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.inspectProfileLinkButton.disabled = false;
  }
}

async function confirmProfileLink() {
  const inspection = state.profileTransferInspection;
  if (!inspection) return;
  const mappings = [...elements.profileMappingList.querySelectorAll("[data-profile-source-field]")]
    .filter((select) => select.value)
    .map((select) => ({
      source_field_id: select.dataset.profileSourceField,
      target_field_id: select.value,
    }));
  if (!mappings.length) {
    showToast(scText("اختر مطابقة حقل واحدة على الأقل."), "error");
    return;
  }
  elements.confirmProfileLinkButton.disabled = true;
  try {
    const response = await fetch("/api/profiles/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_schema_id: inspection.source_schema_id,
        target_schema_id: inspection.target_schema_id,
        record_code: inspection.record_code,
        mappings,
      }),
    });
    const result = await responseJson(response);
    elements.profileLinkDialog.close();
    await loadSchema({ preservePage: true });
    state.pageSchemaIds.entry = state.activeSchemaId;
    performSwitchMode("entry");
    await performLoadRecord(result.record_code, { force: true, skipNavigationGuard: true });
    showToast(scText("تم إنشاء الملف المرتبط باستخدام ID نفسه."));
  } catch (error) {
    elements.profileLinkStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.confirmProfileLinkButton.disabled = false;
  }
}

[
  elements.entrySchemaTabs,
  elements.builderSchemaTabs,
].forEach((container) => container?.addEventListener("click", (event) => {
  const globalTab = event.target.closest("[data-builder-global-tab]");
  if (globalTab) {
    state.builderScope = "global";
    renderBuilderScope();
    renderAllSchemaTabs();
    return;
  }
  const tab = event.target.closest("[data-schema-tab]");
  if (tab) {
    if (tab.dataset.schemaTabMode === "builder") state.builderScope = "schema";
    void switchActiveSchema(tab.dataset.schemaTab, { mode: tab.dataset.schemaTabMode }).then(() => {
      if (tab.dataset.schemaTabMode === "builder") renderBuilderScope();
    });
  }
}));
elements.createSchemaButton?.addEventListener("click", () => void runSchemaManagement("create"));
elements.duplicateSchemaButton?.addEventListener("click", () => void runSchemaManagement("duplicate"));
elements.renameSchemaButton?.addEventListener("click", () => void runSchemaManagement("rename"));
elements.archiveSchemaButton?.addEventListener("click", () => void runSchemaManagement("archive"));
elements.restoreSchemaButton?.addEventListener("click", () => void restoreArchivedSchema());
elements.createFromArchivedSchemaButton?.addEventListener("click", () => void createFromArchivedSchema());
elements.deleteSchemaButton?.addEventListener("click", () => void deleteWorkspaceSchema());
elements.linkExistingProfileButton?.addEventListener("click", openProfileLinkDialog);
elements.inspectProfileLinkButton?.addEventListener("click", () => void inspectProfileLink());
elements.confirmProfileLinkButton?.addEventListener("click", () => void confirmProfileLink());
elements.runMultiSchemaSearch?.addEventListener("click", () => void runMultiSchemaSearch());
elements.generalSearchFilterButton?.addEventListener("click", openFullSearchFilterDialog);
elements.generalSearchFieldsButton?.addEventListener("click", openFullSearchFieldsDialog);
document.querySelectorAll("[data-search-type]").forEach((button) => {
  button.addEventListener("click", () => { state.searchType = button.dataset.searchType; syncGeneralSearchMode(); });
});
elements.clearMultiSchemaSearch?.addEventListener("click", () => {
  state.multiSearchResults.clear();
  elements.multiSchemaResults.replaceChildren();
  elements.globalSearchQuery.value = "";
});
elements.searchSchemaChoiceList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-search-schema]");
  if (button) {
    state.searchType = "schema";
    void switchActiveSchema(button.dataset.searchSchema, { mode: "search" }).then(() => syncGeneralSearchMode());
  }
});
elements.globalQuerySchemaList?.addEventListener("click", (event) => {
  const control = event.target.closest("[data-global-query-schema]");
  if (!control) return;
  const config = globalQueryConfig(control.dataset.globalQuerySchema);
  config.selected = !config.selected;
  renderMultiSchemaSearch();
});
elements.globalFieldSelectionSummary?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-global-result-field]");
  if (!chip) return;
  const config = globalQueryConfig(chip.dataset.removeGlobalResultSchema);
  config.displayFieldIds = config.displayFieldIds.filter(
    (fieldId) => fieldId !== chip.dataset.removeGlobalResultField,
  );
  renderGlobalSearchSelectionSummaries();
});
elements.globalFilterSelectionSummary?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-global-filter-field]");
  if (!chip) return;
  const config = globalQueryConfig(chip.dataset.removeGlobalFilterSchema);
  config.searchFieldIds = config.searchFieldIds.filter(
    (fieldId) => fieldId !== chip.dataset.removeGlobalFilterField,
  );
  renderGlobalSearchSelectionSummaries();
});
elements.multiSchemaChoiceList?.addEventListener("change", (event) => {
  const control = event.target.closest("[data-multi-schema-choice]");
  if (!control) return;
  multiSearchConfig(control.dataset.multiSchemaChoice).selected = control.checked;
  renderMultiSchemaSearch();
});
elements.multiSchemaQueryList?.addEventListener("change", (event) => {
  const control = event.target.closest("[data-multi-result-field]");
  if (!control) return;
  const config = multiSearchConfig(control.dataset.multiSchema);
  config.resultFieldIds = [
    ...elements.multiSchemaQueryList.querySelectorAll(
      `[data-multi-result-field][data-multi-schema="${CSS.escape(config.schemaId)}"]:checked`,
    ),
  ].map((item) => item.dataset.multiResultField);
});
elements.multiSchemaResults?.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-multi-record]");
  if (open) {
    if (elements.searchResultsDialog?.open) elements.searchResultsDialog.close();
    void switchActiveSchema(open.dataset.openMultiSchema, {
      mode: "entry",
      openCode: open.dataset.openMultiRecord,
    });
    return;
  }
  const readonly = event.target.closest("[data-readonly-multi-record]");
  if (readonly) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("view", "readonly");
    url.searchParams.set("record", readonly.dataset.readonlyMultiRecord);
    url.searchParams.set("schema_id", readonly.dataset.openMultiSchema);
    window.open(url.toString(), `SchemaCraft-readonly-${readonly.dataset.readonlyMultiRecord}-${Date.now()}`);
    return;
  }
  const page = event.target.closest("[data-multi-page]");
  if (!page) return;
  const config = multiSearchConfig(page.dataset.multiSchema);
  const result = state.multiSearchResults.get(config.schemaId);
  const pageSize = Number(result?.limit || config.schema.app?.search_page_size || 50);
  config.offset = page.dataset.multiPage === "next"
    ? config.offset + pageSize
    : Math.max(0, config.offset - pageSize);
  void runMultiSchemaSearch();
});
