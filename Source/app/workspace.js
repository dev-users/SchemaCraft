"use strict";

// Shared shell helpers kept outside the legacy form engine.  New pages use
// this small boundary so routing, downloads, and number presentation can grow
// without adding more responsibilities to the data-entry renderer.
window.SchemaCraftWorkspace = Object.freeze({
  pages: Object.freeze([
    "home",
    "entry",
    "search",
    "exchange",
    "settings",
    "builder",
    "readonly",
  ]),

  startupIntent(location = window.location) {
    const parameters = new URLSearchParams(location.search || "");
    const readonlyCode = (parameters.get("record") || "").trim().toUpperCase();
    const editCode = (parameters.get("edit") || "").trim().toUpperCase();
    return {
      readonly: parameters.get("view") === "readonly" && Boolean(readonlyCode),
      readonlyCode,
      editCode,
      schemaId: (parameters.get("schema_id") || "").trim(),
    };
  },

  isTextNumber(field) {
    return (
      field?.type === "number" &&
      field?.number_behavior?.storage_mode === "text"
    );
  },

  rawNumber(value) {
    return String(value ?? "").replace(/[٬,]/g, "").trim();
  },

  formatNumber(value, field) {
    const raw = String(value ?? "").replace(/[٬,]/g, "").trim();
    if (!field?.number_behavior?.format_thousands || !raw) {
      return raw;
    }
    const match = raw.match(/^([+-]?)(\d+)(\.\d+)?$/);
    if (!match) {
      return raw;
    }
    const [, sign, integer, fraction = ""] = match;
    return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
  },

  async fileAsBase64(file) {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const block = 0x8000;
    for (let index = 0; index < bytes.length; index += block) {
      binary += String.fromCharCode(...bytes.subarray(index, index + block));
    }
    return window.btoa(binary);
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  responseFilename(response, fallback) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      try {
        return decodeURIComponent(encoded);
      } catch (_error) {
        return fallback;
      }
    }
    return fallback;
  },
});
