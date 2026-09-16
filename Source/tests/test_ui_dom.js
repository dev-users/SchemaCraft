"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { webcrypto } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");

const projectDir = path.resolve(__dirname, "..");
const activeServers = [];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "generic-entry-dom-"));
const developerData = path.join(temporaryRoot, "developer-data");
const userData = path.join(temporaryRoot, "user-data");
const multiData = path.join(temporaryRoot, "multi-data");
// Always start from an isolated empty data directory. Never copy or mutate the
// developer's live schema, workbook, attachments, or logs during UI tests.
fs.mkdirSync(developerData, { recursive: true });

const fixtureResult = spawnSync(
  "python3",
  [
    "-c",
    [
      "import json,sys",
      `sys.path.insert(0, ${JSON.stringify(path.join(projectDir, "tests"))})`,
      "from test_backend import configured_schema",
      "print(json.dumps(configured_schema(), ensure_ascii=False))"
    ].join(";")
  ],
  { cwd: projectDir, encoding: "utf8" }
);
assert.equal(fixtureResult.status, 0, fixtureResult.stderr);
const fixtureSchema = JSON.parse(fixtureResult.stdout);
fixtureSchema.app.primary_color = "#FFFFFF";
fixtureSchema.app.background_color = "#000000";
fixtureSchema.app.surface_color = "#000000";

const IDS = {
  name: "fld_000000000001",
  father: "fld_000000000002",
  family: "fld_000000000003",
  works: "fld_000000000004",
  gregorian: "fld_000000000005",
  hijri: "fld_000000000006",
  shamsi: "fld_000000000007",
  number: "fld_000000000008",
  status: "fld_000000000009",
  notes: "fld_00000000000a",
  documentType: "fld_00000000000b",
  customFile: "fld_00000000000d",
  documents: "cat_000000000002"
};

const fixtureFields = fixtureSchema.categories.flatMap((category) => category.fields || []);
const fixtureWorks = fixtureFields.find((field) => field.id === IDS.works);
const fixtureStatus = fixtureFields.find((field) => field.id === IDS.status);
fixtureWorks.options = [
  { id: "opt_440000000001", label: "نعم", active: true },
  { id: "opt_440000000002", label: "لا", active: true }
];
fixtureStatus.options = [
  { id: "opt_440000000003", label: "نشط", active: true },
  { id: "opt_440000000004", label: "متوقف", active: true }
];
fixtureStatus.option_filter = {
  source_field_id: IDS.works,
  mappings: {
    opt_440000000001: ["opt_440000000003"],
    opt_440000000002: ["opt_440000000004"]
  },
  unmatched: "none"
};

function startServer(dataDirectory, developerMode, workspaceMode = false) {
  const args = [
    path.join(projectDir, "tests", "test_server.py"),
    dataDirectory
  ];
  if (developerMode) {
    args.push("--builder");
  }
  if (workspaceMode) {
    args.push("--workspace");
  }
  const server = spawn("python3", args, {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeServers.push(server);
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk.toString();
    server.capturedErrors = errors;
  });
  const portPromise = new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for server. ${errors}`)),
      10_000
    );
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}. ${errors}`));
    });
  });
  return { server, portPromise, errors: () => errors };
}

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const detail = typeof message === "function" ? message() : message;
  throw new Error(`Timed out: ${detail}`);
}

function setValue(window, elementOrSelector, value, eventType = "input") {
  const element =
    typeof elementOrSelector === "string"
      ? window.document.querySelector(elementOrSelector)
      : elementOrSelector;
  assert.ok(element, `Missing element: ${elementOrSelector}`);
  element.value = value;
  element.dispatchEvent(new window.Event(eventType, { bubbles: true }));
  return element;
}

function setSelectByLabel(window, element, label) {
  if (element.dataset.editableList === "true") {
    element.focus();
    setValue(window, element, label, "input");
    const option = [...element.closest(".editable-list-control").querySelectorAll(".editable-list-option")]
      .find((candidate) => candidate.textContent === label);
    assert.ok(option, `Missing editable-list option: ${label}`);
    option.click();
    return element;
  }
  const options = element.options
    ? [...element.options]
    : [...(element.list?.options || [])];
  const option = options.find(
    (candidate) => candidate.textContent === label || candidate.value === label
  );
  assert.ok(option, `Missing select option: ${label}`);
  return setValue(window, element, option.value, element.options ? "change" : "input");
}

function typeDigits(window, element, digits) {
  for (const key of digits) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
}

function browserOptions(browserErrors) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => browserErrors.push(String(error)));
  virtualConsole.on("error", (error) => browserErrors.push(String(error)));
  return {
    resources: "usable",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, "crypto", { value: webcrypto });
      window.fetch = (input, init) =>
        fetch(new URL(input, window.location.href), init);
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLElement.prototype.scrollTo = function scrollTo(options = {}) {
        this.scrollTop = Number(options.top || 0);
      };
      window.confirm = () => true;
      window.prompt = (_message, defaultValue = "") =>
        defaultValue.includes("نسخة") ? "العاملون" : defaultValue || "العاملون";
      window.__openedWindows = [];
      window.open = (url, target) => {
        window.__openedWindows.push({ url: String(url), target: String(target || "") });
        return null;
      };
      window.navigator.sendBeacon = () => true;
      window.URL.createObjectURL = () => "blob:schemacraft-test";
      window.URL.revokeObjectURL = () => {};
      if (!window.Blob.prototype.arrayBuffer) {
        window.Blob.prototype.arrayBuffer = function arrayBuffer() {
          return new Promise((resolve, reject) => {
            const reader = new window.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
          });
        };
      }
      window.CSS = window.CSS || {};
      window.CSS.escape =
        window.CSS.escape ||
        ((value) => String(value).replace(/["\\]/g, "\\$&"));
      if (window.HTMLDialogElement) {
        window.HTMLDialogElement.prototype.showModal = function showModal() {
          this.open = true;
        };
        window.HTMLDialogElement.prototype.close = function close(returnValue) {
          if (!this.open) return;
          if (returnValue !== undefined) this.returnValue = returnValue;
          this.open = false;
          window.setTimeout(() => this.dispatchEvent(new window.Event('close')), 0);
        };
      }
    }
  };
}

async function loadDom(baseUrl, browserErrors) {
  const dom = await JSDOM.fromURL(baseUrl, browserOptions(browserErrors));
  await waitFor(
    () =>
      dom.window.document.querySelector("#audit-user-dialog")?.open ||
      dom.window.document.querySelector("#app-status")?.classList.contains("status-ready"),
    () =>
      `audit identity or application to load${
        browserErrors.length ? `; browser errors: ${browserErrors.join(" | ")}` : ""
      }`
  );
  const auditDialog = dom.window.document.querySelector("#audit-user-dialog");
  if (auditDialog?.open) {
    setValue(dom.window, "#audit-user-input", "مستخدم الاختبار");
    dom.window.document.querySelector("#confirm-audit-user").click();
  }
  await waitFor(
    () =>
      dom.window.document
        .querySelector("#app-status")
        ?.classList.contains("status-ready"),
    "application schema to load"
  );
  return dom;
}

function valueControl(document, fieldId, scope = "main", root = document) {
  return root.querySelector(
    `[data-value-control][data-field-id="${fieldId}"][data-scope="${scope}"]`
  );
}

function sharedFilterControl(document, fieldId, context = "search") {
  return document.querySelector(
    `[data-shared-filter="${context}"][data-field-id="${fieldId}"] [data-filter-value]`
  );
}

function setCalendar(window, document, fieldId, year, month, day, scope = "main") {
  const hidden = valueControl(document, fieldId, scope);
  assert.ok(hidden, `Missing calendar field ${fieldId}`);
  const group = hidden.closest(".calendar-control");
  const monthSelect = group.querySelector("[data-calendar-month]");
  assert.equal(
    monthSelect.options[Number(month)].textContent,
    String(month).padStart(2, "0")
  );
  setValue(window, group.querySelector("[data-calendar-year]"), year, "change");
  setValue(
    window,
    monthSelect,
    String(month).padStart(2, "0"),
    "change"
  );
  setValue(
    window,
    group.querySelector("[data-calendar-day]"),
    String(day).padStart(2, "0"),
    "change"
  );
  assert.equal(hidden.value, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  assert.equal(hidden.closest(".field").querySelector("[data-calendar-readable]"), null);
  return hidden.value;
}

async function run() {
  const browserErrors = [];
  const developer = startServer(developerData, true);
  const developerPort = await developer.portPromise;
  const developerBase = `http://127.0.0.1:${developerPort}/`;

  const emptyDom = await loadDom(developerBase, browserErrors);
  const emptyDocument = emptyDom.window.document;
  assert.equal(emptyDocument.querySelector("#empty-schema-panel").hidden, false);
  assert.equal(emptyDocument.querySelector("#record-form").hidden, true);
  assert.equal(emptyDocument.querySelector("#builder-mode-button").hidden, false);

  emptyDocument.querySelector("#builder-mode-button").click();
  assert.equal(emptyDocument.querySelector("#builder-view").hidden, false);
  assert.ok(emptyDocument.querySelector("#backup-button .action-icon"));
  assert.ok(emptyDocument.querySelector("#session-mode-badge"));
  assert.equal(emptyDocument.querySelector("#change-builder-password-button"), null);
  assert.equal(emptyDocument.querySelector("#lock-builder-button"), null);
  assert.equal(emptyDocument.querySelector("#settings-view").hidden, true);
  assert.equal(emptyDocument.querySelector("#setting-direction"), null);
  assert.equal(emptyDocument.querySelector("#setting-background-color"), null);
  assert.equal(emptyDocument.querySelector("#setting-surface-color"), null);
  emptyDocument.querySelector("#builder-sidebar-add-category-button").click();
  assert.equal(emptyDocument.querySelector("#category-dialog").open, true);
  setValue(emptyDom.window, "#category-label", "فئة اختبار");
  emptyDocument.querySelector("#confirm-category-button").click();
  assert.equal(emptyDocument.querySelectorAll(".builder-category").length, 1);
  emptyDocument.querySelector("#builder-sidebar-add-field-button").click();
  assert.equal(emptyDocument.querySelector("#field-category-dialog").open, true);
  emptyDocument.querySelector("#confirm-new-field-category").click();
  assert.equal(emptyDocument.querySelector("#field-dialog").open, true);
  setValue(emptyDom.window, "#field-label", "حقل اختبار");
  setValue(emptyDom.window, "#field-type", "date_hijri", "change");
  emptyDocument.querySelector("#field-searchable").checked = true;
  emptyDocument
    .querySelector("#field-searchable")
    .dispatchEvent(new emptyDom.window.Event("change", { bubbles: true }));
  emptyDocument.querySelector("#confirm-field-button").click();
  assert.equal(emptyDocument.querySelectorAll(".builder-field-row").length, 1);
  assert.equal(
    emptyDocument.querySelector("#builder-save-state").dataset.dirty,
    "true"
  );
  emptyDocument.querySelector("#discard-schema-button").click();
  assert.equal(emptyDocument.querySelector("#action-confirm-dialog").open, true);
  emptyDocument.querySelector("#action-confirm-accept").click();
  await waitFor(
    () => emptyDocument.querySelectorAll(".builder-category").length === 0,
    "custom discard confirmation to apply"
  );
  assert.equal(emptyDocument.querySelectorAll(".builder-category").length, 0);

  const putResponse = await fetch(`${developerBase}api/schema`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fixtureSchema)
  });
  assert.equal(putResponse.status, 200);
  const configured = await putResponse.json();
  assert.equal(configured.stats.field_count, 18);

  fs.cpSync(developerData, userData, { recursive: true });
  const userServer = startServer(userData, false);
  const userPort = await userServer.portPromise;
  const userBase = `http://127.0.0.1:${userPort}/`;
  const userDom = await loadDom(userBase, browserErrors);
  const userDocument = userDom.window.document;
  assert.equal(userDocument.querySelector("#builder-mode-button").hidden, true);
  assert.equal(userDocument.querySelector("#import-page-button").hidden, true);
  assert.equal(userDocument.querySelector("#export-page-button").hidden, true);
  assert.equal(userDocument.querySelector("#open-builder-button").hidden, true);
  assert.equal(userDocument.querySelector("#record-form").hidden, false);
  assert.equal(userDocument.querySelectorAll("[data-admin-dashboard]").length, 3);
  assert.equal(userDocument.querySelectorAll("[data-admin-dashboard]:not([hidden])").length, 0);
  assert.equal(userDocument.querySelectorAll("#home-navigation .home-dashboard-card:not([hidden])").length, 2);
  assert.equal(userDocument.querySelector("#settings-page-button").hidden, true);
  userDocument.querySelector("#settings-page-button").click();
  assert.equal(userDocument.querySelector('[data-settings-category-tab="administration"]'), null);
  userDocument.querySelector("#session-mode-badge").click();
  assert.equal(userDocument.querySelector("#builder-auth-dialog").open, true);
  assert.equal(userDocument.querySelector("#builder-view").hidden, true);

  const dom = await loadDom(developerBase, browserErrors);
  const { window } = dom;
  const { document } = window;
  assert.equal(document.querySelector("#home-view").hidden, false);
  assert.equal(document.querySelector("#entry-view").hidden, true);
  assert.equal(
    document.querySelector("#workspace-schema-strip"),
    null,
    "Home must not retain a hidden or empty shared tab strip"
  );
  assert.equal(document.body.classList.contains("page-tab-bar-active"), false);
  assert.equal(document.querySelector(".app-header").dataset.page, "home");
  assert.equal(
    window.getComputedStyle(document.querySelector(".global-navigation")).display,
    "flex"
  );
  assert.equal(document.querySelectorAll("#home-navigation [data-home-destination]").length, 5);
  assert.equal(document.querySelectorAll("#home-navigation .home-dashboard-card").length, 5);
  assert.ok(document.querySelector("#home-recent-searches"));
  assert.ok(document.querySelector("#home-recent-imports"));
  await waitFor(
    () => document.querySelectorAll("#recent-records .home-schema-panel").length === 1,
    "per-schema Home data panel"
  );
  assert.equal(document.querySelectorAll("#recent-records .home-schema-stat-tag").length, 2);
  document.querySelector(
    '#recent-records [data-configure-home-chart][data-home-chart-slot="primary"]'
  ).click();
  assert.equal(document.querySelector("#home-chart-dialog").open, true);
  assert.equal(document.querySelector("#home-chart-type").value, "bar");
  assert.equal(document.querySelector("#home-chart-type").disabled, false);
  document.querySelector("#home-chart-type").value = "gauge";
  document.querySelector("#home-chart-type").dispatchEvent(new window.Event("change", { bubbles: true }));
  document.querySelector("#apply-home-chart").click();
  await waitFor(
    () => document.querySelectorAll('#recent-records [data-home-chart-type="gauge"]').length === 2,
    "two independently configured gauge charts"
  );
  const homeChartConfig = JSON.parse(window.localStorage.getItem("schemacraft-home-chart-config-v1"));
  const configuredSchema = Object.values(homeChartConfig)[0];
  assert.equal(configuredSchema.slots.primary.type, "gauge");
  assert.equal(configuredSchema.slots.secondary.type, "gauge");
  assert.deepEqual(
    [...document.querySelectorAll(".global-navigation [data-mode]")]
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.mode),
    ["home", "search", "entry", "import", "export", "builder"]
  );
  assert.equal(document.querySelector("#home-record-id"), null);
  assert.equal(document.querySelector("#home-shortcuts"), null);
  assert.ok(document.querySelector("#recent-exports"));
  document.querySelector("#entry-mode-button").click();
  assert.equal(document.querySelector("#entry-view").hidden, false);
  assert.ok(document.querySelector("#workspace-schema-strip"));
  assert.ok(document.querySelector(".app-header #header-schema-navigation #entry-schema-tabs"));
  assert.equal(document.querySelector(".app-workspace > #workspace-schema-strip"), null);
  assert.equal(document.body.classList.contains("page-tab-bar-active"), true);
  assert.equal(document.querySelector("#entry-header-actions"), null);
  assert.equal(document.querySelector("#builder-header-actions"), null);
  assert.notEqual(
    window.getComputedStyle(document.querySelector(".global-navigation")).display,
    "none"
  );
  assert.equal(
    document.querySelector("#entry-mode-button").getAttribute("aria-current"),
    "page"
  );
  assert.equal(
    document.querySelector("#home-mode-button").hasAttribute("aria-current"),
    false
  );
  assert.equal(document.documentElement.dir, "rtl");
  assert.equal(document.querySelector("#app-title").textContent, "نظام تجريبي");
  assert.equal(
    document.documentElement.style.getPropertyValue("--primary-contrast"),
    "#FFFFFF"
  );
  assert.notEqual(
    document.documentElement.style.getPropertyValue("--primary-ink"),
    "#FFFFFF"
  );
  assert.ok(document.querySelector("#search-button .action-icon"));
  const header = document.querySelector('.app-header');
  const originalHeaderPage = header.dataset.page;
  for (const page of ['home', 'entry', 'search', 'import', 'export', 'builder']) {
    header.dataset.page = page;
    assert.equal(window.getComputedStyle(header).backgroundColor, 'rgb(255, 255, 255)', 'all pages share a white header');
  }
  header.dataset.page = originalHeaderPage;
  const themeBefore = document.documentElement.style.getPropertyValue('--primary');
  window.eval('applyAppIdentity({...state.schema, app: {...state.schema.app, primary_color: "#FF0000"}})');
  assert.equal(document.documentElement.style.getPropertyValue('--primary'), themeBefore, 'schema identity cannot change the workspace theme');
  for (const selector of ['#single-schema-search-panel', '#import-panel', '#export-panel', '#builder-history-dialog']) {
    const panel = document.querySelector(selector);
    if (!panel) continue;
    const heading = panel.querySelector(':scope > .workflow-collapse-heading');
    assert.ok(heading);
    heading.click();
    assert.equal(heading.getAttribute('aria-expanded'), 'false');
    assert.ok(panel.classList.contains('workflow-panel-collapsed'));
    heading.click();
    assert.equal(heading.getAttribute('aria-expanded'), 'true');
  }
  assert.ok(document.querySelector("#save-record-button .action-icon"));
  assert.ok(document.querySelector("#reset-form-button .action-icon"));
  assert.ok(document.querySelector("#close-app-button .action-icon"));
  assert.ok(document.querySelector("#entry-record-actions #save-record-button"));
  assert.ok(document.querySelector("#entry-record-actions #reset-form-button"));
  assert.equal(document.querySelector(".app-header #save-record-button"), null);
  assert.equal(document.querySelector(".app-header #reset-form-button"), null);
  assert.ok(document.querySelector(".app-header #close-app-button"));
  assert.ok(document.querySelector(".header-main-row #close-app-button"));
  assert.ok(document.querySelector(".header-main-row .global-navigation"));
  assert.equal(document.querySelector(".header-page-context"), null);
  assert.equal(
    document.querySelector(".global-navigation #settings-page-button"),
    null
  );
  assert.ok(document.querySelector(".header-actions #settings-page-button"));
  assert.equal(
    window.getComputedStyle(document.querySelector("#app-status")).display,
    "none"
  );
  const globalUtilityButtons = [
    ...document.querySelector(".header-actions").children
  ].filter((element) => element.matches("button"));
  assert.equal(globalUtilityButtons[0].id, "close-app-button");
  assert.equal(globalUtilityButtons[1].id, "settings-page-button");
  assert.equal(document.querySelector(".app-brand"), null);
  assert.equal(document.querySelector(".header-context-line"), null);
  assert.equal(
    document.querySelector("#app-title").classList.contains("visually-hidden"),
    true
  );
  assert.equal(document.querySelector("#startup-error").hidden, true);
  assert.ok([...document.querySelectorAll("dialog")].every((dialog) => dialog.classList.contains("editor-dialog")));
  document.querySelectorAll("dialog").forEach((dialog) => {
    assert.ok(dialog.querySelector(":scope > .dialog-heading"), `${dialog.id} needs a unified heading`);
    assert.ok(dialog.querySelector(":scope > .dialog-content"), `${dialog.id} needs scrollable content`);
    if (dialog.id !== "settings-view") {
      assert.ok(dialog.querySelector(":scope > .dialog-actions"), `${dialog.id} needs a fixed action footer`);
    }
  });
  assert.equal(document.querySelectorAll("[data-main-category]").length, 1);
  assert.equal(document.querySelectorAll("[data-related-category]").length, 2);
  assert.ok(document.querySelectorAll("input[type='date']").length >= 2);
  assert.equal(window.getComputedStyle(document.body).display, "flex");
  assert.equal(
    window.getComputedStyle(document.querySelector(".app-header")).position,
    "relative"
  );
  assert.equal(
    window.getComputedStyle(document.querySelector("#close-app-button")).position,
    "static"
  );
  assert.equal(
    window.getComputedStyle(document.querySelector(".page")).overflowY,
    "auto"
  );

  const dependencySource = valueControl(document, IDS.works);
  setSelectByLabel(window, dependencySource, "نعم");
  const dependentList = valueControl(document, IDS.status);
  dependentList.focus();
  setValue(window, dependentList, "كاليفورنيا", "input");
  assert.equal(dependentList.value, "كاليفورنيا");
  const addDependentValue = dependentList
    .closest(".editable-list-control")
    .querySelector("[data-add-inline-list-option]");
  assert.ok(addDependentValue, "a new dependent value needs the current source condition");
  addDependentValue.click();
  await waitFor(
    () => Boolean(dependentList.dataset.selectedOptionId),
    "dependent value to be added under the selected source option"
  );
  assert.equal(dependentList.value, "كاليفورنيا");
  setSelectByLabel(window, dependencySource, "لا");

  const gregorianHidden = valueControl(document, IDS.gregorian);
  const gregorianGroup = gregorianHidden.closest(".calendar-control");
  const gregorianDay = gregorianGroup.querySelector("[data-calendar-day]");
  const gregorianMonth = gregorianGroup.querySelector("[data-calendar-month]");
  const gregorianYear = gregorianGroup.querySelector("[data-calendar-year]");
  assert.equal(gregorianGroup.querySelector("[data-calendar-compact]"), null);
  gregorianDay.focus();
  gregorianDay.dispatchEvent(new window.KeyboardEvent("keydown", { key: "-", bubbles: true }));
  assert.equal(document.activeElement, gregorianDay);
  gregorianMonth.focus();
  gregorianMonth.dispatchEvent(new window.KeyboardEvent("keydown", { key: "-", bubbles: true }));
  assert.equal(document.activeElement, gregorianMonth);
  gregorianYear.focus();

  gregorianYear.dispatchEvent(new window.KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, gregorianYear, "year separator does not leave calendar");
  const gregorianText = setCalendar(
    window,
    document,
    IDS.gregorian,
    "2001",
    4,
    9
  );
  const hijriText = setCalendar(
    window,
    document,
    IDS.hijri,
    "1447",
    9,
    12
  );
  const shamsiText = setCalendar(
    window,
    document,
    IDS.shamsi,
    "1405",
    1,
    20
  );
  assert.equal(gregorianText, "2001-04-09");
  assert.equal(hijriText, "1447-09-12");
  assert.equal(shamsiText, "1405-01-20");

  const requiredList = valueControl(document, IDS.status);
  setValue(window, requiredList, "", "input");
  requiredList.required = true;
  assert.equal(requiredList.required, true);
  requiredList.focus();
  const blockedRequiredListTab = new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  });
  requiredList.dispatchEvent(blockedRequiredListTab);
  assert.equal(blockedRequiredListTab.defaultPrevented, true);
  assert.notEqual(document.activeElement, requiredList, "invalid lists do not trap keyboard focus");
  const afterInvalidTab = document.activeElement;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(document.activeElement, afterInvalidTab, "blur validation must not schedule focus restoration");

  const documentsSection = document.querySelector(
    `[data-related-category="${IDS.documents}"]`
  );
  const works = valueControl(document, IDS.works);
  assert.equal(documentsSection.hidden, true);
  setSelectByLabel(window, works, "نعم");
  assert.equal(documentsSection.hidden, false);
  assert.equal(
    works.closest("[data-field-wrapper]").nextElementSibling,
    documentsSection
  );

  setValue(window, valueControl(document, IDS.name), "عَلِي");
  setValue(window, valueControl(document, IDS.father), "حسن");
  setValue(window, valueControl(document, IDS.family), "محمدي");
  setValue(window, valueControl(document, IDS.notes), "ملاحظة");
  setSelectByLabel(window, valueControl(document, IDS.status), "نشط");
  const relatedRecords = documentsSection.querySelector("[data-related-records]");
  const relatedAddButton = documentsSection.querySelector("[data-add-related]");
  assert.ok(relatedAddButton);
  assert.equal(relatedRecords.previousElementSibling.contains(relatedAddButton), true);
  relatedAddButton.click();
  const documentCard = documentsSection.querySelector(".related-card");
  assert.ok(documentCard);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(documentCard.contains(document.activeElement), false, "adding a card does not move focus");
  const removeDocumentCard = relatedRecords.previousElementSibling.querySelector(".related-tab-close");
  assert.equal(relatedAddButton.tabIndex, 0);
  assert.equal(removeDocumentCard.tabIndex, 0);
  const documentTypeControl = valueControl(document, IDS.documentType, "related", documentCard);
  documentTypeControl.focus();
  const previousControlTab = new window.KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: true,
    bubbles: true,
    cancelable: true
  });
  documentTypeControl.dispatchEvent(previousControlTab);
  assert.equal(previousControlTab.defaultPrevented, true);
  assert.equal(document.activeElement, removeDocumentCard);
  setValue(
    window,
    documentTypeControl,
    "صورة"
  );
  const picker = documentCard.querySelector("[data-file-picker]");
  const image = new window.File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
    "photo.png",
    { type: "image/png" }
  );
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: [image]
  });
  picker.dispatchEvent(new window.Event("change", { bubbles: true }));
  const filePickers = [...documentCard.querySelectorAll("[data-file-picker]")];
  const removeSelectedFile = picker.closest(".attachment-control").querySelector("[data-remove-file]");
  const selectedFileName = picker.closest(".attachment-control").querySelector("[data-file-name]");
  window.attachmentHoverTarget = selectedFileName;
  window.eval('appHoverCards.show(window.attachmentHoverTarget);');
  assert.equal(document.querySelector('#app-hover-card strong').textContent, selectedFileName.value);
  assert.notEqual(document.querySelector('#app-hover-card strong').textContent, 'اسم المرفق');
  assert.ok(document.querySelector('#app-hover-card .app-hover-metadata'));
  window.eval('appHoverCards.hide();');
  selectedFileName.focus();
  selectedFileName.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  }));
  assert.equal(document.activeElement, removeSelectedFile);
  removeSelectedFile.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  }));
  assert.equal(document.activeElement, filePickers[1].closest(".attachment-control").querySelector("[data-browse-file]"));
  filePickers[1].closest(".attachment-control").querySelector("[data-browse-file]").dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true
  }));
  assert.equal(document.activeElement, filePickers[1].closest(".attachment-control").querySelector("[data-file-name]"));

  const countBeforeEnter = document.querySelectorAll(".related-card").length;
  relatedAddButton.click();
  const repeatTabs = relatedRecords.previousElementSibling.querySelectorAll("[data-related-tab]");
  assert.equal(repeatTabs.length, 2);
  const secondCard = [...relatedRecords.children].find((card) => card !== documentCard);
  assert.equal(documentCard.hidden, true);
  assert.equal(secondCard.hidden, false);
  setValue(window, valueControl(document, IDS.documentType, "related", secondCard), "بطاقة ثانية");
  const oldCardSort = window.eval(`categoryById(${JSON.stringify(IDS.documents)}, state.schema).card_sort`);
  window.eval(`categoryById(${JSON.stringify(IDS.documents)}, state.schema).card_sort = {mode:"field", field_id:${JSON.stringify(IDS.documentType)}, direction:"desc"}`);
  const sortedCardControl = valueControl(document, IDS.documentType, "related", secondCard);
  const cardMoves = new window.MutationObserver(() => {});
  cardMoves.observe(relatedRecords, { childList: true });
  sortedCardControl.focus();
  sortedCardControl.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(cardMoves.takeRecords().length, 0, "value changes never reparent sorted cards");
  assert.equal(document.activeElement, sortedCardControl, "sorted repeated cards retain field focus");
  cardMoves.disconnect();
  window.eval(`categoryById(${JSON.stringify(IDS.documents)}, state.schema).card_sort = ${JSON.stringify(oldCardSort || {mode:"manual"})}`);
  const savedBothCards = await window.eval("collectRelatedPayload()");
  assert.equal(savedBothCards[relatedRecords.dataset.relatedRecords].length, 2,
    "inactive repeat tabs retain their values in the saved payload");
  repeatTabs[0].click();
  assert.equal(documentCard.hidden, false);
  assert.equal(secondCard.hidden, true);
  assert.equal(repeatTabs[1].querySelector(".related-tab-close").hidden, true);
  repeatTabs[1].focus();
  assert.equal(secondCard.hidden, true, "focus alone does not activate a closed tab");
  repeatTabs[1].dispatchEvent(new window.KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));
  assert.equal(secondCard.hidden, false);
  const tabStops = window.eval("entryFieldTabStops()");
  assert.ok(tabStops.indexOf(repeatTabs[1]) < tabStops.indexOf(valueControl(document, IDS.documentType, "related", secondCard)));
  assert.ok(tabStops.indexOf(valueControl(document, IDS.documentType, "related", secondCard)) < tabStops.indexOf(relatedAddButton));
  repeatTabs[1].querySelector(".related-tab-close").click();
  assert.equal(document.querySelector("#action-confirm-dialog").open, true);
  assert.equal(relatedRecords.querySelectorAll(":scope > .related-card").length, 2);
  document.querySelector("#action-confirm-accept").click();
  await waitFor(() => relatedRecords.querySelectorAll(":scope > .related-card").length === 1, "confirmed repeat deletion");
  assert.equal(relatedRecords.querySelectorAll(":scope > .related-card").length, 1);
  assert.equal(documentCard.hidden, false);
  assert.equal(documentCard.querySelector("[data-file-name]").value, "photo.png");
  assert.equal(documentCard.querySelector("[data-browse-file]").hidden, true);
  removeSelectedFile.click();
  assert.equal(document.querySelector("#action-confirm-dialog").open, true);
  document.querySelector("#action-confirm-cancel").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(documentCard.querySelector("[data-file-name]").value, "photo.png", "cancelled attachment deletion preserves file");
  assert.deepEqual([...document.querySelectorAll(".schema-management-actions > button:not(#restore-schema-button):not(#create-from-archived-schema-button)")].map(button => button.id), [
    "builder-sidebar-add-field-button", "builder-sidebar-add-category-button", "save-schema-button", "discard-schema-button", "rename-schema-button", "archive-schema-button", "duplicate-schema-button", "delete-schema-button", "create-schema-button"
  ]);
  assert.ok(document.querySelector("#settings-view #backup-button"));
  assert.equal(document.querySelector("#builder-action-rail #backup-button"), null);
  assert.equal(document.querySelector(".search-setup-panel"), null);
  assert.ok(document.querySelector("#search-notes-dialog #full-search-include-archived"));
  const pickerTestRail = document.createElement("nav");
  document.body.append(pickerTestRail);
  let pickedSchema = "";
  for (let index = 0; index < 6; index += 1) {
    const tab = document.createElement("button");
    tab.className = "schema-tab";
    tab.textContent = `Schema ${index}`;
    tab.onclick = () => { pickedSchema = tab.textContent; };
    pickerTestRail.append(tab);
  }
  window.enhancePageSchemaTabs(pickerTestRail);
  pickerTestRail.querySelector("[data-all-schemas]").click();
  const pickerDialog = document.querySelector(".schema-picker-dialog");
  assert.equal(pickerDialog.open, true);
  const pickerQuery = pickerDialog.querySelector("input");
  pickerQuery.value = "Schema 4";
  pickerQuery.dispatchEvent(new window.Event("input"));
  assert.equal(pickerDialog.querySelectorAll(".schema-picker-results button").length, 1);
  pickerDialog.querySelector(".schema-picker-results button").click();
  assert.equal(pickedSchema, "Schema 4");
  pickerTestRail.remove();
  const checkboxField = window.eval('createFieldElement({id:"checkbox-layout-test", label:"اسم مربع الاختيار", type:"checkbox", width:"1"}, "main", "test-category")');
  assert.equal(checkboxField.querySelector(":scope > label:not(.standalone-check)"), null);
  assert.equal(checkboxField.querySelector(".standalone-check span").textContent, "اسم مربع الاختيار");
  const dateProbe = window.createFieldElement({ id: "repeat-date-probe", label: "تاريخ", type: "date_gregorian", width: "2" }, "related", relatedRecords.dataset.relatedRecords);
  documentCard.querySelector(".field-grid").append(dateProbe);
  const dayProbe = dateProbe.querySelector("[data-calendar-day]");
  const monthProbe = dateProbe.querySelector("[data-calendar-month]");
  const yearProbe = dateProbe.querySelector("[data-calendar-year]");
  const stableTab = relatedRecords.previousElementSibling.querySelector("[data-related-tab].is-active");
  for (const [part, value] of [[dayProbe, "12"], [monthProbe, "05"], [yearProbe, "2000"]]) {
    part.focus();
    part.value = value;
    part.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.activeElement, part, "repeated date changes keep the current date part focused");
  }
  assert.equal(relatedRecords.previousElementSibling.querySelector("[data-related-tab].is-active"), stableTab, "value changes retain the existing repeated tab node");
  dayProbe.focus();
  dayProbe.dispatchEvent(new window.KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, dayProbe);
  monthProbe.focus();
  monthProbe.dispatchEvent(new window.KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, monthProbe);
  yearProbe.focus();
  yearProbe.dispatchEvent(new window.Event("change", { bubbles: true }));
  yearProbe.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  const afterYearTab = document.activeElement;
  assert.notEqual(afterYearTab, yearProbe);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(document.activeElement, afterYearTab, "no delayed date focus overrides an explicit Tab");
  dateProbe.remove();
  const listProbe = valueControl(document, IDS.works);
  listProbe.focus();
  listProbe._chooseListOption(window.eval(`fieldById(${JSON.stringify(IDS.works)}, state.schema).options[0]`));
  listProbe.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  const afterListTab = document.activeElement;
  assert.notEqual(afterListTab, listProbe);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(document.activeElement, afterListTab, "list selection does not steal focus after Tab");
  assert.equal(document.querySelectorAll(".dialog-close svg").length, 0, "close buttons retain a single glyph");
  const profileProbe = window.eval(`(() => {
    const oldSchema = state.schema;
    const schema = deepClone(state.schema);
    const parent = {id:"portrait-parent", kind:"main", label:"صورة", fields:[
      {id:"portrait-file", type:"file", label:"الصورة", width:"2", image_display:"profile"},
      {id:"portrait-name", type:"text", label:"الاسم", width:"1"},
      {id:"portrait-after", type:"text", label:"بعد الفئة", width:"1"}
    ]};
    const child = {id:"portrait-child", kind:"main", label:"فئة تالية", parent_category_id:parent.id, parent_field_id:"portrait-name", fields:[]};
    schema.categories = [parent, child]; schema.conditions = [];
    state.schema = schema;
    try { return createEntryCategorySection(parent, new Map(), new Set()); }
    finally { state.schema = oldSchema; }
  })()`);
  document.querySelector("#record-form").append(profileProbe);
  assert.ok(profileProbe.querySelector(".field-grid > .profile-image-field .profile-image-preview-frame"));
  assert.equal(profileProbe.querySelector(".main-category-profile"), null);
  assert.equal(profileProbe.querySelector('[data-entry-category="portrait-child"]').parentElement, profileProbe.querySelector(".field-grid"), "child categories retain field-grid ordering");
  assert.equal(profileProbe.querySelector('[data-field-wrapper="portrait-after"]').closest(".main-category-layout"), null);
  profileProbe.remove();
  const oldHistoryReader = window.readBuilderHistory;
  const historyScope = window.eval('state.builderScope === "global" ? "__global__" : (state.activeSchemaId || "legacy")');
  window.readBuilderHistory = () => [
    { id: "match", schema_id: historyScope, schema_name: "Current", changes: [{ kind: "field", action: "added", label: "Needle" }] },
    { id: "other", schema_id: historyScope, schema_name: "Current", changes: [{ kind: "field", action: "added", label: "Other" }] }
  ];
  document.querySelector("#builder-history-query").value = "Needle";
  document.querySelector("#builder-history-query").dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll("#builder-history-dialog-list [data-open-builder-history]").length, 1);
  assert.ok(document.querySelector("#builder-view > #builder-history-dialog table tbody tr td"));
  for (const id of ["builder-history-query", "search-history-query", "import-history-search", "export-history-search"]) {
    assert.ok(document.getElementById(id).closest(".history-heading-actions"), "history search belongs to the table toolbar");
    assert.equal(document.getElementById(id).closest("aside"), null);
  }
  for (const id of ["clear-builder-history", "clear-search-history", "clear-import-history", "clear-export-history"]) {
    assert.equal(document.getElementById(id).querySelector("use").getAttribute("href"), "#icon-clear");
  }
  const plainNavigation = document.createElement("button");
  plainNavigation.className = "category-nav-button";
  plainNavigation.textContent = "Category";
  window.standardizeActionButton(plainNavigation);
  assert.equal(plainNavigation.querySelector("svg"), null, "navigation does not receive an inferred open arrow");
  document.querySelector("#builder-history-query").value = "";
  window.renderBuilderHistoryDialog();
  assert.equal(document.querySelectorAll("#builder-history-dialog-list [data-open-builder-history]").length, 2);
  window.readBuilderHistory = oldHistoryReader;
  const enter = new window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true
  });
  valueControl(document, IDS.name).dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(document.querySelectorAll(".related-card").length, countBeforeEnter);

  document.querySelector("#save-record-button").click();
  await waitFor(
    () =>
      !document.querySelector("#delete-record-button").hidden &&
      document.querySelector("#save-button-text").textContent === "حفظ التعديلات",
    "record to save and reload",
    15_000
  );
  assert.match(document.querySelector("#record-code").value, /^[A-Z][A-Z0-9]{7}$/);
  assert.equal(document.querySelector("#attachment-gallery").hidden, false);
  assert.equal(document.querySelectorAll(".gallery-card").length, 1);
  assert.equal(document.querySelectorAll(".gallery-preview").length, 1);
  document.querySelector('.gallery-preview').dispatchEvent(new window.Event('pointerover', {bubbles:true}));
  await waitFor(() => !document.querySelector('#app-hover-card').hidden, 'saved attachment detail card');
  assert.equal(document.querySelector('#app-hover-card strong').textContent, document.querySelector('.gallery-card-body span:last-child').textContent);
  assert.match(document.querySelector('#app-hover-card .app-hover-metadata').textContent, /الحقل.*الفئة.*مرفق محفوظ/);
  window.eval('appHoverCards.hide();');
  window.navigatorHoverTarget = document.querySelector('#category-navigator .category-nav-button');
  assert.ok(window.navigatorHoverTarget);
  Object.defineProperties(window.navigatorHoverTarget, {clientWidth:{configurable:true,value:10},scrollWidth:{configurable:true,value:100}});
  window.eval('appHoverCards.show(window.navigatorHoverTarget);');
  assert.equal(document.querySelector('#app-hover-card').hidden, true, 'Entry navigator has no tooltip even when clipped');


  assert.match(
    document.querySelector("#choose-search-fields-text").textContent,
    /الافتراضية/
  );
  document.querySelector("#choose-search-fields-button").click();
  assert.equal(document.querySelector("#search-fields-dialog").open, true);
  const notesSearchOption = document.querySelector(
    `#search-field-options [data-search-field-option="${IDS.notes}"]`
  );
  assert.ok(notesSearchOption);
  assert.equal(notesSearchOption.checked, false);
  assert.equal(
    document.querySelector(
      `#search-field-options [data-search-field-option="${IDS.customFile}"]`
    ),
    null
  );
  document.querySelector("#clear-all-search-fields-button").click();
  notesSearchOption.checked = true;
  document.querySelector("#apply-search-fields-button").click();
  assert.match(
    document.querySelector("#choose-search-fields-text").textContent,
    /مخصصة \(1\)/
  );
  assert.deepEqual(
    [...document.querySelectorAll("#search-fields [data-field-wrapper]")].map(
      (wrapper) => wrapper.dataset.fieldWrapper
    ),
    [IDS.notes]
  );
  setValue(window, valueControl(document, IDS.notes, "search"), "ملاحظة");
  document.querySelector("#search-button").click();
  await waitFor(
    () => document.querySelectorAll("#search-results .search-result-card").length === 1,
    "temporary field search result"
  );
  document.querySelector("#choose-search-fields-button").click();
  document.querySelector("#reset-search-fields-button").click();
  assert.match(
    document.querySelector("#choose-search-fields-text").textContent,
    /الافتراضية/
  );

  const searchName = valueControl(document, IDS.name, "search");
  const visibleSearchLabels = [
    ...document.querySelectorAll("#search-fields [data-field-wrapper] > label")
  ].map((label) => label.textContent);
  assert.ok(visibleSearchLabels.includes("الاسم"));
  assert.equal(visibleSearchLabels.some((label) => label.includes("—")), false);
  setValue(window, searchName, "علي");
  // Clear-search belongs directly below the primary Data Entry search action.
  assert.ok(document.querySelector("#entry-action-rail #clear-search-button"));
  assert.ok(document.querySelector("#search-button + #clear-search-button"));
  document.querySelector("#search-button").click();
  await waitFor(
    () => document.querySelectorAll("#search-results .search-result-card").length === 1,
    "search result"
  );
  const entryReadonlyButton = document.querySelector(
    "#search-results .search-result-card [data-readonly-record]"
  );
  assert.ok(entryReadonlyButton);
  entryReadonlyButton.click();
  assert.equal(window.__openedWindows.length, 1);
  assert.match(window.__openedWindows[0].url, /view=readonly/);
  window.__openedWindows.length = 0;
  document.querySelector(".search-result-open").click();
  await waitFor(
    () => valueControl(document, IDS.name).value === "عَلِي",
    "selected record to load"
  );
  setValue(window, valueControl(document, IDS.name), "علي المعدّل");
  document.querySelector("#save-record-button").click();
  await waitFor(
    async () => {
      const schema = await (await fetch(`${developerBase}api/schema`)).json();
      return schema.stats.record_count === 1 &&
        window.eval("!state.savingRecord && !state.loadingRecord && !state.recordDirty") &&
        valueControl(document, IDS.name).value === "علي المعدّل";
    },
    "record update"
  );

  const activeRecordCode = document.querySelector("#record-code").value;

  setValue(window, valueControl(document, IDS.name), "تغيير غير محفوظ");
  document.querySelector("#search-page-button").click();
  assert.equal(document.querySelector("#unsaved-record-dialog").open, true);
  assert.equal(document.querySelector("#entry-view").hidden, false);
  document.querySelector("#unsaved-stay-button").click();
  await waitFor(
    () => document.querySelector("#unsaved-record-dialog").open === false,
    "stay on the dirty record"
  );
  assert.equal(valueControl(document, IDS.name).value, "تغيير غير محفوظ");

  document.querySelector("#search-page-button").click();
  document.querySelector("#unsaved-discard-button").click();
  await waitFor(
    () =>
      document.querySelector("#full-search-view").hidden === false &&
      valueControl(document, IDS.name).value === "علي المعدّل",
    "discard changes before navigating"
  );
  assert.equal(document.querySelector("#search-header-actions"), null);
  assert.equal(document.querySelector("#entry-header-actions"), null);
  assert.equal(document.querySelector("#full-search-view .page-title-row"), null);
  assert.equal(
    document.querySelector(".search-results-section").classList.contains("workspace-panel"),
    false
  );
  document.querySelector("#search-filter-config-button").click();
  assert.equal(document.querySelector("#full-search-filter-dialog").open, true);
  assert.equal(document.querySelector("#full-search-fields-dialog").open, false);
  const fullSearchNotesFilter = document.querySelector(
    `[data-full-search-filter-option="${IDS.notes}"]`
  );
  assert.ok(fullSearchNotesFilter);
  assert.equal(fullSearchNotesFilter.checked, false);
  assert.equal(
    document.querySelector(
      `[data-full-search-filter-option="${IDS.customFile}"]`
    ),
    null
  );
  assert.equal(
    [...document.querySelectorAll('[data-full-search-filter-option^="__marker__:"]')]
      .some((checkbox) => checkbox.checked),
    false
  );
  const filterCategoryGroup = fullSearchNotesFilter.closest(
    "[data-full-search-option-category]"
  );
  const filterCategoryToggle = filterCategoryGroup.querySelector(
    "[data-full-search-category-option]"
  );
  assert.ok(filterCategoryToggle);
  filterCategoryToggle.checked = false;
  filterCategoryToggle.dispatchEvent(
    new window.Event("change", { bubbles: true })
  );
  assert.equal(
    [...filterCategoryGroup.querySelectorAll("[data-full-search-filter-option]")]
      .some((checkbox) => checkbox.checked),
    false
  );
  fullSearchNotesFilter.checked = true;
  fullSearchNotesFilter.dispatchEvent(
    new window.Event("change", { bubbles: true })
  );
  assert.equal(filterCategoryToggle.indeterminate, true);
  const idFilterOption = document.querySelector(
    '[data-full-search-filter-option="__record_code__"]'
  );
  assert.ok(idFilterOption);
  assert.equal(idFilterOption.checked, true);
  idFilterOption.checked = false;
  fullSearchNotesFilter.checked = true;
  document.querySelector("#apply-full-search-filters-button").click();
  await waitFor(
    () =>
      document.querySelector("#full-search-filter-dialog").open === false &&
      sharedFilterControl(document, IDS.notes, "search"),
    "custom full-search fields to apply"
  );
  const removableSchemaFilter = document.querySelector(
    `#schema-filter-selection-summary [data-remove-full-search-filter="${IDS.notes}"]`
  );
  assert.ok(removableSchemaFilter);
  removableSchemaFilter.click();
  assert.equal(sharedFilterControl(document, IDS.notes, "search"), null);
  document.querySelector("#search-filter-config-button").click();
  document.querySelector(`[data-full-search-filter-option="${IDS.notes}"]`).checked = true;
  document.querySelector("#apply-full-search-filters-button").click();
  await waitFor(
    () => sharedFilterControl(document, IDS.notes, "search"),
    "removed schema filter to be selectable again"
  );
  const schemaFilterCategories = [
    ...document.querySelectorAll("#schema-search-filter-groups .schema-search-filter-category:not([hidden])")
  ];
  assert.ok(schemaFilterCategories.length >= 1);
  assert.equal(
    schemaFilterCategories.every((category) =>
      category.querySelector(":scope > .schema-search-filter-category-title") &&
      category.querySelector(":scope > .schema-search-category-field-grid") &&
      window.getComputedStyle(category.querySelector(":scope > .schema-search-category-field-grid")).gridTemplateColumns === "repeat(4, minmax(0, 1fr))" &&
      [...category.querySelectorAll(":scope > .schema-search-category-field-grid > .field")]
        .every((field) => field.classList.contains("categorized-filter-control"))
    ),
    true,
    "schema filters must be grouped into explicit category rows"
  );
  document.querySelector("#full-search-options-button").click();
  assert.equal(document.querySelector("#full-search-fields-dialog").open, true);
  assert.equal(document.querySelector("#full-search-filter-dialog").open, false);
  const fullSearchNumberColumn = document.querySelector(
    `[data-full-search-column-option="${IDS.number}"]`
  );
  const idColumnOption = document.querySelector(
    '[data-full-search-column-option="__record_code__"]'
  );
  assert.ok(fullSearchNumberColumn);
  assert.ok(idColumnOption);
  assert.equal(fullSearchNumberColumn.checked, false);
  assert.equal(
    document.querySelector(`[data-full-search-column-option="${IDS.customFile}"]`),
    null
  );
  fullSearchNumberColumn.checked = true;
  idColumnOption.checked = false;
  document.querySelector("#apply-full-search-fields-button").click();
  assert.equal(
    window.getComputedStyle(document.querySelector("#full-search-options-summary .selection-category-group .selection-chip-list")).display,
    "flex",
    "result fields must keep the earlier flexible chip layout"
  );
  document.querySelector("#full-search-options-button").click();
  assert.equal(document.querySelector('[data-full-search-column-option="__record_code__"]').checked, false);
  document.querySelector("#full-search-fields-dialog [data-close-dialog]").click();
  document.querySelector("#search-filter-config-button").click();
  const appliedIdFilter = document.querySelector(
    '[data-full-search-filter-option="__record_code__"]'
  );
  assert.equal(
    document.querySelector(`[data-full-search-filter-option="${IDS.notes}"]`).checked,
    true,
    "reopening the filter dialog must preserve applied selections"
  );
  assert.equal(appliedIdFilter.checked, false);
  appliedIdFilter.checked = false;
  document.querySelector("#apply-full-search-filters-button").click();
  await waitFor(
    () => document.querySelector("#full-search-record-id-field").hidden,
    "ID filter to be removable"
  );
  document.querySelector("#search-filter-config-button").click();
  document.querySelector(
    '[data-full-search-filter-option="__record_code__"]'
  ).checked = true;
  document.querySelector("#apply-full-search-filters-button").click();
  await waitFor(
    () => !document.querySelector("#full-search-record-id-field").hidden,
    "ID filter to be restored"
  );
  setValue(window, "#full-search-record-id", activeRecordCode);
  document.querySelector("#full-search-submit-button").click();
  await waitFor(() => document.querySelector("#search-notes-dialog").open, "search notes dialog");
  setValue(window, "#search-notes-input", "بحث اكتمال اختباري");
  document.querySelector("#confirm-search-notes").click();
  await waitFor(
    () =>
      document.querySelectorAll("#full-search-table-body [data-edit-record]").length === 1,
    "full search ID filter"
  );
  assert.equal(
    window.getComputedStyle(document.querySelector("#schema-search-results-table-scroll")).overflowX,
    "scroll",
    "the schema result rails must stay visible inside the result viewport"
  );
  assert.ok(document.querySelectorAll("#search-history-list [data-search-history-id]").length >= 1);
  assert.ok(
    [...document.querySelectorAll("#full-search-table-head th")]
      .some((cell) => cell.textContent === "رقم")
  );
  assert.equal(
    [...document.querySelectorAll("#full-search-table-head th")]
      .some((cell) => cell.textContent === "ID"),
    false
  );
  const windowsBeforeReadonly = window.__openedWindows.length;
  document.querySelector("#full-search-table-body [data-readonly-record]").click();
  assert.equal(window.__openedWindows.length, windowsBeforeReadonly + 1);
  const readonlyWindow = window.__openedWindows.at(-1);
  assert.match(readonlyWindow.url, /view=readonly/);
  assert.match(readonlyWindow.url, new RegExp(`record=${activeRecordCode}`));

  document.querySelector(".page").scrollTop = 800;
  document.querySelector("#full-search-table-body [data-edit-record]").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    document.querySelector("#unsaved-record-dialog").open,
    false,
    "Opening a search result must not see a false dirty-record state"
  );
  await waitFor(
    () => document.querySelector("#entry-view").hidden === false,
    "editing a full-search result"
  );
  await waitFor(
    () => valueControl(document, IDS.name).value === "علي المعدّل",
    "edited result data to load"
  );
  await waitFor(
    () => document.querySelector(".page").scrollTop === 0,
    "edited result to open at the top"
  );

  const readonlyDom = await loadDom(
    `${developerBase}?view=readonly&record=${activeRecordCode}`,
    browserErrors
  );
  const readonlyDocument = readonlyDom.window.document;
  await waitFor(
    () =>
      readonlyDocument.querySelector("#readonly-title")?.textContent.includes(activeRecordCode) &&
      readonlyDocument.querySelectorAll(".readonly-section").length > 0,
    "read-only report to render"
  );
  assert.equal(readonlyDocument.body.classList.contains("readonly-window"), true);
  readonlyDom.window.navHoverTarget = readonlyDocument.querySelector('#category-navigator .category-nav-button');
  assert.ok(readonlyDom.window.navHoverTarget);
  Object.defineProperties(readonlyDom.window.navHoverTarget, {clientWidth:{configurable:true,value:10},scrollWidth:{configurable:true,value:100}});
  readonlyDom.window.eval('appHoverCards.show(window.navHoverTarget);');
  assert.equal(readonlyDocument.querySelector('#app-hover-card').hidden,true,'Read-only navigator suppresses clipped-name hover');

  assert.ok(readonlyDocument.querySelector('.readonly-field-grid > .readonly-field > dt'));
  assert.ok(readonlyDocument.querySelector('.readonly-field-grid > .readonly-field > dd'));
  assert.equal(
    readonlyDom.window.getComputedStyle(
      readonlyDocument.querySelector(".app-header")
    ).display,
    "none"
  );
  assert.equal(
    [...readonlyDocument.querySelectorAll(".readonly-field-grid dd")]
      .some((cell) => !cell.textContent.trim() || cell.textContent.trim() === "—"),
    false
  );
  assert.equal(
    [...readonlyDocument.querySelectorAll(".readonly-card")]
      .some((card) =>
        !card.querySelector(".readonly-field-grid") &&
        !card.querySelector(".readonly-markers")
      ),
    false
  );
  assert.ok(
    readonlyDocument.querySelectorAll(".readonly-section").length <
      fixtureSchema.categories.length
  );
  readonlyDom.window.close();

  document.querySelector("#export-page-button").click();
  assert.equal(document.querySelector("#export-view").hidden, false);
  assert.equal(document.querySelector("#category-navigator").offsetParent, null);
  assert.equal(document.querySelector("#export-action-rail").hidden, false);
  assert.ok(document.querySelector("#profile-export-profile-table-body"));
  assert.equal(document.querySelector("#export-scope-tabs").hidden, false);
  assert.ok(document.querySelector("#export-scope-tabs [data-export-profile-tab]"));
  assert.ok(document.querySelector("#export-view .exchange-history-panel"));
  document.querySelector('[data-export-mode="table"]').click();
  assert.ok(document.querySelector("#export-table-schema").options.length >= 1);
  assert.ok(document.querySelectorAll("#export-scope-tabs [data-export-schema-tab]").length >= 1);
  assert.equal(document.querySelector("#schema-export-mode-selector").hidden, false);
  assert.ok(document.querySelector("#export-button").closest("#export-action-rail"));
  document.querySelector("#open-export-filter-dialog").click();
  const firstExportFilter = document.querySelector("[data-export-filter-option]");
  assert.ok(firstExportFilter);
  assert.ok(firstExportFilter.closest("details.tree-option-group"));
  firstExportFilter.checked = true;
  document.querySelector("#apply-export-filters").click();
  assert.equal(document.querySelectorAll("#export-filter-values .shared-filter-control").length, 1);
  assert.equal(document.querySelectorAll("#export-filter-values .schema-search-filter-category").length, 1);
  assert.equal(
    window.getComputedStyle(document.querySelector("#export-filter-values .schema-search-category-field-grid")).gridTemplateColumns,
    "repeat(4, minmax(0, 1fr))"
  );
  assert.equal(document.querySelectorAll("#export-selected-filter-summary .selection-chip-empty").length, 0);
  assert.ok(document.querySelectorAll("#export-field-list input").length > 0);
  const firstExportGroup = document.querySelector(".export-field-group");
  const firstCategoryToggle = firstExportGroup.querySelector(
    "[data-export-category]"
  );
  const firstCategoryFields = [
    ...firstExportGroup.querySelectorAll("[data-export-field]")
  ];
  assert.ok(firstCategoryToggle);
  assert.ok(firstCategoryFields.length > 1);
  firstCategoryToggle.checked = false;
  firstCategoryToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(firstCategoryFields.some((checkbox) => checkbox.checked), false);
  firstCategoryFields[0].checked = true;
  firstCategoryFields[0].dispatchEvent(
    new window.Event("change", { bubbles: true })
  );
  assert.equal(firstCategoryToggle.indeterminate, true);
  firstCategoryToggle.checked = true;
  firstCategoryToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(firstCategoryFields.every((checkbox) => checkbox.checked), true);
  document.querySelector("#export-clear-categories").click();
  assert.equal(
    [...document.querySelectorAll("#export-field-list [data-export-field]")]
      .some((checkbox) => checkbox.checked),
    false
  );
  document.querySelector("#export-select-all-categories").click();
  assert.equal(
    [...document.querySelectorAll("#export-field-list [data-export-field]")]
      .every((checkbox) => checkbox.checked),
    true
  );
  document.querySelector("#apply-export-fields").click();
  assert.ok(document.querySelectorAll("#export-selected-field-summary .selection-chip").length > 0);
  assert.match(document.querySelector("#export-button").textContent, /Excel/);
  assert.equal(window.getComputedStyle(document.querySelector("#export-view .exchange-history-panel")).width, "100%");
  assert.equal(window.getComputedStyle(document.querySelector("#export-view .history-table-card")).width, "100%");
  document.querySelector("#import-page-button").click();
  assert.equal(document.querySelector("#import-view").hidden, false);
  assert.equal(document.querySelector("#import-schema-tabs").hidden, false);
  assert.equal(document.querySelector("#import-action-rail").hidden, false);
  assert.ok(document.querySelector("#import-target-schema").options.length >= 1);
  assert.ok(document.querySelectorAll("#import-schema-tabs [data-import-schema-tab]").length >= 1);
  assert.equal(window.getComputedStyle(document.querySelector("#import-view .exchange-history-panel")).width, "100%");
  assert.equal(window.getComputedStyle(document.querySelector("#import-view .history-table-card")).width, "100%");
  assert.ok(document.querySelector("#commit-import-button").closest("#import-action-rail"));
  assert.equal(document.querySelector("#commit-import-button").disabled, true);
  assert.equal(document.querySelector("#import-panel").classList.contains("admin-panel-locked"), false);
  assert.equal(document.querySelector("#import-mapping-placeholder").hidden, false);
  const importSourceResponse = await fetch(`${developerBase}api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      criteria: { _allow_empty: true },
      field_ids: [IDS.name, IDS.number],
      include_related: false
    })
  });
  assert.equal(importSourceResponse.status, 200);
  const importWorkbookBytes = execFileSync("python", ["-c", "import sys,io; from openpyxl import load_workbook; w=load_workbook(io.BytesIO(sys.stdin.buffer.read())); s=w.worksheets[0]; headers=[c.value for c in s[1]]; s.cell(3,headers.index(sys.argv[1])+1).value='Review imported name'; b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())", IDS.name], {input:Buffer.from(await importSourceResponse.arrayBuffer())});
  const importSource = new window.File(
    [importWorkbookBytes],
    "import-mapping-test.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
  Object.defineProperty(document.querySelector("#import-file"), "files", {
    configurable: true,
    value: [importSource]
  });
  document.querySelector("#import-file").dispatchEvent(
    new window.Event("change", { bubbles: true })
  );
  document.querySelector("#inspect-import-button").click();
  await waitFor(
    () =>
      (document.querySelector("#import-mapping-area").hidden === false &&
        document.querySelectorAll(".import-mapping-row").length > 0) ||
      (
        document.querySelector("#import-result").textContent.trim() &&
        !document.querySelector("#import-result").textContent.includes("جاري")
      ),
    "import inspection to finish"
  );
  assert.equal(
    document.querySelector("#import-mapping-area").hidden,
    false,
    document.querySelector("#import-result").textContent
  );
  assert.equal(document.querySelector("#import-mapping-placeholder").hidden, true);
  assert.equal(document.querySelectorAll(".import-mapping-header strong").length, 2);
  assert.ok(document.querySelector(".import-mapping-row select optgroup"));
  assert.equal(document.querySelector("#commit-import-button").disabled, false);
  const importMappingControls = [...document.querySelectorAll("[data-import-column]")];
  importMappingControls.filter((control) => !control.value).forEach((control) => {
    control.value = "__ignore__";
    control.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(
    document.querySelector("#commit-import-button").disabled,
    false,
    document.querySelector("#import-inspection-problems").textContent
  );
  if (importMappingControls.length > 1) {
    const originalSecondTarget = importMappingControls[1].value;
    importMappingControls[1].value = importMappingControls[0].value;
    importMappingControls[1].dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#import-inspection-problems").hidden, false);
    assert.equal(document.querySelector("#commit-import-button").disabled, true);
    importMappingControls[1].value = originalSecondTarget;
    importMappingControls[1].dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#commit-import-button").disabled, false);
  }
  document.querySelector("#commit-import-button").click();
  await waitFor(()=>document.querySelector('#import-review-dialog').open===true || (document.querySelector('#import-result').textContent && !document.querySelector('#import-result').textContent.includes('جاري')), 'read-only import review to open');
  assert.equal(document.querySelector('#import-review-dialog').open,true,document.querySelector('#import-result').textContent + activeServers.map(server=>server.capturedErrors||'').join('\n'));
  assert.ok(document.querySelectorAll('#import-review-entries .import-value-conflict').length>0,'review exposes old and new values: '+window.eval('JSON.stringify(state.importReview)'));
  document.querySelector('[data-close-dialog="import-review-dialog"]').click();
  assert.equal(document.querySelector('#import-result-dialog').open,false,'cancel does not commit');
  document.querySelector('#commit-import-button').click();
  await waitFor(()=>document.querySelector('#import-review-dialog').open===true,'fresh review to open');
  document.querySelector('[data-import-review-bulk="keep"]').click();
  assert.ok([...document.querySelectorAll('#import-review-entries .import-value-conflict [data-import-review-change]')].every(input=>!input.checked),'keep existing values declines overwrites');
  document.querySelector('#apply-import-review').click();
  await waitFor(
    () => document.querySelector("#import-result-dialog").open === true,
    "import result dialog to open"
  );
  assert.match(document.querySelector("#import-result-summary").textContent, /أضيف|حُدّث/);
  setValue(window, "#import-result-notes", "اختبار سجل الاستيراد");
  document.querySelector("#finalize-import-result").click();
  await waitFor(
    () => document.querySelector("#import-result-dialog").open === false,
    "import result history to finalize"
  );
  document.querySelector("#settings-page-button").click();
  assert.equal(document.querySelector("#settings-view").hidden, false);
  assert.equal(document.querySelector("#settings-view").open, true);
  assert.ok(document.querySelector("#settings-view .settings-sheet"));
  assert.equal(document.querySelectorAll("#settings-view .settings-section.workspace-panel").length, 0);
  assert.equal(document.querySelectorAll("[data-settings-category-tab]").length, 4);
  assert.ok(document.querySelector("#setting-builder-history-limit"));
  document.querySelector('[data-settings-category-tab="interface"]').click();
  assert.equal(document.querySelector('[data-settings-category="application"]').hidden, true);
  assert.equal(document.querySelectorAll('[data-settings-category="interface"]').length, 1);
  assert.equal(document.querySelector('[data-settings-category="interface"]').hidden, false);
  setValue(window, "#setting-home-entry-history-limit", "3", "change");
  document.querySelector('[data-settings-category-tab="shortcuts"]').click();
  assert.equal(document.querySelector('[data-settings-category="interface"]').hidden, false, "unsaved settings must block category navigation");
  document.querySelector("#save-workspace-preferences").click();
  await waitFor(() => window.eval("state.settingsDirty") === false, "interface settings guard to clear after applying");
  document.querySelector('[data-settings-category-tab="shortcuts"]').click();
  assert.equal(document.querySelector('[data-settings-category="shortcuts"]').hidden, false);
  assert.equal(document.querySelector("[data-settings-primary-save]"), null);
  assert.equal(document.querySelectorAll(".shortcut-settings-group").length, 4);
  assert.equal(document.querySelector(".shortcut-capture").dir, "ltr");
  assert.equal(window.eval('normalizedShortcutFromEvent({ctrlKey:true,altKey:false,shiftKey:false,metaKey:false,code:"KeyA",key:"ش"})'), "Ctrl+A");
  document.querySelector('[data-settings-category-tab="interface"]').click();
  assert.ok(document.querySelector("#shortcut-settings-list"));
  assert.ok(document.querySelector("#setting-background-image"));
  assert.equal(document.querySelector("#setting-background-all-pages").checked, false);
  document.querySelector("#setting-background-all-pages").checked = true;
  document.querySelector("#save-workspace-preferences").click();
  await waitFor(
    () => document.body.classList.contains("workspace-background-all-pages"),
    "workspace background scope to apply to every page"
  );
  document.querySelector("#setting-background-all-pages").checked = false;
  document.querySelector("#save-workspace-preferences").click();
  await waitFor(
    () => !document.body.classList.contains("workspace-background-all-pages"),
    "workspace background scope to return to Home only"
  );
  assert.equal(document.querySelector("#settings-page-button").getAttribute("aria-current"), null);
  assert.equal(document.querySelector("#setting-title").value, "نظام تجريبي");
  assert.equal(document.querySelector("#settings-mode-badge"), null);
  setValue(window, "#setting-search-page-size", "100", "change");
  document.querySelector("#save-workspace-preferences").click();
  await waitFor(
    () => window.eval("state.schema.app.search_page_size") === 100,
    "interface workflow settings to save"
  );
  document.querySelector('#settings-view [data-close-dialog="settings-view"]').click();
  document.querySelector("#entry-mode-button").click();
  await waitFor(
    () => valueControl(document, IDS.name).value === "علي المعدّل",
    "the selected record to survive a settings refresh"
  );
  document.querySelector("#home-mode-button").click();
  assert.equal(document.querySelector("#home-view").hidden, false);
  assert.equal(document.body.classList.contains("home-mode-active"), true);
  assert.equal(document.querySelector("#home-record-count"), null);
  assert.equal(document.querySelector("#home-completed-count"), null);
  assert.equal(document.querySelector("#home-archived-count"), null);
  assert.equal(
    window.getComputedStyle(document.querySelector(".global-navigation")).display,
    "flex"
  );
  document.querySelector("#search-page-button").click();
  assert.equal(document.body.classList.contains("home-mode-active"), false);
  document.querySelector("#home-mode-button").click();
  assert.equal(document.body.classList.contains("home-mode-active"), true);

  const headerStyles = fs.readFileSync(
    path.join(projectDir, "app", "styles.css"),
    "utf8"
  );
  assert.match(
    headerStyles,
    /#close-app-button\s*\{[^}]*position:\s*static/s,
    "Exit button must belong to the global header instead of floating over the page"
  );
  assert.doesNotMatch(
    headerStyles,
    /#close-app-button\s*\{[^}]*position:\s*fixed/s,
    "Exit button must never be fixed to a page corner"
  );
  assert.match(
    headerStyles,
    /body\.home-mode-active\s*\{[^}]*home-background\.jpg[^}]*cover/s,
    "The Home photograph must cover the application background instead of a card"
  );
  assert.doesNotMatch(
    headerStyles,
    /\.home-view::before\s*\{[^}]*home-background\.jpg/s,
    "The Home content wrapper must not own the photograph"
  );
  assert.match(
    headerStyles,
    /\.home-view\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent/s,
    "The Home content wrapper must not render as a background container"
  );
  assert.match(
    headerStyles,
    /data-mode="import"[^}]*workspace-action-sidebar[^{]*\{[^}]*border:\s*1px/s,
    "Import actions must be contained in a bordered sidebar"
  );
  assert.match(
    headerStyles,
    /data-mode="export"[^}]*workspace-action-sidebar[^{]*\{[^}]*border:\s*1px/s,
    "Export actions must be contained in a bordered sidebar"
  );
  assert.match(
    headerStyles,
    /\.exchange-history-panel\s*\{[^}]*overflow:\s*hidden/s,
    "Import and Export histories must share one comfortable table container"
  );
  assert.match(
    headerStyles,
    /\.settings-sheet\s*>\s*\.settings-section\s+\.check-field\s*\{[^}]*border:\s*0/s,
    "Settings checkboxes must remain lightweight borderless rows"
  );
  assert.match(
    headerStyles,
    /\.shortcut-setting-row\s*\{[^}]*border:\s*0/s,
    "Shortcut settings must not render cards inside the Settings card"
  );
  assert.match(
    headerStyles,
    /data-mode="home"[^}]*grid-template-columns:[^;}]*workspace-action-width[^;}]*workspace-nav-width/s,
    "Home must reserve balanced empty rail margins"
  );
  assert.match(
    headerStyles,
    /\.search-history-table\s+\.search-history-record\s*\{[^}]*display:\s*table-row/s,
    "Search history entries must remain table rows"
  );

  fs.cpSync(developerData, multiData, { recursive: true });
  const multiServer = startServer(multiData, true, true);
  const multiPort = await multiServer.portPromise;
  const multiBase = `http://127.0.0.1:${multiPort}/`;
  const multiDom = await loadDom(multiBase, browserErrors);
  const multiDocument = multiDom.window.document;
  const multiWindow = multiDom.window;
  assert.equal(multiDocument.querySelector("#workspace-schema-strip"), null);
  multiDocument.querySelector("#entry-mode-button").click();
  assert.equal(multiDocument.querySelectorAll("#entry-schema-tabs [data-schema-tab]").length, 1);
  multiDocument.querySelector("#builder-mode-button").click();
  assert.equal(multiDocument.querySelectorAll("#builder-schema-tabs [data-schema-tab]").length, 1);
  assert.ok(multiDocument.querySelector("#builder-sidebar-add-category-button").closest("#builder-action-rail"));
  assert.equal(multiDocument.querySelector("#builder-schema-tabs button:first-of-type").dataset.builderGlobalTab, "true");
  multiDocument.querySelector("#builder-schema-tabs [data-builder-global-tab]").click();
  assert.equal(multiWindow.eval("state.builderScope"), "global");
  assert.notEqual(multiWindow.getComputedStyle(multiDocument.querySelector("#category-navigator")).display, "none");
  assert.ok(multiDocument.querySelector("#builder-global-save-state"));
  const globalBuilderStats = multiDocument.querySelector("#global-builder-stats");
  const schemaBuilderStats = multiDocument.querySelector("#builder-intro-panel");
  assert.equal(globalBuilderStats.className, schemaBuilderStats.className);
  assert.equal(
    multiWindow.getComputedStyle(globalBuilderStats).gridTemplateColumns,
    multiWindow.getComputedStyle(schemaBuilderStats).gridTemplateColumns,
    "global and schema Builder summaries must use identical geometry"
  );
  multiWindow.navigatorHoverTarget = multiDocument.querySelector('#category-navigator .category-nav-button');
  if (multiWindow.navigatorHoverTarget) {
    Object.defineProperties(multiWindow.navigatorHoverTarget, {clientWidth:{configurable:true,value:10},scrollWidth:{configurable:true,value:100}});
    multiWindow.eval('appHoverCards.show(window.navigatorHoverTarget);');
    assert.equal(multiDocument.querySelector('#app-hover-card').hidden, true, 'Builder navigator has no tooltip');
  }
  const previousGlobalDefinitions = multiWindow.eval("deepClone(state.globalDefinitions)");
  const generalSummary = multiWindow.eval(`globalPackageConditionSummary({category_tree: [{key: "c", definition: {label: "الفئة"}, fields: [{key: "f", definition: {label: "الحالة", type: "select", options: [{id: "internal-option-id", label: "مقبول"}]}}]}]}, {target_type: "category", target_key: "c", source_field_key: "f", operator: "equals", value: "internal-option-id"})`);
  assert.match(generalSummary, /الحالة.*مقبول/);
  assert.equal(generalSummary.includes("internal-option-id"), false);
  multiWindow.eval(`state.globalDefinitions = ${JSON.stringify({
    revision: 1,
    categories: {
      gcat_visual: {
        id: "gcat_visual",
        definition: {
          label: "الفئة العامة الأم",
          kind: "main",
          category_tree: [
            {
              key: "root",
              parent_key: "",
              definition: { label: "الفئة العامة الأم", kind: "main", description: "" },
              fields: [{ key: "root-field", definition: { label: "الحقل العام", type: "text" } }]
            },
            {
              key: "child",
              parent_key: "root",
              definition: { label: "الفئة العامة الفرعية", kind: "main", description: "" },
              fields: []
            }
          ],
          conditions: []
        }
      }
    },
    fields: {
      gfield_visual: { id: "gfield_visual", definition: { label: "حقل عام منفصل", type: "text" } }
    }
  })}; renderGlobalDefinitions(); renderBuilderCategoryNavigator();`);
  const generalRoot = multiDocument.querySelector('#global-category-list');
  const generalPanel = multiDocument.getElementById('global-definition-category-gcat_visual');
  const generalChild = multiDocument.getElementById('global-category-node-gcat_visual-child');
  const generalTab = generalRoot.querySelector('[data-main-category-tab]');
  assert.ok(generalTab && generalPanel.contains(generalChild), 'general categories use main tabs and nested category layout');
  generalTab.click();
  assert.equal(generalRoot.querySelectorAll('[data-main-category-tab]').length, 2, 'standalone fields always share the category tab rail');
  assert.equal(generalPanel.getAttribute('role'), 'tabpanel');
  assert.match(generalTab._categoryHoverCard().details, /فئة رئيسية/);
  const globalField = () => multiDocument.getElementById('global-embedded-gcat_visual-root-field');
  const independentGlobalField = multiDocument.getElementById('global-definition-field-gfield_visual');
  assert.equal(globalField().querySelector('input').placeholder, '', 'no generated type-name placeholder');
  assert.equal(globalField().querySelector('[data-preview-select]').dataset.hoverLabel, 'الحقل العام');
  globalField().querySelector('[data-preview-select]').click();
  assert.equal(globalField().querySelector('[data-preview-actions]').hidden, false);
  assert.equal(multiWindow.getComputedStyle(globalField().querySelector('[data-preview-actions]')).position, 'absolute');
  globalField().dispatchEvent(new multiWindow.KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(globalField().querySelector('[data-preview-actions]').hidden, true);
  const retainedGeneralField = globalField();
  multiWindow.eval('renderGlobalDefinitions(); renderGlobalDefinitions();');
  assert.equal(globalField(), retainedGeneralField);
  multiWindow.eval(`
    Object.assign(state.globalDefinitions.categories.gcat_visual.definition.category_tree[0].fields[0].definition, {placeholder:'النص المساعد',required:true,searchable:true});
    state.globalDefinitions.revision++;
    renderGlobalDefinitions();
  `);
  assert.notEqual(globalField(), retainedGeneralField);
  assert.equal(globalField().querySelector('input').placeholder, 'النص المساعد');
  assert.equal(globalField().querySelector('[data-preview-select]').dataset.hoverLabel, 'الحقل العام');
  assert.equal(multiDocument.getElementById('global-definition-field-gfield_visual'), independentGlobalField);
  assert.equal(generalRoot.querySelector('[data-main-category-tab]'), generalTab);
  // Existing edit dialogs still receive original references, not preview IDs.
  globalField().querySelector('[data-preview-select]').click();
  globalField().querySelector('[data-builder-action="edit-field"]').click();
  assert.equal(multiDocument.querySelector('#field-dialog').open, true);
  assert.equal(multiWindow.eval('state.globalEditor.globalRef'), 'gcat_visual');
  assert.equal(multiDocument.querySelector('#field-placeholder').value, 'النص المساعد');
  multiDocument.querySelector('#field-dialog').close();
  await waitFor(() => !multiWindow.eval('state.globalEditor'), 'general preview edit dialog cleanup');
  assert.equal(generalRoot.querySelector('[data-main-category-tab]'), generalTab);
  multiWindow.eval('appHoverCards.show(document.querySelector("#global-category-list [data-main-category-tab]"));');
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden, false);
  assert.equal(multiDocument.querySelector('#app-hover-card strong').textContent, 'الفئة العامة الأم');
  assert.match(multiDocument.querySelector('#app-hover-card').textContent, /فئة رئيسية.*الحقل العام/);
  multiWindow.eval('appHoverCards.hide();');
  const hoverName = globalField().querySelector('[data-preview-select]');
  Object.defineProperties(hoverName, {clientWidth:{configurable:true,value:100},scrollWidth:{configurable:true,value:100}});
  multiWindow.eval('appHoverCards.show(document.querySelector("#global-category-list .builder-preview-name"));');
  // Field names never show cards; the input preview owns field details.
  multiWindow.appHoverTestTarget = hoverName;
  multiWindow.eval('appHoverCards.show(window.appHoverTestTarget);');
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden, true);
  multiWindow.eval('selectBuilderPreviewItem("", "", false, elements.globalCategoryList);');
  globalField().querySelector('input').dispatchEvent(new multiWindow.Event('pointerover', {bubbles:true}));
  await waitFor(() => !multiDocument.querySelector('#app-hover-card').hidden, 'field body hover details');
  assert.equal(multiDocument.querySelector('#app-hover-card strong').textContent, 'الحقل العام');
  multiWindow.eval('appHoverCards.hide();');
  const ordinaryLabel = multiDocument.createElement('button');
  ordinaryLabel.textContent = 'اسم كامل';
  multiDocument.body.append(ordinaryLabel);
  Object.defineProperties(ordinaryLabel, {clientWidth:{configurable:true,value:100},scrollWidth:{configurable:true,value:100}});
  multiWindow.appHoverTestTarget = ordinaryLabel;
  multiWindow.eval('appHoverCards.show(window.appHoverTestTarget);');
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden, true);
  Object.defineProperty(ordinaryLabel,'scrollWidth',{configurable:true,value:200});
  multiWindow.eval('appHoverCards.show(window.appHoverTestTarget);');
  assert.equal(multiDocument.querySelector('#app-hover-card').textContent, 'اسم كامل');
  multiWindow.eval('appHoverCards.hide();');
  ordinaryLabel.remove();
  assert.ok(multiDocument.querySelector("#new-global-category"));
  assert.ok(multiDocument.querySelector("#new-global-field"));
  multiWindow.eval(`state.globalDefinitions = ${JSON.stringify(previousGlobalDefinitions)}; renderGlobalDefinitions(); renderBuilderCategoryNavigator();`);
  const discardRef = multiWindow.eval("randomDefinitionId('gfld')");
  await multiWindow.eval(`saveGlobalDefinition('field', '${discardRef}', {label:'مسودة للتجاهل',type:'text'})`);
  multiWindow.eval('renderGlobalDefinitions();');
  assert.equal(multiDocument.querySelector('#save-general-definitions').disabled, false);
  assert.equal(multiWindow.eval('hasUnsavedWorkspaceChanges()'), true);
  const discardPromise = multiWindow.eval('discardGeneralDefinitions()');
  await waitFor(() => multiDocument.querySelector('#action-confirm-dialog').open, 'discard general definitions confirmation');
  multiDocument.querySelector('#action-confirm-accept').click();
  await discardPromise;
  assert.equal(multiWindow.eval(`Boolean(state.globalDefinitions.fields['${discardRef}'])`), false);
  assert.equal(multiWindow.eval('generalDraftDirty()'), false);
  // A general category has no records of its own, regardless of the active schema.
  const originalRecordCount = multiWindow.eval('state.schema.stats.record_count');
  multiWindow.eval('state.schema.stats.record_count = 1;');
  multiDocument.querySelector('#new-global-category').click();
  const repeatedGeneralRef = multiWindow.eval('state.globalEditor.globalRef');
  multiDocument.querySelector('#category-label').value = 'فئة عامة متكررة جديدة';
  multiDocument.querySelector('#category-kind').value = 'repeatable';
  multiDocument.querySelector('#category-kind').dispatchEvent(new multiWindow.Event('change', {bubbles:true}));
  multiDocument.querySelector('#confirm-category-button').click();
  await waitFor(() => !multiDocument.querySelector('#category-dialog').open, 'new general repeated root accepted with active schema records');
  await waitFor(() => multiWindow.eval(`Boolean(state.globalDefinitions.categories['${repeatedGeneralRef}'])`), 'new general repeated root staged');
  assert.equal(multiWindow.eval(`state.globalDefinitions.categories['${repeatedGeneralRef}'].definition.kind`), 'repeatable');
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  const reloadedGeneral = await multiWindow.eval("fetch('/api/global-definitions').then(response => response.json())");
  assert.equal((reloadedGeneral.global_definitions || reloadedGeneral).categories[repeatedGeneralRef].definition.kind, 'repeatable');
  const removeRepeatedPromise = multiWindow.eval(`deleteGlobalDefinition('category', '${repeatedGeneralRef}')`);
  await waitFor(() => multiDocument.querySelector('#action-confirm-dialog').open, 'remove repeated regression fixture');
  multiDocument.querySelector('#action-confirm-accept').click();
  await removeRepeatedPromise;
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  // Persisted schema category kind changes remain blocked when records exist.
  const savedCategoryId = multiWindow.eval('state.schema.categories[0].id');
  const savedCategoryKind = multiWindow.eval('state.schema.categories[0].kind');
  multiWindow.eval(`state.schema.stats.record_count = 1; openCategoryDialog('${savedCategoryId}');`);
  multiDocument.querySelector('#category-kind').value = savedCategoryKind === 'main' ? 'repeatable' : 'main';
  multiDocument.querySelector('#confirm-category-button').click();
  assert.equal(multiDocument.querySelector('#category-dialog').open, true);
  assert.equal(multiWindow.eval(`categoryById('${savedCategoryId}').kind`), savedCategoryKind);
  multiDocument.querySelector('#category-dialog').close();
  multiWindow.eval(`state.schema.stats.record_count = ${JSON.stringify(originalRecordCount)};`);
  // Exercise the new preview actions against the real global-definition API.
  const persistedGeneralRef = multiWindow.eval("randomDefinitionId('gcat')");
  await multiWindow.eval(`saveGlobalDefinition('category', '${persistedGeneralRef}', {
    label:'اختبار المعاينة العامة',kind:'main',category_tree:[{key:'root',definition:{label:'اختبار المعاينة العامة',kind:'main'},fields:[
      {key:'first',definition:{label:'الأول',type:'text',width:'1'}},
      {key:'second',definition:{label:'الثاني',type:'text',width:'2'}}
    ]}],conditions:[]
  })`);
  assert.equal(multiWindow.eval('generalDraftDirty()'), true);
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  multiWindow.eval('renderGlobalDefinitions();');
  const persistedGeneralPanel = () => multiDocument.getElementById(`global-definition-category-${persistedGeneralRef}`);
  multiDocument.querySelector(`[aria-controls="global-definition-category-${persistedGeneralRef}"]`).click();
  let persistedFirstRow = persistedGeneralPanel().querySelector('.builder-preview-field');
  persistedFirstRow.querySelector('[data-preview-select]').click();
  persistedFirstRow.querySelector('[data-builder-action="edit-field"]').click();
  multiDocument.querySelector('#field-placeholder').value = 'مساعدة محفوظة';
  multiDocument.querySelector('#confirm-field-button').click();
  await waitFor(() => multiWindow.eval(`state.globalDefinitions.categories['${persistedGeneralRef}'].definition.category_tree[0].fields[0].definition.placeholder`) === 'مساعدة محفوظة', 'general preview edit staged');
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  await waitFor(() => persistedGeneralPanel().querySelector('input').placeholder === 'مساعدة محفوظة', 'saved help returned to the general preview');
  persistedFirstRow = persistedGeneralPanel().querySelector('.builder-preview-field');
  persistedFirstRow.querySelector('[data-preview-select]').click();
  persistedFirstRow.querySelector('[data-builder-action="move-field-down"]').click();
  await waitFor(() => multiWindow.eval(`state.globalDefinitions.categories['${persistedGeneralRef}'].definition.category_tree[0].fields[0].definition.label`) === 'الثاني', 'general arrow reordered draft fields');
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  await waitFor(() => persistedGeneralPanel().querySelector('.builder-preview-name').textContent.includes('الثاني'), 'reordered general field rendered');
  const movedFirstRow = [...persistedGeneralPanel().querySelectorAll('.builder-preview-field')].find(row => row.querySelector('input')?.placeholder === 'مساعدة محفوظة');
  movedFirstRow.querySelector('[data-preview-select]').click();
  movedFirstRow.querySelector('[data-builder-action="delete-field"]').click();
  await waitFor(() => multiDocument.querySelector('#action-confirm-dialog').open, 'delete general field confirmation');
  multiDocument.querySelector('#action-confirm-accept').click();
  await waitFor(() => multiWindow.eval(`state.globalDefinitions.categories['${persistedGeneralRef}'].definition.category_tree[0].fields.length`) === 1, 'general preview field deletion staged');
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  const removeGeneralPromise = multiWindow.eval(`deleteGlobalDefinition('category', '${persistedGeneralRef}')`);
  await waitFor(() => multiDocument.querySelector('#action-confirm-dialog').open, 'delete test general category confirmation');
  multiDocument.querySelector('#action-confirm-accept').click();
  await removeGeneralPromise;
  assert.equal(persistedGeneralPanel(), null);
  assert.equal(await multiWindow.eval('saveGeneralDefinitions()'), true);
  multiDocument.querySelector("#builder-schema-tabs [data-schema-tab]").click();
  await waitFor(() => multiWindow.eval("state.builderScope") === "schema", "schema Builder scope to return");
  assert.equal(
    multiDocument.querySelector("#builder-schema-tabs").closest("#header-schema-navigation")?.id,
    "header-schema-navigation"
  );
  multiDocument.querySelector("#duplicate-schema-button").click();
  assert.equal(multiDocument.querySelector("#action-input-dialog").open, true);
  multiDocument.querySelector("#action-input-control").value = "العاملون - نسخة";
  multiDocument.querySelector("#action-input-accept").click();
  await waitFor(
    () => multiDocument.querySelectorAll("#builder-schema-tabs [data-schema-tab]").length === 2,
    "duplicated schema to appear"
  );
  assert.equal(multiDocument.querySelector("#builder-active-schema-name"), null);
  assert.equal(multiDocument.querySelector("#builder-schema-tabs .is-active").textContent, "العاملون - نسخة");
  assert.notEqual(
    multiDocument.querySelector("#entry-schema-tabs .is-active").textContent,
    multiDocument.querySelector("#builder-schema-tabs .is-active").textContent,
    "Entry and Builder must retain independent schema selections"
  );
  const builderSchemaBeforeHome = multiWindow.eval("state.activeSchemaId");
  multiDocument.querySelector("#home-mode-button").click();
  await waitFor(
    () => multiDocument.querySelectorAll("#home-data-schema-tabs [data-home-data-schema]").length === 2,
    "Home Data Entry schema tabs to load"
  );
  assert.equal(multiDocument.querySelector("#home-data-schema-tabs").hidden, false);
  assert.equal(multiDocument.querySelectorAll("#recent-records .home-schema-panel:not([hidden])").length, 1);
  const homeAddStatistic = multiDocument.querySelector("#home-data-general-tags .home-add-stat");
  assert.ok(homeAddStatistic);
  assert.equal(homeAddStatistic.textContent.trim(), "+");
  assert.equal(homeAddStatistic.classList.contains("home-schema-stat-tag"), false);
  homeAddStatistic.click();
  assert.equal(multiDocument.querySelector("#home-custom-stat-dialog").open, true);
  assert.equal(
    multiDocument.querySelectorAll("#home-custom-stat-schema-fields [data-home-custom-stat-values][multiple]").length,
    2
  );
  multiDocument.querySelector('[data-close-dialog="home-custom-stat-dialog"]').click();
  assert.equal(multiDocument.querySelectorAll("#home-builder-general-tags .home-builder-overview-card").length, 3);
  assert.equal(multiDocument.querySelectorAll("#home-builder-general-tags .home-builder-overview-count").length, 1);
  assert.equal(multiDocument.querySelectorAll("#home-builder-general-tags .home-builder-overview-breakdown").length, 2);
  assert.equal(multiDocument.querySelectorAll("#home-builder-general-tags .home-builder-mini-pie").length, 4);
  const firstBuilderShare = multiDocument.querySelector("#home-builder-general-tags .home-builder-overview-share");
  const firstBuilderShareLabel = firstBuilderShare.querySelector("small").textContent;
  firstBuilderShare.click();
  assert.notEqual(firstBuilderShare.querySelector("small").textContent, firstBuilderShareLabel);
  assert.equal(firstBuilderShare.getAttribute("aria-pressed"), "true");
  const globalBuilderHomePanel = multiDocument.querySelector('[data-home-builder-panel="__global__"]');
  assert.equal(globalBuilderHomePanel.textContent.match(/بلا فئة/g)?.length || 0, 1);
  assert.equal(globalBuilderHomePanel.textContent.match(/ضمن فئة/g)?.length || 0, 1);
  const alternateHomeSchema = [...multiDocument.querySelectorAll("#home-data-schema-tabs [data-home-data-schema]")]
    .find((tab) => !tab.classList.contains("is-active"));
  alternateHomeSchema.click();
  assert.equal(alternateHomeSchema.getAttribute("aria-selected"), "true");
  assert.equal(multiDocument.querySelectorAll("#recent-records .home-schema-panel:not([hidden])").length, 1);
  alternateHomeSchema.click();
  await waitFor(() => multiWindow.eval("state.mode") === "entry", "active Home Data tab to open Data Entry");
  multiDocument.querySelector("#home-mode-button").click();
  await waitFor(
    () => multiDocument.querySelectorAll("#home-builder-schema-tabs [data-home-builder-schema]").length === 3,
    "Home dashboards to reload after Data Entry navigation"
  );
  assert.equal(multiDocument.querySelectorAll("#home-builder-schema-tabs [data-home-builder-schema]").length, 3);
  assert.ok(multiDocument.querySelector('#home-builder-schema-tabs [data-home-builder-schema="__global__"]'));
  assert.equal(multiDocument.querySelectorAll("#home-builder-schemas .home-schema-panel:not([hidden])").length, 1);
  const alternateHomeBuilderSchema = multiDocument.querySelector(
    `#home-builder-schema-tabs [data-home-builder-schema="${builderSchemaBeforeHome}"]`
  );
  assert.ok(alternateHomeBuilderSchema);
  assert.equal(alternateHomeBuilderSchema.classList.contains("is-active"), false);
  alternateHomeBuilderSchema.click();
  assert.equal(alternateHomeBuilderSchema.getAttribute("aria-selected"), "true");
  assert.equal(multiDocument.querySelectorAll("#home-builder-schemas .home-schema-panel:not([hidden])").length, 1);
  const selectedBuilderHomePanel = multiDocument.querySelector("#home-builder-schemas .home-schema-panel:not([hidden])");
  assert.equal(selectedBuilderHomePanel.querySelectorAll(".home-builder-structure-group").length, 2);
  assert.equal(selectedBuilderHomePanel.querySelectorAll(".home-builder-structure-total").length, 2);
  assert.ok(
    [...selectedBuilderHomePanel.querySelectorAll(".home-builder-structure-total")]
      .every((total) => !total.classList.contains("home-schema-stat-tag"))
  );
  assert.equal(selectedBuilderHomePanel.querySelectorAll(".home-builder-structure-partition").length, 6);
  const builderCharts = selectedBuilderHomePanel.querySelectorAll(
    '[data-configure-home-builder-chart][data-home-builder-chart-slot]'
  );
  assert.equal(builderCharts.length, 2, "Builder panels expose two chart slots");
  assert.deepEqual(
    [...builderCharts].map((chart) => chart.dataset.homeBuilderChartSlot),
    ["primary", "secondary"]
  );
  assert.deepEqual(
    [...builderCharts].map((chart) => multiWindow.getComputedStyle(chart).gridRow),
    ["1", "2"],
    "the final CSS cascade must place Builder charts in separate rows"
  );
  assert.ok(
    [...builderCharts].every((chart) => multiWindow.getComputedStyle(chart).gridArea !== "chart"),
    "shared Home chart styles must not move Builder charts back into one named area"
  );
  assert.ok(
    selectedBuilderHomePanel.querySelectorAll(".home-builder-bar-percent").length >= 2,
    "stacked Builder bars display visible percentages"
  );
  selectedBuilderHomePanel.querySelector('[data-home-builder-chart-slot="secondary"]').click();
  assert.equal(multiDocument.querySelector("#home-chart-dialog").open, true);
  assert.match(multiDocument.querySelector("#home-chart-dialog-schema").textContent, /الرسم الثاني/);
  multiDocument.querySelector("#home-chart-type").value = "gauge";
  multiDocument.querySelector("#home-chart-type").dispatchEvent(
    new multiWindow.Event("change", { bubbles: true })
  );
  multiDocument.querySelector("#apply-home-chart").click();
  assert.ok(
    selectedBuilderHomePanel.querySelector('[data-home-builder-chart-slot="secondary"] .home-schema-gauge')
  );
  const circularSegment = selectedBuilderHomePanel.querySelector(
    '[data-home-builder-chart-slot="secondary"] .home-schema-gauge-segment'
  );
  const circularChart = selectedBuilderHomePanel.querySelector('[data-home-builder-chart-slot="secondary"]');
  assert.ok(circularSegment);
  assert.equal(selectedBuilderHomePanel.querySelector('.home-builder-bar-legend'), null);
  assert.equal(selectedBuilderHomePanel.querySelector('.home-schema-chart-field'), null);
  multiWindow.eval('appHoverCards.hide();');
  circularSegment.dispatchEvent(new multiWindow.Event('pointerover', {bubbles:true}));
  await waitFor(() => !multiDocument.querySelector('#app-hover-card').hidden, 'full chart legend on hover');
  assert.equal(multiDocument.querySelectorAll('#app-hover-card .app-hover-chart-legend > div').length, circularChart._chartHoverCard().legend.length);
  assert.match(multiDocument.querySelector('#app-hover-card').textContent, /\d+\s*\(\d+%\)/);
  multiDocument.dispatchEvent(new multiWindow.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden, true);
  circularChart.dispatchEvent(new multiWindow.FocusEvent('focusin', {bubbles:true}));
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden, false, 'chart details accessible by keyboard');
  multiWindow.eval('appHoverCards.hide();');
  // Warm Home refresh retains panels and only revalidates dataset signatures.
  await multiWindow.eval('loadHomeSchemaDashboards()');
  const retainedHomePanel = multiDocument.querySelector('#recent-records [data-home-schema]:not([hidden])');
  multiWindow.eval(`window.homeTestRequests = []; window.homeTestFetch = window.fetch;
    window.fetch = async (...args) => { window.homeTestRequests.push(String(args[0])); return window.homeTestFetch(...args); };`);
  await multiWindow.eval('Promise.all([loadHomeSchemaDashboards(), loadHomeSchemaDashboards()])');
  assert.equal(multiDocument.querySelector('#recent-records [data-home-schema]:not([hidden])'), retainedHomePanel);
  assert.equal(multiWindow.homeTestRequests.filter(url => url.startsWith('/api/home/schema')).length, 2, 'overlapping refreshes share schema requests');
  assert.ok(multiWindow.homeTestRequests.filter(url => url.startsWith('/api/home/schema')).every(url => url.includes('signature=')));
  assert.equal(multiWindow.homeTestRequests.filter(url => url.includes('/api/search/field-values')).length, 0, 'unchanged charts reuse counts');
  multiWindow.eval('window.fetch = window.homeTestFetch;');
  assert.equal(multiDocument.querySelectorAll('.home-view .main-category-tab-workspace').length, 2);
  assert.ok(
    selectedBuilderHomePanel.querySelector('[data-home-builder-chart-slot="primary"] .home-builder-stacked-bar'),
    "changing the second Builder chart leaves the first chart independent"
  );
  alternateHomeBuilderSchema.click();
  await waitFor(() => multiWindow.eval("state.mode") === "builder", "active Home Builder tab to open Builder");
  const dirtyBuilderSchemaId = multiDocument.querySelector(
    "#builder-schema-tabs .is-active"
  ).dataset.schemaTab;
  multiDocument.querySelector('[data-builder-action="edit-field"]').click();
  setValue(multiWindow, "#field-label", "حقل محفوظ داخل التبويب");
  multiDocument.querySelector("#confirm-field-button").click();
  assert.equal(multiDocument.querySelector("#builder-save-state").dataset.dirty, "true");
  const otherBuilderTab = [...multiDocument.querySelectorAll(
    "#builder-schema-tabs [data-schema-tab]"
  )].find((tab) => tab.dataset.schemaTab !== dirtyBuilderSchemaId);
  otherBuilderTab.click();
  await waitFor(
    () =>
      multiDocument.querySelector("#builder-schema-tabs .is-active")?.dataset.schemaTab === otherBuilderTab.dataset.schemaTab &&
      multiWindow.eval("state.activeSchemaId") === otherBuilderTab.dataset.schemaTab,
    "clean Builder schema tab to open"
  );
  const unloadEvent = new multiWindow.Event("beforeunload", { cancelable: true });
  multiWindow.dispatchEvent(unloadEvent);
  assert.equal(unloadEvent.defaultPrevented, true, "cached dirty schema tabs must warn before closing");
  multiDocument.querySelector(`#builder-schema-tabs [data-schema-tab="${dirtyBuilderSchemaId}"]`).click();
  await waitFor(
    () =>
      multiWindow.eval("state.activeSchemaId") === dirtyBuilderSchemaId &&
      [...multiDocument.querySelectorAll(".builder-field-row")]
        .some((row) => row.textContent.includes("حقل محفوظ داخل التبويب")),
    "unsaved Builder draft to survive schema tab switches"
  );
  multiDocument.querySelector("#close-app-button").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(multiDocument.querySelector("#close-confirm-dialog").open, true);
  multiDocument.querySelector("#close-confirm-cancel").click();
  assert.equal(multiDocument.querySelector("#builder-view").hidden, false, "Exit cancellation must retain the application");
  multiWindow.eval("state.activeRequests = 1");
  multiDocument.querySelector("#close-app-button").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    multiWindow.eval("state.closing"),
    false,
    "Exit must not start while an application request is active"
  );
  multiWindow.eval("state.activeRequests = 0");
  multiDocument.querySelector("#close-confirm-cancel").click();
  multiDocument.querySelector("#discard-schema-button").click();
  assert.equal(multiDocument.querySelector("#action-confirm-dialog").open, true);
  multiDocument.querySelector("#action-confirm-accept").click();
  await waitFor(
    () => multiDocument.querySelector("#builder-save-state").dataset.dirty === "false",
    "custom discard confirmation to clear Builder changes"
  );
  assert.equal(multiDocument.querySelector("#builder-save-state").dataset.dirty, "false");
  multiDocument.querySelector("#save-schema-button").click();
  await waitFor(
    () =>
      multiDocument.querySelector("#schema-spinner").hidden === true &&
      multiDocument.querySelector("#builder-save-state").dataset.dirty === "false",
    "builder save to finish"
  );
  assert.equal(multiDocument.querySelector("#builder-view").hidden, false);

  multiDocument.querySelector("#reuse-existing-identity-button").click();
  setValue(multiWindow, "#profile-source-id", activeRecordCode);
  multiDocument.querySelector("#inspect-profile-link-button").click();
  await waitFor(
    () => {
      const ready = !multiDocument.querySelector("#profile-mapping-area").hidden;
      const status = multiDocument.querySelector("#profile-link-status").textContent;
      if (!ready && status && !status.includes("جاري")) throw new Error(status);
      return ready;
    },
    "cross-schema profile mappings to load"
  );
  assert.ok(multiDocument.querySelectorAll("[data-profile-source-field]").length > 1);
  const sourceStatus = multiDocument.querySelector(
    `[data-profile-source-field="${IDS.status}"]`
  );
  sourceStatus.value = IDS.name;
  multiDocument.querySelectorAll("[data-profile-source-field]").forEach((select) => {
    if (select !== sourceStatus) select.value = "";
  });
  multiDocument.querySelector("#confirm-profile-link-button").click();
  await waitFor(
    () =>
      multiDocument.querySelector("#profile-link-dialog").open === false &&
      multiDocument.querySelector("#record-code").value === activeRecordCode,
    () => `linked profile to open (dialog=${multiDocument.querySelector("#profile-link-dialog").open}, code=${multiDocument.querySelector("#record-code").value}, status=${multiDocument.querySelector("#profile-link-status").textContent}, toast=${multiDocument.querySelector("#toast").textContent}, errors=${browserErrors.slice(-3).join(" | ")})`
  );
  assert.equal(valueControl(multiDocument, IDS.name).value, "نشط");

  multiWindow.eval("state.schema.app.draft_autosave = false");
  const dirtyEntrySchemaId = multiDocument.querySelector(
    "#entry-schema-tabs .is-active"
  ).dataset.schemaTab;
  setValue(multiWindow, valueControl(multiDocument, IDS.name), "مسودة بلا حفظ تلقائي");
  const otherEntryTab = [...multiDocument.querySelectorAll(
    "#entry-schema-tabs [data-schema-tab]"
  )].find((tab) => tab.dataset.schemaTab !== dirtyEntrySchemaId);
  otherEntryTab.click();
  await waitFor(
    () =>
      multiDocument.querySelector("#entry-schema-tabs .is-active")?.dataset.schemaTab === otherEntryTab.dataset.schemaTab &&
      multiWindow.eval("state.activeSchemaId") === otherEntryTab.dataset.schemaTab,
    "other Data Entry schema tab to open"
  );
  multiDocument.querySelector(`#entry-schema-tabs [data-schema-tab="${dirtyEntrySchemaId}"]`).click();
  await waitFor(
    () =>
      multiWindow.eval("state.activeSchemaId") === dirtyEntrySchemaId &&
      valueControl(multiDocument, IDS.name).value === "مسودة بلا حفظ تلقائي",
    "unsaved Data Entry values to survive schema tab switches when local autosave is disabled"
  );
  multiDocument.querySelector("#save-record-button").click();
  await waitFor(
    () => multiWindow.eval("state.recordDirty") === false,
    "tab-restored Data Entry draft to save"
  );

  multiDocument.querySelector("#export-page-button").click();
  setValue(multiWindow, "#profile-export-record-code", activeRecordCode);
  multiDocument.querySelector("#inspect-profile-export").click();
  await waitFor(
    () => multiDocument.querySelectorAll("#profile-export-profile-table-body [data-profile-export-schema]").length >= 1,
    "cross-schema PDF profile table to load"
  );
  assert.equal(multiDocument.querySelector("#profile-export-options-dialog").open, false);
  assert.equal(multiDocument.querySelector("#choose-profile-export-location").disabled, false);
  assert.equal(multiDocument.querySelectorAll("#profile-export-field-tags .selection-category-group").length, 0);
  // Only checked profiles contribute local or shared field choices.
  multiWindow.eval(`window.savedProfileInspection = state.profileExportInspection;
    const first = state.profileExportInspection.profiles[0];
    state.profileExportInspection = {...state.profileExportInspection, profiles:[first, {schema_id:'hidden-profile-test',schema_name:'Hidden profile',fields:[{field_id:'hidden-field-test',label:'Hidden field',category:'Hidden category',type:'text'},{field_id:'hidden-global-test',label:'Hidden global',category:'Hidden category',global_ref:'g_hidden_test',type:'text'}]}]};
    renderProfileInspectionTable();`);
  const hiddenProfileCheck=multiDocument.querySelector('[data-profile-export-schema="hidden-profile-test"]');
  hiddenProfileCheck.checked=false;
  multiDocument.querySelector('#open-profile-export-fields').click();
  assert.equal(multiDocument.querySelector('[data-profile-export-field="hidden-field-test"]'),null);
  assert.equal(multiDocument.querySelector('[data-profile-export-global-choice="g_hidden_test"]'),null);
  multiDocument.querySelector('#profile-export-options-dialog').close();
  hiddenProfileCheck.checked=true;
  multiDocument.querySelector('#open-profile-export-fields').click();
  assert.ok(multiDocument.querySelector('[data-profile-export-field="hidden-field-test"]'));
  multiDocument.querySelector('#profile-export-options-dialog').close();
  multiWindow.eval('state.profileExportInspection = window.savedProfileInspection; renderProfileInspectionTable();');
  // PDF options flow passes both flags and cancellation never exports.
  multiWindow.eval(`window.savedPdfExportRequest=saveExportRequest; window.savedExportNotes=requestExportNotes;
    window.savedPdfDestination=state.exportDestinations.profile;
    state.exportDestinations.profile='/tmp/test-options.pdf';
    window.capturedPdfPayload=null; saveExportRequest=async payload => {window.capturedPdfPayload=payload;return {filename:'test.pdf'};};
    requestExportNotes=async () => '';`);
  const cancelPdfPromise=multiWindow.eval('exportProfilePdf()');
  const appearanceDialog=multiDocument.querySelector('#profile-pdf-appearance-dialog');
  assert.equal(appearanceDialog.open,true);
  appearanceDialog.returnValue='cancel'; appearanceDialog.close();
  await cancelPdfPromise;
  assert.equal(multiWindow.capturedPdfPayload,null);
  const exportPdfPromise=multiWindow.eval('exportProfilePdf()');
  multiDocument.querySelector('#profile-pdf-show-image').checked=true;
  multiDocument.querySelector('#profile-pdf-show-attachments').checked=true;
  multiDocument.querySelector('#confirm-profile-pdf-appearance').click();
  await exportPdfPromise;
  assert.equal(multiWindow.capturedPdfPayload.show_profile_image,true);
  assert.equal(multiWindow.capturedPdfPayload.show_attachments,true);
  assert.ok(!multiWindow.capturedPdfPayload.schema_ids.includes('hidden-profile-test'));
  multiWindow.eval('saveExportRequest=window.savedPdfExportRequest;requestExportNotes=window.savedExportNotes;state.exportDestinations.profile=window.savedPdfDestination;');
  multiDocument.querySelector("#open-profile-export-fields").click();
  assert.equal(multiDocument.querySelector("#profile-export-options-dialog").open, true);
  const profileCategoryToggle = multiDocument.querySelector("#profile-export-options-dialog [data-profile-export-category-option]");
  assert.ok(profileCategoryToggle);
  assert.equal(profileCategoryToggle.closest("details").open, false);
  assert.equal(profileCategoryToggle.checked, false);
  multiDocument.querySelector('[data-profile-field-action="select"][data-profile-field-target="report"]').click();
  assert.equal(
    [...multiDocument.querySelectorAll("#profile-export-selection input[type=checkbox]")].every((input) => input.checked),
    true
  );
  multiDocument.querySelector('[data-profile-field-action="clear"][data-profile-field-target="report"]').click();
  assert.equal(
    [...multiDocument.querySelectorAll("#profile-export-selection input[type=checkbox]")].some((input) => input.checked),
    false
  );
  profileCategoryToggle.checked = true;
  profileCategoryToggle.dispatchEvent(new multiWindow.Event("change", { bubbles: true }));
  multiDocument.querySelector("#apply-profile-export-fields").click();
  assert.ok(multiDocument.querySelectorAll("#profile-export-field-tags .selection-category-group").length >= 1);
  multiDocument.querySelector("#open-profile-info-fields").click();
  assert.equal(multiDocument.querySelector("#profile-info-fields-dialog").open, true);
  assert.equal(
    [...multiDocument.querySelectorAll("#profile-info-field-selection details")].every((details) => details.open === false),
    true
  );
  assert.equal(
    [...multiDocument.querySelectorAll("#profile-info-field-selection input[type=checkbox]")].some((input) => input.checked),
    false
  );
  multiDocument.querySelector('[data-profile-field-action="select"][data-profile-field-target="info"]').click();
  assert.equal(
    [...multiDocument.querySelectorAll("#profile-info-field-selection input[type=checkbox]")].every((input) => input.checked),
    true
  );
  multiDocument.querySelector('[data-profile-field-action="clear"][data-profile-field-target="info"]').click();
  assert.equal(multiDocument.querySelectorAll("#profile-info-field-selection [data-profile-info-token]").length, 0);
  const profileInfoChoices = [...multiDocument.querySelectorAll("#profile-info-field-selection [data-profile-info-field]")];
  profileInfoChoices.slice(0, 2).forEach((input) => {
    input.checked = true;
    input.dispatchEvent(new multiWindow.Event("change", { bubbles: true }));
  });
  assert.equal(
    multiDocument.querySelectorAll("#profile-info-field-selection [data-profile-info-token]").length,
    2,
    "the Profile PDF formatter must expose only currently selected fields"
  );
  const firstInfoLabel = profileInfoChoices[0].closest("label").textContent.trim();
  const infoFormat = multiDocument.querySelector("[data-profile-info-format-schema]");
  const infoToken = [...multiDocument.querySelectorAll("[data-profile-info-token]")]
    .find((button) => button.dataset.profileInfoToken.includes(firstInfoLabel));
  assert.ok(infoToken, "profile information formats expose insertion tokens");
  infoFormat.value = "معلومات:";
  infoFormat.focus();
  infoFormat.setSelectionRange(infoFormat.value.length, infoFormat.value.length);
  infoToken.click();
  multiDocument.querySelector("#apply-profile-info-fields").click();
  assert.match(multiDocument.querySelector("#profile-export-profile-table-body .profile-export-info-text").textContent, /^معلومات:/);

  // Batch inspection keeps row choices independent while sharing each schema's field picker.
  const batchOriginalFetch = multiWindow.fetch;
  const batchProfile = multiWindow.eval('state.profileExportInspection.profiles[0]');
  const batchRequests = [];
  multiWindow.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/identities/inspect')) {
      const body = JSON.parse(options.body); batchRequests.push(body);
      return {ok:true,json:async()=>({record_code:body.record_code,profiles:body.record_code==='Z9999999'?[]:body.record_code==='B1234567'?[batchProfile,{...batchProfile,schema_id:'batch-extra',schema_name:'تصميم إضافي'}]:[batchProfile]})};
    }
    if (String(url).endsWith('/api/export/destination')) {
      multiWindow.batchDestinationPayload=JSON.parse(options.body);
      return {ok:true,json:async()=>({destination:'/tmp/batch-reports.zip'})};
    }
    if (String(url).endsWith('/api/export/save')) {
      multiWindow.batchSavePayload=JSON.parse(options.body);
      return {ok:true,json:async()=>({filename:'batch-reports.zip',row_count:2})};
    }
    return batchOriginalFetch(url,options);
  };
  setValue(multiWindow,'#profile-export-record-code','a1234567، B1234567\nA1234567; Z9999999');
  await multiWindow.eval('inspectProfileExport()');
  assert.deepEqual(batchRequests.map(item=>item.record_code),['A1234567','B1234567','Z9999999']);
  assert.match(multiDocument.querySelector('#profile-export-status').textContent,/Z9999999/);
  let batchRows=[...multiDocument.querySelectorAll('[data-profile-export-schema]')];
  assert.equal(batchRows.length,3);
  assert.deepEqual(batchRows.map(input=>input.dataset.profileExportRecord),['A1234567','B1234567','B1234567']);
  batchRows[1].checked=false;
  multiWindow.eval('renderProfileInspectionTable()');
  batchRows=[...multiDocument.querySelectorAll('[data-profile-export-schema]')];
  assert.equal(batchRows[0].checked,true);assert.equal(batchRows[1].checked,false);
  batchRows[1].checked=true;
  multiWindow.eval('renderProfileExportFieldPicker()');
  assert.equal(multiDocument.querySelectorAll('#profile-export-selection .profile-export-schema-fields').length,2);
  // Matrix headers can select several schemas across IDs without affecting ID inclusion.
  const matrix=multiDocument.querySelector('#profile-export-profile-table-body').closest('table');
  assert.equal(matrix.querySelectorAll('[data-profile-export-schema-column]').length,2);
  assert.equal(matrix.querySelectorAll('tbody tr').length,3,'one row per ID, including unmatched IDs');
  const identityA=matrix.querySelector('[data-profile-export-identity="A1234567"]');
  const identityB=matrix.querySelector('[data-profile-export-identity="B1234567"]');
  const missingIdentity=matrix.querySelector('[data-profile-export-identity="Z9999999"]');
  assert.equal(missingIdentity.disabled,true);
  assert.equal(identityA.closest('tr').querySelector('[data-profile-export-schema="batch-extra"]'),null,'unavailable memberships cannot be selected');
  const schemaMasters=[...matrix.querySelectorAll('[data-profile-export-schema-column]')];
  const change=element=>element.dispatchEvent(new multiWindow.Event('change',{bubbles:true}));
  identityB.checked=false;change(identityB);
  schemaMasters.forEach(master=>{master.checked=false;change(master);});
  schemaMasters.forEach(master=>{master.checked=true;change(master);});
  assert.equal(identityB.checked,false,'schema bulk actions never include excluded IDs');
  assert.ok([...identityB.closest('tr').querySelectorAll('[data-profile-export-schema]')].every(input=>input.disabled&&input.checked));
  assert.deepEqual([...multiWindow.eval('selectedProfileExportSchemaIds()')],[batchProfile.schema_id],'fields omit schemas found only in excluded IDs');
  identityB.checked=true;change(identityB);
  assert.equal(multiWindow.eval('selectedProfileExportInputs().length'),3,'one ID can select multiple schemas');
  const baseMaster=schemaMasters.find(master=>master.dataset.profileExportSchemaColumn===batchProfile.schema_id);
  const oneCell=identityA.closest('tr').querySelector('[data-profile-export-schema]');
  oneCell.checked=false;change(oneCell);assert.equal(baseMaster.indeterminate,true);
  baseMaster.checked=true;change(baseMaster);assert.equal(baseMaster.indeterminate,false);
  const allIdentities=matrix.querySelector('[data-profile-export-all-identities]');
  allIdentities.checked=false;change(allIdentities);
  assert.equal(multiWindow.eval('selectedProfileExportInputs().length'),0);
  allIdentities.checked=true;change(allIdentities);
  assert.equal(missingIdentity.checked,false);
  await multiWindow.eval('chooseExportDestination("profile")');
  assert.equal(multiWindow.batchDestinationPayload.type,'profile_pdf_batch');
  oneCell.checked=false;change(oneCell);
  await multiWindow.eval('exportProfilePdf()');
  assert.equal(appearanceDialog.open,false,'an included ID without selected schemas must not silently disappear');
  oneCell.checked=true;change(oneCell);
  multiWindow.eval('window.batchSavedNotes=requestExportNotes;requestExportNotes=async()=>"";');
  const batchExportPromise=multiWindow.eval('exportProfilePdf()');
  assert.equal(appearanceDialog.open,true);
  multiDocument.querySelector('#confirm-profile-pdf-appearance').click();
  await batchExportPromise;
  assert.equal(multiWindow.batchSavePayload.type,'profile_pdf_batch');
  assert.equal(multiWindow.batchSavePayload.destination,'/tmp/batch-reports.zip');
  assert.deepEqual([...multiWindow.batchSavePayload.record_codes],['A1234567','B1234567']);
  assert.deepEqual(Object.keys(multiWindow.batchSavePayload.schema_ids_by_record),['A1234567','B1234567']);
  assert.deepEqual([...multiWindow.batchSavePayload.schema_ids_by_record.B1234567],[batchProfile.schema_id,'batch-extra']);
  assert.equal(multiWindow.batchSavePayload.show_profile_image,true);
  assert.equal(multiWindow.batchSavePayload.show_attachments,true);
  identityB.checked=false;change(identityB);
  multiWindow.eval('state.exportDestinations.profile="/tmp/one-included.zip";');
  const subsetExportPromise=multiWindow.eval('exportProfilePdf()');
  multiDocument.querySelector('#confirm-profile-pdf-appearance').click();
  await subsetExportPromise;
  assert.deepEqual([...multiWindow.batchSavePayload.record_codes],['A1234567'],'excluded ID never reaches export payload');
  assert.equal(multiWindow.batchSavePayload.schema_ids_by_record.B1234567,undefined);
  multiWindow.eval('renderProfileInspectionTable()');
  assert.equal(matrix.querySelector('[data-profile-export-identity="B1234567"]').checked,false,'ID exclusion persists across re-rendering');
  multiWindow.eval('requestExportNotes=window.batchSavedNotes;');
  setValue(multiWindow,'#profile-export-record-code','C1234567');
  assert.equal(multiWindow.eval('profileExportInputMatchesInspection()'),false,'changed IDs require fresh inspection');
  multiWindow.fetch=batchOriginalFetch;


  multiDocument.querySelector("#search-page-button").click();
  await waitFor(() => multiDocument.querySelector('#header-schema-navigation [data-search-type="global"]'), "Search scope row to mount after schema switching");
  multiDocument.querySelector('[data-search-type="global"]').click();
  assert.equal(multiDocument.querySelector("#multi-schema-search").hidden, false);
  multiDocument.querySelectorAll("[data-global-query-schema]").forEach((button) => {
    if (button.getAttribute("aria-pressed") !== "true") {
      button.click();
    }
  });
  multiDocument.querySelector("#general-search-filter-button").click();
  assert.equal(multiDocument.querySelector("#full-search-filter-dialog").open, true);
  const globalCategoryToggle = multiDocument.querySelector("[data-global-category-option]");
  assert.ok(globalCategoryToggle, "global field dialogs must select whole categories");
  globalCategoryToggle.checked = true;
  globalCategoryToggle.dispatchEvent(new multiWindow.Event("change", { bubbles: true }));
  assert.equal([...globalCategoryToggle.closest("details").querySelectorAll(".search-field-option-grid input")].every((input) => input.checked), true);
  multiDocument.querySelector("#apply-full-search-filters-button").click();
  const removableGlobalFilter = multiDocument.querySelector(
    "#global-filter-selection-summary [data-remove-global-filter-field]"
  );
  assert.ok(removableGlobalFilter);
  const removableGlobalFilterId = removableGlobalFilter.dataset.removeGlobalFilterField;
  const removableGlobalFilterSchema = removableGlobalFilter.dataset.removeGlobalFilterSchema;
  removableGlobalFilter.click();
  assert.equal(
    multiDocument.querySelector(`#global-filter-selection-summary [data-remove-global-filter-field="${removableGlobalFilterId}"][data-remove-global-filter-schema="${removableGlobalFilterSchema}"]`),
    null
  );
  multiDocument.querySelector("#general-search-fields-button").click();
  assert.equal(multiDocument.querySelector("#full-search-fields-dialog").open, true);
  multiDocument.querySelector("#apply-full-search-fields-button").click();
  setValue(multiWindow, "#global-search-query", "نشط");
  multiDocument.querySelector("#full-search-submit-button").click();
  await waitFor(() => multiDocument.querySelector("#search-notes-dialog").open, "global search notes dialog");
  multiDocument.querySelector("#confirm-search-notes").click();
  await waitFor(
    () => multiDocument.querySelectorAll("#multi-schema-results .multi-result-section").length === 2,
    "separate global result groups"
  );
  assert.equal(multiDocument.querySelector("#multi-schema-results .global-result-card"), null);
  assert.equal(multiDocument.querySelectorAll("#multi-schema-results .global-result-table").length, 2);
  assert.ok(multiDocument.querySelector("#multi-schema-results .global-result-table [data-open-multi-record]"));
  assert.deepEqual(
    [...multiDocument.querySelectorAll("#multi-schema-results .search-table-summary strong")]
      .map((item) => item.textContent.includes("1 نتيجة")),
    [true, false]
  );

  assert.deepEqual(
    browserErrors.filter(
      (message) =>
        !message.includes("Not implemented: navigation") &&
        !message.includes("Could not parse CSS stylesheet")
    ),
    []
  );

  // Create a dependent schema through the actual Builder dialog.
  multiDocument.querySelector('#builder-mode-button').click();
  await waitFor(() => !multiDocument.querySelector('#builder-view').hidden, 'Builder before dependent schema creation');
  multiDocument.querySelector('#create-schema-button').click();
  await waitFor(() => multiDocument.querySelector('#create-schema-dialog').open, 'new schema options');
  const followSourceId = multiWindow.eval('state.activeSchemaId');
  multiDocument.querySelector('#create-schema-name').value = 'ملفات تابعة';
  multiDocument.querySelector('#create-schema-follow').checked = true;
  multiDocument.querySelector('#create-schema-follow').dispatchEvent(new multiWindow.Event('change', { bubbles: true }));
  assert.equal(multiDocument.querySelector('#create-schema-source-field').hidden, false);
  multiDocument.querySelector('#create-schema-source').value = followSourceId;
  multiDocument.querySelector('#create-schema-form').dispatchEvent(new multiWindow.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => multiWindow.eval('state.schema?.schema_name') === 'ملفات تابعة', 'dependent schema to be selected');
  assert.equal(multiWindow.eval('state.workspace.schemas.find(s => s.id === state.activeSchemaId).profile_source_schema_id'), followSourceId);

  // Main tabs retain live controls, expose nested navigation and preserve values.
  multiWindow.eval(`
    state.schema.categories = [
      {id:'tab-main-a', kind:'main', label:'الأولى', fields:[
        {id:'tab-name', type:'text', label:'الاسم', width:'4'},
        {id:'tab-wide', type:'text', label:'واسع', width:'4'},
        {id:'tab-check', type:'checkbox', label:'اختيار', width:'1'}
      ]},
      {id:'tab-child', kind:'main', label:'الفرعية', parent_category_id:'tab-main-a', fields:[
        {id:'tab-child-value', type:'text', label:'قيمة', width:'1'}
      ]},
      {id:'tab-main-b', kind:'main', label:'الثانية', fields:[
        {id:'tab-other', type:'text', label:'آخر', width:'1'}
      ]}
    ];
    state.schema.conditions = [];
    state.schema.auto_updates = [];
    performSwitchMode('entry'); renderEntryForm(); renderBuilderCategoryNavigator();
  `);
  const mainTabs = [...multiDocument.querySelectorAll('#record-form [data-main-category-tab]')];
  assert.equal(mainTabs.length, 2, 'only parentless main categories become tabs');
  const panelA = multiDocument.querySelector('#record-form [data-main-category-panel="tab-main-a"]');
  const panelB = multiDocument.querySelector('#record-form [data-main-category-panel="tab-main-b"]');
  assert.equal(panelA.querySelector(':scope > .section-heading'), null);
  assert.equal(mainTabs.some(tab => tab.querySelector('svg, [data-remove-related-card], [data-add-related]')), false);
  const retainedControl = multiDocument.querySelector('[data-field-id="tab-name"][data-value-control]');
  retainedControl.value = 'preserved value';
  mainTabs[1].click();
  assert.equal(panelA.classList.contains('main-category-panel-inactive'), true);
  assert.equal(panelB.classList.contains('main-category-panel-inactive'), false);
  const otherControl = multiDocument.querySelector('[data-field-id="tab-other"][data-value-control]');
  otherControl.focus();
  setValue(multiWindow, otherControl, 'second tab value', 'input');
  assert.equal(multiDocument.activeElement, otherControl, 'editing keeps focus inside the active tab');
  assert.equal(mainTabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(multiWindow.eval('entryFieldTabStops().some(c => c.dataset.fieldId === "tab-name")'), false);
  const childNav = multiDocument.querySelector('[data-builder-category-nav="tab-child"]');
  assert.equal(childNav.disabled, false, 'inactive tabs remain available in the navigator');
  childNav.click();
  assert.equal(panelA.classList.contains('main-category-panel-inactive'), false);
  assert.equal(multiDocument.querySelector('[data-field-id="tab-name"][data-value-control]'), retainedControl);
  assert.equal((await multiWindow.eval('collectMainPayload()'))['tab-name'], 'preserved value');
  mainTabs[0].dispatchEvent(new multiWindow.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  assert.equal(mainTabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(multiDocument.activeElement, mainTabs[1]);
  const pressCategoryTab = (from, expected, reverse = false) => {
    from.focus();
    const event = new multiWindow.KeyboardEvent('keydown', {key:'Tab', shiftKey:reverse, bubbles:true, cancelable:true});
    from.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(multiDocument.activeElement, expected, 'Tab follows category label, its fields, then the next label');
  };
  const wideControl = multiDocument.querySelector('[data-field-id="tab-wide"][data-value-control]');
  const checkControl = multiDocument.querySelector('[data-field-id="tab-check"][data-value-control]');
  const childControl = multiDocument.querySelector('[data-field-id="tab-child-value"][data-value-control]');
  mainTabs[0].click();
  pressCategoryTab(mainTabs[0], retainedControl);
  pressCategoryTab(retainedControl, wideControl);
  pressCategoryTab(wideControl, checkControl);
  pressCategoryTab(checkControl, childControl);
  pressCategoryTab(childControl, mainTabs[1]);
  assert.equal(mainTabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(panelB.hasAttribute('inert'), false);
  pressCategoryTab(mainTabs[1], otherControl);
  pressCategoryTab(otherControl, mainTabs[1], true);
  pressCategoryTab(mainTabs[1], childControl, true);
  assert.equal(mainTabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(panelA.hasAttribute('inert'), false);
  wideControl.disabled = true;
  pressCategoryTab(retainedControl, checkControl);
  wideControl.disabled = false;
  mainTabs[1].click();
  const circle = multiDocument.querySelector('[data-category-nav-node="tab-main-a"] .category-nav-toggle');
  circle.click();
  assert.equal(circle.getAttribute('aria-expanded'), 'false');
  assert.equal(circle.closest('.category-nav-node').querySelector('.category-nav-children').hidden, true);
  circle.click();
  assert.equal(circle.getAttribute('aria-expanded'), 'true');
  multiWindow.eval(`state.schema.conditions = [{id:'tab-condition', target_type:'category', target_id:'tab-main-b', source_field_id:'tab-name', operator:'equals', value:'show'}]; updateConditionalVisibility();`);
  assert.equal(mainTabs[1].hidden, true);
  assert.equal(multiWindow.eval('entryFieldTabStops(true).some(c => c.dataset.fieldId === "tab-other")'), false, 'conditional categories are excluded from cross-tab traversal');
  assert.equal(mainTabs[0].getAttribute('aria-selected'), 'true');
  retainedControl.value = 'show';
  multiWindow.eval('updateConditionalVisibility()');
  assert.equal(mainTabs[1].hidden, false);
  assert.equal(mainTabs[0].getAttribute('aria-selected'), 'true', 'revealing another category does not switch tabs');
  assert.equal(multiWindow.getComputedStyle(panelA.querySelector('.field-grid')).gridAutoFlow, 'row');
  assert.deepEqual([...panelA.querySelector('.field-grid').children].map(field => field.dataset.fieldWrapper), ['tab-name','tab-wide','tab-check']);
  assert.ok(panelA.querySelector('.checkbox-entry-field > .checkbox-label-space[aria-hidden="true"]'));
  multiWindow.eval("state.mode = 'builder'; state.builderScope = 'schema'; state.draftSchema = deepClone(state.schema); renderBuilderCategoryNavigator();");
  const builderCircle = multiDocument.querySelector('[data-category-nav-node="tab-main-a"] .category-nav-toggle');
  assert.ok(builderCircle);
  builderCircle.click();
  assert.equal(builderCircle.getAttribute('aria-expanded'), 'false');

  // Builder shares Entry geometry but exposes only schema actions.
  multiWindow.eval(`
    state.draftSchema.categories.push({id:'tab-repeat', kind:'repeatable', label:'متكررة', parent_category_id:'tab-main-a', parent_field_id:'tab-wide', fields:[{id:'preview-repeat-field', type:'text', label:'حقل البطاقة', width:'2'}]});
    state.draftSchema.categories[0].fields.push({id:'preview-portrait', type:'file', label:'صورة المعاينة', image_display:'profile', width:'2', file_naming:{mode:'original',parts:[]}});
    state.draftSchema.categories[0].fields[0].placeholder = 'اكتب الاسم هنا';
    performSwitchMode('builder');
  `);
  const builderPreview = multiDocument.querySelector('#builder-categories');
  assert.equal(builderPreview.querySelectorAll('[data-main-category-tab]').length, 2);
  assert.equal(builderPreview.querySelectorAll('.related-tab-workspace [role="tab"]').length, 1);
  assert.ok(builderPreview.querySelector('.related-card .builder-preview-field'));
  assert.equal(builderPreview.querySelectorAll('[data-value-control], [data-related-records], [data-add-related], [data-browse-file]').length, 0, 'preview must not participate in record editing');
  assert.ok([...builderPreview.querySelectorAll('[data-preview-actions]')].every(actions => actions.hidden));
  const previewField = id => builderPreview.querySelector(`.builder-preview-field[data-field-id="${id}"]`);
  assert.ok(previewField('tab-name').classList.contains('field-4'));
  assert.equal(previewField('tab-name').querySelector('[data-preview-select]').dataset.hoverLabel, 'الاسم');
  assert.equal(previewField('tab-name').querySelector('input').placeholder, 'اكتب الاسم هنا');
  assert.match(builderPreview.querySelector('[data-main-category-tab="tab-main-a"]')._categoryHoverCard().details, /فئة رئيسية/);
  assert.ok(previewField('preview-portrait').classList.contains('field-1'));
  assert.ok(previewField('preview-portrait').querySelector('.profile-image-preview-frame'));
  assert.equal(previewField('tab-name').querySelector('input').hasAttribute('inert'), true);
  multiWindow.eval("openFieldDialog('tab-main-a','tab-name');");
  const categoryPicker=multiDocument.querySelector('#field-category-name');
  assert.equal(categoryPicker.tagName, 'SELECT');
  setValue(multiWindow,'#field-category-name','tab-main-b','change');
  assert.equal(multiWindow.eval('state.editingFieldCategoryId'),'tab-main-b');
  assert.equal(multiDocument.querySelector('#field-after option[value="tab-name"]'),null);
  await multiWindow.eval('saveFieldFromDialog()');
  assert.equal(multiWindow.eval("fieldCategory('tab-name').id"),'tab-main-b');
  assert.equal(multiWindow.eval("state.draftSchema.categories.flatMap(c=>c.fields).filter(f=>f.id==='tab-name').length"),1);
  multiWindow.eval("openFieldDialog('tab-main-b','tab-name');");
  assert.equal(categoryPicker.value,'tab-main-b','editing retains the new category');
  setValue(multiWindow,'#field-category-name','tab-main-a','change');
  setValue(multiWindow,'#field-after','start','change');
  await multiWindow.eval('saveFieldFromDialog()');
  assert.equal(multiWindow.eval("fieldCategory('tab-name').id"),'tab-main-a');
  assert.equal(builderPreview.querySelector('.checkbox-meaning'),null);
  const entryBeforePreviewActions = JSON.stringify(await multiWindow.eval('collectMainPayload()'));
  previewField('tab-name').querySelector('[data-preview-select]').click();
  let previewActions = previewField('tab-name').querySelector('[data-preview-actions]');
  assert.equal(previewActions.hidden, false);
  assert.equal(multiDocument.querySelector('#app-hover-card').hidden,true,'selecting reveals actions without a covering card');
  assert.equal(previewActions.querySelectorAll('button').length, 4);
  assert.deepEqual([...previewActions.querySelectorAll('button')].map(button => button.dataset.builderAction), ['delete-field','edit-field','move-field-up','move-field-down']);
  const positioningName = previewField('tab-name').querySelector('[data-preview-select]');
  const positioningParent = previewActions.offsetParent || previewActions.parentElement;
  const savedRects = [positioningName.getBoundingClientRect, positioningParent.getBoundingClientRect, previewActions.getBoundingClientRect];
  positioningName.getBoundingClientRect = () => ({bottom:128,right:400});
  positioningParent.getBoundingClientRect = () => ({top:90,left:100,width:400});
  previewActions.getBoundingClientRect = () => ({width:140});
  multiWindow.positionBuilderPreviewActions(previewActions, positioningName);
  assert.equal(previewActions.style.top, '43px');
  assert.equal(previewActions.style.left, '160px');
  [positioningName.getBoundingClientRect, positioningParent.getBoundingClientRect, previewActions.getBoundingClientRect] = savedRects;
  assert.equal(previewActions.querySelector('[data-builder-action="move-field-up"]').disabled, true);
  previewActions.querySelector('[data-builder-action="move-field-down"]').click();
  assert.equal(multiWindow.eval('state.draftSchema.categories[0].fields[1].id'), 'tab-name');
  assert.equal(previewField('tab-name').querySelector('[data-preview-actions]').hidden, false, 'reordering retains the selected field');
  assert.equal(previewField('tab-wide').nextElementSibling.id, 'builder-category-tab-repeat', 'anchored nested categories move with their field');
  assert.equal(JSON.stringify(await multiWindow.eval('collectMainPayload()')), entryBeforePreviewActions, 'schema preview actions leave record values intact');
  previewField('tab-name').querySelector('[data-builder-action="edit-field"]').click();
  assert.equal(multiDocument.querySelector('#field-dialog').open, true);
  assert.equal(multiWindow.eval('state.editingFieldId'), 'tab-name');
  multiDocument.querySelector('#field-dialog [data-close-dialog]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  previewField('tab-name').querySelector('[data-preview-select]').focus();
  previewField('tab-name').dispatchEvent(new multiWindow.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.ok([...builderPreview.querySelectorAll('[data-preview-actions]')].every(actions => actions.hidden));
  builderPreview.querySelector('[data-main-category-tab="tab-main-b"]').click();
  assert.equal(builderPreview.querySelector('[data-main-category-panel="tab-main-a"]').classList.contains('main-category-panel-inactive'), true);
  multiDocument.querySelector('[data-builder-category-nav="tab-repeat"]').click();
  assert.equal(builderPreview.querySelector('[data-main-category-panel="tab-main-a"]').classList.contains('main-category-panel-inactive'), false);
  previewField('tab-check').querySelector('[data-preview-select]').click();
  previewField('tab-check').querySelector('[data-builder-action="delete-field"]').click();
  assert.equal(multiDocument.querySelector('#action-confirm-dialog').open, true);
  multiDocument.querySelector('#action-confirm-cancel').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(previewField('tab-check'));
  previewField('tab-check').querySelector('[data-builder-action="delete-field"]').click();
  multiDocument.querySelector('#action-confirm-accept').click();
  await waitFor(() => !previewField('tab-check'), 'preview field deletion after confirmation');
  assert.equal(multiWindow.eval('state.dirty'), true);

  multiWindow.eval("openFieldDialog('tab-main-a')");
  setValue(multiWindow, '#field-type', 'spacer', 'change');
  assert.equal(multiDocument.querySelector('#field-label').closest('.field').hidden, true);
  assert.equal(multiDocument.querySelector('#field-placeholder').closest('.field').hidden, true);
  setValue(multiWindow, '#field-width', '2', 'change');
  multiDocument.querySelector('#field-label').value = '';
  multiDocument.querySelector('#confirm-field-button').click();
  await waitFor(() => !multiDocument.querySelector('#field-dialog').open, 'unnamed spacer created');
  const spacerId = multiWindow.eval("state.draftSchema.categories[0].fields.find(f => f.type === 'spacer').id");
  assert.ok(previewField(spacerId).classList.contains('field-2'));
  assert.equal(previewField(spacerId).querySelectorAll('input,textarea,select').length, 0);
  assert.equal(multiWindow.eval(`fieldById('${spacerId}').label`), '');
  multiWindow.eval("state.schema = deepClone(state.draftSchema); performSwitchMode('entry'); renderEntryForm();");
  const entrySpacer = multiDocument.querySelector(`#record-form [data-field-wrapper="${spacerId}"]`);
  assert.ok(entrySpacer.classList.contains('field-2'));
  assert.equal(entrySpacer.childElementCount, 0);
  assert.equal(entrySpacer.getAttribute('aria-hidden'), 'true');
  assert.equal(Object.hasOwn(await multiWindow.eval('collectMainPayload()'), spacerId), false);
  assert.equal(multiWindow.eval(`eligibleSearchFields().some(({field}) => field.id === '${spacerId}')`), false);
  for (const height of [76, 201, 280, 397]) {
    const rows = multiWindow.portraitGridRows(height, 14);
    assert.ok(rows * 4 >= height + 14 && rows * 4 < height + 18, 'portrait rounding leaves less than four extra pixels');
  }
  multiWindow.eval('renderSessionMode(true)');
  assert.equal(multiWindow.getComputedStyle(multiDocument.querySelector('.session-mode-icon')).color, 'rgb(33, 132, 71)');

  // Large-schema saves must leave unchanged preview subtrees mounted, and
  // hidden record controls must refresh before the next page becomes usable.
  multiWindow.eval("state.selectedRecordCode = null; performSwitchMode('builder');");
  const unchangedCategory = multiDocument.querySelector('#builder-category-tab-main-b');
  const unchangedField = previewField('tab-other');
  const sameCategoryField = previewField('preview-portrait');
  const originalField = previewField('tab-name');
  multiWindow.eval("fieldById('tab-name').placeholder = 'updated help'; renderBuilder();");
  assert.notEqual(previewField('tab-name'), originalField);
  assert.equal(previewField('tab-name').querySelector('input').placeholder, 'updated help');
  assert.equal(previewField('tab-other'), unchangedField);
  assert.equal(multiDocument.querySelector('#builder-category-tab-main-b'), unchangedCategory);
  assert.equal(previewField('preview-portrait'), sameCategoryField);
  const stableBuilderTab = builderPreview.querySelector('[data-main-category-tab="tab-main-b"]');
  multiWindow.eval("renderBuilder(); renderBuilder();");
  assert.equal(builderPreview.querySelector('[data-main-category-tab="tab-main-b"]'), stableBuilderTab);
  stableBuilderTab.click();
  assert.equal(builderPreview.dataset.activeMainCategory, 'tab-main-b');
  assert.equal(builderPreview.dataset.selectedItem, 'category:tab-main-b', 'reused tabs register selection only once');
  multiWindow.eval(`
    categoryById('tab-main-b').fields.push({id:'performance-new',label:'New field',type:'text',width:'2'});
    renderBuilder();
  `);
  assert.equal(previewField('tab-other').querySelector('[data-builder-action="move-field-down"]').disabled, false);
  assert.equal(previewField('performance-new').querySelector('[data-builder-action="move-field-down"]').disabled, true);
  multiWindow.eval("categoryById('tab-main-b').fields.pop(); renderBuilder();");
  assert.equal(previewField('performance-new'), null);
  assert.equal(previewField('tab-other').querySelector('[data-builder-action="move-field-down"]').disabled, true);
  multiWindow.eval("categoryById('tab-main-b').label = 'Updated category'; renderBuilder();");
  assert.equal(stableBuilderTab.textContent, 'Updated category');
  const entryBeforeSave = multiDocument.querySelector('#record-form [data-field-id="tab-name"][data-value-control]');
  multiWindow.eval(`
    applyLoadedSchema({...deepClone(state.draftSchema), revision:state.schema.revision + 1}, {
      builderSave:true, resetRecord:false, preservePage:true
    });
  `);
  assert.ok(multiWindow.eval('state.pendingSchemaViews'));
  assert.equal(multiWindow.eval('state.dirty'), false);
  assert.equal(multiDocument.querySelector('#record-form [data-field-id="tab-name"][data-value-control]'), entryBeforeSave);
  const localDraftBeforeSave = multiWindow.localStorage.getItem(multiWindow.eval('schemaStorageKey(DRAFT_STORAGE_KEY)'));
  multiWindow.eval('state.recordDirty = true; saveDraftLocally();');
  assert.equal(multiWindow.localStorage.getItem(multiWindow.eval('schemaStorageKey(DRAFT_STORAGE_KEY)')), localDraftBeforeSave, 'old controls must never be written under the new revision');
  multiWindow.eval(`
    fieldById('tab-name').placeholder = 'latest saved help';
    applyLoadedSchema({...deepClone(state.draftSchema), revision:state.schema.revision + 1}, {
      builderSave:true, resetRecord:false, preservePage:true
    });
    state.recordDirty = false;
    performSwitchMode('entry');
  `);
  assert.equal(multiWindow.eval('state.pendingSchemaViews'), null);
  const entryAfterSave = multiDocument.querySelector('#record-form [data-field-id="tab-name"][data-value-control]');
  assert.notEqual(entryAfterSave, entryBeforeSave);
  assert.equal(entryAfterSave.placeholder, 'latest saved help');
  assert.equal(multiWindow.eval('state.mode'), 'entry');
  multiWindow.eval(`
    performSwitchMode('builder');
    applyLoadedSchema({...deepClone(state.draftSchema), revision:state.schema.revision + 1}, {
      builderSave:true, resetRecord:false, preservePage:true
    });
    applyLoadedSchema({...deepClone(state.schema), schema_id:'another-schema', categories:[], conditions:[], auto_updates:[]}, {resetRecord:true, targetMode:'home'});
  `);
  assert.equal(multiWindow.eval('state.pendingSchemaViews'), null, 'switching schemas discards deferred work for the previous schema');
  assert.equal(builderPreview.querySelector('[data-field-id="tab-other"]'), null);

  // Every parentless Builder category, including anchored repeated roots,
  // shares the same tab rail; the standalone general tab survives an empty list.
  multiWindow.eval(`
    state.builderScope = 'schema'; state.mode = 'builder';
    state.draftSchema.categories = [
      {id:'root-main',label:'رئيسية',kind:'main',fields:[{id:'root-anchor',label:'حقل',type:'text',width:'1'}]},
      {id:'root-repeat',label:'متكررة',kind:'repeatable',parent_category_id:null,anchor_field_id:'root-anchor',fields:[]}
    ]; state.draftSchema.conditions = []; renderBuilder();
  `);
  const rootMainTab = builderPreview.querySelector('[data-main-category-tab="root-main"]');
  const rootRepeatTab = builderPreview.querySelector('[data-main-category-tab="root-repeat"]');
  assert.ok(rootMainTab && rootRepeatTab);
  assert.equal(rootMainTab.parentElement, rootRepeatTab.parentElement);
  rootRepeatTab.click();
  assert.equal(builderPreview.dataset.activeMainCategory, 'root-repeat');
  assert.equal(builderPreview.querySelectorAll('#builder-category-root-repeat').length, 1);
  multiWindow.eval("state.globalDefinitions = {revision:0,categories:{},fields:{}}; renderGlobalDefinitions();");
  assert.ok(multiDocument.querySelector('#global-category-list [aria-controls="global-standalone-panel"]'));

  emptyDom.window.close();
  userDom.window.close();
  dom.window.close();
  multiDom.window.close();
  console.log(
    "Builder, multi-schema workspace, manual mappings, separate search tables, navigation, calendars, and attachments passed."
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const server of activeServers) {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  }
});
