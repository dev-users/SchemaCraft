function definitionPayload(item, kind) {
  const clone = deepClone(item);
  delete clone.id;
  delete clone.global_ref;
  if (kind === "category") {
    delete clone.parent_category_id;
    delete clone.anchor_field_id;
    delete clone.global_tree_ref;
    delete clone.global_tree_key;
    clone.fields = (clone.fields || []).map((field) => {
      const definition = deepClone(field);
      delete definition.id;
      delete definition.global_ref;
      delete definition.global_tree_ref;
      delete definition.global_tree_key;
      return definition;
    });
  }
  return clone;
}

function globalCategoryFieldEntries(item) {
  const definition = item?.definition || item || {};
  const root = Array.isArray(definition.category_tree)
    ? (definition.category_tree.find((node) => !node.parent_key) || definition.category_tree[0])
    : null;
  if (root) return (root.fields || []).map((entry, index) => ({ key: entry.key || `field-${index + 1}`, definition: entry.definition || entry }));
  return (definition.fields || []).map((field, index) => ({ key: `legacy-${index + 1}`, definition: field }));
}

function globalCategoryAllFieldEntries(item) {
  const definition = item?.definition || item || {};
  return globalCategoryTree(definition).flatMap((node) => (node.fields || []).map((entry) => ({
    key: entry.key,
    nodeKey: node.key,
    categoryLabel: displayLabel(node.definition) || displayLabel(definition) || scText("فئة عامة"),
    definition: entry.definition || entry,
  })));
}

function globalEmbeddedFieldTargetId(categoryRef, fieldKey) {
  return `global-embedded-${categoryRef}-${String(fieldKey).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function globalCategoryEditorParents(excludedGlobalRef = "") {
  const categories = [];
  const targets = new Map();
  Object.entries(state.globalDefinitions?.categories || {}).forEach(([globalRef, item]) => {
    if (globalRef === excludedGlobalRef) return;
    const definition = item?.definition || {};
    const rawTree = Array.isArray(definition.category_tree) && definition.category_tree.length
      ? definition.category_tree
      : [{
          key: "category-1",
          parent_key: "",
          definition,
          fields: (definition.fields || []).map((field, index) => ({ key: `category-1-field-${index + 1}`, definition: field })),
        }];
    const categoryIds = new Map(rawTree.map((node) => [node.key, `global-parent-${globalRef}-${node.key}`]));
    const fieldIds = new Map();
    rawTree.forEach((node) => (node.fields || []).forEach((field) => {
      fieldIds.set(field.key, `global-parent-field-${globalRef}-${field.key}`);
    }));
    rawTree.forEach((node) => {
      const id = categoryIds.get(node.key);
      categories.push({
        ...deepClone(node.definition || {}),
        id,
        label: displayLabel(node.definition) || displayLabel(definition) || scText("فئة عامة"),
        fields: (node.fields || []).map((field) => {
          const result = {...deepClone(field.definition || field), id:fieldIds.get(field.key)};
          SCAlertMessageFields.remapOwner(result, fieldIds);
    SCFinance.remapOwner(result,fieldIds,categoryIds);
          if (result.composition?.field_keys) { result.composition.field_ids = result.composition.field_keys.map(key=>fieldIds.get(key)||''); delete result.composition.field_keys; }
          if (result.type === 'field_group') { result.field_ids = (result.field_keys || []).map(key=>fieldIds.get(key)).filter(Boolean); delete result.field_keys; }
          return result;
        }),
        parent_category_id: categoryIds.get(node.parent_key) || null,
      });
      SCAlertMessageFields.remapOwner(categories[categories.length-1], fieldIds);
    SCFinance.remapOwner(categories[categories.length-1],fieldIds,categoryIds);
      targets.set(id, {
        globalRef,
        nodeKey: node.key,
        fieldKeys: new Map((node.fields || []).map((field) => [fieldIds.get(field.key), field.key])),
      });
    });
  });
  return { categories, targets };
}

function categoryTreeDefinition(rootId, schema = state.draftSchema) {
  const included = [];
  const visit = (categoryId) => {
    const category = categoryById(categoryId, schema);
    if (!category || included.includes(category)) return;
    included.push(category);
    categoryChildren(category.id, schema).forEach((child) => visit(child.id));
  };
  visit(rootId);
  const categoryKeys = new Map(included.map((category, index) => [category.id, `category-${index + 1}`]));
  const fieldKeys = new Map();
  included.forEach((category, categoryIndex) => {
    (category.fields || []).forEach((field, fieldIndex) => {
      fieldKeys.set(field.id, `category-${categoryIndex + 1}-field-${fieldIndex + 1}`);
    });
  });
  const cleanField = (field) => {
    const definition = deepClone(field);
    delete definition.id;
    delete definition.global_ref;
    delete definition.global_tree_ref;
    delete definition.global_tree_key;
    SCAlertMessageFields.remapOwner(definition, fieldKeys);
    SCFinance.remapOwner(definition,fieldKeys,categoryKeys);
    if (definition.composition) { definition.composition.field_keys = definition.composition.field_ids.map(id=>fieldKeys.get(id)||''); delete definition.composition.field_ids; }
    if (definition.type === 'field_group') {
      definition.field_keys = (definition.field_ids || []).map(id => fieldKeys.get(id) || '');
      delete definition.field_ids;
    }
    if (definition.option_filter?.source_field_id) {
      definition.option_filter.source_field_key = fieldKeys.get(definition.option_filter.source_field_id) || "";
      delete definition.option_filter.source_field_id;
    }
    if (definition.validation?.compare_field_id) {
      definition.validation.compare_field_key = fieldKeys.get(definition.validation.compare_field_id) || "";
      delete definition.validation.compare_field_id;
    }
    if (definition.related_person_source_field_id) {
      definition.related_person_source_field_key = fieldKeys.get(definition.related_person_source_field_id) || "";
      delete definition.related_person_source_field_id;
    }
    if (definition.file_naming?.parts) {
      definition.file_naming.parts = definition.file_naming.parts.map((part) => ({
        ...part,
        field_key: fieldKeys.get(part.field_id) || "",
        field_id: undefined,
      }));
    }
    return definition;
  };
  const tree = included.map((category) => {
    const definition = definitionPayload(category, "category");
    SCAlertMessageFields.remapOwner(definition, fieldKeys);
    SCFinance.remapOwner(definition,fieldKeys,categoryKeys);
    delete definition.fields;
    return {
      key: categoryKeys.get(category.id),
      parent_key: categoryKeys.get(category.parent_category_id) || "",
      anchor_field_key: fieldKeys.get(category.anchor_field_id) || "",
      parent_field_key: fieldKeys.get(category.parent_field_id) || "",
      definition,
      fields: (category.fields || []).map((field) => ({
        key: fieldKeys.get(field.id),
        definition: cleanField(field),
      })),
    };
  });
  const root = definitionPayload(categoryById(rootId, schema), "category");
  SCAlertMessageFields.remapOwner(root, fieldKeys);
    SCFinance.remapOwner(root,fieldKeys,categoryKeys);
  root.fields = (categoryById(rootId, schema).fields || []).map(cleanField);
  const groupKeys = new Map();
  const conditions = (schema.conditions || []).flatMap((condition, index) => {
    const sourceFieldKey = fieldKeys.get(condition.source_field_id);
    const targetKey = condition.target_type === "category"
      ? categoryKeys.get(condition.target_id)
      : fieldKeys.get(condition.target_id);
    if (!sourceFieldKey || !targetKey) return [];
    const rawGroup = condition.group_id || `condition-group-${index + 1}`;
    if (!groupKeys.has(rawGroup)) groupKeys.set(rawGroup, `group-${groupKeys.size + 1}`);
    return [{
      key: `condition-${index + 1}`,
      group_key: groupKeys.get(rawGroup),
      negate: Boolean(condition.negate),
      target_type: condition.target_type,
      target_key: targetKey,
      source_field_key: sourceFieldKey,
      ...(condition.compare_field_id ? {compare_field_key: fieldKeys.get(condition.compare_field_id) || condition.compare_field_id} : {}),
      operator: condition.operator,
      value: deepClone(condition.value ?? ""),
    }];
  });
  delete root.conditions;
  root.category_tree = tree;
  root.conditions = conditions;
  return { definition: root, categoryKeys, fieldKeys, included };
}

function globalCategoryTree(definition = {}) {
  if (Array.isArray(definition.category_tree) && definition.category_tree.length) {
    return deepClone(definition.category_tree);
  }
  return [{
    key: "category-1",
    parent_key: "",
    anchor_field_key: "",
    definition: definitionPayload(definition, "category"),
    fields: (definition.fields || []).map((field, index) => ({
      key: `category-1-field-${index + 1}`,
      definition: deepClone(field),
    })),
  }];
}

function restoredGlobalCategoryConditions(definition, categoryIds, fieldIds) {
  const groups = new Map();
  return (definition.conditions || []).flatMap((condition, index) => {
    const sourceFieldId = fieldIds.get(condition.source_field_key);
    const targetId = condition.target_type === "category"
      ? categoryIds.get(condition.target_key)
      : fieldIds.get(condition.target_key);
    if (!sourceFieldId || !targetId) return [];
    const groupKey = condition.group_key || condition.key || `group-${index + 1}`;
    if (!groups.has(groupKey)) groups.set(groupKey, randomDefinitionId("grp"));
    return [{
      id: randomDefinitionId("cond"),
      group_id: groups.get(groupKey),
      negate: Boolean(condition.negate),
      target_type: condition.target_type,
      target_id: targetId,
      source_field_id: sourceFieldId,
      ...(condition.compare_field_key ? {compare_field_id: fieldIds.get(condition.compare_field_key) || condition.compare_field_key} : {}),
      operator: condition.operator || "equals",
      value: deepClone(condition.value ?? ""),
      global_tree_ref: definition.global_ref || "",
      global_condition_key: condition.key || `condition-${index + 1}`,
    }];
  });
}

function materializeGlobalCategoryPackage(globalRef, definition) {
  const tree = globalCategoryTree(definition);
  const categoryIds = new Map(tree.map((node) => [node.key, randomDefinitionId("cat")]));
  const fieldIds = new Map();
  tree.forEach((node) => (node.fields || []).forEach((field) => {
    fieldIds.set(field.key, randomDefinitionId("fld"));
  }));
  const categories = tree.map((node) => ({
    ...deepClone(node.definition || {}),
    id: categoryIds.get(node.key),
    fields: (node.fields || []).map((field) => ({
      ...deepClone(field.definition || field),
      id: fieldIds.get(field.key),
    })),
    parent_category_id: categoryIds.get(node.parent_key) || null,
    anchor_field_id: fieldIds.get(node.anchor_field_key) || null,
    parent_field_id: fieldIds.get(node.parent_field_key) || null,
  }));
  for (const category of categories) for (const subject of [category, ...category.fields]) SCAlertMessageFields.remapOwner(subject, fieldIds);
  for (const category of categories) for (const subject of [category, ...category.fields]) SCFinance.remapOwner(subject,fieldIds,categoryIds);
  for (const category of categories) for (const field of category.fields) {
    if (field.composition?.field_keys) { field.composition.field_ids = field.composition.field_keys.map(key=>fieldIds.get(key)||''); delete field.composition.field_keys; }
    if (field.type === 'field_group') {
      field.field_ids = (field.field_keys || []).map(key => fieldIds.get(key) || '');
      delete field.field_keys;
    }
  }
  const rootNode = tree.find((node) => !node.parent_key) || tree[0];
  return {
    tree,
    categoryIds,
    fieldIds,
    categories,
    rootCategoryId: categoryIds.get(rootNode.key),
    conditions: restoredGlobalCategoryConditions(
      { ...definition, global_ref: globalRef },
      categoryIds,
      fieldIds,
    ),
  };
}

function openGlobalCategoryPackageEditor(kind, globalRef, options = {}) {
  const definition = deepClone(state.globalDefinitions?.categories?.[globalRef]?.definition || null);
  if (!definition) return;
  const originalDraft = deepClone(state.draftSchema);
  const originalDirty = state.dirty;
  const packageDraft = materializeGlobalCategoryPackage(globalRef, definition);
  state.draftSchema = {
    ...deepClone(state.schema),
    categories: packageDraft.categories,
    conditions: packageDraft.conditions,
  };
  state.globalEditor = {
    kind,
    globalRef,
    packageMode: true,
    rootCategoryId: packageDraft.rootCategoryId,
    originalDraft,
    originalDirty,
    isNew: Boolean(options.newChild || options.newField),
  };
  if (elements.builderGlobalSaveState) {
    elements.builderGlobalSaveState.textContent = scText("توجد تغييرات في الحوار لم تُحفظ بعد.");
  }
  const categoryId = packageDraft.categoryIds.get(options.nodeKey)
    || packageDraft.rootCategoryId;
  if (kind === "category") {
    if (options.newChild) {
      const child = {
        id: randomDefinitionId("cat"),
        fields: [],
        label: scText("فئة عامة فرعية جديدة"),
        description: "",
        kind: "main",
        add_label: "",
        auto_start: false,
        related_person_enabled: false,
        parent_category_id: categoryId,
        anchor_field_id: null,
      };
      state.draftSchema.categories.push(child);
      openCategoryDialog(child.id);
    } else {
      openCategoryDialog(categoryId);
    }
    if (elements.globalCategoryConnectChoice) elements.globalCategoryConnectChoice.hidden = true;
    return;
  }
  const fieldId = packageDraft.fieldIds.get(options.fieldKey) || null;
  openFieldDialog(categoryId, fieldId, false, options.afterFieldKey ? (packageDraft.fieldIds.get(options.afterFieldKey) || options.afterFieldKey) : null);
  if (elements.globalFieldConnectChoice) elements.globalFieldConnectChoice.hidden = true;
}

async function commitGlobalCategoryPackageFromEditor(kind, item, editor) {
  const serialized = categoryTreeDefinition(editor.rootCategoryId, state.draftSchema).definition;
  const placement = kind === "category" && item.id === editor.rootCategoryId && !item.parent_category_id ? elements.categoryPlacement.value : null;
  const historyAction = editor.isNew ? "added" : "updated";
  const historyLabel = item?.label || scText("تعريف عام");
  restoreGlobalEditor();
  try {
    const result = await saveGlobalDefinition("category", editor.globalRef, serialized);
    await placeGlobalDefinition("category", editor.globalRef, placement);
    if (result.updated_schema_ids?.length) await refreshAdvancedWorkspace({ reloadSchema: result.updated_schema_ids.includes(state.activeSchemaId) });
    renderGlobalDefinitions();
    rememberBuilderHistory("__global__", scText("التعريفات العامة"), [{
      kind,
      action: historyAction,
      label: historyLabel,
      global_ref: editor.globalRef,
    }]);
    state.builderScope = "global";
    renderBuilderScope();
    updateGeneralSaveState();
    showToast(scText("تم تطبيق التغيير في المسودة العامة. اضغط حفظ التغييرات لاعتماده."));
  } catch (error) {
    if (elements.builderGlobalSaveState) elements.builderGlobalSaveState.textContent = scText("تعذّر حفظ آخر تغيير عام.");
    showToast(error.message, "error");
  }
}

function applyTreeLinkMetadata(treeInfo, globalRef) {
  treeInfo.included.forEach((category) => {
    category.global_tree_ref = globalRef;
    category.global_tree_key = treeInfo.categoryKeys.get(category.id);
    if (category.id === treeInfo.included[0].id) category.global_ref = globalRef;
    (category.fields || []).forEach((field) => {
      field.global_tree_ref = globalRef;
      field.global_tree_key = treeInfo.fieldKeys.get(field.id);
    });
  });
}

async function refreshAdvancedWorkspace({ reloadSchema = false } = {}) {
  await loadWorkspaceMetadata();
  if (reloadSchema) await loadSchema({ preservePage: true, resetRecord: false, builderSave:state.mode === "builder" });
  renderGlobalDefinitions();
  renderWorkspaceChrome();
}

async function placeGlobalDefinition(kind, ref, placement) {
  if (!placement) return;
  const collection = state.globalDefinitions[kind === "category" ? "categories" : "fields"];
  const keys = Object.keys(collection).filter(key => key !== ref);
  let index = keys.length;
  if (placement === "start") index = 0;
  else if (kind === "category" && placement.startsWith("before:")) {
    const found = keys.indexOf(placement.slice(7));
    if (found >= 0) index = found;
  } else if (keys.includes(placement)) index = keys.indexOf(placement) + 1;
  keys.splice(index, 0, ref);
  if (JSON.stringify(keys) === JSON.stringify(Object.keys(collection))) return;
  const result = await requestGlobalDefinitionMutation({action:"reorder_all", kind, order:keys});
  state.globalDefinitions = result.global_definitions;
}

async function saveGlobalDefinition(kind, globalRef, definition) {
  const result = await requestGlobalDefinitionMutation({action:'save',kind,global_ref:globalRef,definition});
  state.globalDefinitions = result.global_definitions;
  return result;
}

async function publishLocalDefinition(kind, itemId) {
  const item = kind === "category" ? categoryById(itemId) : fieldById(itemId);
  if (!item || !builderUnlocked()) return;
  const globalRef = randomDefinitionId(kind === "category" ? "gcat" : "gfld");
  const treeInfo = kind === "category" ? categoryTreeDefinition(itemId) : null;
  if (treeInfo) applyTreeLinkMetadata(treeInfo, globalRef);
  else item.global_ref = globalRef;
  markDirty();
  if (!(await saveSchema())) {
    if (treeInfo) {
      treeInfo.included.forEach((category) => {
        category.global_ref = null;
        category.global_tree_ref = null;
        category.global_tree_key = null;
        (category.fields || []).forEach((field) => {
          field.global_tree_ref = null;
          field.global_tree_key = null;
        });
      });
    } else item.global_ref = null;
    return;
  }
  try {
    await saveGlobalDefinition(
      kind,
      globalRef,
      treeInfo?.definition || definitionPayload(item, kind),
    );
    if (generalDraftDirty() && !(await saveGeneralDefinitions())) throw new Error(scText("لم يكتمل حفظ التعريف العام."));
    await refreshAdvancedWorkspace({ reloadSchema: true });
    showToast(scText("تم إنشاء التعريف العام وربط العنصر الحالي به."));
  } catch (error) {
    const local = kind === "category" ? categoryById(itemId) : fieldById(itemId);
    if (treeInfo) {
      treeInfo.included.forEach((category) => {
        category.global_ref = null;
        category.global_tree_ref = null;
        category.global_tree_key = null;
        (category.fields || []).forEach((field) => {
          field.global_tree_ref = null;
          field.global_tree_key = null;
        });
      });
    } else if (local) local.global_ref = null;
    markDirty();
    await saveSchema();
    showToast(error.message, "error");
  }
}

function restoreGlobalEditor() {
  if (!state.globalEditor) return;
  state.draftSchema = state.globalEditor.originalDraft;
  state.dirty = state.globalEditor.originalDirty;
  state.globalEditor = null;
  updateGeneralSaveState();
  renderBuilder();
}

function openGlobalDefinitionEditor(kind, globalRef = "", options = {}) {
  const collection = kind === "category" ? state.globalDefinitions.categories : state.globalDefinitions.fields;
  let definition = deepClone(collection?.[globalRef]?.definition || null);
  if (kind === "category" && globalRef && definition && !options.parentCategoryRef) {
    const root = globalCategoryTree(definition).find((node) => !node.parent_key)
      || globalCategoryTree(definition)[0];
    openGlobalCategoryPackageEditor("category", globalRef, { nodeKey: root?.key });
    return;
  }
  if (kind === "field" && options.parentCategoryRef && options.parentFieldKey) {
    definition = deepClone(globalCategoryFieldEntries(state.globalDefinitions.categories?.[options.parentCategoryRef]).find((entry) => entry.key === options.parentFieldKey)?.definition || null);
  }
  const originalDraft = deepClone(state.draftSchema);
  const originalDirty = state.dirty;
  state.globalEditor = {
    kind,
    globalRef: globalRef || randomDefinitionId(kind === "category" ? "gcat" : "gfld"),
    parentCategoryRef: options.parentCategoryRef || "",
    parentFieldKey: options.parentFieldKey || "",
    isNew: !globalRef && !options.parentFieldKey,
    originalDraft,
    originalDirty,
  };
  if (elements.builderGlobalSaveState) elements.builderGlobalSaveState.textContent = scText("توجد تغييرات في الحوار لم تُحفظ بعد.");
  if (kind === "category") {
    const parentCandidates = globalCategoryEditorParents(globalRef);
    state.globalEditor.parentTargets = parentCandidates.targets;
    const category = {
      id: randomDefinitionId("cat"),
      fields: [],
      label: scText("فئة عامة جديدة"),
      description: "",
      kind: "main",
      add_label: "",
      auto_start: false,
      related_person_enabled: false,
      parent_category_id: null,
      anchor_field_id: null,
      ...(definition || {}),
    };
    state.draftSchema = {
      ...deepClone(state.schema),
      categories: [...parentCandidates.categories, category],
      conditions: [],
    };
    openCategoryDialog(category.id);
    if (elements.globalCategoryConnectChoice) {
      elements.globalCategoryConnectChoice.hidden = !state.globalEditor.isNew;
      elements.globalCategoryConnectActive.checked = false;
    }
  } else {
    const field = {
      id: randomDefinitionId("fld"),
      label: scText("حقل عام جديد"),
      type: "text",
      required: false,
      placeholder: "",
      width: "1",
      options: [],
      searchable: false,
      search_match: "contains",
      show_in_results: false,
      result_title: false,
      unique: false,
      validation: {},
      ...(definition || {}),
    };
    const category = {
      id: randomDefinitionId("cat"),
      label: scText("محرر التعريف العام"),
      kind: "main",
      description: "",
      fields: [field],
    };
    state.draftSchema = { ...deepClone(state.schema), categories: [category], conditions: [] };
    openFieldDialog(category.id, field.id);
    if (!options.parentCategoryRef) {
      elements.fieldCategoryName.replaceChildren(new Option(scText("الحقول العامة المنفصلة"), state.editingFieldCategoryId));
      elements.fieldCategoryName.value = state.editingFieldCategoryId;
      const fields = Object.entries(state.globalDefinitions.fields || {}).map(([id, item]) => ({...item.definition, id}));
      fillFieldPlacementSelect(elements.fieldAfter, fields, state.globalEditor.isNew ? null : state.globalEditor.globalRef, options.placement ?? null);
    }
    if (elements.globalFieldConnectChoice) {
      elements.globalFieldConnectChoice.hidden = !state.globalEditor.isNew || Boolean(options.parentCategoryRef);
      elements.globalFieldConnectActive.checked = false;
    }
  }
}

async function commitGlobalDefinitionFromEditor(kind, item) {
  const editor = state.globalEditor;
  if (!editor) return;
  if (editor.packageMode) {
    await commitGlobalCategoryPackageFromEditor(kind, item, editor);
    return;
  }
  const payload = definitionPayload(item, kind);
  const placement = kind === "field" ? elements.fieldAfter.value : elements.categoryPlacement.value;
  const selectedGlobalParent = kind === "category"
    ? editor.parentTargets?.get(item.parent_category_id)
    : null;
  const existingCategoryDefinition = kind === "category" && !editor.isNew
    ? deepClone(state.globalDefinitions.categories?.[editor.globalRef]?.definition || null)
    : null;
  const parentCategoryRef = editor.parentCategoryRef;
  const parentFieldKey = editor.parentFieldKey;
  const historyAction = editor.isNew ? "added" : "updated";
  const historyGlobalRef = editor.globalRef || parentCategoryRef || "";
  const historyLabel = item.label || item.definition?.label || scText("تعريف عام");
  const connectToActive = kind === "category"
    ? Boolean(elements.globalCategoryConnectActive?.checked)
    : Boolean(elements.globalFieldConnectActive?.checked);
  restoreGlobalEditor();
  try {
    if (kind === "category" && selectedGlobalParent) {
      const parentItem = state.globalDefinitions.categories?.[selectedGlobalParent.globalRef];
      if (!parentItem?.definition) throw new Error(scText("تعذّر العثور على الفئة العامة الأم."));
      const parentDefinition = deepClone(parentItem.definition);
      let tree = Array.isArray(parentDefinition.category_tree) && parentDefinition.category_tree.length
        ? parentDefinition.category_tree
        : [{
            key: "category-1",
            parent_key: "",
            anchor_field_key: "",
            definition: definitionPayload(parentDefinition, "category"),
            fields: (parentDefinition.fields || []).map((field, index) => ({
              key: `category-1-field-${index + 1}`,
              definition: deepClone(field),
            })),
          }];
      const sourceTree = existingCategoryDefinition?.category_tree?.length
        ? deepClone(existingCategoryDefinition.category_tree)
        : [{
            key: "category-1",
            parent_key: "",
            anchor_field_key: "",
            definition: deepClone(payload),
            fields: (payload.fields || []).map((field, index) => ({ key: `category-1-field-${index + 1}`, definition: deepClone(field) })),
          }];
      const sourceRoot = sourceTree.find((node) => !node.parent_key) || sourceTree[0];
      const keyPrefix = `category-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const categoryKeys = new Map(sourceTree.map((node, index) => [node.key, `${keyPrefix}-${index + 1}`]));
      const fieldKeys = new Map();
      sourceTree.forEach((node, categoryIndex) => (node.fields || []).forEach((field, fieldIndex) => {
        fieldKeys.set(field.key, `${keyPrefix}-${categoryIndex + 1}-field-${fieldIndex + 1}`);
      }));
      const remapMovedField = (rawField) => {
        const field = deepClone(rawField);
        SCAlertMessageFields.remapOwner(field, fieldKeys);
    SCFinance.remapOwner(field,fieldKeys,categoryKeys);
        if (field.composition?.field_keys) field.composition.field_keys = field.composition.field_keys.map(key=>fieldKeys.get(key)||'');
        if (field.type === 'field_group') field.field_keys = (field.field_keys || []).map(key => fieldKeys.get(key) || '');
        if (field.option_filter?.source_field_key) field.option_filter.source_field_key = fieldKeys.get(field.option_filter.source_field_key) || "";
        if (field.validation?.compare_field_key) field.validation.compare_field_key = fieldKeys.get(field.validation.compare_field_key) || "";
        if (field.related_person_source_field_key) field.related_person_source_field_key = fieldKeys.get(field.related_person_source_field_key) || "";
        if (field.file_naming?.parts) field.file_naming.parts = field.file_naming.parts.map((part) => ({
          ...part,
          field_key: fieldKeys.get(part.field_key) || "",
        }));
        return field;
      };
      const editedRoot = deepClone(payload);
      delete editedRoot.fields;
      delete editedRoot.category_tree;
      const movedNodes = sourceTree.map((node) => ({
        key: categoryKeys.get(node.key),
        parent_key: node === sourceRoot
          ? selectedGlobalParent.nodeKey
          : categoryKeys.get(node.parent_key) || selectedGlobalParent.nodeKey,
        parent_field_key: fieldKeys.get(node.parent_field_key) || "",
        anchor_field_key: node === sourceRoot
          ? selectedGlobalParent.fieldKeys.get(item.parent_field_id) || ""
          : fieldKeys.get(node.anchor_field_key) || "",
        definition: SCFinance.remapOwner(SCAlertMessageFields.remapOwner(node === sourceRoot ? deepClone(editedRoot) : deepClone(node.definition || {}), fieldKeys),fieldKeys,categoryKeys),
        fields: (node === sourceRoot && payload.fields
          ? payload.fields.map((field, index) => ({ key: `edited-root-field-${index + 1}`, definition: deepClone(field) }))
          : (node.fields || [])
        ).map((field, index) => ({
          key: node === sourceRoot && payload.fields
            ? `${categoryKeys.get(node.key)}-field-${index + 1}`
            : fieldKeys.get(field.key),
          definition: remapMovedField(field.definition || field),
        })),
      }));
      tree.push(...movedNodes);
      parentDefinition.category_tree = tree;
      const movedConditions = (existingCategoryDefinition?.conditions || []).flatMap((condition, index) => {
        const sourceFieldKey = fieldKeys.get(condition.source_field_key);
        const targetKey = condition.target_type === "category"
          ? categoryKeys.get(condition.target_key)
          : fieldKeys.get(condition.target_key);
        if (!sourceFieldKey || !targetKey) return [];
        return [{
          ...deepClone(condition),
          key: `${keyPrefix}-condition-${index + 1}`,
          group_key: `${keyPrefix}-${condition.group_key || `group-${index + 1}`}`,
          source_field_key: sourceFieldKey,
          ...(condition.compare_field_key ? {compare_field_key: fieldKeys.get(condition.compare_field_key) || condition.compare_field_key} : {}),
          target_key: targetKey,
        }];
      });
      parentDefinition.conditions = [
        ...(parentDefinition.conditions || []),
        ...movedConditions,
      ];
      await saveGlobalDefinition("category", selectedGlobalParent.globalRef, parentDefinition);
      if (!editor.isNew) {
        const result = await requestGlobalDefinitionMutation({action:'delete',kind:'category',global_ref:editor.globalRef});
        state.globalDefinitions = result.global_definitions;
      }
    } else if (kind === "field" && parentCategoryRef) {
      const categoryItem = state.globalDefinitions.categories?.[parentCategoryRef];
      if (!categoryItem?.definition) throw new Error(scText("تعذّر العثور على الفئة العامة."));
      const categoryDefinition = deepClone(categoryItem.definition);
      if (Array.isArray(categoryDefinition.category_tree) && categoryDefinition.category_tree.length) {
        const rootNode = categoryDefinition.category_tree.find((node) => !node.parent_key) || categoryDefinition.category_tree[0];
        const fields = [...(rootNode.fields || [])];
        const existingIndex = fields.findIndex((entry) => entry.key === parentFieldKey);
        if (existingIndex >= 0) fields[existingIndex] = { ...fields[existingIndex], definition: payload };
        else fields.push({ key: `global-field-${Date.now()}`, definition: payload });
        rootNode.fields = fields;
        categoryDefinition.fields = fields.map((entry) => deepClone(entry.definition || entry));
      } else {
        const fields = [...(categoryDefinition.fields || [])];
        const legacyIndex = parentFieldKey.startsWith("legacy-") ? Number(parentFieldKey.slice(7)) - 1 : -1;
        if (legacyIndex >= 0 && fields[legacyIndex]) fields[legacyIndex] = payload;
        else fields.push(payload);
        categoryDefinition.fields = fields;
      }
      const result = await saveGlobalDefinition("category", parentCategoryRef, categoryDefinition);
      if (result.updated_schema_ids?.length) await refreshAdvancedWorkspace({ reloadSchema: result.updated_schema_ids.includes(state.activeSchemaId) });
    } else {
      const result = await saveGlobalDefinition(kind, editor.globalRef, payload);
      await placeGlobalDefinition(kind, editor.globalRef, placement);
      if (result.updated_schema_ids?.length) await refreshAdvancedWorkspace({ reloadSchema: result.updated_schema_ids.includes(state.activeSchemaId) });
    }
    renderGlobalDefinitions();
    rememberBuilderHistory("__global__", scText("التعريفات العامة"), [{
      kind,
      action: historyAction,
      label: historyLabel,
      global_ref: parentCategoryRef || selectedGlobalParent ? "" : historyGlobalRef,
      parent_global_ref: parentCategoryRef || selectedGlobalParent?.globalRef || "",
      parent_field_key: parentFieldKey || "",
    }]);
    state.builderScope = "global";
    renderBuilderScope();
    if (connectToActive && !parentCategoryRef && !selectedGlobalParent) addGlobalDefinitionToSchema(kind, editor.globalRef);
    updateGeneralSaveState();
    showToast(
      selectedGlobalParent
        ? scText("أُضيفت الفئة الفرعية مع حقولها إلى الفئة العامة الأم.")
        : parentCategoryRef
          ? scText("أُضيف الحقل داخل الفئة العامة.")
          : scText("تم تطبيق التغيير في المسودة العامة. اضغط حفظ التغييرات لاعتماده."),
    );
  } catch (error) {
    if (elements.builderGlobalSaveState) elements.builderGlobalSaveState.textContent = scText("تعذّر حفظ آخر تغيير عام.");
    showToast(error.message, "error");
  }
}

async function saveGlobalCategoryTreeMutation(categoryRef, definition, change) {
  const tree = globalCategoryTree(definition);
  const root = tree.find((node) => !node.parent_key) || tree[0];
  definition.category_tree = tree;
  definition.fields = (root?.fields || []).map((entry) => deepClone(entry.definition || entry));
  try {
    const result = await saveGlobalDefinition("category", categoryRef, definition);
    rememberBuilderHistory("__global__", scText("التعريفات العامة"), [change]);
    renderGlobalDefinitions();
    if (result.updated_schema_ids?.length) await refreshAdvancedWorkspace({ reloadSchema: result.updated_schema_ids.includes(state.activeSchemaId) });
    showToast(change.message || scText("تم تحديث الفئة العامة."));
  } catch (error) {
    showToast(error.message, "error");
  }
}

function removeGlobalConditionsForKeys(definition, categoryKeys, fieldKeys) {
  definition.conditions = (definition.conditions || []).filter((condition) => {
    if (fieldKeys.has(condition.source_field_key)) return false;
    return condition.target_type === "category"
      ? !categoryKeys.has(condition.target_key)
      : !fieldKeys.has(condition.target_key);
  });
}

async function updateEmbeddedGlobalField(categoryRef, nodeKey, fieldKey, action) {
  const categoryItem = state.globalDefinitions.categories?.[categoryRef];
  if (!categoryItem?.definition) return;
  const definition = deepClone(categoryItem.definition);
  const tree = globalCategoryTree(definition);
  const node = tree.find((candidate) => candidate.key === nodeKey);
  if (!node) return;
  const fields = [...(node.fields || [])];
  const index = fields.findIndex((entry) => entry.key === fieldKey);
  if (index < 0) return;
  const historyLabel = fields[index]?.definition?.label || scText("حقل عام");
  if (action === "delete") {
    if (!(await requestConfirmation(scText("حذف هذا الحقل من الفئة العامة؟"), {
      title: scText("حذف حقل عام"),
      confirmLabel: scText("حذف الحقل"),
    }))) return;
    fields.splice(index, 1);
    removeGlobalConditionsForKeys(definition, new Set(), new Set([fieldKey]));
  } else {
    const target = action === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
  }
  node.fields = fields;
  definition.category_tree = tree;
  await saveGlobalCategoryTreeMutation(categoryRef, definition, {
    kind: "field",
    action: action === "delete" ? "removed" : "updated",
    label: historyLabel,
    parent_global_ref: categoryRef,
    parent_field_key: fieldKey,
    message: action === "delete" ? scText("حُذف الحقل من الفئة العامة.") : scText("تغيّر ترتيب الحقل."),
  });
}

async function updateGlobalCategoryNode(categoryRef, nodeKey, action) {
  const categoryItem = state.globalDefinitions.categories?.[categoryRef];
  if (!categoryItem?.definition) return;
  const definition = deepClone(categoryItem.definition);
  const tree = globalCategoryTree(definition);
  const node = tree.find((candidate) => candidate.key === nodeKey);
  const root = tree.find((candidate) => !candidate.parent_key) || tree[0];
  if (!node || node === root) return;
  const historyLabel = node.definition?.label || scText("فئة عامة");
  if (action === "delete") {
    if (!(await requestConfirmation(scText("حذف هذه الفئة الفرعية وحقولها وفئاتها المتداخلة؟"), {
      title: scText("حذف فئة عامة فرعية"),
      confirmLabel: scText("حذف الفئة"),
    }))) return;
    const removedCategories = new Set([nodeKey]);
    let changed = true;
    while (changed) {
      changed = false;
      tree.forEach((candidate) => {
        if (removedCategories.has(candidate.parent_key) && !removedCategories.has(candidate.key)) {
          removedCategories.add(candidate.key);
          changed = true;
        }
      });
    }
    const removedFields = new Set(tree
      .filter((candidate) => removedCategories.has(candidate.key))
      .flatMap((candidate) => (candidate.fields || []).map((field) => field.key)));
    definition.category_tree = tree.filter((candidate) => !removedCategories.has(candidate.key));
    removeGlobalConditionsForKeys(definition, removedCategories, removedFields);
  } else {
    const siblings = tree.filter((candidate) => (candidate.parent_key || "") === (node.parent_key || ""));
    const index = siblings.indexOf(node);
    const targetIndex = action === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    const nodeIndex = tree.indexOf(node);
    const targetTreeIndex = tree.indexOf(target);
    [tree[nodeIndex], tree[targetTreeIndex]] = [tree[targetTreeIndex], tree[nodeIndex]];
    definition.category_tree = tree;
  }
  await saveGlobalCategoryTreeMutation(categoryRef, definition, {
    kind: "category",
    action: action === "delete" ? "removed" : "updated",
    label: historyLabel,
    parent_global_ref: categoryRef,
    message: action === "delete" ? scText("حُذفت الفئة الفرعية العامة.") : scText("تغيّر ترتيب الفئة الفرعية."),
  });
}

function openGlobalPackageConditionEditor(categoryRef, nodeKey, targetType, targetKey, conditionKey = "") {
  const definition = deepClone(state.globalDefinitions?.categories?.[categoryRef]?.definition || null);
  if (!definition) return;
  const originalDraft = deepClone(state.draftSchema);
  const originalDirty = state.dirty;
  const packageDraft = materializeGlobalCategoryPackage(categoryRef, definition);
  state.draftSchema = {
    ...deepClone(state.schema),
    categories: packageDraft.categories,
    conditions: packageDraft.conditions,
  };
  state.globalEditor = {
    kind: "condition",
    globalRef: categoryRef,
    packageMode: true,
    rootCategoryId: packageDraft.rootCategoryId,
    originalDraft,
    originalDirty,
    isNew: !conditionKey,
  };
  const targetId = targetType === "category"
    ? packageDraft.categoryIds.get(nodeKey)
    : packageDraft.fieldIds.get(targetKey);
  const conditionId = conditionKey
    ? state.draftSchema.conditions.find((condition) => condition.global_condition_key === conditionKey)?.id
    : null;
  openConditionDialog(conditionId || null, targetType, targetId);
  if (!elements.conditionDialog.open) restoreGlobalEditor();
}

async function deleteGlobalPackageCondition(categoryRef, conditionKey) {
  const item = state.globalDefinitions?.categories?.[categoryRef];
  if (!item?.definition || !(await requestConfirmation(scText("حذف شرط الظهور من الفئة العامة؟"), {
    title: scText("حذف شرط ظهور"),
    confirmLabel: scText("حذف الشرط"),
  }))) return;
  const definition = deepClone(item.definition);
  definition.conditions = (definition.conditions || []).filter((condition) => condition.key !== conditionKey);
  await saveGlobalCategoryTreeMutation(categoryRef, definition, {
    kind: "condition",
    action: "removed",
    label: scText("شرط ظهور"),
    parent_global_ref: categoryRef,
    message: scText("حُذف شرط الظهور العام."),
  });
}

async function deleteGlobalDefinition(kind, globalRef) {
  if (!(await requestConfirmation(
    scText("حذف التعريف من المكتبة العامة؟ تبقى النسخ المحلية الحالية في التصاميم مستقلة."),
    { title: scText("حذف تعريف عام"), confirmLabel: scText("حذف التعريف") },
  ))) return;
  const collection = kind === "category" ? state.globalDefinitions.categories : state.globalDefinitions.fields;
  const historyLabel = collection?.[globalRef]?.definition?.label || scText("تعريف عام");
  try {
    const result = await requestGlobalDefinitionMutation({action:'delete',kind,global_ref:globalRef});
    state.globalDefinitions = result.global_definitions;
    if (result.detached_schema_ids?.length) await refreshAdvancedWorkspace({reloadSchema:result.detached_schema_ids.includes(state.activeSchemaId)});
    rememberBuilderHistory("__global__", scText("التعريفات العامة"), [{
      kind,
      action: "removed",
      label: historyLabel,
      global_ref: globalRef,
    }]);
    renderGlobalDefinitions();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reorderGlobalDefinition(kind, globalRef, direction) {
  try {
    const result = await requestGlobalDefinitionMutation({action:'reorder',kind,global_ref:globalRef,direction});
    state.globalDefinitions = result.global_definitions;
    renderGlobalDefinitions();
    if (result.moved) {
      const collection = kind === "category" ? state.globalDefinitions.categories : state.globalDefinitions.fields;
      rememberBuilderHistory("__global__", scText("التعريفات العامة"), [{
        kind,
        action: "updated",
        label: collection?.[globalRef]?.definition?.label || scText("تعريف عام"),
        global_ref: globalRef,
      }]);
      showToast(scText("تغيّر ترتيب التعريف العام."));
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

function chooseGlobalCategoryContents(rawTree) {
  if (!elements.addGlobalCategoryDialog || !elements.addGlobalCategoryTree) {
    return Promise.resolve({
      categories: new Set(rawTree.map((node) => node.key)),
      fields: new Set(rawTree.flatMap((node) => (node.fields || []).map((field) => field.key))),
    });
  }
  const dialog = elements.addGlobalCategoryDialog;
  const tree = elements.addGlobalCategoryTree;
  tree.replaceChildren();
  const children = new Map();
  rawTree.forEach((node) => {
    const parentKey = node.parent_key || "";
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey).push(node);
  });
  const descendants = (key) => {
    const result = [];
    (children.get(key) || []).forEach((child) => {
      result.push(child.key, ...descendants(child.key));
    });
    return result;
  };
  const appendNode = (node, container, root = false) => {
    const group = document.createElement("details");
    group.className = "tree-option-group add-global-category-node";
    group.open = true;
    const summary = document.createElement("summary");
    const label = document.createElement("label");
    label.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.disabled = root;
    input.dataset.addGlobalCategoryKey = node.key;
    label.append(input, document.createTextNode(displayLabel(node.definition) || scText("فئة")));
    summary.append(label);
    const contents = document.createElement("div");
    contents.className = "search-field-option-grid add-global-category-children";
    (node.fields || []).forEach((field) => {
      const fieldLabel = document.createElement("label");
      fieldLabel.className = "check-field";
      const fieldInput = document.createElement("input");
      fieldInput.type = "checkbox";
      fieldInput.checked = true;
      fieldInput.dataset.addGlobalFieldKey = field.key;
      fieldInput.dataset.addGlobalFieldCategory = node.key;
      fieldLabel.append(fieldInput, document.createTextNode(displayLabel(field.definition) || scText("حقل")));
      contents.append(fieldLabel);
    });
    (children.get(node.key) || []).forEach((child) => appendNode(child, contents));
    input.addEventListener("change", () => {
      const affected = new Set([node.key, ...descendants(node.key)]);
      tree.querySelectorAll("[data-add-global-category-key]").forEach((candidate) => {
        if (!affected.has(candidate.dataset.addGlobalCategoryKey) || candidate.disabled) return;
        candidate.checked = input.checked;
      });
      tree.querySelectorAll("[data-add-global-field-category]").forEach((candidate) => {
        if (affected.has(candidate.dataset.addGlobalFieldCategory)) candidate.checked = input.checked;
      });
    });
    group.append(summary, contents);
    container.append(group);
  };
  const roots = children.get("") || [];
  roots.forEach((node, index) => appendNode(node, tree, index === 0));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    elements.confirmAddGlobalCategory.onclick = () => {
      const categories = new Set([...tree.querySelectorAll("[data-add-global-category-key]:checked")]
        .map((input) => input.dataset.addGlobalCategoryKey));
      const fields = new Set([...tree.querySelectorAll("[data-add-global-field-key]:checked")]
        .filter((input) => categories.has(input.dataset.addGlobalFieldCategory))
        .map((input) => input.dataset.addGlobalFieldKey));
      finish({ categories, fields });
      dialog.close();
    };
    dialog.addEventListener("close", () => finish(null), { once: true });
    dialog.showModal();
  });
}

async function addGlobalDefinitionToSchema(kind, globalRef) {
  if (generalDraftDirty() && !(await saveGeneralDefinitions())) return;
  const collection = kind === "category" ? state.globalDefinitions.categories : state.globalDefinitions.fields;
  const definition = deepClone(collection?.[globalRef]?.definition);
  if (!definition) return;
  const schemas = activeWorkspaceSchemas();
  if (!schemas.length) {
    showToast(scText("أنشئ تصميمًا قبل إضافة التعريف العام."), "error");
    return;
  }
  const selectedSchemaId = await requestSelection({
    title: scText("إضافة التعريف العام إلى تصميم"),
    label: scText("التصميم"),
    choices: schemas.map((schema) => ({
      value: schema.id,
      label: displaySchemaName(schema) || displaySchemaName(schema) || displayLabel(schema.app, "title") || scText("تصميم بلا اسم"),
    })),
    value: state.activeSchemaId,
    confirmLabel: scText("اختيار التصميم"),
  });
  if (selectedSchemaId == null) return;
  const selectedSchema = schemas.find((schema) => schema.id === selectedSchemaId);
  if (!selectedSchema) {
    showToast(scText("رقم التصميم غير صالح."), "error");
    return;
  }
  if (selectedSchema.id !== state.activeSchemaId) {
    const switched = await switchActiveSchema(selectedSchema.id, { mode: "builder" });
    if (!switched) return;
  }
  let addedCategoryId = "";
  let addedFieldId = "";
  let addedFieldCategoryId = "";
  if (kind === "category") {
    const rawTree = globalCategoryTree(definition);
    const selection = await chooseGlobalCategoryContents(rawTree);
    if (!selection) return;
    const selectedTree = rawTree.filter((node) => selection.categories.has(node.key));
    const categoryIds = new Map(selectedTree.map((node) => [node.key, randomDefinitionId("cat")]));
    const fieldIds = new Map();
    selectedTree.forEach((node) => (node.fields || [])
      .filter((field) => selection.fields.has(field.key))
      .forEach((field) => fieldIds.set(field.key, randomDefinitionId("fld"))));
    const restoreFieldReferences = (raw) => {
      const field = deepClone(raw);
      SCFinance.remapOwner(field,fieldIds,categoryIds);
      if (field.composition?.field_keys) { field.composition.field_ids = field.composition.field_keys.map(key=>fieldIds.get(key)||''); delete field.composition.field_keys; }
      if (field.type === 'field_group' && field.field_keys) {
        field.field_ids = field.field_keys.map(key => fieldIds.get(key) || '');
        delete field.field_keys;
      }
      if (field.option_filter?.source_field_key) {
        field.option_filter.source_field_id = fieldIds.get(field.option_filter.source_field_key) || null;
        delete field.option_filter.source_field_key;
      }
      if (field.validation?.compare_field_key) {
        field.validation.compare_field_id = fieldIds.get(field.validation.compare_field_key) || null;
        delete field.validation.compare_field_key;
      }
      if (field.related_person_source_field_key) {
        field.related_person_source_field_id = fieldIds.get(field.related_person_source_field_key) || null;
        delete field.related_person_source_field_key;
      }
      if (field.file_naming?.parts) {
        field.file_naming.parts = field.file_naming.parts.map((part) => {
          const restored = { ...part, field_id: fieldIds.get(part.field_key) || "" };
          delete restored.field_key;
          return restored;
        });
      }
      return field;
    };
    const instances = selectedTree.map((node, index) => ({
      ...deepClone(node.definition || {}),
      id: categoryIds.get(node.key),
      global_ref: index === 0 ? globalRef : null,
      global_tree_ref: globalRef,
      global_tree_key: node.key,
      fields: (node.fields || []).filter((item) => selection.fields.has(item.key)).map((item) => ({
        ...restoreFieldReferences(item.definition || {}),
        id: fieldIds.get(item.key),
        global_tree_ref: globalRef,
        global_tree_key: item.key,
      })),
      parent_category_id: categoryIds.get(node.parent_key) || null,
      anchor_field_id: fieldIds.get(node.anchor_field_key) || null,
    parent_field_id: fieldIds.get(node.parent_field_key) || null,
    }));
    for (const category of instances) SCFinance.remapOwner(category,fieldIds,categoryIds);
    state.draftSchema.categories.push(...instances);
    const conditionDefinition = { ...definition, global_ref: globalRef };
    state.draftSchema.conditions.push(
      ...restoredGlobalCategoryConditions(conditionDefinition, categoryIds, fieldIds),
    );
    addedCategoryId = instances[0]?.id || "";
  } else {
    const categories = state.draftSchema.categories;
    if (!categories.length) {
      showToast(scText("أضف فئة إلى التصميم أولًا."), "error");
      return;
    }
    const categoryId = await requestSelection({
      title: scText("إضافة الحقل العام إلى التصميم"),
      label: scText("الفئة"),
      choices: categories.map((category) => ({ value: category.id, label: displayLabel(category) })),
      value: categories[0]?.id || "",
      confirmLabel: scText("اختيار الفئة"),
    });
    if (categoryId == null) return;
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) {
      showToast(scText("رقم الفئة غير صالح."), "error");
      return;
    }
    addedFieldId = randomDefinitionId("fld");
    addedFieldCategoryId = category.id;
    category.fields.push({ ...definition, id: addedFieldId, global_ref: globalRef });
  }
  markDirty();
  state.builderScope = "schema";
  renderBuilder();
  renderBuilderScope();
  if (addedCategoryId) openCategoryDialog(addedCategoryId);
  if (addedFieldId) openFieldDialog(addedFieldCategoryId, addedFieldId);
  showToast(scText("أُضيفت نسخة مرتبطة إلى التصميم. احفظ التصميم لتثبيتها."));
}

function globalDefinitionActionButton(label, iconName, handler, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-icon${danger ? " button-danger-quiet" : ""}`;
  button.append(actionIcon(iconName));
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

function globalFieldSummaryFlags(field) {
  return [
    FIELD_TYPE_LABELS[field.type] || scText("حقل"),
    field.required ? scText("مطلوب") : "",
    field.unique ? scText("فريد") : "",
    field.image_display === "profile" ? scText("صورة شخصية") : "",
    field.option_filter ? scText("قائمة مترابطة") : "",
    Object.values(field.validation || {}).some((value) => value !== null && value !== "" && value !== false)
      ? scText("قيود تحقق")
      : "",
    field.searchable ? scText("قابل للبحث") : "",
    field.show_in_results ? scText("يظهر في النتائج") : "",
    scText("تعريف عام"),
  ].filter(Boolean).join(" · ");
}

function globalPackageConditionSummary(definition, condition) {
  const tree = globalCategoryTree(definition);
  const categories = new Map(tree.map((node) => [node.key, displayLabel(node.definition) || scText("فئة")]));
  const fields = new Map(tree.flatMap((node) => (node.fields || []).map((field) => [
    field.key,
    displayLabel(field.definition) || scText("حقل"),
  ])));
  const source = fields.get(condition.source_field_key) || scText("حقل محذوف");
  const target = condition.target_type === "category"
    ? scText`الفئة: ${categories.get(condition.target_key) || scText("محذوفة")}`
    : scText`الحقل: ${fields.get(condition.target_key) || scText("محذوف")}`;
  const operator = OPERATOR_LABELS[condition.operator] || condition.operator || scText("يساوي");
  const sourceEntry = tree.flatMap((node) => node.fields || []).find((entry) => entry.key === condition.source_field_key);
  const sourceDefinition = sourceEntry?.definition || sourceEntry || {};
  const displayValue = (raw) => {
    if (sourceDefinition.type === "checkbox") return String(raw) === "true" ? scText("محدد") : scText("غير محدد");
    if (["select", "yes_no", "checkbox_group"].includes(sourceDefinition.type)) {
      return displayLabel((sourceDefinition.options || []).find((option) => option.id === raw || option.label === raw)) || scText("قيمة غير متاحة");
    }
    return String(raw ?? "");
  };
  const readableValue = Array.isArray(condition.value) ? condition.value.map(displayValue).join("، ") : displayValue(condition.value);
  const value = ["empty", "not_empty"].includes(condition.operator)
    ? ""
    : ` «${readableValue}»`;
  return scText`${condition.negate ? scText("ليس صحيحًا أن ") : ""}${source} ${operator}${value} ← يؤثر في ${target}`;
}

function globalPackageConditions(categoryRef, definition) {
  const fragment = document.createDocumentFragment();
  const conditions = definition.conditions || [];
  conditions.forEach((condition, index) => {
    const key = condition.key || `condition-${index + 1}`;
    const row = document.createElement("div");
    row.className = "condition-row";
    const text = document.createElement("div");
    text.className = "condition-expression";
    text.textContent = `${definition.label || scText("فئة عامة")} — ${globalPackageConditionSummary(definition, condition)}`;
    const actions = document.createElement("div");
    actions.className = "builder-actions";
    const tree = globalCategoryTree(definition);
    const targetNode = condition.target_type === "category"
      ? tree.find((node) => node.key === condition.target_key)
      : tree.find((node) => (node.fields || []).some((field) => field.key === condition.target_key));
    actions.append(
      globalDefinitionActionButton(scText("تعديل الشرط"), "edit", () =>
        openGlobalPackageConditionEditor(
          categoryRef,
          targetNode?.key || "",
          condition.target_type,
          condition.target_key,
          key,
        )),
      globalDefinitionActionButton(scText("حذف الشرط"), "trash", () =>
        void deleteGlobalPackageCondition(categoryRef, key), true),
    );
    row.append(text, actions);
    fragment.append(row);
  });
  return fragment;
}

function globalTreeFieldRow(categoryRef, node, fieldEntry, fieldIndex) {
  const row = document.createElement("div");
  row.className = "builder-field-row global-category-field-row";
  row.id = globalEmbeddedFieldTargetId(categoryRef, fieldEntry.key);
  const field = fieldEntry.definition || fieldEntry;
  const summary = document.createElement("div");
  summary.className = "field-summary";
  const label = document.createElement("strong");
  label.textContent = field.label || scText("حقل عام");
  const meta = document.createElement("span");
  meta.textContent = globalFieldSummaryFlags(field);
  summary.append(label, meta);
  const actions = document.createElement("div");
  actions.className = "builder-actions";
  const up = globalDefinitionActionButton(scText("نقل الحقل إلى أعلى"), "up", () =>
    void updateEmbeddedGlobalField(categoryRef, node.key, fieldEntry.key, "up"));
  const down = globalDefinitionActionButton(scText("نقل الحقل إلى أسفل"), "down", () =>
    void updateEmbeddedGlobalField(categoryRef, node.key, fieldEntry.key, "down"));
  up.disabled = fieldIndex === 0;
  down.disabled = fieldIndex === (node.fields || []).length - 1;
  actions.append(
    up,
    down,
    globalDefinitionActionButton(scText("تعديل الحقل"), "edit", () =>
      openGlobalCategoryPackageEditor("field", categoryRef, { nodeKey: node.key, fieldKey: fieldEntry.key })),
    globalDefinitionActionButton(scText("حذف الحقل"), "trash", () =>
      void updateEmbeddedGlobalField(categoryRef, node.key, fieldEntry.key, "delete"), true),
  );
  row.append(summary, actions);
  return row;
}

function globalCategoryTreeCard(item, node, tree, categoryIndex, totalCategories, rootNode) {
  const root = node === rootNode;
  const card = document.createElement("article");
  card.className = "builder-category global-definition-tree-category global-definition-card global-definition-category-card";
  card.id = root
    ? `global-definition-category-${item.id}`
    : `global-category-node-${item.id}-${node.key}`;
  card.dataset.globalDefinitionKind = "category";
  card.dataset.globalDefinitionId = item.id;
  card.dataset.globalCategoryNode = node.key;
  if (node.parent_key) card.dataset.parentCategoryId = node.parent_key;
  card.tabIndex = -1;
  const collapseKey = `category:${item.id}:${node.key}`;
  if (state.collapsedGlobalDefinitionIds?.has(collapseKey)) card.classList.add("builder-category-collapsed");

  const heading = document.createElement("div");
  heading.className = "builder-category-heading global-definition-heading";
  const titleBlock = document.createElement("div");
  const titleRow = document.createElement("div");
  titleRow.className = "category-title-row";
  const title = document.createElement("strong");
  title.textContent = node.definition?.label || scText("فئة عامة");
  const kindBadge = document.createElement("span");
  kindBadge.className = "kind-badge";
  kindBadge.textContent = node.definition?.kind === "repeatable" ? scText("متكررة") : scText("رئيسية");
  const globalBadge = document.createElement("span");
  globalBadge.className = "kind-badge global-kind-badge";
  globalBadge.textContent = scText("عام");
  titleRow.append(title, kindBadge, globalBadge);
  if (node.parent_key) {
    const parent = tree.find((candidate) => candidate.key === node.parent_key);
    const parentBadge = document.createElement("span");
    parentBadge.className = "kind-badge parent-kind-badge";
    parentBadge.textContent = scText`ضمن ${parent?.definition?.label || scText("فئة عامة")}`;
    titleRow.append(parentBadge);
  }
  const actions = document.createElement("div");
  actions.className = "builder-actions global-category-heading-actions";
  if (root) {
    const up = globalDefinitionActionButton(scText("نقل الفئة إلى أعلى"), "up", () =>
      void reorderGlobalDefinition("category", item.id, "up"));
    const down = globalDefinitionActionButton(scText("نقل الفئة إلى أسفل"), "down", () =>
      void reorderGlobalDefinition("category", item.id, "down"));
    up.disabled = categoryIndex === 0;
    down.disabled = categoryIndex === totalCategories - 1;
    actions.append(
      up,
      down,
      globalDefinitionActionButton(scText("إضافة الفئة إلى التصميم"), "plus", () =>
        addGlobalDefinitionToSchema("category", item.id)),
    );
  } else {
    const siblings = tree.filter((candidate) => (candidate.parent_key || "") === (node.parent_key || ""));
    const siblingIndex = siblings.findIndex((candidate) => candidate.key === node.key);
    const up = globalDefinitionActionButton(scText("نقل الفئة إلى أعلى"), "up", () =>
      void updateGlobalCategoryNode(item.id, node.key, "up"));
    const down = globalDefinitionActionButton(scText("نقل الفئة إلى أسفل"), "down", () =>
      void updateGlobalCategoryNode(item.id, node.key, "down"));
    up.disabled = siblingIndex === 0;
    down.disabled = siblingIndex === siblings.length - 1;
    actions.append(up, down);
  }
  actions.append(
    globalDefinitionActionButton(scText("تعديل الفئة"), "edit", () =>
      openGlobalCategoryPackageEditor("category", item.id, { nodeKey: node.key })),
    root
      ? globalDefinitionActionButton(scText("حذف التعريف العام"), "trash", () =>
          void deleteGlobalDefinition("category", item.id), true)
      : globalDefinitionActionButton(scText("حذف الفئة"), "trash", () =>
          void updateGlobalCategoryNode(item.id, node.key, "delete"), true),
  );
  titleRow.append(actions);
  const description = document.createElement("p");
  description.className = "builder-category-description";
  description.textContent = node.definition?.description
    || (node.definition?.kind === "repeatable" ? scText("تسمح بإضافة عدة بطاقات مرتبطة بالسجل.") : scText("تظهر مرة واحدة في السجل."));
  titleBlock.append(titleRow, description);
  heading.append(titleBlock);
  heading.setAttribute("aria-expanded", String(!card.classList.contains("builder-category-collapsed")));
  heading.addEventListener("click", (event) => {
    if (![heading, titleBlock, titleRow].includes(event.target)) return;
    state.collapsedGlobalDefinitionIds ||= new Set();
    const collapsed = card.classList.toggle("builder-category-collapsed");
    heading.setAttribute("aria-expanded", String(!collapsed));
    if (collapsed) state.collapsedGlobalDefinitionIds.add(collapseKey);
    else state.collapsedGlobalDefinitionIds.delete(collapseKey);
  });

  const fields = document.createElement("div");
  fields.className = "builder-fields global-category-field-list";
  (node.fields || []).forEach((field, index) => fields.append(
    globalTreeFieldRow(item.id, node, field, index),
  ));
  if (!(node.fields || []).length) {
    const empty = document.createElement("div");
    empty.className = "builder-empty empty-state-compact";
    empty.textContent = scText("لا توجد حقول داخل الفئة");
    fields.append(empty);
  }
  card.append(heading, fields);
  return card;
}

function orderedGlobalCategoryNodes(tree) {
  const ordered = [];
  const visited = new Set();
  const appendChildren = (parentKey = "") => {
    tree.filter((node) => (node.parent_key || "") === parentKey).forEach((node) => {
      if (visited.has(node.key)) return;
      visited.add(node.key);
      ordered.push(node);
      appendChildren(node.key);
    });
  };
  appendChildren();
  tree.forEach((node) => {
    if (!visited.has(node.key)) ordered.push(node);
  });
  return ordered;
}

function renderGlobalConditions() {
  if (!elements.globalConditions) return;
  elements.globalConditions.replaceChildren();
  Object.values(state.globalDefinitions?.categories || {}).forEach((item) => {
    elements.globalConditions.append(globalPackageConditions(item.id, item.definition || {}));
  });
  elements.noGlobalConditionsMessage.hidden = Boolean(elements.globalConditions.children.length);
}

function globalDefinitionCard(kind, item, index = 0, total = 1) {
  const card = document.createElement("article");
  card.className = kind === "field"
    ? "builder-field-row global-category-field-row global-definition-card global-definition-field-card"
    : "builder-category global-definition-card global-definition-category-card";
  card.id = `global-definition-${kind}-${item.id}`;
  card.dataset.globalDefinitionKind = kind;
  card.dataset.globalDefinitionId = item.id;
  if (state.collapsedGlobalDefinitionIds?.has(`${kind}:${item.id}`)) {
    card.classList.add("builder-category-collapsed");
  }

  if (kind === "field") {
    const summary = document.createElement("div");
    summary.className = "field-summary";
    const label = document.createElement("strong");
    label.textContent = displayLabel(item.definition) || item.id;
    const meta = document.createElement("span");
    meta.textContent = scText`${globalFieldSummaryFlags(item.definition || {})} · منفصل`;
    summary.append(label, meta);
    const actions = document.createElement("div");
    actions.className = "builder-actions";
    const up = globalDefinitionActionButton(scText("نقل الحقل إلى أعلى"), "up", () =>
      void reorderGlobalDefinition("field", item.id, "up"));
    const down = globalDefinitionActionButton(scText("نقل الحقل إلى أسفل"), "down", () =>
      void reorderGlobalDefinition("field", item.id, "down"));
    up.disabled = index === 0;
    down.disabled = index === total - 1;
    actions.append(
      up,
      down,
      globalDefinitionActionButton(scText("إضافة للتصميم"), "plus", () => addGlobalDefinitionToSchema(kind, item.id)),
      globalDefinitionActionButton(scText("تعديل التعريف العام"), "edit", () => openGlobalDefinitionEditor(kind, item.id)),
      globalDefinitionActionButton(scText("حذف التعريف العام"), "trash", () => void deleteGlobalDefinition(kind, item.id), true),
    );
    card.append(summary, actions);
    return card;
  }
  const tree = globalCategoryTree(item.definition || {});
  const rootNode = tree.find((node) => !node.parent_key) || tree[0];
  const fragment = document.createDocumentFragment();
  orderedGlobalCategoryNodes(tree).forEach((node) => fragment.append(
    globalCategoryTreeCard(item, node, tree, index, total, rootNode),
  ));
  return fragment;
}

function renderGlobalDefinitions() {
  if (!elements.globalCategoryList) return;
  const signature = JSON.stringify(state.globalDefinitions);
  if (signature === globalDefinitionsRenderSignature) return;
  const categories = Object.values(state.globalDefinitions?.categories || {});
  const fields = Object.values(state.globalDefinitions?.fields || {});
  if (elements.globalCategoryCount) elements.globalCategoryCount.textContent = String(categories.length);
  if (elements.globalFieldCount) elements.globalFieldCount.textContent = String(fields.length);
  if (elements.globalEmbeddedFieldCount) elements.globalEmbeddedFieldCount.textContent = String(categories.reduce((total, item) => total + globalCategoryAllFieldEntries(item).length, 0));
  renderGlobalDefinitionPreviews();
  globalDefinitionsRenderSignature = signature;
  renderGlobalConditions();
  SCGeneralAlerts.render();
  renderBuilderCategoryNavigator();
}

function renderGlobalizeExistingSources() {
  const schemas = activeWorkspaceSchemas();
  if (!state.globalizeSourceSchemaId || !schemas.some((schema) => schema.id === state.globalizeSourceSchemaId)) {
    state.globalizeSourceSchemaId = state.activeSchemaId || schemas[0]?.id || "";
  }
  elements.globalizeSourceSchemas.replaceChildren();
  schemas.forEach((schema) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-secondary schema-choice-button${schema.id === state.globalizeSourceSchemaId ? " is-active" : ""}`;
    button.dataset.globalizeSourceSchema = schema.id;
    button.textContent = displaySchemaName(schema);
    elements.globalizeSourceSchemas.append(button);
  });
  const definition = state.workspaceDefinitions?.[state.globalizeSourceSchemaId];
  elements.globalizeSourceItems.replaceChildren();
  if (!definition) return;
  (definition.categories || []).forEach((category) => {
    if (category.global_ref || category.global_tree_ref) return;
    const available = (category.fields || []).filter((field) => !field.global_ref && !field.global_tree_ref);
    const group = document.createElement("details");
    group.className = "tree-option-group globalize-source-category";
    const summary = document.createElement("summary");
    const categoryLabel = document.createElement("label");
    categoryLabel.className = "check-field";
    const categoryInput = document.createElement("input");
    categoryInput.type = "checkbox";
    categoryInput.dataset.globalizeCategory = category.id;
    categoryLabel.append(categoryInput, document.createTextNode(displayLabel(category)));
    summary.append(categoryLabel);
    const list = document.createElement("div");
    list.className = "search-field-option-grid";
    available.forEach((field) => {
      const label = document.createElement("label");
      label.className = "check-field globalize-source-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.globalizeField = field.id;
      input.dataset.globalizeFieldCategory = category.id;
      label.append(input, document.createTextNode(displayLabel(field)));
      list.append(label);
    });
    group.append(summary, list);
    elements.globalizeSourceItems.append(group);
  });
  if (!elements.globalizeSourceItems.childElementCount) {
    emptyDashboard(elements.globalizeSourceItems, scText("لا توجد عناصر محلية متاحة لهذا النوع."));
  }
}

function openGlobalizeExistingDialog() {
  state.globalizeKind = "category";
  state.globalizeSourceSchemaId = state.activeSchemaId;
  elements.globalizeExistingKind.querySelectorAll("[data-globalize-kind]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.globalizeKind === "category");
  });
  renderGlobalizeExistingSources();
  elements.globalizeExistingDialog.showModal();
}

function globalizeExistingSelection() {
  const categories = [...elements.globalizeSourceItems.querySelectorAll("[data-globalize-category]:checked")].map((input) => input.dataset.globalizeCategory);
  const categorySet = new Set(categories);
  const fields = [...elements.globalizeSourceItems.querySelectorAll("[data-globalize-field]:checked")]
    .filter((input) => !categorySet.has(input.dataset.globalizeFieldCategory))
    .map((input) => input.dataset.globalizeField);
  return { categories, fields };
}

async function confirmGlobalizeExisting(connect = true) {
  const selection = globalizeExistingSelection();
  if (!selection.categories.length && !selection.fields.length) return showToast(scText("اختر فئة كاملة أو حقلًا واحدًا على الأقل."), "error");
  const sourceId = state.globalizeSourceSchemaId;
  elements.confirmGlobalizeExisting.disabled = true;
  if (elements.createGlobalizeExisting) elements.createGlobalizeExisting.disabled = true;
  elements.globalizeExistingDialog.close();
  try {
    if (connect && sourceId !== state.activeSchemaId) {
      const switched = await switchActiveSchema(sourceId, { mode: "builder" });
      if (!switched) return;
    }
    if (connect) {
      for (const categoryId of selection.categories) await publishLocalDefinition("category", categoryId);
      for (const fieldId of selection.fields) await publishLocalDefinition("field", fieldId);
    } else {
      const source = state.workspaceDefinitions?.[sourceId];
      for (const categoryId of selection.categories) {
        await saveGlobalDefinition("category", randomDefinitionId("gcat"), categoryTreeDefinition(categoryId, source).definition);
      }
      for (const fieldId of selection.fields) {
        const field = fieldById(fieldId, source);
        if (field) await saveGlobalDefinition("field", randomDefinitionId("gfld"), definitionPayload(field, "field"));
      }
      renderGlobalDefinitions();
      showToast(scText("تم إنشاء التعريفات العامة دون ربطها بتصميم."));
    }
    state.builderScope = "global";
    renderBuilderScope();
  } finally {
    elements.confirmGlobalizeExisting.disabled = false;
    if (elements.createGlobalizeExisting) elements.createGlobalizeExisting.disabled = false;
  }
}

function renderBuilderScope() {
  renderBuilderHistoryDialog();
  document.querySelectorAll("[data-builder-scope]").forEach((button) => {
    const active = button.dataset.builderScope === state.builderScope;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.globalDefinitionsPanel.hidden = state.builderScope !== "global";
  elements.schemaBuilderContent.hidden = state.builderScope !== "schema";
  elements.builderActionRail.hidden = state.mode !== "builder";
  elements.appWorkspace.dataset.builderScope = state.builderScope;
  if (elements.schemaManagementPanel) elements.schemaManagementPanel.hidden = state.builderScope !== "schema";
  if (elements.builderGlobalManagementRail) elements.builderGlobalManagementRail.hidden = state.builderScope !== "global";
  elements.builderActionRail.querySelectorAll(".builder-schema-save-control").forEach((control) => {
    control.hidden = state.builderScope !== "schema";
  });
  if (state.builderScope === "global") {
    renderGlobalDefinitions();
    updateGeneralSaveState();
  } else {
    renderBuilder();
    renderBuilderCategoryNavigator();
  }
  renderAllSchemaTabs();
}

function allConfigurationSources() {
  const result = [];
  Object.entries(state.workspaceDefinitions || {}).forEach(([schemaId, schema]) => {
    (schema.categories || []).forEach((category) => category.fields.forEach((field) => {
      result.push({ key: `${schemaId}:${field.id}`, schemaId, schemaName: displaySchemaName(schema) || displayLabel(schema.app, "title"), category, field, conditions: (schema.conditions || []).filter((condition) => condition.target_type === "field" && condition.target_id === field.id), schema });
    }));
  });
  Object.entries(state.globalDefinitions?.fields || {}).forEach(([globalRef, item]) => {
    const field = deepClone(item.definition || {});
    result.push({
      key: `global-field:${globalRef}`,
      schemaId: "__global__",
      schemaName: scText("التعريفات العامة"),
      category: { label: scText("حقول عامة منفصلة") },
      field,
      conditions: [],
      schema: { categories: [], conditions: [] },
      globalRef,
    });
  });
  Object.entries(state.globalDefinitions?.categories || {}).forEach(([globalRef, item]) => {
    globalCategoryAllFieldEntries(item).forEach((entry) => {
      result.push({
        key: `global-category:${globalRef}:${entry.key}`,
        schemaId: "__global__",
        schemaName: scText("التعريفات العامة"),
        category: { label: entry.categoryLabel || displayLabel(item.definition) || scText("فئة عامة") },
        field: deepClone(entry.definition || {}),
        conditions: [],
        schema: { categories: [], conditions: [] },
        globalTreeRef: globalRef,
        globalTreeKey: entry.key,
      });
    });
  });
  return result;
}

function renderFieldConfigurationSources() {
  if (!elements.fieldConfigurationSource) return;
  state.fieldConfigurationSources = new Map(allConfigurationSources().map((source) => [source.key, source]));
  elements.fieldConfigurationSource.replaceChildren(new Option(scText("اختر حقلًا"), ""));
  const groups = new Map();
  state.fieldConfigurationSources.forEach((source) => {
    if (source.schemaId === state.activeSchemaId && source.field.id === state.editingFieldId) return;
    if (!groups.has(source.schemaName)) {
      const group = document.createElement("optgroup");
      group.label = source.schemaName;
      groups.set(source.schemaName, group);
      elements.fieldConfigurationSource.append(group);
    }
    groups.get(source.schemaName).append(new Option(`${displayLabel(source.category)} — ${displayLabel(source.field)}`, source.key));
  });
}

async function applyFieldConfigurationImport() {
  const source = state.fieldConfigurationSources?.get(elements.fieldConfigurationSource.value);
  if (!source) {
    showToast(scText("اختر حقل المصدر أولًا."), "error");
    return;
  }
  const selected = new Set([...elements.fieldConfigurationProperties.querySelectorAll("[data-import-field-property]:checked")].map((input) => input.dataset.importFieldProperty));
  const field = source.field;
  if (selected.has("label")) {
    elements.fieldLabel.value = field.label || "";
    elements.fieldPlaceholder.value = field.placeholder || "";
  }
  if (selected.has("type")) {
    const typeState = fieldDialogTypeState(field);
    elements.fieldType.value = typeState.ui;
    elements.fieldTextMode.value = typeState.textMode || "short";
    elements.fieldListMode.value = typeState.listMode || "custom";
    elements.fieldDateMode.value = typeState.dateMode || "manual_gregorian";
    fillMainCheckboxSelect(elements.fieldDateTrigger, field.date_trigger_field_id || "");
    elements.fieldUserValueMode.value = field.user_value_mode || "created_by";
    fillMainCheckboxSelect(elements.fieldUserTrigger, field.user_trigger_field_id || "");
    elements.fieldUniqueCardCheckbox.checked = Boolean(field.unique_checked_across_cards);
  }
  if (selected.has("options")) {
    state.fieldOptionsDraft = deepClone(field.options || []);
    elements.fieldOptions.value = state.fieldOptionsDraft.map((item) => item.label).join("\n");
  }
  if (selected.has("behavior")) {
    elements.fieldRequired.checked = Boolean(field.required);
    elements.fieldUnique.checked = Boolean(field.unique);
    elements.fieldSearchable.checked = Boolean(field.searchable);
    elements.fieldSearchMatch.value = field.search_match || "contains";
    elements.fieldShowResult.checked = Boolean(field.show_in_results);
    elements.fieldResultTitle.checked = Boolean(field.result_title);
    elements.fieldStartNewLine.checked = Boolean(field.start_new_line);
    elements.fieldCheckboxTrueLabel.value = field.checkbox_true_label || "";
    elements.fieldCheckboxFalseLabel.value = field.checkbox_false_label || "";
    elements.fieldWidth.value = ({ normal: "1", wide: "4", long: "4" }[field.width] || field.width || "1");
  }
  if (selected.has("validation")) {
    loadValidation(field);
    loadNumberBehavior(field);
    state.filePartsDraft = deepClone(field.file_naming?.parts || []);
    elements.fileNamingMode.value = field.file_naming?.mode || "original";
    state.optionFilterDraft = null;
  }
  if (selected.has("conditions") && source.conditions.length) {
    const targetId = state.editingFieldId;
    const targetFields = allFields(state.draftSchema).filter(({ field: candidate }) => candidate.id !== targetId);
    for (const condition of source.conditions) {
      const sourceField = fieldById(condition.source_field_id, source.schema);
      const suggested = targetFields.find(({ field: candidate }) => candidate.global_ref && candidate.global_ref === sourceField?.global_ref)
        || targetFields.find(({ field: candidate }) => candidate.label === sourceField?.label && candidate.type === sourceField?.type);
      const mappedId = await requestSelection({
        title: scText("ربط مصدر شرط الظهور"),
        message: scText`اختر حقل المصدر المقابل للشرط «${sourceField?.label || scText("شرط")}».`,
        label: scText("حقل المصدر"),
        choices: targetFields.map(({ category, field: candidate }) => ({
          value: candidate.id,
          label: `${displayLabel(category)} — ${displayLabel(candidate)}`,
        })),
        value: suggested?.field?.id || targetFields[0]?.field?.id || "",
      });
      const mapped = targetFields.find(({ field: candidate }) => candidate.id === mappedId)?.field;
      if (!mapped) continue;
      let comparison = {};
      if (condition.compare_field_id) {
        const other = fieldById(condition.compare_field_id, source.schema);
        const compatible = targetFields.filter(({field:f})=>SCFieldLogic.compatible(mapped, f));
        const otherId = await requestSelection({title: scText("الحقل المقارن"), label: scText("الحقل المقارن"),
          choices: compatible.map(({category:c,field:f})=>({value:f.id,label:`${displayLabel(c)} — ${displayLabel(f)}`})),
          value: compatible.find(({field:f})=>f.label===other?.label)?.field.id || compatible[0]?.field.id || ""});
        if (!otherId) continue;
        comparison = {compare_field_id: otherId};
      }
      state.draftSchema.conditions.push({ ...deepClone(condition), ...comparison, id: randomDefinitionId("cond"), group_id: randomDefinitionId("grp"), target_id: targetId, source_field_id: mapped.id });
    }
    renderFieldConditionEditor();
  }
  updateFieldDialogType();
  renderOptionFilterMatrix();
  renderFileParts();
  showToast(scText("تم تطبيق أجزاء الإعداد المحددة. راجعها قبل حفظ الحقل."));
}

document.querySelectorAll("[data-builder-scope]").forEach((button) => button.addEventListener("click", () => {
  state.builderScope = button.dataset.builderScope;
  renderBuilderScope();
}));
elements.newGlobalCategory?.addEventListener("click", () => openGlobalDefinitionEditor("category"));
elements.newGlobalField?.addEventListener("click", () => openNewFieldCategoryDialog("global"));
elements.globalizeExistingDefinition?.addEventListener("click", openGlobalizeExistingDialog);
elements.globalizeExistingKind?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-globalize-kind]");
  if (!button) return;
  state.globalizeKind = button.dataset.globalizeKind;
  elements.globalizeExistingKind.querySelectorAll("[data-globalize-kind]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
  renderGlobalizeExistingSources();
});
elements.globalizeSourceSchemas?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-globalize-source-schema]");
  if (!button) return;
  state.globalizeSourceSchemaId = button.dataset.globalizeSourceSchema;
  renderGlobalizeExistingSources();
});
elements.globalizeSourceItems?.addEventListener("change", (event) => {
  const group = event.target.closest(".globalize-source-category");
  if (!group) return;
  const category = group.querySelector("[data-globalize-category]");
  const fields = [...group.querySelectorAll("[data-globalize-field]")];
  if (event.target === category) {
    fields.forEach((field) => { field.checked = category.checked; });
    category.indeterminate = false;
    return;
  }
  const checked = fields.filter((field) => field.checked).length;
  category.checked = checked === fields.length && fields.length > 0;
  category.indeterminate = checked > 0 && checked < fields.length;
});
elements.globalizeExistingDialog?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-globalize-selection-action]")?.dataset.globalizeSelectionAction;
  if (!action) return;
  const checked = action === "select";
  elements.globalizeSourceItems.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = checked;
    input.indeterminate = false;
  });
});
elements.confirmGlobalizeExisting?.addEventListener("click", () => void confirmGlobalizeExisting(true));
elements.createGlobalizeExisting?.addEventListener("click", () => void confirmGlobalizeExisting(false));
elements.applyFieldConfigurationImport?.addEventListener("click", applyFieldConfigurationImport);
elements.createNewIdentityButton?.addEventListener("click", () => {
  elements.newProfileChoiceDialog.close();
  newRecord();
  showToast(scText`تم فتح ${entityName()} جديد.`);
});
elements.reuseExistingIdentityButton?.addEventListener("click", () => {
  elements.newProfileChoiceDialog.close();
  openProfileLinkDialog();
});
elements.categoryDialog?.addEventListener("close", () => {
  if (state.globalEditor && !state.categoryDialogCommitted) restoreGlobalEditor();
});
elements.fieldDialog?.addEventListener("close", () => {
  if (state.globalEditor && !state.fieldDialogCommitted) restoreGlobalEditor();
});
elements.conditionDialog?.addEventListener("close", () => {
  if (state.globalEditor?.kind === "condition") restoreGlobalEditor();
});
