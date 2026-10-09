"use strict";
const scText = window.SchemaCraftI18n?.t || ((source, ...values) =>
  Array.isArray(source) ? source.map((part, index) => part + (index < values.length ? String(values[index]) : '')).join('') : String(source));


window.setTimeout(() => window.close(), 2400);
