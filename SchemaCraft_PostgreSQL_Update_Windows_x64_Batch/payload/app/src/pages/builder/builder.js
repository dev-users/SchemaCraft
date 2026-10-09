function builderActionButton(
  label,
  action,
  id,
  extraClass = "",
  iconName = "",
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-icon ${extraClass}`.trim();
  const automaticIcon = {
    "move-category-up": "up",
    "move-field-up": "up",
    "move-category-down": "down",
    "move-field-down": "down",
    "edit-category": "edit",
    "edit-field": "edit",
    "edit-condition": "edit",
    "delete-category": "trash",
    "delete-field": "trash",
    "delete-condition": "trash",
    "detach-global-category": "unlink",
    "detach-global-field": "unlink",
  }[action];
  button.append(actionIcon(iconName || automaticIcon || "edit"));
  button.dataset.builderAction = action;
  button.dataset.itemId = id;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}
function updateStickyHeaderOffset() {
  const headerHeight = elements.appHeader
    ? Math.ceil(elements.appHeader.getBoundingClientRect().height)
    : 0;

  document.documentElement.style.setProperty(
    "--app-header-height",
    `${headerHeight}px`,
  );
}

function installStickyHeaderTracking() {
  updateStickyHeaderOffset();

  if (elements.appHeader && "ResizeObserver" in window) {
    state.headerResizeObserver?.disconnect();
    state.headerResizeObserver = new ResizeObserver(() => {
      updateStickyHeaderOffset();
    });
    state.headerResizeObserver.observe(elements.appHeader);
  }

  window.addEventListener("resize", updateStickyHeaderOffset);
}

function scheduleViewportPaintRecovery(forcePaint = false) {
  if (state.viewportPaintFrame !== null) {
    window.cancelAnimationFrame(state.viewportPaintFrame);
  }

  state.viewportPaintFrame = window.requestAnimationFrame(() => {
    state.viewportPaintFrame = null;
    updateStickyHeaderOffset();

    if (!forcePaint || !elements.appHeader) {
      return;
    }

    if (state.viewportPaintResetFrame !== null) {
      window.cancelAnimationFrame(state.viewportPaintResetFrame);
    }

    // Move the existing compositor layer by an imperceptible amount for one
    // frame. This forces Chromium to repaint the header without changing its
    // size, position, or visible design.
    elements.appHeader.style.transform = "translate3d(0, 0, 0.0001px)";
    if (elements.page) {
      const scrollTop = elements.page.scrollTop;
      void elements.page.offsetHeight;
      elements.page.scrollTop = scrollTop;
    }

    state.viewportPaintResetFrame = window.requestAnimationFrame(() => {
      state.viewportPaintResetFrame = null;
      elements.appHeader.style.transform = "";
    });
  });
}

function installViewportPaintRecovery() {
  const recover = () => scheduleViewportPaintRecovery(true);

  window.addEventListener("focus", recover);
  window.addEventListener("pageshow", recover);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      recover();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Tab") {
        state.keyboardNavigationPending = true;
      }
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      if (!state.keyboardNavigationPending) {
        return;
      }
      state.keyboardNavigationPending = false;

      const target = event.target;
      if (
        elements.page &&
        target instanceof HTMLElement &&
        elements.page.contains(target)
      ) {
        const pageRect = elements.page.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (
          targetRect.top < pageRect.top ||
          targetRect.bottom > pageRect.bottom
        ) {
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      scheduleViewportPaintRecovery(true);
    },
    true,
  );
}

function navigationSchema() {
  return state.mode === "builder" ? state.draftSchema : state.schema;
}

function navigationTarget(categoryId) {
  const prefix =
    state.mode === "builder"
      ? "builder-category"
      : state.mode === "readonly"
        ? "readonly-category"
        : "entry-category";

  return document.getElementById(`${prefix}-${categoryId}`);
}

function categoryTargetIsVisible(target) {
  return Boolean(target && !target.closest("[hidden]"));
}

function setActiveBuilderCategory(categoryId) {
  state.activeBuilderCategoryId = categoryId || null;

  elements.builderCategoryNavList
    .querySelectorAll("[data-builder-category-nav]")
    .forEach((button) => {
      button.classList.toggle(
        "category-nav-button-active",
        button.dataset.builderCategoryNav === categoryId,
      );
    });
}

function scrollToBuilderCategory(categoryId) {
  const target = navigationTarget(categoryId);

  if (!categoryTargetIsVisible(target)) {
    return;
  }

  if (state.mode === 'entry') expandEntryCategoryForControl(target);
  if (state.mode === 'builder') {
    const panel = target.closest('[data-main-category-panel]');
    if (panel) selectMainCategoryTab(panel.dataset.mainCategoryPanel, elements.builderCategories);
  }

  setActiveBuilderCategory(categoryId);

  target.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });

  target.focus({
    preventScroll: true,
  });

  target.classList.remove("category-navigation-highlight");
  void target.offsetWidth;
  target.classList.add("category-navigation-highlight");

  window.setTimeout(() => {
    target.classList.remove("category-navigation-highlight");
  }, 1600);
}

function scrollToBuilderSection(targetId) {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }
  const preview = target.closest('.builder-layout-preview');
  const panel = target.closest('[data-main-category-panel]');
  if (preview && panel) selectMainCategoryTab(panel.dataset.mainCategoryPanel, preview);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
  target.classList.remove("category-navigation-highlight");
  void target.offsetWidth;
  target.classList.add("category-navigation-highlight");
}

function createNavigationButton(label, clickHandler, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-nav-button ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", clickHandler);
  return button;
}

function createCategoryNavigationToggle(label, row, children) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'category-nav-toggle';
  const update = (expanded) => {
    children.hidden = !expanded;
    row.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? scText('طي') : scText('توسيع')} ${label}`);
    toggle.textContent = expanded ? '−' : '+';
  };
  update(true);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    update(children.hidden);
  });
  row.addEventListener('click', (event) => {
    if (event.target === row) update(children.hidden);
  });
  return toggle;
}

function appendCategoryNavigationTree(container, schema) {
  const categories = schema?.categories || [];
  const categoryIds = new Set(categories.map((category) => category.id));
  const visited = new Set();

  const appendNode = (category, parent) => {
    if (!category || visited.has(category.id)) {
      return;
    }
    visited.add(category.id);

    const children = categoryChildren(category.id, schema);
    const node = document.createElement("div");
    node.className = "category-nav-node";
    node.dataset.categoryNavNode = category.id;

    const row = document.createElement("div");
    row.className = "category-nav-row";

    if (children.length) {
      const childList = document.createElement("div");
      childList.className = "category-nav-children";
      children.forEach((child) => appendNode(child, childList));
      row.append(createCategoryNavigationToggle(displayLabel(category), row, childList));

      const button = createNavigationButton(displayLabel(category), () => {
        scrollToBuilderCategory(category.id);
      });
      button.dataset.builderCategoryNav = category.id;
      row.append(button);
      node.append(row, childList);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "category-nav-toggle-spacer";
      row.append(spacer);
      const button = createNavigationButton(displayLabel(category), () => {
        scrollToBuilderCategory(category.id);
      });
      button.dataset.builderCategoryNav = category.id;
      row.append(button);
      node.append(row);
    }

    parent.append(node);
  };

  categories
    .filter(
      (category) =>
        !category.parent_category_id ||
        !categoryIds.has(category.parent_category_id),
    )
    .forEach((category) => appendNode(category, container));
  categories.forEach((category) => appendNode(category, container));
}

function renderBuilderCategoryNavigator() {
  elements.builderCategoryNavList.replaceChildren();

  const schema = navigationSchema();
  const categories = schema?.categories || [];
  const builderMode = state.mode === "builder";

  if (builderMode && state.builderScope === "global") {
    elements.categoryNavTitle.textContent = scText("الحقول العامة");
    elements.builderCategoryNavList.setAttribute("aria-label", scText("التنقل بين التعريفات العامة"));
    const appendTarget = (label, targetId, className = "builder-section-nav-button") => {
      const button = createNavigationButton(label, () => scrollToBuilderSection(targetId), className);
      elements.builderCategoryNavList.append(button);
    };
    const appendDefinitionNode = (tree, label, targetId, childItems = []) => {
      const node = document.createElement("div");
      node.className = "category-nav-node";
      const row = document.createElement("div");
      row.className = "category-nav-row";
      const toggle = document.createElement("span");
      toggle.className = "category-nav-toggle-spacer";
      const button = createNavigationButton(label, () => scrollToBuilderSection(targetId));
      row.append(toggle, button);
      node.append(row);
      if (childItems.length) {
        const children = document.createElement("div");
        children.className = "category-nav-children";
        childItems.forEach((child) => appendDefinitionNode(
          children,
          displayLabel(child),
          child.targetId,
          child.children || [],
        ));
        toggle.replaceWith(createCategoryNavigationToggle(label, row, children));
        node.append(children);
      }
      tree.append(node);
    };
    appendTarget(scText("الفئات العامة"), "global-category-definitions-heading");
    const categoryTree = document.createElement("div");
    categoryTree.className = "category-nav-tree builder-category-nav-tree";
    Object.values(state.globalDefinitions?.categories || {}).forEach((item) => {
      const definitionTree = globalCategoryTree(item.definition || {});
      const root = definitionTree.find((node) => !node.parent_key) || definitionTree[0];
      const childrenFor = (node) => [
        ...(node.fields || []).map((entry) => ({
          label: displayLabel(entry.definition) || entry.key,
          targetId: globalEmbeddedFieldTargetId(item.id, entry.key),
        })),
        ...definitionTree.filter((candidate) => candidate.parent_key === node.key).map((child) => ({
          label: displayLabel(child.definition) || scText("فئة عامة"),
          targetId: `global-category-node-${item.id}-${child.key}`,
          children: childrenFor(child),
        })),
      ];
      appendDefinitionNode(
        categoryTree,
        displayLabel(root?.definition) || displayLabel(item.definition) || item.id,
        `global-definition-category-${item.id}`,
        root ? childrenFor(root) : [],
      );
    });
    if (categoryTree.childElementCount) elements.builderCategoryNavList.append(categoryTree);
    appendTarget(scText("الحقول العامة المنفصلة"), "global-standalone-panel");
    const fieldTree = document.createElement("div");
    fieldTree.className = "category-nav-tree builder-category-nav-tree";
    Object.values(state.globalDefinitions?.fields || {}).forEach((item) => appendDefinitionNode(fieldTree, displayLabel(item.definition) || item.id, `global-definition-field-${item.id}`));
    if (fieldTree.childElementCount) elements.builderCategoryNavList.append(fieldTree);
    appendTarget(scText("شروط الظهور"), "global-conditions-panel");
    return;
  }

  elements.categoryNavTitle.textContent = builderMode
    ? scText("أقسام المصمّم")
    : scText("فئات السجل");
  elements.builderSidebarAddCategoryButton.hidden = !builderMode;
  elements.builderSidebarAddFieldButton.hidden = !builderMode;
  elements.builderCategoryNavList.setAttribute(
    "aria-label",
    builderMode ? scText("فئات التطبيق") : scText("فئات السجل"),
  );

  if (builderMode) {
    const builderSections = [
      [scText("ملخص المصمّم"), "builder-intro-panel"],
      [scText("الفئات والحقول"), "builder-categories-panel"],
    ];
    builderSections.forEach(([label, targetId]) => {
      const button = createNavigationButton(
        label,
        () => scrollToBuilderSection(targetId),
        "builder-section-nav-button",
      );
      elements.builderCategoryNavList.append(button);
    });

    if (categories.length) {
      const tree = document.createElement("div");
      tree.className = "category-nav-tree builder-category-nav-tree";
      appendCategoryNavigationTree(tree, schema);
      elements.builderCategoryNavList.append(tree);
    }

    const conditionsButton = createNavigationButton(
      scText("شروط الظهور"),
      () => scrollToBuilderSection("builder-conditions-panel"),
      "builder-section-nav-button",
    );
    elements.builderCategoryNavList.append(conditionsButton);
    setActiveBuilderCategory(state.activeBuilderCategoryId);
    return;
  }

  if (!categories.length) {
    const empty = document.createElement("p");
    empty.className = "category-nav-empty";
    empty.textContent = scText("لا توجد فئات للتنقل بينها.");
    elements.builderCategoryNavList.append(empty);
    return;
  }

  const tree = document.createElement("div");
  tree.className = "category-nav-tree";
  appendCategoryNavigationTree(tree, schema);
  elements.builderCategoryNavList.append(tree);
  syncEntryCategoryNavigatorVisibility();
}

function syncEntryCategoryNavigatorVisibility() {
  if (!["entry", "readonly"].includes(state.mode)) {
    return;
  }

  let firstVisibleId = null;

  const nodes = [
    ...elements.builderCategoryNavList.querySelectorAll(
      "[data-category-nav-node]",
    ),
  ];

  nodes.forEach((node) => {
    const button = node.querySelector(":scope > .category-nav-row [data-builder-category-nav]");
      const categoryId = button.dataset.builderCategoryNav;
      const target = navigationTarget(categoryId);
      const visible = categoryTargetIsVisible(target);

      button.dataset.categoryTargetVisible = String(visible);
      button.disabled = !visible;

      if (visible && !firstVisibleId) {
        firstVisibleId = categoryId;
      }
  });

  [...nodes].reverse().forEach((node) => {
    const ownButton = node.querySelector(
      ":scope > .category-nav-row [data-builder-category-nav]",
    );
    const ownVisible = ownButton?.dataset.categoryTargetVisible === "true";
    const childVisible = [...node.querySelectorAll(":scope > .category-nav-children > [data-category-nav-node]")]
      .some((child) => !child.hidden);
    node.hidden = !ownVisible && !childVisible;
  });

  const activeButton = elements.builderCategoryNavList.querySelector(
    `[data-builder-category-nav="${attributeSafe(
      state.activeBuilderCategoryId || "",
    )}"]:not(:disabled)`,
  );

  if (!activeButton) {
    setActiveBuilderCategory(firstVisibleId);
  }
}

function observeBuilderCategories() {
  if (state.builderCategoryObserver) {
    state.builderCategoryObserver.disconnect();
    state.builderCategoryObserver = null;
  }

  if (!("IntersectionObserver" in window)) {
    return;
  }

  const selector =
    state.mode === "builder"
      ? ".builder-category"
      : state.mode === "readonly"
        ? "[data-readonly-category]"
        : "[data-entry-category]";

  const targets = [...document.querySelectorAll(selector)].filter(
    categoryTargetIsVisible,
  );

  if (!targets.length) {
    return;
  }

  state.builderCategoryObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter(
          (entry) =>
            entry.isIntersecting && categoryTargetIsVisible(entry.target),
        )
        .sort(
          (first, second) => second.intersectionRatio - first.intersectionRatio,
        );

      if (!visible.length) {
        return;
      }

      setActiveBuilderCategory(visible[0].target.dataset.categoryId);
    },
    {
      root: null,
      rootMargin: "-15% 0px -65% 0px",
      threshold: [0, 0.1, 0.3, 0.6, 1],
    },
  );

  targets.forEach((target) => {
    state.builderCategoryObserver.observe(target);
  });
}

function scheduleCategoryObservation() {
  window.clearTimeout(state.categoryObserverTimer);
  state.categoryObserverTimer = window.setTimeout(observeBuilderCategories, 40);
}

function refreshCategoryNavigation() {
  renderBuilderCategoryNavigator();
  scheduleCategoryObservation();
}

function renderBuilderCategories() {
  renderBuilderPreview();
}

function fieldQualifiedLabel(fieldId, schema = state.draftSchema) {
  const field = fieldById(fieldId, schema);
  const category = fieldCategory(fieldId, schema);
  return field && category
    ? `${displayLabel(category)} ← ${displayLabel(field)}`
    : scText("عنصر محذوف");
}

function targetQualifiedLabel(
  targetType,
  targetId,
  schema = state.draftSchema,
) {
  if (targetType === "category") {
    return scText`الفئة: ${displayLabel(categoryById(targetId, schema)) || scText("محذوفة")}`;
  }
  return scText`الحقل: ${fieldQualifiedLabel(targetId, schema)}`;
}

function conditionDisplayValue(condition) {
  if (["empty", "not_empty"].includes(condition.operator)) {
    return "";
  }

  const source = fieldById(condition.source_field_id, state.draftSchema);

  if (!source) {
    return String(condition.value || "");
  }

  if (source.type === "checkbox") {
    return checkboxDisplayMeaning(source, condition.value);
  }

  if (["select", "yes_no", "checkbox_group"].includes(source.type) && !source.record_options) {
    return optionLabelForValue(source, condition.value);
  }

  return String(condition.value || "");
}

function conditionSummaryText(condition) {
  const sourceLabel = fieldQualifiedLabel(condition.source_field_id);

  const operator = OPERATOR_LABELS[condition.operator] || condition.operator;

  const value = conditionDisplayValue(condition);

  const valueText = ["empty", "not_empty"].includes(condition.operator)
    ? ""
    : ` «${value}»`;

  const negate = condition.negate ? scText("ليس صحيحًا أن ") : "";

  return (
    `${negate}${sourceLabel} ${operator}${valueText}` +
    scText` ← يؤثر في ${targetQualifiedLabel(condition.target_type, condition.target_id)}`
  );
}

function conditionsGrouped(rules) {
  const groups = new Map();

  rules.forEach((condition) => {
    const groupId =
      condition.group_id ||
      `legacy-${condition.target_type}-${condition.target_id}`;

    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }

    groups.get(groupId).push(condition);
  });

  return groups;
}
function createConditionRuleRow(condition) {
  const row = document.createElement("div");
  row.className = "condition-row";

  const expression = document.createElement("div");
  expression.className = "condition-expression";
  expression.textContent = conditionSummaryText(condition);

  const actions = document.createElement("div");
  actions.className = "builder-actions";

  const edit = builderActionButton(
    scText("تعديل الشرط"),
    "edit-condition",
    condition.id,
    "",
    "edit",
  );

  const remove = builderActionButton(
    scText("حذف الشرط"),
    "delete-condition",
    condition.id,
    "button-danger-quiet",
    "trash",
  );

  edit.addEventListener("click", (event) => {
    event.stopPropagation();
    openConditionDialog(condition.id);
  });

  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteCondition(condition.id);
  });

  actions.append(edit, remove);
  row.append(expression, actions);

  return row;
}

function appendConditionGroups(container, rules) {
  const groups = conditionsGrouped(rules);

  [...groups.values()].forEach((groupRules, groupIndex) => {
    if (groupIndex > 0) {
      const separator = document.createElement("div");

      separator.className = "condition-or-separator";
      separator.textContent = scText("أو — OR");

      container.append(separator);
    }

    const group = document.createElement("section");
    group.className = "condition-group-card";

    const heading = document.createElement("div");
    heading.className = "condition-group-heading";

    const title = document.createElement("strong");
    title.textContent = scText`المجموعة ${groupIndex + 1}`;

    const relation = document.createElement("span");
    relation.textContent = scText("جميع شروط هذه المجموعة: AND");

    heading.append(title, relation);
    group.append(heading);

    groupRules.forEach((condition) => {
      group.append(createConditionRuleRow(condition));
    });

    container.append(group);
  });
}

function renderBuilderConditions() {
  elements.builderConditions.replaceChildren();

  const conditions = state.draftSchema.conditions || [];

  elements.noConditionsMessage.hidden = conditions.length > 0;

  const targets = new Map();

  conditions.forEach((condition) => {
    const key = `${condition.target_type}:` + `${condition.target_id}`;

    if (!targets.has(key)) {
      targets.set(key, []);
    }

    targets.get(key).push(condition);
  });

  const orderedTargetKeys = [];

  for (const { category } of orderedCategoryTree(state.draftSchema)) {
    orderedTargetKeys.push(`category:${category.id}`);
    for (const field of category.fields) {
      orderedTargetKeys.push(`field:${field.id}`);
    }
  }

  for (const key of orderedTargetKeys) {
    const rules = targets.get(key);
    if (!rules) {
      continue;
    }

    rules.forEach((condition) => {
      const card = createConditionRuleRow(condition);
      card.setAttribute(
        "aria-label",
        targetQualifiedLabel(condition.target_type, condition.target_id),
      );
      elements.builderConditions.append(card);
    });
  }
}

function renderTargetConditionEditor(targetType, targetId, container) {
  container.replaceChildren();

  const rules = conditionsFor(targetType, targetId, state.draftSchema);

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "builder-empty";
    empty.textContent = scText("لا توجد شروط ظهور لهذا العنصر.");

    container.append(empty);
    return;
  }

  appendConditionGroups(container, rules);
}

function renderCategoryConditionEditor() {
  renderTargetConditionEditor(
    "category",
    state.editingCategoryId,
    elements.categoryConditionsList,
  );
}

function renderFieldConditionEditor() {
  renderTargetConditionEditor(
    "field",
    state.editingFieldId,
    elements.fieldConditionsList,
  );
}

function refreshConditionEditors() {
  renderBuilderConditions();

  if (elements.categoryDialog.open) {
    renderCategoryConditionEditor();
  }

  if (elements.fieldDialog.open) {
    renderFieldConditionEditor();
  }
}

function deleteCondition(conditionId) {
  state.draftSchema.conditions = state.draftSchema.conditions.filter(
    (condition) => condition.id !== conditionId,
  );

  markDirty();
  refreshConditionEditors();
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function moveArrayItem(array, index, change) {
  const nextIndex = index + change;
  if (index < 0 || nextIndex < 0 || nextIndex >= array.length) {
    return false;
  }
  [array[index], array[nextIndex]] = [array[nextIndex], array[index]];
  return true;
}

function dataLossWarning(noun) {
  const count = state.schema?.stats?.record_count || 0;
  return count
    ? scText`يوجد ${count} سجل محفوظ. حذف ${noun} ثم حفظ التصميم سيحذف بياناته نهائيًا. هل تريد المتابعة؟`
    : scText`هل تريد حذف ${noun}؟`;
}

function pruneFieldGroups(schema, removedIds = new Set()) {
  for (const category of schema?.categories || []) {
    const available = new Set(category.fields.filter(f => !isLayoutField(f) && !removedIds.has(f.id)).map(f => f.id));
    category.fields = category.fields.filter(field => {
      if (field.type !== 'field_group') return true;
      field.field_ids = (field.field_ids || []).filter(id => available.has(id));
      return field.field_ids.length >= 2;
    });
  }
}

function removeReferencesToFields(fieldIds) {
  const ids = new Set(fieldIds);
  pruneFieldGroups(state.draftSchema, ids);
  state.draftSchema.conditions = state.draftSchema.conditions.filter(
    (condition) =>
      !ids.has(condition.source_field_id) &&
      !(condition.target_type === "field" && ids.has(condition.target_id)),
  );
  state.draftSchema.categories.forEach((category) => {
    if (ids.has(category.anchor_field_id)) {
      category.anchor_field_id = null;
    }
    if (ids.has(category.parent_field_id)) {
      category.parent_field_id = null;
    }
    if (ids.has(category.card_title_field_id)) {
      category.card_title_field_id = null;
    }
    if (ids.has(category.card_sort?.field_id)) {
      category.card_sort.field_id = null;
      category.card_sort.mode = "manual";
    }
    category.fields.forEach((field) => {
      if (field.type === "file") {
        field.file_naming.parts = field.file_naming.parts.filter(
          (part) => !ids.has(part.field_id),
        );
      }
      if (ids.has(field.option_filter?.source_field_id)) {
        field.option_filter = null;
      }
      if (ids.has(field.validation?.compare_field_id)) {
        field.validation.compare_field_id = null;
        field.validation.compare_operator = null;
      }
      if (ids.has(field.auto_update?.source_field_id)) {
        field.auto_update = null;
      }
    });
  });
}

async function handleBuilderAction(button) {
  const action = button.dataset.builderAction;
  const itemId = button.dataset.itemId;
  const categoryId = button.dataset.categoryId;

  if (action === "move-category-up" || action === "move-category-down") {
    const index = state.draftSchema.categories.findIndex(
      (category) => category.id === itemId,
    );
    const category = state.draftSchema.categories[index];
    if (!category) return;
    const peers = builderPreviewCategoryPeers(category);
    const peerIndex = peers.findIndex((item) => item.id === itemId);
    const destination = peers[peerIndex + (action.endsWith('up') ? -1 : 1)];
    if (!destination) return;
    const destinationIndex = state.draftSchema.categories.findIndex((item) => item.id === destination.id);
    if (
      moveArrayItem(
        state.draftSchema.categories,
        index,
        destinationIndex - index,
      )
    ) {
      markDirty();
      renderBuilderCategories();
    }
    return;
  }
  if (action === "edit-category") {
    const category = categoryById(itemId);
    if (category?.global_ref) {
      if (!(await requestConfirmation(scText("تعديل هذه الفئة من داخل التصميم سيفصل إعدادها عن التعريف العام."), {
        title: scText("فصل الفئة العامة"),
        confirmLabel: scText("فصل وتعديل"),
      }))) return;
    }
    openCategoryDialog(itemId, Boolean(category?.global_ref));
    return;
  }
  if (action === "publish-global-category") {
    void publishLocalDefinition("category", itemId);
    return;
  }
  if (action === "detach-global-category") {
    const category = categoryById(itemId);
    if (category && await requestConfirmation(scText("فصل إعداد هذه الفئة عن التعريف العام؟"), {
      title: scText("فصل الفئة العامة"),
      confirmLabel: scText("فصل الارتباط"),
    })) {
      category.global_ref = null;
      markDirty();
      renderBuilder();
    }
    return;
  }
  if (action === "delete-category") {
    const category = categoryById(itemId);
    if (category && compositionBlocksRemoval(category.fields.map(f=>f.id))) return;
    if (
      !category ||
      !(await requestConfirmation(dataLossWarning(scText`الفئة "${displayLabel(category)}"`), {
        title: scText("حذف الفئة"),
        confirmLabel: scText("حذف الفئة"),
      }))
    ) {
      return;
    }
    removeReferencesToFields(category.fields.map((field) => field.id));
    const relatedPersonModeSource = relatedPersonModeSourceId(itemId);
    state.draftSchema.conditions = state.draftSchema.conditions.filter(
      (condition) =>
        condition.source_field_id !== relatedPersonModeSource &&
        !(
          condition.target_type === "category" && condition.target_id === itemId
        ),
    );
    state.draftSchema.categories.forEach((candidate) => {
      if (candidate.parent_category_id === itemId) {
        candidate.parent_category_id = category.parent_category_id || null;
        candidate.parent_field_id = null;
      }
    });
    state.draftSchema.categories = state.draftSchema.categories.filter(
      (candidate) => candidate.id !== itemId,
    );
    markDirty();
    renderBuilder();
    return;
  }
  if (action === "add-field") {
    openFieldDialog(categoryId);
    return;
  }
  if (action === "edit-field") {
    const field = fieldById(itemId);
    if (field?.global_ref) {
      if (!(await requestConfirmation(scText("تعديل هذا الحقل من داخل التصميم سيفصل إعداداته عن التعريف العام."), {
        title: scText("فصل الحقل العام"),
        confirmLabel: scText("فصل وتعديل"),
      }))) return;
    }
    openFieldDialog(categoryId, itemId, Boolean(field?.global_ref));
    return;
  }
  if (action === "publish-global-field") {
    void publishLocalDefinition("field", itemId);
    return;
  }
  if (action === "detach-global-field") {
    const field = fieldById(itemId);
    if (field && await requestConfirmation(scText("فصل إعداد هذا الحقل عن التعريف العام؟"), {
      title: scText("فصل الحقل العام"),
      confirmLabel: scText("فصل الارتباط"),
    })) {
      field.global_ref = null;
      markDirty();
      renderBuilder();
    }
    return;
  }
  if (action === "delete-field") {
    if (compositionBlocksRemoval([itemId])) return;
    const category = categoryById(categoryId);
    const field = fieldById(itemId);
    if (
      !category ||
      !field ||
      !(await requestConfirmation(field.type === "field_group" ? scText("حذف المجموعة فقط؟ ستبقى حقولها وقيمها دون تغيير.") : dataLossWarning(scText`الحقل "${displayLabel(field)}"`), {
        title: scText("حذف الحقل"),
        confirmLabel: scText("حذف الحقل"),
      }))
    ) {
      return;
    }
    removeReferencesToFields([itemId]);
    category.fields = category.fields.filter(
      (candidate) => candidate.id !== itemId,
    );
    markDirty();
    renderBuilder();
    return;
  }
  if (action === "move-field-up" || action === "move-field-down") {
    const category = categoryById(categoryId);
    const index =
      category?.fields.findIndex((field) => field.id === itemId) ?? -1;
    if (
      category &&
      moveArrayItem(category.fields, index, action.endsWith("up") ? -1 : 1)
    ) {
      markDirty();
      renderBuilderCategories();
    }
    return;
  }
  if (action === "edit-condition") {
    openConditionDialog(itemId);
    return;
  }
  if (action === "delete-condition") {
    deleteCondition(itemId);
    return;
  }
}

function fillMainFieldSelect(select, selectedValue = "", emptyLabel = "") {
  select.replaceChildren();
  if (emptyLabel) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel;
    select.append(empty);
  }
  for (const { category, field } of allFields().filter(
    ({ category, field }) =>
      category.kind === "main" &&
      field.type !== "file" &&
      !isSystemField(field),
  )) {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = `${displayLabel(category)} ← ${displayLabel(field)}`;
    select.append(option);
  }
  select.value = selectedValue;
}

function appendPlacementOption(parent, value, label) {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = label;

  parent.append(option);
}

function fillCategoryPlacementSelect(current = null) {
  elements.categoryPlacement.replaceChildren();

  const editor = state.globalEditor;
  const globalRoot = editor?.kind === "category" && (!editor.packageMode || current?.id === editor.rootCategoryId);
  const roots = globalRoot
    ? Object.entries(state.globalDefinitions?.categories || {}).map(([id, item]) => ({id, label:displayLabel(item.definition) || scText("فئة عامة")}))
    : (state.draftSchema?.categories || []).filter((category) => !category.parent_category_id);
  const currentId = globalRoot ? editor.globalRef : current?.id;
  const categories = roots.filter((category) => category.id !== currentId);

  const quickGroup = document.createElement("optgroup");

  quickGroup.label = scText("موضع سريع");

  appendPlacementOption(quickGroup, "start", scText("في بداية الفئات الرئيسية"));
  appendPlacementOption(quickGroup, "end", scText("في نهاية الفئات الرئيسية"));

  elements.categoryPlacement.append(quickGroup);

  if (categories.length) {
    const beforeGroup = document.createElement("optgroup");

    beforeGroup.label = scText("قبل فئة");

    categories.forEach((category) => {
      appendPlacementOption(
        beforeGroup,
        `before:${category.id}`,
        scText`قبل: ${displayLabel(category)}`,
      );
    });

    elements.categoryPlacement.append(beforeGroup);
  }

  const index = roots.findIndex(category => category.id === currentId);
  elements.categoryPlacement.value = index >= 0 && roots[index + 1] ? `before:${roots[index + 1].id}` : "end";
}

function fillCategoryParentSelect(category = null) {
  elements.categoryParent.replaceChildren();

  appendPlacementOption(elements.categoryParent, "", scText("اختر الفئة الأم"));
  elements.categoryParent.options[0].disabled=true;
  elements.categoryParent.options[0].hidden=true;

  const excluded = category
    ? categoryDescendantIds(category.id, state.draftSchema)
    : new Set();
  if (category) {
    excluded.add(category.id);
  }

  for (const { category: candidate, depth } of orderedCategoryTree(
    state.draftSchema,
  )) {
    if (excluded.has(candidate.id)) {
      continue;
    }
    const indent = "— ".repeat(depth);
    appendPlacementOption(
      elements.categoryParent,
      candidate.id,
      `${indent}${displayLabel(candidate)}`,
    );
  }

  elements.categoryParent.value = category?.parent_category_id || "";
  elements.categoryHasParent.value = category?.parent_category_id ? "yes" : "no";
  updateCategoryParentFieldEditor(category?.parent_field_id || "");
}

function updateCategoryParentFieldEditor(selectedFieldId = "") {
  const hasParent = elements.categoryHasParent.value === "yes";
  elements.categoryParentWrapper.hidden = !hasParent;
  elements.categoryPlacementWrapper.hidden = hasParent;
  elements.categoryKind.disabled = false;
  if (!hasParent) elements.categoryParent.value = "";
  const parent = categoryById(elements.categoryParent.value);
  const enabled = hasParent && Boolean(parent);
  elements.categoryParentFieldWrapper.hidden = !enabled;
  elements.categoryParentField.replaceChildren();
  if (!enabled) {
    return;
  }
  appendBlankOption(elements.categoryParentField, scText("في نهاية الفئة الأم"));
  (parent.fields || []).forEach((field) => {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = displayLabel(field);
    elements.categoryParentField.append(option);
  });
  elements.categoryParentField.value = selectedFieldId;
}

function categoryInsertionIndex(placement) {
  const categories = state.draftSchema.categories;

  if (placement === "start") {
    return 0;
  }

  if (!placement || placement === "end") {
    return categories.length;
  }

  const separator = placement.indexOf(":");

  if (separator < 0) {
    return categories.length;
  }

  const mode = placement.slice(0, separator);

  const categoryId = placement.slice(separator + 1);

  const referenceIndex = categories.findIndex(
    (category) => category.id === categoryId,
  );

  if (referenceIndex < 0) {
    return categories.length;
  }

  return mode === "before" ? referenceIndex : referenceIndex + 1;
}

function fillCategoryCardOptions(category = null) {
  const fields = state.categoryFieldsDraft || category?.fields || [];
  const selectedTitle = category?.card_title_field_id || elements.categoryCardTitleField.value || "";
  const selectedSortField = category?.card_sort?.field_id || elements.categoryCardSortField.value || "";
  elements.categoryCardTitleField.replaceChildren();
  appendBlankOption(elements.categoryCardTitleField, scText("بطاقة 1، 2…"));
  elements.categoryCardSortField.replaceChildren();
  appendBlankOption(elements.categoryCardSortField, scText("اختر حقلًا"));
  fields.filter((field) => field.type !== "file" && !isSystemField(field)).forEach((field) => {
    const titleOption = document.createElement("option");
    titleOption.value = field.id;
    titleOption.textContent = displayLabel(field);
    elements.categoryCardTitleField.append(titleOption);
    elements.categoryCardSortField.append(titleOption.cloneNode(true));
  });
  elements.categoryCardTitleField.value = selectedTitle;
  elements.categoryCardSortField.value = selectedSortField;
  elements.categoryCardNamePrefixWrapper.hidden = Boolean(elements.categoryCardTitleField.value);
  updateCategoryCardSortEditor();
}

function updateCategoryCardSortEditor() {
  const mode = elements.categoryCardSortMode.value;
  elements.categoryCardSortFieldWrapper.hidden = mode !== "field";
}

function renderCategoryImportFields() {
  elements.categoryImportFields.replaceChildren();
  const source = state.categoryImportSources?.get(elements.categoryImportSource.value);
  (source?.fields || []).forEach((field) => {
    const label = document.createElement("label");
    label.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.categoryImportField = field.id;
    input.checked = true;
    const text = document.createElement("span");
    text.textContent = displayLabel(field);
    label.append(input, text);
    elements.categoryImportFields.append(label);
  });
}

function fillCategoryImportSources() {
  elements.categoryImportSource.replaceChildren();
  appendBlankOption(elements.categoryImportSource, scText("اختر فئة"));
  state.categoryImportSources = new Map();
  state.draftSchema.categories.forEach((category) => {
    if (category.id === state.editingCategoryId) return;
    const option = document.createElement("option");
    option.value = `local:${category.id}`;
    option.textContent = displayLabel(category);
    state.categoryImportSources.set(option.value, category);
    elements.categoryImportSource.append(option);
  });
  const general = Object.entries(state.globalDefinitions?.categories || {});
  if (general.length) {
    const group = document.createElement("optgroup");
    group.label = scText("الفئات العامة");
    general.forEach(([globalRef, item]) => {
      const tree = Array.isArray(item.definition?.category_tree)
        ? item.definition.category_tree
        : [];
      const root = tree.find((node) => !node.parent_key) || tree[0];
      const source = {
        ...(deepClone(root?.definition || item.definition || {})),
        fields: deepClone(
          root?.fields?.map((entry) => ({
            ...(entry.definition || {}),
            id: entry.key,
            global_tree_ref: globalRef,
            global_tree_key: entry.key,
          })) || (item.definition?.fields || []).map((field, index) => ({
            ...field,
            id: `legacy-${index + 1}`,
            global_tree_ref: globalRef,
            global_tree_key: `legacy-${index + 1}`,
          })),
        ),
        global_ref: globalRef,
      };
      const key = `global:${globalRef}`;
      state.categoryImportSources.set(key, source);
      group.append(new Option(displayLabel(source) || scText("حقل غير متاح"), key));
    });
    elements.categoryImportSource.append(group);
  }
  renderCategoryImportFields();
}

function applyCategoryImportSelection() {
  const source = state.categoryImportSources?.get(elements.categoryImportSource.value);
  if (!source) {
    showToast(scText("اختر الفئة المصدر أولًا."), "error");
    return;
  }
  const selected = new Set(
    [...elements.categoryImportFields.querySelectorAll("[data-category-import-field]:checked")]
      .map((input) => input.dataset.categoryImportField),
  );
  if (!selected.size) {
    showToast(scText("اختر حقلًا واحدًا على الأقل."), "error");
    return;
  }
  const existingLabels = new Set(
    state.categoryFieldsDraft.map((field) => field.label.trim().toLocaleLowerCase()),
  );
  const candidates = source.fields.filter(
    (field) => selected.has(field.id) && !existingLabels.has(field.label.trim().toLocaleLowerCase()),
  );
  const fieldIdMap = new Map(
    candidates.map((field) => [field.id, randomDefinitionId("fld")]),
  );
  const imported = candidates.map((field) => {
    const copy = deepClone(field);
    copy.id = fieldIdMap.get(field.id);
    SCAlertMessageFields.remapOwner(copy, fieldIdMap, false);
    SCFinance.remapOwner(copy,fieldIdMap);
    if (SCComposite.is(copy)) copy.composition.field_ids = copy.composition.field_ids.map(id => fieldIdMap.get(id) || id);
    if (copy.type === 'field_group') copy.field_ids = (copy.field_ids || []).map(id => fieldIdMap.get(id)).filter(Boolean);
    copy.global_ref = null;
    copy.global_tree_ref = null;
    copy.global_tree_key = null;
    copy.options = (copy.options || []).map((option) => ({
      ...option,
      id: randomDefinitionId("opt"),
    }));
    copy.option_filter = null;
    copy.auto_update = null;
    copy.related_person_source_field_id = null;
    copy.related_person_source_checkbox_id = null;
    delete copy.related_person_source_marker_id;
    if (copy.validation) {
      copy.validation.compare_field_id = null;
      copy.validation.compare_operator = null;
    }
    if (copy.file_naming?.parts) {
      copy.file_naming.parts = copy.file_naming.parts
        .filter((part) => fieldIdMap.has(part.field_id))
        .map((part) => ({
          field_id: fieldIdMap.get(part.field_id),
          prefix: part.prefix || "",
          suffix: part.suffix || "",
        }));
      if (copy.file_naming.mode === "template" && !copy.file_naming.parts.length) {
        copy.file_naming.mode = "original";
      }
    }
    return copy;
  });
  // Importing only part of a group must not leave references to the source category.
  state.categoryFieldsDraft.push(...imported.filter(field => field.type !== 'field_group' || field.field_ids.length >= 2));
  if (!categoryById(state.editingCategoryId)) {
    elements.categoryLabel.value ||= scText`${source.label} — نسخة`;
    elements.categoryKind.value = source.kind;
    elements.categoryDescription.value ||= source.description || "";
    elements.categoryAddLabel.value ||= source.add_label || "";
    elements.categoryAutoStart.checked = Boolean(source.auto_start);
    elements.categoryRelatedPerson.checked = Boolean(source.related_person_enabled);
    fillCategoryCardOptions();
    elements.categoryCardTitleField.value = fieldIdMap.get(source.card_title_field_id) || "";
    elements.categoryCardNamePrefix.value ||= source.card_name_prefix || "";
    elements.categoryCardSortMode.value = ["title", "field"].includes(source.card_sort?.mode) ? source.card_sort.mode : "manual";
    elements.categoryCardSortField.value = fieldIdMap.get(source.card_sort?.field_id) || "";
    elements.categoryCardSortDirection.value = source.card_sort?.direction || "asc";
    updateCategoryDialogType();
  }
  fillCategoryCardOptions();
  showToast(scText`تمت إضافة ${imported.length} حقول من الفئة المصدر.`);
}

function openCategoryDialog(categoryId = null, detachGlobalOnSave = false) {
  if (elements.globalCategoryConnectChoice) elements.globalCategoryConnectChoice.hidden = true;
  const category = categoryId ? categoryById(categoryId) : null;
  state.editingCategoryDetachGlobal = Boolean(
    category?.global_ref && detachGlobalOnSave,
  );
  const creatingCategory = !category;
  elements.categoryPlacementWrapper.hidden = false;
  fillCategoryPlacementSelect(category);
  state.editingCategoryId = category?.id || randomDefinitionId("cat");
  state.categoryDialogCommitted = false;
  state.categoryConditionsSnapshot = deepClone(state.draftSchema.conditions);
  state.categoryDirtyBeforeOpen = state.dirty;
  elements.categoryDialogTitle.textContent = category
    ? scText("تعديل فئة")
    : scText("إضافة فئة");
  elements.categoryLabel.value = category?.label || "";
  elements.categoryKind.value = category?.view_table ? "view_table" : category?.kind || "main";
  fillCategoryParentSelect(category);
  elements.categoryDescription.value = category?.description || "";
  renderLanguageNameEditor(document.getElementById('category-language-editor'), category,
    [['label', scText('اسم الفئة')], ['description', scText('الوصف')], ['add_label', scText('نص زر الإضافة')], ['card_name_prefix', scText('اسم ثابت للبطاقات')]],
    { label: () => elements.categoryLabel.value, description: () => elements.categoryDescription.value,
      add_label: () => elements.categoryAddLabel.value, card_name_prefix: () => elements.categoryCardNamePrefix.value });
  elements.categoryAddLabel.value = category?.add_label || "";
  elements.categoryAutoStart.checked = Boolean(category?.auto_start);
  elements.categoryRelatedPerson.checked = Boolean(
    category?.related_person_enabled,
  );
  state.categoryFieldsDraft = deepClone(category?.fields || []);
  elements.categoryCardSortMode.value = category?.card_sort?.mode || "manual";
  elements.categoryCardSortDirection.value = category?.card_sort?.direction || "asc";
  elements.categoryCardNamePrefix.value = category?.card_name_prefix || "";
  fillCategoryCardOptions(category);
  fillCategoryImportSources();
  fillMainFieldSelect(
    elements.categoryAnchor,
    category?.anchor_field_id || "",
    scText("في نهاية النموذج"),
  );
  updateCategoryDialogType();
  renderCategoryConditionEditor();
  SCAlerts.reset("category", category);
  SCFinance.initCategory(category);
  SCProfileLinks.init(category);
  window.SCBuilderCompact?.prepareCategory();
  elements.categoryDialog.showModal();
  elements.categoryLabel.focus();
}

function updateCategoryDialogType() {
  SCFinance.renderCategory();
  SCProfileLinks.render();
  const repeatable = elements.categoryKind.value === "repeatable";
  elements.categoryRepeatableOptions.hidden = !repeatable;
  updateCategoryParentFieldEditor(elements.categoryParentField.value);
  elements.categoryCardNamePrefixWrapper.hidden = Boolean(elements.categoryCardTitleField.value);
  window.SCBuilderCompact?.refreshCategory();
}

function saveCategoryFromDialog() {
  if(window.SCBuilderCompact?.hasDetail('category'))return;
  let financeMetadata;
  try { financeMetadata = SCFinance.collectCategory(); const link=SCProfileLinks.collect();if(link)financeMetadata.profile_linking=link; } catch (e) { showToast(e.message, 'error'); return; }
  let alertRules;
  try { alertRules = SCAlerts.collect("category"); } catch (error) { showToast(error.message, "error"); return; }
  const label = elements.categoryLabel.value.trim();
  if (!label) {
    showToast(scText("اسم الفئة مطلوب."), "error");
    elements.categoryLabel.focus();
    return;
  }
  const duplicate = state.draftSchema.categories.some(
    (category) =>
      category.id !== state.editingCategoryId &&
      category.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase(),
  );
  if (duplicate) {
    showToast(scText("اسم الفئة مستخدم مسبقًا."), "error");
    return;
  }

  const existing = state.editingCategoryId
    ? categoryById(state.editingCategoryId)
    : null;
  const kind = elements.categoryKind.value === "view_table" ? "main" : elements.categoryKind.value;
  // General editors use a temporary schema containing new placeholder categories.
  // Only a persisted category in the active schema can have existing records.
  const persisted = !state.globalEditor && state.editingCategoryId
    ? categoryById(state.editingCategoryId, state.schema)
    : null;
  if (
    persisted &&
    persisted.kind !== kind &&
    (state.schema?.stats?.record_count || 0) > 0
  ) {
    showToast(scText("لا يمكن تغيير نوع فئة بعد وجود سجلات."), "error");
    return;
  }
  if (elements.categoryHasParent.value === "yes" && !elements.categoryParent.value) {
    showToast(scText("اختر الفئة الأم."), "error");
    elements.categoryParent.focus();
    return;
  }
  const category = existing || {
    id: state.editingCategoryId,
    fields: [],
  };
  if (existing && state.editingCategoryDetachGlobal) {
    category.global_ref = null;
  }
  delete category.table; delete category.view_table;delete category.profile_linking; Object.assign(category, financeMetadata);
  category.alerts = alertRules;
  category.label = label;
  category.i18n = readLanguageNameEditor('category-language-editor');
  category.description = elements.categoryDescription.value.trim();
  category.kind = kind;
  category.parent_category_id = elements.categoryHasParent.value === "yes"
    ? elements.categoryParent.value || null
    : null;
  category.parent_field_id = category.parent_category_id
    ? elements.categoryParentField.value || null
    : null;
  category.add_label =
    elements.categoryAddLabel.value.trim() || scText`إضافة ${label}`;
  category.auto_start =
    kind === "repeatable" && elements.categoryAutoStart.checked;
  category.related_person_enabled =
    kind === "repeatable" && elements.categoryRelatedPerson.checked;
  category.anchor_field_id = null;
  category.fields = deepClone(state.categoryFieldsDraft || category.fields || []);
  category.card_title_field_id =
    kind === "repeatable" ? elements.categoryCardTitleField.value || null : null;
  category.card_name_prefix =
    kind === "repeatable" && !category.card_title_field_id
      ? elements.categoryCardNamePrefix.value.trim().slice(0, 80)
      : "";
  category.card_sort = kind === "repeatable"
    ? {
        mode: elements.categoryCardSortMode.value,
        field_id: elements.categoryCardSortField.value || null,
        direction: elements.categoryCardSortDirection.value,
      }
    : { mode: "manual", direction: "asc" };
  if (!category.related_person_enabled) {
    const modeSourceId = relatedPersonModeSourceId(category.id);
    state.draftSchema.conditions = state.draftSchema.conditions.filter(
      (condition) => condition.source_field_id !== modeSourceId,
    );
    category.fields.forEach((field) => {
      delete field.related_person_source_field_id;
    });
  }
  const creatingCategory = !existing;

  if (creatingCategory || !category.parent_category_id) {
    if (existing) state.draftSchema.categories.splice(state.draftSchema.categories.indexOf(existing), 1);
    const insertionIndex = categoryInsertionIndex(
      elements.categoryPlacement.value,
    );

    state.draftSchema.categories.splice(insertionIndex, 0, category);
  }
  state.categoryDialogCommitted = true;

  if (state.globalEditor?.kind === "category") {
    void commitGlobalDefinitionFromEditor("category", category);
    elements.categoryDialog.close();
    return;
  }

  markDirty();
  renderBuilder();
  elements.categoryDialog.close();

  if (creatingCategory) {
    window.setTimeout(() => {
      scrollToBuilderCategory(category.id);
    }, 0);
  }
}

function availableFileNamingFields(categoryId) {
  return allFields().filter(
    ({ category, field }) =>
      field.type !== "file" &&
      !isSystemField(field) &&
      (category.kind === "main" || category.id === categoryId),
  ).sort((first, second) => {
    const firstLocal = first.category.id === categoryId ? 0 : 1;
    const secondLocal = second.category.id === categoryId ? 0 : 1;
    return firstLocal - secondLocal;
  });
}

function fillFileNamingFieldSelect() {
  elements.filePartField.replaceChildren();
  for (const { category, field } of availableFileNamingFields(
    state.editingFieldCategoryId,
  )) {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = `${displayLabel(category)} ← ${displayLabel(field)}`;
    elements.filePartField.append(option);
  }
}

function reconcileFieldOptions() {
  const labels = elements.fieldOptions.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value, index, array) => value && array.indexOf(value) === index);
  const previous = state.fieldOptionsDraft || [];
  const used = new Set();
  state.fieldOptionsDraft = labels.map((label, index) => {
    let option = previous.find(
      (candidate) => candidate.label === label && !used.has(candidate.id),
    );
    if (!option && previous[index] && !used.has(previous[index].id)) {
      option = previous[index];
    }
    const result = option
      ? { ...option, label, active: option.active !== false }
      : { id: randomDefinitionId("opt"), label, active: true, i18n: newNameMetadata() };
    used.add(result.id);
    return result;
  });
  return state.fieldOptionsDraft;
}

function compatibleOptionFilterSources(categoryId, fieldId) {
  return allFields().filter(
    ({ category, field }) =>
      field.id !== fieldId &&
      ["select", "yes_no", "checkbox"].includes(field.type) &&
      (category.kind === "main" || category.id === categoryId),
  );
}

function fillOptionFilterSource() {
  const selected = state.optionFilterDraft?.source_field_id || "";
  elements.optionFilterSource.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = scText("بدون تصفية");
  elements.optionFilterSource.append(empty);
  for (const { category, field } of compatibleOptionFilterSources(
    state.editingFieldCategoryId,
    state.editingFieldId,
  )) {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = `${displayLabel(category)} ← ${displayLabel(field)}`;
    elements.optionFilterSource.append(option);
  }
  elements.optionFilterSource.value = selected;
  if (elements.optionFilterSource.value !== selected) {
    elements.optionFilterSource.value = "";
    state.optionFilterDraft = null;
  }
}

function parseOptionLines(value) {
  const result = [];
  const seen = new Set();

  String(value || "")
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter(Boolean)
    .forEach((label) => {
      const key = label.toLocaleLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        result.push(label);
      }
    });

  return result;
}
function syncTargetOptionsFromFilterText() {
  const labels = [];
  const seen = new Set();

  elements.optionFilterMatrix
    .querySelectorAll("textarea[data-source-token]")
    .forEach((textarea) => {
      parseOptionLines(textarea.value).forEach((label) => {
        const key = label.toLocaleLowerCase();

        if (!seen.has(key)) {
          seen.add(key);
          labels.push(label);
        }
      });
    });

  const previous = state.fieldOptionsDraft || [];
  const used = new Set();

  state.fieldOptionsDraft = labels.map((label, index) => {
    const key = label.toLocaleLowerCase();

    let option = previous.find(
      (candidate) =>
        candidate.label.toLocaleLowerCase() === key && !used.has(candidate.id),
    );

    if (!option && previous[index] && !used.has(previous[index].id)) {
      option = previous[index];
    }

    const result = option
      ? {
          ...option,
          label,
          active: option.active !== false,
        }
      : {
          id: randomDefinitionId("opt"),
          label,
          active: true,
        };

    used.add(result.id);
    return result;
  });

  elements.fieldOptions.value = state.fieldOptionsDraft
    .map((option) => option.label)
    .join("\n");
}

function renderOptionFilterMatrix() {
  SCFieldRules.secondarySource();
  elements.optionFilterMatrix.replaceChildren();

  const sourceId = elements.optionFilterSource.value;

  if (!sourceId) {
    elements.optionFilterMatrix.hidden = true;
    return;
  }

  elements.optionFilterMatrix.hidden = false;

  const source = fieldById(sourceId);

  if (!source) {
    elements.optionFilterMatrix.textContent = scText("الحقل المتحكم غير موجود.");
    return;
  }

  const sourceTokens = SCFieldRules.sourceTokens(source);

  if (!sourceTokens.length) {
    elements.optionFilterMatrix.textContent = scText("أضف خيارات للحقل المتحكم أولًا.");
    return;
  }

  const mappings = state.optionFilterDraft?.mappings || {};

  const targetById = new Map(
    (state.fieldOptionsDraft || []).map((option) => [option.id, option]),
  );

  const note = document.createElement("p");
  note.className = "dialog-note";
  note.textContent =
    scText("اكتب خيارات الحقل الحالي لكل قيمة من الحقل المتحكم، خيارًا واحدًا في كل سطر.");

  elements.optionFilterMatrix.append(note);

  for (const sourceOption of sourceTokens) {
    const row = document.createElement("div");
    row.className = "option-filter-row";

    const title = document.createElement("strong");
    title.textContent = displayLabel(sourceOption);

    const textarea = document.createElement("textarea");
    textarea.className = "control option-filter-textarea";

    textarea.rows = 4;
    textarea.dataset.sourceToken = sourceOption.id;
    textarea.placeholder = scText("اكتب خيارًا واحدًا في كل سطر");

    textarea.value = (mappings[sourceOption.id] || [])
      .map((optionId) => targetById.get(optionId)?.label)
      .filter(Boolean)
      .join("\n");

    textarea.addEventListener("input", () => {state.optionFilterDraft=collectOptionFilter();});

    row.append(title, textarea);
    elements.optionFilterMatrix.append(row);
  }
}
function collectOptionFilter() {
  const sourceId = elements.optionFilterSource.value;

  if (!sourceId) {
    return null;
  }

  syncTargetOptionsFromFilterText();

  const optionByLabel = new Map(
    state.fieldOptionsDraft.map((option) => [
      option.label.toLocaleLowerCase(),
      option,
    ]),
  );

  const mappings = {};

  elements.optionFilterMatrix
    .querySelectorAll("textarea[data-source-token]")
    .forEach((textarea) => {
      const token = textarea.dataset.sourceToken;

      mappings[token] = parseOptionLines(textarea.value)
        .map((label) => optionByLabel.get(label.toLocaleLowerCase())?.id)
        .filter(Boolean);
    });

  return {
    source_field_id: sourceId,
    ...(document.getElementById('option-filter-source-second')?.value?{source_field_ids:[sourceId,document.getElementById('option-filter-source-second').value]}:{}),
    mappings,
    unmatched: "none",
  };
}

function fillDateComparisonFields(field) {
  const selected = field?.validation?.compare_field_id || "";
  elements.validationCompareField.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = scText("بدون مقارنة");
  elements.validationCompareField.append(empty);
  const category = categoryById(state.editingFieldCategoryId);
  for (const {
    category: sourceCategory,
    field: candidate,
  } of allFields().filter(
    ({ category: sourceCategory, field: candidate }) =>
      candidate.id !== state.editingFieldId &&
      candidate.type === elements.fieldType.value &&
      (sourceCategory.kind === "main" || sourceCategory.id === category?.id),
  )) {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = `${displayLabel(sourceCategory)} ← ${displayLabel(candidate)}`;
    elements.validationCompareField.append(option);
  }
  elements.validationCompareField.value = selected;
}

function loadValidation(field) {
  const validation = field?.validation || {};
  elements.validationMinLength.value = validation.min_length ?? "";
  elements.validationMaxLength.value = validation.max_length ?? "";
  elements.validationPattern.value = validation.pattern || "";
  elements.validationMinNumber.value = validation.min ?? "";
  elements.validationMaxNumber.value = validation.max ?? "";
  elements.validationIntegerOnly.checked = Boolean(validation.integer_only);
  elements.validationMinDate.value = validation.min_date || "";
  elements.validationMaxDate.value = validation.max_date || "";
  elements.validationCompareOperator.value =
    validation.compare_operator || "after";
  fillDateComparisonFields(field);
}

function selectedNumberSpecialCharacters() {
  return [
    ...elements.numberBehaviorEditor.querySelectorAll(
      "[data-number-special]:checked",
    ),
  ].map((control) => control.dataset.numberSpecial).join("");
}

function loadNumberBehavior(field) {
  const behavior = field?.number_behavior || {};
  elements.numberFormatThousands.checked = Boolean(
    behavior.format_thousands,
  );
  elements.numberPreserveLeadingZeros.checked = Boolean(
    behavior.preserve_leading_zeros,
  );
  const allowed = new Set(behavior.allowed_special_characters || "");
  elements.numberBehaviorEditor
    .querySelectorAll("[data-number-special]")
    .forEach((control) => {
      control.checked = allowed.has(control.dataset.numberSpecial);
    });
  updateNumberStorageNote();
}

function updateNumberStorageNote() {
  const exactText =
    elements.numberPreserveLeadingZeros.checked ||
    selectedNumberSpecialCharacters().length > 0;
  elements.numberStorageNote.textContent = exactText
    ? scText("سيُحفظ هذا الحقل كنص في Excel لحماية الأصفار والرموز. لن تُطبق عليه العمليات الحسابية.")
    : "";
  elements.numberStorageNote.hidden = !exactText;
  elements.numberValidationFields.hidden =
    elements.fieldType.value !== "number" || exactText;
}

function collectNumberBehavior(type) {
  if (type !== "number") {
    return null;
  }
  const allowed = selectedNumberSpecialCharacters();
  const preserve = elements.numberPreserveLeadingZeros.checked;
  return {
    storage_mode: preserve || allowed ? "text" : "numeric",
    format_thousands: elements.numberFormatThousands.checked,
    preserve_leading_zeros: preserve,
    allowed_special_characters: allowed,
  };
}

function optionalNumber(input) {
  return input.value.trim() === "" ? null : Number(input.value);
}

function collectValidation(type) {
  if (["text", "textarea", "user_name"].includes(type)) {
    return {
      min_length: optionalNumber(elements.validationMinLength),
      max_length: optionalNumber(elements.validationMaxLength),
      pattern: elements.validationPattern.value.trim(),
    };
  }
  if (type === "number") {
    if (
      elements.numberPreserveLeadingZeros.checked ||
      selectedNumberSpecialCharacters().length
    ) {
      return {};
    }
    return {
      min: optionalNumber(elements.validationMinNumber),
      max: optionalNumber(elements.validationMaxNumber),
      integer_only: elements.validationIntegerOnly.checked,
    };
  }
  if (type.startsWith("date_")) {
    return {
      min_date: elements.validationMinDate.value.trim(),
      max_date: elements.validationMaxDate.value.trim(),
      compare_field_id: elements.validationCompareField.value || null,
      compare_operator: elements.validationCompareField.value
        ? elements.validationCompareOperator.value
        : null,
    };
  }
  return {};
}

function fillRelatedPersonSourceFields(selectedId = "") {
  const type = selectedBuilderFieldType();
  const selectedCheckbox = elements.relatedPersonSourceCheckbox.value;
  const selectedCheckboxCategory = selectedCheckbox ? fieldCategory(selectedCheckbox) : null;
  elements.relatedPersonSourceField.replaceChildren();
  appendBlankOption(
    elements.relatedPersonSourceField,
    scText("لا تنسخ قيمة تلقائيًا"),
  );
  const candidates = allFields().filter(
    ({ category: candidateCategory, field: candidateField }) =>
      candidateField.type !== "file" &&
      !isSystemField(candidateField) &&
      (selectedCheckboxCategory
        ? candidateCategory.id === selectedCheckboxCategory.id
        : candidateCategory.kind === "main"),
  );
  const groups = new Map();
  candidates.forEach(({ category, field }) => {
    if (!groups.has(category.id)) {
      const group = document.createElement("optgroup");
      group.label = displayLabel(category);
      groups.set(category.id, group);
      elements.relatedPersonSourceField.append(group);
    }
    const option = document.createElement("option");
    option.value = field.id;
    option.disabled = field.type !== type;
    option.textContent = field.type === type
      ? displayLabel(field)
      : scText`${displayLabel(field)} — نوع غير متوافق`;
    groups.get(category.id).append(option);
  });
  elements.relatedPersonSourceField.value = selectedId;
}

function fillRelatedPersonSourceCheckboxes(selected = "") {
  elements.relatedPersonSourceCheckboxWrapper.hidden = false;
  elements.relatedPersonSourceCheckbox.replaceChildren();
  appendBlankOption(elements.relatedPersonSourceCheckbox, scText("الحقول في الفئات الرئيسية"));
  const groups = new Map();
  allFields().filter(({ category, field }) => (
    category.kind === "repeatable" &&
    field.type === "checkbox" &&
    field.unique_checked_across_cards === true
  )).forEach(({ category, field }) => {
    if (!groups.has(category.id)) {
      const group = document.createElement("optgroup");
      group.label = displayLabel(category);
      groups.set(category.id, group);
      elements.relatedPersonSourceCheckbox.append(group);
    }
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = scText`البطاقة التي فيها «${displayLabel(field)}» محدد`;
    groups.get(category.id).append(option);
  });
  elements.relatedPersonSourceCheckbox.value = selected;
}

function fillAutoUpdateEditor(rule = null) {
  elements.fieldAutoSource.replaceChildren();
  appendBlankOption(elements.fieldAutoSource, scText("بدون تحديث تلقائي"));
  allFields().filter(({ category, field }) =>
    field.id !== state.editingFieldId &&
    field.type !== "file" &&
    !isSystemField(field)
  ).forEach(({ category, field }) => {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = `${displayLabel(category)} ← ${displayLabel(field)}`;
    elements.fieldAutoSource.append(option);
  });
  elements.fieldAutoSource.value = rule?.source_field_id || "";
  fillAutoUpdateOperators(rule?.operator || "");
  elements.fieldAutoValue.value = rule?.value || "";
  elements.fieldAutoAction.value = rule?.action || "fixed";
  elements.fieldAutoResult.value = rule?.result_value || "";
  updateAutoUpdateEditor();
}

function fillAutoUpdateOperators(selected = "") {
  const source = fieldById(elements.fieldAutoSource.value);
  const operators = CONDITION_OPERATORS_BY_TYPE[source?.type] || [];
  elements.fieldAutoOperator.replaceChildren();
  operators.forEach((operator) => {
    const option = document.createElement("option");
    option.value = operator;
    option.textContent = OPERATOR_LABELS[operator] || operator;
    elements.fieldAutoOperator.append(option);
  });
  if (operators.includes(selected)) elements.fieldAutoOperator.value = selected;
}

function updateAutoUpdateEditor() {
  const enabled = Boolean(elements.fieldAutoSource.value);
  elements.fieldAutoOperator.disabled = !enabled;
  const noValue = ["empty", "not_empty"].includes(elements.fieldAutoOperator.value);
  elements.fieldAutoValueWrapper.hidden = !enabled || noValue;
  elements.fieldAutoAction.disabled = !enabled;
  elements.fieldAutoResultWrapper.hidden = !enabled || elements.fieldAutoAction.value !== "fixed";
}

function collectAutoUpdateRule(type) {
  if (!elements.fieldAutoSource.value || SYSTEM_FIELD_TYPES.has(type)) return null;
  return {
    source_field_id: elements.fieldAutoSource.value,
    operator: elements.fieldAutoOperator.value,
    value: ["empty", "not_empty"].includes(elements.fieldAutoOperator.value)
      ? ""
      : elements.fieldAutoValue.value,
    action: elements.fieldAutoAction.value,
    result_value: elements.fieldAutoResult.value,
  };
}

function fillFieldPlacementSelect(select, fields, currentId = null, selected = null) {
  select.replaceChildren(new Option(scText("في بداية الفئة"), "start"), new Option(scText("في نهاية الفئة"), "end"));
  fields.filter(field => field.id !== currentId).forEach((field, index) => {
    select.append(new Option(displayLabel(field) || scText`مساحة فارغة ${index + 1}`, field.id));
  });
  const index = fields.findIndex(field => field.id === currentId);
  select.value = selected ?? (index >= 0 ? (index ? fields[index - 1].id : "start") : "end");
  if (!select.value) select.value = "end";
}

function refreshNewFieldPlacement() {
  const selected = elements.newFieldCategory.value;
  let fields = [];
  if (state.newFieldCategoryContext === "global") {
    if (selected === "__standalone__") {
      fields = Object.entries(state.globalDefinitions?.fields || {}).map(([id, item]) => ({...item.definition, id}));
    } else {
      const [ref, key] = selected.split("::");
      const node = globalCategoryTree(state.globalDefinitions?.categories?.[ref]?.definition || {}).find(node => node.key === key);
      fields = (node?.fields || []).map(field => ({...field.definition, id: field.key}));
    }
  } else fields = categoryById(selected)?.fields || [];
  fillFieldPlacementSelect(elements.newFieldAfter, fields);
}

function openNewFieldCategoryDialog(scope = state.builderScope) {
  elements.newFieldCategory.replaceChildren();
  state.newFieldCategoryContext = scope === "global" ? "global" : "schema";
  if (state.newFieldCategoryContext === "global") {
    elements.newFieldCategory.append(new Option(scText("حقل عام منفصل"), "__standalone__"));
    Object.entries(state.globalDefinitions?.categories || {}).forEach(([globalRef, item]) => {
      const definition = item?.definition || {};
      globalCategoryTree(definition).forEach((node) => {
        const rootLabel = displayLabel(definition) || scText("فئة عامة");
        const nodeLabel = displayLabel(node.definition) || rootLabel;
        const label = node.parent_key ? `${rootLabel} — ${nodeLabel}` : rootLabel;
        elements.newFieldCategory.append(new Option(label, `${globalRef}::${node.key}`));
      });
    });
    refreshNewFieldPlacement();
    elements.fieldCategoryDialog.showModal();
    elements.newFieldCategory.focus();
    return;
  }
  // Schema fields already choose their parent and position in the full editor.
  // View-table categories are projections and cannot own input fields.
  if (elements.fieldDialog.open) return;
  const categories = (state.draftSchema?.categories || []).filter(category => !category.view_table);
  const category = categories.find(item => item.id === state.activeBuilderCategoryId)
    || categories.find(item => item.kind === "main" && !item.parent_category_id)
    || categories[0];
  if (!category) {
    showToast(scText("أضف فئة أولًا ثم أضف الحقول إليها."), "error");
    return;
  }
  openFieldDialog(category.id, null, false, "end");
}

function confirmNewFieldCategory() {
  const categoryId = elements.newFieldCategory.value;
  if (state.newFieldCategoryContext === "global") {
    elements.fieldCategoryDialog.close();
    if (categoryId === "__standalone__") {
      openGlobalDefinitionEditor("field", "", {placement:elements.newFieldAfter.value});
      return;
    }
    const [globalRef, nodeKey] = categoryId.split("::");
    if (globalRef && nodeKey) {
      openGlobalCategoryPackageEditor("field", globalRef, { nodeKey, newField: true, afterFieldKey: elements.newFieldAfter.value });
    }
    return;
  }
  if (!categoryById(categoryId)) return;
  elements.fieldCategoryDialog.close();
  openFieldDialog(categoryId, null, false, elements.newFieldAfter.value);
}

function fieldDialogTypeState(field = null) {
  if (field?.financial?.mode === "budget") return {ui:"current_budget"};
  if (field?.financial?.mode === "calculation") return {ui:"calculation"};
  if (SCComposite.is(field)) return {ui:"composed_text"};
  const concrete = field?.type || "text";
  if (["text", "textarea"].includes(concrete)) {
    return { ui: "text", textMode: concrete === "textarea" ? "long" : "short" };
  }
  if (["select", "yes_no"].includes(concrete)) {
    return { ui: "select", listMode: concrete === "yes_no" ? "yes_no" : "custom" };
  }
  if (["date_gregorian", "date_hijri", "date_persian", "system_created_at", "system_updated_at"].includes(concrete)) {
    let dateMode = {
      date_gregorian: "manual_gregorian",
      date_hijri: "manual_hijri",
      date_persian: "manual_persian",
      system_created_at: "automatic_created",
      system_updated_at: "automatic_saved",
    }[concrete];
    if (concrete === "date_gregorian" && field?.date_value_mode === "on_checkbox") dateMode = "automatic_checkbox";
    return { ui: "date", dateMode };
  }
  return { ui: concrete };
}

function selectedBuilderFieldType() {
  const ui = elements.fieldType.value;
  if (["current_budget","calculation"].includes(ui)) return "number";
  if (ui === "composed_text") return "text";
  if (ui === "text") return elements.fieldTextMode.value === "long" ? "textarea" : "text";
  if (ui === "select") return elements.fieldListMode.value === "yes_no" ? "yes_no" : "select";
  if (ui === "date") {
    return {
      manual_gregorian: "date_gregorian",
      manual_hijri: "date_hijri",
      manual_persian: "date_persian",
      automatic_created: "system_created_at",
      automatic_saved: "system_updated_at",
      automatic_checkbox: "date_gregorian",
    }[elements.fieldDateMode.value] || "date_gregorian";
  }
  return ui;
}

function fillMainCheckboxSelect(select, selected = "") {
  select.replaceChildren(new Option(scText("اختر مربع اختيار"), ""));
  allFields().filter(({ category, field }) => category.kind === "main" && field.type === "checkbox").forEach(({ category, field }) => {
    select.append(new Option(`${displayLabel(category)} ← ${displayLabel(field)}`, field.id));
  });
  select.value = selected;
}

function openFieldDialog(categoryId, fieldId = null, detachGlobalOnSave = false, placement = null) {
  if (elements.globalFieldConnectChoice) elements.globalFieldConnectChoice.hidden = true;
  SCTransactionDelivery.resetField();
  state.editingFieldCategoryId = categoryId;

  const category = categoryById(categoryId);
  const field = fieldId ? fieldById(fieldId) : null;
  state.editingFieldDetachGlobal = Boolean(field?.global_ref && detachGlobalOnSave);

  state.editingFieldId = field?.id || randomDefinitionId("fld");

  state.fieldDialogCommitted = false;
  state.fieldConditionsSnapshot = deepClone(state.draftSchema.conditions);
  state.fieldDirtyBeforeOpen = state.dirty;
  if (!category) {
    return;
  }
  elements.fieldDialogTitle.textContent = field
    ? scText`تعديل حقل — ${displayLabel(category)}`
    : scText`إضافة حقل — ${displayLabel(category)}`;
  elements.fieldCategoryName.replaceChildren(...state.draftSchema.categories.filter(item => !item.view_table).map(item => new Option(displayLabel(item), item.id)));
  elements.fieldCategoryName.value = category.id;
  elements.fieldCategoryName.disabled = Boolean(state.globalEditor && !state.globalEditor.packageMode);
  elements.fieldCategoryName.onchange = () => {
    const target = categoryById(elements.fieldCategoryName.value);
    if (!target) return;
    const original = fieldId ? fieldCategory(fieldId) : null;
    const storedOriginal = fieldId ? fieldCategory(fieldId, state.schema) : null;
    const protectedMove = !state.globalEditor && storedOriginal && original?.id !== target.id &&
      (state.schema?.stats?.record_count || 0) > 0 && (storedOriginal.kind !== 'main' || target.kind !== 'main');
    if (protectedMove) {
      elements.fieldCategoryName.value = state.editingFieldCategoryId;
      showToast(scText('نقل الحقول بين البطاقات أو بينها وبين الفئات الرئيسية بعد وجود سجلات يحتاج إلى تحديد كيفية توزيع القيم. يمكنك نقل الحقل بين الفئات الرئيسية مع الحفاظ على قيمه.'), 'error');
      return;
    }
    state.editingFieldCategoryId = target.id;
    fillFieldPlacementSelect(elements.fieldAfter, target.fields || [], fieldId, original?.id === target.id ? null : 'end');
    elements.fieldDialogTitle.textContent = `${field ? scText('تعديل حقل') : scText('إضافة حقل')} — ${displayLabel(target)}`;
    updateFieldDialogType();
  };
  fillFieldPlacementSelect(elements.fieldAfter, category.fields || [], field?.id, placement);
  elements.fieldStartNewLine.checked = Boolean(field?.start_new_line);
  elements.fieldCheckboxTrueLabel.value = field?.checkbox_true_label || "";
  elements.fieldCheckboxFalseLabel.value = field?.checkbox_false_label || "";
  elements.fieldLabel.value = field?.label || "";
  initCompositionEditor(field);
  elements.fieldType.querySelector("[data-legacy-field-type]")?.remove();
  if (field?.type === "checkbox_group") {
    const legacy = new Option(scText("مجموعة مربعات اختيار — نوع قديم"), "checkbox_group");
    legacy.hidden = true;
    legacy.dataset.legacyFieldType = "";
    elements.fieldType.append(legacy);
  }
  const typeState = fieldDialogTypeState(field);
  elements.fieldType.value = typeState.ui;
  elements.fieldTextMode.value = typeState.textMode || "short";
  elements.fieldListMode.value = typeState.listMode || "custom";
  elements.fieldDateMode.value = typeState.dateMode || "manual_gregorian";
  fillMainCheckboxSelect(elements.fieldDateTrigger, field?.date_trigger_field_id || "");
  elements.fieldPlaceholder.value = field?.placeholder || "";
  renderLanguageNameEditor(document.getElementById('field-language-editor'), field,
    [['label', scText('اسم الحقل')], ['placeholder', scText('النص الإرشادي')], ['checkbox_true_label', scText('معنى التحديد (صحيح)')], ['checkbox_false_label', scText('معنى عدم التحديد (خطأ)')]],
    { label: () => elements.fieldLabel.value, placeholder: () => elements.fieldPlaceholder.value,
      checkbox_true_label: () => elements.fieldCheckboxTrueLabel.value, checkbox_false_label: () => elements.fieldCheckboxFalseLabel.value });
  elements.fieldWidth.value = ({ normal: "1", wide: "4", long: "4" }[field?.width] || field?.width || "1");
  state.fieldOptionsDraft = deepClone(field?.options || []);
  elements.fieldOptions.value = state.fieldOptionsDraft
    .map((option) => option.label)
    .join("\n");
  elements.fieldRequired.checked = Boolean(field?.required);
  elements.fieldUnique.checked = Boolean(field?.unique);
  elements.fieldSearchable.checked = Boolean(field?.searchable);
  elements.fieldSearchMatch.value = field?.search_match || "contains";
  elements.fieldShowResult.checked = Boolean(field?.show_in_results);
  elements.fieldResultTitle.checked = Boolean(field?.result_title);
  elements.fieldUserEditable.checked = field?.user_editable !== false;
  elements.fieldUserValueMode.value = field?.user_value_mode || "created_by";
  fillMainCheckboxSelect(elements.fieldUserTrigger, field?.user_trigger_field_id || "");
  elements.fieldUniqueCardCheckbox.checked = Boolean(field?.unique_checked_across_cards);
  fillRelatedPersonSourceCheckboxes(field?.related_person_source_checkbox_id || field?.related_person_source_marker_id || "");
  fillRelatedPersonSourceFields(field?.related_person_source_field_id || "");
  fillAutoUpdateEditor(field?.auto_update || null);
  elements.fileNamingMode.value = field?.file_naming?.mode || "original";
  elements.fileProfileImage.checked = ["profile", "card"].includes(field?.image_display);
  state.filePartsDraft = deepClone(field?.file_naming?.parts || []);
  state.optionFilterDraft = deepClone(field?.option_filter || null);
  fillFileNamingFieldSelect();
  fillOptionFilterSource();
  loadValidation(field);
  loadNumberBehavior(field);
  SCFinance.initField(field);
  SCFieldRules.init(field);
  updateFieldDialogType();
  renderOptionFilterMatrix();
  renderFileParts();
  renderFieldConditionEditor();
  renderFieldConfigurationSources();
  SCAlerts.reset("field", field);
  window.SCBuilderCompact?.prepareField();
  elements.fieldDialog.showModal();
  elements.fieldLabel.focus();
}


function updateFieldDialogType() {
  SCFinance.renderField();
  SCFieldRules.render();
  const uiType = elements.fieldType.value;
  const type = selectedBuilderFieldType();
  const isFile = type === "file";
  const spacer = type === 'spacer';
  const group = false;
  const composed = uiType === 'composed_text';
  document.getElementById('composition-editor').hidden = !composed;
  if (composed) renderCompositionEditor();
  elements.fieldWidth.disabled = false;
  elements.fieldCheckboxMeanings.hidden = type !== 'checkbox';
  const systemField = SYSTEM_FIELD_TYPES.has(type) || spacer || group;
  // A spacer keeps its name cell so later overview fields never shift.
  elements.fieldLabel.closest('.field').hidden = false;
  elements.fieldLabel.disabled = spacer;
  const hasOptions = type === "select";
  const languagesButton = document.getElementById('field-option-languages-wrapper');
  if (languagesButton) languagesButton.hidden = !['select', 'yes_no', 'checkbox_group'].includes(type);
  const languageEditor = document.getElementById('field-language-editor');
  if (languageEditor) languageEditor.hidden = spacer;
  const searchable = !isFile && !spacer && !group;
  const textType = ["text", "textarea", "user_name"].includes(type);
  const numberType = type === "number";
  const dateType = type.startsWith("date_");
  elements.fieldTextModeWrapper.hidden = uiType !== "text";
  elements.fieldListModeWrapper.hidden = uiType !== "select";
  elements.fieldDateModeWrapper.hidden = uiType !== "date";
  elements.fieldDateTriggerWrapper.hidden = uiType !== "date" || elements.fieldDateMode.value !== "automatic_checkbox";
  elements.fieldUserTriggerWrapper.hidden = type !== "user_name" || elements.fieldUserValueMode.value !== "current_on_checkbox";
  const repeatableCheckbox = type === "checkbox" && categoryById(state.editingFieldCategoryId)?.kind === "repeatable";
  elements.fieldUniqueCardCheckboxWrapper.hidden = !repeatableCheckbox;
  const relatedPersonEligible = Boolean(
      categoryById(state.editingFieldCategoryId)?.kind === "repeatable" &&
      categoryById(state.editingFieldCategoryId)?.related_person_enabled &&
      !isFile &&
      !systemField && !composed,
  );
  const hasOptionFilterSource = Boolean(elements.optionFilterSource.value);
  elements.fieldOptionsWrapper.hidden = !hasOptions || hasOptionFilterSource;
  elements.optionFilterEditor.hidden = !hasOptions;
  elements.fieldPlaceholder.closest(".field").hidden = false;
  elements.fieldPlaceholder.disabled = systemField;
  elements.fieldRequired.closest(".check-field").hidden = systemField;
  if (type === "user_name" && ["current_on_save", "current_on_checkbox"].includes(elements.fieldUserValueMode.value)) {
    elements.fieldRequired.checked = false;
    elements.fieldRequired.closest(".check-field").hidden = true;
  }
  elements.fieldSearchableWrapper.hidden = isFile || spacer || group;
  elements.fieldUniqueWrapper.hidden =
    isFile || type === "checkbox" || systemField;
  elements.fieldSearchMatchWrapper.hidden =
    !searchable || !elements.fieldSearchable.checked;
  elements.fieldResultWrapper.hidden = isFile || spacer || group;
  elements.fieldTitleWrapper.hidden =
    isFile ||
    systemField ||
    categoryById(state.editingFieldCategoryId)?.kind !== "main" ||
    !elements.fieldShowResult.checked;
  elements.relatedPersonFieldEditor.hidden = !relatedPersonEligible;
  if (relatedPersonEligible) {
    const selectedSource = elements.relatedPersonSourceField.value;
    const selectedCheckbox = elements.relatedPersonSourceCheckbox.value;
    fillRelatedPersonSourceCheckboxes(selectedCheckbox);
    fillRelatedPersonSourceFields(selectedSource);
  } else {
    elements.relatedPersonSourceField.value = "";
  }
  elements.fileNamingEditor.hidden = !isFile;
  const profileImageEligible = isFile;
  elements.fileProfileImageWrapper.hidden = !profileImageEligible;
  if (!profileImageEligible) {
    elements.fileProfileImage.checked = false;
  }
  if (isFile) {
    const repeated = categoryById(state.editingFieldCategoryId)?.kind === "repeatable";
    elements.fileProfileImageWrapper.querySelector("span").textContent = repeated
      ? scText("عرض الصورة في يسار بطاقة الفئة المتكررة")
      : scText("عرض هذا المرفق كصورة شخصية في يسار فئة المعلومات الرئيسية");
  }
  elements.fileTemplateEditor.hidden =
    !isFile || elements.fileNamingMode.value !== "template";
  elements.fieldConditionsList.closest(".dialog-subsection").hidden =
    SYSTEM_FIELD_TYPES.has(type) || group;
  elements.fieldValidationEditor.hidden =
    systemField || !(textType || numberType || dateType);
  elements.fieldUserEditableWrapper.hidden = type !== "user_name";
  elements.fieldUserValueModeWrapper.hidden = type !== "user_name";
  elements.fieldAutoUpdateEditor.hidden = systemField || composed || ["current_budget","calculation"].includes(uiType);
  elements.numberBehaviorEditor.hidden = !numberType;
  elements.textValidationFields.hidden = !textType;
  elements.numberValidationFields.hidden = !numberType;
  elements.dateValidationFields.hidden = !dateType;
  if (isFile || systemField) {
    if(systemField)elements.fieldRequired.checked = false;
    if (isFile) elements.fieldSearchable.checked = false;
    if (isFile) elements.fieldShowResult.checked = false;
    elements.fieldResultTitle.checked = false;
    elements.fieldUnique.checked = false;
  }
  if (["yes_no", "select", "checkbox", "checkbox_group"].includes(type)) {
    elements.fieldSearchMatch.value = "exact";
  }
  if (dateType) {
    fillDateComparisonFields(fieldById(state.editingFieldId));
  }
  if (hasOptions) {
    fillOptionFilterSource();
    renderOptionFilterMatrix();
  }
  if (numberType) {
    updateNumberStorageNote();
  }
  window.SCBuilderCompact?.refreshField();
}

function renderFileParts() {
  elements.filePartsList.replaceChildren();
  elements.filePartsList.classList.add("filename-composition-field");
  state.filePartsDraft.forEach((part, index) => {
    const item = document.createElement("span");
    item.className = "filename-part";
    const prefix = document.createElement("span");
    prefix.className = "filename-literal";
    prefix.textContent = part.prefix || "";
    prefix.dataset.i18nSkip = "true";
    const token = document.createElement("span");
    token.className = "filename-part-token";
    const name = document.createElement("span");
    name.textContent = displayLabel(fieldById(part.field_id)) || scText("حقل غير متاح");
    name.dataset.i18nSkip = "true";
    const remove = builderActionButton(scText("حذف الجزء"), "file-part-delete", String(index), "button-danger-quiet", "clear");
    remove.classList.add("filename-part-remove");
    remove.title = scText("حذف الجزء") + " — " + name.textContent;
    remove.setAttribute("aria-label", remove.title);
    token.append(name, remove);
    // Retain keyboard/button reordering without separate stacked source rows.
    const actions = document.createElement("span"); actions.className = "filename-part-order";
    const up = builderActionButton(scText("نقل إلى أعلى"), "file-part-up", String(index), "", "up");
    const down = builderActionButton(scText("نقل إلى أسفل"), "file-part-down", String(index), "", "down");
    up.disabled = index === 0; down.disabled = index === state.filePartsDraft.length - 1;
    actions.append(up, down);
    const suffix = document.createElement("span");suffix.className = "filename-literal";
    suffix.textContent = part.suffix || "";suffix.dataset.i18nSkip = "true";
    item.append(prefix, token, suffix, actions);
    elements.filePartsList.append(item);
  });
  if (!state.filePartsDraft.length) {
    const empty = document.createElement("span");empty.className = "muted-text";
    empty.textContent = scText("أضف الحقول التي تكوّن اسم الملف بالترتيب المطلوب.");
    elements.filePartsList.append(empty);
  }
}

function addFilePart() {
  if (!elements.filePartField.value) {
    showToast(scText("لا يوجد حقل متاح لتسمية الملف."), "error");
    return;
  }

  state.filePartsDraft.push({
    field_id: elements.filePartField.value,
    prefix: elements.filePartPrefix.value,
    suffix: elements.filePartSuffix.value,
  });

  elements.filePartPrefix.value = "";
  elements.filePartSuffix.value = "";

  renderFileParts();
}

function handleFilePartAction(button) {
  const index = Number(button.dataset.itemId);
  const action = button.dataset.builderAction;
  if (action === "file-part-delete") {
    state.filePartsDraft.splice(index, 1);
  } else if (action === "file-part-up") {
    moveArrayItem(state.filePartsDraft, index, -1);
  } else if (action === "file-part-down") {
    moveArrayItem(state.filePartsDraft, index, 1);
  }
  renderFileParts();
}

async function saveFieldFromDialog() {
  if(window.SCBuilderCompact?.hasDetail('field'))return;
  let financeMetadata;
  try { financeMetadata = SCFinance.collectField(); } catch (e) { showToast(e.message, 'error'); return; }
  let alertRules;
  try { alertRules = SCAlerts.collect("field"); } catch (error) { showToast(error.message, "error"); return; }
  const category = categoryById(state.editingFieldCategoryId);
  if (!category) {
    return;
  }
  const type = selectedBuilderFieldType();
  const spacer = type === 'spacer';
  const group = false;
  const composed = elements.fieldType.value === 'composed_text';
  let composition = null;
  if (composed) {
    try {
      if (state.globalEditor?.kind === 'field' && !state.globalEditor.packageMode) throw Error(scText('النص المركب يحتاج مصادره؛ احفظه ضمن فئة عامة لا كحقل مستقل.'));
      composition = collectComposition();
    } catch (error) { showToast(error.message, 'error'); return; }
  }
  const label = spacer ? '' : elements.fieldLabel.value.trim();
  if (!label && !spacer) {
    showToast(scText("اسم الحقل مطلوب."), "error");
    elements.fieldLabel.focus();
    return;
  }
  if (
    !spacer && category.fields.some(
      (field) =>
        field.id !== state.editingFieldId &&
        field.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase(),
    )
  ) {
    showToast(scText("اسم الحقل مستخدم داخل هذه الفئة."), "error");
    return;
  }

  const systemField = SYSTEM_FIELD_TYPES.has(type);
  if (systemField && category.kind !== "main") {
    showToast(scText("حقول معرّف السجل وتواريخه تضاف إلى فئة رئيسية فقط."), "error");
    return;
  }
  if (
    systemField &&
    allFields().some(
      ({ field }) => field.id !== state.editingFieldId && field.type === type,
    )
  ) {
    showToast(scText("يوجد حقل آخر من نوع بيانات السجل نفسه."), "error");
    return;
  }
  let options = [];
  let optionFilter = null;
  if (type === "yes_no") {
    const previous = state.fieldOptionsDraft || [];
    options = ["نعم", "لا"].map(
      (optionLabel) =>
        previous.find((candidate) => candidate.label === optionLabel) || {
          id: randomDefinitionId("opt"),
          label: optionLabel,
          active: true,
        },
    );
  } else if (["select", "checkbox_group"].includes(type)) {
    if (elements.optionFilterSource.value) {
      optionFilter = collectOptionFilter();
      options = deepClone(state.fieldOptionsDraft);
    } else {
      options = reconcileFieldOptions();
    }
  }
  if (["select", "checkbox_group"].includes(type) && !options.length && !(type === "select" && SCRecordChoices.enabled())) {
    showToast(scText("أضف خيارًا واحدًا على الأقل للحقل."), "error");
    return;
  }
  if (
    !elements.relatedPersonFieldEditor.hidden &&
    elements.relatedPersonSourceField.value &&
    fieldCategory(elements.relatedPersonSourceField.value)?.kind === "repeatable" &&
    !elements.relatedPersonSourceCheckbox.value
  ) {
    showToast(scText("اختر مربع الاختيار الفريد الذي يحدد بطاقة المصدر."), "error");
    return;
  }
  if (
    type === "user_name" &&
    elements.fieldUserValueMode.value === "current_on_checkbox" &&
    !elements.fieldUserTrigger.value
  ) {
    showToast(scText("اختر مربع الاختيار الذي يحدّث اسم المستخدم."), "error");
    return;
  }
  if (
    elements.fieldType.value === "date" &&
    elements.fieldDateMode.value === "automatic_checkbox" &&
    !elements.fieldDateTrigger.value
  ) {
    showToast(scText("اختر مربع الاختيار الذي يحدّث التاريخ."), "error");
    return;
  }
  if (
    type === "file" &&
    elements.fileNamingMode.value === "template" &&
    !state.filePartsDraft.length
  ) {
    showToast(scText("أضف جزءًا واحدًا على الأقل لصيغة اسم الملف."), "error");
    return;
  }
  if (
    type === "file" &&
    elements.fileProfileImage.checked &&
    category.kind === "main" &&
    allFields().some(
      ({ field }) =>
        field.id !== state.editingFieldId &&
        field.image_display === "profile",
    )
  ) {
    showToast(scText("يوجد حقل آخر محدد بوصفه الصورة الشخصية."), "error");
    return;
  }

  const validation = collectValidation(type);
  if (
    validation.min_length != null &&
    validation.max_length != null &&
    validation.min_length > validation.max_length
  ) {
    showToast(scText("الحد الأدنى لطول النص أكبر من الحد الأعلى."), "error");
    return;
  }
  if (
    validation.min != null &&
    validation.max != null &&
    validation.min > validation.max
  ) {
    showToast(scText("الحد الأدنى للرقم أكبر من الحد الأعلى."), "error");
    return;
  }
  if (
    validation.min_date &&
    validation.max_date &&
    validation.min_date > validation.max_date
  ) {
    showToast(scText("أقدم تاريخ مسموح يأتي بعد أحدث تاريخ مسموح."), "error");
    return;
  }
  if (validation.pattern) {
    try {
      new RegExp(validation.pattern);
    } catch (_error) {
      showToast(scText("نمط التحقق النصي غير صالح."), "error");
      return;
    }
  }

  const existing = state.editingFieldId
    ? fieldById(state.editingFieldId)
    : null;
  const wasDataField = existing && !isLayoutField(existing);
  if (
    existing &&
    existing.type !== type &&
    (state.schema?.stats?.record_count || 0) > 0 &&
    (existing.type === "file" || type === "file" || type === 'spacer') &&
    !(await requestConfirmation(
      scText("تغيير الحقل من ملف أو إليه، أو إلى مساحة فارغة، سيمسح قيمه الحالية عند حفظ التصميم."),
      { title: scText("تغيير نوع الحقل"), confirmLabel: scText("تغيير النوع") },
    ))
  ) {
    return;
  }

  const field = existing ? deepClone(existing) : {
    id: state.editingFieldId,
  };
  if (existing && state.editingFieldDetachGlobal) {
    field.global_ref = null;
  }
  field.label = label;
  field.i18n = spacer ? undefined : readLanguageNameEditor('field-language-editor');
  field.type = type;
  field.required =
    !systemField &&
    !(type === "user_name" && ["current_on_save", "current_on_checkbox"].includes(elements.fieldUserValueMode.value)) &&
    elements.fieldRequired.checked;
  field.placeholder = systemField
    ? ""
    : elements.fieldPlaceholder.value.trim();
  field.width = elements.fieldWidth.value;
  field.start_new_line = elements.fieldStartNewLine.checked;
  field.checkbox_true_label = type === "checkbox" ? elements.fieldCheckboxTrueLabel.value.trim() : "";
  field.checkbox_false_label = type === "checkbox" ? elements.fieldCheckboxFalseLabel.value.trim() : "";
  field.options = options;
  field.searchable =
    type !== "file" && elements.fieldSearchable.checked;
  field.search_match = elements.fieldSearchMatch.value;
  field.show_in_results =
    type !== "file" && elements.fieldShowResult.checked;
  field.result_title =
    category.kind === "main" &&
    field.show_in_results &&
    elements.fieldResultTitle.checked;
  field.unique =
    type !== "file" &&
    type !== "checkbox" &&
    !systemField &&
    elements.fieldUnique.checked;
  field.validation = systemField ? {} : validation;
  field.user_editable = type === "user_name" ? elements.fieldUserEditable.checked : true;
  field.user_value_mode = type === "user_name"
    ? elements.fieldUserValueMode.value
    : "created_by";
  field.user_trigger_field_id = type === "user_name" && elements.fieldUserValueMode.value === "current_on_checkbox"
    ? elements.fieldUserTrigger.value || null
    : null;
  field.date_value_mode = type === "date_gregorian" && elements.fieldType.value === "date" && elements.fieldDateMode.value === "automatic_checkbox"
    ? "on_checkbox"
    : "manual";
  field.date_trigger_field_id = field.date_value_mode === "on_checkbox"
    ? elements.fieldDateTrigger.value || null
    : null;
  field.unique_checked_across_cards = type === "checkbox" && category.kind === "repeatable"
    ? elements.fieldUniqueCardCheckbox.checked
    : false;
  field.auto_update = composed ? null : collectAutoUpdateRule(type);
  field.alerts = alertRules;
  if (composed) field.composition = composition; else delete field.composition;
  if (type === "number") {
    field.number_behavior = collectNumberBehavior(type);
  } else {
    delete field.number_behavior;
  }
  field.option_filter = ["select", "checkbox_group"].includes(type)
    ? optionFilter
    : null;
  field.related_person_source_field_id =
    category.kind === "repeatable" && category.related_person_enabled
      ? elements.relatedPersonSourceField.value || null
      : null;
  field.related_person_source_checkbox_id =
    category.kind === "repeatable" && category.related_person_enabled
      ? elements.relatedPersonSourceCheckbox.value || null
      : null;
  delete field.related_person_source_marker_id;
  if (composed) { field.related_person_source_field_id = null; field.related_person_source_checkbox_id = null; }

  if (type === "file") {
    field.image_display = elements.fileProfileImage.checked
      ? (category.kind === "repeatable" ? "card" : "profile")
      : null;
    field.file_naming = {
      mode: elements.fileNamingMode.value,
      parts: deepClone(state.filePartsDraft),
    };
  } else {
    delete field.image_display;
    delete field.file_naming;
  }
  try { SCFieldRules.collect(field,financeMetadata); } catch(e) { showToast(e.message,'error');return; }
  SCFinance.applyField(field, financeMetadata);
  try { SCTransactionDelivery.collectField(field); } catch(e) { showToast(e.message,'error');return; }
  if (existing) {
    const originalCategory = fieldCategory(existing.id);
    const oldIndex = originalCategory?.fields.findIndex(item => item.id === existing.id) ?? -1;
    if (oldIndex >= 0) originalCategory.fields.splice(oldIndex, 1);
  }
  const placement = elements.fieldAfter.value;
  const afterIndex = category.fields.findIndex(candidate => candidate.id === placement);
  const insertionIndex = placement === "start" ? 0 : afterIndex >= 0 ? afterIndex + 1 : category.fields.length;
  category.fields.splice(insertionIndex, 0, field);
  if (spacer) {
    if (wasDataField) {
      const appearance = state.draftSchema.conditions.filter(rule => rule.target_type === "field" && rule.target_id === field.id && rule.source_field_id !== field.id);
      removeReferencesToFields([field.id]);
      state.draftSchema.conditions.push(...appearance);
    }
    Object.assign(field, {label:'', required:false, unique:false, placeholder:'', options:[], searchable:false, show_in_results:false, result_title:false, validation:{}, option_filter:null, auto_update:null, related_person_source_field_id:null, related_person_source_checkbox_id:null});
  }
  delete field.field_ids;
  // A moved/deleted member must not leave a dangling layout reference.
  pruneFieldGroups(state.draftSchema);
  SCTransactionDelivery.commitField();
  if (state.globalEditor?.kind === "field") {
    state.fieldDialogCommitted = true;
    void commitGlobalDefinitionFromEditor("field", field);
    elements.fieldDialog.close();
    return;
  }
  markDirty();
  renderBuilder();
  state.fieldDialogCommitted = true;
  elements.fieldDialog.close();
}

function conditionTargetCategory(targetType, targetId) {
  if (targetType === "category") {
    const existing = categoryById(targetId);

    if (existing) {
      return existing;
    }

    if (state.editingCategoryId === targetId) {
      return {
        id: targetId,
        kind: elements.categoryKind.value,
      };
    }

    return null;
  }

  const existing = fieldCategory(targetId);

  if (existing) {
    return existing;
  }

  if (state.editingFieldId === targetId) {
    return categoryById(state.editingFieldCategoryId);
  }

  return null;
}

function fillConditionSources(targetType, targetId, selected = "") {
  elements.conditionSource.replaceChildren();

  const targetCategory = conditionTargetCategory(targetType, targetId);

  if (targetType === "field") {
    const relatedPersonMode = relatedPersonModeField(targetCategory);
    if (relatedPersonMode) {
      const option = document.createElement("option");
      option.value = relatedPersonMode.id;
      option.textContent = `${displayLabel(targetCategory)} ← ${displayLabel(relatedPersonMode)}`;
      elements.conditionSource.append(option);
    }
  }

  for (const { category, field } of allFields()) {
    const allowed =
      !isSystemField(field) &&
      (category.kind === "main" || category.id === targetCategory?.id);

    if (!allowed) {
      continue;
    }

    const option = document.createElement("option");

    option.value = field.id;
    option.textContent = `${displayLabel(category)} ← ${displayLabel(field)}`;

    elements.conditionSource.append(option);
  }

  if(targetType==='field' && !fieldById(targetId)) {
    const own=SCFieldRules.conditionField(targetId);
    if(own&&!isSystemField(own)){const option=new Option(`${displayLabel(targetCategory)} ← ${displayLabel(own)}`,targetId);elements.conditionSource.append(option);}
  }
  if (selected) {
    elements.conditionSource.value = selected;
  }
}

function fillConditionOperators(selected = "", preserveNegation = false) {
  elements.conditionOperator.replaceChildren();
  const source = SCFieldRules.conditionField(elements.conditionSource.value);
  const operators = CONDITION_OPERATORS_BY_TYPE[source?.type] || [];
  operators.forEach(operator => {
    const option = document.createElement("option");
    option.value = operator;
    option.textContent = OPERATOR_LABELS[operator] || operator;
    elements.conditionOperator.append(option);
  });
  if (selected && operators.includes(selected)) {
    if (preserveNegation) {
      // NOT equals is NOT the same as not_equals for empty source values.
      // Retain the exact legacy behavior as a clearly labeled operator choice.
      const option = document.createElement("option");
      option.value = SCAppearanceCondition.selection({operator:selected, negate:true});
      option.textContent = scText("ليس صحيحًا أن ") + (OPERATOR_LABELS[selected] || selected);
      elements.conditionOperator.append(option);
      elements.conditionOperator.value = option.value;
    } else elements.conditionOperator.value = selected;
  }
}

function fillConditionGroups(targetType, targetId, selected = "") {
  elements.conditionGroup.replaceChildren();

  const rules = conditionsFor(targetType, targetId, state.draftSchema);

  const groupIds = [
    ...new Set(
      rules.map(
        (condition) => condition.group_id || `legacy-${targetType}-${targetId}`,
      ),
    ),
  ];

  groupIds.forEach((groupId, index) => {
    const option = document.createElement("option");

    option.value = groupId;
    option.textContent = scText`المجموعة ${index + 1} — AND`;

    elements.conditionGroup.append(option);
  });

  const newGroup = document.createElement("option");

  newGroup.value = "__new_group__";
  newGroup.textContent = scText("مجموعة بديلة جديدة — OR");

  elements.conditionGroup.append(newGroup);

  if (selected && groupIds.includes(selected)) {
    elements.conditionGroup.value = selected;
  } else if (groupIds.length) {
    elements.conditionGroup.value = groupIds[0];
  } else {
    elements.conditionGroup.value = "__new_group__";
  }
}
function createConditionCalendarControl(type, initialValue = "") {
  const root = document.createElement("div");
  root.className = "calendar-control";

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.dataset.conditionValue = "";

  const year = document.createElement("select");
  year.className = "control";

  const month = document.createElement("select");
  month.className = "control";

  const day = document.createElement("select");
  day.className = "control";

  appendBlankOption(year, scText("السنة"));
  appendBlankOption(month, scText("الشهر"));
  appendBlankOption(day, scText("اليوم"));

  const [firstYear, lastYear] = calendarYearRange(type);

  for (let value = firstYear; value <= lastYear; value += 1) {
    const option = document.createElement("option");

    option.value = String(value);
    option.textContent = String(value);
    year.append(option);
  }

  CALENDAR_MONTH_NAMES[type].forEach((name, index) => {
    const option = document.createElement("option");

    option.value = String(index + 1).padStart(2, "0");
    option.textContent = name;

    month.append(option);
  });

  function synchronizeDays() {
    const previousDay = day.value;
    populateCalendarDays(
      day,
      maximumSelectableCalendarDay(type, year.value, month.value),
      previousDay,
    );

    hidden.value =
      year.value && month.value && day.value
        ? `${year.value}-${month.value}-${day.value}`
        : "";
  }

  // Use the same explicit navigation policy as the record's date control.
  // The former auto-advance helper is no longer defined by the application.
  for (const [control, caption] of [[day, "اليوم"], [month, "الشهر"], [year, "السنة"]]) {
    control.setAttribute("aria-label", scText(caption));
    control.addEventListener("change", synchronizeDays);
  }

  root.append(hidden, day, month, year);

  const [initialYear, initialMonth, initialDay] = String(
    initialValue || "",
  ).split("-");

  year.value = initialYear || "";
  month.value = initialMonth || "";

  synchronizeDays();

  day.value = initialDay || "";
  synchronizeDays();

  return root;
}

function currentConditionValue() {
  return (
    elements.conditionValueControl.querySelector("[data-condition-value]")
      ?.value || ""
  );
}

function renderConditionValueControl(initialValue = "") {
  elements.conditionValueControl.replaceChildren();

  const source = SCFieldRules.conditionField(elements.conditionSource.value);

  const { operator } = SCAppearanceCondition.decode(elements.conditionOperator.value);

  const requiresValue = !["empty", "not_empty"].includes(operator);
  if (SCFieldRules.appearanceCompare()) return;

  // Keep the third column in place for Empty/Nonempty; no editable value applies.
  elements.conditionValueWrapper.hidden = false;

  if (!requiresValue || !source) {
    return;
  }

  if (["date_gregorian", "date_hijri", "date_persian"].includes(source.type)) {
    elements.conditionValueControl.append(
      createConditionCalendarControl(source.type, initialValue),
    );

    return;
  }

  let control;

  if (source.type === "checkbox") {
    control = document.createElement("select");
    control.className = "control";

    const checked = document.createElement("option");

    checked.value = "true";
    checked.textContent = checkboxDisplayMeaning(source, true);

    const unchecked = document.createElement("option");

    unchecked.value = "false";
    unchecked.textContent = checkboxDisplayMeaning(source, false);

    control.append(checked, unchecked);
  } else if (["select", "yes_no", "checkbox_group"].includes(source.type) && !source.record_options) {
    control = document.createElement("select");
    control.className = "control";

    appendBlankOption(control, scText("— اختر —"));

    (source.options || []).forEach((sourceOption) => {
      const option = document.createElement("option");

      option.value = sourceOption.id;
      option.textContent =
        sourceOption.active === false
          ? scText`${displayLabel(sourceOption)} — غير نشط`
          : displayLabel(sourceOption);

      control.append(option);
    });
  } else {
    control = document.createElement("input");
    control.className = "control";

    if (source.type === "number") {
      control.type = "number";
      control.step = "any";
    } else {
      control.type = "text";
    }
  }

  control.dataset.conditionValue = "";
  control.setAttribute("aria-labelledby", "condition-value-label");

  if (["select", "yes_no", "checkbox_group"].includes(source.type) && !source.record_options) {
    control.value = optionIdForValue(source, initialValue);
  } else {
    control.value = initialValue ?? "";
  }

  elements.conditionValueControl.append(control);
}
function openConditionDialog(
  conditionId = null,
  targetType = null,
  targetId = null,
) {
  const condition = conditionId
    ? state.draftSchema.conditions.find((item) => item.id === conditionId)
    : null;

  if (condition) {
    targetType = condition.target_type;
    targetId = condition.target_id;
  }

  if (!targetType || !targetId) {
    showToast(scText("افتح الفئة أو الحقل الذي تريد إضافة الشرط إليه."), "error");
    return;
  }

  state.editingConditionId = conditionId;
  state.conditionTargetType = targetType;
  state.conditionTargetId = targetId;

  elements.conditionDialogTitle.textContent = condition
    ? scText("تعديل شرط ظهور")
    : scText("إضافة شرط ظهور");


  fillConditionSources(targetType, targetId, condition?.source_field_id || "");

  if (!elements.conditionSource.options.length) {
    showToast(scText("لا يوجد حقل متاح للتحكم في ظهور هذا العنصر."), "error");
    return;
  }

  fillConditionOperators(condition?.operator || "", Boolean(condition?.negate));

  fillConditionGroups(targetType, targetId, condition?.group_id || "");

  state.conditionCompareFieldId=condition?.compare_field_id||'';
  state.conditionCompareEnabled=!!condition?.compare_field_id;
  state.conditionLiteralValue=condition?.value ?? "";
  renderConditionValueControl(state.conditionLiteralValue);

  elements.conditionDialog.showModal();
}

function saveConditionFromDialog() {
  const targetType = state.conditionTargetType;

  const targetId = state.conditionTargetId;

  const sourceId = elements.conditionSource.value;

  const { operator, negate } = SCAppearanceCondition.decode(elements.conditionOperator.value);

  if (!targetType || !targetId || !sourceId || !operator) {
    showToast(scText("بيانات شرط الظهور غير مكتملة."), "error");
    return;
  }

  const requiresValue = !["empty", "not_empty"].includes(operator);

  const value = requiresValue ? currentConditionValue() : "";

  if (requiresValue && state.conditionCompareEnabled && !state.conditionCompareFieldId) {
    showToast(scText("اختر الحقل المقارن."), "error");
    document.getElementById("condition-compare-field")?.focus();
    return;
  }
  if (requiresValue && !state.conditionCompareEnabled && String(value).trim() === "") {
    showToast(scText("اختر أو أدخل قيمة الشرط."), "error");
    return;
  }

  const existing = state.editingConditionId
    ? state.draftSchema.conditions.find(
        (condition) => condition.id === state.editingConditionId,
      )
    : null;

  const condition = existing || {
    id: randomDefinitionId("cond"),
  };

  let groupId = elements.conditionGroup.value;

  if (groupId === "__new_group__") {
    groupId = randomDefinitionId("grp");
  }

  condition.target_type = targetType;
  condition.target_id = targetId;
  condition.source_field_id = sourceId;
  condition.operator = operator;
  condition.value = value;
  if(requiresValue&&state.conditionCompareFieldId)condition.compare_field_id=state.conditionCompareFieldId;else delete condition.compare_field_id;
  condition.group_id = groupId;
  condition.negate = negate;

  if (!existing) {
    state.draftSchema.conditions.push(condition);
  }

  if (targetType === "category") {
    const targetCategory = categoryById(targetId);

    const sourceCategory = fieldCategory(sourceId);

    if (
      targetCategory?.kind === "repeatable" &&
      !targetCategory.anchor_field_id &&
      sourceCategory?.kind === "main"
    ) {
      targetCategory.anchor_field_id = sourceId;
    }
  }

  if (state.globalEditor?.packageMode && state.globalEditor.kind === "condition") {
    const editor = state.globalEditor;
    void commitGlobalCategoryPackageFromEditor(
      "condition",
      { label: existing ? scText("تعديل شرط ظهور") : scText("إضافة شرط ظهور") },
      editor,
    );
    elements.conditionDialog.close();
    return;
  }

  markDirty();
  refreshConditionEditors();
  elements.conditionDialog.close();
}

function setSchemaSaving(saving) {
  state.savingSchema = saving;
  elements.saveSchemaButton.disabled = saving;
  elements.discardSchemaButton.disabled = saving;
  elements.backupButton.disabled = saving || state.backingUp;
  elements.schemaSpinner.hidden = !saving;
  elements.saveSchemaText.textContent = saving
    ? scText("جاري حفظ التصميم…")
    : scText("حفظ تصميم التطبيق");
}

async function saveSchema(options = {}) {
  const automatic = options.automatic === true;

  if (state.savingSchema || !state.draftSchema) {
    return false;
  }

  const previousSchema = deepClone(state.schema || { categories: [] });
  setSchemaSaving(true);

  try {
    const response = await fetch("/api/schema", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state.draftSchema),
    });

    const schema = await responseJson(response);
    const changes = describeBuilderChanges(previousSchema, schema);

    applyLoadedSchema(schema, {
      resetRecord: !automatic,
      preservePage: true,
      builderSave: true,
    });

    if (automatic) {
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      elements.builderSaveState.dataset.dirty = "false";
      elements.builderSaveState.textContent = scText`حُفظ التصميم تلقائيًا عند ${time}.`;
    } else {
      showToast(schema.workbook_sync_pending
        ? scText("تم حفظ التصميم، ويجري تحديث ملف Excel في الخلفية.")
        : scText("تم حفظ تصميم التطبيق وتحديث ملف Excel."));
    }

    rememberBuilderHistory(
      state.activeSchemaId,
      schema.schema_name || state.schema?.schema_name || scText("التصميم"),
      changes,
      automatic,
    );

    return true;
  } catch (error) {
    reportClientError(automatic ? "schema-autosave" : "schema-save", error);
    if (automatic) {
      state.dirty = true;

      elements.builderSaveState.dataset.dirty = "true";
      elements.builderSaveState.textContent = scText`تعذّر الحفظ التلقائي: ${error.message}`;
    } else {
      showToast(error.message, "error");
    }

    return false;
  } finally {
    setSchemaSaving(false);
  }
}
async function autosaveBuilder() {
  if (
    state.closing ||
    state.mode !== "builder" ||
    state.builderScope !== "schema" ||
    !state.dirty ||
    state.savingSchema ||
    !state.draftSchema
  ) {
    return;
  }

  await saveSchema({
    automatic: true,
  });
}

async function createBackup() {
  if (state.backingUp || state.savingSchema) {
    return;
  }
  state.backingUp = true;
  elements.backupButton.disabled = true;
  try {
    const response = await fetch("/api/backup", { method: "POST" });
    const result = await responseJson(response);
    const download = document.createElement("a");
    download.href = result.download_url;
    download.download = result.filename;
    document.body.append(download);
    download.click();
    download.remove();
    showToast(scText`تم إنشاء النسخة الاحتياطية: ${result.filename}`);
  } catch (error) {
    reportClientError("backup-create", error);

    showToast(error.message, "error");
  } finally {
    state.backingUp = false;
    elements.backupButton.disabled = state.savingSchema;
  }
}

async function discardSchemaChanges() {
  if (!state.dirty) {
    return;
  }
  if (!(await requestConfirmation(scText("هل تريد تجاهل جميع تغييرات التصميم غير المحفوظة؟"), {
    title: scText("تجاهل تغييرات التصميم"),
    confirmLabel: scText("تجاهل التغييرات"),
  }))) {
    return;
  }
  state.draftSchema = deepClone(state.schema);
  markClean();
  renderBuilder();
}
