const lifecycleChannel = typeof BroadcastChannel === "function"
  ? new BroadcastChannel("schemacraft-lifecycle")
  : null;

lifecycleChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "closing" || state.closing) return;
  state.closing = true;
  window.clearInterval(state.heartbeatTimer);
  window.clearInterval(state.draftTimer);
  window.clearInterval(state.builderAutosaveTimer);
  window.close();
});

function applyLoadedSchema(schema, options = {}) {
  const pendingViews = state.pendingSchemaViews;
  state.pendingSchemaViews = null;
  const previousMode = state.mode;
  const preservedRecordCode = options.resetRecord
    ? ""
    : options.preservedRecordCode ?? state.selectedRecordCode ?? "";
  state.schema = schema;
  if (schema.schema_id) {
    state.activeSchemaId = schema.schema_id;
    state.workspaceDefinitions[schema.schema_id] = schema;
  }
  state.draftSchema = deepClone(schema);
  markClean();
  applyAppIdentity(schema);
  if (
    !schema.developer_mode &&
    !schema.builder_access?.unlocked &&
    ["builder", "import", "export"].includes(state.mode)
  ) {
    state.mode = "home";
  }
  if (Array.isArray(state.searchFieldIds)) {
    const eligible = new Set(
      eligibleSearchFields(schema).map(({ field }) => field.id),
    );
    state.searchFieldIds = state.searchFieldIds.filter((fieldId) =>
      eligible.has(fieldId),
    );
    if (!state.searchFieldIds.length) {
      state.searchFieldIds = null;
    }
  }
  const fullSearchEligible = new Set(
    eligibleSearchFields(schema).map(({ field }) => field.id),
  );
  ["fullSearchFieldIds", "fullSearchColumnIds"].forEach((stateKey) => {
    if (Array.isArray(state[stateKey])) {
      state[stateKey] = state[stateKey].filter((fieldId) =>
        fullSearchEligible.has(fieldId),
      );
    }
  });
  if (options.builderSave && previousMode === 'builder' && builderUnlocked()) {
    // Record widgets belong to the last rendered schema until the user leaves
    // Builder. Keep them untouched while acknowledging the durable save.
    state.pendingSchemaViews = {
      schema,
      resetRecord: Boolean(options.resetRecord || pendingViews?.resetRecord),
      preservedRecordCode: pendingViews?.preservedRecordCode ?? preservedRecordCode,
    };
    renderBuilder();
    renderWorkspaceChrome();
    setStatus('ready', 'جاهز');
    return;
  }
  if (options.resetRecord) {
    state.selectedRecordCode = null;
    state.currentRecordArchived = false;
    elements.recordCode.value = generateRecordCode();
    displayRecordMetadata();
    clearSearch();
  }
  renderSearchFields();
  elements.searchPanel.hidden =
    !hasConfiguredFields() || schema.app.show_entry_search === false;
  renderEntryForm();
  renderAttachmentGallery();
  renderBuilder();
  renderWorkspaceChrome();
  elements.fullSearchFields.replaceChildren();
  renderFullSearchFilters();
  renderHome();
  if (["import", "export"].includes(previousMode) || ["import", "export"].includes(state.mode)) {
    renderExchangePage();
  }
  setStatus("ready", "جاهز");
  if (options.resetRecord) {
    window.setTimeout(restoreLocalDraft, 0);
  }

  if (state.startupIntent.readonly) {
    document.body.classList.add("readonly-window");
    performSwitchMode("readonly");
    void loadReadonlyRecord(state.startupIntent.readonlyCode);
    return;
  }

  const targetMode = options.targetMode || (options.preservePage && previousMode !== "loading"
    ? previousMode
    : schema.app.startup_page || "home");
  performSwitchMode(targetMode);
  renderBuilderScope();

  if (preservedRecordCode && !state.startupIntent.readonly) {
    void performLoadRecord(preservedRecordCode, {
      force: true,
      silent: true,
      scroll: false,
      skipNavigationGuard: true,
    });
  }

  if (state.startupIntent.editCode) {
    const code = state.startupIntent.editCode;
    state.startupIntent.editCode = "";
    performSwitchMode("entry");
    void loadRecord(code, { force: true });
  }
}
function editableTargetLabel(targetType, targetId) {
  if (
    targetType === "category" &&
    targetId === state.editingCategoryId &&
    !categoryById(targetId)
  ) {
    return (
      "الفئة الجديدة: " + (elements.categoryLabel.value.trim() || "بلا اسم بعد")
    );
  }

  if (
    targetType === "field" &&
    targetId === state.editingFieldId &&
    !fieldById(targetId)
  ) {
    return (
      "الحقل الجديد: " + (elements.fieldLabel.value.trim() || "بلا اسم بعد")
    );
  }

  return targetQualifiedLabel(targetType, targetId);
}
function updateBuilderAccess(access) {
  if (!state.schema) return;
  state.schema.builder_access = access;
  state.schema.developer_mode = Boolean(access?.unlocked);
  state.draftSchema.builder_access = deepClone(access);
  state.draftSchema.developer_mode = Boolean(access?.unlocked);
  Object.values(state.workspaceDefinitions || {}).forEach((schema) => {
    schema.builder_access = deepClone(access);
    schema.developer_mode = Boolean(access?.unlocked);
  });
  applyAppIdentity(state.schema);
  const unlocked = builderUnlocked();
  renderSessionMode(unlocked);
  updateRecordButtonLabels();
  if (elements.settingsView?.open) {
    if (unlocked) renderSettings();
    else elements.settingsView.close();
  }
  if (["import", "export"].includes(state.mode)) {
    renderExchangePage();
  }
  renderWorkspaceChrome();
  renderHome();
}

async function lockAdministration() {
  try {
    const response = await fetch("/api/builder/lock", { method: "POST" });
    const result = await responseJson(response);
    updateBuilderAccess(result.builder_access);
    if (["builder", "import", "export"].includes(state.mode)) {
      performSwitchMode("home");
    }
    showToast("تم الخروج من وضع الإدارة.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function builderAuthButtonLabel(mode = state.authMode) {
  if (mode === "initialize") {
    return "إنشاء وفتح";
  }
  if (mode === "change") {
    return "تغيير كلمة المرور";
  }
  return "فتح المصمّم";
}

function setBuilderAuthBusy(busy) {
  state.authSubmitting = busy;

  [
    elements.currentBuilderPassword,
    elements.builderPassword,
    elements.confirmBuilderPassword,
  ].forEach((control) => {
    control.disabled = busy;
  });

  elements.confirmBuilderAuthButton.disabled = busy;
  elements.builderAuthDialog.setAttribute("aria-busy", busy ? "true" : "false");
  elements.builderAuthSpinner.hidden = !busy;
  elements.confirmBuilderAuthText.textContent = busy
    ? "جارٍ التحقق…"
    : builderAuthButtonLabel();
}

function openBuilderAuthDialog(mode) {
  state.authMode = mode;
  elements.currentBuilderPassword.value = "";
  elements.builderPassword.value = "";
  elements.confirmBuilderPassword.value = "";

  const initialize = mode === "initialize";
  const change = mode === "change";

  elements.builderAuthTitle.textContent = initialize
    ? "إنشاء كلمة مرور المصمّم"
    : change
      ? "تغيير كلمة مرور المصمّم"
      : "فتح المصمّم";

  elements.builderAuthNote.textContent = initialize
    ? "أنشئ كلمة مرور من 8 أحرف على الأقل. ستُطلب عند فتح المصمّم لاحقًا."
    : change
      ? "اكتب كلمة المرور الجديدة وأكدها."
      : "أدخل كلمة مرور المصمّم. سيبقى المصمّم مفتوحًا حتى إغلاق التطبيق.";

  elements.currentPasswordWrapper.hidden = true;
  elements.confirmPasswordWrapper.hidden = !(initialize || change);
  elements.builderPassword.autocomplete =
    initialize || change ? "new-password" : "current-password";

  setBuilderAuthBusy(false);
  elements.builderAuthDialog.showModal();

  window.setTimeout(() => {
    elements.builderPassword.focus();
  }, 0);
}

async function submitBuilderAuth() {
  if (state.authSubmitting) {
    return;
  }

  const mode = state.authMode;
  const password = elements.builderPassword.value;

  if (!password) {
    showToast("أدخل كلمة المرور.", "error");
    elements.builderPassword.focus();
    return;
  }

  if (["initialize", "change"].includes(mode)) {
    if (password.length < 8) {
      showToast("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.", "error");
      elements.builderPassword.focus();
      return;
    }

    if (password !== elements.confirmBuilderPassword.value) {
      showToast("تأكيد كلمة المرور غير مطابق.", "error");
      elements.confirmBuilderPassword.focus();
      return;
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 20_000);

  setBuilderAuthBusy(true);

  try {
    const endpoint =
      mode === "change" ? "/api/builder/password" : "/api/builder/unlock";

    const payload =
      mode === "change"
        ? {
            current_password: elements.currentBuilderPassword.value,
            new_password: password,
          }
        : {
            password,
            initialize: mode === "initialize",
          };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const result = await responseJson(response);
    updateBuilderAccess(result.builder_access);
    elements.builderAuthDialog.close();

    if (mode === "change") {
      showToast("تم تغيير كلمة مرور المصمّم.");
    } else {
      performSwitchMode(state.authReturnPage || "builder");
      showToast("تم فتح وضع الإدارة حتى إغلاق التطبيق.");
    }
  } catch (error) {
    const visibleError =
      error?.name === "AbortError"
        ? new Error(
            "استغرق التحقق وقتًا أطول من المتوقع. تحقق من سجل التطبيق ثم حاول مجددًا.",
          )
        : error;

    reportClientError("builder-auth", visibleError);
    showToast(visibleError.message, "error");
  } finally {
    window.clearTimeout(timeout);
    setBuilderAuthBusy(false);
  }
}

async function loadSchema(options = {}) {
  try {
    const response = await fetch("/api/schema", { cache: "no-store" });
    applyLoadedSchema(await responseJson(response), {
      resetRecord:
        Boolean(options.forceResetRecord) ||
        (options.resetRecord !== false && !options.preservePage),
      preservePage: Boolean(options.preservePage),
      builderSave: Boolean(options.builderSave),
    });
    return true;
  } catch (error) {
    reportClientError("schema-load", error);

    showStartupError(error.message);
    return false;
  }
}

function renderAuditUserIdentity() {
  const current = state.auditUsers?.current_user || "";
  if (elements.auditUserName) elements.auditUserName.textContent = current || "غير محدد";
  if (elements.auditUserOptions) {
    elements.auditUserOptions.replaceChildren();
    (state.auditUsers?.users || []).forEach((name) => elements.auditUserOptions.append(new Option(name)));
  }
}

function requestAuditUser(required = false) {
  renderAuditUserIdentity();
  elements.auditUserInput.value = required ? "" : (state.auditUsers?.current_user || "");
  elements.auditUserDialog.dataset.required = String(required);
  if (!elements.auditUserDialog.open) elements.auditUserDialog.showModal();
  window.setTimeout(() => elements.auditUserInput.focus(), 0);
}

async function confirmAuditUserSelection() {
  const name = elements.auditUserInput.value.trim();
  if (!name) return showToast("اكتب اسم المستخدم.", "error");
  elements.confirmAuditUser.disabled = true;
  try {
    const response = await fetch("/api/users/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await responseJson(response);
    state.auditUsers = result.audit_users;
    renderAuditUserIdentity();
    elements.auditUserDialog.close();
    const resolve = state.auditUserResolve;
    state.auditUserResolve = null;
    resolve?.();
    if (state.mode !== "loading") {
      renderEntryForm();
      showToast(`المستخدم الحالي: ${state.auditUsers.current_user}`);
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.confirmAuditUser.disabled = false;
  }
}

async function ensureAuditUser() {
  renderAuditUserIdentity();
  if (!state.auditUserFeatureAvailable) return;
  if (state.auditUsers?.current_user) return;
  await new Promise((resolve) => {
    state.auditUserResolve = resolve;
    requestAuditUser(true);
  });
}

elements.confirmAuditUser?.addEventListener("click", () => void confirmAuditUserSelection());
elements.auditUserInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); void confirmAuditUserSelection(); }
});
elements.auditUserBadge?.addEventListener("click", () => requestAuditUser(false));
elements.auditUserDialog?.addEventListener("cancel", (event) => {
  if (elements.auditUserDialog.dataset.required === "true") event.preventDefault();
});

async function loadApplication(options = {}) {
  try {
    const sessionResponse = await fetch("/api/session/status", { cache: "no-store" });
    await responseJson(sessionResponse);
  } catch (error) {
    if (elements.sessionPrivacyMessage) {
      elements.sessionPrivacyMessage.textContent = error.message;
    }
    reportClientError("session-startup", error);
    return;
  }
  await loadWorkspaceMetadata();
  document.body.classList.add("session-identifying");
  try { await ensureAuditUser(); } finally { document.body.classList.remove("session-identifying"); }
  const loaded = await loadSchema(options);
  if (loaded) {
    document.body.classList.remove("session-pending");
    document.body.classList.add("session-authenticated");
  }
}

function hasUnsavedWorkspaceChanges() {
  const cachedEntryDirty = [...state.schemaTabStates.entries()].some(
    ([schemaId, tab]) => schemaId !== state.activeSchemaId && tab?.dirty,
  );
  const cachedBuilderDirty = [...state.builderTabStates.entries()].some(
    ([schemaId, tab]) => schemaId !== state.activeSchemaId && tab?.dirty,
  );
  return Boolean(
    state.dirty ||
    generalDraftDirty() ||
    state.savingGeneralDefinitions ||
    state.recordDirty ||
    state.settingsDirty ||
    cachedEntryDirty ||
    cachedBuilderDirty
  );
}

async function closeApplication(options = {}) {
  preserveActiveSchemaState();
  if (options.confirmed !== true) {
    elements.closeConfirmMessage.textContent = hasUnsavedWorkspaceChanges()
      ? "توجد تغييرات غير محفوظة في مساحة العمل. هل تريد إغلاق البرنامج رغم ذلك؟"
      : "هل أنت متأكد من رغبتك في إغلاق البرنامج بالكامل؟";
    if (!elements.closeConfirmDialog.open) elements.closeConfirmDialog.showModal();
    return;
  }
  if (state.activeRequests > 0) {
    showToast("توجد عملية قيد التنفيذ. انتظر اكتمالها ثم أغلق التطبيق.", "error");
    return;
  }
  saveDraftLocally();
  state.closing = true;
  window.clearInterval(state.heartbeatTimer);
  elements.closeButton.disabled = true;
  try {
    const response = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idle_seconds: 2 }),
    });
    if (!response.ok) throw new Error("تعذّر بدء إغلاق التطبيق.");
  } catch (error) {
    state.closing = false;
    elements.closeButton.disabled = false;
    showToast(error.message, "error");
    sendHeartbeat();
    state.heartbeatTimer = window.setInterval(sendHeartbeat, 2000);
    return;
  }
  window.clearInterval(state.draftTimer);
  window.clearInterval(state.builderAutosaveTimer);
  lifecycleChannel?.postMessage({ type: "closing" });
  window.location.replace("/closing.html");
}
function notifyDisconnect() {
  if (state.closing) {
    return;
  }

  try {
    navigator.sendBeacon(
      "/api/disconnect",
      new Blob([], {
        type: "text/plain",
      }),
    );
  } catch (_error) {
    // Closing the page must not display an error.
  }
}
async function sendHeartbeat() {
  if (state.closing) {
    return;
  }

  try {
    const response = await fetch("/api/heartbeat", {
      method: "POST",
      cache: "no-store",
    });
