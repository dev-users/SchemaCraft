"use strict";
const scText = window.SchemaCraftI18n?.t || ((source, ...values) =>
  Array.isArray(source) ? source.map((part, index) => part + (index < values.length ? String(values[index]) : '')).join('') : String(source));


const hash = new URLSearchParams(window.location.hash.slice(1));
const startupToken = hash.get("token") || "";
window.history.replaceState(null, "", window.location.pathname);

const elements = {
  login: document.getElementById("login-panel"),
  error: document.getElementById("startup-error"),
  user: document.getElementById("startup-user"),
  options: document.getElementById("startup-user-options"),
  continueButton: document.getElementById("startup-continue"),
};

let startupReady = false;
let loginPending = false;
let languagePending = Promise.resolve();
let languageRequests = 0;
let fatalStartupError = false;
function refreshLoginButton() {
  elements.continueButton.disabled = !startupReady || fatalStartupError || loginPending || languageRequests > 0;
  elements.continueButton.textContent = fatalStartupError ? scText("تعذّر تجهيز مساحة العمل")
    : loginPending ? scText("جاري فتح التطبيق…")
    : startupReady ? scText("فتح مساحة العمل") : scText("جاري تجهيز مساحة العمل…");
}
window.SchemaCraftI18n?.subscribe(refreshLoginButton);
window.SchemaCraftI18n?.wireToggle(document.getElementById('startup-language-switch'), (language) => {
  languageRequests += 1;
  refreshLoginButton();
  languagePending = window.SchemaCraftI18n.saveLanguage(language, startupHeaders()).catch(error => {
    elements.error.textContent = error.message;
    elements.error.hidden = false;
  }).finally(() => { languageRequests -= 1; refreshLoginButton(); });
});

function startupHeaders(extra = {}) {
  return {
    ...extra,
    "X-SchemaCraft-Startup": startupToken,
    "X-SchemaCraft-Language": window.SchemaCraftI18n?.language || "ar",
  };
}

function showError(message, fatal = true) {
  fatalStartupError = fatal;
  elements.error.textContent = message || scText("تعذّر تشغيل التطبيق.");
  elements.error.hidden = false;
  refreshLoginButton();
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || scText("تعذّر الاتصال بالتطبيق."));
  return body;
}

async function showLogin() {
  const response = await fetch("/api/session/bootstrap", {
    cache: "no-store",
    headers: startupHeaders(),
  });
  const result = await responseJson(response);
  elements.options.replaceChildren();
  (result.users || []).forEach((name) => elements.options.append(new Option(name)));
  startupReady = true;
  refreshLoginButton();
  window.setTimeout(() => elements.user.focus(), 30);
}

async function waitUntilReady() {
  if (!startupToken) {
    showError(scText("رمز بدء التشغيل مفقود. أغلق هذه النافذة وشغّل SchemaCraft مجددًا."));
    return;
  }
  try {
    const response = await fetch("/api/startup/status", {
      cache: "no-store",
      headers: startupHeaders(),
    });
    const status = await responseJson(response);
    if (status.error) {
      showError(status.error);
      return;
    }
    if (!status.ready) {
      window.setTimeout(waitUntilReady, 300);
      return;
    }
    await showLogin();
  } catch (error) {
    showError(error.message);
  }
}

elements.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!startupReady || loginPending) return;
  await languagePending;
  const name = elements.user.value.trim();
  if (!name) {
    showError(scText("اكتب اسم المستخدم."), false);
    elements.user.focus();
    return;
  }
  elements.error.hidden = true;
  loginPending = true;
  refreshLoginButton();
  try {
    const response = await fetch("/api/session/login", {
      method: "POST",
      credentials: "same-origin",
      headers: startupHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
    await responseJson(response);
    elements.continueButton.textContent = scText("جاري فتح التطبيق…");
    window.setTimeout(() => window.location.replace("/"), 160);
  } catch (error) {
    loginPending = false;
    showError(error.message, false);
  }
});

void waitUntilReady();
