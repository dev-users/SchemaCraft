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
  SCAlerts.schedule();
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
    setStatus('ready', scText('جاهز'));
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
  setStatus("ready", scText("جاهز"));
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
      scText("الفئة الجديدة: ") + (elements.categoryLabel.value.trim() || scText("بلا اسم بعد"))
    );
  }

  if (
    targetType === "field" &&
    targetId === state.editingFieldId &&
    !fieldById(targetId)
  ) {
    return (
      scText("الحقل الجديد: ") + (elements.fieldLabel.value.trim() || scText("بلا اسم بعد"))
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
    showToast(scText("تم الخروج من وضع الإدارة."));
  } catch (error) {
    showToast(error.message, "error");
  }
}

function builderAuthButtonLabel(mode = state.authMode) {
  if (mode === "initialize") {
    return scText("إنشاء وفتح");
  }
  if (mode === "change") {
    return scText("تغيير كلمة المرور");
  }
  return scText("فتح المصمّم");
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
    ? scText("جارٍ التحقق…")
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
    ? scText("إنشاء كلمة مرور المصمّم")
    : change
      ? scText("تغيير كلمة مرور المصمّم")
      : scText("فتح المصمّم");

  elements.builderAuthNote.textContent = initialize
    ? scText("أنشئ كلمة مرور من 8 أحرف على الأقل. ستُطلب عند فتح المصمّم لاحقًا.")
    : change
      ? scText("اكتب كلمة المرور الجديدة وأكدها.")
      : scText("أدخل كلمة مرور المصمّم. سيبقى المصمّم مفتوحًا حتى إغلاق التطبيق.");

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
    showToast(scText("أدخل كلمة المرور."), "error");
    elements.builderPassword.focus();
    return;
  }

  if (["initialize", "change"].includes(mode)) {
    if (password.length < 8) {
      showToast(scText("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل."), "error");
      elements.builderPassword.focus();
      return;
    }

    if (password !== elements.confirmBuilderPassword.value) {
      showToast(scText("تأكيد كلمة المرور غير مطابق."), "error");
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
      showToast(scText("تم تغيير كلمة مرور المصمّم."));
    } else {
      performSwitchMode(state.authReturnPage || "builder");
      showToast(scText("تم فتح وضع الإدارة حتى إغلاق التطبيق."));
    }
  } catch (error) {
    const visibleError =
      error?.name === "AbortError"
        ? new Error(
            scText("استغرق التحقق وقتًا أطول من المتوقع. تحقق من سجل التطبيق ثم حاول مجددًا."),
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
  if (elements.auditUserName) elements.auditUserName.textContent = current || scText("غير محدد");
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
  if (!name) return showToast(scText("اكتب اسم المستخدم."), "error");
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
      showToast(scText`المستخدم الحالي: ${state.auditUsers.current_user}`);
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
    state.attachmentImportBusy ||
    state.dirty ||
    generalDraftDirty() ||
    state.savingGeneralDefinitions ||
    state.recordDirty ||
    state.settingsDirty ||
    cachedEntryDirty ||
    cachedBuilderDirty
  );
}

function closeBlockingOperationLines() {
  const lines = [...(state.closeBlockingOperations?.keys?.() || []), ...(state.serverCloseBlockers || []).map(line => scText(line))];
  const busyFlags = [
    ["savingRecord", scText("حفظ السجل الحالي ما زال قيد التنفيذ.")],
    ["savingSchema", scText("حفظ التصميم أو تحديث المصنف ما زال قيد التنفيذ.")],
    ["loadingRecord", scText("تحميل السجل ما زال قيد التنفيذ.")],
    ["backingUp", scText("إنشاء النسخة الاحتياطية ما زال قيد التنفيذ.")],
    ["attachmentImportBusy", scText("استيراد المرفقات ما زال قيد التنفيذ.")],
    ["savingGeneralDefinitions", scText("حفظ التعريفات العامة ما زال قيد التنفيذ.")],
  ];
  for (const [flag, description] of busyFlags) {
    if (state[flag]) lines.push(description);
  }
  if (state.closeBlockingRequests > 0 && !lines.length) {
    lines.push(scText("تحديث بيانات التطبيق ما زال قيد التنفيذ."));
  }
  return [...new Set(lines)];
}

async function pollServerCloseReadiness() {
  if (!state.closeBlockedAwaitingIdle || state.closing || !state.serverCloseBlockers.length || state.serverClosePollRunning) return;
  state.serverClosePollRunning = true;
  window.clearTimeout(state.serverClosePollTimer);
  try {
    const response = await fetch("/api/shutdown/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Shutdown status unavailable");
    const result = await response.json();
    if (!Array.isArray(result.blocking_operations)) throw new Error("Invalid shutdown status");
    state.serverCloseBlockers = result.blocking_operations.filter(line => typeof line === "string" && line);
    queueCloseReadinessCheck();
  } catch {
    // A failed status request cannot prove the export has ended. Retry quietly.
  } finally {
    state.serverClosePollRunning = false;
    if (state.closeBlockedAwaitingIdle && !state.closing && state.serverCloseBlockers.length) {
      state.serverClosePollTimer = window.setTimeout(() => void pollServerCloseReadiness(), 1000);
    }
  }
}

function queueCloseReadinessCheck() {
  if (!state.closeBlockedAwaitingIdle || state.closing) return;
  window.clearTimeout(state.closeReadinessTimer);
  // Let the operation's catch/finally and any next request finish first,
  // rather than notifying during a batch's next item.
  state.closeReadinessTimer = window.setTimeout(() => {
    state.closeReadinessTimer = null;
    if (!state.closeBlockedAwaitingIdle || state.closing || closeBlockingOperationLines().length) return;
    state.closeBlockedAwaitingIdle = false;
    const ready = scText("انتهت العمليات التي كانت تمنع الإغلاق. يمكنك الآن إغلاق البرنامج.");
    const failure = elements.toast?.classList.contains("toast-error") && elements.toast.textContent !== state.closeBlockedMessage
      ? elements.toast.textContent : "";
    // A failed operation also releases its blocker; keep its error visible.
    showToast(failure ? `${failure}\n${ready}` : ready, failure ? "error" : "success");
    state.closeBlockedMessage = "";
  }, 80);
}

async function closeApplication(options = {}) {
  preserveActiveSchemaState();
  if (options.confirmed !== true) {
    elements.closeConfirmMessage.textContent = hasUnsavedWorkspaceChanges()
      ? scText("توجد تغييرات غير محفوظة في مساحة العمل. هل تريد إغلاق البرنامج رغم ذلك؟")
      : scText("هل أنت متأكد من رغبتك في إغلاق البرنامج بالكامل؟");
    if (!elements.closeConfirmDialog.open) elements.closeConfirmDialog.showModal();
    return;
  }
  const lines = closeBlockingOperationLines();
  if (lines.length) {
    state.closeBlockedAwaitingIdle = true;
    state.closeBlockedMessage = [scText("لا يمكن إغلاق البرنامج قبل انتهاء العمليات التالية:"), ...lines].join("\n");
    showToast(state.closeBlockedMessage, "error");
    queueCloseReadinessCheck();
    if (state.serverCloseBlockers.length) void pollServerCloseReadiness();
    return;
  }
  state.closeBlockedAwaitingIdle = false;
  state.closeBlockedMessage = "";
  window.clearTimeout(state.closeReadinessTimer);
  state.closeReadinessTimer = null;
  window.clearTimeout(state.serverClosePollTimer);
  state.serverClosePollTimer = null;
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
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(scText(result.error || "تعذّر بدء إغلاق التطبيق."));
      if (response.status === 409 && Array.isArray(result.blocking_operations)) {
        error.closeBlockers = result.blocking_operations.filter(line => typeof line === "string" && line);
      }
      throw error;
    }
  } catch (error) {
    state.closing = false;
    elements.closeButton.disabled = false;
    if (error.closeBlockers?.length) {
      state.serverCloseBlockers = error.closeBlockers;
      state.closeBlockedAwaitingIdle = true;
      state.closeBlockedMessage = [scText("لا يمكن إغلاق البرنامج قبل انتهاء العمليات التالية:"), ...closeBlockingOperationLines()].join("\n");
      showToast(state.closeBlockedMessage, "error");
      void pollServerCloseReadiness();
    } else showToast(error.message, "error");
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
