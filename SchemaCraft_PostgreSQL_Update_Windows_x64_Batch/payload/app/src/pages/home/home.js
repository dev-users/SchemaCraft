function readLocalHistory(key, maximum = 500) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, maximum) : [];
  } catch (_error) {
    return [];
  }
}

function writeLocalHistory(key, entries, maximum = 500) {
  try { localStorage.setItem(key, JSON.stringify(entries.slice(0, maximum))); } catch (_error) { /* local recents are optional */ }
}

function readRecentRecords() {
  return Array.isArray(state.recentRecordHistory)
    ? state.recentRecordHistory.slice(0, 500)
    : readLocalHistory(RECENT_RECORDS_STORAGE_KEY, 500);
}

function writeRecentRecordHistory(entries) {
  if (Array.isArray(state.recentRecordHistory)) state.recentRecordHistory = entries.slice(0, 500);
  writeLocalHistory(RECENT_RECORDS_STORAGE_KEY, entries);
}

function rememberRecentRecord(record) {
  const code = record?.record_code;
  if (!code) return;
  const schemaId = state.activeSchemaId || "legacy";
  const current = readRecentRecords().filter((item) => item.code !== code || (item.schema_id || "legacy") !== schemaId);
  current.unshift({ code, title: record.title && record.title !== code ? record.title : "", schema_id: schemaId, schema_name: state.schema?.schema_name || "", opened_at: new Date().toISOString() });
  writeRecentRecordHistory(current);
  renderEntryRecentRecords();
  if (state.mode === "home") renderRecentRecords();
}

function removeRecentRecordHistory(code, schemaId) {
  const current = readRecentRecords().filter(
    (item) => item.code !== code || (item.schema_id || "legacy") !== schemaId,
  );
  writeRecentRecordHistory(current);
  if (Array.isArray(state.recentRecordHistory)) {
    void fetch(`/api/entry/history/${encodeURIComponent(code)}?schema_id=${encodeURIComponent(schemaId || "legacy")}`, {
      method: "DELETE", cache: "no-store", keepalive: true,
    }).then(responseJson).catch(error => showToast(error.message, "error"));
  }
  renderRecentRecords();
}

function historyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function recentCardTitle(value, fallback) {
  return String(value || fallback || "").replace(/\s+—\s+/g, " ").trim();
}

function emptyDashboard(container, message) {
  if (!container?.ownerDocument) return;
  const empty = container.ownerDocument.createElement("p");
  empty.className = "muted-text dashboard-empty";
  empty.textContent = message;
  container.append(empty);
}

function addHomeRecordTooltips(row) {
  row?.querySelectorAll("strong, small, time").forEach((element) => {
    const fullText = element.textContent.trim();
    if (fullText) element.title = fullText;
  });
}

function dashboardSchemas() {
  const schemas = activeWorkspaceSchemas();
  if (schemas.length) return schemas;
  if (!state.schema) return [];
  return [{
    id: state.activeSchemaId || "legacy",
    name: state.schema.schema_name || state.schema.app?.entity_plural || scText("التصميم الحالي"),
  }];
}

function schemaRecentRecords(schemaId = "") {
  const limit = Number(state.workspaceSettings?.home_entry_history_limit) || 3;
  return readRecentRecords()
    .filter((item) => !schemaId || (item.schema_id || "legacy") === schemaId)
    .slice(0, limit);
}

function renderSchemaHistoryList(container, schemaId = "") {
  container.replaceChildren();
  const recent = schemaRecentRecords(schemaId);
  if (!recent.length) return emptyDashboard(container, scText("لا توجد سجلات مفتوحة مؤخرًا."));
  recent.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dashboard-history-row dashboard-history-detailed dashboard-history-title-action";
    row.dataset.editRecord = item.code;
    row.dataset.recordSchema = schemaId;
    const information = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = recentCardTitle(item.title, scText("سجل بلا اسم محفوظ"));
    const code = document.createElement("small");
    const schemaName = displaySchemaName(item) || displaySchemaName(state.homeSchemaDashboards.get(item.schema_id)?.info) || "";
    code.textContent = schemaId || !schemaName ? item.code : `${schemaName} · ${item.code}`;
    if (schemaId || !schemaName) code.dir = "ltr";
    information.append(title, code);
    const time = document.createElement("time");
    time.textContent = historyDate(item.opened_at);
    row.append(information, time);
    addHomeRecordTooltips(row);
    container.append(row);
  });
}

function renderRecentRecords() {
  elements.recentRecords?.querySelectorAll("[data-schema-history]").forEach((container) => {
    renderSchemaHistoryList(container, container.dataset.schemaHistory);
  });
  renderEntryRecentRecords();
}

function renderEntryRecentRecords() {
  if (!elements.entryRecentRecords) return;
  elements.entryRecentRecords.replaceChildren();
  const recent = readRecentRecords()
    .filter((item) => (item.schema_id || "legacy") === (state.activeSchemaId || "legacy"))
    .slice(0, Number(state.workspaceSettings?.entry_history_limit) || 8);
  if (!recent.length) return emptyDashboard(elements.entryRecentRecords, scText("لا توجد ملفات حديثة."));
  recent.forEach((item) => {
    const card = document.createElement("article");
    card.className = "search-result-card";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result-open";
    button.dataset.editRecord = item.code;
    const title = document.createElement("strong");
    title.className = "search-result-name";
    title.textContent = recentCardTitle(item.title, scText("ملف بلا عنوان"));
    const footer = document.createElement("div");
    footer.className = "search-result-footer";
    const code = document.createElement("button");
    code.type = "button";
    code.className = "search-result-id";
    code.dir = "ltr";
    code.textContent = item.code;
    code.title = scText("نسخ معرّف السجل");
    code.dataset.copyRecordCode = item.code;
    const readonly = document.createElement("button");
    readonly.type = "button";
    readonly.className = "search-result-readonly";
    readonly.dataset.readonlyRecord = item.code;
    readonly.title = scText("فتح للقراءة فقط");
    readonly.setAttribute("aria-label", scText("فتح السجل للقراءة فقط"));
    readonly.append(actionIcon("open"));
    button.append(title);
    footer.append(code, readonly);
    card.append(button, footer);
    elements.entryRecentRecords.append(card);
  });
}

function readHomeChartConfigs() {
  try {
    const payload = JSON.parse(localStorage.getItem(HOME_CHART_CONFIG_STORAGE_KEY) || "{}");
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch (_error) {
    return {};
  }
}

function normalizedHomeChartSlots(saved = {}) {
  const slot = (name, fallbackType, legacyFieldId = "") => {
    const candidate = saved.slots?.[name];
    const type = candidate?.type === "gauge" ? "gauge" : candidate?.type === "bar" ? "bar" : fallbackType;
    return { type, fieldId: candidate?.fieldId || legacyFieldId || "" };
  };
  const legacyField = saved.type && saved.fieldId ? saved.fieldId : "";
  return {
    primary: slot("primary", "bar", saved.barFieldId || (saved.type === "bar" ? legacyField : "")),
    secondary: slot("secondary", "gauge", saved.gaugeFieldId || (saved.type === "gauge" ? legacyField : "")),
  };
}

function writeHomeChartConfig(schemaId, chartSlot, chartType, fieldId) {
  const payload = readHomeChartConfigs();
  const existing = payload[schemaId] && typeof payload[schemaId] === "object" ? payload[schemaId] : {};
  const slots = normalizedHomeChartSlots(existing);
  slots[chartSlot === "secondary" ? "secondary" : "primary"] = {
    type: chartType === "gauge" ? "gauge" : "bar",
    fieldId,
  };
  payload[schemaId] = { slots };
  try { localStorage.setItem(HOME_CHART_CONFIG_STORAGE_KEY, JSON.stringify(payload)); } catch (_error) { /* chart preference is optional */ }
}

function configuredHomeChart(schemaId, chartSlot) {
  const saved = readHomeChartConfigs()[schemaId] || {};
  return normalizedHomeChartSlots(saved)[chartSlot === "secondary" ? "secondary" : "primary"];
}

const HOME_BUILDER_CHART_SOURCES = [
  { id: "category_kind", label: scText("توزيع الفئات: رئيسية ومتكررة") },
  { id: "category_parent", label: scText("توزيع الفئات: مستقلة وذات فئة أم") },
  { id: "category_source", label: scText("مصدر الفئات: عامة وخاصة بالتصميم") },
  { id: "field_location", label: scText("موقع الحقول: رئيسية ومتكررة") },
  { id: "field_parent", label: scText("موقع الحقول حسب تبعية الفئة") },
  { id: "field_source", label: scText("مصدر الحقول: عامة وخاصة بالتصميم") },
  { id: "field_type", label: scText("توزيع أنواع الحقول") },
];

function readHomeBuilderChartConfigs() {
  try {
    const payload = JSON.parse(localStorage.getItem(HOME_BUILDER_CHART_CONFIG_STORAGE_KEY) || "{}");
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch (_error) {
    return {};
  }
}

function normalizedHomeBuilderChartSlots(saved = {}) {
  const slot = (name, fallbackSource) => {
    const candidate = saved.slots?.[name];
    return {
      type: candidate?.type === "gauge" ? "gauge" : "bar",
      source: HOME_BUILDER_CHART_SOURCES.some((item) => item.id === candidate?.source)
        ? candidate.source
        : fallbackSource,
    };
  };
  const legacy = saved.type || saved.source
    ? {
        type: saved.type === "gauge" ? "gauge" : "bar",
        source: HOME_BUILDER_CHART_SOURCES.some((item) => item.id === saved.source)
          ? saved.source
          : "category_kind",
      }
    : null;
  const slots = {
    primary: slot("primary", "category_kind"),
    secondary: slot("secondary", "field_type"),
  };
  if (legacy && !saved.slots?.primary) slots.primary = legacy;
  return slots;
}

function configuredHomeBuilderChart(scopeId, chartSlot = "primary") {
  const saved = readHomeBuilderChartConfigs()[scopeId] || {};
  return normalizedHomeBuilderChartSlots(saved)[chartSlot === "secondary" ? "secondary" : "primary"];
}

function writeHomeBuilderChartConfig(scopeId, chartSlot, chartType, source) {
  const payload = readHomeBuilderChartConfigs();
  const slots = normalizedHomeBuilderChartSlots(payload[scopeId] || {});
  slots[chartSlot === "secondary" ? "secondary" : "primary"] = {
    type: chartType === "gauge" ? "gauge" : "bar",
    source: HOME_BUILDER_CHART_SOURCES.some((item) => item.id === source)
      ? source
      : "category_kind",
  };
  payload[scopeId] = { slots };
  try { localStorage.setItem(HOME_BUILDER_CHART_CONFIG_STORAGE_KEY, JSON.stringify(payload)); } catch (_error) { /* chart preference is optional */ }
}

function homeChartFields(schema, chartType) {
  const fields = [];
  (schema.categories || []).forEach((category) => {
    (category.fields || []).forEach((field) => {
      if (field.type === "file" || SYSTEM_FIELD_TYPES.has(field.type)) return;
      if (chartType === "gauge" && !["select", "yes_no", "checkbox", "checkbox_group"].includes(field.type)) return;
      fields.push({
        id: field.id,
        label: `${displayLabel(category)} — ${displayLabel(field)}`,
        shortLabel: displayLabel(field),
        type: field.type,
      });
    });
  });
  return fields;
}

function homeChartField(schema, config) {
  return homeChartFields(schema, config.type).find((field) => field.id === config.fieldId)
    || homeChartFields(schema, config.type)[0]
    || null;
}

function homeChartColors() {
  return ["#2f78c4", "#34a377", "#e6a23c", "#8c6bd1", "#d85f73", "#36a9ae", "#73839a", "#b77a41"];
}

// Share completed and in-flight counts between charts and custom statistics.
// Dataset signatures change after schema, workbook or archive edits.
const homeValueCache = new Map();
let homeDashboardLoad = null;
async function homeFieldValues(schemaId, fieldId, values = []) {
  const signature = state.homeSchemaDashboards.get(schemaId)?.signature || '';
  const parameters = new URLSearchParams({schema_id:schemaId, field_id:fieldId, limit:'100'});
  values.forEach(value => parameters.append("selected_value", value));
  const key = JSON.stringify([signature, parameters.toString()]);
  if (homeValueCache.has(key)) return homeValueCache.get(key);
  const pending = fetch(`/api/search/field-values?${parameters}`, {cache:'no-store'}).then(responseJson);
  homeValueCache.set(key, pending);
  if (homeValueCache.size > 200) homeValueCache.delete(homeValueCache.keys().next().value);
  try { return await pending; }
  catch (error) { homeValueCache.delete(key); throw error; }
}

function homeChartHoverCard(container, name, values, details = '') {
  const total = values.reduce((sum, item) => sum + Number(item.count || 0), 0);
  container._chartHoverCard = () => ({name, details, legend:values.map((item, index) => ({
    label:item.label, count:Number(item.count || 0),
    percentage:total ? Math.round(Number(item.count || 0) / total * 100) : 0,
    color:homeChartColors()[index % homeChartColors().length],
  }))});
}

function renderHomePercentageChart(container, percentage, numerator, total) {
  const layout = document.createElement("div");
  layout.className = "home-schema-percentage";
  const number = document.createElement("strong");
  number.textContent = `${percentage}%`;
  const progress = document.createElement("progress");
  progress.className = "home-progress-track";
  progress.max = 100;
  progress.value = percentage;
  progress.setAttribute("aria-label", `${percentage}%`);
  const caption = document.createElement("small");
  caption.textContent = scText`${numerator} من ${total}`;
  layout.append(number, progress, caption);
  container.append(layout);
}

function renderHomeGaugeChart(container, values) {
  const colors = homeChartColors();
  const total = values.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (!total) return emptyDashboard(container, scText("لا توجد قيم مسجلة بعد."));
  const layout = document.createElement("div");
  layout.className = "home-schema-gauge-layout";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "home-schema-gauge");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", scText`توزيع القيم، الإجمالي ${total}`);
  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("cx", "60");
  track.setAttribute("cy", "60");
  track.setAttribute("r", "43");
  track.setAttribute("pathLength", "100");
  track.setAttribute("class", "home-schema-gauge-track");
  svg.append(track);
  let offset = 0;
  values.forEach((item, index) => {
    const percentage = (Number(item.count || 0) / total) * 100;
    const segment = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    segment.setAttribute("cx", "60");
    segment.setAttribute("cy", "60");
    segment.setAttribute("r", "43");
    segment.setAttribute("pathLength", "100");
    segment.setAttribute("class", "home-schema-gauge-segment");
    segment.setAttribute("stroke", colors[index % colors.length]);
    segment.setAttribute("stroke-dasharray", `${percentage} ${100 - percentage}`);
    segment.setAttribute("stroke-dashoffset", String(-offset));
    segment.setAttribute("transform", "rotate(-90 60 60)");
    segment.setAttribute("aria-label", `${displayLabel(item)}: ${item.count} (${Math.round(percentage)}%)`);
    svg.append(segment);
    offset += percentage;
  });
  const totalText = document.createElementNS("http://www.w3.org/2000/svg", "text");
  totalText.setAttribute("x", "60");
  totalText.setAttribute("y", "66");
  totalText.setAttribute("class", "home-schema-gauge-total");
  totalText.textContent = String(total);
  svg.append(totalText);
  layout.append(svg);
  container.append(layout);
}

async function renderHomeSchemaChart(schemaId, chartSlot) {
  const dashboard = state.homeSchemaDashboards.get(schemaId);
  const container = [...(elements.recentRecords?.querySelectorAll("[data-schema-chart]") || [])]
    .find((candidate) => candidate.dataset.schemaChart === schemaId && candidate.dataset.homeChartSlot === chartSlot);
  if (!dashboard || !container) return;
  container.replaceChildren();
  delete container._chartHoverCard;
  const config = configuredHomeChart(schemaId, chartSlot);
  const chartType = config.type;
  container.dataset.homeChartType = chartType;
  const selected = homeChartField(dashboard.schema, config);
  if (!selected) return emptyDashboard(container, scText("لا يوجد حقل مناسب لهذا الرسم."));
  const chart = document.createElement("div");
  chart.className = "home-schema-chart-visual";
  container.append(chart);
  try {
    const result = await homeFieldValues(schemaId, selected.id);
    if (!container.isConnected || chart.parentElement !== container) return;
    if (chartType === "gauge") {
      const values = (result.values || []).filter(item => Number(item.count) > 0).map(item => ({...item, label:displayFieldValue(selected, item.value)}));
      renderHomeGaugeChart(chart, values);
      homeChartHoverCard(container, displayLabel(selected), values, scText('توزيع القيم'));
    } else {
      const total = Number(result.record_count ?? dashboard.schema.stats?.record_count ?? 0);
      const numerator = selected.type === "checkbox"
        ? Number(result.checked_record_count ?? 0)
        : Number(result.records_with_value ?? Math.min(total, (result.values || []).reduce((sum, item) => sum + Number(item.count || 0), 0)));
      const percentage = total ? Math.round((numerator / total) * 100) : 0;
      renderHomePercentageChart(chart, percentage, numerator, total);
      homeChartHoverCard(container, displayLabel(selected), [
        {label:selected.type === 'checkbox' ? scText('محدد') : scText('له قيمة'), count:numerator},
        {label:selected.type === 'checkbox' ? scText('غير محدد') : scText('بلا قيمة'), count:Math.max(0,total-numerator)},
      ], scText`${numerator} من ${total} (${percentage}%)`);
    }
  } catch (error) {
    if (!container.isConnected || chart.parentElement !== container) return;
    const panel = container.closest('[data-home-schema]');
    if (panel) delete panel.dataset.chartsLoaded;
    chart.replaceChildren();
    emptyDashboard(chart, error.message);
  }

}

function createSchemaStatTag(label, value) {
  const tag = document.createElement("span");
  tag.className = "home-schema-stat-tag";
  const number = document.createElement("b");
  number.textContent = String(value ?? 0);
  const text = document.createElement("small");
  text.textContent = label;
  tag.append(number, text);
  return tag;
}

function createHomeBrowserTab({ id, label, panelId, datasetKey, destination, schemaId = "" }) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "home-schema-browser-tab";
  tab.id = id;
  tab.dataset[datasetKey] = schemaId || "__global__";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panelId);
  const text = document.createElement("span");
  text.className = "home-schema-browser-tab-label";
  text.dataset.homeTabDestination = destination;
  text.dataset.homeTabSchemaId = schemaId;
  text.textContent = label;
  tab.append(text);
  return tab;
}

function readHomeCustomStats() {
  const payload = state.workspaceSettings?.home_custom_stats;
  return Array.isArray(payload)
    ? payload.filter((item) => item && typeof item === "object").slice(0, 3)
    : [];
}

async function writeHomeCustomStats(configs) {
  const response = await fetch("/api/home/custom-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ home_custom_stats: configs.slice(0, 3) }),
  });
  const result = await responseJson(response);
  state.workspaceSettings.home_custom_stats = result.home_custom_stats || [];
  return state.workspaceSettings.home_custom_stats;
}

async function migrateLegacyHomeCustomStats() {
  if (!builderUnlocked() || readHomeCustomStats().length) return;
  try {
    const legacy = JSON.parse(localStorage.getItem(HOME_CUSTOM_STATS_STORAGE_KEY) || "[]");
    if (!Array.isArray(legacy) || !legacy.length) return;
    await writeHomeCustomStats(legacy);
    localStorage.removeItem(HOME_CUSTOM_STATS_STORAGE_KEY);
  } catch (_error) {
    // A malformed or unavailable legacy preference must not block Home.
  }
}

async function resolveHomeCustomStat(config, valueElement) {
  const selections = Array.isArray(config.selections) ? config.selections : [];
  try {
    const results = await Promise.all(selections.map(async ({ schemaId, fieldId, values = [] }) => {
      return homeFieldValues(schemaId, fieldId, values);
    }));
    if (!valueElement.isConnected) return;
    valueElement.textContent = String(results.reduce((sum, item, index) => {
      const values = selections[index]?.values || [];
      const key = values.length
        ? "matching_record_count"
        : config.calculation === "distinct"
          ? "total_distinct"
          : config.calculation === "checked"
            ? "checked_record_count"
            : "records_with_value";
      return sum + Number(item[key] || 0);
    }, 0));
  } catch (_error) {
    if (valueElement.isConnected) valueElement.textContent = "—";
  }
}

async function loadHomeCustomStatValues(schemaId, fieldId, preferredValues = []) {
  const selector = elements.homeCustomStatSchemaFields.querySelector(`[data-home-custom-stat-values="${schemaId}"]`);
  if (!selector) return;
  selector.replaceChildren(new Option(fieldId ? scText("جاري تحميل القيم…") : scText("اختر الحقل أولًا"), ""));
  selector.disabled = true;
  selector.dataset.loadingField = fieldId;
  if (!fieldId) return;
  try {
    const parameters = new URLSearchParams({ schema_id: schemaId, field_id: fieldId, limit: "100" });
    const response = await fetch(`/api/search/field-values?${parameters}`, { cache: "no-store" });
    const result = await responseJson(response);
    if (!selector.isConnected || selector.dataset.loadingField !== fieldId) return;
    selector.replaceChildren();
    (result.values || []).forEach((item) => {
      const value = String(item.value ?? item.label ?? "");
      selector.append(new Option(`${displayFieldValue(displayFieldDefinition(fieldId, schemaId), item.value)} (${item.count})`, value, false, preferredValues.includes(value)));
    });
    if (!selector.options.length) selector.append(new Option(scText("لا توجد قيم مسجلة"), ""));
    const schemaChoice = elements.homeCustomStatSchemaFields.querySelector(`[data-home-custom-stat-schema="${schemaId}"]`);
    selector.disabled = !schemaChoice?.checked || !result.values?.length;
  } catch (_error) {
    if (!selector.isConnected || selector.dataset.loadingField !== fieldId) return;
    selector.replaceChildren(new Option(scText("تعذّر تحميل القيم"), ""));
    selector.disabled = true;
  }
}

function renderHomeDataOverview(dashboards) {
  const totalRecords = dashboards.reduce((sum, item) => sum + Number(item.schema.stats?.record_count || 0), 0);
  const totalArchived = dashboards.reduce((sum, item) => sum + Number(item.schema.archive_stats?.archived_record_count || 0), 0);
  const totalActive = dashboards.reduce((sum, item) => {
    const records = Number(item.schema.stats?.record_count || 0);
    const archived = Number(item.schema.archive_stats?.archived_record_count || 0);
    return sum + Number(item.schema.archive_stats?.active_record_count ?? Math.max(0, records - archived));
  }, 0);
  const cards = [
    createSchemaStatTag(scText("التصاميم"), dashboards.length),
    createSchemaStatTag(scText("كل السجلات"), totalRecords),
    createSchemaStatTag(scText("المؤرشفة"), totalArchived),
    createSchemaStatTag(scText("غير المؤرشفة"), totalActive),
  ];
  const custom = readHomeCustomStats();
  custom.forEach((config) => {
    const card = document.createElement(builderUnlocked() ? "button" : "span");
    if (card instanceof HTMLButtonElement) card.type = "button";
    card.className = "home-schema-stat-tag home-configurable-stat";
    if (builderUnlocked()) card.dataset.configureHomeStat = config.id;
    else card.classList.add("home-configurable-stat-readonly");
    const value = document.createElement("b");
    value.textContent = "…";
    const label = document.createElement("small");
    label.textContent = displayLabel(config) || scText("إحصاء مخصص");
    card.append(value, label);
    cards.push(card);
    void resolveHomeCustomStat(config, value);
  });
  if (builderUnlocked() && custom.length < 3) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "home-configurable-stat home-add-stat";
    add.dataset.configureHomeStat = "";
    add.textContent = "+";
    add.title = scText("إضافة إحصاء");
    add.setAttribute("aria-label", scText("إضافة إحصاء مخصص"));
    cards.push(add);
  }
  elements.homeDataGeneralTags?.replaceChildren(...cards);
}

function openHomeCustomStatDialog(configId = "") {
  if (!builderUnlocked() || !elements.homeCustomStatDialog || !state.homeSchemaDashboards.size) return;
  const config = readHomeCustomStats().find((item) => item.id === configId) || null;
  state.homeCustomStatEditingId = config?.id || "";
  elements.homeCustomStatLabel.value = config?.label || "";
  elements.homeCustomStatCalculation.value = ["filled", "checked", "distinct"].includes(config?.calculation)
    ? config.calculation
    : "filled";
  elements.deleteHomeCustomStat.hidden = !config;
  const selected = new Map((config?.selections || []).map((item) => [item.schemaId, item]));
  elements.homeCustomStatSchemaFields.replaceChildren();
  state.homeSchemaDashboards.forEach(({ info, schema }, schemaId) => {
    const row = document.createElement("div");
    row.className = "home-custom-stat-schema-row";
    const choice = document.createElement("label");
    choice.className = "check-field";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.homeCustomStatSchema = schemaId;
    checkbox.checked = selected.has(schemaId);
    choice.append(checkbox, document.createTextNode(displaySchemaName(info) || displaySchemaName(schema) || scText("التصميم")));
    const field = document.createElement("select");
    field.className = "control";
    field.dataset.homeCustomStatField = schemaId;
    field.append(new Option(scText("اختر الحقل"), ""));
    homeChartFields(schema, "bar").forEach((item) => field.append(new Option(displayLabel(item), item.id)));
    field.value = selected.get(schemaId)?.fieldId || "";
    field.disabled = !checkbox.checked;
    const valuesField = document.createElement("label");
    valuesField.className = "field home-custom-stat-values-field";
    const valuesLabel = document.createElement("span");
    valuesLabel.textContent = scText("القيم المحتسبة");
    const values = document.createElement("select");
    values.className = "control home-custom-stat-values";
    values.dataset.homeCustomStatValues = schemaId;
    values.multiple = true;
    values.size = 4;
    values.disabled = true;
    valuesField.append(valuesLabel, values);
    const loadValues = () => void loadHomeCustomStatValues(
      schemaId,
      field.value,
      selected.get(schemaId)?.fieldId === field.value ? (selected.get(schemaId)?.values || []).map(String) : [],
    );
    checkbox.addEventListener("change", () => {
      field.disabled = !checkbox.checked;
      if (!checkbox.checked) values.disabled = true;
      else loadValues();
    });
    field.addEventListener("change", loadValues);
    row.append(choice, field, valuesField);
    elements.homeCustomStatSchemaFields.append(row);
    if (checkbox.checked && field.value) loadValues();
  });
  if (!elements.homeCustomStatDialog.open) elements.homeCustomStatDialog.showModal();
}

async function saveHomeCustomStatConfiguration() {
  const label = elements.homeCustomStatLabel.value.trim();
  if (!label) return showToast(scText("اكتب اسم الإحصاء المخصص."), "error");
  const selections = [...elements.homeCustomStatSchemaFields.querySelectorAll("[data-home-custom-stat-schema]:checked")]
    .map((checkbox) => ({
      schemaId: checkbox.dataset.homeCustomStatSchema,
      fieldId: elements.homeCustomStatSchemaFields.querySelector(`[data-home-custom-stat-field="${checkbox.dataset.homeCustomStatSchema}"]`)?.value || "",
      values: [...(elements.homeCustomStatSchemaFields.querySelector(`[data-home-custom-stat-values="${checkbox.dataset.homeCustomStatSchema}"]`)?.selectedOptions || [])]
        .map((option) => option.value)
        .filter(Boolean),
    }))
    .filter((item) => item.fieldId);
  if (!selections.length) return showToast(scText("اختر حقلًا في تصميم واحد على الأقل."), "error");
  if (selections.some((item) => !item.values.length)) return showToast(scText("اختر قيمة واحدة على الأقل لكل حقل محدد."), "error");
  const configs = readHomeCustomStats();
  const next = {
    id: state.homeCustomStatEditingId || `home-stat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    calculation: elements.homeCustomStatCalculation.value,
    selections,
  };
  const index = configs.findIndex((item) => item.id === next.id);
  if (index >= 0) configs[index] = next;
  else if (configs.length < 3) configs.push(next);
  try {
    await writeHomeCustomStats(configs);
    elements.homeCustomStatDialog.close();
    renderHomeDataOverview([...state.homeSchemaDashboards.values()]);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteHomeCustomStatConfiguration() {
  if (!state.homeCustomStatEditingId) return;
  try {
    await writeHomeCustomStats(readHomeCustomStats().filter((item) => item.id !== state.homeCustomStatEditingId));
    elements.homeCustomStatDialog.close();
    renderHomeDataOverview([...state.homeSchemaDashboards.values()]);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function categoryIsGlobal(category) {
  return Boolean(category?.global_ref || category?.global_tree_ref);
}

function fieldIsGlobal(field, category = null) {
  return Boolean(field?.global_ref || field?.global_tree_ref || categoryIsGlobal(category));
}

function structureSnapshotFromEntries(categories, standaloneFields = []) {
  const categoryEntries = categories.map((category) => ({
    ...category,
    kind: category.kind === "repeatable" ? "repeatable" : "main",
    hasParent: Boolean(category.hasParent ?? category.parent_category_id),
    isGeneral: Boolean(category.isGeneral ?? categoryIsGlobal(category)),
    fields: Array.isArray(category.fields) ? category.fields : [],
  }));
  const embeddedFields = categoryEntries.flatMap((category) => category.fields.map((field) => ({
    field,
    category,
    isGeneral: Boolean(field.isGeneral ?? fieldIsGlobal(field, category)),
  })));
  const looseFields = standaloneFields.map((field) => ({ field, category: null, isGeneral: true }));
  const fields = [...embeddedFields, ...looseFields];
  const fieldTypes = new Map();
  fields.forEach(({ field }) => {
    const type = field?.type || "text";
    fieldTypes.set(type, (fieldTypes.get(type) || 0) + 1);
  });
  return {
    categories: {
      total: categoryEntries.length,
      main: categoryEntries.filter((item) => item.kind === "main").length,
      repeated: categoryEntries.filter((item) => item.kind === "repeatable").length,
      independent: categoryEntries.filter((item) => !item.hasParent).length,
      parented: categoryEntries.filter((item) => item.hasParent).length,
      general: categoryEntries.filter((item) => item.isGeneral).length,
      specific: categoryEntries.filter((item) => !item.isGeneral).length,
    },
    fields: {
      total: fields.length,
      main: fields.filter((item) => item.category?.kind === "main").length,
      repeated: fields.filter((item) => item.category?.kind === "repeatable").length,
      independent: fields.filter((item) => item.category && !item.category.hasParent).length,
      parented: fields.filter((item) => item.category?.hasParent).length,
      withCategory: fields.filter((item) => item.category).length,
      withoutCategory: fields.filter((item) => !item.category).length,
      general: fields.filter((item) => item.isGeneral).length,
      specific: fields.filter((item) => !item.isGeneral).length,
    },
    fieldTypes,
  };
}

function schemaStructureSnapshot(schema) {
  return structureSnapshotFromEntries(schema?.categories || []);
}

function globalStructureSnapshot() {
  const definitions = state.globalDefinitions || {};
  const categories = [];
  Object.values(definitions.categories || {}).forEach((item) => {
    const definition = item?.definition || item || {};
    if (Array.isArray(definition.category_tree) && definition.category_tree.length) {
      definition.category_tree.forEach((node) => categories.push({
        ...(node.definition || {}),
        hasParent: Boolean(node.parent_key),
        isGeneral: true,
        fields: (node.fields || []).map((entry) => ({ ...(entry.definition || entry), isGeneral: true })),
      }));
    } else {
      categories.push({ ...definition, hasParent: false, isGeneral: true });
    }
  });
  const standalone = Object.values(definitions.fields || {}).map((item) => ({ ...(item?.definition || item || {}), isGeneral: true }));
  return structureSnapshotFromEntries(categories, standalone);
}

function addSnapshots(left, right) {
  const categoryKeys = ["total", "main", "repeated", "independent", "parented", "general", "specific"];
  const fieldKeys = ["total", "main", "repeated", "independent", "parented", "withCategory", "withoutCategory", "general", "specific"];
  const fieldTypes = new Map(left.fieldTypes);
  right.fieldTypes.forEach((value, key) => fieldTypes.set(key, (fieldTypes.get(key) || 0) + value));
  return {
    categories: Object.fromEntries(categoryKeys.map((key) => [key, Number(left.categories[key] || 0) + Number(right.categories[key] || 0)])),
    fields: Object.fromEntries(fieldKeys.map((key) => [key, Number(left.fields[key] || 0) + Number(right.fields[key] || 0)])),
    fieldTypes,
  };
}

function renderHomeBuilderOverview(dashboards) {
  const global = globalStructureSnapshot();
  let schemaSpecific = structureSnapshotFromEntries([]);
  dashboards.forEach(({ schema }) => {
    const categories = (schema.categories || []).filter((category) => !categoryIsGlobal(category));
    const localSnapshot = structureSnapshotFromEntries(categories.map((category) => ({
      ...category,
      fields: (category.fields || []).filter((field) => !fieldIsGlobal(field, category)),
    })));
    schemaSpecific = addSnapshots(schemaSpecific, localSnapshot);
  });
  const all = addSnapshots(global, schemaSpecific);
  elements.homeBuilderGeneralTags.replaceChildren(
    createBuilderOverviewCount(scText("التصاميم"), dashboards.length),
    createBuilderOverviewBreakdown(scText("الفئات"), all.categories.total, [
      [[scText("المتكررة"), all.categories.repeated], [scText("الرئيسية"), all.categories.main]],
      [[scText("المستقلة"), all.categories.independent], [scText("ذات فئة أم"), all.categories.parented]],
    ]),
    createBuilderOverviewBreakdown(scText("الحقول"), all.fields.total, [
      [[scText("في المتكررة"), all.fields.repeated], [scText("في الرئيسية"), all.fields.main]],
      [[scText("في المستقلة"), all.fields.independent], [scText("في فئات ذات أم"), all.fields.parented]],
    ]),
  );
}

function createBuilderOverviewValue(label, value, className = "") {
  const segment = document.createElement("div");
  segment.className = `home-builder-overview-segment ${className}`.trim();
  const number = document.createElement("b");
  number.textContent = String(value ?? 0);
  const text = document.createElement("small");
  text.textContent = label;
  segment.append(number, text);
  return segment;
}

function createBuilderOverviewCount(label, value) {
  const card = document.createElement("section");
  card.className = "home-builder-overview-card home-builder-overview-count";
  card.append(createBuilderOverviewValue(label, value));
  return card;
}

function updateBuilderOverviewShare(segment, metric, total) {
  const [label, value] = metric;
  const safeValue = Math.max(0, Number(value || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  const percentage = safeTotal ? Math.min(100, Math.round((safeValue / safeTotal) * 100)) : 0;
  segment.querySelector("b").textContent = String(safeValue);
  segment.querySelector("small").textContent = label;
  const pie = segment.querySelector(".home-builder-mini-pie");
  pie.style.setProperty("--home-builder-share", `${percentage}%`);
  pie.setAttribute("aria-label", scText`${label}: ${safeValue} من ${safeTotal}، ${percentage}%`);
}

function createBuilderOverviewShare(metric, alternate, total) {
  const segment = document.createElement("button");
  segment.type = "button";
  segment.className = "home-builder-overview-segment home-builder-overview-share";
  const pie = document.createElement("span");
  pie.className = "home-builder-mini-pie";
  pie.setAttribute("role", "img");
  const number = document.createElement("b");
  const text = document.createElement("small");
  segment.append(pie, number, text);
  segment.setAttribute("aria-pressed", "false");
  segment.addEventListener("click", () => {
    const showingAlternate = segment.getAttribute("aria-pressed") === "true";
    segment.setAttribute("aria-pressed", String(!showingAlternate));
    updateBuilderOverviewShare(segment, showingAlternate ? metric : alternate, total);
  });
  updateBuilderOverviewShare(segment, metric, total);
  return segment;
}

function createBuilderOverviewBreakdown(label, total, metrics) {
  const card = document.createElement("section");
  card.className = "home-builder-overview-card home-builder-overview-breakdown";
  card.append(
    createBuilderOverviewValue(label, total, "home-builder-overview-total"),
    ...metrics.map(([metric, alternate]) => createBuilderOverviewShare(metric, alternate, total)),
  );
  return card;
}

function structureMetricGroup(title, metrics, partitions = []) {
  const group = document.createElement("div");
  group.className = "home-builder-structure-group";
  const total = document.createElement("div");
  total.className = "home-builder-structure-total";
  const totalValue = document.createElement("b");
  totalValue.textContent = String(metrics[0]?.[1] ?? 0);
  const totalLabel = document.createElement("small");
  totalLabel.textContent = title;
  total.append(totalValue, totalLabel);
  group.append(total);
  partitions.forEach((partition) => {
    const row = document.createElement("div");
    row.className = "home-schema-stat-tags home-builder-structure-tag-row";
    row.classList.add("home-builder-structure-partition");
    row.append(...partition.map(([name, value]) => createSchemaStatTag(name, value)));
    group.append(row);
  });
  return group;
}

function renderBuilderStructureStats(snapshot, isGlobal = false) {
  const container = document.createElement("div");
  container.className = "home-builder-structure-stats";
  container.append(
    structureMetricGroup(scText("الفئات"), [
      [scText("الكل"), snapshot.categories.total],
    ], [
      [[scText("رئيسية"), snapshot.categories.main], [scText("متكررة"), snapshot.categories.repeated]],
      [[scText("مستقلة"), snapshot.categories.independent], [scText("ذات فئة أم"), snapshot.categories.parented]],
      ...(!isGlobal ? [[
        [scText("من العام"), snapshot.categories.general],
        [scText("خاصة بالتصميم"), snapshot.categories.specific],
      ]] : []),
    ]),
    structureMetricGroup(scText("الحقول"), [
      [scText("الكل"), snapshot.fields.total],
    ], [
      ...(isGlobal ? [
        [[scText("ضمن فئة"), snapshot.fields.withCategory], [scText("بلا فئة"), snapshot.fields.withoutCategory]],
        [[scText("في الرئيسية"), snapshot.fields.main], [scText("في المتكررة"), snapshot.fields.repeated]],
        [[scText("ضمن فئات مستقلة"), snapshot.fields.independent], [scText("ضمن فئات فرعية"), snapshot.fields.parented]],
      ] : [
        [[scText("في الرئيسية"), snapshot.fields.main], [scText("في المتكررة"), snapshot.fields.repeated]],
        [[scText("ضمن فئات مستقلة"), snapshot.fields.independent], [scText("ضمن فئات فرعية"), snapshot.fields.parented]],
        [[scText("من العام"), snapshot.fields.general], [scText("خاصة بالتصميم"), snapshot.fields.specific]],
      ]),
    ]),
  );
  return container;
}

function builderChartValues(snapshot, source) {
  if (source === "category_parent") return [
    { label: scText("مستقلة"), count: snapshot.categories.independent },
    { label: scText("ذات فئة أم"), count: snapshot.categories.parented },
  ];
  if (source === "category_source") return [
    { label: scText("عامة"), count: snapshot.categories.general },
    { label: scText("خاصة"), count: snapshot.categories.specific },
  ];
  if (source === "field_location") return [
    { label: scText("في الرئيسية"), count: snapshot.fields.main },
    { label: scText("في المتكررة"), count: snapshot.fields.repeated },
    ...(snapshot.fields.withoutCategory ? [{ label: scText("بلا فئة"), count: snapshot.fields.withoutCategory }] : []),
  ];
  if (source === "field_parent") return [
    { label: scText("ضمن فئات مستقلة"), count: snapshot.fields.independent },
    { label: scText("ضمن فئات فرعية"), count: snapshot.fields.parented },
    ...(snapshot.fields.withoutCategory ? [{ label: scText("بلا فئة"), count: snapshot.fields.withoutCategory }] : []),
  ];
  if (source === "field_source") return [
    { label: scText("عامة"), count: snapshot.fields.general },
    { label: scText("خاصة"), count: snapshot.fields.specific },
  ];
  if (source === "field_type") return [...snapshot.fieldTypes.entries()]
    .map(([type, count]) => ({ label: FIELD_TYPE_LABELS[type] || type, count }))
    .sort((left, right) => right.count - left.count);
  return [
    { label: scText("رئيسية"), count: snapshot.categories.main },
    { label: scText("متكررة"), count: snapshot.categories.repeated },
  ];
}

function renderHomeBuilderBarChart(container, values) {
  const total = Math.max(1, values.reduce((sum, item) => sum + Number(item.count || 0), 0));
  const colors = homeChartColors();
  const chart = document.createElement("div");
  chart.className = "home-builder-bar-chart";
  const track = document.createElement("span");
  track.className = "home-builder-bar-track home-builder-stacked-bar";
  values.forEach((item, index) => {
    const percentage = Math.round((Number(item.count || 0) / total) * 100);
    const fill = document.createElement("i");
    fill.style.width = `${percentage}%`;
    fill.style.backgroundColor = colors[index % colors.length];
    fill.title = `${displayLabel(item)}: ${item.count} (${percentage}%)`;
    const percent = document.createElement("b");
    percent.className = "home-builder-bar-percent";
    percent.textContent = `${percentage}%`;
    fill.append(percent);
    track.append(fill);
  });
  chart.append(track);
  container.append(chart);
}

function renderHomeBuilderChart(scopeId, snapshot, chartSlot = "primary") {
  const container = [...(elements.homeBuilderSchemas?.querySelectorAll("[data-builder-chart]") || [])]
    .find((candidate) => candidate.dataset.builderChart === scopeId
      && candidate.dataset.homeBuilderChartSlot === chartSlot);
  if (!container) return;
  container.replaceChildren();
  const config = configuredHomeBuilderChart(scopeId, chartSlot);
  const values = builderChartValues(snapshot, config.source).filter((item) => Number(item.count || 0) > 0);
  const visual = document.createElement("div");
  visual.className = "home-schema-chart-visual";
  container.append(visual);
  if (!values.length) emptyDashboard(visual, scText("لا توجد بيانات بنيوية بعد."));
  else if (config.type === "gauge") renderHomeGaugeChart(visual, values);
  else renderHomeBuilderBarChart(visual, values);
  homeChartHoverCard(container,
    displayLabel(HOME_BUILDER_CHART_SOURCES.find(item => item.id === config.source)) || scText("توزيع البنية"),
    values, scText('توزيع الحقول والفئات'));
}

function selectHomeDataSchema(schemaId) {
  if (!schemaId || !state.homeSchemaDashboards.has(schemaId)) return;
  state.homeDataSchemaId = schemaId;
  elements.homeDataSchemaTabs?.querySelectorAll("[data-home-data-schema]").forEach((tab) => {
    const selected = tab.dataset.homeDataSchema === schemaId;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  elements.recentRecords?.querySelectorAll("[data-home-schema]").forEach((panel) => {
    const selected = panel.dataset.homeSchema === schemaId;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
  const panel = [...elements.recentRecords.querySelectorAll('[data-home-schema]')].find(item => item.dataset.homeSchema === schemaId);
  if (panel && !panel.dataset.chartsLoaded) {
    panel.dataset.chartsLoaded = 'true';
    void renderHomeSchemaChart(schemaId, "primary");
    void renderHomeSchemaChart(schemaId, "secondary");
  }

}

function selectHomeBuilderSchema(schemaId) {
  if (!schemaId || (schemaId !== "__global__" && !state.homeSchemaDashboards.has(schemaId))) return;
  state.homeBuilderSchemaId = schemaId;
  elements.homeBuilderSchemaTabs?.querySelectorAll("[data-home-builder-schema]").forEach((tab) => {
    const selected = tab.dataset.homeBuilderSchema === schemaId;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  elements.homeBuilderSchemas?.querySelectorAll("[data-home-builder-panel]").forEach((panel) => {
    const selected = panel.dataset.homeBuilderPanel === schemaId;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
  const panel = [...elements.homeBuilderSchemas.querySelectorAll('[data-home-builder-panel]')].find(item => item.dataset.homeBuilderPanel === schemaId);
  if (panel?._builderSnapshot && !panel.dataset.chartsLoaded) {
    panel.dataset.chartsLoaded = 'true';
    renderHomeBuilderChart(schemaId, panel._builderSnapshot, 'primary');
    renderHomeBuilderChart(schemaId, panel._builderSnapshot, 'secondary');
  }

}

function renderHomeSchemaDashboards() {
  if (!elements.recentRecords || !elements.homeDataSchemaTabs) return;
  elements.recentRecords.replaceChildren();
  elements.homeDataSchemaTabs.replaceChildren();
  const dashboards = [...state.homeSchemaDashboards.values()];
  renderHomeDataOverview(dashboards);
  elements.homeDataSchemaTabs.hidden = dashboards.length === 0;
  if (!state.homeSchemaDashboards.size) return emptyDashboard(elements.recentRecords, scText("لا توجد تصاميم نشطة."));
  state.homeSchemaDashboards.forEach(({ info, schema }, schemaId) => {
    const tab = createHomeBrowserTab({
      id: `home-data-schema-tab-${schemaId}`,
      label: displaySchemaName(info) || displaySchemaName(schema) || scText("التصميم"),
      panelId: `home-data-schema-panel-${schemaId}`,
      datasetKey: "homeDataSchema",
      destination: "entry",
      schemaId,
    });
    elements.homeDataSchemaTabs.append(tab);
    const panel = document.createElement("article");
    panel.className = "home-schema-panel";
    panel.id = `home-data-schema-panel-${schemaId}`;
    panel.dataset.homeSchema = schemaId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = true;
    const heading = document.createElement("header");
    heading.className = "home-schema-panel-heading home-data-schema-summary";
    const tags = document.createElement("div");
    tags.className = "home-schema-stat-tags";
    tags.append(
      createSchemaStatTag(scText("السجلات"), schema.stats?.record_count),
      createSchemaStatTag(scText("مؤرشفة"), schema.archive_stats?.archived_record_count),
    );
    heading.append(tags);
    const body = document.createElement("div");
    body.className = "home-schema-panel-body home-schema-panel-content";
    const chartButton = (chartSlot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-schema-chart-button";
      button.dataset.configureHomeChart = schemaId;
      button.dataset.schemaChart = schemaId;
      button.dataset.homeChartSlot = chartSlot;
      button.setAttribute("aria-label", scText`إعداد الرسم ${chartSlot === "primary" ? scText("الأول") : scText("الثاني")} لتصميم ${displaySchemaName(info) || displaySchemaName(schema) || scText("التصميم")}`);
      return button;
    };
    const history = document.createElement("div");
    history.className = "home-schema-history home-dashboard-list";
    history.dataset.schemaHistory = schemaId;
    const primaryChart = chartButton("primary");
    const secondaryChart = chartButton("secondary");
    body.append(history, primaryChart, secondaryChart);
    panel.append(heading, body);
    elements.recentRecords.append(panel);
    renderSchemaHistoryList(history, schemaId);

  });
  const selectedSchemaId = state.homeSchemaDashboards.has(state.homeDataSchemaId)
    ? state.homeDataSchemaId
    : state.homeSchemaDashboards.has(state.activeSchemaId)
      ? state.activeSchemaId
      : state.homeSchemaDashboards.keys().next().value;
  selectHomeDataSchema(selectedSchemaId);
}

async function loadHomeSchemaDashboards() {
  if (homeDashboardLoad) return homeDashboardLoad;
  homeDashboardLoad = refreshHomeSchemaDashboards();
  try { return await homeDashboardLoad; }
  finally { homeDashboardLoad = null; }
}

async function refreshHomeSchemaDashboards() {
  const schemas = dashboardSchemas();
  const previous = state.homeSchemaDashboards;
  if (!schemas.length) {
    state.homeSchemaDashboards = new Map();
    renderHomeSchemaDashboards();
    renderHomeBuilderDashboard();
    return;
  }
  if (!previous.size && elements.recentRecords) {
    elements.recentRecords.replaceChildren();
    emptyDashboard(elements.recentRecords, scText("جاري تحميل ملخص التصاميم…"));
  }
  const loaded = new Array(schemas.length);
  let next = 0;
  // Bound concurrent requests: opening dozens of schemas must not flood the server.
  await Promise.all(Array.from({length:Math.min(4, schemas.length)}, async () => {
    while (next < schemas.length) {
      const index = next++, info = schemas[index], cached = previous.get(info.id);
      try {
        const parameters = new URLSearchParams({schema_id:info.id});
        if (cached?.signature) parameters.set('signature', cached.signature);
        const response = await fetch(`/api/home/schema?${parameters}`, {cache:'no-store'});
        const result = await responseJson(response);
        loaded[index] = result.unchanged && cached ? {...cached, info} : {info, schema:result.schema, signature:result.signature};
      } catch (error) {
        if (!cached) throw error;
        loaded[index] = {...cached, info};
        showToast(error.message, 'error');
      }
    }
  }));
  if (JSON.stringify(schemas.map(info => info.id)) !== JSON.stringify(dashboardSchemas().map(info => info.id))) return refreshHomeSchemaDashboards();
  const changed = loaded.length !== previous.size || loaded.some(item => {
    const old = previous.get(item.info.id);
    return !old || old.signature !== item.signature || JSON.stringify(old.info) !== JSON.stringify(item.info);
  });
  state.homeSchemaDashboards = new Map(loaded.map(item => [item.info.id, item]));
  await migrateLegacyHomeCustomStats();
  if (changed || !elements.recentRecords?.querySelector('[data-home-schema]')) {
    renderHomeSchemaDashboards();
    renderHomeBuilderDashboard();
  } else {
    renderRecentRecords();
    renderHomeDataOverview(loaded);
    selectHomeDataSchema(state.homeDataSchemaId);
  }
}

function fillHomeChartFieldChoices(preferredFieldId = "") {
  if (state.homeChartContext === "builder") {
    if (!elements.homeChartField) return;
    elements.homeChartField.replaceChildren();
    HOME_BUILDER_CHART_SOURCES.forEach((item) => elements.homeChartField.append(new Option(displayLabel(item), item.id)));
    elements.homeChartField.value = HOME_BUILDER_CHART_SOURCES.some((item) => item.id === preferredFieldId)
      ? preferredFieldId
      : HOME_BUILDER_CHART_SOURCES[0].id;
    elements.homeChartField.disabled = false;
    elements.applyHomeChart.disabled = false;
    if (elements.homeChartSourceLabel) elements.homeChartSourceLabel.textContent = scText("البيانات المعروضة");
    return;
  }
  const dashboard = state.homeSchemaDashboards.get(state.homeChartSchemaId);
  if (!dashboard || !elements.homeChartField) return;
  if (elements.homeChartSourceLabel) elements.homeChartSourceLabel.textContent = scText("الحقل");
  const fields = homeChartFields(dashboard.schema, state.homeChartType);
  elements.homeChartField.replaceChildren();
  fields.forEach((field) => elements.homeChartField.append(new Option(displayLabel(field), field.id)));
  elements.homeChartField.value = fields.some((field) => field.id === preferredFieldId)
    ? preferredFieldId
    : fields[0]?.id || "";
  if (!fields.length) elements.homeChartField.append(new Option(scText("لا يوجد حقل مناسب"), ""));
  elements.homeChartField.disabled = !fields.length;
  elements.applyHomeChart.disabled = !fields.length;
}

function openHomeChartDialog(schemaId, chartSlot = "primary") {
  const dashboard = state.homeSchemaDashboards.get(schemaId);
  if (!dashboard || !elements.homeChartDialog) return;
  state.homeChartContext = "data";
  state.homeChartSchemaId = schemaId;
  state.homeChartSlot = chartSlot === "secondary" ? "secondary" : "primary";
  const config = configuredHomeChart(schemaId, state.homeChartSlot);
  state.homeChartType = config.type;
  elements.homeChartDialogSchema.textContent = scText`${displaySchemaName(dashboard.info) || displaySchemaName(dashboard.schema) || scText("التصميم")} — الرسم ${state.homeChartSlot === "primary" ? scText("الأول") : scText("الثاني")}`;
  elements.homeChartType.value = state.homeChartType;
  fillHomeChartFieldChoices(config.fieldId);
  if (!elements.homeChartDialog.open) elements.homeChartDialog.showModal();
}

function openHomeBuilderChartDialog(scopeId, chartSlot = "primary") {
  if (!elements.homeChartDialog) return;
  const isGlobal = scopeId === "__global__";
  const dashboard = isGlobal ? null : state.homeSchemaDashboards.get(scopeId);
  if (!isGlobal && !dashboard) return;
  state.homeChartContext = "builder";
  state.homeBuilderChartScope = scopeId;
  state.homeBuilderChartSlot = chartSlot === "secondary" ? "secondary" : "primary";
  const config = configuredHomeBuilderChart(scopeId, state.homeBuilderChartSlot);
  state.homeChartType = config.type;
  const scopeLabel = isGlobal
    ? scText("الحقول والفئات العامة")
    : (displaySchemaName(dashboard.info) || displaySchemaName(dashboard.schema) || scText("التصميم"));
  elements.homeChartDialogSchema.textContent = scText`${scopeLabel} — الرسم ${state.homeBuilderChartSlot === "primary" ? scText("الأول") : scText("الثاني")}`;
  elements.homeChartType.value = config.type;
  fillHomeChartFieldChoices(config.source);
  if (!elements.homeChartDialog.open) elements.homeChartDialog.showModal();
}

function applyHomeChartConfiguration() {
  if (!elements.homeChartField.value) return;
  state.homeChartType = elements.homeChartType.value === "gauge" ? "gauge" : "bar";
  if (state.homeChartContext === "builder") {
    if (!state.homeBuilderChartScope) return;
    writeHomeBuilderChartConfig(state.homeBuilderChartScope, state.homeBuilderChartSlot, state.homeChartType, elements.homeChartField.value);
    if (elements.homeChartDialog.open) elements.homeChartDialog.close();
    const snapshot = state.homeBuilderChartScope === "__global__"
      ? globalStructureSnapshot()
      : schemaStructureSnapshot(state.homeSchemaDashboards.get(state.homeBuilderChartScope)?.schema);
    renderHomeBuilderChart(state.homeBuilderChartScope, snapshot, state.homeBuilderChartSlot);
    return;
  }
  if (!state.homeChartSchemaId) return;
  writeHomeChartConfig(state.homeChartSchemaId, state.homeChartSlot, state.homeChartType, elements.homeChartField.value);
  if (elements.homeChartDialog.open) elements.homeChartDialog.close();
  void renderHomeSchemaChart(state.homeChartSchemaId, state.homeChartSlot);
}

function readRecentSearches() {
  return Array.isArray(state.searchHistoryEntries) ? state.searchHistoryEntries : [];
}

function rememberSearchHistory(entry) {
  const optimistic = { id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`, created_at: new Date().toISOString(), ...entry };
  state.searchHistoryEntries = [optimistic, ...readRecentSearches()];
  renderRecentSearches();
  void fetch("/api/search/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).then(responseJson).then((result) => {
    state.searchHistoryEntries = [result.entry, ...state.searchHistoryEntries.filter((candidate) => candidate.id !== optimistic.id && candidate.id !== result.entry.id)];
    renderRecentSearches();
    if (state.mode === "search") renderSearchHistory();
  }).catch((error) => {
    state.searchHistoryEntries = state.searchHistoryEntries.filter((candidate) => candidate.id !== optimistic.id);
    showToast(scText`اكتمل البحث، لكن تعذّر حفظ سجله: ${error.message}`, "error");
  });
  return optimistic;
}

async function loadSearchHistory(query = "") {
  const response = await fetch(`/api/search/history?limit=all&query=${encodeURIComponent(query)}`, { cache: "no-store" });
  const result = await responseJson(response);
  state.searchHistoryEntries = result.entries || [];
  renderRecentSearches();
  if (state.mode === "search") renderSearchHistory();
  return result;
}

function searchHistorySummary(item) {
  const values = Object.values(item.filters?.criteria || item.criteria || {}).filter((value) => {
    if (Array.isArray(value)) return value.length;
    return value !== "" && value !== false && value !== "all" && value != null;
  });
  return displayLabel(item) || scText`${item.mode === "global" ? scText("بحث عام") : displaySchemaName(item) || scText("بحث")} · ${values.length} معيار`;
}

function homeHistoryCapacity(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 1 ? Math.min(100, Math.floor(count)) : 3;
}

function reserveHomeHistorySlots(container, count) {
  if (!container) return;
  const capacity = homeHistoryCapacity(count);
  container.classList.add("home-fixed-history");
  container.style.setProperty("--history-slot-count", String(capacity));
  container.style.setProperty("--history-gap-count", String(capacity - 1));
  container.dataset.historyCapacity = String(capacity);
}

function renderRecentSearches() {
  elements.homeRecentSearches.replaceChildren();
  const capacity = homeHistoryCapacity(state.workspaceSettings?.home_search_history_limit);
  reserveHomeHistorySlots(elements.homeRecentSearches, capacity);
  const items = readRecentSearches().slice(0, capacity);
  if (!items.length) return emptyDashboard(elements.homeRecentSearches, scText("لا توجد عمليات بحث محفوظة."));
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dashboard-history-row dashboard-history-detailed";
    button.dataset.searchHistoryId = item.id;
    const schemaName = displaySchemaName(item) || (item.mode === "global" ? scText("كل التصاميم") : "—");
    button.innerHTML = `<span><strong>${escapeHtml(searchHistorySummary(item))}</strong><small>${escapeHtml(scText("التصميم:"))} ${escapeHtml(schemaName)}</small><small>${escapeHtml(scText("الملاحظات:"))} ${escapeHtml(item.notes || "—")}</small></span><time>${escapeHtml(historyDate(item.created_at))}</time>`;
    addHomeRecordTooltips(button);
    elements.homeRecentSearches.append(button);
  });
}

function readRecentExports() { return readLocalHistory(RECENT_EXPORTS_STORAGE_KEY, 500); }
function rememberRecentExport(filename) {
  const current = readRecentExports().filter((item) => item.filename !== filename);
  current.unshift({ filename, exported_at: new Date().toISOString() });
  writeLocalHistory(RECENT_EXPORTS_STORAGE_KEY, current);
}

function renderOperationRows(container, entries, emptyText, kind) {
  if (!container?.ownerDocument) return;
  container.replaceChildren();
  const settingKey = kind === "import"
    ? "home_import_history_limit"
    : "home_export_history_limit";
  const capacity = homeHistoryCapacity(state.workspaceSettings?.[settingKey]);
  reserveHomeHistorySlots(container, capacity);
  const rows = (entries || []).slice(0, capacity);
  if (!rows.length) return emptyDashboard(container, emptyText);
  rows.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dashboard-history-row dashboard-history-detailed dashboard-history-title-action";
    row.dataset.homeOperationKind = kind;
    row.dataset.homeOperationId = item.id || "";
    const status = item.status === "success" ? scText("ناجح") : item.status === "aborted" ? scText("ملغى") : scText("فشل");
    const schemaName = displaySchemaName(item) || (item.schema_names || []).join("، ") || "—";
    row.innerHTML = `<span><strong>${escapeHtml(item.filename || item.type || scText("عملية"))}</strong><small>${escapeHtml(scText("التصميم:"))} ${escapeHtml(schemaName)} · ${status}</small><small>${escapeHtml(scText("الملاحظات:"))} ${escapeHtml(item.notes || "—")}</small></span><time>${escapeHtml(historyDate(item.created_at || item.exported_at))}</time>`;
    addHomeRecordTooltips(row);
    container.append(row);
  });
}

function comparableBuilderDefinition(value, omit = []) {
  const copy = deepClone(value || {});
  omit.forEach((key) => { delete copy[key]; });
  return JSON.stringify(copy);
}

function builderTargetConditions(schema, targetType, targetId) {
  return (schema?.conditions || [])
    .filter((condition) => condition.target_type === targetType && condition.target_id === targetId)
    .map((condition) => {
      const source = fieldById(condition.source_field_id, schema);
      const operator = typeof OPERATOR_LABELS === "object"
        ? (OPERATOR_LABELS[condition.operator] || condition.operator)
        : condition.operator;
      const value = ["empty", "not_empty"].includes(condition.operator)
        ? ""
        : ` «${condition.value ?? ""}»`;
      return `${displayLabel(source) || scText("حقل محذوف")} ${operator}${value}`;
    })
    .sort();
}

function builderConditionChange(previousSchema, nextSchema, targetType, targetId) {
  const before = builderTargetConditions(previousSchema, targetType, targetId);
  const after = builderTargetConditions(nextSchema, targetType, targetId);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    type: "conditions",
    before: before.join("؛ ") || scText("بلا شروط"),
    after: after.join("؛ ") || scText("بلا شروط"),
  };
}

function describeBuilderChanges(previousSchema, nextSchema) {
  const changes = [];
  const previousCategories = new Map((previousSchema?.categories || []).map((category) => [category.id, category]));
  const nextCategories = new Map((nextSchema?.categories || []).map((category) => [category.id, category]));
  previousCategories.forEach((category, categoryId) => {
    if (!nextCategories.has(categoryId)) changes.push({
      kind: "category",
      action: "removed",
      label: category.label,
      parent: previousCategories.get(category.parent_category_id)?.label || scText("الفئات الرئيسية"),
      category_id: categoryId,
    });
  });
  nextCategories.forEach((category, categoryId) => {
    const previous = previousCategories.get(categoryId);
    if (!previous) changes.push({
      kind: "category",
      action: "added",
      label: category.label,
      parent: nextCategories.get(category.parent_category_id)?.label || scText("الفئات الرئيسية"),
      category_id: categoryId,
    });
    else if (
      comparableBuilderDefinition(previous, ["fields"]) !== comparableBuilderDefinition(category, ["fields"]) ||
      builderConditionChange(previousSchema, nextSchema, "category", categoryId)
    ) {
      const details = [];
      if (previous.kind !== category.kind) {
        details.push({ type: "kind", before: previous.kind, after: category.kind });
      }
      if (previous.parent_category_id !== category.parent_category_id || previous.parent_field_id !== category.parent_field_id) {
        details.push({
          type: "parent",
          before: previousCategories.get(previous.parent_category_id)?.label || scText("بلا فئة أم"),
          after: nextCategories.get(category.parent_category_id)?.label || scText("بلا فئة أم"),
        });
      }
      const conditions = builderConditionChange(previousSchema, nextSchema, "category", categoryId);
      if (conditions) details.push(conditions);
      if (!details.length) details.push({ type: "settings" });
      changes.push({ kind: "category", action: "updated", label: category.label, category_id: categoryId, details });
    }
    const previousFields = new Map((previous?.fields || []).map((field) => [field.id, field]));
    const nextFields = new Map((category.fields || []).map((field) => [field.id, field]));
    previousFields.forEach((field, fieldId) => {
      if (!nextFields.has(fieldId)) changes.push({ kind: "field", action: "removed", label: field.label, category: previous?.label || category.label, category_id: categoryId, field_id: fieldId });
    });
    nextFields.forEach((field, fieldId) => {
      const old = previousFields.get(fieldId);
      if (!old) changes.push({ kind: "field", action: "added", label: field.label, category: category.label, category_id: categoryId, field_id: fieldId });
      else if (
        comparableBuilderDefinition(old) !== comparableBuilderDefinition(field) ||
        builderConditionChange(previousSchema, nextSchema, "field", fieldId)
      ) {
        const details = [];
        if (old.label !== field.label) details.push({ type: "name", before: old.label, after: field.label });
        if (old.type !== field.type) details.push({ type: "type", before: old.type, after: field.type });
        const conditions = builderConditionChange(previousSchema, nextSchema, "field", fieldId);
        if (conditions) details.push(conditions);
        if (!details.length) details.push({ type: "settings" });
        changes.push({ kind: "field", action: "updated", label: old.label, category: category.label, category_id: categoryId, field_id: fieldId, details });
      }
    });
  });
  return changes;
}

function builderChangeText(change) {
  const action = { added: scText("إضافة"), updated: scText("تعديل"), removed: scText("حذف") }[change.action] || scText("تعديل");
  const location = change.kind === "field"
    ? (change.category ? scText` في فئة «${change.category}»` : "")
    : (change.parent ? scText` في «${change.parent}»` : "");
  const base = `${action} ${change.kind === "field" ? scText("حقل") : scText("فئة")} «${change.label}»${location}`;
  if (change.action !== "updated" || !change.details?.length) return base;
  const typeLabels = typeof FIELD_TYPE_LABELS === "object" ? FIELD_TYPE_LABELS : {};
  const detailText = change.details.map((detail) => {
    if (detail.type === "name") return scText`تغيير الاسم إلى «${detail.after}»`;
    if (detail.type === "type") return scText`تغيير النوع من ${typeLabels[detail.before] || detail.before} إلى ${typeLabels[detail.after] || detail.after}`;
    if (detail.type === "kind") return scText`تغيير النوع من ${detail.before === "main" ? scText("رئيسية") : scText("متكررة")} إلى ${detail.after === "main" ? scText("رئيسية") : scText("متكررة")}`;
    if (detail.type === "parent") return scText`تغيير الفئة الأم من «${detail.before}» إلى «${detail.after}»`;
    if (detail.type === "conditions") return scText`تغيير شروط الظهور من «${detail.before}» إلى «${detail.after}»`;
    return scText`تعديل إعدادات ${change.kind === "field" ? scText("الحقل") : scText("الفئة")}`;
  });
  return `${base}: ${detailText.join("؛ ")}`;
}

function readBuilderHistory() { return readLocalHistory(BUILDER_HISTORY_STORAGE_KEY, 200); }
function rememberBuilderHistory(schemaId, schemaName, changes = [], automatic = false) {
  if (!changes.length) return;
  if (schemaId === '__global__' && generalDraftDirty()) {
    (state.generalDraftHistory ||= []).push(...deepClone(changes));
    return;
  }
  const current = readBuilderHistory();
  current.unshift({ id: `builder-${Date.now()}-${Math.random().toString(16).slice(2)}`, schema_id: schemaId, schema_name: schemaName, edited_at: new Date().toISOString(), automatic, changes: deepClone(changes) });
  writeLocalHistory(BUILDER_HISTORY_STORAGE_KEY, current, 200);
  renderBuilderHistoryDialog();
  if (state.mode === "home") renderHomeBuilderDashboard();
}

function renderBuilderHistoryList(container, schemaId = "") {
  container.replaceChildren();
  const entries = readBuilderHistory()
    .filter((item) => !schemaId || item.schema_id === schemaId)
    .slice(0, Number(state.workspaceSettings?.home_builder_history_limit) || 3);
  if (!entries.length) return emptyDashboard(container, scText("لا توجد تعديلات محفوظة حديثًا."));
  entries.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dashboard-history-row dashboard-history-detailed builder-history-row dashboard-history-title-action";
    row.dataset.openBuilderHistory = item.id || "";
    const information = document.createElement("span");
    const changes = Array.isArray(item.changes) ? item.changes.map(builderChangeText) : [];
    const title = document.createElement("strong");
    title.textContent = changes[0] || scText("تعديل التصميم");
    const details = document.createElement("small");
    const detailParts = [];
    detailParts.push(displaySchemaName(item) || (item.schema_id === "__global__" ? scText("التعريفات العامة") : scText("تصميم غير مسمّى")));
    detailParts.push(changes.slice(1).join("؛ ") || (item.automatic ? scText("حفظ تلقائي") : scText("حفظ يدوي")));
    details.textContent = detailParts.join(" · ");
    details.title = changes.join("؛ ");
    information.append(title, details);
    const time = document.createElement("time");
    time.textContent = historyDate(item.edited_at);
    row.append(information, time);
    addHomeRecordTooltips(row);
    container.append(row);
  });
}

function renderHomeBuilderDashboard() {
  renderBuilderHistoryDialog();
  if (!elements.homeBuilderSchemas || !elements.homeBuilderGeneralTags || !elements.homeBuilderSchemaTabs || !builderUnlocked()) return;
  const dashboards = [...state.homeSchemaDashboards.values()];
  const signature = JSON.stringify([dashboards.map(item => [item.info, item.signature]), state.globalDefinitions?.revision]);
  if (elements.homeBuilderSchemas.dataset.renderSignature === signature && elements.homeBuilderSchemas.children.length) {
    elements.homeBuilderSchemas.querySelectorAll('[data-home-builder-panel]').forEach(panel => {
      renderBuilderHistoryList(panel.querySelector('.home-builder-history'), panel.dataset.homeBuilderPanel);
    });
    return;
  }
  elements.homeBuilderSchemas.dataset.renderSignature = signature;
  renderHomeBuilderOverview(dashboards);
  elements.homeBuilderSchemas.replaceChildren();
  elements.homeBuilderSchemaTabs.replaceChildren();
  elements.homeBuilderSchemaTabs.hidden = false;

  const appendPanel = ({ scopeId, label, schema = null, destination, schemaId = "" }) => {
    const tab = createHomeBrowserTab({
      id: `home-builder-schema-tab-${scopeId}`,
      label,
      panelId: `home-builder-schema-panel-${scopeId}`,
      datasetKey: "homeBuilderSchema",
      destination,
      schemaId,
    });
    elements.homeBuilderSchemaTabs.append(tab);
    const panel = document.createElement("article");
    panel.className = "home-schema-panel home-builder-schema-panel";
    panel.id = `home-builder-schema-panel-${scopeId}`;
    panel.dataset.homeBuilderPanel = scopeId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = true;
    const snapshot = scopeId === "__global__" ? globalStructureSnapshot() : schemaStructureSnapshot(schema);
    const body = document.createElement("div");
    body.className = "home-builder-panel-body home-schema-panel-content";
    const statistics = renderBuilderStructureStats(snapshot, scopeId === "__global__");
    const charts = document.createElement("div");
    charts.className = "home-builder-charts";
    const chartButton = (chartSlot) => {
      const chart = document.createElement("button");
      chart.type = "button";
      chart.className = "home-schema-chart-button home-builder-chart";
      chart.dataset.configureHomeBuilderChart = scopeId;
      chart.dataset.builderChart = scopeId;
      chart.dataset.homeBuilderChartSlot = chartSlot;
      chart.setAttribute("aria-label", scText`إعداد الرسم ${chartSlot === "primary" ? scText("الأول") : scText("الثاني")} لبنية ${label}`);
      return chart;
    };
    const primaryChart = chartButton("primary");
    const secondaryChart = chartButton("secondary");
    charts.append(primaryChart, secondaryChart);
    const history = document.createElement("div");
    history.className = "home-builder-history home-dashboard-list home-schema-panel-content";
    renderBuilderHistoryList(history, scopeId);
    body.append(statistics, charts, history);
    panel.append(body);
    elements.homeBuilderSchemas.append(panel);
    panel._builderSnapshot = snapshot;
  };

  appendPanel({
    scopeId: "__global__",
    label: scText("الحقول والفئات العامة"),
    destination: "builder-global",
  });
  dashboards.forEach(({ info, schema }) => appendPanel({
    scopeId: info.id,
    label: displaySchemaName(info) || displaySchemaName(schema) || scText("التصميم"),
    schema,
    destination: "builder",
    schemaId: info.id,
  }));

  const selectedSchemaId = state.homeBuilderSchemaId === "__global__" || state.homeSchemaDashboards.has(state.homeBuilderSchemaId)
    ? state.homeBuilderSchemaId
    : "__global__";
  selectHomeBuilderSchema(selectedSchemaId);
}

async function openBuilderHistoryItem(entryId) {
  const item = readBuilderHistory().find((entry) => entry.id === entryId);
  if (!item) return;
  const change = Array.isArray(item.changes) ? item.changes[0] : null;
  if (item.schema_id === "__global__") {
    switchMode("builder");
    state.builderScope = "global";
    renderBuilderScope();
    if (!change || change.action === "removed") {
      showToast(change ? scText("فُتحت التعريفات العامة؛ العنصر المشار إليه حُذف بالفعل.") : scText("فُتحت التعريفات العامة."));
      return;
    }
    const globalRef = change.global_ref || change.parent_global_ref;
    if (!globalRef) return showToast(scText("فُتحت التعريفات العامة، لكن تعذّر تحديد العنصر المعدّل."), "error");
    if (change.parent_global_ref && change.parent_field_key) {
      openGlobalDefinitionEditor("field", "", {
        parentCategoryRef: change.parent_global_ref,
        parentFieldKey: change.parent_field_key,
      });
      return;
    }
    openGlobalDefinitionEditor(globalRef.startsWith("gcat_") ? "category" : change.kind, globalRef);
    return;
  }
  await switchActiveSchema(item.schema_id, { mode: "builder" });
  if (!change || change.action === "removed") {
    showToast(change ? scText("فُتح التصميم؛ العنصر المشار إليه حُذف بالفعل.") : scText("فُتح التصميم."));
    return;
  }
  const category = getCategory(change.category_id);
  if (!category) return showToast(scText("فُتح التصميم، لكن الفئة المعدّلة لم تعد موجودة."), "error");
  if (change.kind === "field" && change.field_id) {
    const field = (category.fields || []).find((candidate) => candidate.id === change.field_id);
    if (field) openFieldDialog(category.id, field.id, Boolean(field.global_ref));
    else showToast(scText("فُتح التصميم، لكن الحقل المعدّل لم يعد موجودًا."), "error");
  } else {
    openCategoryDialog(category.id, Boolean(category.global_ref));
  }
}

function renderBuilderHistoryDialog() {
  if (!elements.builderHistoryDialogList) return;
  elements.builderHistoryDialogList.replaceChildren();
  const visibleRows = Math.max(1, Number(state.workspaceSettings?.builder_history_limit) || 20);
  const scopeId = state.builderScope === "global" ? "__global__" : (state.activeSchemaId || "legacy");
  const scopeName = state.builderScope === "global"
    ? scText("التعريفات العامة")
    : (displaySchemaName(activeWorkspaceSchemas().find((schema) => schema.id === scopeId)) || displaySchemaName(state.schema) || scText("التصميم المفتوح"));
  if (elements.builderHistoryScope) elements.builderHistoryScope.textContent = scText`النطاق: ${scopeName}`;
  const query = normalizedComparison(document.getElementById("builder-history-query")?.value || "");
  const entries = readBuilderHistory()
    .filter((item) => item.schema_id === scopeId)
    .filter((item) => !query || normalizedComparison([displaySchemaName(item), item.user_name, item.edited_at, historyDate(item.edited_at), ...(Array.isArray(item.changes) ? item.changes : []).map(builderChangeText)].join(" ")).includes(query));
  if (!entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "table-empty";
    cell.textContent = scText("لا توجد تعديلات محفوظة.");
    row.append(cell);
    elements.builderHistoryDialogList.append(row);
    return;
  }
  entries.slice(0, visibleRows).forEach((item) => {
    const row = document.createElement("tr");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dashboard-history-row dashboard-history-detailed dashboard-history-title-action";
    button.dataset.openBuilderHistory = item.id || "";
    const changes = Array.isArray(item.changes) ? item.changes.map(builderChangeText) : [];
    button.innerHTML = `<span><strong>${escapeHtml(changes[0] || scText("تعديل التصميم"))}</strong><small>${escapeHtml(displaySchemaName(item) || scText("التصميم"))}</small><small>${escapeHtml(changes.slice(1).join("؛ ") || "—")}</small></span><time>${escapeHtml(historyDate(item.edited_at))}</time>`;
    addHomeRecordTooltips(button);
    button.textContent = changes[0] || scText("تعديل التصميم");
    [historyDate(item.edited_at), item.user_name || "—", displaySchemaName(item) || "—", button, changes.slice(1).join("؛ ") || "—"].forEach((value) => {
      const cell = document.createElement("td");
      if (value instanceof Node) cell.append(value); else cell.textContent = value;
      row.append(cell);
    });
    elements.builderHistoryDialogList.append(row);
  });
}

function openBuilderHistoryDialog() {
  renderBuilderHistoryDialog();
  elements.builderHistoryDialog.scrollIntoView({ block: "nearest" });
}

async function clearBuilderHistory() {
  const scopeId = state.builderScope === "global" ? "__global__" : (state.activeSchemaId || "legacy");
  if (!(await requestConfirmation(scText("مسح سجل تعديلات النطاق المفتوح نهائيًا؟"), {
    title: scText("مسح سجل تعديلات المصمّم"),
    confirmLabel: scText("مسح السجل"),
  }))) return;
  writeLocalHistory(BUILDER_HISTORY_STORAGE_KEY, readBuilderHistory().filter((item) => item.schema_id !== scopeId), 200);
  renderBuilderHistoryDialog();
  renderHomeBuilderDashboard();
  showToast(scText("تم مسح سجل تعديلات المصمّم."));
}

async function openHomeOperation(kind, entryId) {
  if (!entryId || !["import", "export"].includes(kind)) return;
  switchMode(kind);
  try {
    const response = await fetch(`/api/${kind}/history/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId }),
    });
    await responseJson(response);
    showToast(kind === "import" ? scText("تم فتح ملف الاستيراد المحفوظ.") : scText("تم فتح ملف التصدير المحفوظ."));
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function clearApplicationHistory(kind) {
  const labels = { search: scText("البحث"), entry: scText("السجلات المفتوحة"), import: scText("الاستيراد"), export: scText("التصدير"), builder: scText("المصمّم") };
  if (!(await requestConfirmation(
    scText`مسح سجل ${labels[kind] || kind} نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.`,
    { title: scText`مسح سجل ${labels[kind] || kind}`, confirmLabel: scText("مسح السجل") },
  ))) return false;
  try {
    if (["search", "import", "export"].includes(kind) || kind === "entry" && Array.isArray(state.recentRecordHistory)) {
      const response = await fetch(`/api/history/${kind}`, { method: "DELETE", cache: "no-store" });
      await responseJson(response);
    }
    if (kind === "search") {
      state.searchHistoryEntries = [];
      try { localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY); } catch (_error) { /* no-op */ }
      renderSearchHistory();
    } else if (kind === "entry") {
      if (Array.isArray(state.recentRecordHistory)) state.recentRecordHistory = [];
      try { localStorage.removeItem(RECENT_RECORDS_STORAGE_KEY); } catch (_error) { /* no-op */ }
    } else if (kind === "builder") {
      try { localStorage.removeItem(BUILDER_HISTORY_STORAGE_KEY); } catch (_error) { /* no-op */ }
    } else if (kind === "import") {
      state.importHistoryEntries = [];
      renderImportHistoryRows();
    } else if (kind === "export") {
      state.exportHistoryEntries = [];
      try { localStorage.removeItem(RECENT_EXPORTS_STORAGE_KEY); } catch (_error) { /* no-op */ }
      renderExportHistoryRows();
    }
    renderHome();
    showToast(scText("تم مسح السجل نهائيًا."));
    return true;
  } catch (error) {
    showToast(error.message, "error");
    return false;
  }
}

async function loadHomeAdminHistory() {
  const unlocked = builderUnlocked();
  document.querySelectorAll("[data-admin-dashboard]").forEach((card) => { card.hidden = !unlocked; });
  if (!unlocked) return;
  // Reserve the configured footprint before asynchronous loading, including
  // the first load and error/empty states. No synthetic records are added.
  reserveHomeHistorySlots(elements.homeRecentImports, state.workspaceSettings?.home_import_history_limit);
  reserveHomeHistorySlots(elements.recentExports, state.workspaceSettings?.home_export_history_limit);
  renderHomeBuilderDashboard();
  try {
    const homeImportLimit = Number(state.workspaceSettings?.home_import_history_limit) || 3;
    const homeExportLimit = Number(state.workspaceSettings?.home_export_history_limit) || 3;
    const [importsResponse, exportsResponse] = await Promise.all([
      fetch(`/api/import/history?limit=${homeImportLimit}`, { cache: "no-store" }),
      fetch(`/api/export/history?limit=${homeExportLimit}`, { cache: "no-store" }),
    ]);
    const [imports, exports] = await Promise.all([responseJson(importsResponse), responseJson(exportsResponse)]);
    renderOperationRows(elements.homeRecentImports, imports.entries || [], scText("لا توجد عمليات استيراد."), "import");
    renderOperationRows(elements.recentExports, exports.entries || [], scText("لا توجد عمليات تصدير."), "export");
  } catch (error) {
    emptyDashboard(elements.homeRecentImports, error.message);
    emptyDashboard(elements.recentExports, error.message);
  }
}

function toggleHomeCard(card) {
  const content = card?.querySelector(":scope > .home-card-content");
  if (!card || !content) return;
  const collapse = !content.hidden;
  content.hidden = collapse;
  card.classList.toggle("is-collapsed", collapse);
}

function toggleHomeSchemaPanel(panel) {
  const content = panel?.querySelector(":scope > .home-schema-panel-content");
  if (!panel || !content) return;
  const collapse = !content.hidden;
  content.hidden = collapse;
  panel.classList.toggle("is-collapsed", collapse);
}

function renderHome() {
  if (!state.schema) return;
  document.body.classList.toggle("show-explanations", state.workspaceSettings?.show_explanations === true);
  renderRecentSearches();
  void loadSearchHistory().catch(() => {});
  void loadHomeSchemaDashboards().catch((error) => {
    if (!state.homeSchemaDashboards.size) {
      elements.recentRecords?.replaceChildren();
      emptyDashboard(elements.recentRecords, error.message);
    } else showToast(error.message, "error");
  });
  void loadHomeAdminHistory();
}

elements.applyHomeChart?.addEventListener("click", applyHomeChartConfiguration);
elements.saveHomeCustomStat?.addEventListener("click", saveHomeCustomStatConfiguration);
elements.deleteHomeCustomStat?.addEventListener("click", deleteHomeCustomStatConfiguration);
elements.homeChartType?.addEventListener("change", () => {
  state.homeChartType = elements.homeChartType.value === "gauge" ? "gauge" : "bar";
  fillHomeChartFieldChoices();
});
elements.openBuilderHistory?.addEventListener("click", openBuilderHistoryDialog);
document.getElementById("builder-history-query")?.addEventListener("input", renderBuilderHistoryDialog);
document.getElementById("builder-history-query")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); openBuilderHistoryDialog(); }
});
elements.clearBuilderHistory?.addEventListener("click", () => void clearBuilderHistory());
elements.builderHistoryDialogList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-open-builder-history]");
  if (!item) return;

  void openBuilderHistoryItem(item.dataset.openBuilderHistory);
});
elements.toggleEntryRecent?.addEventListener("click", (event) => {
  if (event.target !== elements.toggleEntryRecent) return;
  const expanded = elements.toggleEntryRecent.getAttribute("aria-expanded") !== "false";
  elements.toggleEntryRecent.setAttribute("aria-expanded", String(!expanded));
  elements.entryRecentRecords.hidden = expanded;
});
elements.entryRecentRecords?.addEventListener("click", (event) => {
  const code = event.target.closest("[data-copy-record-code]");
  if (code) {
    event.stopPropagation();
    void copyRecordCode(code.dataset.copyRecordCode);
    return;
  }
  const readonly = event.target.closest("[data-readonly-record]");
  if (readonly) {
    event.stopPropagation();
    openReadonlyRecord(readonly.dataset.readonlyRecord);
    return;
  }
  const record = event.target.closest("[data-edit-record]");
  if (record) openRecordForEditing(record.dataset.editRecord);
});
