#!/usr/bin/env python3
"""Visual launcher for SchemaCraft's supported Windows build pipeline."""

from __future__ import annotations

import locale
import json
import re
import time
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import ttk


PROJECT_DIR = Path(__file__).resolve().parent
CLI_BUILD_SCRIPT = PROJECT_DIR / "build-windows-cli.bat"
OUTPUT_DIR = PROJECT_DIR / "release" / "SchemaCraft-Windows-User"
APP_ICON = PROJECT_DIR / "app" / "assets" / "schemacraft.ico"


class BuildProgress:
    """Stage-weighted estimates; successful prior builds improve the next ETA."""
    LABELS = ("Assembling interface", "Preparing icon", "Preparing Python environment",
              "Installing offline packages", "Building executable", "Packaging application")
    DEFAULTS = [3, 2, 20, 45, 180, 20]
    def __init__(self, durations=None, clock=time.monotonic):
        self.clock = clock
        self.expected = list(durations or self.DEFAULTS)
        self.started = clock()
        self.stage_started = self.started
        self.stage = -1
        self.actual = [0.0] * 6
        self.percent = 0.0
        self.finished = False
    def feed(self, line):
        match = re.search(r"\[([1-6])/6\]", line)
        if not match: return
        stage = int(match[1]) - 1
        if stage <= self.stage: return
        now = self.clock()
        if self.stage >= 0: self.actual[self.stage] = now - self.stage_started
        self.stage = stage
        self.stage_started = now
    def snapshot(self):
        elapsed = self.clock() - self.started
        if self.finished: return 100.0, elapsed, 0.0
        if self.stage < 0: return 0.0, elapsed, None
        spent = self.clock() - self.stage_started
        total = sum(self.expected)
        fraction = min(.92, spent / max(1, self.expected[self.stage]))
        candidate = 100 * (sum(self.expected[:self.stage]) + fraction*self.expected[self.stage]) / total
        self.percent = max(self.percent, min(99, candidate))
        remaining = max(0, self.expected[self.stage]-spent) + sum(self.expected[self.stage+1:])
        return self.percent, elapsed, remaining if spent < self.expected[self.stage] else None
    def complete(self):
        if self.stage >= 0: self.actual[self.stage] = self.clock() - self.stage_started
        self.finished = True
        return [max(.5, n) for n in self.actual]


def duration_label(seconds):
    seconds = max(0, int(round(seconds)))
    return f"{seconds // 60}m {seconds % 60:02d}s" if seconds >= 60 else f"{seconds}s"


def packaged_launcher_name(directory: Path) -> str | None:
    """Recognize both supported clean-package launchers."""

    if (directory / "SchemaCraft.exe").is_file():
        return "SchemaCraft.exe"
    required = (
        "OPEN_SCHEMACRAFT.bat",
        "SchemaCraft.py",
        "vendor/python/python.exe",
        "vendor/python/pythonw.exe",
    )
    if not all((directory / name).is_file() for name in required):
        return None
    try:
        metadata = json.loads((directory / "portable-runtime.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(metadata, dict) or metadata.get("kind") != "private-cpython" or metadata.get("platform") != "windows-x86_64":
        return None
    return "OPEN_SCHEMACRAFT.bat"


class WindowsBuilder(tk.Tk):
    """Small, dependency-free GUI around the canonical batch build."""

    def __init__(self) -> None:
        super().__init__()
        self.title("SchemaCraft Windows Builder")
        self.geometry("900x690")
        self.minsize(720, 560)
        self.configure(background="#f4f6fb")
        if APP_ICON.is_file():
            try:
                self.iconbitmap(default=str(APP_ICON))
            except tk.TclError:
                pass

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.process: subprocess.Popen[str] | None = None
        self.building = False
        self.tracker = None
        self._build_interface()
        self.after(250, self._update_progress)
        self.protocol("WM_DELETE_WINDOW", self._request_close)
        self.after(80, self._drain_events)

    def _build_interface(self) -> None:
        style = ttk.Style(self)
        if "clam" in style.theme_names(): style.theme_use("clam")
        style.configure("Report.Horizontal.TProgressbar", troughcolor="#e1eaf4", background="#2875bd", borderwidth=0, thickness=16)
        style.configure("Builder.TFrame", background="#f4f6fb")
        style.configure(
            "BuilderTitle.TLabel",
            background="#f4f6fb",
            foreground="#172033",
            font=("Segoe UI Semibold", 20),
        )
        style.configure(
            "BuilderText.TLabel",
            background="#f4f6fb",
            foreground="#536078",
            font=("Segoe UI", 10),
        )
        style.configure("Builder.TButton", font=("Segoe UI Semibold", 10), padding=(14, 8))

        root = ttk.Frame(self, padding=28, style="Builder.TFrame")
        root.pack(fill="both", expand=True)

        ttk.Label(root, text="SchemaCraft Windows Builder", style="BuilderTitle.TLabel").pack(anchor="w")
        ttk.Label(
            root,
            text="Build the executable and prepare the clean Windows user package.",
            style="BuilderText.TLabel",
        ).pack(anchor="w", pady=(4, 20))

        locations = ttk.Frame(root, style="Builder.TFrame")
        locations.pack(fill="x", pady=(0, 16))
        locations.columnconfigure(1, weight=1)
        ttk.Label(locations, text="Source", style="BuilderText.TLabel").grid(row=0, column=0, sticky="w", padx=(0, 12), pady=3)
        ttk.Label(locations, text=str(PROJECT_DIR), style="BuilderText.TLabel").grid(row=0, column=1, sticky="w", pady=3)
        ttk.Label(locations, text="Output", style="BuilderText.TLabel").grid(row=1, column=0, sticky="w", padx=(0, 12), pady=3)
        ttk.Label(locations, text=str(OUTPUT_DIR), style="BuilderText.TLabel").grid(row=1, column=1, sticky="w", pady=3)

        controls = ttk.Frame(root, style="Builder.TFrame")
        controls.pack(fill="x", pady=(0, 14))
        self.build_button = ttk.Button(
            controls,
            text="Build SchemaCraft",
            command=self.start_build,
            style="Builder.TButton",
        )
        self.build_button.pack(side="left")
        self.open_button = ttk.Button(
            controls,
            text="Open output folder",
            command=self.open_output,
            state="disabled",
            style="Builder.TButton",
        )
        self.open_button.pack(side="left", padx=(10, 0))
        self.status = ttk.Label(controls, text="Ready", style="BuilderText.TLabel")
        self.status.pack(side="right")

        progress_card = tk.Frame(root, background="#ffffff", padx=18, pady=16,
                                 highlightbackground="#dce5f0", highlightthickness=1)
        progress_card.pack(fill="x", pady=(0, 16))
        self.stage_label = tk.Label(progress_card, text="Ready to build", background="#ffffff",
                                    foreground="#174d7a", font=("Segoe UI Semibold", 12), anchor="w")
        self.stage_label.pack(fill="x")
        self.progress = ttk.Progressbar(progress_card, mode="determinate", maximum=100,
                                        style="Report.Horizontal.TProgressbar")
        self.progress.pack(fill="x", pady=(12, 10))
        self.progress_detail = tk.Label(progress_card, text="0% completed  •  Estimated time appears when the build starts",
                                       background="#ffffff", foreground="#617389", font=("Segoe UI", 10), anchor="w")
        self.progress_detail.pack(fill="x")
        self.steps_label = tk.Label(progress_card, text="Interface  →  Icon  →  Environment  →  Packages  →  Executable  →  Output",
                                   background="#ffffff", foreground="#7890a8", font=("Segoe UI", 9), anchor="w")
        self.steps_label.pack(fill="x", pady=(10, 0))
        ttk.Label(root, text="Build activity", style="BuilderText.TLabel").pack(anchor="w", pady=(0, 6))

        log_frame = ttk.Frame(root)
        log_frame.pack(fill="both", expand=True)
        self.log = tk.Text(
            log_frame,
            wrap="word",
            relief="flat",
            borderwidth=0,
            padx=14,
            pady=12,
            background="#ffffff",
            foreground="#26334b",
            font=("Cascadia Mono", 9),
            state="disabled",
        )
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def start_build(self) -> None:
        if self.building:
            return
        if os.name != "nt":
            self._show_dialog(
                "Windows required",
                "The supported executable build must run on Windows.",
                kind="error",
            )
            return
        if not CLI_BUILD_SCRIPT.is_file():
            self._show_dialog(
                "Missing build script",
                f"Could not find:\n{CLI_BUILD_SCRIPT}",
                kind="error",
            )
            return

        self._clear_log()
        self._append_log("Starting SchemaCraft build...\n\n")
        self.status.configure(text="Building…")
        self.build_button.configure(state="disabled")
        self.open_button.configure(state="disabled")
        self.building = True
        durations = None
        try:
            stored = json.loads((PROJECT_DIR / ".build-timing.json").read_text())
            if isinstance(stored, list) and len(stored) == 6 and all(isinstance(n, (int, float)) and .1 < n < 86400 for n in stored):
                durations = stored
        except (OSError, ValueError): pass
        self.tracker = BuildProgress(durations)
        self.progress.configure(value=0)
        threading.Thread(target=self._run_build, daemon=True, name="schemacraft-build").start()

    def _run_build(self) -> None:
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        encoding = locale.getpreferredencoding(False) or "utf-8"
        try:
            self.process = subprocess.Popen(
                ["cmd.exe", "/d", "/c", str(CLI_BUILD_SCRIPT), "/quiet"],
                cwd=PROJECT_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding=encoding,
                errors="replace",
                creationflags=creation_flags,
            )
            assert self.process.stdout is not None
            for line in self.process.stdout:
                self.events.put(("log", line))
            return_code = self.process.wait()
            self.events.put(("finished", return_code))
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.process = None

    def _drain_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "log":
                    self._append_log(str(payload))
                    if self.tracker: self.tracker.feed(str(payload))
                elif event == "finished":
                    self._finish_build(int(payload))
                elif event == "error":
                    self._append_log(f"\nBuild launcher error: {payload}\n")
                    self._finish_build(1)
        except queue.Empty:
            pass
        self.after(80, self._drain_events)

    def _finish_build(self, return_code: int) -> None:
        self.building = False
        self.build_button.configure(state="normal")
        launcher_name = packaged_launcher_name(OUTPUT_DIR) if return_code == 0 else None
        if launcher_name is not None:
            self.status.configure(text="Build completed")
            if self.tracker:
                timings = self.tracker.complete()
                try: (PROJECT_DIR / ".build-timing.json").write_text(json.dumps(timings))
                except OSError: pass
                self.progress.configure(value=100)
                self.stage_label.configure(text="Your application is ready")
                self.progress_detail.configure(text=f"100% completed  •  Elapsed {duration_label(self.tracker.snapshot()[1])}  •  Remaining 0s")
            self.open_button.configure(state="normal")
            self._append_log("\nBuild completed successfully.\n")
            self._show_dialog("Build completed", f"{launcher_name} and the clean user package are ready.")
        else:
            self.status.configure(text="Build failed")
            self.stage_label.configure(text="Build stopped — review the activity log")
            self.progress_detail.configure(text="Incomplete • No remaining-time estimate")
            if return_code == 0:
                self._append_log(f"\nThe build command completed, but the user package has no complete supported launcher:\n{OUTPUT_DIR}\n")
                self._show_dialog("Incomplete build output", "The build command completed, but its user package is incomplete. Review the build log and output folder.", kind="error")
            else:
                self._append_log(f"\nBuild failed with exit code {return_code}.\n")
                self._show_dialog("Build failed", "Review the build log for details.", kind="error")

    def _update_progress(self):
        if self.building and self.tracker:
            percent, elapsed, remaining = self.tracker.snapshot()
            self.progress.configure(value=percent)
            index = self.tracker.stage
            self.stage_label.configure(text=(f"Step {index+1} of 6 · {BuildProgress.LABELS[index]}" if index >= 0 else "Starting build…"))
            eta = duration_label(remaining) if remaining is not None else "calculating…"
            self.progress_detail.configure(text=f"≈ {percent:.0f}% completed  •  Elapsed {duration_label(elapsed)}  •  Estimated remaining {eta}")
        self.after(250, self._update_progress)

    def open_output(self) -> None:
        if OUTPUT_DIR.is_dir() and os.name == "nt":
            os.startfile(OUTPUT_DIR)  # type: ignore[attr-defined]

    def _request_close(self) -> None:
        if self.building:
            self._show_dialog(
                "Build in progress",
                "Wait for the current build to finish before closing the builder.",
            )
            return
        self.destroy()

    def _show_dialog(self, title: str, message: str, *, kind: str = "info") -> None:
        """Display a builder-owned modal instead of a native message box."""

        dialog = tk.Toplevel(self)
        dialog.title(title)
        dialog.transient(self)
        dialog.resizable(False, False)
        dialog.configure(background="#ffffff")
        if APP_ICON.is_file():
            try:
                dialog.iconbitmap(default=str(APP_ICON))
            except tk.TclError:
                pass

        body = tk.Frame(dialog, background="#ffffff", padx=24, pady=20)
        body.pack(fill="both", expand=True)
        accent = "#b42318" if kind == "error" else "#2f78c4"
        tk.Label(
            body,
            text=title,
            background="#ffffff",
            foreground=accent,
            font=("Segoe UI Semibold", 13),
            anchor="w",
        ).pack(fill="x")
        tk.Label(
            body,
            text=message,
            background="#ffffff",
            foreground="#26334b",
            font=("Segoe UI", 10),
            justify="left",
            wraplength=430,
            anchor="w",
        ).pack(fill="x", pady=(10, 18))
        ttk.Button(body, text="OK", command=dialog.destroy, style="Builder.TButton").pack(anchor="e")

        dialog.update_idletasks()
        x = self.winfo_rootx() + max(0, (self.winfo_width() - dialog.winfo_reqwidth()) // 2)
        y = self.winfo_rooty() + max(0, (self.winfo_height() - dialog.winfo_reqheight()) // 2)
        dialog.geometry(f"+{x}+{y}")
        dialog.protocol("WM_DELETE_WINDOW", dialog.destroy)
        dialog.grab_set()
        dialog.focus_force()

    def _append_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")


def main() -> int:
    WindowsBuilder().mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
