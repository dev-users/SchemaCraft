const SHARED_FILTER_DATE_TYPES = new Set([
  "date_gregorian",
  "date_hijri",
  "date_persian",
  "system_created_at",
  "system_updated_at",
]);

// Search/Excel-filter UI sentinel: never send it to the backend or store it as data.
const SEARCH_ALL_VALUES = "__SC_SEARCH_ALL_NONEMPTY_3__";
function isBlankValueSearch(wrapper) { return ["search", "export"].includes(wrapper.dataset.sharedFilter); }
function addAllValuesSuggestion(suggestions) {
  const button = document.createElement("button"); button.type = "button";
  button.className = "shared-filter-suggestion shared-filter-all-values";
  button.dataset.filterAllValues = "true"; button.textContent = scText("كل القيم");
  suggestions.append(button);
}
function setAllFilterValues(wrapper, selected) {
  wrapper.dataset.allValues = selected ? "true" : "false";
  const badge = wrapper.querySelector("[data-all-values-state]");
  if (badge) badge.hidden = !selected;
}
function sharedFilterField(schema, fieldId) {
  for (const category of schema?.categories || []) {
    const field = (category.fields || []).find((candidate) => candidate.id === fieldId);
    if (field) return { category, field };
  }
  return null;
}

function sharedFilterActiveOptions(field) {
  if (field.type === "checkbox") {
    return [{ id: "true", label: checkboxDisplayMeaning(field, true) }, { id: "false", label: checkboxDisplayMeaning(field, false) }];
  }
  return (field.options || []).filter((option) => option.active !== false);
}

function sharedFilterSourceToken(sourceField, sourceControl) {
  if (!sourceField || !sourceControl) return "";
  const value = sourceControl.value;
  if (sourceField.type === "checkbox") return value;
  return value || "";
}

function sharedAllowedFilterOptions(field, schema, container) {
  const all = sharedFilterActiveOptions(field);
  const dependency = field.option_filter;
  if (!dependency?.source_field_id) return all;
  const sourceEntry = sharedFilterField(schema, dependency.source_field_id);
  const sourceControl = container.querySelector(
    `[data-shared-filter][data-field-id="${attributeSafe(dependency.source_field_id)}"] [data-filter-value]`,
  );
  if (!sourceEntry || !sourceControl) return all;
  const token = sharedFilterSourceToken(sourceEntry.field, sourceControl);
  if (!token || token === SEARCH_ALL_VALUES) return all;
  const mapping = dependency.mappings?.[token];
  if (!mapping) return dependency.unmatched === "none" ? [] : all;
  const allowed = new Set(mapping);
  return all.filter((option) => allowed.has(option.id));
}

function sharedFilterValueControl(field) {
  if (["select", "yes_no", "checkbox", "checkbox_group"].includes(field.type) && !field.record_options) {
    const select = document.createElement("select");
    select.className = "control shared-filter-value";
    select.dataset.filterValue = "true";
    if (field.type === "checkbox_group") {
      select.multiple = true;
      select.size = Math.min(6, Math.max(2, sharedFilterActiveOptions(field).length));
    } else {
      select.append(new Option(scText("— الكل —"), ""));
    }
    return select;
  }
  const input = document.createElement("input");
  input.className = "control shared-filter-value";
  input.dataset.filterValue = "true";
  input.autocomplete = "off";
  if (field.type === "number" && (field.number_behavior?.storage_mode || field.number_behavior?.storage) !== "text") {
    input.type = "number";
    input.step = "any";
  } else if (field.type === "date_gregorian") {
    input.type = "date";
  } else {
    input.type = "text";
    if (SHARED_FILTER_DATE_TYPES.has(field.type)) input.placeholder = "YYYY-MM-DD";
  }
  return input;
}

function sharedFilterOperator(field) {
  if ((field.type !== "number" || (field.number_behavior?.storage_mode || field.number_behavior?.storage) === "text") && !SHARED_FILTER_DATE_TYPES.has(field.type)) return null;
  const select = document.createElement("select");
  select.className = "control shared-filter-operator";
  select.dataset.filterOperator = "true";
  const options = field.type === "number"
    ? [["equals", "="], ["greater_than", ">"], ["less_than", "<"], ["greater_or_equal", "≥"], ["less_or_equal", "≤"], ["between", scText("بين")]]
    : [["equals", "="], ["before", scText("قبل")], ["after", scText("بعد")], ["between", scText("بين")]];
  options.forEach(([value, label]) => select.append(new Option(label, value)));
  return select;
}

function populateSharedFilterOptions(wrapper, schema, container) {
  const entry = sharedFilterField(schema, wrapper.dataset.fieldId);
  const control = wrapper.querySelector("[data-filter-value]");
  if (!entry || !control || control.tagName !== "SELECT") return;
  const previous = new Set([...control.selectedOptions].map((option) => option.value));
  const multiple = control.multiple;
  control.replaceChildren();
  if (!multiple) control.append(new Option(isBlankValueSearch(wrapper) ? scText("— فارغ —") : scText("— الكل —"), ""));
  if (isBlankValueSearch(wrapper)) { const all = new Option(scText("كل القيم"), SEARCH_ALL_VALUES); all.selected = previous.has(SEARCH_ALL_VALUES); control.append(all); }
  sharedAllowedFilterOptions(entry.field, schema, container).forEach((option) => {
    const item = new Option(displayLabel(option), option.id);
    item.selected = previous.has(option.id);
    control.append(item);
  });
  if (!multiple && previous.size) control.value = [...previous][0];
}

function refreshSharedDependentFilters(container, schema) {
  container.querySelectorAll("[data-shared-filter]").forEach((wrapper) => {
    const entry = sharedFilterField(schema, wrapper.dataset.fieldId);
    if (entry?.field.option_filter) populateSharedFilterOptions(wrapper, schema, container);
  });
}

function sharedFilterSuggestions(wrapper, schemaId, query = "") {
  const control = wrapper.querySelector("[data-filter-value]");
  const suggestions = wrapper.querySelector("[data-filter-suggestions]");
  if (!control || !suggestions || control.tagName === "SELECT") return;
  // Make the all-values action available for every input type, even without suggestions.
  suggestions.replaceChildren();
  if (isBlankValueSearch(wrapper)) addAllValuesSuggestion(suggestions);
  suggestions.hidden = !suggestions.childElementCount;
  const requestId = String(Number(wrapper.dataset.suggestionRequest || 0) + 1);
  wrapper.dataset.suggestionRequest = requestId;
  const parameters = new URLSearchParams({
    field_id: wrapper.dataset.fieldId,
    query,
    limit: "30",
  });
  const headers = schemaId ? { "X-Schema-ID": schemaId } : {};
  void fetch(`/api/search/field-values?${parameters}`, { cache: "no-store", headers })
    .then(responseJson)
    .then((result) => {
      if (wrapper.dataset.suggestionRequest !== requestId) return;
      suggestions.replaceChildren();
      if (isBlankValueSearch(wrapper)) addAllValuesSuggestion(suggestions);
      (result.values || []).forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "shared-filter-suggestion";
        button.dataset.filterSuggestionValue = String(item.value ?? "");
        const label = document.createElement("span");
        label.textContent = displayFieldValue(displayFieldDefinition(wrapper.dataset.fieldId, schemaId), item.value);
        const count = document.createElement("small");
        count.textContent = String(item.count || 0);
        button.append(label, count);
        suggestions.append(button);
      });
      if (!suggestions.childElementCount) {
        const empty = document.createElement("span");
        empty.className = "shared-filter-suggestions-empty";
        empty.textContent = scText("لا توجد قيم مطابقة.");
        suggestions.append(empty);
      }
      suggestions.hidden = false;
    })
    .catch(() => { if (wrapper.dataset.suggestionRequest === requestId) suggestions.hidden = !suggestions.childElementCount; });
}

function applySharedFilterCriterion(wrapper, criterion) {
  if (criterion == null || criterion === "") return;
  const empty = wrapper.querySelector("[data-filter-empty]");
  const notEmpty = wrapper.querySelector("[data-filter-not-empty]");
  const operator = wrapper.querySelector("[data-filter-operator]");
  const control = wrapper.querySelector("[data-filter-value]");
  const upper = wrapper.querySelector("[data-filter-upper]");
  if (criterion && typeof criterion === "object" && !Array.isArray(criterion)) {
    const selectedOperator = criterion.empty === true ? "empty" : criterion.operator || "";
    if (empty) empty.checked = selectedOperator === "empty";
    if (notEmpty) notEmpty.checked = selectedOperator === "not_empty";
    if (isBlankValueSearch(wrapper)) setAllFilterValues(wrapper, selectedOperator === "not_empty");
    if (operator && !["empty", "not_empty"].includes(selectedOperator)) operator.value = selectedOperator || "equals";
    if (Object.prototype.hasOwnProperty.call(criterion, "value")) control.value = criterion.value ?? "";
    if (upper && Object.prototype.hasOwnProperty.call(criterion, "to")) upper.value = criterion.to ?? "";
    const values = Array.isArray(criterion.values) ? criterion.values : [];
    if (control.multiple) [...control.options].forEach((option) => { option.selected = values.includes(option.value); });
  } else if (Array.isArray(criterion) && control.multiple) {
    [...control.options].forEach((option) => { option.selected = criterion.includes(option.value); });
  } else {
    control.value = criterion;
  }
  if (isBlankValueSearch(wrapper) && wrapper.dataset.allValues === "true" && control.tagName === "SELECT") {
    [...control.options].forEach(option => { option.selected = option.value === SEARCH_ALL_VALUES; });
  }
  const disabled = !!(empty?.checked || notEmpty?.checked);
  [operator, control, upper].filter(Boolean).forEach((item) => { item.disabled = disabled; });
  if (upper) upper.hidden = operator?.value !== "between";
}

function createSharedFilterControl(field, schema, container, criterion, options) {
  const wrapper = document.createElement("section");
  wrapper.className = "field categorized-filter-control shared-filter-control";
  wrapper.dataset.sharedFilter = options.context || "shared";
  wrapper.dataset.fieldId = field.id;
  const heading = document.createElement("button");
  heading.type = "button";
  heading.className = "shared-filter-label";
  heading.dataset.removeSharedFilter = field.id;
  heading.title = scText("انقر لإزالة هذا المرشح");
  heading.textContent = displayLabel(field);
  wrapper.append(heading);

  const row = document.createElement("div");
  row.className = "shared-filter-input-row";
  const operator = sharedFilterOperator(field);
  const control = sharedFilterValueControl(field);
  if (operator) row.append(operator);
  row.append(control);
  const upper = control.cloneNode(true);
  upper.removeAttribute("data-filter-value");
  upper.dataset.filterUpper = "true";
  upper.placeholder = scText("إلى");
  upper.hidden = true;
  if (operator) row.append(upper);
  wrapper.append(row);

  const flags = document.createElement("div");
  flags.className = "shared-filter-flags";
  [["empty", scText("حقول فارغة")], ["notEmpty", scText("حقول غير فارغة")]].forEach(([kind, labelText]) => {
    const label = document.createElement("label");
    label.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset[kind === "empty" ? "filterEmpty" : "filterNotEmpty"] = field.id;
    label.append(input, document.createTextNode(labelText));
    flags.append(label);
  });
  if (!isBlankValueSearch(wrapper)) wrapper.append(flags);
  else {
    const badge = document.createElement("button"); badge.type = "button";
    badge.className = "shared-filter-all-state button button-quiet"; badge.dataset.allValuesState = "true";
    badge.textContent = scText("كل القيم"); badge.title = scText("انقر للعودة إلى البحث عن قيمة فارغة"); badge.hidden = true;
    badge.addEventListener("click", () => { setAllFilterValues(wrapper, false); control.value = ""; control.dispatchEvent(new Event("change", {bubbles:true})); });
    wrapper.append(badge);
  }

  const suggestions = document.createElement("div");
  suggestions.className = "shared-filter-suggestions";
  suggestions.dataset.filterSuggestions = field.id;
  suggestions.hidden = true;
  wrapper.append(suggestions);
  container.append(wrapper);
  if (control.tagName === "SELECT") populateSharedFilterOptions(wrapper, schema, options.rootContainer);
  applySharedFilterCriterion(wrapper, criterion);
  return wrapper;
}

function renderSharedFilterControls(options) {
  const { container, schema, fieldIds } = options;
  const previous = options.criteria || sharedFilterCriteria(container);
  container.replaceChildren();
  const selected = new Set(fieldIds || []);
  for (const category of schema?.categories || []) {
    const fields = (category.fields || []).filter((field) => !isLayoutField(field) && selected.has(field.id));
    if (!fields.length) continue;
    const { group, grid } = createSchemaSearchFilterCategory(displayLabel(category), category.id, options.context || "shared");
    group.classList.add("shared-filter-category");
    container.append(group);
    fields.forEach((field) => createSharedFilterControl(field, schema, grid, previous[field.id], { ...options, rootContainer: container }));
  }
  container.querySelectorAll("[data-filter-operator]").forEach((operator) => {
    operator.addEventListener("change", () => {
      const wrapper = operator.closest("[data-shared-filter]");
      const upper = wrapper.querySelector("[data-filter-upper]");
      upper.hidden = operator.value !== "between";
      if (upper.hidden) upper.value = "";
    });
  });
  container.querySelectorAll("[data-filter-empty], [data-filter-not-empty]").forEach((flag) => {
    flag.addEventListener("change", () => {
      const wrapper = flag.closest("[data-shared-filter]");
      const other = wrapper.querySelector(flag.matches("[data-filter-empty]") ? "[data-filter-not-empty]" : "[data-filter-empty]");
      if (flag.checked) other.checked = false;
      const disabled = flag.checked || other.checked;
      wrapper.querySelectorAll("[data-filter-operator], [data-filter-value], [data-filter-upper]").forEach((item) => { item.disabled = disabled; });
    });
  });
  refreshSharedDependentFilters(container, schema);
  updateCategorizedFilterScrolling(container);
}

function sharedFilterCriteria(container) {
  const criteria = {};
  container?.querySelectorAll("[data-shared-filter]").forEach((wrapper) => {
    const fieldId = wrapper.dataset.fieldId;
    if (wrapper.querySelector("[data-filter-empty]")?.checked) {
      criteria[fieldId] = { operator: "empty" };
      return;
    }
    if (wrapper.querySelector("[data-filter-not-empty]")?.checked) {
      criteria[fieldId] = { operator: "not_empty" };
      return;
    }
    const control = wrapper.querySelector("[data-filter-value]");
    const operator = wrapper.querySelector("[data-filter-operator]")?.value || "";
    const selectedValues = control.multiple ? [...control.selectedOptions].map(o=>o.value) : [control.value];
    if (isBlankValueSearch(wrapper) && (wrapper.dataset.allValues === "true" || selectedValues.includes(SEARCH_ALL_VALUES))) {
      criteria[fieldId] = { operator: "not_empty" }; return;
    }
    if (control.multiple) {
      const values = [...control.selectedOptions].map((option) => option.value).filter(Boolean);
      if (values.length) criteria[fieldId] = { values };
      else if (isBlankValueSearch(wrapper)) criteria[fieldId] = { operator: "empty" };
      return;
    }
    const value = control.value.trim();
    if (!value) { if (isBlankValueSearch(wrapper)) criteria[fieldId] = { operator: "empty" }; return; }
    if (operator) {
      const criterion = { operator, value };
      if (operator === "between") {
        const upper = wrapper.querySelector("[data-filter-upper]")?.value.trim() || "";
        if (!upper) return;
        criterion.to = upper;
      }
      criteria[fieldId] = criterion;
    } else {
      criteria[fieldId] = value;
    }
  });
  return criteria;
}

function clearSharedFilterValues(container) {
  container?.querySelectorAll("[data-shared-filter]").forEach(w => setAllFilterValues(w, false));
  container?.querySelectorAll("[data-filter-empty], [data-filter-not-empty]").forEach((input) => { input.checked = false; });
  container?.querySelectorAll("[data-filter-value], [data-filter-upper]").forEach((control) => {
    control.disabled = false;
    if (control.multiple) [...control.options].forEach((option) => { option.selected = false; });
    else control.value = "";
  });
  container?.querySelectorAll("[data-filter-operator]").forEach((control) => { control.disabled = false; control.value = "equals"; });
  container?.querySelectorAll("[data-filter-upper]").forEach((control) => { control.hidden = true; });
}

function installSharedFilterInteractions(container, options) {
  container?.addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-remove-shared-filter]");
    if (remove) {
      if (!(await requestConfirmation(scText`إزالة المرشح «${remove.textContent}»؟`, {
        title: scText("إزالة مرشح"),
        confirmLabel: scText("إزالة المرشح"),
      }))) return;
      options.onRemove?.(remove.dataset.removeSharedFilter);
      return;
    }
    const all = event.target.closest("[data-filter-all-values]");
    if (all) {
      const wrapper = all.closest("[data-shared-filter]"); const control = wrapper.querySelector("[data-filter-value]");
      control.value = ""; setAllFilterValues(wrapper, true);
      wrapper.querySelector("[data-filter-suggestions]").hidden = true;
      control.dispatchEvent(new Event("change", {bubbles:true})); return;
    }
    const suggestion = event.target.closest("[data-filter-suggestion-value]");
    if (suggestion) {
      const wrapper = suggestion.closest("[data-shared-filter]");
      setAllFilterValues(wrapper, false);
      wrapper.querySelector("[data-filter-value]").value = suggestion.dataset.filterSuggestionValue;
      wrapper.querySelector("[data-filter-suggestions]").hidden = true;
      wrapper.querySelector("[data-filter-value]").dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  container?.addEventListener("focusin", (event) => {
    const control = event.target.closest("[data-filter-value]");
    const schemaId = typeof options.schemaId === "function" ? options.schemaId() : options.schemaId;
    if (control && control.tagName !== "SELECT") sharedFilterSuggestions(control.closest("[data-shared-filter]"), schemaId, control.value);
  });
  let timer = null;
  container?.addEventListener("input", (event) => {
    const control = event.target.closest("[data-filter-value]");
    if (!control) return;
    setAllFilterValues(control.closest("[data-shared-filter]"), false);
    if (control.tagName === "SELECT") return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const schemaId = typeof options.schemaId === "function" ? options.schemaId() : options.schemaId;
      sharedFilterSuggestions(control.closest("[data-shared-filter]"), schemaId, control.value);
    }, 120);
  });
  container?.addEventListener("change", (event) => {
    const control = event.target.closest("[data-filter-value]");
    if (control?.tagName === "SELECT") {
      const wrapper = control.closest("[data-shared-filter]");
      if (isBlankValueSearch(wrapper)) {
        // Selecting ordinary options after All replaces All, and vice versa.
        const selected = [...control.selectedOptions];
        const all = selected.find(o => o.value === SEARCH_ALL_VALUES);
        if (control.multiple && all && selected.length > 1) {
          if (wrapper.dataset.allValues === "true") all.selected = false;
          else selected.forEach(o => { o.selected = o === all; });
        }
        setAllFilterValues(wrapper, [...control.selectedOptions].some(o => o.value === SEARCH_ALL_VALUES));
      }
    }
    const schema = typeof options.schema === "function" ? options.schema() : options.schema;
    if (schema) refreshSharedDependentFilters(container, schema);
  });
  container?.addEventListener("focusout", (event) => {
    const wrapper = event.target.closest("[data-shared-filter]");
    if (!wrapper) return;
    window.setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) wrapper.querySelector("[data-filter-suggestions]").hidden = true;
    }, 100);
  });
}
