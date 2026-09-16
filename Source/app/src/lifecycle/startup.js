"use strict";

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

function startupHeaders(extra = {}) {
  return {
    ...extra,
    "X-SchemaCraft-Startup": startupToken,
  };
}

function showError(message) {
  elements.error.textContent = message || "تعذّر تشغيل التطبيق.";
  elements.error.hidden = false;
  elements.continueButton.disabled = true;
  elements.continueButton.textContent = "تعذّر تجهيز مساحة العمل";
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "تعذّر الاتصال بالتطبيق.");
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
  elements.continueButton.disabled = false;
  elements.continueButton.textContent = "فتح مساحة العمل";
  window.setTimeout(() => elements.user.focus(), 30);
}

async function waitUntilReady() {
  if (!startupToken) {
    showError("رمز بدء التشغيل مفقود. أغلق هذه النافذة وشغّل SchemaCraft مجددًا.");
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
  const name = elements.user.value.trim();
  if (!name) {
    showError("اكتب اسم المستخدم.");
    elements.user.focus();
    return;
  }
  elements.error.hidden = true;
  elements.continueButton.disabled = true;
  try {
    const response = await fetch("/api/session/login", {
      method: "POST",
      credentials: "same-origin",
      headers: startupHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
    await responseJson(response);
    elements.continueButton.textContent = "جاري فتح التطبيق…";
    window.setTimeout(() => window.location.replace("/"), 160);
  } catch (error) {
    showError(error.message);
    elements.continueButton.disabled = false;
  }
});

void waitUntilReady();
