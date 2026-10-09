// General definitions use stable preview IDs and their own caches. Dialogs and
// writes still use the original library reference/node keys.
const globalPreviewCaches = {
  categories:{schemaId:null, fields:new Map(), sections:new Map(), signature:null},
  fields:{schemaId:null, fields:new Map(), sections:new Map(), signature:null},
};
let globalDefinitionsRenderSignature = null;

function globalPreviewId(ref, key) {
  return `gp-${ref}-${Array.from(String(key), char => char.codePointAt(0).toString(16)).join('-')}`;
}

function globalPreviewModel() {
  const categories = [], targets = new Map();
  const definitions = Object.values(state.globalDefinitions?.categories || {});
  definitions.forEach((item, index) => {
    const tree = globalCategoryTree(item.definition || {});
    const root = tree.find(node => !node.parent_key) || tree[0];
    const categoryIds = new Map(tree.map(node => [node.key, globalPreviewId(item.id, `category:${node.key}`)]));
    const fieldIds = new Map(tree.flatMap(node => (node.fields || []).map(entry => [entry.key, globalPreviewId(item.id, `field:${entry.key}`)])));
    tree.forEach(node => {
      const id = categoryIds.get(node.key);
      const siblings = node === root ? definitions : tree.filter(peer => (peer.parent_key || '') === (node.parent_key || ''));
      const position = node === root ? index : siblings.indexOf(node);
      const category = {...node.definition, id, label:node.definition?.label || item.definition?.label || scText('فئة عامة'), kind:node.definition?.kind || 'main',
        parent_category_id:categoryIds.get(node.parent_key) || null,
        parent_field_id:fieldIds.get(node.parent_field_key || node.definition?.parent_field_key) || null,
        anchor_field_id:fieldIds.get(node.anchor_field_key) || null,
        _globalFirst:position === 0, _globalLast:position === siblings.length - 1,
        fields:(node.fields || []).map(entry => {
          const fieldId = fieldIds.get(entry.key);
          targets.set(fieldId, {kind:'field', ref:item.id, nodeKey:node.key, fieldKey:entry.key, domId:globalEmbeddedFieldTargetId(item.id, entry.key)});
          const result={...(entry.definition || entry), id:fieldId};if(result.composition?.field_keys){result.composition.field_ids=result.composition.field_keys.map(key=>fieldIds.get(key)||'');delete result.composition.field_keys;}if(result.type==='field_group'){result.field_ids=(result.field_keys||result.field_ids||[]).map(key=>fieldIds.get(key)).filter(Boolean);delete result.field_keys;}return result;
        }),
      };
      targets.set(id, {kind:'category', ref:item.id, nodeKey:node.key, root:node === root,
        domId:node === root ? `global-definition-category-${item.id}` : `global-category-node-${item.id}-${node.key}`});
      categories.push(category);
    });
  });
  const standalone = {id:'global-standalone-preview', label:scText('الحقول العامة المنفصلة'), kind:'main', fields:Object.values(state.globalDefinitions?.fields || {}).map(item => {
    const id = globalPreviewId(item.id, 'field');
    targets.set(id, {kind:'field', ref:item.id, standalone:true, domId:`global-definition-field-${item.id}`});
    return {...item.definition, id};
  })};
  targets.set(standalone.id, {virtual:true, domId:'global-standalone-panel'});
  return {categories, standalone, targets};
}

function globalPreviewActions(targets, kind, item, category) {
  const target = targets.get(item.id);
  const actions = document.createElement('div');
  actions.className = 'builder-actions builder-preview-actions';
  actions.dataset.previewActions = `${kind}:${item.id}`;
  actions.id = `builder-preview-actions-${item.id}`;
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', scText`إجراءات ${item.label || scText('مساحة فارغة')}`);
  actions.hidden = true;
  if (!target || target.virtual) return actions;
  const remove = () => target.standalone || target.root
    ? deleteGlobalDefinition(kind, target.ref)
    : kind === 'field' ? updateEmbeddedGlobalField(target.ref, target.nodeKey, target.fieldKey, 'delete')
      : updateGlobalCategoryNode(target.ref, target.nodeKey, 'delete');
  const edit = () => target.standalone
    ? openGlobalDefinitionEditor('field', target.ref)
    : openGlobalCategoryPackageEditor(kind, target.ref, {nodeKey:target.nodeKey, fieldKey:target.fieldKey});
  const move = direction => target.standalone || target.root
    ? reorderGlobalDefinition(kind, target.ref, direction)
    : kind === 'field' ? updateEmbeddedGlobalField(target.ref, target.nodeKey, target.fieldKey, direction)
      : updateGlobalCategoryNode(target.ref, target.nodeKey, direction);
  const first = kind === 'field' ? category.fields[0]?.id === item.id : item._globalFirst;
  const last = kind === 'field' ? category.fields.at(-1)?.id === item.id : item._globalLast;
  [
    [scText('حذف'), 'trash', remove, 'delete', false],
    [scText('تعديل'), 'edit', edit, 'edit', false],
    [scText('نقل لليمين — السابق في الترتيب'), 'right', () => move('up'), 'move', first, 'up'],
    [scText('نقل لليسار — التالي في الترتيب'), 'left', () => move('down'), 'move', last, 'down'],
  ].forEach(([label, icon, handler, action, disabled, direction]) => {
    const button = globalDefinitionActionButton(label, icon, () => void handler(), action === 'delete');
    button.dataset.builderAction = `${action}-${kind}${direction ? `-${direction}` : ''}`;
    button.disabled = Boolean(disabled);
    actions.append(button);
  });
  if (target.root || target.standalone) actions.append(globalDefinitionActionButton(scText('إضافة للتصميم'), 'plus', () => void addGlobalDefinitionToSchema(kind, target.ref)));
  return actions;
}

function renderGlobalDefinitionPreviews() {
  const model = globalPreviewModel();
  const render = (root, categories, cache, suffix) => renderBuilderPreview({
    root, schema:{categories, conditions:[], app:{}}, cache, schemaId:`general-${suffix}`,
    actions:(kind, item, category) => globalPreviewActions(model.targets, kind, item, category),
    categoryDomId:item => model.targets.get(item.id)?.domId,
    decorateField:(row, field) => {
      const target = model.targets.get(field.id);
      row.id = target.domId;
      row.tabIndex = -1;
      row.dataset.globalDefinitionKind = 'field';
      row.dataset.globalDefinitionId = target.ref;
      if (target.fieldKey) row.dataset.globalFieldKey = target.fieldKey;
    },
  });
  render(elements.globalCategoryList, [...model.categories, model.standalone], globalPreviewCaches.categories, 'categories');
  elements.globalFieldList.replaceChildren();
  elements.globalFieldList.closest('.builder-panel').hidden = true;
}
