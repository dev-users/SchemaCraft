function builderUnlocked() {
  return Boolean(
    state.schema?.builder_access?.unlocked || state.schema?.developer_mode,
  );
}

function workspaceBackgroundImageUrl(settings = state.workspaceSettings || {}) {
  if (!settings.background_image_custom) return "assets/home-background.jpg";
  const version = encodeURIComponent(settings.background_image_version || "current");
  const imageId = encodeURIComponent(settings.background_image_id || "legacy");
  return `/api/settings/background-image?id=${imageId}&v=${version}`;
}

function workspaceBackgroundChoiceUrl(imageId, settings = state.workspaceSettings || {}) {
  if (!imageId || imageId === "default") return "assets/home-background.jpg";
  const image = (settings.background_images || []).find((item) => item.id === imageId);
  return `/api/settings/background-image?id=${encodeURIComponent(imageId)}&v=${encodeURIComponent(image?.version || "current")}`;
}

function applyWorkspaceBackgroundSettings() {
  const settings = state.workspaceSettings || {};
  const imageUrl = workspaceBackgroundImageUrl(settings);
  document.body.style.setProperty("--workspace-background-image", `url("${imageUrl}")`);
  document.body.classList.toggle(
    "workspace-background-all-pages",
    settings.background_all_pages === true,
  );
}

function renderWorkspaceBackgroundSetting(settings = state.workspaceSettings || {}) {
  const selectedId = state.pendingBackgroundImageId || settings.background_image_id || "default";
  if (elements.settingBackgroundPreview) {
    elements.settingBackgroundPreview.src = workspaceBackgroundChoiceUrl(selectedId === "__upload__" ? settings.background_image_id : selectedId, settings);
  }
  if (elements.settingBackgroundStatus) {
    elements.settingBackgroundStatus.textContent = settings.background_image_custom
      ? `الصورة الحالية: ${settings.background_image_name || "صورة مخصصة"}`
      : "تُستخدم الصورة الافتراضية حاليًا.";
  }
  if (elements.settingBackgroundAllPages) {
    elements.settingBackgroundAllPages.checked = settings.background_all_pages === true;
  }
  if (elements.settingBackgroundGallery) {
    elements.settingBackgroundGallery.replaceChildren();
    const choices = [{ id: "default", name: "الصورة الافتراضية" }, ...(settings.background_images || [])];
    choices.forEach((choice) => {
      const card = document.createElement("div");
      card.className = "workspace-background-choice-card";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `workspace-background-choice${selectedId === choice.id ? " is-active" : ""}`;
      button.dataset.backgroundImageChoice = choice.id;
      button.disabled = !builderUnlocked();
      const image = document.createElement("img");
      image.alt = choice.name;
      image.src = workspaceBackgroundChoiceUrl(choice.id, settings);
      const label = document.createElement("span");
      label.textContent = choice.name;
      button.append(image, label);
      card.append(button);
      if (choice.id !== "default") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "button button-danger-quiet workspace-background-delete";
        remove.dataset.deleteBackgroundImage = choice.id;
        remove.textContent = "حذف الصورة";
        remove.disabled = !builderUnlocked();
        card.append(remove);
      }
      elements.settingBackgroundGallery.append(card);
    });
  }
}

function previewSelectedWorkspaceBackground() {
  const file = elements.settingBackgroundImage?.files?.[0];
  if (!file) {
    renderWorkspaceBackgroundSetting();
    return;
  }
  if (elements.settingBackgroundStatus) {
    elements.settingBackgroundStatus.textContent = `صورة جديدة جاهزة للحفظ: ${file.name}`;
  }
  state.pendingBackgroundImageId = "__upload__";
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (elements.settingBackgroundPreview && typeof reader.result === "string") {
      elements.settingBackgroundPreview.src = reader.result;
    }
  });
  reader.readAsDataURL(file);
}

function backgroundFileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("تعذّر قراءة صورة الخلفية."));
        return;
      }
      resolve(result.slice(separator + 1));
    });
    reader.addEventListener("error", () => reject(new Error("تعذّر قراءة صورة الخلفية.")));
    reader.readAsDataURL(file);
  });
}

function setSettingsCategory(category = "application") {
  const allowed = new Set(["application", "interface", "shortcuts", "default-app"]);
  const selected = allowed.has(category) ? category : "application";
  if (state.settingsDirty && selected !== state.settingsCategory) {
    showToast("احفظ تغييرات القسم الحالي قبل الانتقال إلى قسم آخر.", "error");
    return false;
  }
  state.settingsCategory = selected;
  document.querySelectorAll("[data-settings-category-tab]").forEach((button) => {
    const active = button.dataset.settingsCategoryTab === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-settings-category]").forEach((section) => {
    section.hidden = section.dataset.settingsCategory !== selected;
  });
  return true;
}

function renderSettings() {
  if (!state.schema) {
    return;
  }
  const app = state.schema.app;
  elements.settingTitle.value = app.title;
  elements.settingSingular.value = app.entity_singular;
  elements.settingPlural.value = app.entity_plural;
  elements.settingPrimaryColor.value = state.workspaceSettings?.primary_color || "#1F5F95";
  elements.settingLanguage.value = app.language || "ar";
  elements.settingStartupPage.value = app.startup_page || "home";
  elements.settingSearchPageSize.value = String(app.search_page_size || 50);
  elements.settingShowEntrySearch.checked = app.show_entry_search !== false;
  elements.settingDraftAutosave.checked = app.draft_autosave !== false;
  const workspacePreferences = state.workspaceSettings || {};
  elements.settingEntryHistoryLimit.value = String(workspacePreferences.entry_history_limit || 8);
  elements.settingBuilderHistoryLimit.value = String(workspacePreferences.builder_history_limit || 20);
  elements.settingSearchHistoryLimit.value = String(workspacePreferences.search_history_limit || 20);
  elements.settingImportHistoryLimit.value = String(workspacePreferences.import_history_limit || 20);
  elements.settingExportHistoryLimit.value = String(workspacePreferences.export_history_limit || 20);
  elements.settingHomeEntryHistoryLimit.value = String(workspacePreferences.home_entry_history_limit || 3);
  elements.settingHomeBuilderHistoryLimit.value = String(workspacePreferences.home_builder_history_limit || 3);
  elements.settingHomeSearchHistoryLimit.value = String(workspacePreferences.home_search_history_limit || 3);
  elements.settingHomeImportHistoryLimit.value = String(workspacePreferences.home_import_history_limit || 3);
  elements.settingHomeExportHistoryLimit.value = String(workspacePreferences.home_export_history_limit || 3);
  elements.settingShowExplanations.checked = workspacePreferences.show_explanations === true;
  state.pendingBackgroundImageId = "";
  renderWorkspaceBackgroundSetting(workspacePreferences);
  applyWorkspaceBackgroundSettings();
  state.settingsDirty = false;
  state.settingsDirtyCategory = "";
  elements.settingsSaveState.textContent = "";

  const unlocked = builderUnlocked();
  const editableControls = [
    elements.settingTitle,
    elements.settingSingular,
    elements.settingPlural,
    elements.settingPrimaryColor,
    elements.settingLanguage,
    elements.settingStartupPage,
    elements.settingSearchPageSize,
    elements.settingEntryHistoryLimit,
    elements.settingBuilderHistoryLimit,
    elements.settingSearchHistoryLimit,
    elements.settingImportHistoryLimit,
    elements.settingExportHistoryLimit,
    elements.settingHomeEntryHistoryLimit,
    elements.settingHomeBuilderHistoryLimit,
    elements.settingHomeSearchHistoryLimit,
    elements.settingHomeImportHistoryLimit,
    elements.settingHomeExportHistoryLimit,
    elements.settingShowEntrySearch,
    elements.settingDraftAutosave,
    elements.settingShowExplanations,
    elements.settingBackgroundImage,
    elements.settingBackgroundAllPages,
  ];
  editableControls.forEach((control) => {
    control.disabled = !unlocked;
  });
  elements.saveSettingsButton.disabled = !unlocked;
  elements.saveWorkspacePreferences.disabled = !unlocked;
  renderShortcutSettings();
  elements.saveShortcutsButton.disabled = !unlocked;
  elements.chooseDefaultAppDestination.disabled = !unlocked;
  syncDefaultAppOptions();
  setSettingsCategory(state.settingsCategory || "application");
}

document.querySelectorAll("[data-settings-category-tab]").forEach((button) => {
  button.addEventListener("click", () => setSettingsCategory(button.dataset.settingsCategoryTab));
});

function settingsCloseAllowed() {
  if (!state.settingsDirty) return true;
  showToast("احفظ تغييرات القسم الحالي قبل إغلاق الإعدادات.", "error");
  return false;
}

elements.settingsView?.addEventListener("input", markSettingsDirty);
elements.settingsView?.addEventListener("change", markSettingsDirty);
elements.settingsView?.addEventListener("click", (event) => {
  if (!event.target.closest('[data-close-dialog="settings-view"]') || settingsCloseAllowed()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
elements.settingsView?.addEventListener("cancel", (event) => {
  if (!settingsCloseAllowed()) event.preventDefault();
});

elements.settingBackgroundGallery?.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-delete-background-image]");
  if (remove && builderUnlocked()) {
    if (!(await requestConfirmation("حذف هذه الصورة من الصور المحفوظة؟", {
      title: "حذف صورة الخلفية",
      confirmLabel: "حذف الصورة",
    }))) return;
    void fetch("/api/settings/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_background_image_id: remove.dataset.deleteBackgroundImage }),
    }).then(responseJson).then((result) => {
      state.workspaceSettings = result.workspace_settings;
      if (state.pendingBackgroundImageId === remove.dataset.deleteBackgroundImage) state.pendingBackgroundImageId = "";
      applyWorkspaceBackgroundSettings();
      renderWorkspaceBackgroundSetting();
      showToast("تم حذف صورة الخلفية.");
    }).catch((error) => showToast(error.message, "error"));
    return;
  }
  const choice = event.target.closest("[data-background-image-choice]");
  if (!choice || !builderUnlocked()) return;
  state.pendingBackgroundImageId = choice.dataset.backgroundImageChoice;
  if (elements.settingBackgroundImage) elements.settingBackgroundImage.value = "";
  renderWorkspaceBackgroundSetting();
  elements.settingBackgroundStatus.textContent = choice.dataset.backgroundImageChoice === "default"
    ? "الصورة الافتراضية جاهزة للتطبيق."
    : "الصورة المختارة جاهزة للتطبيق.";
  markSettingsDirty({ target: choice });
});

async function saveWorkspacePreferences() {
  if (!builderUnlocked()) return;
  const numeric = (control, fallback) => Math.max(1, Math.min(100, Number(control.value) || fallback));
  try {
    const backgroundFile = elements.settingBackgroundImage?.files?.[0];
    if (backgroundFile && backgroundFile.size > 15 * 1024 * 1024) {
      throw new Error("يجب ألا يتجاوز حجم صورة الخلفية 15 ميغابايت.");
    }
    const payload = {
      shortcuts: state.workspaceSettings?.shortcuts || defaultShortcutBindings(),
      entry_history_limit: numeric(elements.settingEntryHistoryLimit, 8),
      builder_history_limit: numeric(elements.settingBuilderHistoryLimit, 20),
      search_history_limit: numeric(elements.settingSearchHistoryLimit, 20),
      import_history_limit: numeric(elements.settingImportHistoryLimit, 20),
      export_history_limit: numeric(elements.settingExportHistoryLimit, 20),
      home_entry_history_limit: numeric(elements.settingHomeEntryHistoryLimit, 3),
      home_builder_history_limit: numeric(elements.settingHomeBuilderHistoryLimit, 3),
      home_search_history_limit: numeric(elements.settingHomeSearchHistoryLimit, 3),
      home_import_history_limit: numeric(elements.settingHomeImportHistoryLimit, 3),
      home_export_history_limit: numeric(elements.settingHomeExportHistoryLimit, 3),
      show_explanations: elements.settingShowExplanations.checked,
      background_all_pages: elements.settingBackgroundAllPages.checked,
    };
    if (backgroundFile) {
      payload.background_image_name = backgroundFile.name;
      payload.background_image_data = await backgroundFileData(backgroundFile);
    } else {
      payload.background_image_id = state.pendingBackgroundImageId || state.workspaceSettings?.background_image_id || "default";
    }
    const app = deepClone(state.schema.app);
    app.primary_color = state.workspaceSettings?.primary_color || "#1F5F95";
    app.startup_page = elements.settingStartupPage.value;
    app.search_page_size = Number(elements.settingSearchPageSize.value);
    app.show_entry_search = elements.settingShowEntrySearch.checked;
    app.draft_autosave = elements.settingDraftAutosave.checked;
    const appResponse = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: state.schema.revision, app }),
    });
    const savedSchema = await responseJson(appResponse);
    applyLoadedSchema(savedSchema, { resetRecord: false, preservePage: true });
    const response = await fetch("/api/settings/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await responseJson(response);
    state.workspaceSettings = result.workspace_settings;
    state.pendingBackgroundImageId = "";
    clearSettingsDirty("interface");
    if (elements.settingBackgroundImage) elements.settingBackgroundImage.value = "";
    document.body.classList.toggle("show-explanations", state.workspaceSettings.show_explanations === true);
    applyWorkspaceBackgroundSettings();
    renderWorkspaceBackgroundSetting();
    showToast("تم حفظ تفضيلات الواجهة.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function discardSettingsChanges() {
  state.settingsDirty = false;
  state.settingsDirtyCategory = "";
  renderSettings();
  showToast("تم تجاهل تغييرات الإعدادات غير المحفوظة.");
}

elements.discardSettingsChanges?.addEventListener("click", discardSettingsChanges);

const SHORTCUT_ACTION_LABELS = {
  context_new: "إضافة جديد في الصفحة المفتوحة",
  context_edit: "تعديل العنصر في الصفحة المفتوحة",
  context_delete: "حذف العنصر في الصفحة المفتوحة",
  context_save: "حفظ الصفحة المفتوحة",
  context_focus_search: "التركيز على البحث في الصفحة المفتوحة",
  open_home: "فتح الرئيسية",
  open_search: "فتح صفحة البحث",
  open_entry: "فتح إدخال البيانات",
  open_import: "فتح الاستيراد",
  open_export: "فتح التصدير",
  open_builder: "فتح المصمّم",
  open_settings: "فتح الإعدادات",
  close_dialog: "إغلاق الحوار الحالي",
  context_archive: "أرشفة العنصر في الصفحة المفتوحة",
  next_workspace_tab: "الانتقال إلى التبويب التالي تحت الرأس",
  close_application: "إغلاق البرنامج بالكامل",
  enter_admin: "فتح حوار وضع الإدارة",
  select_user: "فتح حوار اختيار المستخدم",
};

const SHORTCUT_ACTION_GROUPS = [
  { title: "إجراءات الصفحة المفتوحة", actions: ["context_new", "context_edit", "context_delete", "context_save", "context_focus_search", "context_archive"] },
  { title: "التنقل العام بين الصفحات", actions: ["open_home", "open_search", "open_entry", "open_import", "open_export", "open_builder", "open_settings"] },
  { title: "الحوارات والتبويبات", actions: ["close_dialog", "next_workspace_tab"] },
  { title: "البرنامج ووضع الصلاحية", actions: ["close_application", "enter_admin", "select_user"] },
];

function englishShortcutKey(event) {
  const code = String(event.code || "");
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  const named = {
    Escape: "Escape", Enter: "Enter", Tab: "Tab", Space: "Space",
    Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  };
  return named[code] || "";
}

function normalizedShortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  const key = englishShortcutKey(event);
  if (!key) return "";
  return [...modifiers, key].join("+");
}

function renderShortcutSettings() {
  if (!elements.shortcutSettingsList) return;
  const bindings = state.workspaceSettings?.shortcuts || {};
  elements.shortcutSettingsList.replaceChildren();
  SHORTCUT_ACTION_GROUPS.forEach((groupDefinition) => {
    const group = document.createElement("section");
    group.className = "shortcut-settings-group";
    const heading = document.createElement("h4");
    heading.textContent = groupDefinition.title;
    const rows = document.createElement("div");
    rows.className = "shortcut-settings-group-rows";
    groupDefinition.actions.forEach((action) => {
      const row = document.createElement("div");
      row.className = "shortcut-setting-row";
      const name = document.createElement("span");
      name.textContent = SHORTCUT_ACTION_LABELS[action];
      const input = document.createElement("input");
      input.className = "control shortcut-capture";
      input.readOnly = true;
      input.disabled = !builderUnlocked();
      input.dir = "ltr";
      input.lang = "en";
      input.dataset.shortcutAction = action;
      input.value = Object.entries(bindings).find(([, value]) => (Array.isArray(value) ? value : [value]).includes(action))?.[0] || "";
      input.placeholder = "Press shortcut";
      input.addEventListener("keydown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if ((event.code === "Backspace" || event.code === "Delete") && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
          input.value = "";
          markSettingsDirty({ target: input });
          return;
        }
        const shortcut = normalizedShortcutFromEvent(event);
        if (!shortcut) return;
        input.value = shortcut;
        markSettingsDirty({ target: input });
      });
      row.append(name, input);
      rows.append(row);
    });
    group.append(heading, rows);
    elements.shortcutSettingsList.append(group);
  });
}

function defaultShortcutBindings() {
  return Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_BY_ACTION).map(([action, shortcut]) => [shortcut, [action]]));
}

const DEFAULT_SHORTCUT_BY_ACTION = {
  context_new: "Ctrl+N",
  context_edit: "Ctrl+E",
  context_delete: "Ctrl+Delete",
  context_save: "Ctrl+S",
  context_focus_search: "Ctrl+F",
  context_archive: "Ctrl+Shift+A",
  open_home: "Ctrl+Alt+H",
  open_search: "Ctrl+Shift+F",
  open_entry: "Ctrl+Alt+E",
  open_import: "Ctrl+Alt+I",
  open_export: "Ctrl+Alt+X",
  open_builder: "Ctrl+Alt+B",
  open_settings: "Ctrl+,",
  close_dialog: "Escape",
  next_workspace_tab: "Ctrl+Tab",
  close_application: "Ctrl+Q",
  enter_admin: "Ctrl+Alt+A",
  select_user: "Ctrl+Alt+U",
};

async function saveShortcutSettings() {
  if (!builderUnlocked()) return;
  const shortcuts = {};
  elements.shortcutSettingsList.querySelectorAll("[data-shortcut-action]").forEach((input) => {
    if (!input.value) return;
    if (!shortcuts[input.value]) shortcuts[input.value] = [];
    shortcuts[input.value].push(input.dataset.shortcutAction);
  });
  try {
    const response = await fetch("/api/settings/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortcuts }),
    });
    const result = await responseJson(response);
    state.workspaceSettings = result.workspace_settings;
    renderShortcutSettings();
    clearSettingsDirty("shortcuts");
    showToast("تم حفظ اختصارات لوحة المفاتيح.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function shortcutFromKeyboardEvent(event) {
  return normalizedShortcutFromEvent(event);
}

function runShortcutAction(action) {
  const candidates = Array.isArray(action) ? action : [action];
  action = candidates.find((candidate) => candidate.startsWith("context_")) || candidates[0];
  const adminOnly = new Set(["open_import", "open_export", "open_builder", "open_settings", "save_builder"]);
  if (adminOnly.has(action) && !builderUnlocked()) return;
  const actions = {
    context_new: () => {
      if (state.mode === "entry") requestNewRecord();
      else if (state.mode === "search") startNewSearchOperation();
      else if (state.mode === "import") resetImportWorkflow();
      else if (state.mode === "export") resetExportWorkflow();
      else if (state.mode === "builder" && builderUnlocked()) void runSchemaManagement("create");
    },
    context_save: () => {
      if (elements.settingsView?.open) {
        if (state.settingsCategory === "application") void saveApplicationSettings();
        else if (state.settingsCategory === "interface") void saveWorkspacePreferences();
        else void saveShortcutSettings();
      }
      else if (state.mode === "entry") void saveCurrentRecord();
      else if (state.mode === "builder") void (state.builderScope === "global" ? saveGeneralDefinitions() : saveSchema());
      else if (state.mode === "search") {
        if (state.searchType === "global") void runMultiSchemaSearch();
        else void runFullSearch({ resetPage: true });
      }
    },
    context_edit: () => {
      if (state.mode === "entry") elements.recordForm?.querySelector("input:not([readonly]), textarea, select")?.focus();
      else if (state.mode === "builder") elements.builderCategoryNavList?.querySelector(".category-nav-button-active")?.click();
    },
    context_delete: () => {
      if (state.mode === "entry") void deleteCurrentRecord();
      else if (state.mode === "builder" && builderUnlocked()) void deleteWorkspaceSchema();
    },
    context_focus_search: () => {
      const target = state.mode === "entry"
        ? elements.entrySearchRecordId
        : state.mode === "search"
          ? (state.searchType === "global" ? elements.globalSearchQuery : elements.fullSearchFields.querySelector("input, textarea, select") || elements.fullSearchRecordId)
          : state.mode === "import"
            ? elements.importHistorySearch
            : state.mode === "export"
              ? elements.exportHistorySearch
              : null;
      target?.focus();
    },
    context_archive: () => {
      if (state.mode === "entry") void archiveCurrentRecord();
      else if (state.mode === "builder" && state.builderScope === "schema" && builderUnlocked()) void runSchemaManagement("archive");
    },
    next_workspace_tab: () => {
      const visibleTabs = [...document.querySelectorAll(".schema-tabs:not([hidden]) .schema-tab")]
        .filter((tab) => !tab.closest("[hidden]"));
      if (!visibleTabs.length) return;
      const current = visibleTabs.findIndex((tab) => tab.classList.contains("is-active"));
      visibleTabs[(current + 1 + visibleTabs.length) % visibleTabs.length].click();
    },
    new_record: () => { switchMode("entry"); requestNewRecord(); },
    save_record: () => { if (state.mode === "entry") void saveCurrentRecord(); },
    open_by_id: async () => {
      const code = await requestText({
        title: "فتح سجل بالمعرّف",
        label: "معرّف السجل",
        confirmLabel: "فتح السجل",
      });
      if (code) { switchMode("entry"); void loadRecord(code.trim().toUpperCase()); }
    },
    focus_entry_search: () => { switchMode("entry"); elements.entrySearchRecordId?.focus(); },
    open_home: () => switchMode("home"),
    open_search: () => switchMode("search"),
    open_entry: () => switchMode("entry"),
    open_import: () => switchMode("import"),
    open_export: () => switchMode("export"),
    open_builder: () => switchMode("builder"),
    save_builder: () => { if (state.mode === "builder") void (state.builderScope === "global" ? saveGeneralDefinitions() : saveSchema()); },
    archive_record: () => { if (state.mode === "entry") void archiveCurrentRecord(); },
    previous_schema: () => switchSchemaByOffset(-1),
    next_schema: () => switchSchemaByOffset(1),
    open_settings: () => switchMode("settings"),
    close_dialog: () => {
      const dialog = document.querySelector("dialog[open]");
      if (dialog === elements.settingsView && !settingsCloseAllowed()) return;
      dialog?.close();
    },
    close_application: () => { void closeApplication(); },
    enter_admin: () => elements.sessionModeBadge?.click(),
    select_user: () => elements.auditUserBadge?.click(),
    // Kept for workspaces saved by older releases. It now opens the same
    // administrative session dialog and never changes privileges directly.
    exit_admin: () => elements.sessionModeBadge?.click(),
  };
  actions[action]?.();
}

function switchSchemaByOffset(offset) {
  const schemas = activeWorkspaceSchemas();
  const index = schemas.findIndex((schema) => schema.id === state.activeSchemaId);
  if (index < 0 || schemas.length < 2) return;
  const target = schemas[(index + offset + schemas.length) % schemas.length];
  void switchActiveSchema(target.id, { mode: state.mode });
}

function markSettingsDirty(event = null) {
  if (event?.target?.closest?.("[data-settings-transient]")) {
    return;
  }
  if (!builderUnlocked()) {
    return;
  }
  state.settingsDirty = true;
  state.settingsDirtyCategory = event?.target?.closest?.("[data-settings-category]")?.dataset.settingsCategory || state.settingsCategory || "application";
  elements.settingsSaveState.textContent = "توجد إعدادات غير محفوظة.";
}

function syncDefaultAppOptions() {
  const clearSchema = elements.defaultAppClearSchema?.checked === true;
  const clearRecords = clearSchema || elements.defaultAppClearRecords?.checked === true;
  if (clearSchema) elements.defaultAppClearRecords.checked = true;
  if (clearRecords) elements.defaultAppClearHistory.checked = true;
  elements.defaultAppClearRecords.disabled = clearSchema;
  elements.defaultAppClearHistory.disabled = clearRecords;
  elements.createDefaultApp.disabled = !builderUnlocked() || !elements.defaultAppDestination.value.trim();
}

async function chooseDefaultAppDestination() {
  if (!builderUnlocked()) return;
  elements.chooseDefaultAppDestination.disabled = true;
  elements.defaultAppStatus.textContent = "جارٍ فتح اختيار المجلد…";
  try {
    const response = await fetch("/api/settings/default-app/destination", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await responseJson(response);
    if (!result.cancelled && result.destination) {
      elements.defaultAppDestination.value = result.destination;
      elements.defaultAppStatus.textContent = "المجلد جاهز لإنشاء النسخة الجديدة.";
    } else {
      elements.defaultAppStatus.textContent = "لم يُختر مجلد.";
    }
  } catch (error) {
    elements.defaultAppStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.chooseDefaultAppDestination.disabled = false;
    syncDefaultAppOptions();
  }
}

async function createDefaultApp() {
  if (!builderUnlocked() || !elements.defaultAppDestination.value.trim()) return;
  elements.createDefaultApp.disabled = true;
  elements.defaultAppStatus.textContent = "جارٍ إنشاء التطبيق الجديد…";
  try {
    const response = await fetch("/api/settings/default-app/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: elements.defaultAppDestination.value.trim(),
        clear_history: elements.defaultAppClearHistory.checked,
        clear_records: elements.defaultAppClearRecords.checked,
        clear_schema: elements.defaultAppClearSchema.checked,
      }),
    });
    const result = await responseJson(response);
    elements.defaultAppStatus.textContent = `تم إنشاء التطبيق في: ${result.destination}`;
    showToast("تم إنشاء التطبيق الافتراضي الجديد.");
  } catch (error) {
    elements.defaultAppStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    syncDefaultAppOptions();
  }
}

elements.defaultAppClearHistory?.addEventListener("change", syncDefaultAppOptions);
elements.defaultAppClearRecords?.addEventListener("change", syncDefaultAppOptions);
elements.defaultAppClearSchema?.addEventListener("change", syncDefaultAppOptions);
elements.chooseDefaultAppDestination?.addEventListener("click", () => void chooseDefaultAppDestination());
elements.createDefaultApp?.addEventListener("click", () => void createDefaultApp());

function clearSettingsDirty(category) {
  if (state.settingsDirtyCategory && state.settingsDirtyCategory !== category) return;
  state.settingsDirty = false;
  state.settingsDirtyCategory = "";
  if (elements.settingsSaveState) elements.settingsSaveState.textContent = "";
}

async function saveApplicationSettings() {
  if (!state.schema || !builderUnlocked()) {
    return;
  }
  const app = deepClone(state.schema.app);
  app.title = elements.settingTitle.value.trim();
  app.entity_singular = elements.settingSingular.value.trim();
  app.entity_plural = elements.settingPlural.value.trim();
  app.primary_color = elements.settingPrimaryColor.value;
  app.language = elements.settingLanguage.value || "ar";
  if (!app.title || !app.entity_singular || !app.entity_plural) {
    showToast("اسم التطبيق واسم السجل بالمفرد والجمع مطلوبة.", "error");
    return;
  }
  elements.saveSettingsButton.disabled = true;
  elements.settingsSaveState.textContent = "جاري الحفظ…";
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: state.schema.revision, app }),
    });
    const schema = await responseJson(response);
    state.workspaceSettings.primary_color = schema.app.primary_color;
    applyLoadedSchema(schema, { resetRecord: false, preservePage: true });
    clearSettingsDirty("application");
    elements.settingsSaveState.textContent = "تم حفظ الإعدادات.";
    showToast("تم حفظ إعدادات التطبيق.");
  } catch (error) {
    elements.settingsSaveState.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    elements.saveSettingsButton.disabled = !builderUnlocked();
  }
}
