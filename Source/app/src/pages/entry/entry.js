function conditionsFor(targetType, targetId, schema = state.schema) {
  return (schema.conditions || []).filter(
    (condition) =>
      condition.target_type === targetType && condition.target_id === targetId,
  );
}

function conditionValue(condition, mainValues, rowValues = null) {
  const sourceCategory = fieldCategory(condition.source_field_id, state.schema);
  if (
    sourceCategory?.kind === "repeatable" &&
    rowValues &&
    Object.prototype.hasOwnProperty.call(rowValues, condition.source_field_id)
  ) {
    return rowValues[condition.source_field_id];
  }
  return mainValues[condition.source_field_id] ?? "";
}

function normalizedComparison(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function conditionValueIsEmpty(field, value) {
  if (field?.type === "checkbox_group") {
    return !Array.isArray(value) || value.length === 0;
  }

  if (field?.type === "file") {
    if (value && typeof value === "object") {
      return !(value.stored_path || value.upload);
    }

    return String(value || "").trim() === "";
  }

  return value == null || String(value).trim() === "";
}

function conditionMatches(condition, mainValues, rowValues = null) {
  const sourceField = fieldById(condition.source_field_id, state.schema);

  if (!sourceField) {
    return false;
  }

  const rawActual = conditionValue(condition, mainValues, rowValues);

  const operator = condition.operator;
  const expected = String(condition.value ?? "");

  const empty = conditionValueIsEmpty(sourceField, rawActual);

  let result = false;

  if (operator === "empty") {
    result = empty;
  } else if (operator === "not_empty") {
    result = !empty;
  } else if (empty) {
    result = false;
  } else if (sourceField.type === "checkbox") {
    const actual =
      rawActual === true ||
      ["true", "1", "نعم", "yes", "on"].includes(
        String(rawActual).toLocaleLowerCase(),
      )
        ? "true"
        : "false";

    result = operator === "equals" ? actual === expected : actual !== expected;
  } else if (["select", "yes_no"].includes(sourceField.type)) {
    const actual = optionIdForValue(sourceField, rawActual);

    result = operator === "equals" ? actual === expected : actual !== expected;
  } else if (sourceField.type === "checkbox_group") {
    const rawValues = Array.isArray(rawActual)
      ? rawActual
      : String(rawActual || "")
          .split(" | ")
          .map((item) => item.trim())
          .filter(Boolean);

    const actualIds = new Set(
      rawValues.map((item) => optionIdForValue(sourceField, item)),
    );

    result =
      operator === "contains"
        ? actualIds.has(expected)
        : !actualIds.has(expected);
  } else if (sourceField.type === "number") {
    if (workspace.isTextNumber(sourceField)) {
      const actualText = normalizedComparison(workspace.rawNumber(rawActual));
      const expectedText = normalizedComparison(expected);
      result =
        {
          equals: actualText === expectedText,
          not_equals: actualText !== expectedText,
          contains: actualText.includes(expectedText),
          not_contains: !actualText.includes(expectedText),
        }[operator] ?? false;
    } else {
      const actualNumber = Number(workspace.rawNumber(rawActual));
      const expectedNumber = Number(expected);
      if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
        result =
          {
            equals: actualNumber === expectedNumber,
            not_equals: actualNumber !== expectedNumber,
            greater_than: actualNumber > expectedNumber,
            greater_or_equal: actualNumber >= expectedNumber,
            less_than: actualNumber < expectedNumber,
            less_or_equal: actualNumber <= expectedNumber,
          }[operator] ?? false;
      }
    }
  } else if (sourceField.type.startsWith("date_")) {
    const actualDate = String(rawActual || "");

    result =
      {
        equals: actualDate === expected,
        not_equals: actualDate !== expected,
        before: actualDate < expected,
        after: actualDate > expected,
        on_or_before: actualDate <= expected,
        on_or_after: actualDate >= expected,
      }[operator] ?? false;
  } else {
    const actualText = normalizedComparison(rawActual);
    const expectedText = normalizedComparison(expected);

    result =
      {
        equals: actualText === expectedText,
        not_equals: actualText !== expectedText,
        contains: actualText.includes(expectedText),
        not_contains: !actualText.includes(expectedText),
      }[operator] ?? false;
  }

  return condition.negate ? !result : result;
}

function targetVisible(targetType, targetId, mainValues, rowValues = null) {
  const conditions = conditionsFor(targetType, targetId);

  if (!conditions.length) {
    return true;
  }

  const groups = new Map();

  conditions.forEach((condition) => {
    const groupId = condition.group_id || `legacy-${targetType}-${targetId}`;

    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }

    groups.get(groupId).push(condition);
  });

  return [...groups.values()].some((groupConditions) =>
    groupConditions.every((condition) =>
      conditionMatches(condition, mainValues, rowValues),
    ),
  );
}

function isPersianLeapYear(year) {
  return [1, 5, 9, 13, 17, 22, 26, 30].includes(year % 33);
}

function isHijriLeapYear(year) {
  return [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29].includes(year % 30);
}

function isGregorianLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function calendarMonthLength(type, year, month) {
  if (type === "date_gregorian") {
    if ([1, 3, 5, 7, 8, 10, 12].includes(month)) {
      return 31;
    }
    if (month === 2) {
      return isGregorianLeapYear(year) ? 29 : 28;
    }
    return 30;
  }
  if (type === "date_hijri") {
    if (month % 2 === 1) {
      return 30;
    }
    return month === 12 && isHijriLeapYear(year) ? 30 : 29;
  }
  if (month <= 6) {
    return 31;
  }
  if (month <= 11) {
    return 30;
  }
  return isPersianLeapYear(year) ? 30 : 29;
}

function appendBlankOption(select, label) {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  select.append(option);
}

function calendarYearRange(type) {
  if (type === "date_gregorian") {
    return [1800, 2200];
  }
  if (type === "date_hijri") {
    return [1200, 1700];
  }
  return [1200, 1600];
}

function maximumSelectableCalendarDay(type, yearValue, monthValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);

  if (!month) {
    return 31;
  }

  if (year) {
    return calendarMonthLength(type, year, month);
  }

  if (type === "date_gregorian") {
    if (month === 2) {
      return 29;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  if (type === "date_hijri") {
    return month % 2 === 1 || month === 12 ? 30 : 29;
  }

  return month <= 6 ? 31 : 30;
}

function populateCalendarDays(daySelect, maximum, previousValue = "") {
  daySelect.replaceChildren();
  appendBlankOption(daySelect, "اليوم");

  for (let value = 1; value <= maximum; value += 1) {
    const option = document.createElement("option");
    const padded = String(value).padStart(2, "0");
    option.value = padded;
    option.textContent = padded;
    daySelect.append(option);
  }

  if (previousValue && Number(previousValue) <= maximum) {
    daySelect.value = String(previousValue).padStart(2, "0");
  }
}

function fillCalendarDays(group) {
  const hidden = group.querySelector("[data-value-control]");
  const type = group.dataset.calendarType;
  const year = Number(group.querySelector("[data-calendar-year]").value);
  const month = Number(group.querySelector("[data-calendar-month]").value);
  const daySelect = group.querySelector("[data-calendar-day]");
  const previous = daySelect.value;
  populateCalendarDays(
    daySelect,
    maximumSelectableCalendarDay(type, year, month),
    previous,
  );
  syncCalendarDate(group, hidden);
}

function syncCalendarDate(
  group,
  hidden = group.querySelector("[data-value-control]"),
) {
  const type = group.dataset.calendarType;
  const year = group.querySelector("[data-calendar-year]").value;
  const month = group.querySelector("[data-calendar-month]").value;
  const day = group.querySelector("[data-calendar-day]").value;
  hidden.value = year && month && day ? `${year}-${month}-${day}` : "";
  const readable = group.parentElement?.querySelector(
    "[data-calendar-readable]",
  );
  if (readable) {
    const monthName = CALENDAR_MONTH_NAMES[type]?.[Number(month) - 1];
    readable.textContent =
      year && monthName && day
        ? `${Number(day)} ${monthName} ${year} ${CALENDAR_SUFFIXES[type]}`
        : "";
  }
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function createCalendarControl(field, scope, categoryId) {
  const group = document.createElement("div");
  group.className = "calendar-control";
  group.dataset.calendarType = field.type;
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  setControlDataset(hidden, field, scope, categoryId);

  const year = document.createElement("select");
  year.className = "control";
  year.dataset.calendarYear = "";
  year.setAttribute("aria-label", `${field.label} — السنة`);
  appendBlankOption(year, "السنة");
  const [firstYear, lastYear] = calendarYearRange(field.type);
  for (let value = firstYear; scope !== "builder-preview" && value <= lastYear; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    year.append(option);
  }

  const month = document.createElement("select");
  month.className = "control";
  month.dataset.calendarMonth = "";
  month.setAttribute("aria-label", `${field.label} — الشهر`);
  appendBlankOption(month, "الشهر");
  for (let index = 0; scope !== "builder-preview" && index < 12; index += 1) {
    const option = document.createElement("option");
    option.value = String(index + 1).padStart(2, "0");
    option.textContent = String(index + 1).padStart(2, "0");
    month.append(option);
  }

  const day = document.createElement("select");
  day.className = "control";
  day.dataset.calendarDay = "";
  day.setAttribute("aria-label", `${field.label} — اليوم`);
  if (scope === "builder-preview") appendBlankOption(day, "");
  else populateCalendarDays(day, 31);

  day.addEventListener("change", () => syncCalendarDate(group));
  month.addEventListener("change", () => fillCalendarDays(group));
  year.addEventListener("change", () => fillCalendarDays(group));
  day.addEventListener("keydown", (event) => {
    if (event.key !== "-") return;
    event.preventDefault();
    event.stopPropagation();
    // A separator never moves focus; use Tab or click another date part.
  });
  month.addEventListener("keydown", (event) => {
    if (event.key !== "-") return;
    event.preventDefault();
    event.stopPropagation();
    // A separator never moves focus; use Tab or click another date part.
  });
  year.addEventListener("keydown", (event) => {
    if (event.key === "-" || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); }
  });
  // Value changes never schedule focus. Only explicit keyboard navigation moves it.
  group.append(hidden, day, month, year);
  hidden._focusControl = day;
  return { root: group, control: hidden };
}

function setControlDataset(control, field, scope, categoryId) {
  control.dataset.valueControl = "";
  control.dataset.fieldId = field.id;
  control.dataset.scope = scope;
  control.dataset.categoryId = categoryId;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    });
    reader.addEventListener("error", () => {
      reject(new Error(`تعذّر قراءة الملف: ${file.name}`));
    });
    reader.readAsDataURL(file);
  });
}

function storedFilename(path) {
  return (
    String(path || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || ""
  );
}

function refreshProfileImagePreview(hidden) {
  const root = hidden.closest(".attachment-control");
  const image = root?.querySelector("[data-profile-image-preview]");
  const empty = root?.querySelector("[data-profile-image-empty]");
  if (!image || !empty) {
    return;
  }

  if (hidden._profilePreviewUrl) {
    URL.revokeObjectURL(hidden._profilePreviewUrl);
    hidden._profilePreviewUrl = "";
  }

  let source = "";
  if (hidden._selectedFile) {
    source = URL.createObjectURL(hidden._selectedFile);
    hidden._profilePreviewUrl = source;
  } else if (hidden.value && isImageAttachment(hidden.value)) {
    source = attachmentApiUrl(hidden.value);
  }

  image.hidden = !source;
  empty.hidden = Boolean(source);
  image.src = source;
}

function attachmentHoverDetails(control) {
  const file = control._selectedFile;
  const name = control._uploadName || file?.name || storedFilename(control.value);
  if (!name) return null;
  const field = fieldById(control.dataset.fieldId, state.schema);
  const category = categoryById(control.dataset.categoryId, state.schema);
  const cardTitle = control.closest('.related-card')?.querySelector('[data-related-title]')?.textContent?.trim();
  const extension = name.match(/\.([^.]+)$/)?.[1]?.toUpperCase();
  const metadata = [
    ['الحقل', field?.label], ['الفئة', category?.label], ['البطاقة', cardTitle],
    ['النوع', extension || file?.type],
    ['الحالة', file ? 'مرفق جديد — غير محفوظ' : 'مرفق محفوظ'],
  ];
  if (file) metadata.push(['الحجم', `${new Intl.NumberFormat('ar').format(file.size)} بايت`]);
  return {name, details:'', metadata:metadata.filter(([,value]) => value)};
}

function refreshFileSummary(hidden) {
  const root = hidden.closest(".attachment-control");
  const summary = root.querySelector("[data-file-summary]");
  const open = root.querySelector("[data-open-file]");
  const remove = root.querySelector("[data-remove-file]");
  const file = hidden._selectedFile;
  const path = hidden.value;
  const nameInput = root.querySelector("[data-file-name]");
  const browse = root.querySelector("[data-browse-file]");
  if (nameInput) {
    const selected = Boolean(file || path);
    nameInput.readOnly = selected;
    if (selected) nameInput.value = hidden._uploadName || file?.name || storedFilename(path);
    nameInput.title = nameInput.value;
    nameInput.dataset.hoverLabel = nameInput.value || 'اسم المرفق';
    nameInput._attachmentHoverCard = () => attachmentHoverDetails(hidden);
    browse.hidden = selected;
    hidden._focusControl = selected ? nameInput : browse;
    root.dataset.hasFile = String(selected);
  }
  summary.textContent = file
    ? `ملف جديد: ${file.name}`
    : path
      ? `ملف محفوظ: ${storedFilename(path)}`
      : "";
  open.hidden = !path || Boolean(file);
  remove.hidden = !path && !file;
  summary.closest(".attachment-summary").hidden = true;
  root._attachmentHoverCard = () => attachmentHoverDetails(hidden);
  refreshProfileImagePreview(hidden);
}

function createFileControl(field, scope, categoryId) {
  const root = document.createElement("div");
  root.className = "attachment-control";
  const profileImage = ["profile", "card"].includes(field.image_display) && scope !== "search";
  root.classList.toggle("profile-image-control", profileImage);
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  setControlDataset(hidden, field, scope, categoryId);

  const picker = document.createElement("input");
  picker.type = "file";
  picker.className = "control";
  picker.dataset.filePicker = "";
  picker.hidden = true;
  picker.tabIndex = -1;
  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "button button-secondary";
  browse.dataset.browseFile = "";
  browse.textContent = "تصفح";
  browse.setAttribute("aria-label", `تصفح — ${field.label}`);
  browse.addEventListener("click", () => picker.click());
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "control";
  nameInput.dataset.fileName = "";
  nameInput.placeholder = "اسم المرفق";
  nameInput.setAttribute("aria-label", `اسم المرفق — ${field.label}`);
  hidden._focusControl = browse;
  if (profileImage) {
    picker.accept = "image/*";
  }

  const preview = document.createElement("div");
  if (profileImage) {
    preview.className = "profile-image-preview-frame";
    const image = document.createElement("img");
    image.dataset.profileImagePreview = "";
    image.alt = field.label;
    image.hidden = true;
    const empty = document.createElement("span");
    empty.dataset.profileImageEmpty = "";
    empty.setAttribute("aria-hidden", "true");
    preview.append(image, empty);
  }
  const summary = document.createElement("div");
  summary.className = "attachment-summary";
  const summaryText = document.createElement("span");
  summaryText.dataset.fileSummary = "";
  const actions = document.createElement("div");
  actions.className = "attachment-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "button button-secondary";
  open.dataset.openFile = "";
  open.append(actionIcon("open"), document.createTextNode("فتح الملف"));
  open.hidden = true;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-icon button-danger-quiet";
  remove.dataset.removeFile = "";
  remove.append(actionIcon("trash"));
  remove.title = "حذف المرفق";
  remove.setAttribute("aria-label", "حذف المرفق");
  remove.hidden = true;
  actions.append(open);
  summary.append(summaryText, actions);

  picker.addEventListener("change", () => {
    const file = picker.files?.[0] || null;
    const validProfileImage =
      !file ||
      !profileImage ||
      file.type.startsWith("image/") ||
      /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
    if (!validProfileImage) {
      picker.value = "";
      hidden._selectedFile = null;
      showToast("اختر ملف صورة صالحًا للمعاينة.", "error");
    } else if (file && file.size > MAX_ATTACHMENT_BYTES) {
      picker.value = "";
      hidden._selectedFile = null;
      showToast("حجم الملف يتجاوز 100 ميغابايت.", "error");
    } else {
      hidden._selectedFile = file;
      const requested = nameInput.value.trim();
      const extension = file?.name.match(/\.[^.]+$/)?.[0] || "";
      hidden._uploadName = file && requested
        ? (requested.toLowerCase().endsWith(extension.toLowerCase()) ? requested : requested + extension)
        : file?.name || "";
    }
    refreshFileSummary(hidden);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });
  open.addEventListener("click", () => {
    if (hidden.value) {
      const url = isImageAttachment(hidden.value)
        ? attachmentViewerUrl(hidden.value)
        : attachmentApiUrl(hidden.value);
      window.open(url, "_blank", "noopener");
    }
  });
  remove.addEventListener("click", async () => {
    if (!(await requestConfirmation("هل تريد حذف المرفق؟", { title: "حذف المرفق", confirmLabel: "حذف" }))) return;
    hidden.value = "";
    hidden._selectedFile = null;
    hidden._uploadName = "";
    nameInput.value = "";
    picker.value = "";
    refreshFileSummary(hidden);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const fileRow = document.createElement("div");
  fileRow.className = "attachment-line";
  fileRow.append(browse, nameInput, remove);
  if (profileImage) {
    root.append(hidden, preview, picker, fileRow, summary);
  } else {
    root.append(hidden, picker, fileRow, summary);
  }
  refreshFileSummary(hidden);
  return { root, control: hidden };
}

function checkboxGroupValues(control) {
  return [
    ...control
      .closest(".checkbox-group-control")
      .querySelectorAll('input[type="checkbox"][data-option-id]:checked'),
  ].map((input) => input.dataset.optionId);
}

function syncCheckboxGroupControl(control) {
  control.value = JSON.stringify(checkboxGroupValues(control));
}

function controlValue(control) {
  const field = fieldById(control.dataset.fieldId, state.schema);
  if (control.dataset.editableList === "true") {
    const typed = String(control.value || "").trim();
    const match = activeOptions(field).find((option) => (
      option.id === typed || normalizedComparison(option.label) === normalizedComparison(typed)
    ));
    return match?.id || typed;
  }
  if (control.multiple) {
    return [...control.selectedOptions].map((option) => option.value).filter(Boolean);
  }
  if (field?.type === "checkbox") {
    return control.tagName === "SELECT" ? control.value : control.checked;
  }
  if (field?.type === "checkbox_group") {
    return checkboxGroupValues(control);
  }
  if (field?.type === "number") {
    return workspace.rawNumber(control.value);
  }
  return control.value;
}

function createCheckboxGroupControl(field, scope, categoryId) {
  const root = document.createElement("div");
  root.className = "checkbox-group-control";
  const control = document.createElement("input");
  control.type = "hidden";
  setControlDataset(control, field, scope, categoryId);
  root.append(control);
  for (const optionValue of activeOptions(field)) {
    const label = document.createElement("label");
    label.className = "check-field checkbox-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.optionId = optionValue.id;
    const text = document.createElement("span");
    text.textContent = optionValue.label;
    label.append(input, text);
    root.append(label);
  }
  root.addEventListener("change", () => syncCheckboxGroupControl(control));
  syncCheckboxGroupControl(control);
  return { root, control };
}

function localDateTimeControlValue(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-` +
    `${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

function setSystemFieldValue(control, field) {
  const metadata = state.currentRecordMetadata || {};
  if (field.type === "system_record_code") {
    control.value = metadata.record_code || elements.recordCode.value || "";
    return;
  }
  const key = field.type === "system_created_at"
    ? "created_at"
    : "updated_at";
  control.value = localDateTimeControlValue(metadata[key]);
}

function refreshSystemFieldControls() {
  elements.recordForm
    .querySelectorAll("[data-value-control]")
    .forEach((control) => {
      const field = fieldById(control.dataset.fieldId, state.schema);
      if (isSystemField(field)) {
        setSystemFieldValue(control, field);
      }
    });
}

function createControl(field, scope, categoryId) {
  const searchScope = ["search", "full-search"].includes(scope);
  if (isSystemField(field)) {
    const control = document.createElement("input");
    control.className = "control system-field-control";
    control.readOnly = !searchScope;
    setControlDataset(control, field, scope, categoryId);
    if (field.type === "system_record_code") {
      control.type = "text";
      control.dir = "ltr";
      if (!searchScope) {
        control.dataset.copySystemRecordCode = "";
        control.title = "انقر لنسخ ID السجل";
        control.setAttribute("aria-label", `${field.label} — انقر للنسخ`);
      }
    } else {
      control.type = "datetime-local";
      control.dir = "ltr";
    }
    if (!searchScope) setSystemFieldValue(control, field);
    return { root: control, control };
  }
  if (field.type === "user_name") {
    const control = document.createElement("input");
    control.type = "text";
    control.className = "control user-name-field-control";
    setControlDataset(control, field, scope, categoryId);
    if (!searchScope) {
      control.value = ["current_on_save", "current_on_checkbox"].includes(field.user_value_mode)
        ? ""
        : state.auditUsers?.current_user || "";
      control.readOnly =
        field.user_editable === false ||
        ["current_on_save", "current_on_checkbox"].includes(field.user_value_mode);
    }
    return { root: control, control };
  }
  if (["date_gregorian", "date_hijri", "date_persian"].includes(field.type)) {
    return createCalendarControl(field, scope, categoryId);
  }
  if (field.type === "file") {
    return createFileControl(field, scope, categoryId);
  }
  if (field.type === "checkbox_group") {
    return createCheckboxGroupControl(field, scope, categoryId);
  }
  if (field.type === "checkbox") {
    if (searchScope) {
      const control = document.createElement("select");
      control.className = "control";
      setControlDataset(control, field, scope, categoryId);
      appendBlankOption(control, "— الكل —");
      const checked = document.createElement("option");
      checked.value = "true";
      checked.textContent = checkboxDisplayMeaning(field, true);
      const unchecked = document.createElement("option");
      unchecked.value = "false";
      unchecked.textContent = checkboxDisplayMeaning(field, false);
      control.append(checked, unchecked);
      return { root: control, control };
    }
    const root = document.createElement("label");
    root.className = "check-field standalone-check";
    const control = document.createElement("input");
    control.type = "checkbox";
    setControlDataset(control, field, scope, categoryId);
    const text = document.createElement("span");
    text.textContent = field.label;
    text.title = field.label;
    root.append(control, text);
    return { root, control };
  }

  if (["select", "yes_no"].includes(field.type) && !searchScope) {
    const root = document.createElement("div");
    root.className = "editable-list-control";
    const control = document.createElement("input");
    control.type = "text";
    control.className = "control";
    control.placeholder = field.placeholder || "اختر أو اكتب قيمة";
    control.dataset.editableList = "true";
    setControlDataset(control, field, scope, categoryId);
    control.required = field.required === true;
    const menu = document.createElement("div");
    menu.className = "editable-list-menu";
    menu.id = `list-${field.id}-${Math.random().toString(16).slice(2)}`;
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    control.setAttribute("role", "combobox");
    control.setAttribute("aria-autocomplete", "list");
    control.setAttribute("aria-controls", menu.id);
    control.setAttribute("aria-expanded", "false");

    const closeMenu = () => {
      menu.hidden = true;
      control.setAttribute("aria-expanded", "false");
      control.removeAttribute("aria-activedescendant");
    };
    const chooseOption = (option) => {
      control.value = option.label;
      control.dataset.selectedOptionId = option.id;
      clearFieldValidation(control);
      closeMenu();
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const renderMenu = (open = true) => {
      const typed = String(control.value || "").trim();
      const normalizedTyped = normalizedComparison(typed);
      const options = allowedOptionsForControl(control);
      const matches = options.filter((option) => (
        !normalizedTyped || normalizedComparison(option.label).includes(normalizedTyped)
      ));
      menu.replaceChildren();
      control.dataset.menuIndex = "-1";
      matches.forEach((option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.tabIndex = -1;
        item.className = "editable-list-option";
        item.id = `${menu.id}-option-${index}`;
        item.dataset.listOptionId = option.id;
        item.setAttribute("role", "option");
        item.textContent = option.label;
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("click", () => chooseOption(option));
        menu.append(item);
      });
      const dependencyReady = !field.option_filter || Boolean(
        dependencyTokenForControl(control),
      );
      if (typed && matches.length === 0 && dependencyReady) {
        const add = document.createElement("button");
        add.type = "button";
        add.tabIndex = -1;
        add.className = "editable-list-option editable-list-create-option";
        add.dataset.addInlineListOption = field.id;
        add.setAttribute("role", "option");
        add.textContent = `إضافة «${typed}» إلى القائمة`;
        add.addEventListener("pointerdown", (event) => event.preventDefault());
        add.addEventListener("mousedown", (event) => event.preventDefault());
        add.addEventListener("click", () => void addRuntimeListOption(control, add));
        menu.append(add);
      }
      const shouldOpen = open && menu.children.length > 0;
      menu.hidden = !shouldOpen;
      control.setAttribute("aria-expanded", String(shouldOpen));
    };
    const moveActive = (direction) => {
      const items = [...menu.querySelectorAll(".editable-list-option")];
      if (!items.length) return;
      let index = Number(control.dataset.menuIndex || -1);
      index = direction > 0
        ? (index + 1) % items.length
        : (index <= 0 ? items.length - 1 : index - 1);
      items.forEach((item, itemIndex) => {
        const active = itemIndex === index;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      control.dataset.menuIndex = String(index);
      control.setAttribute("aria-activedescendant", items[index].id || "");
      items[index].scrollIntoView({ block: "nearest" });
    };
    control.addEventListener("focus", () => renderMenu(true));
    control.addEventListener("input", () => {
      control.dataset.selectedOptionId = "";
      renderMenu(true);
    });
    control.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (menu.hidden) renderMenu(true);
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" && !menu.hidden) {
        const items = [...menu.querySelectorAll(".editable-list-option")];
        const active = items[Number(control.dataset.menuIndex || -1)];
        if (active) {
          event.preventDefault();
          active.click();
        }
        return;
      }
      if (event.key === "Escape") closeMenu();
    });
    control._renderListMenu = renderMenu;
    control._closeListMenu = closeMenu;
    control._chooseListOption = chooseOption;
    root.append(control, menu);
    return { root, control };
  }

  const control =
    field.type === "textarea"
      ? document.createElement("textarea")
      : field.type === "select" || field.type === "yes_no"
        ? document.createElement("select")
        : document.createElement("input");
  control.className = "control";
  control.placeholder = field.placeholder || "";
  setControlDataset(control, field, scope, categoryId);

  if (control.tagName === "TEXTAREA") {
    control.rows = 3;
  } else if (control.tagName === "SELECT") {
    const multiValueSearch = scope === "full-search" && ["select", "yes_no"].includes(field.type);
    if (multiValueSearch) {
      control.multiple = true;
      control.size = Math.min(8, Math.max(3, activeOptions(field).length));
      control.classList.add("modifier-free-multi-select");
    } else {
      appendBlankOption(control, "— اختر —");
    }
    for (const optionValue of activeOptions(field)) {
      const option = document.createElement("option");
      option.value = optionValue.id;
      option.textContent = optionValue.label;
      control.append(option);
    }
  } else if (field.type === "number") {
    control.type = "text";
    control.dir = "ltr";
    control.inputMode = workspace.isTextNumber(field) ? "text" : "decimal";
    control.dataset.numberControl = "true";
    control.addEventListener("focus", () => {
      control.value = workspace.rawNumber(control.value);
    });
    control.addEventListener("blur", () => {
      control.value = workspace.formatNumber(control.value, field);
    });
  } else {
    control.type = "text";
  }
  if (field.required && control.type !== "hidden") {
    control.required = true;
  }
  return { root: control, control };
}

function checkboxDisplayMeaning(field, value) {
  const checked = value === true || ["true", "1", "نعم", "yes", "on"].includes(String(value ?? "").toLocaleLowerCase());
  return checked ? (field.checkbox_true_label || "نعم") : (field.checkbox_false_label || "لا");
}

function applyFieldLineStart(element, field, width) {
  if (!field.start_new_line) return;
  element.classList.add("field-start-new-line");
  element.style.setProperty("--field-span", width === "full" ? "6" : width);
}

function createFieldElement(field, scope, categoryId) {
  const wrapper = document.createElement("div");
  let width = ({ normal: "1", wide: "4", long: "4" }[field.width] || field.width || "1");
  if (field.type === "file" && width !== "full") width = String(Math.max(2, Number(width) || 2));
  if (["profile", "card"].includes(field.image_display)) width = "1";
  wrapper.className = `field field-${width}`;
  applyFieldLineStart(wrapper, field, width);
  if (["profile", "card"].includes(field.image_display)) {
    wrapper.classList.add("profile-image-field");
  }
  wrapper.dataset.fieldWrapper = field.id;
  if (field.type === 'spacer') {
    wrapper.classList.add('layout-spacer');
    wrapper.setAttribute('aria-hidden', 'true');
    return wrapper;
  }
  const label = document.createElement("label");
  const generatedId = `control-${field.id}-${Math.random().toString(16).slice(2)}`;
  label.htmlFor = generatedId;
  label.textContent = field.label;
  label.title = field.label;
  if (field.required) {
    const required = document.createElement("span");
    required.className = "required-mark";
    required.textContent = "*";
    label.append(required);
  }
  const { root, control } = createControl(field, scope, categoryId);
  const focusControl = control._focusControl || control;
  focusControl.id = generatedId;
  let surface = root;
  if (root.matches("input, select, textarea")) {
    surface = document.createElement("div");
    surface.append(root);
  }
  surface.classList.add("entry-control-surface");
  if (field.type === "checkbox" && !["search", "full-search"].includes(scope)) {
    wrapper.classList.add("checkbox-entry-field");
    control.required = Boolean(field.required);
    const labelSpace = document.createElement('span');
    labelSpace.className = 'checkbox-label-space';
    labelSpace.setAttribute('aria-hidden', 'true');
    labelSpace.textContent = '\u00a0';
    wrapper.append(labelSpace, surface);
  } else wrapper.append(label, surface);
  return wrapper;
}

async function addRuntimeListOption(control, triggerButton = null) {
  const field = fieldById(control?.dataset.fieldId, state.schema);
  const label = String(control?.value || "").trim();
  if (!control || !field || !label) return;
  if (triggerButton) triggerButton.disabled = true;
  try {
    const dependencyToken = dependencyTokenForControl(control);
    const response = await fetch("/api/schema/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_id: field.id, label, dependency_token: dependencyToken }),
    });
    const result = await responseJson(response);
    if (!(field.options || []).some((option) => option.id === result.option.id)) {
      field.options = [...(field.options || []), result.option];
    }
    if (field.option_filter && result.dependency_token) {
      field.option_filter.mappings ||= {};
      const mapping = new Set(field.option_filter.mappings[result.dependency_token] || []);
      mapping.add(result.option.id);
      field.option_filter.mappings[result.dependency_token] = [...mapping];
    }
    state.schema.revision = result.revision;
    control._chooseListOption?.(result.option);
    control._closeListMenu?.();
    showToast("تمت إضافة القيمة إلى خيارات القائمة.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (triggerButton) triggerButton.disabled = false;
  }
}
function fieldValidationMessage(control) {
  const field = fieldById(control.dataset.fieldId, state.schema);

  if (!field) {
    return "";
  }

  if (control.validity.valueMissing) {
    return `الحقل «${field.label}» مطلوب.`;
  }

  if (control.validity.badInput) {
    return `يجب إدخال رقم صالح في الحقل «${field.label}».`;
  }

  if (control.validity.rangeUnderflow) {
    return `قيمة «${field.label}» يجب ألا تقل عن ${control.min}.`;
  }

  if (control.validity.rangeOverflow) {
    return `قيمة «${field.label}» يجب ألا تزيد على ${control.max}.`;
  }

  if (control.validity.stepMismatch) {
    return field.validation?.integer_only
      ? `يجب إدخال عدد صحيح في الحقل «${field.label}».`
      : `قيمة الحقل «${field.label}» غير صالحة.`;
  }

  if (field.type === "number" && control.value.trim()) {
    const raw = workspace.rawNumber(control.value);
    if (workspace.isTextNumber(field)) {
      const allowed = field.number_behavior?.allowed_special_characters || "";
      const validCharacters = [...raw].every(
        (character) => /[0-9]/.test(character) || allowed.includes(character),
      );
      if (!validCharacters || !/[0-9]/.test(raw)) {
        return `قيمة «${field.label}» تحتوي أحرفًا أو رموزًا غير مسموحة.`;
      }
    } else {
      const number = Number(raw);
      if (!Number.isFinite(number)) {
        return `يجب إدخال رقم صالح في الحقل «${field.label}».`;
      }
      if (field.validation?.integer_only && !Number.isInteger(number)) {
        return `يجب إدخال عدد صحيح في الحقل «${field.label}».`;
      }
      if (field.validation?.min != null && number < field.validation.min) {
        return `قيمة «${field.label}» يجب ألا تقل عن ${field.validation.min}.`;
      }
      if (field.validation?.max != null && number > field.validation.max) {
        return `قيمة «${field.label}» يجب ألا تزيد على ${field.validation.max}.`;
      }
    }
  }

  if (control.dataset.editableList === "true" && control.value.trim()) {
    const normalized = normalizedComparison(control.value);
    const allowed = allowedOptionsForControl(control);
    if (!allowed.some((option) => option.id === control.value || normalizedComparison(option.label) === normalized)) {
      return `اختر قيمة معتمدة للحقل «${field.label}» أو أضف القيمة الجديدة أولًا.`;
    }
  }

  return "";
}

function clearFieldValidation(control) {
  control.setCustomValidity("");
  control.removeAttribute("aria-invalid");

  const wrapper = control.closest("[data-field-wrapper]");
  const error = wrapper?.querySelector("[data-field-error]");
  if (error) {
    const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== error.id);
    if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
    else control.removeAttribute("aria-describedby");
    error.remove();
  }
  wrapper?.querySelector(".entry-control-surface")?.classList.remove("has-required-error");
}

function validateEntryControl(control, showMessage = true) {
  if (
    !control.matches("[data-value-control]") ||
    ["search", "full-search"].includes(control.dataset.scope) ||
    control.type === "hidden"
  ) {
    return true;
  }

  clearFieldValidation(control);

  const message = fieldValidationMessage(control);

  if (!message) {
    return true;
  }

  control.setCustomValidity(message);
  control.setAttribute("aria-invalid", "true");

  if (showMessage) {
    const wrapper = control.closest("[data-field-wrapper]");

    if (wrapper) {
      const surface = wrapper.querySelector(".entry-control-surface");
      const missing = control.validity.valueMissing && Boolean(surface);
      const error = document.createElement(missing ? "span" : "p");
      error.className = missing ? "field-error field-error-inside" : "field-error";
      error.dataset.fieldError = "";
      error.id = `error-${control.id || Math.random().toString(16).slice(2)}`;
      error.textContent = missing ? "هذا الحقل مطلوب" : message;
      error.setAttribute("role", "status");
      control.setAttribute("aria-describedby", [control.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
      if (missing) surface.classList.add("has-required-error");
      (missing ? surface : wrapper).append(error);
    }
  }

  return false;
}
function setControlValue(control, value) {
  const field = fieldById(control.dataset.fieldId, state.schema);
  if (!field) {
    return;
  }
  if (control.dataset.editableList === "true") {
    const option = activeOptions(field).find((candidate) => candidate.id === value);
    control.value = option?.label || String(value || "");
    control.dataset.selectedOptionId = option?.id || "";
    control._renderListMenu?.(false);
    return;
  }
  if (isSystemField(field)) {
    setSystemFieldValue(control, field);
    return;
  }
  if (["date_gregorian", "date_hijri", "date_persian"].includes(field.type)) {
    control.value = value || "";
    const group = control.closest(".calendar-control");
    const [year = "", month = "", day = ""] = String(value || "").split("-");
    group.querySelector("[data-calendar-year]").value = year;
    group.querySelector("[data-calendar-month]").value = month;
    fillCalendarDays(group);
    group.querySelector("[data-calendar-day]").value = day;
    control.value = value || "";
    syncCalendarDate(group, control);
  } else if (field.type === "file") {
    control.value = value || "";
    control._selectedFile = null;
    control._uploadName = "";
    const picker = control
      .closest(".attachment-control")
      .querySelector("[data-file-picker]");
    picker.value = "";
    refreshFileSummary(control);
  } else if (field.type === "checkbox") {
    const checked =
      value === true ||
      ["true", "1", "نعم", "yes", "on"].includes(
        String(value ?? "").toLocaleLowerCase(),
      );
    if (control.tagName === "SELECT") {
      control.value =
        value === "" || value == null ? "" : checked ? "true" : "false";
    } else {
      control.checked = checked;
      control._syncCheckboxMeaning?.();
    }
  } else if (field.type === "checkbox_group") {
    const values = Array.isArray(value)
      ? value
      : String(value || "")
          .split(" | ")
          .map((item) => item.trim())
          .filter(Boolean);
    const selected = new Set(
      values.map((item) => optionIdForValue(field, item)),
    );
    control
      .closest(".checkbox-group-control")
      .querySelectorAll('input[type="checkbox"][data-option-id]')
      .forEach((input) => {
        input.checked = selected.has(input.dataset.optionId);
      });
    syncCheckboxGroupControl(control);
  } else if (["select", "yes_no"].includes(field.type)) {
    if (control.multiple) {
      const values = new Set((Array.isArray(value) ? value : [value]).map((item) => optionIdForValue(field, item)));
      [...control.options].forEach((option) => { option.selected = values.has(option.value); });
    } else {
      control.value = optionIdForValue(field, value);
      if (!control.value && value) control.value = "";
    }
  } else if (field.type === "number") {
    control.value = workspace.formatNumber(value ?? "", field);
  } else {
    control.value = value ?? "";
  }
}

function sourceControlFor(targetControl, sourceFieldId) {
  const targetCategory = categoryById(
    targetControl.dataset.categoryId,
    state.schema,
  );
  const sourceCategory = fieldCategory(sourceFieldId, state.schema);
  if (
    targetControl.dataset.scope === "related" &&
    targetCategory?.id === sourceCategory?.id
  ) {
    return (
      targetControl
        .closest(".related-card")
        ?.querySelector(
          `[data-value-control][data-field-id="${attributeSafe(sourceFieldId)}"]`,
        ) || null
    );
  }
  return elements.recordForm.querySelector(
    `[data-value-control][data-scope="main"][data-field-id="${attributeSafe(sourceFieldId)}"]`,
  );
}

function optionFilterToken(sourceField, sourceControl) {
  const value = controlValue(sourceControl);
  if (sourceField.type === "checkbox") {
    return value ? "true" : "false";
  }
  return optionIdForValue(sourceField, value);
}

function dependencyTokenForControl(control) {
  const field = fieldById(control?.dataset.fieldId, state.schema);
  if (!field?.option_filter) return "";
  const sourceField = fieldById(field.option_filter.source_field_id, state.schema);
  const sourceControl = sourceField
    ? sourceControlFor(control, sourceField.id)
    : null;
  return sourceField && sourceControl
    ? optionFilterToken(sourceField, sourceControl)
    : "";
}

function allowedOptionsForControl(control) {
  const field = fieldById(control.dataset.fieldId, state.schema);
  const all = activeOptions(field);
  if (!field?.option_filter || control.dataset.scope === "search") {
    return all;
  }
  const source = fieldById(field.option_filter.source_field_id, state.schema);
  const sourceControl = sourceControlFor(
    control,
    field.option_filter.source_field_id,
  );
  if (!source || !sourceControl) {
    return all;
  }
  const token = optionFilterToken(source, sourceControl);
  const mapping = field.option_filter.mappings?.[token];
  if (!mapping) {
    return field.option_filter.unmatched === "none" ? [] : all;
  }
  const allowed = new Set(mapping);
  return all.filter((option) => allowed.has(option.id));
}

function refreshDependentControl(control, notify = false) {
  const field = fieldById(control.dataset.fieldId, state.schema);
  if (
    !field?.option_filter ||
    !["select", "checkbox_group"].includes(field.type)
  ) {
    return false;
  }
  const allowed = allowedOptionsForControl(control);
  const allowedIds = new Set(allowed.map((option) => option.id));
  let cleared = false;
  if (field.type === "select") {
    const activelyTyping = (
      control.dataset.editableList === "true" &&
      document.activeElement === control &&
      !control.dataset.selectedOptionId &&
      Boolean(control.value.trim())
    );
    if (activelyTyping) {
      control._renderListMenu?.(true);
      return false;
    }
    const previous = controlValue(control);
    if (control.dataset.editableList === "true") {
      control._renderListMenu?.(false);
    } else {
      control.replaceChildren();
      appendBlankOption(control, "— اختر —");
      for (const item of allowed) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        control.append(option);
      }
    }
    if (previous && allowedIds.has(previous)) {
      setControlValue(control, previous);
    } else {
      control.value = "";
      control.dataset.selectedOptionId = "";
      control._renderListMenu?.(false);
      cleared = Boolean(previous);
    }
  } else {
    control
      .closest(".checkbox-group-control")
      .querySelectorAll('input[type="checkbox"][data-option-id]')
      .forEach((input) => {
        const label = input.closest("label");
        const available = allowedIds.has(input.dataset.optionId);
        label.hidden = !available;
        input.disabled = !available;
        if (!available && input.checked) {
          input.checked = false;
          cleared = true;
        }
      });
    syncCheckboxGroupControl(control);
  }
  if (cleared && notify) {
    showToast(`تم مسح قيمة «${field.label}» لأنها لم تعد متاحة.`, "info");
  }
  return cleared;
}

function refreshAllDependentOptions(notify = false) {
  elements.recordForm
    .querySelectorAll("[data-value-control]")
    .forEach((control) => {
      refreshDependentControl(control, notify);
    });
}

function anchoredRelatedCategories(schema = state.schema) {
  const mapping = new Map();
  for (const category of schema.categories.filter(
    (candidate) =>
      candidate.kind === "repeatable" && !candidate.parent_category_id,
  )) {
    let anchor = category.anchor_field_id;
    if (!anchor) {
      const condition = conditionsFor("category", category.id, schema).find(
        (candidate) =>
          fieldCategory(candidate.source_field_id, schema)?.kind === "main",
      );
      anchor = condition?.source_field_id || null;
    }
    if (anchor) {
      if (!mapping.has(anchor)) {
        mapping.set(anchor, []);
      }
      mapping.get(anchor).push(category);
    }
  }
  return mapping;
}

function createSectionHeading(category) {
  const heading = document.createElement("div");
  heading.className = "section-heading collapsible-title-space";
  heading.dataset.toggleEntryCategory = "";
  heading.setAttribute("aria-expanded", "true");
  const content = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = category.label;
  const description = document.createElement("p");
  description.textContent = category.description || "";
  content.append(title);
  if (category.description) {
    content.append(description);
  }
  heading.append(content);
  return heading;
}

function setEntryCategoryCollapsed(section, collapsed) {
  if (!section) return;
  if (section.matches('[data-main-category-panel]')) return;
  section.classList.toggle("entry-category-collapsed", collapsed);
  const heading = section.querySelector(":scope > .section-heading[data-toggle-entry-category]");
  heading?.setAttribute("aria-expanded", String(!collapsed));
}

function expandEntryCategoryForControl(control) {
  const mainPanel = control?.closest('[data-main-category-panel]');
  if (mainPanel) selectMainCategoryTab(mainPanel.dataset.mainCategoryPanel);
  let card = control?.closest(".related-card");
  while (card) {
    selectRelatedCard(card.parentElement, card.dataset.childId);
    card = card.parentElement.closest(".related-card");
  }
  let section = control?.closest("[data-entry-category]");
  while (section) {
    setEntryCategoryCollapsed(section, false);
    section = section.parentElement?.closest("[data-entry-category]") || null;
  }
}

function activateEntryCategoryForControl(control) {
  const section = control?.closest("[data-entry-category]");
  if (!section) return;
  state.activeEntryCategorySection = section;
}

function createRelatedSection(category, parentChildId = "") {
  const section = document.createElement("section");
  section.className = "related-section field-full";
  section.dataset.relatedCategory = category.id;
  section.dataset.entryCategory = category.id;
  section.dataset.categoryId = category.id;
  section.dataset.parentChildId = parentChildId;
  section.id = parentChildId
    ? `entry-category-${category.id}-${parentChildId}`
    : `entry-category-${category.id}`;
  const heading = createSectionHeading(category);
  const records = document.createElement("div");
  records.className = "related-records home-schema-browser-panels";
  records.dataset.relatedRecords = category.id;
  records.dataset.parentChildId = parentChildId;

  const addRow = document.createElement("div");
  addRow.className = "related-add-row home-schema-browser-tabs";
  addRow.setAttribute("role", "tablist");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button button-secondary related-tab-add";
  add.dataset.addRelated = category.id;
  add.dataset.parentChildId = parentChildId;
  add.append(actionIcon("plus"));
  add.title = category.add_label || "إضافة بطاقة";
  add.setAttribute("aria-label", add.title);
  addRow.append(add);

  // Keep the add button after every card in both visual and keyboard order.
  const browser = document.createElement("div");
  browser.className = "home-tabbed-workspace home-schema-browser related-tab-workspace";
  browser.append(addRow, records);
  section.append(heading, browser);
  if (category.auto_start) {
    window.setTimeout(() => {
      if (records.isConnected && !directRelatedCards(records).length) {
        addRelatedCard(category.id, null, {
          markDirty: false,
          parentChildId,
        });
      }
    }, 0);
  }
  return section;
}

function createEntryCategorySection(category, anchors, rendered, options = {}) {
  const schema = options.schema || state.schema;
  const fieldFactory = options.fieldFactory || createFieldElement;
  if (!category || rendered.has(category.id)) {
    return null;
  }
  rendered.add(category.id);

  let section;
  if (category.kind === "repeatable") {
    section = options.relatedFactory ? options.relatedFactory(category, anchors, rendered, options) : createRelatedSection(category);
  } else {
    section = document.createElement("section");
    section.className = "form-section";
    section.dataset.mainCategory = category.id;
    section.dataset.entryCategory = category.id;
    section.dataset.categoryId = category.id;
    section.id = `entry-category-${category.id}`;
    section.append(createSectionHeading(category));

    const grid = document.createElement("div");
    grid.className = "field-grid main-category-fields";


    const nestedChildren = categoryChildren(category.id, schema);
    for (const field of category.fields) {
      const fieldElement = fieldFactory(field, "main", category.id);
      grid.append(fieldElement);
      nestedChildren
        .filter((child) => child.parent_field_id === field.id)
        .forEach((child) => {
          const childSection = createEntryCategorySection(
            child,
            anchors,
            rendered,
            options,
          );
          if (childSection) grid.append(childSection);
        });
      for (const related of anchors.get(field.id) || []) {
        const relatedSection = createEntryCategorySection(
          related,
          anchors,
          rendered,
          options,
        );
        if (relatedSection) {
          grid.append(relatedSection);
        }
      }
    }

    section.append(grid);
  }

  const children = categoryChildren(category.id, schema).filter(
    (child) => !rendered.has(child.id) && (
      category.kind !== "repeatable" || child.kind === "main"
    ),
  );
  if (children.length) {
    const childContainer = document.createElement("div");
    childContainer.className = "entry-category-children";
    for (const child of children) {
      const childSection = createEntryCategorySection(
        child,
        anchors,
        rendered,
        options,
      );
      if (childSection) {
        childContainer.append(childSection);
      }
    }
    if (childContainer.children.length) {
      section.append(childContainer);
    }
  }

  return section;
}

function renderEntryForm() {
  if (!state.schema) {
    return;
  }
  const configured = hasConfiguredFields();
  elements.emptySchemaPanel.hidden = configured;
  elements.recordForm.hidden = !configured;
  elements.entryRecordActions.hidden = !configured;
  if (!configured) {
    elements.searchPanel.hidden = true;
    if (state.mode === "entry") {
      refreshCategoryNavigation();
    }
    return;
  }

  const previousMainCategory = elements.mainSections.dataset.activeMainCategory;
  elements.mainSections.replaceChildren();
  elements.unanchoredRelatedSections.replaceChildren();
  state.activeEntryCategorySection = null;
  const anchors = anchoredRelatedCategories();
  const anchoredIds = new Set(
    [...anchors.values()].flat().map((category) => category.id),
  );

  const categoryIds = new Set(
    state.schema.categories.map((category) => category.id),
  );
  const roots = state.schema.categories.filter(
    (category) =>
      !category.parent_category_id ||
      !categoryIds.has(category.parent_category_id),
  );
  const rendered = new Set();

  for (const category of roots) {
    if (category.kind === "repeatable" && anchoredIds.has(category.id)) {
      continue;
    }
    const section = createEntryCategorySection(category, anchors, rendered);
    if (!section) {
      continue;
    }
    if (category.kind === "main") {
      elements.mainSections.append(section);
    } else {
      elements.unanchoredRelatedSections.append(section);
    }
  }

  for (const category of state.schema.categories) {
    const parent = categoryById(category.parent_category_id, state.schema);
    if (
      rendered.has(category.id) ||
      anchoredIds.has(category.id) ||
      parent?.kind === "repeatable"
    ) {
      continue;
    }
    const section = createEntryCategorySection(category, anchors, rendered);
    if (section) {
      (category.kind === "main"
        ? elements.mainSections
        : elements.unanchoredRelatedSections
      ).append(section);
    }
  }
  renderMainCategoryTabs(previousMainCategory);
  elements.unanchoredRelatedArea.hidden =
    elements.unanchoredRelatedSections.children.length === 0;
  elements.recordCode.value =
    state.selectedRecordCode ||
    elements.recordCode.value ||
    generateRecordCode();
  updateRecordButtonLabels();
  if (state.mode === "entry") {
    refreshCategoryNavigation();
  }
  updateConditionalVisibility();
  renderEntryRecentRecords();
}

function selectMainCategoryTab(categoryId, container = elements.mainSections) {
  const panels = [...container.querySelectorAll('[data-main-category-panel]')];
  const active = panels.find((panel) => panel.dataset.mainCategoryPanel === categoryId && !panel.hidden)
    || panels.find((panel) => !panel.hidden);
  container.dataset.activeMainCategory = active?.dataset.mainCategoryPanel || '';
  panels.forEach((panel) => {
    const selected = panel === active;
    panel.classList.toggle('main-category-panel-inactive', !selected);
    panel.toggleAttribute('inert', !selected);
    panel.setAttribute('aria-hidden', String(!selected));
  });
  container.querySelectorAll('[data-main-category-tab]').forEach((tab) => {
    const panel = panels.find((item) => item.dataset.mainCategoryPanel === tab.dataset.mainCategoryTab);
    const selected = panel === active;
    tab.hidden = !panel || panel.hidden;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  if (active && ((container === elements.mainSections && state.mode === 'entry') || (container === elements.builderCategories && state.mode === 'builder'))) setActiveBuilderCategory(active.dataset.mainCategoryPanel);
}

function reconcileChildElements(parent, children) {
  // Leave unchanged subtrees mounted: detaching a calendar/large select also
  // wakes layout observers and discards native focus/scroll state.
  children.forEach((child, index) => {
    if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null);
  });
  while (parent.children.length > children.length) parent.lastElementChild.remove();
}

function renderMainCategoryTabs(preferredCategoryId, container = elements.mainSections, schema = state.schema, suppliedPanels = null) {
  const panels = suppliedPanels || [...container.children].filter((section) => {
    const category = categoryById(section.dataset.mainCategory, schema);
    return category?.kind === 'main' && !category.parent_category_id;
  });
  if (!panels.length) {
    container.querySelector(':scope > .main-category-tab-workspace')?.remove();
    return;
  }
  let browser = container.querySelector(':scope > .main-category-tab-workspace');
  const existing = Boolean(browser);
  browser ||= document.createElement('div');
  browser.className = 'home-tabbed-workspace home-schema-browser main-category-tab-workspace';
  const rail = browser.firstElementChild || document.createElement('div');
  rail.className = 'home-schema-browser-tabs';
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', 'الفئات الرئيسية');
  const content = browser.lastElementChild || document.createElement('div');
  content.className = 'home-schema-browser-panels';
  if (!existing) {
    container.insertBefore(browser, panels[0].parentElement === container ? panels[0] : null);
    browser.append(rail, content);
  }
  const previousTabs = new Map([...rail.children].map(tab => [tab.dataset.mainCategoryTab, tab]));
  const nextTabs = [];
  panels.forEach((panel) => {
    const category = categoryById(panel.dataset.mainCategory, schema);
    const tabId = `${container.id}-category-tab-${category.id}`;
    panel.dataset.mainCategoryPanel = category.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.querySelector(':scope > .section-heading')?.remove();
    panel.classList.remove('entry-category-collapsed');
    const oldTab = previousTabs.get(category.id);
    const tab = oldTab || document.createElement('button');
    tab.type = 'button';
    tab.classList.add('home-schema-browser-tab');
    tab.dataset.mainCategoryTab = category.id;
    tab.id = tabId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    const label = tab.firstElementChild || document.createElement('span');
    if (label.textContent !== category.label) label.textContent = category.label;
    label.title = category.label;
    if (!oldTab) {
      tab.append(label);
      tab.addEventListener('click', () => selectMainCategoryTab(category.id, container));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...rail.children].filter((item) => !item.hidden);
        const index = tabs.indexOf(tab);
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowLeft' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[target]?.click();
        tabs[target]?.focus();
      });
    }
    nextTabs.push(tab);
  });
  reconcileChildElements(rail, nextTabs);
  reconcileChildElements(content, panels);
  selectMainCategoryTab(preferredCategoryId, container);
  return browser;
}

function entryFieldTabStops(includeInactiveMainPanels = false) {
  if (!elements.recordForm) return [];
  const selector = [
    '[data-linked-record-code]:not([disabled])',
    '[data-file-picker]:not([disabled])',
    '[data-file-name]:not([disabled])',
    '[data-related-tab]',
    '[data-calendar-day]:not([disabled])',
    '[data-calendar-month]:not([disabled])',
    '[data-calendar-year]:not([disabled])',
    'select[data-value-control]:not([disabled])',
    'textarea[data-value-control]:not([disabled]):not([readonly])',
    'input[data-value-control]:not([type="hidden"]):not([disabled]):not([readonly])',
    '.checkbox-group-control input[type="checkbox"]:not([disabled])',
    'button:not([disabled])',
    'a[href]',
  ].join(", ");
  const ordered = [];
  const walk = (root) => {
    for (const child of root.children) {
      if (child.hidden || child.classList.contains("entry-category-collapsed") || child.classList.contains('main-category-panel-inactive')) continue;
      if (child.classList.contains('main-category-tab-workspace')) {
        const rail = child.querySelector(':scope > .home-schema-browser-tabs');
        const panels = child.querySelector(':scope > .home-schema-browser-panels');
        for (const tab of rail.querySelectorAll(':scope > [data-main-category-tab]')) {
          if (tab.hidden) continue;
          ordered.push(tab);
          const panel = [...panels.children].find((item) => item.dataset.mainCategoryPanel === tab.dataset.mainCategoryTab);
          if (panel && !panel.hidden && (includeInactiveMainPanels || !panel.classList.contains('main-category-panel-inactive'))) {
            walk(panel);
          }
        }
      } else if (child.classList.contains("related-tab-workspace")) {
        const rail = child.querySelector(":scope > .related-add-row");
        const records = child.querySelector(":scope > .related-records");
        for (const tab of rail.querySelectorAll(":scope > [data-related-tab]")) {
          ordered.push(tab);
          const card = directRelatedCards(records).find((item) => item.dataset.childId === tab.dataset.relatedTab);
          if (card && !card.hidden) {
            ordered.push(tab.querySelector(".related-tab-close"));
            walk(card);
          }
        }
        ordered.push(rail.querySelector("[data-add-related]"));
      } else {
        if (child.matches(selector)) ordered.push(child);
        walk(child);
      }
    }
  };
  walk(elements.recordForm);
  return ordered.filter((control) => control && !control.disabled).filter((control) => (
    control.tabIndex >= 0 &&
    !control.closest("[hidden]") &&
    !control.closest(".entry-category-collapsed")
  ));
}

function focusAdjacentEntryField(current, reverse = false) {
  // Build the logical label → fields → next label order, including destination
  // panels. Only an explicit Tab reveals a destination; value edits never do.
  const controls = entryFieldTabStops(true);
  const index = controls.indexOf(current);
  if (index < 0 || controls.length === 0) return false;
  const nextIndex = (index + (reverse ? -1 : 1) + controls.length) % controls.length;
  const next = controls[nextIndex];
  const mainCategoryId = next.dataset.mainCategoryTab
    || next.closest('[data-main-category-panel]')?.dataset.mainCategoryPanel;
  if (mainCategoryId) selectMainCategoryTab(mainCategoryId);
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function mappedRelatedPersonValue(sourceField, targetField, value) {
  if (!["select", "yes_no", "checkbox_group"].includes(sourceField.type)) {
    return value;
  }
  const sourceOptions = new Map(
    (sourceField.options || []).map((option) => [option.id, option.label]),
  );
  const targetOptions = new Map(
    (targetField.options || []).map((option) => [
      normalizedComparison(option.label),
      option.id,
    ]),
  );
  const mapOne = (optionId) =>
    targetOptions.get(
      normalizedComparison(sourceOptions.get(optionId) || optionId),
    ) || "";
  if (sourceField.type === "checkbox_group") {
    return (Array.isArray(value) ? value : []).map(mapOne).filter(Boolean);
  }
  return mapOne(value);
}

async function fillRelatedPersonCard(card, category, code) {
  const normalizedCode = String(code || "").trim();
  const input = card.querySelector("[data-linked-record-code]");
  const status = card.querySelector("[data-related-person-status]");
  if (!normalizedCode) {
    showToast("أدخل ID الشخص المرتبط أولًا.", "error");
    input?.setCustomValidity("أدخل ID الشخص المرتبط أولًا.");
    return false;
  }
  if (normalizedCode === elements.recordCode.value) {
    showToast("لا يمكن ربط السجل بنفسه.", "error");
    input?.setCustomValidity("لا يمكن ربط السجل بنفسه.");
    return false;
  }

  if (input?._relatedPersonLoadPromise) {
    return input._relatedPersonLoadPromise;
  }

  const loadOperation = (async () => {
    input.disabled = true;
    card.classList.add("related-person-loading");
    if (status) {
      status.hidden = false;
      status.textContent = "جاري التحقق…";
    }

    try {
      const response = await fetch(
        `/api/records/${encodeURIComponent(normalizedCode)}`,
        { cache: "no-store" },
      );
      const linkedRecord = await responseJson(response);
      if (
        card.dataset.relatedPersonMode !== "existing" ||
        input.value.trim() !== normalizedCode
      ) {
        return false;
      }
      const values = {};
      directCardControls(card).forEach((control) => {
        values[control.dataset.fieldId] = controlValue(control);
      });
      let mappedCount = 0;
      for (const targetField of category.fields) {
        const sourceId = targetField.related_person_source_field_id;
        const sourceField = fieldById(sourceId, state.schema);
        if (!sourceField || !sourceId) {
          continue;
        }
        const sourceCategory = fieldCategory(sourceId, state.schema);
        let sourceValue = linkedRecord.main[sourceId];
        if (sourceCategory?.kind === "repeatable") {
          const checkboxId = targetField.related_person_source_checkbox_id;
          const sourceRow = (linkedRecord.related?.[sourceCategory.id] || []).find(
            (candidate) => Boolean(candidate.values?.[checkboxId]),
          );
          sourceValue = sourceRow?.values?.[sourceId] ?? "";
        }
        values[targetField.id] = mappedRelatedPersonValue(
          sourceField,
          targetField,
          sourceValue,
        );
        mappedCount += 1;
      }
      populateControlsInDependencyOrder(
        directCardControls(card),
        values,
      );
      card.dataset.linkedRecordCode = linkedRecord.record_code;
      input.value = linkedRecord.record_code;
      input.setCustomValidity("");
      if (status) {
        status.hidden = false;
        status.textContent = `تم الربط بـ ${linkedRecord.record_code}`;
      }
      updateConditionalVisibility();
      scheduleDraftSave();
      showToast(
        mappedCount
          ? `تم جلب بيانات الشخص المرتبط: ${linkedRecord.record_code}`
          : "تم التحقق من ID، لكن لم تُحدَّد حقول للنسخ في المصمّم.",
      );
      return true;
    } catch (error) {
      card.dataset.linkedRecordCode = "";
      input.setCustomValidity(error.message);
      if (status) {
        status.hidden = false;
        status.textContent = "لم يُعثر على سجل مطابق";
      }
      showToast(error.message, "error");
      return false;
    } finally {
      input.disabled = false;
      card.classList.remove("related-person-loading");
    }
  })();

  input._relatedPersonLoadPromise = loadOperation;
  try {
    return await loadOperation;
  } finally {
    input._relatedPersonLoadPromise = null;
  }
}

async function saveAndOpenRelatedRecord(card, category) {
  const input = card.querySelector("[data-linked-record-code]");
  const code = input?.value.trim() || "";
  if (!code) {
    return;
  }
  if (card.dataset.linkedRecordCode !== code) {
    const linked = await fillRelatedPersonCard(card, category, code);
    if (!linked) {
      return;
    }
  }
  if (await saveCurrentRecord()) {
    await loadRecord(code);
  }
}

function setRelatedPersonMode(card, mode, focusInput = false) {
  const existing = mode === "existing";
  const link = card.querySelector("[data-related-person-link]");
  const input = card.querySelector("[data-linked-record-code]");
  const status = card.querySelector("[data-related-person-status]");

  card.dataset.relatedPersonMode = existing ? "existing" : "manual";
  if (link) {
    link.hidden = !existing;
  }
  if (input) {
    input.required = existing;
  }

  card.querySelectorAll("[data-related-person-mode]").forEach((button) => {
    const selected =
      button.dataset.relatedPersonMode === card.dataset.relatedPersonMode;
    button.classList.toggle("related-person-mode-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  if (!existing) {
    card.dataset.linkedRecordCode = "";
    if (input) {
      input.value = "";
      input.setCustomValidity("");
    }
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
  } else if (focusInput && input) {
    // Mode changes leave keyboard focus where the user placed it.
  }

  if (card.isConnected) {
    updateConditionalVisibility();
    scheduleDraftSave();
  }
}

async function validateRelatedPersonCardsBeforeSave() {
  const cards = [
    ...elements.recordForm.querySelectorAll(
      '.related-card[data-related-person-mode="existing"]',
    ),
  ];

  for (const card of cards) {
    const input = card.querySelector("[data-linked-record-code]");
    const category = categoryById(card.dataset.categoryId, state.schema);
    const code = input?.value.trim() || "";

    if (!code) {
      expandEntryCategoryForControl(input);
      input.setCustomValidity("أدخل ID الشخص المرتبط.");
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }

    if (card.dataset.linkedRecordCode !== code) {
      const loaded = await fillRelatedPersonCard(card, category, code);
      if (!loaded) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
    }
  }

  return true;
}

function newRelatedChildId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replaceAll("-", "");
  }
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
    || `${Date.now().toString(16).padStart(16, "0")}${Math.random().toString(16).slice(2).padEnd(16, "0")}`.slice(0, 32);
}

function directRelatedCards(records) {
  return [...records.children].filter((child) => child.classList.contains("related-card"));
}

function selectRelatedCard(records, childId) {
  records.dataset.activeChildId = childId;
  directRelatedCards(records).forEach((card) => {
    const active = card.dataset.childId === childId;
    card.hidden = !active;
    card.classList.toggle("is-active", active);
  });
  records.parentElement.querySelectorAll(":scope > .related-add-row [data-related-tab]").forEach((tab) => {
    const active = tab.dataset.relatedTab === childId;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = 0;
    tab.querySelector(".related-tab-close").hidden = !active;
  });
}

function renderRelatedTabs(records) {
  const rail = records.parentElement.querySelector(":scope > .related-add-row");
  if (!rail) return;
  const cards = directRelatedCards(records);
  const existingTabs = [...rail.querySelectorAll(":scope > [data-related-tab]")];
  if (existingTabs.length === cards.length && existingTabs.every((tab, index) => tab.dataset.relatedTab === cards[index].dataset.childId)) {
    // Editing a value must not replace focused tab labels or affect the active card.
    existingTabs.forEach((tab, index) => {
      const name = cards[index].querySelector("[data-related-title]").textContent;
      const label = tab.querySelector(":scope > span");
      if (label.textContent !== name) label.textContent = name;
      label.title = name;
      const close = tab.querySelector(".related-tab-close");
      close.title = `حذف ${name}`;
      close.setAttribute("aria-label", close.title);
    });
    return;
  }
  existingTabs.forEach((tab) => tab.remove());
  const add = rail.querySelector("[data-add-related]");
  cards.forEach((card, index) => {
    const tab = document.createElement("div");
    tab.className = "home-schema-browser-tab";
    tab.setAttribute("role", "tab");
    tab.dataset.relatedTab = card.dataset.childId;
    tab.id = `related-tab-${card.dataset.childId}`;
    card.id = `related-panel-${card.dataset.childId}`;
    tab.setAttribute("aria-controls", card.id);
    card.setAttribute("role", "tabpanel");
    card.setAttribute("aria-labelledby", tab.id);
    const label = document.createElement("span");
    label.textContent = card.querySelector("[data-related-title]").textContent;
    label.title = label.textContent;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "related-tab-close";
    remove.textContent = "×";
    remove.title = `حذف ${label.textContent}`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      card.querySelector(":scope > .related-card-heading [data-remove-related-card]").click();
    });
    tab.append(label, remove);
    tab.addEventListener("click", () => selectRelatedCard(records, card.dataset.childId));
    tab.addEventListener("keydown", (event) => {
      if (event.target !== tab) return;
      if (["Enter", " ", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        let target = index;
        if (event.key === "ArrowLeft") target = (index + 1) % cards.length;
        if (event.key === "ArrowRight") target = (index + cards.length - 1) % cards.length;
        if (event.key === "Home") target = 0;
        if (event.key === "End") target = cards.length - 1;
        selectRelatedCard(records, cards[target].dataset.childId);
        rail.querySelector(`[data-related-tab="${cards[target].dataset.childId}"]`).focus();
      }
    });
    rail.insertBefore(tab, add);
  });
  const active = cards.find((card) => card.dataset.childId === records.dataset.activeChildId) || cards[0];
  if (active) selectRelatedCard(records, active.dataset.childId);
}

function relatedRecordsContainer(categoryId, parentChildId = "") {
  return [...document.querySelectorAll(
    `[data-related-records="${attributeSafe(categoryId)}"]`,
  )].find((records) => (records.dataset.parentChildId || "") === parentChildId) || null;
}

function directCardControls(card, selector = "[data-value-control]") {
  return [...card.querySelectorAll(selector)].filter(
    (control) => control.closest(".related-card") === card,
  );
}

function addRelatedCard(
  categoryId,
  row = null,
  {
    focusFirst = false,
    markDirty = row === null,
    parentChildId = row?.parent_child_id || "",
  } = {},
) {
  const category = categoryById(categoryId, state.schema);
  const records = relatedRecordsContainer(categoryId, parentChildId);
  if (!category || !records || !category.fields.length) {
    return;
  }
  const card = document.createElement("div");
  card.className = "related-card";
  card.dataset.childId = row?._child_id || newRelatedChildId();
  card.dataset.clientGenerated = row?._client_generated || !row?._child_id ? "true" : "false";
  card.dataset.parentChildId = parentChildId;
  card.dataset.categoryId = category.id;
  const heading = document.createElement("div");
  heading.className = "related-card-heading";
  const identity = document.createElement("div");
  const title = document.createElement("strong");
  title.dataset.relatedTitle = "";
  identity.append(title);
  let initialRelatedPersonMode = null;

  if (category.related_person_enabled) {
    const workflow = document.createElement("div");
    workflow.className = "related-person-workflow";
    const question = document.createElement("span");
    question.className = "related-person-question";
    question.textContent = "هل لديه سجل؟";
    const modes = document.createElement("div");
    modes.className = "related-person-modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "هل لدى الشخص المرتبط سجل؟");
    for (const [mode, label] of [
      ["existing", "لديه سجل"],
      ["manual", "ليس لديه سجل"],
    ]) {
      const modeButton = document.createElement("button");
      modeButton.type = "button";
      modeButton.className = "related-person-mode";
      modeButton.dataset.relatedPersonMode = mode;
      modeButton.textContent = label;
      modeButton.addEventListener("click", () => {
        setRelatedPersonMode(card, mode, mode === "existing");
      });
      modes.append(modeButton);
    }
    workflow.append(question, modes);

    const link = document.createElement("div");
    link.className = "related-person-link";
    link.dataset.relatedPersonLink = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "control";
    input.dir = "ltr";
    input.placeholder = "ID الشخص المرتبط";
    input.dataset.linkedRecordCode = "";
    input.value = row?.linked_record_code || "";
    card.dataset.linkedRecordCode = row?.related_person_mode
      ? ""
      : input.value;
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      if (input.value.trim() !== card.dataset.linkedRecordCode) {
        card.dataset.linkedRecordCode = "";
      }
      const status = card.querySelector("[data-related-person-status]");
      if (status) {
        status.hidden = true;
        status.textContent = "";
      }
      scheduleDraftSave();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      if (
        card.dataset.relatedPersonMode === "existing" &&
        input.value.trim() &&
        input.value.trim() !== card.dataset.linkedRecordCode
      ) {
        void fillRelatedPersonCard(card, category, input.value);
      }
    });
    const status = document.createElement("small");
    status.className = "related-person-status";
    status.dataset.relatedPersonStatus = "";
    status.hidden = true;
    const saveAndOpen = document.createElement("button");
    saveAndOpen.type = "button";
    saveAndOpen.className =
      "button button-secondary related-person-save-open";
    saveAndOpen.title = "حفظ التعديلات وفتح سجل الشخص المرتبط";
    saveAndOpen.setAttribute("aria-label", saveAndOpen.title);
    saveAndOpen.append(actionIcon("open"));
    saveAndOpen.addEventListener("click", () => {
      void saveAndOpenRelatedRecord(card, category);
    });
    link.append(input, saveAndOpen, status);
    identity.append(workflow, link);

    initialRelatedPersonMode =
      row?.related_person_mode ||
      (row?.linked_record_code ? "existing" : "manual");
  }

  const headingTools = document.createElement("div");
  headingTools.className = "related-card-tools";
  headingTools.hidden = true;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-danger-quiet icon-text-button";
  remove.dataset.removeRelatedCard = "";
  remove.append(actionIcon("trash"), document.createTextNode("حذف البطاقة"));
  remove.addEventListener("click", async () => {
    if (!(await requestConfirmation("هل تريد حذف هذه البطاقة وكل حقولها؟", { title: "حذف البطاقة", confirmLabel: "حذف" }))) return;
    card.remove();
    renumberRelatedCards(records);
    scheduleDraftSave();
  });
  headingTools.append(remove);
  heading.append(identity, headingTools);

  const grid = document.createElement("div");
  grid.className = "field-grid";
  const nestedCategories = categoryChildren(category.id, state.schema)
    .filter((child) => child.kind === "repeatable");
  const positionedChildIds = new Set();
  category.fields.forEach((field) => {
    const wrapper = createFieldElement(field, "related", category.id);
    const targetColumn = grid;
    targetColumn.append(wrapper);
    nestedCategories
      .filter((child) => child.parent_field_id === field.id)
      .forEach((child) => {
        targetColumn.append(createRelatedSection(child, card.dataset.childId));
        positionedChildIds.add(child.id);
      });
  });

  card.append(heading);
  title.hidden = true;
  heading.hidden = !category.related_person_enabled;
  card.append(grid);
  const nested = document.createElement("div");
  nested.className = "related-card-nested-categories";
  nestedCategories
    .filter((child) => !positionedChildIds.has(child.id))
    .forEach((child) => nested.append(createRelatedSection(child, card.dataset.childId)));
  if (nested.children.length) card.append(nested);
  records.append(card);
  if (!row || !records.dataset.activeChildId) records.dataset.activeChildId = card.dataset.childId;

  if (initialRelatedPersonMode) {
    setRelatedPersonMode(card, initialRelatedPersonMode);
    if (row?.linked_record_code && !row?.related_person_mode) {
      const status = card.querySelector("[data-related-person-status]");
      status.hidden = false;
      status.textContent = `تم الربط بـ ${row.linked_record_code}`;
    }
  }

  const cardControls = directCardControls(card);

  populateControlsInDependencyOrder(cardControls, row?.values || {});
  renumberRelatedCards(records);
  refreshAllDependentOptions(false);
  updateConditionalVisibility();

  if (markDirty && !state.restoringDraft && row === null) {
    scheduleDraftSave();
  }


  return card;
}

function renumberRelatedCards(records, preserveOrder = false) {
  const category = categoryById(records.dataset.relatedRecords, state.schema);
  const cards = directRelatedCards(records);
  const directFieldControl = (card, fieldId) => directCardControls(
    card,
    `[data-value-control][data-field-id="${attributeSafe(fieldId)}"]`,
  )[0];
  const displayValue = (card, fieldId) => {
    const control = directFieldControl(card, fieldId);
    if (!control) return "";
    const field = fieldById(fieldId, state.schema);
    const value = controlValue(control);
    if (field?.type === "checkbox") return checkboxDisplayMeaning(field, value);
    if (["select", "yes_no"].includes(field?.type)) {
      return optionLabelForValue(field, value);
    }
    return Array.isArray(value) ? value.join("، ") : String(value ?? "");
  };
  const sort = category?.card_sort || { mode: "manual", direction: "asc" };
  if (sort.mode !== "manual" && !preserveOrder) {
    const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
    cards.sort((first, second) => {
      let firstValue = "";
      let secondValue = "";
      const fieldId = sort.mode === "title"
        ? category.card_title_field_id
        : sort.field_id;
      firstValue = displayValue(first, fieldId);
      secondValue = displayValue(second, fieldId);
      const result = collator.compare(firstValue, secondValue);
      return sort.direction === "desc" ? -result : result;
    });
    cards.forEach((card, index) => {
      if (records.children[index] !== card) records.insertBefore(card, records.children[index] || null);
    });
  }
  cards.forEach((card, index) => {
    const sequence = index + 1;
    card.dataset.minorId = String(sequence);
    const custom = category?.card_title_field_id
      ? displayValue(card, category.card_title_field_id).trim()
      : "";
    const prefix = category?.card_name_prefix?.trim() || "بطاقة";
    card.querySelector("[data-related-title]").textContent =
      custom || `${prefix} ${sequence}`;
  });
  renderRelatedTabs(records);
}

function mainValues() {
  const values = {};
  elements.recordForm
    .querySelectorAll('[data-value-control][data-scope="main"]')
    .forEach((control) => {
      values[control.dataset.fieldId] = controlValue(control);
    });
  return values;
}

function autoUpdateResult(rule, targetField, main, sourceRowValues) {
  if (rule.action === "clear") {
    return targetField.type === "checkbox" ? false : "";
  }
  if (rule.action === "current_user") {
    return state.auditUsers?.current_user || "";
  }
  if (rule.action === "copy_source") {
    return conditionValue(rule, main, sourceRowValues);
  }
  return rule.result_value ?? "";
}

function matchingAutoUpdateSource(rule, main, targetCategory, targetCard) {
  const sourceCategory = fieldCategory(rule.source_field_id, state.schema);
  if (sourceCategory?.kind !== "repeatable") {
    return {
      matched: conditionMatches(rule, main, null),
      rowValues: null,
    };
  }
  if (sourceCategory.id === targetCategory.id) {
    const rowValues = targetCard ? cardValues(targetCard) : null;
    return {
      matched: Boolean(rowValues) && conditionMatches(rule, main, rowValues),
      rowValues,
    };
  }
  const sourceCards = [...elements.recordForm.querySelectorAll(
    `.related-card[data-category-id="${attributeSafe(sourceCategory.id)}"]`,
  )];
  for (const sourceCard of sourceCards) {
    const rowValues = cardValues(sourceCard);
    if (conditionMatches(rule, main, rowValues)) {
      return { matched: true, rowValues };
    }
  }
  return { matched: false, rowValues: null };
}

function applyAutoUpdateRules() {
  if (state.applyingAutoUpdates || !state.schema) return;
  state.applyingAutoUpdates = true;
  try {
    const main = mainValues();
    for (let pass = 0; pass < 10; pass += 1) {
      let changed = false;
      for (const category of state.schema.categories) {
        for (const field of category.fields) {
          const rule = field.auto_update;
          if (!rule) continue;
          const controls = category.kind === "main"
            ? [...elements.recordForm.querySelectorAll(
                `[data-value-control][data-scope="main"][data-field-id="${attributeSafe(field.id)}"]`,
              )]
            : [...elements.recordForm.querySelectorAll(
                `.related-card[data-category-id="${attributeSafe(category.id)}"] [data-value-control][data-field-id="${attributeSafe(field.id)}"]`,
              )].filter((control) => control.closest(".related-card")?.dataset.categoryId === category.id);
          controls.forEach((control) => {
            const card = control.closest(".related-card");
            const source = matchingAutoUpdateSource(rule, main, category, card);
            if (!source.matched) return;
            const next = autoUpdateResult(
              rule,
              field,
              main,
              source.rowValues,
            );
            if (JSON.stringify(controlValue(control)) === JSON.stringify(next)) return;
            setControlValue(control, next);
            if (!card) main[field.id] = next;
            changed = true;
          });
        }
      }
      if (!changed) break;
    }
  } finally {
    state.applyingAutoUpdates = false;
  }
}

function cardValues(card) {
  const values = {};
  directCardControls(card).forEach((control) => {
    values[control.dataset.fieldId] = controlValue(control);
  });
  const category = categoryById(card.dataset.categoryId, state.schema);
  const modeField = relatedPersonModeField(category);
  if (modeField) {
    values[modeField.id] =
      card.dataset.relatedPersonMode === "existing" ? "existing" : "manual";
  }
  return values;
}

function updateConditionalVisibility() {
  if (!state.schema || elements.recordForm.hidden) {
    return;
  }
  refreshAllDependentOptions(true);
  const values = mainValues();
  elements.recordForm
    .querySelectorAll("[data-main-category]")
    .forEach((section) => {
      section.hidden = !targetVisible(
        "category",
        section.dataset.mainCategory,
        values,
      );
    });
  elements.recordForm
    .querySelectorAll("[data-related-category]")
    .forEach((section) => {
      section.hidden = !targetVisible(
        "category",
        section.dataset.relatedCategory,
        values,
      );
    });
  elements.recordForm
    .querySelectorAll("[data-field-wrapper]")
    .forEach((wrapper) => {
      const control = wrapper.querySelector("[data-value-control]");
      const card = wrapper.closest(".related-card");
      wrapper.hidden = !targetVisible(
        "field",
        wrapper.dataset.fieldWrapper,
        values,
        card ? cardValues(card) : null,
      );
      if (control?.dataset.scope === "related" && card) {
        wrapper.hidden =
          wrapper.hidden || card.closest("[data-related-category]").hidden;
      }
    });

  selectMainCategoryTab(elements.mainSections.dataset.activeMainCategory);
  syncEntryCategoryNavigatorVisibility();
  scheduleCategoryObservation();
}

function eligibleSearchFields(schema = state.schema) {
  return allFields(schema).filter(
    ({ field }) => field.type !== "file",
  );
}

function defaultSearchFieldIds(schema = state.schema) {
  return eligibleSearchFields(schema)
    .filter(({ field }) => field.searchable)
    .map(({ field }) => field.id);
}

function sameFieldSelection(first, second) {
  if (first.length !== second.length) {
    return false;
  }
  const expected = new Set(second);
  return first.every((fieldId) => expected.has(fieldId));
}

function activeSearchFieldIds(schema = state.schema) {
  const eligible = new Set(
    eligibleSearchFields(schema).map(({ field }) => field.id),
  );
  const selected = Array.isArray(state.searchFieldIds)
    ? state.searchFieldIds
    : defaultSearchFieldIds(schema);
  return selected.filter((fieldId) => eligible.has(fieldId));
}

function updateSearchFieldChooserLabel() {
  const count = activeSearchFieldIds().length;
  const description = Array.isArray(
    state.searchFieldIds,
  )
    ? `حقول البحث: مخصصة (${count})`
    : count
      ? `حقول البحث: الافتراضية (${count})`
      : "حقول البحث: لا يوجد افتراضي";
  elements.chooseSearchFieldsText.textContent = description;
  elements.chooseSearchFieldsButton.title = description;
  elements.chooseSearchFieldsButton.setAttribute("aria-label", description);
}

function toggleSearchPanel() {
  const collapsed = elements.searchPanel.dataset.collapsed !== "true";
  elements.searchPanel.dataset.collapsed = String(collapsed);
  elements.searchPanel
    .querySelector("[data-collapse-search-panel]")
    ?.setAttribute("aria-expanded", String(!collapsed));
}

function currentSearchControlValues() {
  const values = {};
  elements.searchFields
    .querySelectorAll("[data-value-control]")
    .forEach((control) => {
      values[control.dataset.fieldId] = controlValue(control);
    });
  return values;
}

function resetSearchResultDisplay() {
  state.searchMatches = [];
  state.searchResultIndex = 0;
  state.searchResultsTruncated = false;
  elements.searchResults.replaceChildren();
  elements.searchResultPager.hidden = true;
  elements.searchSummary.textContent =
    "أدخل معيارًا واحدًا أو أكثر ثم اضغط بحث.";
}

function renderSearchFields(options = {}) {
  const previousValues =
    options.preserveValues === false ? {} : currentSearchControlValues();
  elements.searchFields.replaceChildren();
  const eligible = eligibleSearchFields();
  const selectedIds = activeSearchFieldIds();
  const selected = new Set(selectedIds);
  elements.searchPanel.hidden = !hasConfiguredFields();
  elements.searchFieldsEmpty.hidden = selectedIds.length !== 0;
  elements.entrySearchRecordId.closest(".field").hidden = !state.entrySearchRecordIdEnabled;
  for (const { category, field } of eligible) {
    if (!selected.has(field.id)) {
      continue;
    }
    const wrapper = createFieldElement(field, "search", category.id);
    const label = wrapper.querySelector("label");
    label.textContent = field.label;
    elements.searchFields.append(wrapper);
    if (Object.prototype.hasOwnProperty.call(previousValues, field.id)) {
      setControlValue(
        wrapper.querySelector("[data-value-control]"),
        previousValues[field.id],
      );
    }
  }
  updateSearchFieldChooserLabel();
  elements.searchButton.disabled =
    state.searching ||
    state.savingRecord ||
    state.loadingRecord;
}

function renderSearchFieldOptions() {
  elements.searchFieldOptions.replaceChildren();
  const selectedFields = new Set(activeSearchFieldIds());
  const systemGroup = document.createElement("details");
  systemGroup.className = "search-field-option-group tree-option-group";
  systemGroup.open = false;
  const systemTitle = document.createElement("summary");
  const systemTitleLabel = document.createElement("label");
  systemTitleLabel.className = "check-field";
  const systemMaster = document.createElement("input");
  systemMaster.type = "checkbox";
  systemMaster.dataset.entrySearchCategory = "system";
  systemTitleLabel.append(systemMaster, document.createTextNode("بيانات السجل"));
  systemTitle.append(systemTitleLabel);
  const systemGrid = document.createElement("div");
  systemGrid.className = "search-field-option-grid";
  [["record_id", "ID"]].forEach(([id, text]) => {
    const label = document.createElement("label");
    label.className = "check-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.systemSearchOption = id;
    input.checked = state.entrySearchRecordIdEnabled !== false;
    label.append(input, document.createTextNode(text));
    systemGrid.append(label);
  });
  systemGroup.append(systemTitle, systemGrid);
  elements.searchFieldOptions.append(systemGroup);
  for (const category of allCategories(state.schema)) {
    const fields = category.fields.filter(
      (field) =>
        field.type !== "file" &&
        field.type !== "system_record_code",
    );
    if (!fields.length) {
      continue;
    }
    const group = document.createElement("details");
    group.className = "search-field-option-group tree-option-group";
    group.open = false;
    const title = document.createElement("summary");
    const titleLabel = document.createElement("label");
    titleLabel.className = "check-field";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.dataset.entrySearchCategory = category.id;
    titleLabel.append(master, document.createTextNode(category.label));
    title.append(titleLabel);
    const grid = document.createElement("div");
    grid.className = "search-field-option-grid";
    for (const field of fields) {
      const option = document.createElement("label");
      option.className = "check-field";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.searchFieldOption = field.id;
      checkbox.checked = selectedFields.has(field.id);
      const label = document.createElement("span");
      label.textContent = field.searchable
        ? `${field.label} — افتراضي`
        : field.label;
      option.append(checkbox, label);
      grid.append(option);
    }
    group.append(title, grid);
    elements.searchFieldOptions.append(group);
  }
  elements.searchFieldOptions.querySelectorAll(".search-field-option-group").forEach((group) => {
    const master = group.querySelector("[data-entry-search-category]");
    const choices = [...group.querySelectorAll('.search-field-option-grid input[type="checkbox"]')];
    const checked = choices.filter((choice) => choice.checked).length;
    if (master) {
      master.checked = choices.length > 0 && checked === choices.length;
      master.indeterminate = checked > 0 && checked < choices.length;
    }
  });
}

function handleEntrySearchCategorySelection(event) {
  const group = event.target.closest(".search-field-option-group");
  if (!group) return;
  const master = group.querySelector("[data-entry-search-category]");
  const fields = [...group.querySelectorAll('.search-field-option-grid input[type="checkbox"]')];
  if (event.target === master) {
    fields.forEach((field) => { field.checked = master.checked; });
    master.indeterminate = false;
    return;
  }
  if (!fields.includes(event.target)) return;
  const selected = fields.filter((field) => field.checked).length;
  master.checked = selected === fields.length;
  master.indeterminate = selected > 0 && selected < fields.length;
}

function openSearchFieldsDialog() {
  renderSearchFieldOptions();
  elements.searchFieldsDialog.showModal();
}

elements.searchFieldOptions?.addEventListener("change", handleEntrySearchCategorySelection);

function applyTemporarySearchFields() {
  const selected = [
    ...elements.searchFieldOptions.querySelectorAll(
      "[data-search-field-option]:checked",
    ),
  ].map((checkbox) => checkbox.dataset.searchFieldOption);
  const recordIdEnabled = Boolean(elements.searchFieldOptions.querySelector('[data-system-search-option="record_id"]')?.checked);
  if (!selected.length && !recordIdEnabled) {
    showToast("اختر حقل بحث واحدًا على الأقل.", "error");
    return;
  }
  const defaults = defaultSearchFieldIds();
  state.searchFieldIds = sameFieldSelection(selected, defaults)
    ? null
    : selected;
  state.entrySearchRecordIdEnabled = recordIdEnabled;
  renderSearchFields();
  resetSearchResultDisplay();
  elements.searchFieldsDialog.close();
}

function resetTemporarySearchFields() {
  state.searchFieldIds = null;
  state.entrySearchRecordIdEnabled = true;
  renderSearchFields();
  resetSearchResultDisplay();
  elements.searchFieldsDialog.close();
}

function searchValues() {
  const criteria = {
    _include_archived: elements.includeArchivedSearch.checked,
    _search_field_ids: activeSearchFieldIds(),
    _record_code: state.entrySearchRecordIdEnabled ? elements.entrySearchRecordId.value.trim() : "",
  };
  elements.searchFields
    .querySelectorAll("[data-value-control]")
    .forEach((control) => {
      criteria[control.dataset.fieldId] = controlValue(control);
    });
  return criteria;
}

function clearSearch() {
  elements.searchFields
    .querySelectorAll("[data-value-control]")
    .forEach((control) => {
      setControlValue(control, "");
    });
  elements.includeArchivedSearch.checked = false;
  elements.entrySearchRecordId.value = "";
  resetSearchResultDisplay();
}

function setSearching(searching) {
  state.searching = searching;
  elements.searchButton.disabled =
    searching ||
    state.savingRecord ||
    state.loadingRecord;
  elements.clearSearchButton.disabled = searching;
  elements.searchSpinner.hidden = !searching;
  elements.searchButton.querySelector("svg").hidden = searching;
  elements.searchButtonText.textContent = searching ? "جاري البحث…" : "بحث";
  const label = searching ? "جاري البحث…" : "بحث";
  elements.searchButton.title = label;
  elements.searchButton.setAttribute("aria-label", label);
}

function renderCurrentSearchResult() {
  elements.searchResults.replaceChildren();
  const matches = state.searchMatches;
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = `لم يُعثر على ${entityName()} يطابق معايير البحث.`;
    elements.searchResults.append(empty);
    elements.searchSummary.textContent = "لا توجد نتائج";
    elements.searchResultPager.hidden = true;
    return;
  }
  state.searchResultIndex = Math.max(
    0,
    Math.min(state.searchResultIndex, matches.length - 1),
  );
  elements.searchSummary.textContent = state.searchResultsTruncated
    ? `ظهرت أول ${matches.length} نتيجة. أضف معيارًا آخر لتضييق البحث.`
    : `عدد النتائج: ${matches.length}`;
  const match = matches[state.searchResultIndex];
  const card = document.createElement("article");
  card.className = "search-result-card";
  card.dataset.searchRecordCode = match.record_code;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "search-result-open";
  open.dataset.openSearchRecord = match.record_code;
  const title = document.createElement("span");
  title.className = "search-result-name";
  title.textContent = match.title || match.record_code;
  open.append(title);
  if (match.archived) {
    const archivedBadge = document.createElement("span");
    archivedBadge.className = "archived-badge";
    archivedBadge.textContent = "مؤرشف";
    open.append(archivedBadge);
  }
  (match.details || []).forEach((detail) => {
    if (String(detail.value ?? "").trim() === "") {
      return;
    }
    const line = document.createElement("span");
    line.className = "search-result-detail";
    line.textContent = `${detail.label}: ${detail.value}`;
    open.append(line);
  });
  const copyId = document.createElement("button");
  copyId.type = "button";
  copyId.className = "search-result-id";
  copyId.dataset.copyRecordCode = match.record_code;
  copyId.dir = "ltr";
  copyId.title = "نسخ ID";
  copyId.textContent = match.record_code;
  const readonly = document.createElement("button");
  readonly.type = "button";
  readonly.className = "search-result-readonly";
  readonly.dataset.readonlyRecord = match.record_code;
  readonly.title = "فتح للقراءة فقط";
  readonly.setAttribute("aria-label", "فتح السجل للقراءة فقط");
  const readonlyIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  readonlyIcon.setAttribute("aria-hidden", "true");
  readonlyIcon.setAttribute("class", "action-icon");
  const readonlyUse = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "use",
  );
  readonlyUse.setAttribute("href", "#icon-open");
  readonlyIcon.append(readonlyUse);
  readonly.append(readonlyIcon);
  const footer = document.createElement("div");
  footer.className = "search-result-footer";
  footer.append(copyId, readonly);
  card.append(open, footer);
  if (match.record_code === state.selectedRecordCode) {
    card.classList.add("search-result-card-selected");
  }
  elements.searchResults.append(card);
  elements.searchResultPager.hidden = matches.length <= 1;
  elements.searchResultPosition.textContent = `${state.searchResultIndex + 1} / ${matches.length}`;
  elements.previousSearchResult.disabled = state.searchResultIndex === 0;
  elements.nextSearchResult.disabled =
    state.searchResultIndex === matches.length - 1;
}

function renderSearchResults(result) {
  state.searchMatches = Array.isArray(result.matches) ? result.matches : [];
  state.searchResultIndex = 0;
  state.searchResultsTruncated = Boolean(result.truncated);
  renderCurrentSearchResult();
}

function moveSearchResult(offset) {
  state.searchResultIndex += offset;
  renderCurrentSearchResult();
}

async function copyRecordCode(code) {
  try {
    await navigator.clipboard.writeText(code);
  } catch (_error) {
    const helper = document.createElement("textarea");
    helper.value = code;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  showToast(`تم نسخ ID: ${code}`);
}

async function searchRecords() {
  if (state.searching || state.savingRecord || state.loadingRecord) {
    return;
  }
  const criteria = searchValues();
  const hasCriteria = Object.entries(criteria).some(
    ([key, value]) =>
      ![
        "_include_archived",
        "_search_field_ids",
      ].includes(key) &&
      (Array.isArray(value)
        ? value.length > 0
        : String(value ?? "").trim() !== ""),
  );
  if (!hasCriteria) {
    showToast("أدخل معيار بحث واحدًا على الأقل.", "error");
    return;
  }
  setSearching(true);
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(criteria),
    });
    renderSearchResults(await responseJson(response));
  } catch (error) {
    reportClientError("record-search", error);

    showToast(error.message, "error");
  } finally {
    setSearching(false);
  }
}

function clearSelectedSearchCard() {
  elements.searchResults
    .querySelectorAll(".search-result-card-selected")
    .forEach((card) => card.classList.remove("search-result-card-selected"));
}

function markSelectedSearchCard(code) {
  clearSelectedSearchCard();
  elements.searchResults
    .querySelector(`[data-search-record-code="${attributeSafe(code)}"]`)
    ?.classList.add("search-result-card-selected");
}
function populateControlsInDependencyOrder(controls, values) {
  const ordinaryControls = [];
  const dependentControls = [];

  controls.forEach((control) => {
    const field = fieldById(control.dataset.fieldId, state.schema);

    if (field?.option_filter) {
      dependentControls.push(control);
    } else {
      ordinaryControls.push(control);
    }
  });

  ordinaryControls.forEach((control) => {
    setControlValue(control, values[control.dataset.fieldId] ?? "");
  });

  refreshAllDependentOptions(false);

  dependentControls.forEach((control) => {
    refreshDependentControl(control, false);
    setControlValue(control, values[control.dataset.fieldId] ?? "");
  });
}
function populateMain(values) {
  const controls = [
    ...elements.recordForm.querySelectorAll(
      '[data-value-control][data-scope="main"]',
    ),
  ];

  populateControlsInDependencyOrder(controls, values);
}

function populateRelated(related) {
  [...document.querySelectorAll('[data-related-records][data-parent-child-id=""]')]
    .forEach((records) => records.replaceChildren());
  const repeatable = state.schema.categories
    .filter((candidate) => candidate.kind === "repeatable")
    .sort((first, second) => {
      const depth = (category) => {
        let result = 0;
        let current = category;
        const seen = new Set();
        while (current?.parent_category_id && !seen.has(current.id)) {
          seen.add(current.id);
          current = categoryById(current.parent_category_id, state.schema);
          result += 1;
        }
        return result;
      };
      return depth(first) - depth(second);
    });
  for (const category of repeatable) {
    const rows = Array.isArray(related[category.id])
      ? related[category.id]
      : [];
    rows.forEach((row) => addRelatedCard(category.id, row, {
      parentChildId: row.parent_child_id || "",
    }));
    if (category.auto_start) {
      [...document.querySelectorAll(
        `[data-related-records="${attributeSafe(category.id)}"]`,
      )].forEach((records) => {
        if (!directRelatedCards(records).length) {
          addRelatedCard(category.id, null, {
            markDirty: false,
            parentChildId: records.dataset.parentChildId || "",
          });
        }
      });
    }
  }
}

function attachmentApiUrl(path) {
  const url = new URL(
    `/api/${encodeURI(String(path || "")).replace(/%2F/gi, "/")}`,
    window.location.href,
  );
  if (state.activeSchemaId) {
    url.searchParams.set("schema_id", state.activeSchemaId);
  }
  return `${url.pathname}${url.search}`;
}

function attachmentViewerUrl(path) {
  const source = attachmentApiUrl(path);
  return `/attachment-viewer.html?source=${encodeURIComponent(source)}`;
}

function isImageAttachment(path) {
  return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(storedFilename(path));
}

function renderAttachmentGallery() {
  elements.attachmentGalleryGrid.replaceChildren();
  if (!state.selectedRecordCode) {
    elements.attachmentGallery.hidden = true;
    return;
  }
  const controls = [
    ...elements.recordForm.querySelectorAll("[data-value-control]"),
  ].filter((control) => {
    const field = fieldById(control.dataset.fieldId, state.schema);
    return field?.type === "file" && control.value;
  });
  elements.attachmentGallery.hidden = controls.length === 0;

  for (const control of controls) {
    const field = fieldById(control.dataset.fieldId, state.schema);
    const category = categoryById(control.dataset.categoryId, state.schema);
    const card = control.closest(".related-card");
    const link = document.createElement("a");
    link.className = "gallery-card";
    link._attachmentHoverCard = () => attachmentHoverDetails(control);
    link.href = isImageAttachment(control.value)
      ? attachmentViewerUrl(control.value)
      : attachmentApiUrl(control.value);
    link.target = "_blank";
    link.rel = "noopener";

    if (isImageAttachment(control.value)) {
      const image = document.createElement("img");
      image.className = "gallery-preview";
      image.src = attachmentApiUrl(control.value);
      image.alt = `${category?.label || ""} — ${field?.label || ""}`;
      image.loading = "lazy";
      link.append(image);
    } else {
      const icon = document.createElement("div");
      icon.className = "gallery-file-icon";
      icon.textContent = /\.pdf$/i.test(control.value) ? "PDF" : "FILE";
      link.append(icon);
    }
    const body = document.createElement("div");
    body.className = "gallery-card-body";
    const title = document.createElement("strong");
    title.textContent = field?.label || storedFilename(control.value);
    const detail = document.createElement("span");
    detail.textContent = category?.label || "";
    const filename = document.createElement("span");
    filename.textContent = storedFilename(control.value);
    body.append(title, detail, filename);
    link.append(body);
    elements.attachmentGalleryGrid.append(link);
  }
}
function formatRecordTimestamp(value) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function displayRecordMetadata(record = null) {
  state.currentRecordMetadata = {
    record_code:
      record?.record_code || elements.recordCode.value || "",
    created_at: record?.created_at || "",
    updated_at: record?.updated_at || "",
  };
  refreshSystemFieldControls();
  if (state.mode === "entry" || state.mode === "readonly") {
    updateHeaderContext(state.mode);
  }
}
function loadRecord(code, options = {}) {
  if (state.recordDirty && !options.force && !options.skipNavigationGuard) {
    queueRecordNavigation(() => {
      void performLoadRecord(code, {
        ...options,
        skipNavigationGuard: true,
      });
    });
    return Promise.resolve(false);
  }
  return performLoadRecord(code, options);
}

function recentRecordTitle(record) {
  const mainFields = (state.schema?.categories || [])
    .filter((category) => category.kind === "main")
    .flatMap((category) => category.fields || []);
  const titleFields = mainFields.filter(
    (field) => field.result_title && String(record.main?.[field.id] ?? "").trim(),
  );
  const fallbackField = mainFields.find(
    (field) =>
      !isSystemField(field) &&
      field.type !== "file" &&
      String(record.main?.[field.id] ?? "").trim(),
  );
  const fields = titleFields.length ? titleFields : (fallbackField ? [fallbackField] : []);
  return fields.map((field) => {
    const raw = record.main?.[field.id];
    return ["select", "yes_no"].includes(field.type)
      ? optionLabelForValue(field, raw)
      : String(raw ?? "").trim();
  }).filter(Boolean).join(" ");
}

async function performLoadRecord(code, options = {}) {
  if (state.loadingRecord || (state.savingRecord && !options.force)) {
    return false;
  }
  state.loadingRecord = true;
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    const record = await responseJson(response);
    state.suppressReset = true;
    elements.recordForm.reset();
    state.suppressReset = false;
    state.selectedRecordCode = record.record_code;
    state.currentRecordArchived = Boolean(record.archived);
    elements.recordCode.value = record.record_code;
    displayRecordMetadata(record);
    renderEntryForm();
    populateMain(record.main);
    state.loadedMainValues = deepClone(record.main || {});
    populateRelated(record.related);
    updateConditionalVisibility();
    renderAttachmentGallery();
    updateRecordButtonLabels();
    markSelectedSearchCard(record.record_code);
    rememberRecentRecord({
      record_code: record.record_code,
      title: options.title || recentRecordTitle(record),
    });
    if (!options.silent) {
      showToast(`تم اختيار ${entityName()}: ${record.record_code}`);
    }
    if (options.scroll !== false) {
      resetPageScroll(false);
    }
    clearLocalDraft();
    state.recordDirty = false;
    renderAllSchemaTabs();
    if (state.mode === "entry") {
      updateHeaderContext("entry");
    }
    return true;
  } catch (error) {
    reportClientError("record-load", error, `record_code=${code}`);

    showToast(error.message, "error");
    return false;
  } finally {
    state.loadingRecord = false;
  }
}

async function controlPayloadValue(control) {
  const field = fieldById(control.dataset.fieldId, state.schema);
  if (field?.type !== "file") {
    return controlValue(control);
  }
  const payload = { stored_path: control.value || "" };
  if (control._selectedFile) {
    payload.upload = {
      name: control._uploadName || control._selectedFile.name,
      data: await readFileAsBase64(control._selectedFile),
    };
  }
  return payload;
}

async function collectMainPayload() {
  const values = {};
  for (const control of elements.recordForm.querySelectorAll(
    '[data-value-control][data-scope="main"]',
  )) {
    if (isSystemField(fieldById(control.dataset.fieldId, state.schema))) {
      continue;
    }
    values[control.dataset.fieldId] = await controlPayloadValue(control);
  }
  return values;
}

async function collectRelatedPayload() {
  const related = {};
  for (const category of state.schema.categories.filter(
    (candidate) => candidate.kind === "repeatable",
  )) {
    const rows = [];
    for (const records of document.querySelectorAll(
      `[data-related-records="${attributeSafe(category.id)}"]`,
    )) {
      for (const card of directRelatedCards(records)) {
        const values = {};
        for (const control of directCardControls(card)) {
          values[control.dataset.fieldId] = await controlPayloadValue(control);
        }
        rows.push({
          _child_id: card.dataset.childId || "",
          _client_generated: card.dataset.clientGenerated === "true",
          parent_child_id: card.dataset.parentChildId || "",
          linked_record_code: card.dataset.linkedRecordCode || "",
          values,
        });
      }
    }
    related[category.id] = rows;
  }
  return related;
}

function setRecordSaving(saving) {
  state.savingRecord = saving;
  elements.saveRecordButton.disabled = saving;
  elements.resetFormButton.disabled = saving;
  elements.deleteRecordButton.disabled = saving;
  elements.archiveRecordButton.disabled = saving;
  elements.searchButton.disabled =
    saving || state.searching || state.loadingRecord;
  elements.saveSpinner.hidden = !saving;
  updateRecordButtonLabels();
}

function updateRecordButtonLabels() {
  const singular = entityName();
  const hasRecord = Boolean(state.selectedRecordCode);
  const builderUnlocked = Boolean(
    state.schema?.builder_access?.unlocked || state.schema?.developer_mode,
  );
  if (state.savingRecord) {
    elements.saveButtonText.textContent = "جاري الحفظ…";
  } else if (hasRecord) {
    elements.saveButtonText.textContent = "حفظ التعديلات";
  } else {
    elements.saveButtonText.textContent = `حفظ ${singular}`;
  }
  elements.archiveRecordButton.hidden = !hasRecord;
  elements.archiveButtonText.textContent = state.currentRecordArchived
    ? `استعادة ${singular}`
    : `أرشفة ${singular}`;
  elements.archiveRecordButton.classList.toggle(
    "button-restore",
    state.currentRecordArchived,
  );
  elements.deleteRecordButton.hidden = !hasRecord || !builderUnlocked;
  elements.deleteButtonText.textContent = `حذف ${singular} نهائيًا`;
  elements.resetButtonText.textContent = `${singular} جديد`;
  elements.saveNote.hidden = !state.currentRecordArchived;
  elements.saveNote.textContent = state.currentRecordArchived
    ? "هذا السجل مؤرشف، ويمكن تعديله أو استعادته."
    : "يمكن الحفظ في أي وقت ما لم تُعرَّف حقول مطلوبة.";
}

function draftValue(control) {
  const field = fieldById(control.dataset.fieldId, state.schema);

  if (field?.type === "file") {
    // Preserve only an already-saved attachment path.
    // Browser security does not permit restoring a newly selected file.
    return control.value || "";
  }

  return controlValue(control);
}

function valueHasDraftContent(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return String(value ?? "").trim() !== "";
}

function collectDraftSnapshot() {
  const main = {};

  elements.recordForm
    .querySelectorAll('[data-value-control][data-scope="main"]')
    .forEach((control) => {
      if (isSystemField(fieldById(control.dataset.fieldId, state.schema))) {
        return;
      }
      main[control.dataset.fieldId] = draftValue(control);
    });

  const related = {};

  for (const category of state.schema.categories.filter(
    (candidate) => candidate.kind === "repeatable",
  )) {
    const rows = [];

    for (const records of document.querySelectorAll(
      `[data-related-records="${attributeSafe(category.id)}"]`,
    )) {
      for (const card of directRelatedCards(records)) {
        const values = {};

        directCardControls(card).forEach((control) => {
          values[control.dataset.fieldId] = draftValue(control);
        });

        rows.push({
          _child_id: card.dataset.childId || "",
          _client_generated: card.dataset.clientGenerated === "true",
          parent_child_id: card.dataset.parentChildId || "",
          linked_record_code:
            directCardControls(card, "[data-linked-record-code]")[0]?.value.trim() || "",
          related_person_mode: card.dataset.relatedPersonMode || "manual",
          values,
        });
      }
    }

    related[category.id] = rows;
  }

  return {
    version: 1,
    schema_revision: state.schema?.revision ?? null,
    saved_at: new Date().toISOString(),
    selected_record_code: state.selectedRecordCode,
    current_record_archived: state.currentRecordArchived,
    current_record_metadata: deepClone(state.currentRecordMetadata),
    record_code: elements.recordCode.value,
    main,
    related,
  };
}

function draftHasContent(draft) {
  const mainHasContent = Object.entries(draft.main || {}).some(([fieldId, value]) => {
    const field = fieldById(fieldId, state.schema);
    if (
      field?.type === "user_name" &&
      String(value || "").trim() === String(state.auditUsers?.current_user || "").trim()
    ) {
      return false;
    }
    return valueHasDraftContent(value);
  });

  if (mainHasContent) {
    return true;
  }

  return Object.values(draft.related || {}).some(
    (rows) =>
      Array.isArray(rows) &&
      rows.some((row) => {
        const hasValue = Object.values(row.values || {}).some(
          valueHasDraftContent,
        );

        return hasValue || Boolean(row.linked_record_code);
      }),
  );
}

function updateDraftStatus(message) {
  if (elements.draftStatus) {
    elements.draftStatus.textContent = message;
  }
}

function clearLocalDraft() {
  try {
    localStorage.removeItem(schemaStorageKey(DRAFT_STORAGE_KEY));
  } catch (_error) {
    // Ignore unavailable browser storage.
  }

  window.clearTimeout(state.draftDebounceTimer);
  state.draftDebounceTimer = null;
  state.recordDirty = false;
  renderAllSchemaTabs();

  updateDraftStatus("لا توجد مسودة محلية.");
  if (state.mode === "entry") {
    updateHeaderContext("entry");
  }
}

function saveDraftLocally() {
  if (
    state.pendingSchemaViews ||
    !state.schema ||
    !state.recordDirty ||
    state.restoringDraft ||
    state.schema.app?.draft_autosave === false
  ) {
    return;
  }

  const draft = collectDraftSnapshot();

  if (!draftHasContent(draft)) {
    clearLocalDraft();
    return;
  }

  try {
    localStorage.setItem(schemaStorageKey(DRAFT_STORAGE_KEY), JSON.stringify(draft));

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    updateDraftStatus(`حُفظت المسودة محليًا عند ${time}.`);
  } catch (_error) {
    updateDraftStatus("تعذّر حفظ المسودة محليًا.");
  }
}

function scheduleDraftSave() {
  if (state.restoringDraft) {
    return;
  }

  if (!state.selectedRecordCode && !draftHasContent(collectDraftSnapshot())) {
    state.recordDirty = false;
    updateDraftStatus("لا توجد مسودة محلية.");
    renderAllSchemaTabs();
    if (state.mode === "entry") updateHeaderContext("entry");
    return;
  }

  state.recordDirty = true;
  renderAllSchemaTabs();
  if (state.mode === "entry") {
    updateHeaderContext("entry");
  }

  if (state.schema?.app?.draft_autosave === false) {
    updateDraftStatus("توجد تغييرات غير محفوظة.");
    return;
  }

  window.clearTimeout(state.draftDebounceTimer);

  state.draftDebounceTimer = window.setTimeout(
    saveDraftLocally,
    DRAFT_INPUT_DELAY_MS,
  );

  updateDraftStatus("توجد تغييرات غير محفوظة.");
}

function readLocalDraft() {
  try {
    const raw = localStorage.getItem(schemaStorageKey(DRAFT_STORAGE_KEY));

    if (!raw) {
      return null;
    }

    const draft = JSON.parse(raw);

    if (!draft || draft.version !== 1) {
      return null;
    }

    return draft;
  } catch (_error) {
    return null;
  }
}

function restoreDraftSnapshot(draft, options = {}) {
  if (!draft || !state.schema) {
    return;
  }

  if (
    draft.schema_revision !== null &&
    state.schema.revision !== undefined &&
    draft.schema_revision !== state.schema.revision
  ) {
    updateDraftStatus("توجد مسودة قديمة لا تطابق تصميم التطبيق الحالي.");
    return;
  }

  state.restoringDraft = true;

  try {
    state.selectedRecordCode = draft.selected_record_code || null;

    state.currentRecordArchived = Boolean(draft.current_record_archived);

    elements.recordCode.value = draft.record_code || generateRecordCode();
    displayRecordMetadata(draft.current_record_metadata || null);

    renderEntryForm();
    populateMain(draft.main || {});
    populateRelated(draft.related || {});
    updateConditionalVisibility();
    renderAttachmentGallery();
    updateRecordButtonLabels();

    state.recordDirty = true;
    renderAllSchemaTabs();

    const savedTime = draft.saved_at
      ? new Date(draft.saved_at).toLocaleString()
      : "";

    updateDraftStatus(
      savedTime
        ? `تمت استعادة مسودة محفوظة في ${savedTime}.`
        : "تمت استعادة مسودة غير محفوظة.",
    );

    if (options.notify !== false) {
      showToast("تمت استعادة آخر مسودة غير محفوظة.");
    }
  } finally {
    state.restoringDraft = false;
  }
}

function restoreLocalDraft() {
  if (state.skipNextLocalDraftRestore) {
    state.skipNextLocalDraftRestore = false;
    return;
  }
  restoreDraftSnapshot(readLocalDraft());
}
async function saveCurrentRecord() {
  if (state.savingRecord || !state.schema || !hasConfiguredFields()) {
    return false;
  }
  if (!(await validateRelatedPersonCardsBeforeSave())) {
    return false;
  }
  const invalidControl = [
    ...elements.recordForm.querySelectorAll("[data-value-control]"),
  ].find((control) => !validateEntryControl(control, false));

  if (invalidControl) {
    expandEntryCategoryForControl(invalidControl);
    validateEntryControl(invalidControl, true);
    invalidControl.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    // Inline errors identify invalid fields without moving focus.
    return false;
  }
  const creatingRecord = !state.selectedRecordCode;
  const submittedMain = await collectMainPayload();
  const changedGlobalRefs = [];
  if (!creatingRecord) {
    for (const category of state.schema.categories.filter((item) => item.kind === "main")) {
      for (const field of category.fields) {
        if (field.global_ref && JSON.stringify(submittedMain[field.id]) !== JSON.stringify(state.loadedMainValues[field.id])) {
          changedGlobalRefs.push(field.global_ref);
        }
      }
    }
  }
  const propagateGlobalValues = changedGlobalRefs.length
    ? await requestConfirmation(
        "تغيّرت قيمة حقل ذي تعريف عام. هل تريد نسخ القيمة الجديدة إلى ملفات الشخص نفسه في التصاميم الأخرى؟",
        { title: "تحديث القيم العامة", confirmLabel: "نسخ القيمة", danger: false },
      )
    : false;
  setRecordSaving(true);
  try {
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: state.selectedRecordCode ? "update" : "create",
        record_code: elements.recordCode.value,
        client_generated_code: creatingRecord,
        expected_updated_at: state.selectedRecordCode
          ? state.currentRecordMetadata.updated_at
          : "",
        main: submittedMain,
        related: await collectRelatedPayload(),
        propagate_global_values: propagateGlobalValues,
        propagate_global_refs: changedGlobalRefs,
      }),
    });
    const result = await responseJson(response);
    if (creatingRecord && result.action === "created" && state.schema?.stats) {
      state.schema.stats.record_count =
        Number(state.schema.stats.record_count || 0) + 1;
    }
    state.selectedRecordCode = result.record_code;
    elements.recordCode.value = result.record_code;
    await loadRecord(result.record_code, {
      silent: true,
      scroll: false,
      force: true,
    });
    clearLocalDraft();
    updateRecordButtonLabels();
    showToast(
      result.action === "updated"
        ? `تم حفظ التعديلات. ID: ${result.record_code}`
        : `تم حفظ ${entityName()}. يمكنك تعديله مباشرةً. ID: ${result.record_code}`,
    );
    return true;
  } catch (error) {
    reportClientError("record-save", error);

    showToast(error.message, "error");
    return false;
  } finally {
    setRecordSaving(false);
  }
}

async function archiveCurrentRecord() {
  if (!state.selectedRecordCode || state.savingRecord) {
    return;
  }
  const wasArchived = state.currentRecordArchived;
  const archived = !wasArchived;
  const action = archived ? "أرشفة" : "استعادة";
  if (
    !(await requestConfirmation(
      `هل تريد ${action} ${entityName()} ${state.selectedRecordCode}؟`,
      { title: `${action} السجل`, confirmLabel: action },
    ))
  ) {
    return;
  }
  setRecordSaving(true);
  try {
    const response = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_code: state.selectedRecordCode,
        archived,
        expected_updated_at: state.currentRecordMetadata.updated_at,
      }),
    });
    const result = await responseJson(response);
    state.currentRecordArchived = Boolean(result.archived);
    state.currentRecordMetadata.updated_at = result.updated_at || "";
    if (state.schema?.archive_stats && wasArchived !== state.currentRecordArchived) {
      state.schema.archive_stats.archived_record_count = Math.max(
        0,
        Number(state.schema.archive_stats.archived_record_count || 0) +
          (state.currentRecordArchived ? 1 : -1),
      );
    }
    updateRecordButtonLabels();
    if (archived && !elements.includeArchivedSearch.checked) {
      state.searchMatches = state.searchMatches.filter(
        (match) => match.record_code !== state.selectedRecordCode,
      );
      renderCurrentSearchResult();
    } else {
      const match = state.searchMatches.find(
        (candidate) => candidate.record_code === state.selectedRecordCode,
      );
      if (match) {
        match.archived = archived;
        renderCurrentSearchResult();
      }
    }
    showToast(
      archived ? `تمت أرشفة ${entityName()}.` : `تمت استعادة ${entityName()}.`,
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setRecordSaving(false);
  }
}

async function deleteCurrentRecord() {
  if (!state.selectedRecordCode || state.savingRecord) {
    return;
  }
  const code = state.selectedRecordCode;
  const wasArchived = state.currentRecordArchived;
  if (
    !(await requestConfirmation(
      `هل تريد حذف ${entityName()} ${code} نهائيًا من جميع الجداول والملفات؟`,
      { title: "حذف السجل نهائيًا", confirmLabel: "حذف السجل" },
    ))
  ) {
    return;
  }
  setRecordSaving(true);
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(code)}`, {
      method: "DELETE",
    });
    const result = await responseJson(response);
    if (state.schema?.stats) {
      state.schema.stats.record_count = Math.max(
        0,
        Number(state.schema.stats.record_count || 0) - 1,
      );
    }
    if (wasArchived && state.schema?.archive_stats) {
      state.schema.archive_stats.archived_record_count = Math.max(
        0,
        Number(state.schema.archive_stats.archived_record_count || 0) - 1,
      );
    }
    state.searchMatches = state.searchMatches.filter(
      (match) => match.record_code !== code,
    );
    state.fullSearchMatches = state.fullSearchMatches.filter(
      (match) => match.record_code !== code,
    );
    removeRecentRecordHistory(code, state.activeSchemaId || "legacy");
    try { localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY); } catch (_error) { /* authoritative history is on disk */ }
    await loadSearchHistory().catch(() => {});
    renderCurrentSearchResult();
    renderFullSearchResults();
    newRecord();
    showToast(
      `تم حذف ${entityName()} و${result.deleted_related_rows} سجل مرتبط.`,
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setRecordSaving(false);
  }
}

function newRecord() {
  state.suppressReset = true;
  elements.recordForm.reset();
  state.suppressReset = false;
  state.selectedRecordCode = null;
  state.currentRecordArchived = false;
  elements.recordCode.value = generateRecordCode();
  displayRecordMetadata();
  state.loadedMainValues = {};
  renderEntryForm();
  renderAttachmentGallery();
  clearSelectedSearchCard();
  clearLocalDraft();
  updateRecordButtonLabels();
  resetPageScroll(false);
}

function requestNewRecord() {
  const open = () => {
    newRecord();
    showToast(`تم فتح ${entityName()} جديد.`);
  };
  const choose = () => {
    if (activeWorkspaceSchemas().length > 1) {
      elements.newProfileChoiceDialog.showModal();
    } else {
      open();
    }
  };
  if (state.recordDirty) queueRecordNavigation(choose);
  else choose();
}

function handleFormReset(event) {
  event?.preventDefault();
  if (state.suppressReset) {
    return;
  }
  requestNewRecord();
}
