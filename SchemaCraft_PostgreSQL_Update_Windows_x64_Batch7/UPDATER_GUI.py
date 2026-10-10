#!/usr/bin/env python3
"""Offline graphical SchemaCraft update and verified PostgreSQL migration."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import subprocess
import sys

_SOURCE_DIRECTORY = str(Path(__file__).resolve().parent)
if _SOURCE_DIRECTORY not in sys.path:
    sys.path.insert(0, _SOURCE_DIRECTORY)

import threading
import tkinter as tk
from tkinter import filedialog, ttk

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:
    arabic_reshaper = None
    get_display = None


def ui_text(value: str) -> str:
    """Tk 8.6 needs presentation shaping for readable Arabic labels."""
    text = str(value)
    if arabic_reshaper is None or not any("\u0600" <= char <= "\u06ff" for char in text):
        return text
    return "\n".join(get_display(arabic_reshaper.reshape(line)) for line in text.split("\n"))


ARABIC_CHOICE = ui_text("العربية")


def package_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    source = Path(__file__).resolve().parent
    for candidate in (source, source.parent):
        if (candidate / "manifest.json").is_file():
            return candidate
    return source.parent


TEXT = {
    "en": {
        "title": "SchemaCraft · PostgreSQL Consolidation",
        "subtitle": "Verify your data, complete the PostgreSQL transition and clean the installed application.",
        "folder": "Existing SchemaCraft application folder",
        "browse": "Choose folder…",
        "closed": "I have saved my work and closed SchemaCraft and the workspace's Excel files.",
        "check": "1. Check data",
        "apply": "2. Update and clean up",
        "recover": "Recover interrupted update",
        "report": "Open report",
        "backup": "Open backup folder",
        "launch": "Open SchemaCraft",
        "save": "Save activity log…",
        "ready": "Ready to check your installation",
        "ready_detail": "Choose the application folder that contains your data folder. All checks and transfers run locally.",
        "steps": "Check → Stage → Verify PostgreSQL → Clean up → Activate and verify",
        "activity": "Update activity",
        "privacy": "The updater works offline. Company data stays on this computer.",
        "busy": "Please keep this window open until the current operation finishes.",
        "choose_title": "Choose the existing application",
        "choose_detail": "Select the installed SchemaCraft folder, containing its data folder. Do not select this update package or only the data folder.",
        "close_title": "Close SchemaCraft first",
        "close_detail": "Save your work and close SchemaCraft and Excel files from this workspace, then tick the confirmation box. The updater also checks for active workspace processes.",
        "apply_title": "Update this installation?",
        "apply_detail": "After verified PostgreSQL activation, this update removes identified legacy storage workbooks and existing recovery/update backups. Saved imports, exports, attachments and settings are preserved. Future backup features remain available. Temporary working copies are removed only after successful verification. Keep this window open until it finishes.",
        "recover_title": "Recover an interrupted update?",
        "recover_detail": "Recovery reads this installation's update journal and safely resolves an interrupted installation. It does not restore an old Excel copy over a completed PostgreSQL installation.",
        "continue": "Continue",
        "cancel": "Cancel",
        "ok": "OK",
        "verified": "Checks passed — ready to update",
        "completed": "Update complete — PostgreSQL is ready",
        "recovered": "Recovery completed",
        "blocked": "Update stopped — review the report",
        "error": "Operation stopped",
        "verified_detail": "Review the report, then choose Update and clean up. The update will repeat the required checks.",
        "completed_detail": "Your clean PostgreSQL application is ready. Existing recovery and update copies have been removed. The verification receipt is saved with your database; future backup features remain available.",
        "recovered_detail": "Review the recovery report before opening the application or retrying the update.",
        "blocked_detail": "No successful completion was reported. Review the issue details below and in the report before retrying.",
        "open_error": "Unable to open the selected item",
        "log_title": "Save updater activity log",
        "language": "Language / اللغة",
        "summary": "Results",
        "save_report": "Save report copy…",
    },
    "ar": {
        "title": "SchemaCraft · تحديث وتنظيف PostgreSQL",
        "subtitle": "التحقق من البيانات وإكمال الانتقال إلى PostgreSQL وتنظيف نسخة البرنامج.",
        "folder": "مجلد برنامج SchemaCraft الحالي",
        "browse": "اختيار المجلد…",
        "closed": "حفظت عملي وأغلقت SchemaCraft وملفات Excel التابعة لهذه النسخة.",
        "check": "١. التحقق من البيانات",
        "apply": "٢. التحديث والتنظيف",
        "recover": "استعادة تحديث متوقف",
        "report": "فتح تقرير التحقق",
        "backup": "فتح مجلد النسخة الاحتياطية",
        "launch": "فتح SchemaCraft",
        "save": "حفظ سجل العملية…",
        "ready": "جاهز للتحقق من النسخة الحالية",
        "ready_detail": "اختر مجلد البرنامج الذي يحتوي على مجلد data. تجري جميع العمليات محلياً.",
        "steps": "تحقق ← تجهيز ← تحقق من PostgreSQL ← تنظيف ← تفعيل وتحقق",
        "activity": "سجل عملية التحديث",
        "privacy": "يعمل التحديث دون اتصال بالإنترنت. تبقى بيانات الشركة على هذا الجهاز.",
        "busy": "يرجى إبقاء هذه النافذة مفتوحة حتى انتهاء العملية الجارية.",
        "choose_title": "اختيار مجلد البرنامج الحالي",
        "choose_detail": "اختر مجلد SchemaCraft المثبت الذي يحتوي على مجلد data، وليس مجلد حزمة التحديث أو مجلد البيانات وحده.",
        "close_title": "إغلاق SchemaCraft أولاً",
        "close_detail": "احفظ عملك وأغلق SchemaCraft وملفات Excel التابعة لهذه النسخة، ثم حدد مربع التأكيد. يتحقق التحديث أيضاً من العمليات الجارية.",
        "apply_title": "تحديث هذه النسخة؟",
        "apply_detail": "بعد التحقق من تفعيل PostgreSQL يحذف هذا التحديث ملفات Excel القديمة الخاصة بالتخزين ونسخ الاستعادة والتحديث الموجودة. يحتفظ بملفات الاستيراد والتصدير والمرفقات والإعدادات، وتبقى ميزات النسخ الاحتياطي المستقبلية متاحة. لا تحذف نسخ العمل المؤقتة إلا بعد نجاح التحقق. أبقِ هذه النافذة مفتوحة حتى انتهاء العملية.",
        "recover_title": "استعادة تحديث متوقف؟",
        "recover_detail": "تراجع الاستعادة سجل التحديث وتعالج التثبيت المتوقف. لا تستبدل قاعدة PostgreSQL المفعلة بملفات Excel القديمة بعد اكتمال الترحيل.",
        "continue": "متابعة",
        "cancel": "إلغاء",
        "ok": "موافق",
        "verified": "نجح التحقق — جاهز للتحديث",
        "completed": "اكتمل التحديث — PostgreSQL جاهزة",
        "recovered": "اكتملت الاستعادة",
        "blocked": "توقف التحديث — راجع التقرير",
        "error": "توقفت العملية",
        "verified_detail": "راجع التقرير ثم اضغط التحديث والتنظيف. يعيد التحديث إجراء عمليات التحقق المطلوبة.",
        "completed_detail": "أصبحت نسخة PostgreSQL المنظفة جاهزة وحذفت نسخ الاستعادة والتحديث الموجودة. حفظ تقرير التحقق مع قاعدة البيانات، وتبقى ميزات النسخ الاحتياطي المستقبلية متاحة.",
        "recovered_detail": "راجع تقرير الاستعادة قبل فتح البرنامج أو إعادة محاولة التحديث.",
        "blocked_detail": "لم تسجل العملية اكتمالاً ناجحاً. راجع التفاصيل والتقرير قبل إعادة المحاولة.",
        "open_error": "تعذر فتح العنصر المحدد",
        "log_title": "حفظ سجل عملية التحديث",
        "language": "Language / اللغة",
        "summary": "النتائج",
        "save_report": "حفظ نسخة من التقرير…",
    },
}

PHASES = {
    "cleanup": ("Verifying cleanup and removing existing recovery copies", "التحقق من التنظيف وحذف نسخ الاستعادة الموجودة"),
    "inspect": ("Checking the installation", "التحقق من النسخة الحالية"),
    "check": ("Checking the installation", "التحقق من النسخة الحالية"),
    "preflight": ("Verifying source data", "التحقق من البيانات الأصلية"),
    "backup": ("Creating temporary recovery copies", "إنشاء نسخ استعادة مؤقتة"),
    "stage": ("Preparing the updated application", "تجهيز البرنامج المحدث"),
    "install": ("Preparing the updated application", "تجهيز البرنامج المحدث"),
    "migration": ("Migrating and verifying data", "ترحيل البيانات والتحقق منها"),
    "migrate": ("Migrating and verifying data", "ترحيل البيانات والتحقق منها"),
    "verify": ("Verifying the migrated installation", "التحقق من النسخة بعد الترحيل"),
    "activate": ("Activating the updated installation", "تفعيل النسخة المحدثة"),
    "cutover": ("Activating the updated installation", "تفعيل النسخة المحدثة"),
    "smoke": ("Testing application startup", "اختبار تشغيل البرنامج"),
    "recover": ("Recovering the interrupted update", "استعادة التحديث المتوقف"),
    "recovery": ("Recovering the interrupted update", "استعادة التحديث المتوقف"),
    "complete": ("Finishing", "إنهاء العملية"),
    "package": ("Verifying the update package", "التحقق من حزمة التحديث"),
    "inventory": ("Checking installation contents", "التحقق من محتويات النسخة"),
    "startup": ("Testing application startup", "اختبار تشغيل البرنامج"),
    "restart": ("Testing database restart", "اختبار إعادة تشغيل قاعدة البيانات"),
    "publish": ("Activating the verified installation", "تفعيل النسخة التي جرى التحقق منها"),
}


def application_environment() -> dict[str, str]:
    """Start the installed app without the updater's private interpreter settings."""
    environment = dict(os.environ)
    isolated = {"PYTHONHOME", "PYTHONPATH", "PSYCOPG_IMPL", "SCHEMACRAFT_STORAGE",
        "SCHEMACRAFT_POSTGRES_BIN", "SCHEMACRAFT_POSTGRES_DEV", "TCL_LIBRARY", "TK_LIBRARY",
        "LD_LIBRARY_PATH", "LD_LIBRARY_PATH_ORIG"}
    for key in list(environment):
        if key.upper() in isolated or key.upper().startswith("PG"):
            environment.pop(key)
    environment["PYTHONNOUSERSITE"] = "1"
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def display_issue(issue: object) -> str:
    """Display local diagnostic data as plain text, without interpreting it."""
    if isinstance(issue, dict):
        return " · ".join(str(issue[key]) for key in ("code", "location", "message") if issue.get(key)) or json.dumps(issue, ensure_ascii=False)
    return str(issue)


def verification_summary(result: dict, language: str) -> str:
    verification = result.get("verification")
    if not isinstance(verification, dict):
        return ""
    labels = {
        "schemas": ("Schemas", "التصاميم"),
        "archived_schemas": ("Archived schemas", "التصاميم المؤرشفة"),
        "records": ("Records", "السجلات"),
        "children": ("Related rows", "الصفوف المرتبطة"),
        "registry_entries": ("Identity registry entries", "الهويات المشتركة"),
        "attachment_files": ("Attachment files", "ملفات المرفقات"),
        "source_files": ("Source files", "الملفات الأصلية"),
    }
    return "\n".join(f"{labels[key][1 if language == 'ar' else 0]}: {verification[key]}" for key in labels if key in verification)


class Updater(tk.Tk):
    def __init__(self, target: str = "", package: Path | None = None, language: str = "en"):
        super().__init__()
        self.package = (package or package_root()).resolve()
        self.language = language if language in TEXT else "en"
        self.selected = tk.StringVar(value=target)
        self.closed = tk.BooleanVar(value=False)
        self.language_choice = tk.StringVar(value=ARABIC_CHOICE if self.language == "ar" else "English")
        self.running = False
        self.events: queue.Queue = queue.Queue()
        self.report_path: Path | None = None
        self.backup_path: Path | None = None
        self.launch_command: list[str] = []
        self.last_action = ""
        self.last_phase = ""
        self.last_event_message = ""
        self.last_result: dict = {}
        self.activity_lines: list[str] = []
        self.bindings: list[tuple[object, str]] = []
        self._drain_after: str | None = None
        self.configure(background="#f3f6fb")
        width = min(1050, max(760, self.winfo_screenwidth() - 80))
        height = min(820, max(600, self.winfo_screenheight() - 100))
        self.geometry(f"{width}x{height}")
        self.minsize(740, 580)
        self._build()
        self.protocol("WM_DELETE_WINDOW", self._close)
        self._drain_after = self.after(75, self._drain)
        self._set_language()

    def tr(self, key: str) -> str:
        return ui_text(TEXT[self.language][key])

    def _label(self, parent, key: str, **kwargs):
        widget = ttk.Label(parent, text=self.tr(key), **kwargs)
        self.bindings.append((widget, key))
        return widget

    def _button(self, parent, key: str, command, **kwargs):
        widget = ttk.Button(parent, text=self.tr(key), command=command, style="Action.TButton", **kwargs)
        self.bindings.append((widget, key))
        return widget

    def _build(self):
        style = ttk.Style(self)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        font = "Segoe UI" if os.name == "nt" else "DejaVu Sans"
        style.configure("Page.TFrame", background="#f3f6fb")
        style.configure("Page.TLabel", background="#f3f6fb", foreground="#465570", font=(font, 10))
        style.configure("Heading.TLabel", background="#f3f6fb", foreground="#15263d", font=(font, 21, "bold"))
        style.configure("Action.TButton", font=(font, 10), padding=(12, 8))
        style.configure("Page.TCheckbutton", background="#f3f6fb", foreground="#33445c", font=(font, 10))
        style.configure("Update.Horizontal.TProgressbar", background="#2076be", troughcolor="#e4ecf6", thickness=12)

        page = ttk.Frame(self, padding=22, style="Page.TFrame")
        page.pack(fill="both", expand=True)
        heading = ttk.Frame(page, style="Page.TFrame")
        heading.pack(fill="x")
        self._label(heading, "title", style="Heading.TLabel").pack(side="left", anchor="w")
        self.language_menu = ttk.Combobox(heading, textvariable=self.language_choice, values=("English", ARABIC_CHOICE), width=11, state="readonly")
        self.language_menu.pack(side="right", padx=(12, 0))
        self.language_menu.bind("<<ComboboxSelected>>", self._set_language)
        self._label(page, "subtitle", style="Page.TLabel", wraplength=930).pack(fill="x", pady=(6, 18))
        self._label(page, "folder", style="Page.TLabel").pack(fill="x")
        location = ttk.Frame(page, style="Page.TFrame")
        location.pack(fill="x", pady=(6, 10))
        self.path_entry = ttk.Entry(location, textvariable=self.selected)
        self.path_entry.pack(side="left", fill="x", expand=True, ipady=7)
        self.browse = self._button(location, "browse", self._browse)
        self.browse.pack(side="left", padx=(9, 0))
        self.confirm = ttk.Checkbutton(page, variable=self.closed, text=self.tr("closed"), style="Page.TCheckbutton")
        self.bindings.append((self.confirm, "closed"))
        self.confirm.pack(anchor="w", pady=(2, 12))

        actions = ttk.Frame(page, style="Page.TFrame")
        actions.pack(fill="x", pady=(0, 14))
        self.check_button = self._button(actions, "check", lambda: self.start("check"))
        self.check_button.pack(side="left")
        self.apply_button = self._button(actions, "apply", lambda: self.start("apply"))
        self.apply_button.pack(side="left", padx=8)
        self.recover_button = self._button(actions, "recover", lambda: self.start("recover"))
        self.recover_button.pack(side="left")

        card = tk.Frame(page, background="white", highlightbackground="#dce5ef", highlightthickness=1, padx=16, pady=14)
        card.pack(fill="x", pady=(0, 12))
        self.stage = tk.Label(card, text=self.tr("ready"), anchor="w", justify="left", background="white", foreground="#14537d", font=(font, 13, "bold"))
        self.stage.pack(fill="x")
        self.progress = ttk.Progressbar(card, maximum=100, style="Update.Horizontal.TProgressbar")
        self.progress.pack(fill="x", pady=(11, 8))
        self.detail = tk.Label(card, text=self.tr("ready_detail"), anchor="w", justify="left", wraplength=880, background="white", foreground="#526681", font=(font, 10))
        self.detail.pack(fill="x")
        self._label(page, "steps", style="Page.TLabel").pack(fill="x", pady=(0, 12))

        tools = ttk.Frame(page, style="Page.TFrame")
        tools.pack(fill="x", pady=(0, 12))
        files_row = ttk.Frame(tools, style="Page.TFrame")
        files_row.pack(fill="x")
        launch_row = ttk.Frame(tools, style="Page.TFrame")
        launch_row.pack(fill="x", pady=(7, 0))
        self.report_button = self._button(files_row, "report", self._open_report, state="disabled")
        self.report_button.pack(side="left")
        self.backup_button = self._button(files_row, "backup", lambda: self._open_path(self.backup_path), state="disabled")
        self.backup_button.pack(side="left", padx=8)
        self.launch_button = self._button(launch_row, "launch", self._launch_app, state="disabled")
        self.launch_button.pack(side="left")
        self.save_button = self._button(launch_row, "save", self._save_log)
        self.save_button.pack(side="right")

        self._label(page, "activity", style="Page.TLabel").pack(fill="x", pady=(0, 5))
        activity = ttk.Frame(page)
        activity.pack(fill="both", expand=True)
        self.log = tk.Text(activity, height=7, wrap="word", background="white", foreground="#24354b", relief="flat", borderwidth=0, padx=12, pady=10, font=(font, 9), state="disabled")
        scrollbar = ttk.Scrollbar(activity, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self._label(page, "privacy", style="Page.TLabel").pack(fill="x", pady=(12, 0))
        page.bind("<Configure>", self._resize_text)

    def _resize_text(self, event):
        available = max(400, event.width - 48)
        for widget, key in self.bindings:
            if isinstance(widget, ttk.Label):
                widget.configure(wraplength=available)
        self.detail.configure(wraplength=max(360, available - 36))

    def _set_language(self, event=None):
        self.language = "ar" if self.language_choice.get() == ARABIC_CHOICE else "en"
        self.title(self.tr("title"))
        for widget, key in self.bindings:
            widget.configure(text=self.tr(key))
            if isinstance(widget, ttk.Label):
                widget.configure(anchor="e" if self.language == "ar" else "w", justify="right" if self.language == "ar" else "left")
        for label in (self.stage, self.detail):
            label.configure(anchor="e" if self.language == "ar" else "w", justify="right" if self.language == "ar" else "left")
        if self.running:
            self._show_phase(self.last_phase)
        elif self.last_result:
            self._show_result(self.last_result)
        else:
            self.stage.configure(text=self.tr("ready"))
            self.detail.configure(text=self.tr("ready_detail"))

    def _dialog(self, title: str, message: str, confirm: bool = False) -> bool:
        dialog = tk.Toplevel(self)
        dialog.title(title)
        dialog.transient(self)
        dialog.resizable(False, False)
        dialog.configure(background="#f3f6fb")
        result = {"accepted": False}
        frame = ttk.Frame(dialog, padding=24, style="Page.TFrame")
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=title, style="Heading.TLabel", wraplength=620).pack(fill="x")
        ttk.Label(frame, text=message, style="Page.TLabel", wraplength=620, justify="right" if self.language == "ar" else "left").pack(fill="x", pady=(14, 20))
        actions = ttk.Frame(frame, style="Page.TFrame")
        actions.pack(fill="x")

        def close(accepted=False):
            result["accepted"] = accepted
            dialog.destroy()

        accept = ttk.Button(actions, text=self.tr("continue" if confirm else "ok"), command=lambda: close(True), style="Action.TButton")
        accept.pack(side="right")
        cancel = None
        if confirm:
            cancel = ttk.Button(actions, text=self.tr("cancel"), command=close, style="Action.TButton")
            cancel.pack(side="right", padx=8)
        dialog.protocol("WM_DELETE_WINDOW", close)
        dialog.bind("<Escape>", lambda event: close())
        dialog.update_idletasks()
        x = self.winfo_rootx() + max(0, (self.winfo_width() - dialog.winfo_reqwidth()) // 2)
        y = self.winfo_rooty() + max(0, (self.winfo_height() - dialog.winfo_reqheight()) // 2)
        dialog.geometry(f"+{x}+{y}")
        dialog.grab_set()
        (cancel or accept).focus_set()
        self.wait_window(dialog)
        return result["accepted"]

    def _browse(self):
        selected = self.selected.get().strip()
        initial = selected if selected and Path(selected).is_dir() else str(self.package.parent)
        chosen = filedialog.askdirectory(parent=self, title=self.tr("choose_title"), initialdir=initial)
        if chosen:
            self.selected.set(chosen)

    def _append(self, message: str):
        self.activity_lines.append(str(message))
        self.log.configure(state="normal")
        self.log.insert("end", ui_text(str(message)) + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _busy(self, busy: bool):
        self.running = busy
        for widget in (self.check_button, self.apply_button, self.recover_button, self.browse, self.path_entry, self.confirm):
            widget.configure(state="disabled" if busy else "normal")
        self.launch_button.configure(state="normal" if self.launch_command and not busy else "disabled")

    def start(self, action: str):
        if self.running:
            return
        selected = self.selected.get().strip()
        target = Path(selected).expanduser() if selected else None
        valid_location = target is not None and (target.is_dir() or (action == "recover" and target.parent.is_dir()))
        if not valid_location or target.resolve() == self.package or target.name == "data":
            self._dialog(self.tr("choose_title"), self.tr("choose_detail"))
            return
        if action in {"apply", "recover"}:
            if not self.closed.get():
                self._dialog(self.tr("close_title"), self.tr("close_detail"))
                return
            if not self._dialog(self.tr(f"{action}_title"), self.tr(f"{action}_detail"), True):
                return
        self.last_action = action
        self.last_result = {}
        self.last_phase = "recover" if action == "recover" else "inspect"
        self.last_event_message = ""
        self.launch_command = []
        self.report_path = None
        self.backup_path = None
        self.report_button.configure(state="disabled")
        self.backup_button.configure(state="disabled")
        self._busy(True)
        self.progress.configure(mode="indeterminate", value=0)
        self.progress.start(12)
        self._show_phase(self.last_phase)
        self._append(f"{action.upper()}: {target.resolve()}")
        threading.Thread(target=self._run, args=(action, target.resolve()), daemon=True, name="schemacraft-update").start()

    def _run(self, action: str, target: Path):
        try:
            import engine
            function = {"check": engine.check, "apply": engine.apply, "recover": engine.recover}[action]
            result = function(target, package=self.package, emit=lambda event: self.events.put(("event", event)))
            if not isinstance(result, dict):
                raise RuntimeError("The update engine returned no completion result.")
            self.events.put(("done", result))
        except Exception as error:
            result = {"status": "blocked", "issues": [{"code": type(error).__name__, "message": str(error)}]}
            for key in ("report", "backup"):
                value = getattr(error, key, None)
                if value:
                    result[key] = str(value)
            self.events.put(("done", result))

    def _show_phase(self, phase: str):
        self.last_phase = phase
        names = PHASES.get(phase)
        title = names[1 if self.language == "ar" else 0] if names else phase.replace("_", " ").capitalize()
        self.stage.configure(text=ui_text(title), foreground="#14537d")
        self.detail.configure(text=self.tr("busy"))

    def _event(self, event: object):
        if not isinstance(event, dict):
            self._append(str(event))
            return
        kind = event.get("type", "progress")
        if kind == "result":
            return  # The API return is the authoritative completion event.
        phase = str(event.get("phase", self.last_phase or "inspect"))
        phase_changed = phase != self.last_phase
        if phase_changed:
            self.progress.stop()
            self.progress.configure(mode="indeterminate", value=0)
            self.progress.start(12)
        self._show_phase(phase)
        message = event.get("message")
        if message:
            if phase_changed or str(message) != self.last_event_message:
                self._append(str(message))
            self.last_event_message = str(message)
            self.detail.configure(text=ui_text(str(message)))
        done, total = event.get("done"), event.get("total")
        if isinstance(done, (int, float)) and isinstance(total, (int, float)) and total > 0:
            self.progress.stop()
            self.progress.configure(mode="determinate", value=max(0, min(100, done / total * 100)))
            self.detail.configure(text=ui_text(f"{message or ''}\n{done:g} / {total:g}"))

    def _show_result(self, result: dict):
        status = str(result.get("status", "blocked"))
        known = status if status in {"verified", "completed", "recovered"} else "blocked"
        self.stage.configure(text=self.tr(known), foreground="#137344" if known != "blocked" else "#a23c25")
        self.detail.configure(text=self.tr(f"{known}_detail"))

    def _finish(self, result: dict):
        self.last_result = result
        self.progress.stop()
        successful = result.get("status") in {"verified", "completed", "recovered"}
        self.progress.configure(mode="determinate", value=100 if successful else 0)
        for name in ("report", "backup"):
            value = result.get(name)
            if isinstance(value, str) and value:
                path = Path(value)
                setattr(self, f"{name}_path", path)
                getattr(self, f"{name}_button").configure(state="normal" if path.exists() else "disabled")
                self._append(f"{name.capitalize()}: {path}")
        command = result.get("launch_command")
        if result.get("status") == "completed" and isinstance(command, list) and command and all(isinstance(value, str) for value in command):
            self.launch_command = command
        for issue in result.get("issues", []):
            self._append(display_issue(issue))
        if result.get("message"):
            self._append(str(result["message"]))
        counts = verification_summary(result, self.language)
        if counts:
            self._append(counts)
        summary = result.get("summary")
        if summary:
            self._append(json.dumps(summary, ensure_ascii=False, indent=2) if isinstance(summary, (dict, list)) else str(summary))
        status = str(result.get("status", "blocked"))
        self._append(TEXT[self.language].get(status, status))
        self._busy(False)
        self._show_result(result)

    def _drain(self):
        try:
            for _ in range(200):
                kind, value = self.events.get_nowait()
                if kind == "done":
                    self._finish(value)
                else:
                    self._event(value)
        except queue.Empty:
            pass
        self._drain_after = self.after(75, self._drain)

    def _open_path(self, path: Path | None):
        if path is None:
            return
        try:
            if os.name == "nt":
                os.startfile(str(path))
            else:
                subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as error:
            self._dialog(self.tr("open_error"), str(error))

    def _open_report(self):
        if self.report_path is None:
            return
        try:
            source_text = self.report_path.read_text(encoding="utf-8")
            try:
                displayed = json.dumps(json.loads(source_text), ensure_ascii=False, indent=2)
            except ValueError:
                displayed = source_text
        except (OSError, UnicodeError) as error:
            self._dialog(self.tr("open_error"), str(error))
            return
        dialog = tk.Toplevel(self)
        dialog.title(self.tr("report"))
        dialog.transient(self)
        dialog.geometry("800x580")
        dialog.minsize(620, 400)
        frame = ttk.Frame(dialog, padding=16, style="Page.TFrame")
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=str(self.report_path), style="Page.TLabel", wraplength=750).pack(fill="x", pady=(0, 10))
        report_frame = ttk.Frame(frame)
        report_frame.pack(fill="both", expand=True)
        report_text = tk.Text(report_frame, wrap="word", background="white", foreground="#24354b", relief="flat", padx=10, pady=10)
        scrollbar = ttk.Scrollbar(report_frame, orient="vertical", command=report_text.yview)
        report_text.configure(yscrollcommand=scrollbar.set)
        report_text.insert("1.0", displayed)
        report_text.configure(state="disabled")
        report_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        controls = ttk.Frame(frame, style="Page.TFrame")
        controls.pack(fill="x", pady=(10, 0))

        def save_copy():
            name = filedialog.asksaveasfilename(parent=dialog, title=self.tr("save_report"), initialfile=self.report_path.name, defaultextension=".json", filetypes=(("JSON", "*.json"), ("All files", "*")))
            if name:
                try:
                    Path(name).write_text(source_text, encoding="utf-8")
                except OSError as error:
                    self._dialog(self.tr("open_error"), str(error))

        ttk.Button(controls, text=self.tr("save_report"), command=save_copy, style="Action.TButton").pack(side="left")
        ttk.Button(controls, text=self.tr("ok"), command=dialog.destroy, style="Action.TButton").pack(side="right")

    def _launch_app(self):
        if self.running or not self.launch_command:
            return
        try:
            command = self.launch_command
            subprocess.Popen(command, cwd=Path(command[0]).resolve().parent, env=application_environment(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except OSError as error:
            self._dialog(self.tr("open_error"), str(error))

    def _save_log(self):
        name = filedialog.asksaveasfilename(parent=self, title=self.tr("log_title"), initialfile="SchemaCraft-update-log.txt", defaultextension=".txt", filetypes=(("Text", "*.txt"), ("All files", "*")))
        if name:
            try:
                Path(name).write_text("\n".join(self.activity_lines) + "\n", encoding="utf-8")
            except OSError as error:
                self._dialog(self.tr("open_error"), str(error))

    def _close(self):
        if self.running:
            self._dialog(self.tr("title"), self.tr("busy"))
        else:
            self.destroy()

    def destroy(self):
        if self._drain_after:
            try:
                self.after_cancel(self._drain_after)
            except tk.TclError:
                pass
            self._drain_after = None
        super().destroy()


def main(target: str = "", package: Path | None = None, language: str = "en") -> int:
    try:
        app = Updater(target=target, package=package, language=language)
        app.mainloop()
        return 0
    except tk.TclError as error:
        message = f"SchemaCraft updater needs a graphical desktop session: {error}"
        if sys.stderr is not None:
            print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
