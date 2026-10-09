"""Local startup diagnostics for the portable graphical updater.

This module never opens an installed workspace or starts PostgreSQL. Logging
must begin before GUI imports so a missing DLL or Tk error remains visible.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import platform
import struct
import sys
import traceback


def find_package(explicit=None) -> Path:
    if explicit is not None:
        return Path(explicit).expanduser().resolve()
    base = Path(__file__).resolve().parent
    for candidate in (base, base.parent):
        if (candidate / "manifest.json").is_file():
            return candidate
    return base


def configure_private_runtime(package: Path) -> dict:
    """Use this package's Tk scripts, irrespective of installed system Python."""
    runtime = package / "vendor" / "python"
    configured = {}
    for variable, relative in (("TCL_LIBRARY", "tcl/tcl8.6"), ("TK_LIBRARY", "tcl/tk8.6")):
        library = runtime / relative
        if library.is_dir():
            os.environ[variable] = str(library)
            configured[variable] = str(library)
    # Embedded Python's _pth normally declares this already. Explicitly adding
    # the package makes direct batch/script startup deterministic too.
    root = str(package)
    if root not in sys.path:
        sys.path.insert(0, root)
    return configured


class StartupLog:
    def __init__(self, package: Path, *, log_path=None, reset=False):
        self.path = Path(log_path).resolve() if log_path else package / "updater-startup.log"
        self.stream = None
        self.write_error = None
        try:
            self.stream = self.path.open("w" if reset else "a", encoding="utf-8", buffering=1)
        except OSError as error:
            self.write_error = error

    def line(self, text=""):
        text = str(text)
        if sys.stdout is not None:
            try:
                print(text, flush=True)
            except (OSError, UnicodeError):
                print(text.encode("ascii", errors="backslashreplace").decode("ascii"), flush=True)
        if self.stream is not None:
            self.stream.write(text + "\n")

    def failure(self, error: BaseException, *, startup_only=True):
        self.line("FAILED: " + type(error).__name__ + ": " + str(error))
        self.line("".join(traceback.format_exception(type(error), error, error.__traceback__)).rstrip())
        if self.stream is None:
            self.line("Unable to save the startup log in the extracted update folder: " + str(self.write_error))
        else:
            self.line("Startup log: " + str(self.path))
        if startup_only:
            self.line("No installed application data was opened or migrated by this startup check.")

    def close(self):
        if self.stream is not None:
            self.stream.close()
            self.stream = None


def log_environment(log: StartupLog, package: Path, configured: dict):
    log.line("SchemaCraft portable updater startup")
    log.line("UTC: " + datetime.now(timezone.utc).isoformat())
    log.line("Package: " + str(package))
    log.line("Interpreter: " + sys.executable)
    log.line("Python prefix: " + sys.prefix)
    log.line("Python: " + sys.version.replace("\n", " "))
    log.line("Platform: " + platform.system() + " / " + platform.machine())
    log.line("Interpreter bits: " + str(struct.calcsize("P") * 8))
    log.line("sitecustomize loaded: " + str("sitecustomize" in sys.modules))
    log.line("Import paths: " + repr(sys.path))
    for name in ("TCL_LIBRARY", "TK_LIBRARY"):
        log.line(name + ": " + str(os.environ.get(name, "(not set)")))
    if configured:
        log.line("Packaged Tcl/Tk locations configured explicitly.")


def run_graphical(target="", *, package=None, language="en") -> int:
    root = find_package(package)
    log = StartupLog(root)
    window_created = False
    try:
        configured = configure_private_runtime(root)
        log_environment(log, root, configured)
        import UPDATER_GUI
        log.line("GUI module imported successfully.")
        # Construct inside this reporter instead of the older GUI.main, whose
        # TclError handler returns silently when launched by pythonw.exe.
        app = UPDATER_GUI.Updater(target=target, package=root, language=language)
        window_created = True
        def callback_error(exception_type, error, trace):
            error = error.with_traceback(trace)
            log.failure(error, startup_only=False)
        app.report_callback_exception = callback_error
        log.line("Updater window created successfully.")
        app.mainloop()
        log.line("Updater window closed normally.")
        return 0
    except Exception as error:
        log.failure(error, startup_only=not window_created)
        return 2
    finally:
        log.close()
