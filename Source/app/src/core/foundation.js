"use strict";
const workspace = window.SchemaCraftWorkspace;
const RECORD_DRAFT_AUTOSAVE_MS = 5 * 60 * 1000;
const BUILDER_AUTOSAVE_MS = 60 * 1000;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const DRAFT_STORAGE_KEY = "generic-data-entry-draft-v1";
const CLIENT_LOG_STORAGE_KEY = "generic-data-entry-client-log-v1";
const RECENT_RECORDS_STORAGE_KEY = "schemacraft-recent-records-v1";
const RECENT_EXPORTS_STORAGE_KEY = "schemacraft-recent-exports-v1";
const SEARCH_HISTORY_STORAGE_KEY = "schemacraft-search-history-v1";
const BUILDER_HISTORY_STORAGE_KEY = "schemacraft-builder-history-v1";
const HOME_CHART_CONFIG_STORAGE_KEY = "schemacraft-home-chart-config-v1";
const HOME_BUILDER_CHART_CONFIG_STORAGE_KEY = "schemacraft-home-builder-chart-config-v1";
const HOME_CUSTOM_STATS_STORAGE_KEY = "schemacraft-home-custom-stats-v1";
const FULL_SEARCH_RECORD_CODE_OPTION = "__record_code__";

const MAX_QUEUED_CLIENT_LOGS = 20;

function schemaStorageKey(base) {
  return `${base}:${state.activeSchemaId || "legacy"}`;
}
const DRAFT_INPUT_DELAY_MS = 1200;
const FIELD_TYPE_LABELS = {
  spacer: "مساحة فارغة",
  text: "نص قصير",
  textarea: "نص طويل",
  number: "رقم",
  select: "قائمة خيارات",
  checkbox: "مربع اختيار",
  checkbox_group: "مجموعة اختيارات",
  yes_no: "نعم / لا",
  date_gregorian: "تاريخ ميلادي",
  date_hijri: "تاريخ هجري",
  date_persian: "تاريخ هجري شمسي",
  file: "ملف أو مرفق",
  system_record_code: "معرّف السجل",
  system_created_at: "تاريخ الإنشاء",
  system_updated_at: "تاريخ آخر تعديل",
  user_name: "اسم المستخدم الحالي",
};
const SYSTEM_FIELD_TYPES = new Set([
  "system_record_code",
  "system_created_at",
  "system_updated_at",
]);
const RELATED_PERSON_MODE_SOURCE_PREFIX = "related_person_mode:";
const RELATED_PERSON_MODE_OPTIONS = [
  { id: "existing", label: "لديه سجل", active: true },
  { id: "manual", label: "ليس لديه سجل", active: true },
];
const OPERATOR_LABELS = {
  equals: "يساوي",
  not_equals: "لا يساوي",
  contains: "يحتوي على",
  not_contains: "لا يحتوي على",
  greater_than: "أكبر من",
  greater_or_equal: "أكبر من أو يساوي",
  less_than: "أصغر من",
  less_or_equal: "أصغر من أو يساوي",
  before: "قبل",
  after: "بعد",
  on_or_before: "في أو قبل",
  on_or_after: "في أو بعد",
  not_empty: "غير فارغ",
  empty: "فارغ",
};

const CONDITION_OPERATORS_BY_TYPE = {
  text: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "empty",
    "not_empty",
  ],
  textarea: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "empty",
    "not_empty",
  ],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
    "empty",
    "not_empty",
  ],
  select: ["equals", "not_equals", "empty", "not_empty"],
  yes_no: ["equals", "not_equals", "empty", "not_empty"],
  checkbox: ["equals", "not_equals"],
  checkbox_group: ["contains", "not_contains", "empty", "not_empty"],
  date_gregorian: [
    "equals",
    "not_equals",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "empty",
    "not_empty",
  ],
  date_hijri: [
    "equals",
    "not_equals",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "empty",
    "not_empty",
  ],
  date_persian: [
    "equals",
    "not_equals",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "empty",
    "not_empty",
  ],
  file: ["empty", "not_empty"],
};
const CALENDAR_MONTH_NAMES = {
  date_gregorian: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  date_hijri: [
    "محرّم",
    "صفر",
    "ربيع الأول",
    "ربيع الآخر",
    "جمادى الأولى",
    "جمادى الآخرة",
    "رجب",
    "شعبان",
    "رمضان",
    "شوّال",
    "ذو القعدة",
    "ذو الحجة",
  ],
  date_persian: [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
  ],
};
const CALENDAR_SUFFIXES = {
  date_gregorian: "ميلادي",
  date_hijri: "هجري",
  date_persian: "هجري شمسي",
};

const state = {
  builderCategoryObserver: null,
  activeBuilderCategoryId: null,
  headerResizeObserver: null,
  viewportPaintFrame: null,
  viewportPaintResetFrame: null,
  keyboardNavigationPending: false,
  categoryObserverTimer: null,
  recordDirty: false,
  draftDebounceTimer: null,
  restoringDraft: false,
  serverOffline: false,
  schema: null,
  workspace: null,
  activeSchemaId: "",
  pageSchemaIds: { entry: "", builder: "", search: "" },
  workspaceDefinitions: {},
  globalDefinitions: { categories: {}, fields: {}, revision: 0 },
  workspaceSettings: { shortcuts: {} },
  pendingBackgroundImageId: "",
  auditUsers: { current_user: "", users: [] },
  auditUserFeatureAvailable: false,
  auditUserResolve: null,
  schemaTabStates: new Map(),
  builderTabStates: new Map(),
  builderScope: "schema",
  globalEditor: null,
  generalSearchMode: "global",
  searchType: "schema",
  fixedSearchFilters: {},
  fullSearchFilterModes: {},
  searchHistoryEntries: [],
  homeSchemaDashboards: new Map(),
  homeDataSchemaId: "",
  homeBuilderSchemaId: "",
  homeChartSchemaId: "",
  homeChartSlot: "primary",
  homeChartType: "bar",
  homeChartContext: "data",
  homeBuilderChartScope: "",
  homeBuilderChartSlot: "primary",
  homeCustomStatEditingId: "",
  globalQueryConfigs: new Map(),
  globalSearchFieldRefs: [],
  multiSearchConfigs: new Map(),
  multiSearchResults: new Map(),
  profileTransferInspection: null,
  draftSchema: null,
  mode: "loading",
  dirty: false,
  savingSchema: false,
  savingRecord: false,
  searching: false,
  searchFieldIds: null,
  entrySearchRecordIdEnabled: true,
  searchMatches: [],
  searchResultIndex: 0,
  searchResultsTruncated: false,
  loadingRecord: false,
  backingUp: false,
  selectedRecordCode: null,
  currentRecordArchived: false,
  currentRecordMetadata: {
    record_code: "",
    created_at: "",
    updated_at: "",
  },
  activeEntryCategorySection: null,
  loadedMainValues: {},
  suppressReset: false,
  editingCategoryId: null,
  editingFieldCategoryId: null,
  editingFieldId: null,
  conditionTargetType: null,
  conditionTargetId: null,
  categoryDialogCommitted: false,
  categoryConditionsSnapshot: null,
  categoryDirtyBeforeOpen: false,
  fieldDialogCommitted: false,
  fieldConditionsSnapshot: null,
  fieldDirtyBeforeOpen: false,
  editingConditionId: null,
  optionFilterDraft: null,
  fieldOptionsDraft: [],
  authMode: "unlock",
  authReturnPage: "builder",
  authSubmitting: false,
  pendingNavigation: null,
  settingsDirty: false,
  settingsDirtyCategory: "",
  fullSearchOffset: 0,
  fullSearchTotal: 0,
  fullSearchMatches: [],
  fullSearchCriteria: null,
  fullSearchLoading: false,
  fullSearchFieldIds: null,
  fullSearchColumnIds: null,
  fullSearchRecordIdFilter: true,
  fullSearchRecordIdColumn: true,
  exportFilterIds: [],
  exportFieldIds: [],
  exportMode: "profile",
  exportDestinations: { profile: "", table: "", portable: "" },
  profileInfoFieldIdsBySchema: new Map(),
  profileInfoFormatBySchema: new Map(),
  profileReportFieldIdsBySchema: new Map(),
  profileReportGlobalRefs: new Set(),
  importFileData: "",
  importInspection: null,
  importFileName: "",
  startupIntent: workspace.startupIntent(),
  filePartsDraft: [],
  toastTimer: null,
  heartbeatTimer: null,
  draftTimer: null,
  builderAutosaveTimer: null,
  activeRequests: 0,
  closing: false,
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const candidate =
    typeof input === "string" || input instanceof URL ? input : input.url;
  const url = new URL(candidate, window.location.href);
  const trackRequest =
    url.origin === window.location.origin &&
    url.pathname.startsWith("/api/") &&
    !["/api/heartbeat", "/api/disconnect", "/api/shutdown"].includes(url.pathname);
  if (
    url.origin === window.location.origin &&
    url.pathname.startsWith("/api/") &&
    state.activeSchemaId &&
    !url.pathname.startsWith("/api/workspace")
  ) {
    const headers = new Headers(init.headers || {});
    if (!headers.has("X-Schema-ID") && !url.searchParams.has("schema_id")) {
      headers.set("X-Schema-ID", state.activeSchemaId);
    }
    init = { ...init, headers };
  }
  if (trackRequest) state.activeRequests += 1;
  try {
    return await nativeFetch(input, init);
  } finally {
    if (trackRequest) state.activeRequests = Math.max(0, state.activeRequests - 1);
  }
};

const elements = {
  sessionPrivacyScreen: document.getElementById("session-privacy-screen"),
  sessionPrivacyMessage: document.getElementById("session-privacy-message"),
  appHeader: document.querySelector(".app-header"),
  page: document.querySelector(".page"),
  appTitle: document.getElementById("app-title"),
  homeModeButton: document.getElementById("home-mode-button"),
  entryModeButton: document.getElementById("entry-mode-button"),
  searchPageButton: document.getElementById("search-page-button"),
  importPageButton: document.getElementById("import-page-button"),
  exportPageButton: document.getElementById("export-page-button"),
  settingsPageButton: document.getElementById("settings-page-button"),
  builderModeButton: document.getElementById("builder-mode-button"),
  sessionModeBadge: document.getElementById("session-mode-badge"),
  auditUserBadge: document.getElementById("audit-user-badge"),
  auditUserName: document.getElementById("audit-user-name"),
  auditUserDialog: document.getElementById("audit-user-dialog"),
  auditUserInput: document.getElementById("audit-user-input"),
  auditUserOptions: document.getElementById("audit-user-options"),
  confirmAuditUser: document.getElementById("confirm-audit-user"),
  sessionModeText: document.getElementById("session-mode-text"),
  sessionModeIconUse: document.querySelector("#session-mode-badge use"),
  closeButton: document.getElementById("close-app-button"),
  status: document.getElementById("app-status"),
  statusText: document.getElementById("app-status-text"),
  startupError: document.getElementById("startup-error"),
  startupErrorMessage: document.getElementById("startup-error-message"),
  loadingView: document.getElementById("loading-view"),
  homeView: document.getElementById("home-view"),
  entryView: document.getElementById("entry-view"),
  fullSearchView: document.getElementById("full-search-view"),
  importView: document.getElementById("import-view"),
  exportView: document.getElementById("export-view"),
  settingsView: document.getElementById("settings-view"),
  readonlyView: document.getElementById("readonly-view"),
  builderView: document.getElementById("builder-view"),
  appWorkspace: document.getElementById("app-workspace"),
  workspaceSchemaStrip: document.getElementById("workspace-schema-strip"),
  homeWelcomeTitle: document.getElementById("home-welcome-title"),
  homeNavigation: document.getElementById("home-navigation"),
  homeRecentSearches: document.getElementById("home-recent-searches"),
  homeRecentImports: document.getElementById("home-recent-imports"),
  recentRecords: document.getElementById("recent-records"),
  homeDataGeneralTags: document.getElementById("home-data-general-tags"),
  homeDataSchemaTabs: document.getElementById("home-data-schema-tabs"),
  recentExports: document.getElementById("recent-exports"),
  homeBuilderGeneralTags: document.getElementById("home-builder-general-tags"),
  homeBuilderSchemaTabs: document.getElementById("home-builder-schema-tabs"),
  homeBuilderSchemas: document.getElementById("home-builder-schemas"),
  homeChartDialog: document.getElementById("home-chart-dialog"),
  homeChartDialogSchema: document.getElementById("home-chart-dialog-schema"),
  homeChartType: document.getElementById("home-chart-type"),
  homeChartField: document.getElementById("home-chart-field"),
  homeChartSourceLabel: document.getElementById("home-chart-source-label"),
  applyHomeChart: document.getElementById("apply-home-chart"),
  homeCustomStatDialog: document.getElementById("home-custom-stat-dialog"),
  homeCustomStatLabel: document.getElementById("home-custom-stat-label"),
  homeCustomStatCalculation: document.getElementById("home-custom-stat-calculation"),
  homeCustomStatSchemaFields: document.getElementById("home-custom-stat-schema-fields"),
  saveHomeCustomStat: document.getElementById("save-home-custom-stat"),
  deleteHomeCustomStat: document.getElementById("delete-home-custom-stat"),
  fullSearchRecordIdField: document.getElementById(
    "full-search-record-id-field",
  ),
  fullSearchRecordId: document.getElementById("full-search-record-id"),
  fullSearchSystemFields: document.getElementById("full-search-system-fields"),
  fullSearchIncludeArchived: document.getElementById(
    "full-search-include-archived",
  ),
  fullSearchOptionsButton: document.getElementById(
    "full-search-options-button",
  ),
  fullSearchOptionsSummary: document.getElementById(
    "full-search-options-summary",
  ),
  schemaFilterSelectionSummary: document.getElementById("schema-filter-selection-summary"),
  fullSearchFieldsEmpty: document.getElementById("full-search-fields-empty"),
  schemaSearchFilterGroups: document.getElementById("schema-search-filter-groups"),
  fullSearchFields: document.getElementById("full-search-fields"),
  fullSearchClearButton: document.getElementById("full-search-clear-button"),
  fullSearchSubmitButton: document.getElementById("full-search-submit-button"),
  fullSearchSummary: document.getElementById("full-search-summary"),
  fullSearchTableHead: document.getElementById("full-search-table-head"),
  fullSearchTableBody: document.getElementById("full-search-table-body"),
  fullSearchPrevious: document.getElementById("full-search-previous"),
  fullSearchNext: document.getElementById("full-search-next"),
  fullSearchPageLabel: document.getElementById("full-search-page-label"),
  searchHistoryList: document.getElementById("search-history-list"),
  refreshSearchHistory: document.getElementById("refresh-search-history"),
  clearSearchHistory: document.getElementById("clear-search-history"),
  searchNewButton: document.getElementById("search-new-button"),
  searchClearHeadersButton: document.getElementById("search-clear-headers-button"),
  searchLiveLog: document.getElementById("search-live-log"),
  searchOperationName: document.getElementById("search-operation-name"),
  searchOperationNotes: document.getElementById("search-operation-notes"),
  searchResultsDialog: document.getElementById("search-results-dialog"),
  searchResultsDialogTitle: document.getElementById("search-results-dialog-title"),
  schemaSearchResultsTableScroll: document.getElementById("schema-search-results-table-scroll"),
  searchNotesDialog: document.getElementById("search-notes-dialog"),
  searchNotesInput: document.getElementById("search-notes-input"),
  confirmSearchNotes: document.getElementById("confirm-search-notes"),
  cancelSearchNotes: document.getElementById("cancel-search-notes"),
  cancelSearchNotesX: document.getElementById("cancel-search-notes-x"),
  searchHistoryQuery: document.getElementById("search-history-query"),
  searchHistoryQueryButton: document.getElementById("search-history-query-button"),
  searchSchemaChoiceList: document.getElementById("search-schema-choice-list"),
  searchFilterConfigButton: document.getElementById("search-filter-config-button"),
  schemaSearchWorkflow: document.getElementById("schema-search-workflow"),
  globalSearchQuery: document.getElementById("global-search-query"),
  globalQuerySchemaList: document.getElementById("global-query-schema-list"),
  multiSchemaSearch: document.getElementById("multi-schema-search"),
  generalSearchFilterButton: document.getElementById("general-search-filter-button"),
  generalSearchFieldsButton: document.getElementById("general-search-fields-button"),
  globalFilterSelectionSummary: document.getElementById("global-filter-selection-summary"),
  globalFieldSelectionSummary: document.getElementById("global-field-selection-summary"),
  globalSearchCriteriaPanel: document.getElementById("global-search-criteria-panel"),
  globalSearchRecordCode: document.getElementById("global-search-record-code"),
  globalSearchFields: document.getElementById("global-search-fields"),
  globalSearchSettings: document.getElementById("global-search-settings"),
  advancedSearchSettings: document.getElementById("advanced-search-settings"),
  globalSearchFieldOptions: document.getElementById("global-search-field-options"),
  multiSchemaChoiceList: document.getElementById("multi-schema-choice-list"),
  multiSchemaQueryList: document.getElementById("multi-schema-query-list"),
  multiSchemaResults: document.getElementById("multi-schema-results"),
  runMultiSchemaSearch: document.getElementById("run-multi-schema-search"),
  clearMultiSchemaSearch: document.getElementById("clear-multi-schema-search"),
  singleSchemaSearchPanel: document.getElementById("single-schema-search-panel"),
  singleSchemaResultsPanel: document.getElementById("single-schema-results-panel"),
  exportIncludeRelated: document.getElementById("export-include-related"),
  exportIncludeAttachments: document.getElementById("export-include-attachments"),
  exportFilterDialog: document.getElementById("export-filter-dialog"),
  exportFieldsDialog: document.getElementById("export-fields-dialog"),
  openExportFilterDialog: document.getElementById("open-export-filter-dialog"),
  openExportFieldsDialog: document.getElementById("open-export-fields-dialog"),
  exportFieldList: document.getElementById("export-field-list"),
  exportSelectAllCategories: document.getElementById(
    "export-select-all-categories",
  ),
  exportClearCategories: document.getElementById("export-clear-categories"),
  exportButton: document.getElementById("export-button"),
  exportStatus: document.getElementById("export-status"),
  exportPanel: document.getElementById("export-panel"),
  entrySchemaTabs: document.getElementById("entry-schema-tabs"),
  builderSchemaTabs: document.getElementById("builder-schema-tabs"),
  schemaBuilderContent: document.getElementById("schema-builder-content"),
  globalDefinitionsPanel: document.getElementById("global-definitions-panel"),
  globalCategoryList: document.getElementById("global-category-list"),
  globalFieldList: document.getElementById("global-field-list"),
  newGlobalCategory: document.getElementById("new-global-category"),
  newGlobalField: document.getElementById("new-global-field"),
  globalizeExistingDefinition: document.getElementById("globalize-existing-definition"),
  globalizeExistingDialog: document.getElementById("globalize-existing-dialog"),
  addGlobalCategoryDialog: document.getElementById("add-global-category-dialog"),
  addGlobalCategoryTree: document.getElementById("add-global-category-tree"),
  confirmAddGlobalCategory: document.getElementById("confirm-add-global-category"),
  globalizeExistingKind: document.getElementById("globalize-existing-kind"),
  globalizeSourceSchemas: document.getElementById("globalize-source-schemas"),
  globalizeSourceItems: document.getElementById("globalize-source-items"),
  confirmGlobalizeExisting: document.getElementById("confirm-globalize-existing"),
  createGlobalizeExisting: document.getElementById("create-globalize-existing"),
  profileExportRecordCode: document.getElementById("profile-export-record-code"),
  inspectProfileExport: document.getElementById("inspect-profile-export"),
  profileExportSelection: document.getElementById("profile-export-selection"),
  profileExportOptionsDialog: document.getElementById("profile-export-options-dialog"),
  openProfileExportFields: document.getElementById("open-profile-export-fields"),
  applyProfileExportFields: document.getElementById("apply-profile-export-fields"),
  openProfileInfoFields: document.getElementById("open-profile-info-fields"),
  profileInfoFieldsDialog: document.getElementById("profile-info-fields-dialog"),
  profileInfoFieldSelection: document.getElementById("profile-info-field-selection"),
  applyProfileInfoFields: document.getElementById("apply-profile-info-fields"),
  profileExportProfileTableBody: document.getElementById("profile-export-profile-table-body"),
  profileExportResultCount: document.getElementById("profile-export-result-count"),
  profileExportFieldTags: document.getElementById("profile-export-field-tags"),
  profileExportButton: document.getElementById("profile-export-button"),
  profileExportStatus: document.getElementById("profile-export-status"),
  chooseProfileExportLocation: document.getElementById("choose-profile-export-location"),
  profileExportLocation: document.getElementById("profile-export-location"),
  portableExportButton: document.getElementById("portable-export-button"),
  portableExportStatus: document.getElementById("portable-export-status"),
  choosePortableExportLocation: document.getElementById("choose-portable-export-location"),
  portableExportLocation: document.getElementById("portable-export-location"),
  chooseTableExportLocation: document.getElementById("choose-table-export-location"),
  tableExportLocation: document.getElementById("table-export-location"),
  schemaExportModeSelector: document.getElementById("schema-export-mode-selector"),
  tableExportSchemaLabel: document.getElementById("table-export-schema-label"),
  portableExportSchemaLabel: document.getElementById("portable-export-schema-label"),
  exportFilterBuilder: document.getElementById("export-filter-builder"),
  exportFilterValues: document.getElementById("export-filter-values"),
  exportSelectedFilterSummary: document.getElementById("export-selected-filter-summary"),
  exportSelectedFieldSummary: document.getElementById("export-selected-field-summary"),
  applyExportFilters: document.getElementById("apply-export-filters"),
  applyExportFields: document.getElementById("apply-export-fields"),
  exportHistoryLimit: document.getElementById("export-history-limit"),
  exportHistoryBody: document.getElementById("export-history-body"),
  exportHistorySummary: document.getElementById("export-history-summary"),
  clearExportHistory: document.getElementById("clear-export-history"),
  exportTableSchema: document.getElementById("export-table-schema"),
  exportPortableSchema: document.getElementById("export-portable-schema"),
  importSchemaTabs: document.getElementById("import-schema-tabs"),
  exportScopeTabs: document.getElementById("export-scope-tabs"),
  importTypeSelect: document.getElementById("import-type-select"),
  importTargetSchema: document.getElementById("import-target-schema"),
  importHistoryLimit: document.getElementById("import-history-limit"),
  importHistoryBody: document.getElementById("import-history-body"),
  importHistorySummary: document.getElementById("import-history-summary"),
  clearImportHistory: document.getElementById("clear-import-history"),
  importResultDialog: document.getElementById("import-result-dialog"),
  importResultSummary: document.getElementById("import-result-summary"),
  importResultDetails: document.getElementById("import-result-details"),
  importResultNotes: document.getElementById("import-result-notes"),
  finalizeImportResult: document.getElementById("finalize-import-result"),
  portableImportFile: document.getElementById("portable-import-file"),
  portableImportFileName: document.getElementById("portable-import-file-name"),
  inspectPortableImport: document.getElementById("inspect-portable-import"),
  portableImportSummary: document.getElementById("portable-import-summary"),
  portableConflictPolicy: document.getElementById("portable-conflict-policy"),
  commitPortableImport: document.getElementById("commit-portable-import"),
  portableImportStatus: document.getElementById("portable-import-status"),
  importGenerateMissingIds: document.getElementById("import-generate-missing-ids"),
  importClearBlanks: document.getElementById("import-clear-blanks"),
  importPanel: document.getElementById("import-panel"),
  importFile: document.getElementById("import-file"),
  importFileLabel: document.getElementById("import-file-label"),
  importFileNameDisplay: document.getElementById("import-file-name"),
  inspectImportButton: document.getElementById("inspect-import-button"),
  importMappingArea: document.getElementById("import-mapping-area"),
  importMappingPlaceholder: document.getElementById(
    "import-mapping-placeholder",
  ),
  importSummary: document.getElementById("import-summary"),
  importInspectionProblems: document.getElementById("import-inspection-problems"),
  importMappingList: document.getElementById("import-mapping-list"),
  ignoreAllImportFields: document.getElementById("ignore-all-import-fields"),
  importDuplicatePolicy: document.getElementById("import-duplicate-policy"),
  commitImportButton: document.getElementById("commit-import-button"),
  importResult: document.getElementById("import-result"),
  readonlyTitle: document.getElementById("readonly-title"),
  readonlyContent: document.getElementById("readonly-content"),
  categoryNavigator: document.getElementById("category-navigator"),
  categoryNavTitle: document.getElementById("category-nav-title"),
  entryActionRail: document.getElementById("entry-action-rail"),
  builderActionRail: document.getElementById("builder-action-rail"),
  importActionRail: document.getElementById("import-action-rail"),
  exportActionRail: document.getElementById("export-action-rail"),
  newImportButton: document.getElementById("new-import-button"),
  clearImportButton: document.getElementById("clear-import-button"),
  importHistorySearch: document.getElementById("import-history-search"),
  importHistorySearchButton: document.getElementById("import-history-search-button"),
  newExportButton: document.getElementById("new-export-button"),
  clearExportButton: document.getElementById("clear-export-button"),
  exportHistorySearch: document.getElementById("export-history-search"),
  exportHistorySearchButton: document.getElementById("export-history-search-button"),
  exportNotes: document.getElementById("export-notes"),
  exportNotesDialog: document.getElementById("export-notes-dialog"),
  exportNotesDialogInput: document.getElementById("export-notes-dialog-input"),
  confirmExportNotes: document.getElementById("confirm-export-notes"),
  cancelExportNotes: document.getElementById("cancel-export-notes"),
  fieldConfigurationSource: document.getElementById("field-configuration-source"),
  fieldConfigurationProperties: document.getElementById("field-configuration-properties"),
  applyFieldConfigurationImport: document.getElementById("apply-field-configuration-import"),
  shortcutSettingsList: document.getElementById("shortcut-settings-list"),
  saveShortcutsButton: document.getElementById("save-shortcuts-button"),
  newProfileChoiceDialog: document.getElementById("new-profile-choice-dialog"),
  createNewIdentityButton: document.getElementById("create-new-identity-button"),
  reuseExistingIdentityButton: document.getElementById("reuse-existing-identity-button"),
  adminSessionDialog: document.getElementById("admin-session-dialog"),
  badgeChangePassword: document.getElementById("badge-change-password"),
  badgeExitAdmin: document.getElementById("badge-exit-admin"),
  schemaManagementPanel: document.getElementById("schema-management-panel"),
  builderActiveSchemaName: document.getElementById("builder-active-schema-name"),
  createSchemaButton: document.getElementById("create-schema-button"),
  duplicateSchemaButton: document.getElementById("duplicate-schema-button"),
  renameSchemaButton: document.getElementById("rename-schema-button"),
  archiveSchemaButton: document.getElementById("archive-schema-button"),
  archivedSchemaField: document.getElementById("archived-schema-field"),
  archivedSchemaSelect: document.getElementById("archived-schema-select"),
  restoreSchemaButton: document.getElementById("restore-schema-button"),
  createFromArchivedSchemaButton: document.getElementById("create-from-archived-schema-button"),
  deleteSchemaButton: document.getElementById("delete-schema-button"),
  entryRecordActions: document.getElementById("entry-record-actions"),
  entryRecentRecords: document.getElementById("entry-recent-records"),
  toggleEntryRecent: document.getElementById("toggle-entry-recent"),
  emptySchemaPanel: document.getElementById("empty-schema-panel"),
  openBuilderButton: document.getElementById("open-builder-button"),
  searchPanel: document.getElementById("search-panel"),
  searchTitle: document.getElementById("search-title"),
  chooseSearchFieldsButton: document.getElementById(
    "choose-search-fields-button",
  ),
  chooseSearchFieldsText: document.getElementById("choose-search-fields-text"),
  searchFieldsEmpty: document.getElementById("search-fields-empty"),
  searchFields: document.getElementById("search-fields"),
  entrySearchRecordId: document.getElementById("entry-search-record-id"),
  searchButton: document.getElementById("search-button"),
  clearSearchButton: document.getElementById("clear-search-button"),
  includeArchivedSearch: document.getElementById("include-archived-search"),
  searchButtonText: document.getElementById("search-button-text"),
  searchSpinner: document.getElementById("search-spinner"),
  searchResults: document.getElementById("search-results"),
  searchSummary: document.getElementById("search-summary"),
  searchResultPager: document.getElementById("search-result-pager"),
  previousSearchResult: document.getElementById("previous-search-result"),
  nextSearchResult: document.getElementById("next-search-result"),
  searchResultPosition: document.getElementById("search-result-position"),
  recordForm: document.getElementById("record-form"),
  recordCode: document.getElementById("record-code"),
  attachmentGallery: document.getElementById("attachment-gallery"),
  attachmentGalleryGrid: document.getElementById("attachment-gallery-grid"),
  mainSections: document.getElementById("main-sections"),
  unanchoredRelatedArea: document.getElementById("unanchored-related-area"),
  unanchoredRelatedSections: document.getElementById(
    "unanchored-related-sections",
  ),
  saveNote: document.getElementById("save-note"),
  draftStatus: document.getElementById("draft-status"),
  saveRecordButton: document.getElementById("save-record-button"),
  saveButtonText: document.getElementById("save-button-text"),
  saveSpinner: document.getElementById("save-spinner"),
  resetFormButton: document.getElementById("reset-form-button"),
  resetButtonText: document.getElementById("reset-button-text"),
  linkExistingProfileButton: document.getElementById("link-existing-profile-button"),
  profileLinkDialog: document.getElementById("profile-link-dialog"),
  profileSourceSchema: document.getElementById("profile-source-schema"),
  profileSourceId: document.getElementById("profile-source-id"),
  profileGlobalConflicts: document.getElementById("profile-global-conflicts"),
  inspectProfileLinkButton: document.getElementById("inspect-profile-link-button"),
  profileMappingArea: document.getElementById("profile-mapping-area"),
  profileMappingList: document.getElementById("profile-mapping-list"),
  profileLinkStatus: document.getElementById("profile-link-status"),
  confirmProfileLinkButton: document.getElementById("confirm-profile-link-button"),
  archiveRecordButton: document.getElementById("archive-record-button"),
  archiveButtonText: document.getElementById("archive-button-text"),
  deleteRecordButton: document.getElementById("delete-record-button"),
  deleteButtonText: document.getElementById("delete-button-text"),
  settingTitle: document.getElementById("setting-title"),
  settingSingular: document.getElementById("setting-singular"),
  settingPlural: document.getElementById("setting-plural"),
  settingPrimaryColor: document.getElementById("setting-primary-color"),
  settingLanguage: document.getElementById("setting-language"),
  settingStartupPage: document.getElementById("setting-startup-page"),
  settingSearchPageSize: document.getElementById("setting-search-page-size"),
  settingEntryHistoryLimit: document.getElementById("setting-entry-history-limit"),
  settingBuilderHistoryLimit: document.getElementById("setting-builder-history-limit"),
  settingSearchHistoryLimit: document.getElementById("setting-search-history-limit"),
  settingImportHistoryLimit: document.getElementById("setting-import-history-limit"),
  settingExportHistoryLimit: document.getElementById("setting-export-history-limit"),
  settingHomeEntryHistoryLimit: document.getElementById("setting-home-entry-history-limit"),
  settingHomeBuilderHistoryLimit: document.getElementById("setting-home-builder-history-limit"),
  settingHomeSearchHistoryLimit: document.getElementById("setting-home-search-history-limit"),
  settingHomeImportHistoryLimit: document.getElementById("setting-home-import-history-limit"),
  settingHomeExportHistoryLimit: document.getElementById("setting-home-export-history-limit"),
  settingShowEntrySearch: document.getElementById("setting-show-entry-search"),
  settingDraftAutosave: document.getElementById("setting-draft-autosave"),
  settingShowExplanations: document.getElementById("setting-show-explanations"),
  settingBackgroundImage: document.getElementById("setting-background-image"),
  settingBackgroundPreview: document.getElementById("setting-background-preview"),
  settingBackgroundStatus: document.getElementById("setting-background-status"),
  settingBackgroundAllPages: document.getElementById("setting-background-all-pages"),
  settingBackgroundGallery: document.getElementById("setting-background-gallery"),
  saveWorkspacePreferences: document.getElementById("save-workspace-preferences"),
  saveSettingsButton: document.getElementById("save-settings-button"),
  settingsSaveState: document.getElementById("settings-save-state"),
  discardSettingsChanges: document.getElementById("discard-settings-changes"),
  defaultAppClearHistory: document.getElementById("default-app-clear-history"),
  defaultAppClearRecords: document.getElementById("default-app-clear-records"),
  defaultAppClearSchema: document.getElementById("default-app-clear-schema"),
  defaultAppDestination: document.getElementById("default-app-destination"),
  chooseDefaultAppDestination: document.getElementById("choose-default-app-destination"),
  createDefaultApp: document.getElementById("create-default-app"),
  defaultAppStatus: document.getElementById("default-app-status"),
  categoryCount: document.getElementById("category-count"),
  fieldCount: document.getElementById("field-count"),
  recordCount: document.getElementById("record-count"),
  builderSummarySchemaName: document.getElementById("builder-summary-schema-name"),
  builderGlobalManagementRail: document.getElementById("builder-global-management-rail"),
  builderGlobalSaveState: document.getElementById("builder-global-save-state"),
  globalCategoryCount: document.getElementById("global-category-count"),
  globalFieldCount: document.getElementById("global-field-count"),
  globalEmbeddedFieldCount: document.getElementById("global-embedded-field-count"),
  globalConditions: document.getElementById("global-conditions"),
  noGlobalConditionsMessage: document.getElementById("no-global-conditions-message"),
  globalCategoryConnectChoice: document.getElementById("global-category-connect-choice"),
  globalCategoryConnectActive: document.getElementById("global-category-connect-active"),
  globalFieldConnectChoice: document.getElementById("global-field-connect-choice"),
  globalFieldConnectActive: document.getElementById("global-field-connect-active"),
  builderCategories: document.getElementById("builder-categories"),
  noCategoriesMessage: document.getElementById("no-categories-message"),
  builderConditions: document.getElementById("builder-conditions"),
  noConditionsMessage: document.getElementById("no-conditions-message"),
  builderSaveState: document.getElementById("builder-save-state"),
  backupButton: document.getElementById("backup-button"),
  openBuilderHistory: document.getElementById("open-builder-history"),
  builderHistoryDialog: document.getElementById("builder-history-dialog"),
  builderHistoryDialogList: document.getElementById("builder-history-dialog-list"),
  builderHistoryScope: document.getElementById("builder-history-scope"),
  clearBuilderHistory: document.getElementById("clear-builder-history"),
  discardSchemaButton: document.getElementById("discard-schema-button"),
  saveSchemaButton: document.getElementById("save-schema-button"),
  saveSchemaText: document.getElementById("save-schema-text"),
  schemaSpinner: document.getElementById("schema-spinner"),
  searchFieldsDialog: document.getElementById("search-fields-dialog"),
  fullSearchFilterDialog: document.getElementById("full-search-filter-dialog"),
  fullSearchFieldsDialog: document.getElementById("full-search-fields-dialog"),
  searchFilterDialogTitle: document.getElementById("search-filter-dialog-title"),
  searchFieldsDialogTitle: document.getElementById("search-fields-dialog-title"),
  fullSearchFilterOptions: document.getElementById(
    "full-search-filter-options",
  ),
  fullSearchColumnOptions: document.getElementById(
    "full-search-column-options",
  ),
  resetFullSearchFiltersButton: document.getElementById("reset-full-search-filters-button"),
  resetFullSearchFieldsButton: document.getElementById("reset-full-search-fields-button"),
  applyFullSearchFiltersButton: document.getElementById("apply-full-search-filters-button"),
  applyFullSearchFieldsButton: document.getElementById("apply-full-search-fields-button"),
  searchFieldOptions: document.getElementById("search-field-options"),
  selectAllSearchFieldsButton: document.getElementById(
    "select-all-search-fields-button",
  ),
  clearAllSearchFieldsButton: document.getElementById(
    "clear-all-search-fields-button",
  ),
  resetSearchFieldsButton: document.getElementById(
    "reset-search-fields-button",
  ),
  applySearchFieldsButton: document.getElementById(
    "apply-search-fields-button",
  ),
  categoryPlacementWrapper: document.getElementById(
    "category-placement-wrapper",
  ),
  categoryPlacement: document.getElementById("category-placement"),
  categoryDialog: document.getElementById("category-dialog"),
  categoryDialogTitle: document.getElementById("category-dialog-title"),
  categoryLabel: document.getElementById("category-label"),
  categoryKind: document.getElementById("category-kind"),
  categoryHasParent: document.getElementById("category-has-parent"),
  categoryParent: document.getElementById("category-parent"),
  categoryParentWrapper: document.getElementById("category-parent-wrapper"),
  categoryParentFieldWrapper: document.getElementById("category-parent-field-wrapper"),
  categoryParentField: document.getElementById("category-parent-field"),
  categoryDescription: document.getElementById("category-description"),
  categoryRepeatableOptions: document.getElementById(
    "category-repeatable-options",
  ),
  addCategoryConditionButton: document.getElementById(
    "add-category-condition-button",
  ),
  categoryConditionsList: document.getElementById("category-conditions-list"),
  categoryAddLabel: document.getElementById("category-add-label"),
  categoryAnchor: document.getElementById("category-anchor"),
  categoryAutoStart: document.getElementById("category-auto-start"),
  categoryRelatedPerson: document.getElementById("category-related-person"),
  categoryCardTitleField: document.getElementById("category-card-title-field"),
  categoryCardNamePrefix: document.getElementById("category-card-name-prefix"),
  categoryCardNamePrefixWrapper: document.getElementById("category-card-name-prefix-wrapper"),
  categoryCardSortMode: document.getElementById("category-card-sort-mode"),
  categoryCardSortFieldWrapper: document.getElementById("category-card-sort-field-wrapper"),
  categoryCardSortField: document.getElementById("category-card-sort-field"),
  categoryCardSortDirection: document.getElementById("category-card-sort-direction"),
  categoryImportSource: document.getElementById("category-import-source"),
  categoryImportFields: document.getElementById("category-import-fields"),
  applyCategoryImport: document.getElementById("apply-category-import"),
  confirmCategoryButton: document.getElementById("confirm-category-button"),
  addFieldConditionButton: document.getElementById(
    "add-field-condition-button",
  ),
  fieldConditionsList: document.getElementById("field-conditions-list"),
  fieldDialog: document.getElementById("field-dialog"),
  fieldCategoryDialog: document.getElementById("field-category-dialog"),
  newFieldCategory: document.getElementById("new-field-category"),
  newFieldAfter: document.getElementById("new-field-after"),
  fieldAfter: document.getElementById("field-after"),
  fieldCategoryName: document.getElementById("field-category-name"),
  fieldStartNewLine: document.getElementById("field-start-new-line"),
  fieldCheckboxMeanings: document.getElementById("field-checkbox-meanings"),
  fieldCheckboxTrueLabel: document.getElementById("field-checkbox-true-label"),
  fieldCheckboxFalseLabel: document.getElementById("field-checkbox-false-label"),
  confirmNewFieldCategory: document.getElementById("confirm-new-field-category"),
  fieldDialogTitle: document.getElementById("field-dialog-title"),
  fieldLabel: document.getElementById("field-label"),
  fieldType: document.getElementById("field-type"),
  fieldTextModeWrapper: document.getElementById("field-text-mode-wrapper"),
  fieldTextMode: document.getElementById("field-text-mode"),
  fieldListModeWrapper: document.getElementById("field-list-mode-wrapper"),
  fieldListMode: document.getElementById("field-list-mode"),
  fieldDateModeWrapper: document.getElementById("field-date-mode-wrapper"),
  fieldDateMode: document.getElementById("field-date-mode"),
  fieldDateTriggerWrapper: document.getElementById("field-date-trigger-wrapper"),
  fieldDateTrigger: document.getElementById("field-date-trigger"),
  fieldPlaceholder: document.getElementById("field-placeholder"),
  fieldWidth: document.getElementById("field-width"),
  fieldOptionsWrapper: document.getElementById("field-options-wrapper"),
  fieldOptions: document.getElementById("field-options"),
  fieldRequired: document.getElementById("field-required"),
  fieldUniqueWrapper: document.getElementById("field-unique-wrapper"),
  fieldUnique: document.getElementById("field-unique"),
  fieldSearchableWrapper: document.getElementById("field-searchable-wrapper"),
  fieldSearchable: document.getElementById("field-searchable"),
  fieldSearchMatchWrapper: document.getElementById(
    "field-search-match-wrapper",
  ),
  fieldSearchMatch: document.getElementById("field-search-match"),
  fieldResultWrapper: document.getElementById("field-result-wrapper"),
  fieldShowResult: document.getElementById("field-show-result"),
  fieldTitleWrapper: document.getElementById("field-title-wrapper"),
  fieldResultTitle: document.getElementById("field-result-title"),
  fieldUserEditableWrapper: document.getElementById("field-user-editable-wrapper"),
  fieldUserEditable: document.getElementById("field-user-editable"),
  fieldUserValueModeWrapper: document.getElementById("field-user-value-mode-wrapper"),
  fieldUserValueMode: document.getElementById("field-user-value-mode"),
  fieldUserTriggerWrapper: document.getElementById("field-user-trigger-wrapper"),
  fieldUserTrigger: document.getElementById("field-user-trigger"),
  fieldUniqueCardCheckboxWrapper: document.getElementById("field-unique-card-checkbox-wrapper"),
  fieldUniqueCardCheckbox: document.getElementById("field-unique-card-checkbox"),
  relatedPersonFieldEditor: document.getElementById(
    "related-person-field-editor",
  ),
  relatedPersonSourceField: document.getElementById(
    "related-person-source-field",
  ),
  relatedPersonSourceCheckboxWrapper: document.getElementById("related-person-source-checkbox-wrapper"),
  relatedPersonSourceCheckbox: document.getElementById("related-person-source-checkbox"),
  fieldAutoUpdateEditor: document.getElementById("field-auto-update-editor"),
  fieldAutoSource: document.getElementById("field-auto-source"),
  fieldAutoOperator: document.getElementById("field-auto-operator"),
  fieldAutoValueWrapper: document.getElementById("field-auto-value-wrapper"),
  fieldAutoValue: document.getElementById("field-auto-value"),
  fieldAutoAction: document.getElementById("field-auto-action"),
  fieldAutoResultWrapper: document.getElementById("field-auto-result-wrapper"),
  fieldAutoResult: document.getElementById("field-auto-result"),
  optionFilterEditor: document.getElementById("option-filter-editor"),
  optionFilterSource: document.getElementById("option-filter-source"),
  optionFilterMatrix: document.getElementById("option-filter-matrix"),
  numberBehaviorEditor: document.getElementById("number-behavior-editor"),
  numberFormatThousands: document.getElementById("number-format-thousands"),
  numberPreserveLeadingZeros: document.getElementById(
    "number-preserve-leading-zeros",
  ),
  numberStorageNote: document.getElementById("number-storage-note"),
  fieldValidationEditor: document.getElementById("field-validation-editor"),
  textValidationFields: document.getElementById("text-validation-fields"),
  numberValidationFields: document.getElementById("number-validation-fields"),
  dateValidationFields: document.getElementById("date-validation-fields"),
  validationMinLength: document.getElementById("validation-min-length"),
  validationMaxLength: document.getElementById("validation-max-length"),
  validationPattern: document.getElementById("validation-pattern"),
  validationMinNumber: document.getElementById("validation-min-number"),
  validationMaxNumber: document.getElementById("validation-max-number"),
  validationIntegerOnly: document.getElementById("validation-integer-only"),
  validationMinDate: document.getElementById("validation-min-date"),
  validationMaxDate: document.getElementById("validation-max-date"),
  validationCompareField: document.getElementById("validation-compare-field"),
  validationCompareOperator: document.getElementById(
    "validation-compare-operator",
  ),
  fileNamingEditor: document.getElementById("file-naming-editor"),
  fileNamingMode: document.getElementById("file-naming-mode"),
  fileProfileImageWrapper: document.getElementById(
    "file-profile-image-wrapper",
  ),
  fileProfileImage: document.getElementById("file-profile-image"),
  fileTemplateEditor: document.getElementById("file-template-editor"),
  filePartPrefix: document.getElementById("file-part-prefix"),
  filePartSuffix: document.getElementById("file-part-suffix"),
  filePartField: document.getElementById("file-part-field"),
  addFilePartButton: document.getElementById("add-file-part-button"),
  filePartsList: document.getElementById("file-parts-list"),
  confirmFieldButton: document.getElementById("confirm-field-button"),
  conditionDialog: document.getElementById("condition-dialog"),
  conditionDialogTitle: document.getElementById("condition-dialog-title"),
  conditionTargetLabel: document.getElementById("condition-target-label"),
  conditionSource: document.getElementById("condition-source"),
  conditionOperator: document.getElementById("condition-operator"),
  conditionGroup: document.getElementById("condition-group"),
  conditionNegate: document.getElementById("condition-negate"),
  conditionValueWrapper: document.getElementById("condition-value-wrapper"),
  conditionValueControl: document.getElementById("condition-value-control"),
  confirmConditionButton: document.getElementById("confirm-condition-button"),
  unsavedRecordDialog: document.getElementById("unsaved-record-dialog"),
  unsavedSaveButton: document.getElementById("unsaved-save-button"),
  unsavedDiscardButton: document.getElementById("unsaved-discard-button"),
  unsavedStayButton: document.getElementById("unsaved-stay-button"),
  closeConfirmDialog: document.getElementById("close-confirm-dialog"),
  closeConfirmMessage: document.getElementById("close-confirm-message"),
  closeConfirmCancel: document.getElementById("close-confirm-cancel"),
  closeConfirmAccept: document.getElementById("close-confirm-accept"),
  actionConfirmDialog: document.getElementById("action-confirm-dialog"),
  actionConfirmTitle: document.getElementById("action-confirm-title"),
  actionConfirmMessage: document.getElementById("action-confirm-message"),
  actionConfirmAccept: document.getElementById("action-confirm-accept"),
  actionConfirmCancel: document.getElementById("action-confirm-cancel"),
  actionSelectionDialog: document.getElementById("action-selection-dialog"),
  actionSelectionTitle: document.getElementById("action-selection-title"),
  actionSelectionMessage: document.getElementById("action-selection-message"),
  actionSelectionLabel: document.getElementById("action-selection-label"),
  actionSelectionControl: document.getElementById("action-selection-control"),
  actionSelectionAccept: document.getElementById("action-selection-accept"),
  actionSelectionCancel: document.getElementById("action-selection-cancel"),
  actionInputDialog: document.getElementById("action-input-dialog"),
  actionInputTitle: document.getElementById("action-input-title"),
  actionInputMessage: document.getElementById("action-input-message"),
  actionInputLabel: document.getElementById("action-input-label"),
  actionInputControl: document.getElementById("action-input-control"),
  actionInputAccept: document.getElementById("action-input-accept"),
  actionInputCancel: document.getElementById("action-input-cancel"),
  builderAuthDialog: document.getElementById("builder-auth-dialog"),
  builderAuthTitle: document.getElementById("builder-auth-title"),
  builderAuthNote: document.getElementById("builder-auth-note"),
  currentPasswordWrapper: document.getElementById("current-password-wrapper"),
  currentBuilderPassword: document.getElementById("current-builder-password"),
  builderPassword: document.getElementById("builder-password"),
  confirmPasswordWrapper: document.getElementById("confirm-password-wrapper"),
  confirmBuilderPassword: document.getElementById("confirm-builder-password"),
  confirmBuilderAuthButton: document.getElementById(
    "confirm-builder-auth-button",
  ),
  confirmBuilderAuthText: document.getElementById("confirm-builder-auth-text"),
  builderAuthSpinner: document.getElementById("builder-auth-spinner"),
  toast: document.getElementById("toast"),
  builderSidebarAddCategoryButton: document.getElementById(
    "builder-sidebar-add-category-button",
  ),
  builderSidebarAddFieldButton: document.getElementById(
    "builder-sidebar-add-field-button",
  ),

  builderCategoryNavList: document.getElementById("builder-category-nav-list"),
};

// Keep the live navigation elements (and their event handlers) while pages switch.
const headerSchemaNavigation = document.getElementById("header-schema-navigation");
const searchSchemaStrip = document.querySelector(".search-scope-strip");

// Search belongs to the upper part of the left action rail in entry mode.
elements.entryActionRail.prepend(elements.searchPanel);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function actionIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("action-icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function randomDefinitionId(prefix) {
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function activeOptions(field) {
  return (field?.options || []).filter((option) => option.active !== false);
}

function optionForValue(field, value) {
  const text = String(value ?? "");
  return (
    (field?.options || []).find(
      (option) => option.id === text || option.label === text,
    ) || null
  );
}

function optionIdForValue(field, value) {
  return optionForValue(field, value)?.id || String(value ?? "");
}

function optionLabelForValue(field, value) {
  return optionForValue(field, value)?.label || String(value ?? "");
}

function optionSourceTokens(field) {
  if (field?.type === "checkbox") {
    return [
      { id: "true", label: "محدد" },
      { id: "false", label: "غير محدد" },
    ];
  }
  return activeOptions(field);
}

function generateRecordCode() {
  const firstCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const otherCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  let code = firstCharacters[bytes[0] % firstCharacters.length];
  for (let index = 1; index < bytes.length; index += 1) {
    code += otherCharacters[bytes[index] % otherCharacters.length];
  }
  return code;
}

// Indexes live only for one synchronous render. Draft schemas are mutable, so
// retaining indexes between edits would make adds/deletes return stale objects.
const schemaRenderIndexes = new WeakMap();
function withSchemaRenderIndex(schema, render) {
  if (!schema || schemaRenderIndexes.has(schema)) return render();
  const index = {categories:new Map(), children:new Map(), fields:new Map(), all:[], data:[]};
  for (const category of schema.categories || []) {
    index.categories.set(category.id, category);
    const parent = category.parent_category_id || null;
    if (!index.children.has(parent)) index.children.set(parent, []);
    index.children.get(parent).push(category);
    for (const field of category.fields) {
      const entry = {category, field};
      index.fields.set(field.id, entry);
      index.all.push(entry);
      if (field.type !== 'spacer') index.data.push(entry);
    }
  }
  schemaRenderIndexes.set(schema, index);
  try { return render(); }
  finally { schemaRenderIndexes.delete(schema); }
}

function allCategories(schema = state.draftSchema) {
  return schema?.categories || [];
}

function allFields(schema = state.draftSchema, includeLayout = false) {
  const index = schemaRenderIndexes.get(schema);
  if (index) return includeLayout ? index.all : index.data;
  return allCategories(schema).flatMap((category) =>
    category.fields.filter((field) => includeLayout || field.type !== 'spacer').map((field) => ({ category, field })),
  );
}

function isSystemField(field) {
  return SYSTEM_FIELD_TYPES.has(field?.type);
}

function relatedPersonModeSourceId(categoryId) {
  return `${RELATED_PERSON_MODE_SOURCE_PREFIX}${categoryId}`;
}

function relatedPersonModeCategory(
  sourceId,
  schema = state.draftSchema,
) {
  if (!String(sourceId || "").startsWith(RELATED_PERSON_MODE_SOURCE_PREFIX)) {
    return null;
  }
  const categoryId = String(sourceId).slice(
    RELATED_PERSON_MODE_SOURCE_PREFIX.length,
  );
  const category = categoryById(categoryId, schema);
  return category?.kind === "repeatable" && category.related_person_enabled
    ? category
    : null;
}

function relatedPersonModeField(category) {
  if (
    category?.kind !== "repeatable" ||
    !category.related_person_enabled
  ) {
    return null;
  }
  return {
    id: relatedPersonModeSourceId(category.id),
    label: "هل لديه سجل؟",
    type: "yes_no",
    options: RELATED_PERSON_MODE_OPTIONS,
  };
}

function categoryById(categoryId, schema = state.draftSchema) {
  const index = schemaRenderIndexes.get(schema);
  return index ? index.categories.get(categoryId) : allCategories(schema).find((category) => category.id === categoryId);
}

function categoryChildren(categoryId, schema = state.draftSchema) {
  const index = schemaRenderIndexes.get(schema);
  if (index) return index.children.get(categoryId) || [];
  return allCategories(schema).filter(
    (category) => (category.parent_category_id || null) === categoryId,
  );
}

function categoryDescendantIds(categoryId, schema = state.draftSchema) {
  const descendants = new Set();
  const visit = (parentId) => {
    for (const child of categoryChildren(parentId, schema)) {
      if (descendants.has(child.id)) {
        continue;
      }
      descendants.add(child.id);
      visit(child.id);
    }
  };
  visit(categoryId);
  return descendants;
}

function orderedCategoryTree(schema = state.draftSchema) {
  const categories = allCategories(schema);
  const ids = new Set(categories.map((category) => category.id));
  const visited = new Set();
  const result = [];

  const visit = (category, depth = 0) => {
    if (!category || visited.has(category.id)) {
      return;
    }
    visited.add(category.id);
    result.push({ category, depth });
    categoryChildren(category.id, schema).forEach((child) => {
      visit(child, depth + 1);
    });
  };

  categories
    .filter(
      (category) =>
        !category.parent_category_id || !ids.has(category.parent_category_id),
    )
    .forEach((category) => visit(category));

  categories.forEach((category) => visit(category));
  return result;
}

function fieldById(fieldId, schema = state.draftSchema) {
  const index = schemaRenderIndexes.get(schema);
  const field = index ? index.fields.get(fieldId)?.field : allFields(schema, true).find(
    ({ field: candidate }) => candidate.id === fieldId,
  )?.field;
  if (field) {
    return field;
  }
  const category = relatedPersonModeCategory(fieldId, schema);
  return relatedPersonModeField(category);
}

function fieldCategory(fieldId, schema = state.draftSchema) {
  const index = schemaRenderIndexes.get(schema);
  if (index) return index.fields.get(fieldId)?.category || relatedPersonModeCategory(fieldId, schema);
  return (
    allFields(schema, true).find(({ field }) => field.id === fieldId)?.category ||
    relatedPersonModeCategory(fieldId, schema)
  );
}

function mainFields(schema = state.draftSchema) {
  return allCategories(schema)
    .filter((category) => category.kind === "main")
    .flatMap((category) => category.fields.filter((field) => field.type !== 'spacer'));
}

function setStatus(kind, text) {
  elements.status.className = `status status-${kind}`;
  elements.statusText.textContent = text;
}

function showToast(message, type = "success") {
  window.clearTimeout(state.toastTimer);

  elements.toast.textContent = message;
  elements.toast.className = `toast toast-${type}`;

  elements.toast.setAttribute("role", type === "error" ? "alert" : "status");

  if (typeof elements.toast.showPopover === "function") {
    /*
     * Hide and reopen it so it becomes the newest
     * top-layer element, above the active dialog.
     */
    if (elements.toast.matches(":popover-open")) {
      elements.toast.hidePopover();
    }

    elements.toast.showPopover();
  } else {
    // Fallback for an older browser.
    elements.toast.hidden = false;
  }

  state.toastTimer = window.setTimeout(() => {
    if (
      typeof elements.toast.hidePopover === "function" &&
      elements.toast.matches(":popover-open")
    ) {
      elements.toast.hidePopover();
    } else {
      elements.toast.hidden = true;
    }
  }, type === "error" ? 10000 : 5000);
}

function requestConfirmation(message, options = {}) {
  const dialog = elements.actionConfirmDialog;
  if (!dialog) return Promise.resolve(false);
  elements.actionConfirmTitle.textContent = options.title || "هل تريد المتابعة؟";
  elements.actionConfirmMessage.textContent = message;
  elements.actionConfirmAccept.textContent = options.confirmLabel || "متابعة";
  elements.actionConfirmAccept.className = `button ${options.danger === false ? "button-primary" : "button-danger"}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", closed);
      elements.actionConfirmAccept.onclick = null;
      elements.actionConfirmCancel.onclick = null;
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(false);
      dialog.close();
    };
    const closed = () => finish(false);
    elements.actionConfirmAccept.onclick = () => {
      finish(true);
      dialog.close();
    };
    elements.actionConfirmCancel.onclick = cancel;
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", closed);
    dialog.showModal();
    elements.actionConfirmCancel.focus();
  });
}

function requestSelection(options = {}) {
  const dialog = elements.actionSelectionDialog;
  if (!dialog) return Promise.resolve(null);
  elements.actionSelectionTitle.textContent = options.title || "اختر القيمة";
  elements.actionSelectionMessage.textContent = options.message || "";
  elements.actionSelectionMessage.hidden = !options.message;
  elements.actionSelectionLabel.textContent = options.label || "الاختيار";
  elements.actionSelectionAccept.textContent = options.confirmLabel || "متابعة";
  elements.actionSelectionControl.replaceChildren();
  (options.choices || []).forEach((choice) => {
    elements.actionSelectionControl.append(new Option(choice.label, choice.value));
  });
  if ([...elements.actionSelectionControl.options].some((item) => item.value === options.value)) {
    elements.actionSelectionControl.value = options.value;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", closed);
      elements.actionSelectionAccept.onclick = null;
      elements.actionSelectionCancel.onclick = null;
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(null);
      dialog.close();
    };
    const closed = () => finish(null);
    elements.actionSelectionAccept.onclick = () => {
      finish(elements.actionSelectionControl.value || null);
      dialog.close();
    };
    elements.actionSelectionCancel.onclick = cancel;
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", closed);
    dialog.showModal();
    elements.actionSelectionControl.focus();
  });
}

function requestText(options = {}) {
  const dialog = elements.actionInputDialog;
  if (!dialog) return Promise.resolve(null);
  elements.actionInputTitle.textContent = options.title || "أدخل القيمة";
  elements.actionInputMessage.textContent = options.message || "";
  elements.actionInputMessage.hidden = !options.message;
  elements.actionInputLabel.textContent = options.label || "القيمة";
  elements.actionInputAccept.textContent = options.confirmLabel || "متابعة";
  elements.actionInputControl.value = options.value || "";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", closed);
      elements.actionInputAccept.onclick = null;
      elements.actionInputCancel.onclick = null;
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(null);
      dialog.close();
    };
    const closed = () => finish(null);
    const accept = () => {
      const value = elements.actionInputControl.value.trim();
      if (options.required !== false && !value) {
        elements.actionInputControl.setCustomValidity(options.requiredMessage || "هذه القيمة مطلوبة.");
        elements.actionInputControl.reportValidity();
        return;
      }
      elements.actionInputControl.setCustomValidity("");
      finish(value);
      dialog.close();
    };
    elements.actionInputAccept.onclick = accept;
    elements.actionInputCancel.onclick = cancel;
    elements.actionInputControl.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        accept();
      }
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", closed);
    dialog.showModal();
    elements.actionInputControl.focus();
    elements.actionInputControl.select();
  });
}

function showStartupError(message) {
  elements.startupErrorMessage.textContent = message;
  elements.startupError.hidden = false;
  setStatus("error", "تعذّر فتح التطبيق");
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "حدث خطأ غير معروف.");
  }
  return body;
}
function createClientLogEntry(category, error, details = "") {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error || "Unknown error");

  const stack = error instanceof Error ? error.stack || "" : "";

  return {
    level: "error",
    category: String(category || "browser").slice(0, 80),
    message: message.slice(0, 4000),
    location: [details, stack].filter(Boolean).join("\n").slice(0, 4000),
    occurred_at: new Date().toISOString(),
  };
}

function readQueuedClientLogs() {
  try {
    const raw = localStorage.getItem(CLIENT_LOG_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUED_CLIENT_LOGS) : [];
  } catch (_error) {
    return [];
  }
}

function writeQueuedClientLogs(entries) {
  try {
    if (!entries.length) {
      localStorage.removeItem(CLIENT_LOG_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      CLIENT_LOG_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_QUEUED_CLIENT_LOGS)),
    );
  } catch (_error) {
    // Logging must never interrupt the application.
  }
}

function queueClientLog(entry) {
  const queued = readQueuedClientLogs();
  queued.push(entry);
  writeQueuedClientLogs(queued);
}

async function sendClientLog(entry) {
  const response = await fetch("/api/client-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error("Client log request failed");
  }
}

function reportClientError(category, error, details = "") {
  const entry = createClientLogEntry(category, error, details);

  sendClientLog(entry).catch(() => {
    queueClientLog(entry);
  });
}

async function flushClientLogs() {
  const queued = readQueuedClientLogs();

  if (!queued.length) {
    return;
  }

  writeQueuedClientLogs([]);

  const failed = [];

  for (const entry of queued) {
    try {
      await sendClientLog(entry);
    } catch (_error) {
      failed.push(entry);
    }
  }

  if (failed.length) {
    writeQueuedClientLogs(failed);
  }
}
function attributeSafe(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function entityName(plural = false, schema = state.schema) {
  if (!schema) {
    return plural ? "السجلات" : "سجل";
  }
  return plural ? schema.app.entity_plural : schema.app.entity_singular;
}

function updateHeaderContext(mode = state.mode) {
  elements.appHeader.dataset.page = mode;
  elements.settingsPageButton.classList.toggle(
    "header-command-active",
    mode === "settings",
  );
  if (mode === "settings") {
    elements.settingsPageButton.setAttribute("aria-current", "page");
  } else {
    elements.settingsPageButton.removeAttribute("aria-current");
  }
}

function mixHex(first, second, weight) {
  const parse = (value) => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
  const a = parse(first);
  const b = parse(second);
  const mixed = a.map((value, index) =>
    Math.round(value * (1 - weight) + b[index] * weight),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color) {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const light = Math.max(firstLuminance, secondLuminance);
  const dark = Math.min(firstLuminance, secondLuminance);
  return (light + 0.05) / (dark + 0.05);
}

function contrastText(background) {
  return contrastRatio(background, "#172033") >=
    contrastRatio(background, "#FFFFFF")
    ? "#172033"
    : "#FFFFFF";
}

function readableAccent(color) {
  let candidate = color;
  while (contrastRatio(candidate, "#FFFFFF") < 4.5) {
    candidate = mixHex(candidate, "#000000", 0.12);
  }
  return candidate;
}

function renderSessionMode(unlocked) {
  elements.sessionModeText.textContent = unlocked
    ? "وضع الإدارة"
    : "الوضع العادي";
  elements.sessionModeBadge.classList.toggle("session-mode-admin", unlocked);
  elements.sessionModeBadge.setAttribute(
    "aria-label",
    unlocked ? "إدارة جلسة الإدارة" : "الدخول إلى وضع الإدارة",
  );
  elements.sessionModeIconUse?.setAttribute(
    "href",
    unlocked ? "#icon-shield" : "#icon-lock",
  );
  if (elements.settingsPageButton) {
    elements.settingsPageButton.hidden = !unlocked;
  }
}

function applyAppIdentity(schema) {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "ar";
  document.title = schema.app.title;
  elements.appTitle.textContent = schema.app.title;
  updateHeaderContext(state.mode);
  elements.searchTitle.textContent = `البحث عن ${schema.app.entity_singular}`;
  const root = document.documentElement.style;
  const primary = state.workspaceSettings?.primary_color || "#1F5F95";
  const primaryDark = mixHex(primary, "#000000", 0.22);
  root.setProperty("--primary", primary);
  root.setProperty("--primary-contrast", contrastText(primary));
  root.setProperty("--primary-dark", primaryDark);
  root.setProperty("--primary-dark-contrast", contrastText(primaryDark));
  root.setProperty("--primary-ink", readableAccent(primary));
  root.setProperty("--primary-soft", mixHex(primary, "#FFFFFF", 0.88));
  root.setProperty("--bg", "#F4F7FB");
  root.setProperty("--surface", "#FFFFFF");
  const unlocked = Boolean(
    schema.builder_access?.unlocked || schema.developer_mode,
  );
  renderSessionMode(unlocked);
  document.querySelectorAll(".admin-navigation").forEach((button) => {
    button.hidden = !unlocked;
  });
  elements.openBuilderButton.hidden = !unlocked;
  elements.builderModeButton.title = unlocked
    ? "المصمّم مفتوح"
    : "المصمّم مقفل بكلمة مرور";
}

function hasConfiguredFields(schema = state.schema) {
  return allFields(schema).length > 0;
}

function queueRecordNavigation(action) {
  if (!state.recordDirty) {
    action();
    return true;
  }
  state.pendingNavigation = action;
  elements.unsavedRecordDialog.showModal();
  return false;
}

async function resolveRecordNavigation(choice) {
  const pending = state.pendingNavigation;
  if (!pending) {
    elements.unsavedRecordDialog.close();
    return;
  }
  if (choice === "stay") {
    state.pendingNavigation = null;
    elements.unsavedRecordDialog.close();
    return;
  }
  if (choice === "save") {
    elements.unsavedSaveButton.disabled = true;
    elements.unsavedDiscardButton.disabled = true;
    elements.unsavedStayButton.disabled = true;
    const saved = await saveCurrentRecord();
    elements.unsavedSaveButton.disabled = false;
    elements.unsavedDiscardButton.disabled = false;
    elements.unsavedStayButton.disabled = false;
    if (!saved) {
      return;
    }
  } else {
    clearLocalDraft();
    state.recordDirty = false;
    if (state.selectedRecordCode) {
      const restored = await performLoadRecord(state.selectedRecordCode, {
        force: true,
        silent: true,
        scroll: false,
        skipNavigationGuard: true,
      });
      if (!restored) {
        return;
      }
    } else {
      newRecord();
    }
  }
  state.pendingNavigation = null;
  elements.unsavedRecordDialog.close();
  await pending();
}

function resetPageScroll(smooth = false) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (typeof elements.page?.scrollTo === "function") {
        elements.page.scrollTo({ top: 0, left: 0, behavior: smooth ? "smooth" : "auto" });
      } else if (elements.page) {
        elements.page.scrollTop = 0;
      }
    });
  });
}

function setWorkspaceSchemaStripMounted(shouldMount) {
  const strip = elements.workspaceSchemaStrip;
  if (!strip || !headerSchemaNavigation) return;
  if (shouldMount) {
    if (strip.parentElement !== headerSchemaNavigation) headerSchemaNavigation.append(strip);
    strip.hidden = false;
    return;
  }
  strip.remove();
}

function performSwitchMode(mode) {
  if (state.pendingSchemaViews && !['builder', 'settings', 'loading'].includes(mode)) {
    const pending = state.pendingSchemaViews;
    state.pendingSchemaViews = null;
    applyLoadedSchema(pending.schema, {
      resetRecord:pending.resetRecord,
      preservedRecordCode:pending.preservedRecordCode,
      targetMode:mode,
    });
    return true;
  }
  if (mode === "settings") {
    if (!builderUnlocked()) {
      return false;
    }
    renderSettings();
    if (elements.settingsView && !elements.settingsView.open) {
      elements.settingsView.hidden = false;
      elements.settingsView.showModal();
    }
    return true;
  }
  const views = {
    loading: elements.loadingView,
    home: elements.homeView,
    entry: elements.entryView,
    search: elements.fullSearchView,
    import: elements.importView,
    export: elements.exportView,
    builder: elements.builderView,
    readonly: elements.readonlyView,
  };
  if (
    ["builder", "import", "export"].includes(mode) &&
    !state.schema?.builder_access?.unlocked &&
    !state.schema?.developer_mode
  ) {
    state.authReturnPage = mode;
    openBuilderAuthDialog(
      state.schema?.builder_access?.configured ? "unlock" : "initialize",
    );
    return false;
  }
  state.mode = mode;
  document.body.classList.toggle("home-mode-active", mode === "home");
  document.body.classList.toggle(
    "page-tab-bar-active",
    ["entry", "builder", "import", "export", "search"].includes(mode),
  );
  elements.appWorkspace.dataset.mode = mode;
  Object.entries(views).forEach(([name, view]) => {
    if (view) {
      view.hidden = name !== mode;
    }
  });
  elements.entryActionRail.hidden = mode !== "entry";
  elements.builderActionRail.hidden = mode !== "builder";
  elements.importActionRail.hidden = mode !== "import";
  elements.exportActionRail.hidden = mode !== "export";
  if (elements.workspaceSchemaStrip) {
    setWorkspaceSchemaStripMounted(
      ["entry", "builder", "import", "export"].includes(mode),
    );
    elements.entrySchemaTabs.hidden = mode !== "entry";
    elements.builderSchemaTabs.hidden = mode !== "builder";
    elements.importSchemaTabs.hidden = mode !== "import";
    elements.exportScopeTabs.hidden = mode !== "export";
  }
  if (searchSchemaStrip) {
    if (mode === "search") headerSchemaNavigation?.append(searchSchemaStrip);
    else searchSchemaStrip.remove();
  }
  if (headerSchemaNavigation) {
    headerSchemaNavigation.hidden = !["entry", "builder", "import", "export", "search"].includes(mode);
  }
  const navigationButtons = {
    home: elements.homeModeButton,
    entry: elements.entryModeButton,
    search: elements.searchPageButton,
    import: elements.importPageButton,
    export: elements.exportPageButton,
    builder: elements.builderModeButton,
  };
  Object.entries(navigationButtons).forEach(([name, button]) => {
    const active = name === mode;
    button?.classList.toggle("mode-button-active", active);
    if (active) {
      button?.setAttribute("aria-current", "page");
    } else {
      button?.removeAttribute("aria-current");
    }
  });
  updateHeaderContext(mode);
  if (mode === "builder") {
    renderBuilder();
    renderBuilderScope();
    scheduleCategoryObservation();
  } else if (mode === "entry") {
    refreshCategoryNavigation();
  } else if (mode === "home") {
    renderHome();
  } else if (mode === "search") {
    renderSearchHistory();
    renderMultiSchemaSearch();
    // Schema Search must always be rebuilt from the selected schema. Limiting
    // this refresh to single-schema workspaces left stale/empty controls after
    // returning from General Search in a multi-schema workspace.
    if (state.searchType === "schema") renderFullSearchFilters();
  } else if (["import", "export"].includes(mode)) {
    renderExchangePage();
  } else if (mode === "settings") {
    renderSettings();
  }

  updateStickyHeaderOffset();
  scheduleViewportPaintRecovery(true);
  resetPageScroll(false);
  return true;
}

function switchMode(mode, force = false) {
  const pageSchemaId = state.pageSchemaIds?.[mode];
  if (["entry", "builder", "search"].includes(mode) && pageSchemaId && pageSchemaId !== state.activeSchemaId) {
    void switchActiveSchema(pageSchemaId, { mode });
    return;
  }
  if (
    state.mode === "builder" &&
    mode !== "builder" &&
    state.dirty &&
    !force
  ) {
    void requestConfirmation(
      "توجد تغييرات غير محفوظة في التصميم. هل تريد مغادرة المصمّم؟",
      { title: "مغادرة المصمّم", confirmLabel: "تجاهل والمغادرة" },
    ).then((confirmed) => {
      if (confirmed) switchMode(mode, true);
    });
    return false;
  }
  if (
    state.mode === "settings" &&
    mode !== "settings" &&
    state.settingsDirty &&
    !force
  ) {
    void requestConfirmation(
      "توجد إعدادات غير محفوظة. هل تريد مغادرة الصفحة؟",
      { title: "مغادرة الإعدادات", confirmLabel: "تجاهل والمغادرة" },
    ).then((confirmed) => {
      if (!confirmed) return;
      state.settingsDirty = false;
      state.settingsDirtyCategory = "";
      switchMode(mode, true);
    });
    return false;
  }
  const navigate = () => performSwitchMode(mode);
  if (state.mode === "entry" && mode !== "entry" && state.recordDirty && !force) {
    return queueRecordNavigation(navigate);
  }
  return navigate();
}

function markDirty() {
  state.dirty = true;
  elements.builderSaveState.dataset.dirty = "true";
  elements.builderSaveState.textContent = "توجد تغييرات غير محفوظة.";
  elements.saveSchemaButton.disabled = state.savingSchema;
  elements.discardSchemaButton.disabled = state.savingSchema;
  renderAllSchemaTabs();
}

function markClean() {
  state.dirty = false;
  elements.builderSaveState.dataset.dirty = "false";
  elements.builderSaveState.textContent = "لا توجد تغييرات غير محفوظة.";
  elements.saveSchemaButton.disabled = state.savingSchema;
  elements.discardSchemaButton.disabled = state.savingSchema;
  renderAllSchemaTabs();
}

function syncSettingsToDraft() {
  if (!state.draftSchema) {
    return;
  }
  state.draftSchema.app.title = elements.settingTitle.value.trim();
  state.draftSchema.app.entity_singular = elements.settingSingular.value.trim();
  state.draftSchema.app.entity_plural = elements.settingPlural.value.trim();
  state.draftSchema.app.direction = "rtl";
  state.draftSchema.app.primary_color = elements.settingPrimaryColor.value;
  state.draftSchema.app.background_color = "#F4F7FB";
  state.draftSchema.app.surface_color = "#FFFFFF";
  state.draftSchema.app.language = "ar";
  state.draftSchema.app.startup_page = elements.settingStartupPage.value;
  state.draftSchema.app.search_page_size = Number(
    elements.settingSearchPageSize.value,
  );
  state.draftSchema.app.show_entry_search =
    elements.settingShowEntrySearch.checked;
  state.draftSchema.app.draft_autosave = elements.settingDraftAutosave.checked;
}
