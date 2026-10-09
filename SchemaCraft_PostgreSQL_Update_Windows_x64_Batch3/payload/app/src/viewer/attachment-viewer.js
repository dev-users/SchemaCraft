(() => {
  "use strict";
const scText = window.SchemaCraftI18n?.t || ((source, ...values) =>
  Array.isArray(source) ? source.map((part, index) => part + (index < values.length ? String(values[index]) : '')).join('') : String(source));


  const status = document.getElementById("attachment-status");
  const frame = document.getElementById("attachment-frame");
  const image = document.getElementById("attachment-image");
  const caption = document.getElementById("attachment-caption");
  const source = new URLSearchParams(window.location.search).get("source") || "";

  let parsed;
  try {
    parsed = new URL(source, window.location.origin);
  } catch (_error) {
    parsed = null;
  }
  const safe = parsed
    && parsed.origin === window.location.origin
    && /^\/api\/attachments(?:\/|$)/.test(parsed.pathname);
  if (!safe) {
    status.textContent = scText("تعذّر فتح هذا المرفق.");
    return;
  }

  caption.textContent = decodeURIComponent(parsed.pathname.split("/").pop() || "");
  image.addEventListener("load", () => {
    status.hidden = true;
    frame.hidden = false;
  });
  image.addEventListener("error", () => {
    status.textContent = scText("تعذّر تحميل الصورة.");
  });
  image.src = `${parsed.pathname}${parsed.search}`;
})();
