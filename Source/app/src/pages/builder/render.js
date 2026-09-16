function renderBuilder() {
  return withSchemaRenderIndex(state.draftSchema, renderBuilderContents);
}

function renderBuilderContents() {
  renderBuilderHistoryDialog();
  if (!state.draftSchema) {
    return;
  }
  const draft = state.draftSchema;
  if (elements.builderSummarySchemaName) {
    elements.builderSummarySchemaName.textContent = `إحصاءات ${draft.schema_name || draft.app?.title || "التصميم الحالي"}`;
  }
  elements.categoryCount.textContent = String(draft.categories.length);
  elements.fieldCount.textContent = String(allFields(draft).length);
  elements.recordCount.textContent = String(
    state.schema?.stats?.record_count || 0,
  );
  if (state.builderScope !== "global") {
    renderBuilderCategories();
    renderBuilderConditions();
  }
  if (state.dirty) {
    markDirty();
  } else {
    markClean();
  }
}
