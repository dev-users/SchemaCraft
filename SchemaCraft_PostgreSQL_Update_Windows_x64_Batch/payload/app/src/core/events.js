    if (!response.ok) {
      throw new Error(`Heartbeat failed with status ${response.status}`);
    }

    void flushClientLogs();

    if (state.serverOffline) {
      state.serverOffline = false;

      setStatus("ready", scText("جاهز"));

      showToast(scText("تمت إعادة الاتصال بالتطبيق."));
    }
  } catch (error) {
    if (!state.serverOffline) {
      state.serverOffline = true;

      reportClientError("server-connection", error);

      setStatus("error", scText("الخادم غير متصل — شغّل التطبيق مرة أخرى"));

      showToast(
        scText("انقطع الاتصال بالخادم. ") +
          scText("شغّل التطبيق مرة أخرى ثم أعد محاولة الحفظ."),
        "error",
      );
    }
  }
}

elements.homeModeButton.addEventListener("click", () => switchMode("home"));
elements.entryModeButton.addEventListener("click", () => switchMode("entry"));
elements.searchPageButton.addEventListener("click", () => switchMode("search"));
elements.importPageButton.addEventListener("click", () => switchMode("import"));
elements.exportPageButton.addEventListener("click", () => switchMode("export"));
elements.settingsPageButton.addEventListener("click", () =>
  switchMode("settings"),
);
elements.builderModeButton.addEventListener("click", () =>
  switchMode("builder"),
);
elements.openBuilderButton.addEventListener("click", () =>
  switchMode("builder"),
);
elements.closeButton.addEventListener("click", closeApplication);
elements.closeConfirmCancel.addEventListener("click", () => elements.closeConfirmDialog.close());
elements.closeConfirmAccept.addEventListener("click", () => {
  elements.closeConfirmDialog.close();
  void closeApplication({ confirmed: true });
});
elements.closeConfirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  elements.closeConfirmDialog.close();
});
elements.builderSidebarAddCategoryButton.addEventListener("click", () => {
  openCategoryDialog();
});
elements.builderSidebarAddFieldButton.addEventListener("click", () => openNewFieldCategoryDialog("schema"));
elements.newFieldCategory.addEventListener("change", refreshNewFieldPlacement);
elements.confirmNewFieldCategory.addEventListener("click", confirmNewFieldCategory);
elements.confirmCategoryButton.addEventListener(
  "click",
  saveCategoryFromDialog,
);
elements.confirmFieldButton.addEventListener("click", () => void saveFieldFromDialog());
elements.confirmConditionButton.addEventListener(
  "click",
  saveConditionFromDialog,
);
elements.categoryKind.addEventListener("change", updateCategoryDialogType);
elements.categoryParent.addEventListener("change", updateCategoryParentFieldEditor);
elements.categoryHasParent.addEventListener("change", () => updateCategoryParentFieldEditor());
elements.categoryCardTitleField.addEventListener("change", updateCategoryDialogType);
elements.categoryCardSortMode.addEventListener("change", updateCategoryCardSortEditor);
elements.categoryImportSource.addEventListener("change", renderCategoryImportFields);
elements.applyCategoryImport.addEventListener("click", applyCategoryImportSelection);
elements.fieldType.addEventListener("change", updateFieldDialogType);
elements.fieldSearchable.addEventListener("change", updateFieldDialogType);
elements.fieldShowResult.addEventListener("change", updateFieldDialogType);
elements.fieldUserValueMode.addEventListener("change", updateFieldDialogType);
elements.fieldTextMode.addEventListener("change", updateFieldDialogType);
elements.fieldListMode.addEventListener("change", updateFieldDialogType);
elements.fieldDateMode.addEventListener("change", updateFieldDialogType);
elements.fileNamingMode.addEventListener("change", updateFieldDialogType);
elements.relatedPersonSourceCheckbox.addEventListener("change", () => fillRelatedPersonSourceFields());
elements.fieldAutoSource.addEventListener("change", () => {
  fillAutoUpdateOperators();
  updateAutoUpdateEditor();
});
elements.fieldAutoOperator.addEventListener("change", updateAutoUpdateEditor);
elements.fieldAutoAction.addEventListener("change", updateAutoUpdateEditor);
elements.fieldOptions.addEventListener("input", () => {
  reconcileFieldOptions();
  renderOptionFilterMatrix();
});
elements.optionFilterSource.addEventListener("change", () => {
  state.optionFilterDraft = elements.optionFilterSource.value
    ? {
        source_field_id: elements.optionFilterSource.value,
        mappings: {},
        unmatched: "none",
      }
    : null;

  updateFieldDialogType();
  renderOptionFilterMatrix();
});
elements.categoryDialog.addEventListener("close", () => {
  if (state.categoryDialogCommitted || !state.categoryConditionsSnapshot) {
    return;
  }

  state.draftSchema.conditions = deepClone(state.categoryConditionsSnapshot);

  if (state.categoryDirtyBeforeOpen) {
    markDirty();
  } else {
    markClean();
  }

  renderBuilderConditions();
});

elements.fieldDialog.addEventListener("close", () => {
  if (state.fieldDialogCommitted || !state.fieldConditionsSnapshot) {
    return;
  }

  state.draftSchema.conditions = deepClone(state.fieldConditionsSnapshot);

  if (state.fieldDirtyBeforeOpen) {
    markDirty();
  } else {
    markClean();
  }

  renderBuilderConditions();
});
elements.addFilePartButton.addEventListener("click", addFilePart);
elements.addCategoryConditionButton.addEventListener("click", () => {
  openConditionDialog(null, "category", state.editingCategoryId);
});

elements.addFieldConditionButton.addEventListener("click", () => {
  openConditionDialog(null, "field", state.editingFieldId);
});

elements.conditionSource.addEventListener("change", () => {
  state.conditionLiteralValue = "";
  fillConditionOperators();
  renderConditionValueControl("");
});

elements.conditionOperator.addEventListener("change", () => {
  const previous = currentConditionValue();

  renderConditionValueControl(previous);
});
elements.conditionCompareEnabled.addEventListener("change", () => {
  if (!state.conditionCompareEnabled) state.conditionLiteralValue = currentConditionValue();
  state.conditionCompareEnabled = elements.conditionCompareEnabled.checked;
  if (!state.conditionCompareEnabled) state.conditionCompareFieldId = "";
  renderConditionValueControl(state.conditionLiteralValue ?? "");
});
elements.saveSchemaButton.addEventListener("click", saveSchema);
elements.backupButton.addEventListener("click", createBackup);
elements.chooseSearchFieldsButton.addEventListener(
  "click",
  openSearchFieldsDialog,
);
elements.selectAllSearchFieldsButton.addEventListener("click", () => {
  elements.searchFieldOptions
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.checked = true;
    });
});
elements.clearAllSearchFieldsButton.addEventListener("click", () => {
  elements.searchFieldOptions
    .querySelectorAll('input[type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.checked = false;
    });
});
elements.resetSearchFieldsButton.addEventListener(
  "click",
  resetTemporarySearchFields,
);
elements.applySearchFieldsButton.addEventListener(
  "click",
  applyTemporarySearchFields,
);
elements.recordForm.addEventListener("input", (event) => {
  const control = event.target.closest("[data-value-control]");

  if (control) {
    clearFieldValidation(control);
  }
});

// Preserve the active editor across synchronous value-driven DOM updates.
// Nothing is queued: a later Tab, click or blur always belongs to the user.
for (const type of ["input", "change"]) {
  const focusedEditors = new WeakMap();
  elements.recordForm.addEventListener(type, (event) => {
    const active = document.activeElement;
    if (active?.matches('input, select, textarea') && elements.recordForm.contains(active)) {
      focusedEditors.set(event, active);
    }
  }, true);
  elements.recordForm.addEventListener(type, (event) => {
    const active = focusedEditors.get(event);
    if (active?.isConnected && !active.closest('[hidden]') && document.activeElement !== active) {
      active.focus({ preventScroll: true });
    }
  });
}

elements.recordForm.addEventListener("focusout", (event) => {
  const control = event.target.closest("[data-value-control]");

  if (!control) {
    return;
  }

  validateEntryControl(control, true);
  control._closeListMenu?.();
});
elements.recordForm.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const control = event.target.closest("[data-value-control]");
  if (focusAdjacentEntryField(event.target, event.shiftKey)) event.preventDefault();
});
elements.recordForm.addEventListener("focusin", (event) => {
  const control = event.target.closest(
    "[data-value-control], [data-calendar-day], [data-calendar-month], [data-calendar-year], [data-linked-record-code], [data-file-picker], [data-file-name], [data-related-tab], button, a[href]",
  );
  if (control) activateEntryCategoryForControl(control);
});
elements.confirmBuilderAuthButton.addEventListener("click", submitBuilderAuth);
elements.discardSchemaButton.addEventListener("click", () => void discardSchemaChanges());
elements.saveRecordButton.addEventListener("click", saveCurrentRecord);
elements.resetFormButton.addEventListener("click", requestNewRecord);
elements.archiveRecordButton.addEventListener("click", archiveCurrentRecord);
elements.deleteRecordButton.addEventListener("click", deleteCurrentRecord);
elements.searchButton.addEventListener("click", searchRecords);
elements.clearSearchButton.addEventListener("click", clearSearch);
elements.fullSearchOptionsSummary?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-full-search-column]");
  if (chip) removeFullSearchResultField(chip.dataset.removeFullSearchColumn);
});
elements.schemaFilterSelectionSummary?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-full-search-filter]");
  if (chip) removeFullSearchFilter(chip.dataset.removeFullSearchFilter);
});
elements.searchPanel.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.target.closest("textarea, button")) {
    event.preventDefault();
    void searchRecords();
  }
});
elements.searchPanel.addEventListener("click", (event) => {
  const heading = event.target.closest("[data-collapse-search-panel]");
  if (heading && (event.target === heading || event.target.classList.contains("search-title-row"))) {
    toggleSearchPanel();
  }
});
// One sprite and action vocabulary for static and dynamically rendered buttons.
function standardizeWorkflowIconOnlyButton(button) {
  if (button.matches('.dialog-close, [data-remove-shared-filter], .builder-preview-name, .selection-chip, .schema-tab, [role="tab"]')) return false;
  if (button.closest('.action-rail, .entry-action-rail, .builder-action-rail, .action-rail-card, .search-page-sidebar, .left-panel')) return false;
  const source = window.SchemaCraftI18n?.sourceFor || (x=>x);
  const label = button.dataset.workflowActionLabel || button.dataset.uiOriginalLabel || button.getAttribute('aria-label') || button.dataset.uiOriginalText || button.textContent.trim();
  const identity = source(button.dataset.uiOriginalText || label).trim();
  const keys = `${button.id} ${Object.keys(button.dataset).join(' ')}`;
  const isDelete = button.dataset.actionKind === 'delete' || /(?:delete|remove)(?:[-_A-Z]|$)/.test(keys) || /^(حذف|إزالة)(?:\s|$)/.test(identity) || /^(مسح|حذف) السجل/.test(identity) || !!button.querySelector('use[href="#icon-trash"]');
  const isOpen = !!button.closest('table, .history-list, .history-table') && (/^فتح (السجل|الملف|التفاصيل)/.test(identity) || /openExportHistory|importHistoryDetails|importHistoryOpen|openRecord|openHistory/.test(keys));
  if (!isDelete && !isOpen) return false;
  const icon = isDelete ? 'trash' : 'open-record';
  if (button.dataset.workflowIconOnly === icon && button.querySelector(`use[href="#icon-${icon}"]`) && !button.textContent.trim()) return true;
  button.dataset.workflowActionLabel = label;
  button.dataset.workflowIconOnly = icon;
  button.dataset.actionKind = isDelete ? 'delete' : 'open';
  button.title = scText(source(label)); button.setAttribute('aria-label', scText(source(label)));
  button.classList.add('button', 'workflow-icon-only');
  if (isDelete) { button.classList.remove('button-danger', 'button-secondary', 'button-primary', 'button-quiet'); button.classList.add('button-danger-quiet'); }
  button.replaceChildren(actionIcon(icon)); return true;
}

function standardizeActionButton(button) {
  // Calculator keys are mathematical symbols, not record-management actions.
  if (button.closest('#entry-calculator-keys') || button.matches('.entry-calendar-day')) return;
  if (!(button instanceof HTMLButtonElement) || button.closest('.ui-text-editor-dialog')) return;
  if (standardizeWorkflowIconOnlyButton(button)) return;
  // Explicit icons belong to the design. Never infer a replacement from text.
  if (button.querySelector('svg')) return;
  if (button.matches('.schema-tab, .home-schema-browser-tab, .dashboard-history-row, .dialog-close, .related-tab-close, .category-nav-toggle, .builder-preview-name, .home-add-stat, .studio-drop-zone > button, [role="tab"], .category-nav-button')) return;
  const source = window.SchemaCraftI18n?.sourceFor || ((text) => text);
  const identity = `${button.dataset.uiOriginalLabel ?? source(button.getAttribute('aria-label') || '')} ${button.dataset.uiOriginalText ?? source(button.textContent)}`;
  const rules = [
    ['backup', 'backup', /backup|احتياط/], ['close', 'exit', /إغلاق/],
    ['restore', 'restore', /restore|استعادة/], ['delete', 'trash', /delete|remove|حذف/],
    ['discard', 'clear', /discard|تجاهل/], ['save', 'save', /save|حفظ/],
    ['cancel', 'clear', /cancel|إلغاء/], ['archive', 'archive', /archive|أرشفة/],
    ['add', 'plus', /add|new|إضافة|جديد|إنشاء/], ['clear', 'clear', /clear|مسح/],
    ['search', 'search', /search|بحث/], ['edit', 'edit', /edit|rename|تعديل|تسمية/],
  ];
  const matched = button.dataset.stableActionIcon
    ? [button.dataset.actionKind, button.dataset.stableActionIcon]
    : rules.find(([, , pattern]) => button.id && pattern.test(button.id)) || rules.find(([, , pattern]) => pattern.test(identity));
  if (!matched) return;
  button.dataset.actionKind = matched[0];
  button.dataset.stableActionIcon = matched[1];
  const svg = actionIcon(matched[1]);
  svg.dataset.autoActionIcon = '';
  button.prepend(svg);
}

function standardizeActionButtons(root) {
  if (root.nodeType !== 1) return;
  if (root.matches("button")) standardizeActionButton(root);
  root.querySelectorAll("button").forEach(standardizeActionButton);
}
standardizeActionButtons(document.body);
new MutationObserver((mutations) => {
  const roots = new Set();
  mutations.forEach((mutation) => {
    const button = mutation.target.nodeType === 1 ? mutation.target.closest("button") : mutation.target.parentElement?.closest("button");
    if (button) roots.add(button);
    mutation.addedNodes.forEach((node) => { if (node.nodeType === 1) roots.add(node); });
  });
  roots.forEach(standardizeActionButtons);
}).observe(document.body, { childList: true, subtree: true, characterData: true });

document.addEventListener("mouseover", (event) => {
  const target = event.target.closest?.("h1,h2,h3,h4,h5,h6,label,strong,small,span,p,td,th,a,button,input,textarea,select");
  if (!target || target.closest("svg") || target.type === "password" || (["entry", "builder", "readonly"].includes(state.mode) && target.closest("#category-navigator"))) return;
  const text = target.matches("input,textarea") ? target.value
    : target.matches("select") ? target.selectedOptions?.[0]?.textContent
    : target.textContent;
  if (text?.trim() && (!target.title || target.dataset.fullTextTitle)) {
    target.title = text.trim();
    target.dataset.fullTextTitle = "true";
  }
});
elements.recordForm.addEventListener("reset", handleFormReset);
elements.recordForm.addEventListener("input", () => {
  if (state.applyingAutoUpdates || state.entryPopulationDepth) return;
  applyAutoUpdateRules();
  updateConditionalVisibility();
  scheduleDraftSave();
});
elements.recordForm.addEventListener("change", (event) => {
  if (state.applyingAutoUpdates || state.entryPopulationDepth) return;
  const field = fieldById(event.target.closest("[data-value-control]")?.dataset.fieldId, state.schema);
  if (
    field?.type === "checkbox" &&
    field.unique_checked_across_cards === true &&
    event.target.checked &&
    event.target.closest("[data-related-record]")
  ) {
    const currentCard = event.target.closest("[data-related-record]");
    const records = currentCard.closest("[data-related-records]");
    records?.querySelectorAll(`[data-related-record] [data-field-id="${CSS.escape(field.id)}"]`).forEach((candidate) => {
      if (candidate !== event.target) { candidate.checked = false; candidate._syncCheckboxMeaning?.(); }
    });
  }
  applyAutoUpdateRules();
  updateConditionalVisibility();
  const records = event.target.closest("[data-related-records]");
  if (records) renumberRelatedCards(records, true);
  scheduleDraftSave();
});
elements.recordForm.addEventListener("click", (event) => {
  const categoryToggle = event.target.closest("[data-toggle-entry-category]");
  if (categoryToggle && (event.target === categoryToggle || event.target === categoryToggle.firstElementChild)) {
    const section = categoryToggle.closest("[data-entry-category]");
    setEntryCategoryCollapsed(
      section,
      !section.classList.contains("entry-category-collapsed"),
    );
    return;
  }
  const systemRecordCode = event.target.closest("[data-copy-system-record-code]");
  if (systemRecordCode) {
    copyRecordCode(systemRecordCode.value);
    return;
  }
  const add = event.target.closest("[data-add-related]");
  if (add) {
    addRelatedCard(add.dataset.addRelated, null, {
      focusFirst: true,
      parentChildId: add.dataset.parentChildId || "",
    });
  }
});
elements.builderView?.querySelectorAll("[data-collapse-builder-panel]").forEach(heading => {
  heading.tabIndex = 0; heading.setAttribute("role", "button");
});
elements.builderView?.addEventListener("keydown", event => {
  if (!event.target.matches("[data-collapse-builder-panel]") || !["Enter", " "].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation(); event.target.click();
});
elements.builderView?.addEventListener("click", (event) => {
  const heading = event.target.closest("[data-collapse-builder-panel]");
  if (!heading || event.target.closest("button,input,select,textarea,a,label")) return;
  const panel = heading.closest(".builder-intro, .builder-panel");
  if (!panel) return;
  const collapsed = panel.classList.toggle("builder-panel-collapsed");
  heading.setAttribute("aria-expanded", String(!collapsed));
});
elements.categoryNavigator?.addEventListener("click", (event) => {
  const heading = event.target.closest("[data-collapse-builder-sidebar]");
  if (!heading || event.target !== heading || state.mode !== "builder") return;
  const collapsed = elements.categoryNavigator.classList.toggle("builder-sidebar-collapsed");
  heading.setAttribute("aria-expanded", String(!collapsed));
});
elements.builderActionRail?.addEventListener("click", (event) => {
  const heading = event.target.closest("[data-collapse-builder-action-rail]");
  if (!heading || event.target !== heading) return;
  const collapsed = elements.builderActionRail.classList.toggle("builder-action-rail-collapsed");
  heading.setAttribute("aria-expanded", String(!collapsed));
});
elements.searchResults.addEventListener("click", (event) => {
  const copy = event.target.closest("[data-copy-record-code]");
  if (copy) {
    copyRecordCode(copy.dataset.copyRecordCode);
    return;
  }
  const readonly = event.target.closest("[data-readonly-record]");
  if (readonly) {
    openReadonlyRecord(readonly.dataset.readonlyRecord);
    return;
  }
  const open = event.target.closest("[data-open-search-record]");
  if (open) {
    loadRecord(open.dataset.openSearchRecord);
  }
});
elements.unsavedSaveButton.addEventListener("click", () => {
  void resolveRecordNavigation("save");
});
elements.unsavedDiscardButton.addEventListener("click", () => {
  void resolveRecordNavigation("discard");
});
elements.unsavedStayButton.addEventListener("click", () => {
  void resolveRecordNavigation("stay");
});
elements.unsavedRecordDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void resolveRecordNavigation("stay");
});

elements.homeNavigation.addEventListener("click", (event) => {
  const builderSchemaTab = event.target.closest("[data-home-builder-schema]");
  if (builderSchemaTab) {
    const scopeId = builderSchemaTab.dataset.homeBuilderSchema;
    if (!builderSchemaTab.classList.contains("is-active")) {
      selectHomeBuilderSchema(scopeId);
      return;
    }
    if (scopeId === "__global__") {
      state.builderScope = "global";
      switchMode("builder");
      renderBuilderScope();
    } else {
      void switchActiveSchema(scopeId, { mode: "builder" }).then(() => {
        state.builderScope = "schema";
        renderBuilderScope();
      });
    }
    return;
  }
  const dataSchemaTab = event.target.closest("[data-home-data-schema]");
  if (dataSchemaTab) {
    const schemaId = dataSchemaTab.dataset.homeDataSchema;
    if (!dataSchemaTab.classList.contains("is-active")) {
      selectHomeDataSchema(schemaId);
      return;
    }
    void switchActiveSchema(schemaId, { mode: "entry" });
    return;
  }
  const tabDestination = event.target.closest("[data-home-tab-destination]");
  if (tabDestination) {
    if (tabDestination.dataset.homeTabDestination === "builder-global") {
      state.builderScope = "global";
      switchMode("builder");
      renderBuilderScope();
    } else {
      void switchActiveSchema(tabDestination.dataset.homeTabSchemaId, {
        mode: tabDestination.dataset.homeTabDestination,
      }).then(() => {
        if (tabDestination.dataset.homeTabDestination === "builder") {
          state.builderScope = "schema";
          renderBuilderScope();
        }
      });
    }
    return;
  }
  const customStat = event.target.closest("[data-configure-home-stat]");
  if (customStat) {
    openHomeCustomStatDialog(customStat.dataset.configureHomeStat || "");
    return;
  }
  const builderChart = event.target.closest("[data-configure-home-builder-chart]");
  if (builderChart) {
    openHomeBuilderChartDialog(
      builderChart.dataset.configureHomeBuilderChart,
      builderChart.dataset.homeBuilderChartSlot,
    );
    return;
  }
  const chart = event.target.closest("[data-configure-home-chart]");
  if (chart) {
    openHomeChartDialog(chart.dataset.configureHomeChart, chart.dataset.homeChartSlot);
    return;
  }
  const builderHistory = event.target.closest("[data-open-builder-history]");
  if (builderHistory) {
    void openBuilderHistoryItem(builderHistory.dataset.openBuilderHistory);
    return;
  }
  const operation = event.target.closest("[data-home-operation-id]");
  if (operation) {
    void openHomeOperation(operation.dataset.homeOperationKind, operation.dataset.homeOperationId);
    return;
  }
  const history = event.target.closest("[data-search-history-id]");
  if (history) {
    applySearchHistoryItem(history.dataset.searchHistoryId);
    return;
  }
  const schemaDestination = event.target.closest("[data-home-schema-destination]");
  if (schemaDestination) {
    void switchActiveSchema(schemaDestination.dataset.homeSchemaId, {
      mode: schemaDestination.dataset.homeSchemaDestination,
    });
    return;
  }
  const destination = event.target.closest("[data-home-destination]")
    ?.dataset.homeDestination;
  if (destination) {
    switchMode(destination);
    return;
  }
  const schemaPanel = event.target.closest(".home-schema-panel");
  const schemaHeading = event.target.closest(".home-schema-panel-heading");
  if (schemaPanel && schemaHeading && event.target === schemaHeading && schemaHeading.parentElement === schemaPanel
      && !event.target.closest("button, a, input, select, textarea")) {
    toggleHomeSchemaPanel(schemaPanel);
    return;
  }
  const card = event.target.closest(".home-dashboard-card");
  const cardHeading = event.target.closest(".home-card-heading");
  if (card && cardHeading && event.target === cardHeading && cardHeading.parentElement === card
      && !event.target.closest("button, a, input, select, textarea, [data-home-destination]")) {
    toggleHomeCard(card);
  }
});
elements.homeDataSchemaTabs?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...elements.homeDataSchemaTabs.querySelectorAll("[data-home-data-schema]")];
  if (!tabs.length) return;
  const currentTab = event.target.closest("[data-home-data-schema]");
  const current = Math.max(0, tabs.indexOf(currentTab));
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else if (event.key === "ArrowLeft") next = (current + 1) % tabs.length;
  else next = (current - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});
elements.homeBuilderSchemaTabs?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...elements.homeBuilderSchemaTabs.querySelectorAll("[data-home-builder-schema]")];
  if (!tabs.length) return;
  const currentTab = event.target.closest("[data-home-builder-schema]");
  const current = Math.max(0, tabs.indexOf(currentTab));
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else if (event.key === "ArrowLeft") next = (current + 1) % tabs.length;
  else next = (current - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});
elements.refreshSearchHistory?.addEventListener("click", () => void loadSearchHistory().then(renderSearchHistory));
elements.clearSearchHistory?.addEventListener("click", () => void clearApplicationHistory("search"));
elements.recentRecords.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-record]");
  if (edit) {
    event.stopPropagation();
    if (edit.dataset.recordSchema && edit.dataset.recordSchema !== state.activeSchemaId) {
      void switchActiveSchema(edit.dataset.recordSchema, {
        mode: "entry",
        openCode: edit.dataset.editRecord,
      });
    } else {
      openRecordForEditing(edit.dataset.editRecord);
    }
    return;
  }
  const readonly = event.target.closest("[data-readonly-record]");
  if (readonly) {
    event.stopPropagation();
    const originalSchema = state.activeSchemaId;
    if (readonly.dataset.recordSchema && readonly.dataset.recordSchema !== originalSchema) {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("view", "readonly");
      url.searchParams.set("record", readonly.dataset.readonlyRecord);
      url.searchParams.set("schema_id", readonly.dataset.recordSchema);
      window.open(url.toString(), `SchemaCraft-readonly-${readonly.dataset.readonlyRecord}-${Date.now()}`);
    } else {
      openReadonlyRecord(readonly.dataset.readonlyRecord);
    }
  }
});

elements.fullSearchSubmitButton.addEventListener("click", () => {
  if (state.searchType === "global") void runMultiSchemaSearch();
  else void runFullSearch({ resetPage: true });
});
elements.fullSearchClearButton.addEventListener("click", clearFullSearch);
elements.fullSearchOptionsButton.addEventListener("click", openFullSearchFieldsDialog);
elements.searchFilterConfigButton?.addEventListener("click", openFullSearchFilterDialog);
installSharedFilterInteractions(elements.fullSearchFields, {
  schema: () => state.schema,
  schemaId: () => state.activeSchemaId,
  onRemove: (fieldId) => {
    state.fullSearchFieldIds = activeFullSearchFieldIds().filter((candidate) => candidate !== fieldId);
    delete state.fixedSearchFilters[fieldId];
    renderFullSearchFilters();
  },
});
elements.searchNewButton?.addEventListener("click", startNewSearchOperation);
elements.searchClearHeadersButton?.addEventListener("click", () => {
  state.fullSearchColumnIds = null;
  state.fullSearchRecordIdColumn = true;
  updateFullSearchOptionsSummary();
  showToast(scText("أُعيدت حقول النتائج الافتراضية."));
});
elements.searchHistoryQuery?.addEventListener("input", renderSearchHistory);
elements.searchHistoryQueryButton?.addEventListener("click", () => void loadSearchHistory(elements.searchHistoryQuery.value));
elements.searchHistoryQuery?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); renderSearchHistory(); }
});
elements.resetFullSearchFiltersButton.addEventListener("click", resetFullSearchFilters);
elements.resetFullSearchFieldsButton.addEventListener("click", resetFullSearchFields);
elements.applyFullSearchFiltersButton.addEventListener("click", applyFullSearchFilters);
elements.applyFullSearchFieldsButton.addEventListener("click", applyFullSearchFields);
[elements.fullSearchFilterDialog, elements.fullSearchFieldsDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  const action = event.target.closest("[data-full-search-option-action]");
  if (!action) {
    return;
  }
  setFullSearchOptionGroup(
    action.dataset.fullSearchOptionTarget,
    action.dataset.fullSearchOptionAction === "select",
  );
}));
elements.fullSearchFilterDialog.addEventListener("change", handleFullSearchOptionChange);
elements.fullSearchFieldsDialog.addEventListener("change", handleFullSearchOptionChange);
elements.fullSearchFields?.addEventListener("mousedown", (event) => {
  const option = event.target.closest("select[multiple] option");
  if (!option) return;
  event.preventDefault();
  option.selected = !option.selected;
  option.parentElement.dispatchEvent(new Event("change", { bubbles: true }));
});
elements.fullSearchPrevious.addEventListener("click", () => {
  state.fullSearchOffset = Math.max(
    0,
    state.fullSearchOffset - Number(state.schema.app.search_page_size || 50),
  );
  void runFullSearch();
});
elements.fullSearchNext.addEventListener("click", () => {
  state.fullSearchOffset += Number(state.schema.app.search_page_size || 50);
  void runFullSearch();
});
elements.fullSearchTableBody.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-record]");
  if (edit) {
    const match = state.fullSearchMatches.find(
      (candidate) => candidate.record_code === edit.dataset.editRecord,
    );
    openRecordForEditing(edit.dataset.editRecord, match?.title || "");
    return;
  }
  const readonly = event.target.closest("[data-readonly-record]");
  if (readonly) {
    openReadonlyRecord(readonly.dataset.readonlyRecord);
  }
});

elements.exportButton.addEventListener("click", exportCurrentResults);
elements.inspectProfileExport?.addEventListener("click", () => void inspectProfileExport());
elements.profileExportButton?.addEventListener("click", () => void exportProfilePdf());
elements.portableExportButton?.addEventListener("click", () => void exportPortablePackage());
elements.exportFieldList.addEventListener("change", handleExportFieldSelection);
elements.exportSelectAllCategories.addEventListener("click", () => {
  setAllExportCategories(true);
});
elements.exportClearCategories.addEventListener("click", () => {
  setAllExportCategories(false);
});
elements.inspectImportButton.addEventListener("click", inspectSelectedImport);
elements.commitImportButton.addEventListener("click", commitInspectedImport);
elements.inspectPortableImport?.addEventListener("click", () => void inspectPortableImportFile());
elements.commitPortableImport?.addEventListener("click", () => void commitPortableImportFile());
elements.portableImportFile?.addEventListener("change", () => {
  state.portableImportData = "";
  state.portableImportInspection = null;
  elements.portableImportFileName.textContent = elements.portableImportFile.files?.[0]?.name || scText("لم يُختر ملف");
  elements.commitPortableImport.disabled = true;
});
elements.importFile.addEventListener("change", () => {
  state.importFileData = "";
  state.importInspection = null;
  elements.importFileNameDisplay.textContent =
    elements.importFile.files?.[0]?.name || scText("لم يُختر ملف");
  elements.importMappingArea.hidden = true;
  elements.importMappingPlaceholder.hidden = false;
  elements.importResult.textContent = "";
  elements.commitImportButton.disabled = true;
  elements.commitImportButton.title = "";
});

elements.saveSettingsButton.addEventListener("click", saveApplicationSettings);
elements.saveWorkspacePreferences?.addEventListener("click", () => void saveWorkspacePreferences());
elements.settingBackgroundImage?.addEventListener("change", previewSelectedWorkspaceBackground);
elements.sessionModeBadge.addEventListener("click", () => {
  if (builderUnlocked()) elements.adminSessionDialog.showModal();
  else {
    state.authReturnPage = state.mode === "loading" ? "home" : state.mode;
    openBuilderAuthDialog(state.schema?.builder_access?.configured ? "unlock" : "initialize");
  }
});
elements.badgeChangePassword?.addEventListener("click", () => {
  elements.adminSessionDialog.close();
  state.authReturnPage = state.mode;
  openBuilderAuthDialog("change");
});
elements.badgeExitAdmin?.addEventListener("click", () => {
  elements.adminSessionDialog.close();
  void lockAdministration();
});
elements.saveShortcutsButton?.addEventListener("click", () => void saveShortcutSettings());
elements.previousSearchResult.addEventListener("click", () =>
  moveSearchResult(-1),
);
elements.nextSearchResult.addEventListener("click", () =>
  moveSearchResult(1),
);
elements.builderCategories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-builder-action]");
  if (button) {
    void handleBuilderAction(button);
  }
});
document.addEventListener('click', (event) => {
  if (state.mode !== 'builder' || event.target.closest('[data-preview-select], [data-preview-actions], dialog')) return;
  [elements.builderCategories, elements.globalCategoryList, elements.globalFieldList].forEach(root => selectBuilderPreviewItem('', '', false, root));
});
[elements.builderCategories, elements.globalCategoryList, elements.globalFieldList].forEach(root => root.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const selected = root.dataset.selectedItem;
  const name = [...root.querySelectorAll('[data-preview-select]')].find((item) => item.dataset.previewSelect === selected);
  selectBuilderPreviewItem('', '', false, root);
  name?.focus({preventScroll:true});
  event.preventDefault();
}));
elements.filePartsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-builder-action]");
  if (button) {
    handleFilePartAction(button);
  }
});
[
  elements.settingTitle,
  elements.settingSingular,
  elements.settingPlural,
  elements.settingPrimaryColor,
  elements.settingStartupPage,
  elements.settingSearchPageSize,
  elements.settingShowEntrySearch,
  elements.settingDraftAutosave,
].forEach((control) => {
  control.addEventListener("input", markSettingsDirty);
  control.addEventListener("change", markSettingsDirty);
});
[
  elements.numberFormatThousands,
  elements.numberPreserveLeadingZeros,
  ...elements.numberBehaviorEditor.querySelectorAll("[data-number-special]"),
].forEach((control) => {
  control.addEventListener("change", updateNumberStorageNote);
});
[
  elements.currentBuilderPassword,
  elements.builderPassword,
  elements.confirmBuilderPassword,
].forEach((control) => {
  control.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitBuilderAuth();
  });
});
document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-dialog]");
  if (close) {
    document.getElementById(close.dataset.closeDialog)?.close();
  }
});
document.addEventListener("keydown", (event) => {
  const shortcut = shortcutFromKeyboardEvent(event);
  const action = state.workspaceSettings?.shortcuts?.[shortcut];
  if (action && !event.target.closest(".shortcut-capture")) {
    const typing = event.target.closest("input, textarea, select, [contenteditable='true']");
    const actions = Array.isArray(action) ? action : [action];
    const typingSafe = actions.some((candidate) => ["context_save", "save_record", "save_builder", "close_dialog", "close_application"].includes(candidate));
    if (typing && !typingSafe) return;
    event.preventDefault();
    event.stopPropagation();
    runShortcutAction(action);
    return;
  }
  if (event.key !== "Enter") {
    return;
  }

  if (
    event.target.closest("#builder-auth-dialog") ||
    ["TEXTAREA", "BUTTON"].includes(event.target.tagName)
  ) {
    return;
  }

  if (event.target.closest("form")) {
    event.preventDefault();
  }
});
window.addEventListener("pagehide", notifyDisconnect);
window.addEventListener("beforeunload", (event) => {
  if (
    hasUnsavedWorkspaceChanges() &&
    !state.closing
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});

elements.recordCode.value = generateRecordCode();
displayRecordMetadata();
if (elements.searchPanel && elements.entryActionRail) {
  elements.entryActionRail.append(elements.searchPanel);
}
function installWorkflowPanelCollapsing() {
  const panels = document.querySelectorAll('#full-search-view .workspace-panel, #import-view .workspace-panel, #export-view .workspace-panel, #builder-history-dialog');
  panels.forEach((panel) => {
    if (panel.closest('.search-page-sidebar') || (panel.hasAttribute('data-no-auto-heading') && !panel.querySelector(':scope > .section-title-line'))) return;
    let heading = panel.querySelector(':scope > .section-title-line, :scope > .panel-heading, :scope > .full-search-filter-heading, :scope > .import-step-heading');
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'section-title-line';
      const title = document.createElement('h3');
      title.textContent = panel.closest('#import-view') ? scText('الاستيراد') : panel.closest('#export-view') ? scText('التصدير') : scText('البحث');
      heading.append(title);
      panel.prepend(heading);
    }
    if (heading.dataset.collapseInstalled) return;
    heading.dataset.collapseInstalled = 'true';
    heading.classList.add('workflow-collapse-heading');
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.setAttribute('aria-expanded', 'true');
    const toggle = () => {
      const collapsed = panel.classList.toggle('workflow-panel-collapsed');
      heading.setAttribute('aria-expanded', String(!collapsed));
    };
    heading.addEventListener('click', (event) => {
      if (event.target.closest('button, input, select, textarea, a, label')) return;
      toggle();
    });
    heading.addEventListener('keydown', (event) => {
      if (event.target === heading && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        toggle();
      }
    });
  });
}

function portraitGridRows(height, gap = 14) {
  return Math.max(1, Math.ceil((height + gap) / 4));
}

function installPortraitGridSizing() {
  if (!window.ResizeObserver) return;
  const observed = new WeakSet();
  const resize = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => {
      const grid = target.parentElement;
      if (!grid?.classList.contains('portrait-field-grid')) return;
      const gap = parseFloat(grid.style.getPropertyValue('--entry-row-gap')) || 14;
      const height = target.getBoundingClientRect().height;
      if (height > 0) target.style.setProperty('--measured-grid-rows', String(portraitGridRows(height, gap)));
    });
  });
  const discover = () => document.querySelectorAll(':is(#record-form, #builder-categories, #global-category-list, #global-field-list) .field-grid').forEach((grid) => {
    if (![...grid.children].some((child) => child.classList.contains('profile-image-field'))) return;
    if (!grid.classList.contains('portrait-field-grid')) {
      grid.style.setProperty('--entry-row-gap', (parseFloat(getComputedStyle(grid).rowGap) || 14) + 'px');
      grid.classList.add('portrait-field-grid');
    }
    for (const field of grid.children) {
      if (!observed.has(field)) { observed.add(field); resize.observe(field); }
    }
  });
  new MutationObserver(discover).observe(elements.recordForm, { childList: true, subtree: true });
  [elements.builderCategories, elements.globalCategoryList, elements.globalFieldList].forEach(root => new MutationObserver(discover).observe(root, { childList:true, subtree:true }));
  discover();
}
window.addEventListener('resize', () => {
  [elements.builderCategories, elements.globalCategoryList, elements.globalFieldList].forEach(root => {
  const selected = root.dataset.selectedItem;
  if (selected) {
    const [kind, id] = selected.split(':');
    selectBuilderPreviewItem(kind, id, false, root);
  }
  });
});
SCAlerts.init();
installSearchHistoryControls();
installWorkflowPanelCollapsing();
installPortraitGridSizing();
installStickyHeaderTracking();
installViewportPaintRecovery();
loadApplication();
sendHeartbeat();
window.addEventListener("error", (event) => {
  reportClientError(
    "window-error",
    event.error || event.message,
    `${event.filename || ""}:` +
      `${event.lineno || 0}:` +
      `${event.colno || 0}`,
  );
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientError("unhandled-promise", event.reason);
});
state.heartbeatTimer = window.setInterval(sendHeartbeat, 2000);
state.draftTimer = window.setInterval(
  saveDraftLocally,
  RECORD_DRAFT_AUTOSAVE_MS,
);

state.builderAutosaveTimer = window.setInterval(
  autosaveBuilder,
  BUILDER_AUTOSAVE_MS,
);
