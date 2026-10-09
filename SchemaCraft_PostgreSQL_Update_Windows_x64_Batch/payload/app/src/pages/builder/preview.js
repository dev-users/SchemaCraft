// A render context lets schema and general definitions share the same layout
// without replacing the live schema/draft or connecting record workflows.
let activeBuilderPreviewContext = null;
function builderPreviewContext() {
  return activeBuilderPreviewContext || {root:elements.builderCategories, schema:state.draftSchema, cache:builderPreviewCache, schemaId:state.activeSchemaId};
}

// Schema layout preview. Only schema actions are interactive; no record controls
// or related-profile workflows are connected to this surface.
function builderPreviewCategoryPeers(category) {
  return builderPreviewContext().schema.categories.filter((item) =>
    item.kind === category.kind &&
    (item.parent_category_id || '') === (category.parent_category_id || '') &&
    (item.parent_field_id || '') === (category.parent_field_id || '') &&
    (item.anchor_field_id || '') === (category.anchor_field_id || ''));
}

function selectBuilderPreviewItem(kind, id, toggle = true, root = elements.builderCategories) {
  appHoverCards.hide();
  const key = `${kind}:${id}`;
  const selected = !kind || (toggle && root.dataset.selectedItem === key) ? '' : key;
  root.dataset.selectedItem = selected;
  root.querySelectorAll('[data-preview-actions]').forEach((actions) => {
    actions.hidden = actions.dataset.previewActions !== selected;
  });
  root.querySelectorAll('[data-preview-select]').forEach((name) => {
    name.setAttribute('aria-expanded', String(name.dataset.previewSelect === selected));
  });
  root.querySelectorAll('.builder-preview-selected').forEach((item) => item.classList.remove('builder-preview-selected'));
  if (selected) {
    const actions = [...root.querySelectorAll('[data-preview-actions]')].find((item) => item.dataset.previewActions === selected);
    actions?.parentElement.classList.add('builder-preview-selected');
    const name = [...root.querySelectorAll('[data-preview-select]')].find((item) => item.dataset.previewSelect === selected);
    if (actions && name) positionBuilderPreviewActions(actions, name);
  }
}

function positionBuilderPreviewActions(actions, name) {
  const parent = actions.offsetParent || actions.parentElement;
  const bounds = parent.getBoundingClientRect();
  const label = name.getBoundingClientRect();
  const width = actions.getBoundingClientRect().width;
  actions.style.insetInlineStart = 'auto';
  actions.style.insetInlineEnd = 'auto';
  actions.style.left = `${Math.max(0, Math.min(label.right - bounds.left - width, bounds.width - width))}px`;
  actions.style.top = `${label.bottom - bounds.top + parent.scrollTop + 5}px`;
}

function builderPreviewDetails(kind, id) {
  const schema = builderPreviewContext().schema;
  const item = kind === 'field' ? fieldById(id, schema) : categoryById(id, schema);
  if (!item) return '';
  if (kind === 'category') {
    const parent = categoryById(item.parent_category_id, schema);
    return [item.kind === 'repeatable' ? scText('فئة متكررة') : scText('فئة رئيسية'), parent ? scText`ضمن ${displayLabel(parent)}` : scText('بلا فئة أم'), scText`${item.fields.length} حقول`, item.auto_start ? scText("بطاقة تلقائية") : "", item.related_person_enabled ? scText("ربط بالأشخاص") : "", displayLabel(item, "description")].filter(Boolean).join(' · ');
  }
  return [FIELD_TYPE_LABELS[item.type] || item.type, item.width === 'full' ? scText('العرض الكامل') : scText`العرض: ${item.width || 1}`, item.required ? scText('مطلوب') : scText('غير مطلوب'), item.searchable ? scText('قابل للبحث') : scText('غير قابل للبحث'), item.show_in_results ? scText('يظهر في النتائج') : '', item.unique ? scText('قيمة فريدة') : '', item.image_display ? scText('صورة شخصية') : '', item.option_filter ? scText('قائمة مترابطة') : '', item.start_new_line ? scText('بداية سطر جديد') : '', item.type === 'checkbox' ? scText`التحديد: ${checkboxDisplayMeaning(item, true)} · عدم التحديد: ${checkboxDisplayMeaning(item, false)}` : '', displayLabel(item, "placeholder")].filter(Boolean).join(' · ');
}

function builderCategoryHoverCard(id) {
  if (id === 'global-standalone-preview') return null;
  const category = categoryById(id, builderPreviewContext().schema);
  const details = builderPreviewDetails('category', id);
  return () => ({name:displayLabel(category), details, fields:category.fields.map(field => field.type === 'spacer' ? scText('مساحة فارغة') : displayLabel(field))});
}

function builderFieldHoverCard(id) {
  const field = fieldById(id, builderPreviewContext().schema);
  const details = builderPreviewDetails('field', id);
  return () => ({name:field.type === 'spacer' ? scText('مساحة فارغة') : displayLabel(field), details});
}

function builderPreviewActions(kind, item, category) {
  const context = builderPreviewContext();
  if (context.actions) return context.actions(kind, item, category);
  const actions = document.createElement('div');
  actions.className = 'builder-actions builder-preview-actions';
  actions.dataset.previewActions = `${kind}:${item.id}`;
  actions.id = `builder-preview-actions-${item.id}`;
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', scText`إجراءات ${displayLabel(item)}`);
  actions.hidden = true;
  const peers = kind === 'field' ? category.fields : builderPreviewCategoryPeers(item);
  const index = peers.findIndex((peer) => peer.id === item.id);
  const remove = builderActionButton(scText`حذف ${displayLabel(item)}`, `delete-${kind}`, item.id, 'button-danger-quiet');
  const edit = builderActionButton(scText`تعديل ${displayLabel(item)}`, `edit-${kind}`, item.id);
  const later = builderActionButton(scText('نقل لليسار — التالي في الترتيب'), `move-${kind}-down`, item.id, '', 'left');
  const earlier = builderActionButton(scText('نقل لليمين — السابق في الترتيب'), `move-${kind}-up`, item.id, '', 'right');
  earlier.disabled = index <= 0;
  later.disabled = index === peers.length - 1;
  [remove, edit, earlier, later].forEach((button) => {
    if (category) button.dataset.categoryId = category.id;
    actions.append(button);
  });
  return actions;
}

function builderPreviewName(label, kind, id) {
  const root = builderPreviewContext().root;
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'builder-preview-name';
  name.textContent = label;
  name.dataset.hoverLabel = label;
  name.title = label;
  if (kind === 'category') name._categoryHoverCard = builderCategoryHoverCard(id);
  // Field details belong to the input preview, never its name.
  name.dataset.previewSelect = `${kind}:${id}`;
  name.setAttribute('aria-expanded', 'false');
  name.setAttribute('aria-controls', `builder-preview-actions-${id}`);
  name.addEventListener('click', (event) => {
    event.preventDefault();
    selectBuilderPreviewItem(kind, id, true, root);
  });
  return name;
}

const builderPreviewCache = {schemaId:null, fields:new Map(), sections:new Map(), signature:null};

function createBuilderPreviewField(field, scope, categoryId) {
  const context = builderPreviewContext();
  const cache = context.cache;
  const signature = JSON.stringify([categoryId, field]);
  const cached = cache.fields.get(field.id);
  const category = categoryById(categoryId, context.schema);
  if (cached?.signature === signature) {
    // Boundary buttons change when siblings are inserted, deleted or reordered.
    cached.row.querySelector('[data-builder-action="move-field-up"]').disabled = category.fields[0]?.id === field.id;
    cached.row.querySelector('[data-builder-action="move-field-down"]').disabled = category.fields.at(-1)?.id === field.id;
    return cached.row;
  }
  const row = buildBuilderPreviewField(field, scope, categoryId);
  cache.fields.set(field.id, {signature, row});
  return row;
}

function buildBuilderPreviewField(field, scope, categoryId) {
  const category = categoryById(categoryId, builderPreviewContext().schema);
  // Clone the shared renderer to keep its exact geometry without its listeners.
  const row = createFieldElement(field, 'builder-preview', categoryId).cloneNode(true);
  row.classList.add('builder-field-row', 'builder-preview-field');
  row.dataset.fieldId = field.id;
  row._fieldHoverCard = builderFieldHoverCard(field.id);
  delete row.dataset.fieldWrapper;
  row.removeAttribute('aria-hidden');
  row.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
    }
    if (node.matches('input:not([type="checkbox"]), textarea')) node.value = '';
  });
  const name = builderPreviewName(field.type === 'spacer' ? scText('مساحة فارغة') : displayLabel(field), 'field', field.id);
  if (field.required) {
    const required = document.createElement('span');
    required.className = 'required-mark';
    required.textContent = '*';
    name.append(required);
  }
  const label = row.querySelector(':scope > label:not(.standalone-check)');
  if (field.type === 'spacer') row.append(name);
  else if (label) label.replaceWith(name);
  else {
    // Checkbox names sit beside their checkbox, at input level.
    const check = row.querySelector(':scope > .standalone-check');
    const line = document.createElement('div');
    line.className = check.className;
    const input = check.querySelector('input');
    input.setAttribute('inert', '');
    line.append(input, name);

    check.replaceWith(line);
  }
  row.querySelectorAll('input, textarea, select').forEach(control => control.setAttribute('inert', ''));
  for (const child of row.children) {
    if (child !== name && !child.contains(name) && !child.classList.contains('field-group-grid')) child.setAttribute('inert', '');
  }
  row.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]), textarea').forEach((control) => {
    control.placeholder = displayLabel(field, "placeholder") || '';
  });
  row.querySelectorAll('select').forEach(control => {
    control.replaceChildren(new Option(displayLabel(field, "placeholder") || '', ''));
    control.value = '';
  });
  row.querySelectorAll('.file-name').forEach(control => {
    if (!control.matches('input')) control.textContent = displayLabel(field, "placeholder") || '';
  });
  row.append(builderPreviewActions('field', field, category));
  builderPreviewContext().decorateField?.(row, field);
  return row;
}

function createBuilderPreviewRelated(category, anchors, rendered, options) {
  const section = document.createElement('section');
  section.className = 'related-section field-full';
  section.dataset.categoryId = category.id;
  section.append(createSectionHeading(category));
  const browser = document.createElement('div');
  browser.className = 'home-tabbed-workspace home-schema-browser related-tab-workspace';
  const rail = document.createElement('div');
  rail.className = 'related-add-row home-schema-browser-tabs';
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', displayLabel(category));
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'home-schema-browser-tab is-active';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'true');
  tab.id = `builder-preview-card-tab-${category.id}`;
  const label = document.createElement('span');
  const titleField = fieldById(category.card_title_field_id, builderPreviewContext().schema);
  label.textContent = displayLabel(titleField) || `${displayLabel(category, "card_name_prefix") || scText('بطاقة')} 1`;
  if (titleField) tab.setAttribute('aria-label', scText`اسم البطاقة من الحقل: ${displayLabel(titleField)}`);
  tab.append(label);
  rail.append(tab);
  const panels = document.createElement('div');
  panels.className = 'related-records home-schema-browser-panels';
  const card = document.createElement('div');
  card.className = 'related-card is-active';
  card.id = `builder-preview-card-${category.id}`;
  card.setAttribute('role', 'tabpanel');
  card.setAttribute('aria-labelledby', tab.id);
  tab.setAttribute('aria-controls', card.id);
  if (category.related_person_enabled) {
    const heading = document.createElement('div');
    heading.className = 'related-card-heading';
    heading.setAttribute('inert', '');
    const workflow = document.createElement('div');
    workflow.className = 'related-person-workflow';
    const question = document.createElement('span');
    question.className = 'related-person-question';
    question.textContent = scText('هل لديه سجل؟');
    const modes = document.createElement('div');
    modes.className = 'related-person-modes';
    [scText('لديه سجل'), scText('ليس لديه سجل')].forEach((label) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'related-person-mode'; button.textContent = label;
      modes.append(button);
    });
    workflow.append(question, modes);
    heading.append(workflow);
    card.append(heading);
  }
  const grid = document.createElement('div');
  grid.className = 'field-grid';
  const children = categoryChildren(category.id, options.schema).filter((child) => child.kind === 'repeatable');
  const addChild = (child, destination) => {
    const nested = createEntryCategorySection(child, anchors, rendered, options);
    if (nested) destination.append(nested);
  };
  appendCategoryFieldLayout(category, grid, field => createBuilderPreviewField(field, 'related', category.id), (field, target) => {
    children.filter((child) => child.parent_field_id === field.id).forEach((child) => addChild(child, target));
  });
  card.append(grid);
  const nested = document.createElement('div');
  nested.className = 'related-card-nested-categories';
  children.filter((child) => !rendered.has(child.id)).forEach((child) => addChild(child, nested));
  if (nested.children.length) card.append(nested);
  panels.append(card);
  browser.append(rail, panels);
  section.append(browser);
  return section;
}

function renderBuilderPreview(context = builderPreviewContext()) {
  const previous = activeBuilderPreviewContext;
  activeBuilderPreviewContext = context;
  try { return withSchemaRenderIndex(context.schema, renderBuilderPreviewContents); }
  finally { activeBuilderPreviewContext = previous; }
}

function renderBuilderPreviewContents() {
  const context = builderPreviewContext();
  const {root, schema, cache, schemaId} = context;
  const signature = JSON.stringify([schemaId, schema.app, schema.categories, schema.conditions]);
  if (cache.signature === signature && root.childElementCount) return;
  if (cache.schemaId !== schemaId) {
    cache.fields.clear();
    cache.sections.clear();
    cache.schemaId = schemaId;
  }
  const fieldIds = new Set(allFields(schema, true).map(({field}) => field.id));
  for (const id of cache.fields.keys()) {
    if (!fieldIds.has(id)) cache.fields.delete(id);
  }
  const activeCategory = root.dataset.activeMainCategory;
  const selected = root.dataset.selectedItem;
  const focusedAction = root.contains(document.activeElement) ? document.activeElement.dataset.builderAction : null;
  root.classList.add('builder-layout-preview');
  if (root === elements.builderCategories) elements.noCategoriesMessage.hidden = schema.categories.length > 0;
  const anchors = new Map([...anchoredRelatedCategories(schema)].map(([id, categories]) => [id, categories.filter(category => category.parent_category_id)]));
  const anchored = new Set([...anchors.values()].flat().map((item) => item.id));
  const rendered = new Set();
  const options = {schema, fieldFactory:createBuilderPreviewField, relatedFactory:createBuilderPreviewRelated};
  const ids = new Set(schema.categories.map((category) => category.id));
  const roots = schema.categories.filter((category) => !category.parent_category_id || !ids.has(category.parent_category_id));
  const main = [], related = [];
  const sectionsUsed = new Set();
  const categorySignatures = new Map(schema.categories.map(category => [category.id, JSON.stringify(category)]));
  const dependencies = (category, seen = new Set()) => {
    if (seen.has(category.id)) return seen;
    seen.add(category.id);
    categoryChildren(category.id, schema).forEach(child => dependencies(child, seen));
    category.fields.forEach(field => (anchors.get(field.id) || []).forEach(child => dependencies(child, seen)));
    return seen;
  };
  const append = (category) => {
    if (rendered.has(category.id)) return;
    const peers = builderPreviewCategoryPeers(category);
    const signature = JSON.stringify([
      [...dependencies(category)].map(id => categorySignatures.get(id)),
      schema.conditions, schema.app, peers[0]?.id === category.id, peers.at(-1)?.id === category.id,
    ]);
    const cached = cache.sections.get(category.id);
    let section;
    if (cached?.signature === signature && cached.ids.every(id => !rendered.has(id))) {
      section = cached.section;
      cached.ids.forEach(id => rendered.add(id));
    } else {
      section = createEntryCategorySection(category, anchors, rendered, options);
      if (!section) return;
      const sections = [section, ...section.querySelectorAll('.form-section, .related-section')];
      sections.forEach(section => {
        const item = categoryById(section.dataset.categoryId, schema);
        section.classList.add('builder-category');
        section.id = context.categoryDomId?.(item) || `builder-category-${item.id}`;
        section.dataset.navigationCategory = item.id;
        section.tabIndex = -1;
        delete section.dataset.entryCategory;
        const heading = section.querySelector(':scope > .section-heading');
        heading.removeAttribute('data-toggle-entry-category');
        heading.removeAttribute('aria-expanded');
        heading.querySelector('h2').replaceChildren(builderPreviewName(displayLabel(item), 'category', item.id));
        section.insertBefore(builderPreviewActions('category', item), heading.nextSibling);
      });
      cache.sections.set(category.id, {signature, section, ids:sections.map(item => item.dataset.categoryId)});
    }
    sectionsUsed.add(category.id);
    if (category.kind === 'main' || !category.parent_category_id) section.dataset.mainCategory = category.id;
    (category.kind === 'main' || !category.parent_category_id ? main : related).push(section);
  };
  roots.filter((category) => !anchored.has(category.id)).forEach(append);
  schema.categories.filter((category) => !rendered.has(category.id)).forEach(append);
  for (const id of cache.sections.keys()) {
    if (!sectionsUsed.has(id)) cache.sections.delete(id);
  }
  const panels = main.filter(section => !categoryById(section.dataset.categoryId, schema).parent_category_id);
  const browser = renderMainCategoryTabs(activeCategory, root, schema, panels);
  const children = [];
  main.forEach(section => {
    if (panels.includes(section)) {
      if (!children.includes(browser)) children.push(browser);
    } else children.push(section);
  });
  reconcileChildElements(root, [...children, ...related]);
  root.querySelectorAll('[data-main-category]').forEach((section) => delete section.dataset.mainCategory);
  root.querySelectorAll('[data-main-category-tab]').forEach((tab) => {
    const id = tab.dataset.mainCategoryTab;
    tab.dataset.previewSelect = `category:${id}`;
    tab.setAttribute('aria-expanded', 'false');
    tab.title = displayLabel(categoryById(id, schema));
    tab.dataset.hoverLabel = categoryById(id, schema).label;
    tab._categoryHoverCard = builderCategoryHoverCard(id);
    tab.querySelector('span')?.removeAttribute('title');
    if (!tab._builderPreviewSelection) {
      tab.addEventListener('click', () => selectBuilderPreviewItem('category', id, true, root));
      tab._builderPreviewSelection = true;
    }
  });
  if (selected && [...root.querySelectorAll('[data-preview-actions]')].some((item) => item.dataset.previewActions === selected)) {
    const [kind, id] = selected.split(':');
    selectBuilderPreviewItem(kind, id, false, root);
    if (focusedAction) {
      const actions = [...root.querySelectorAll('[data-preview-actions]')].find((item) => item.dataset.previewActions === selected);
      const button = actions.querySelector(`[data-builder-action="${focusedAction}"]:not(:disabled)`);
      (button || [...root.querySelectorAll('[data-preview-select]')].find((item) => item.dataset.previewSelect === selected))?.focus({preventScroll:true});
    }
  } else root.dataset.selectedItem = '';
  if (state.mode === 'builder' && root === elements.builderCategories) refreshCategoryNavigation();
  cache.signature = signature;
}
