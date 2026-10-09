#!/usr/bin/env python3
"""Check the packaged updater's startup without touching an installation."""
from __future__ import annotations

import argparse
import importlib
import json
from pathlib import Path
import platform
import struct
import sys

_SOURCE_DIRECTORY = str(Path(__file__).resolve().parent)
if _SOURCE_DIRECTORY not in sys.path:
    sys.path.insert(0, _SOURCE_DIRECTORY)

from startup_support import StartupLog, configure_private_runtime, find_package, log_environment


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--platform", choices=("windows-x86_64", "linux-x86_64"))
    parser.add_argument("--log-file", type=Path)
    args = parser.parse_args(argv)
    package = find_package(args.package)
    log = StartupLog(package, log_path=args.log_file, reset=True)
    root = None
    try:
        configured = configure_private_runtime(package)
        log_environment(log, package, configured)
        manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        expected = args.platform or manifest.get("platform")
        system = "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else sys.platform
        architecture = platform.machine().casefold()
        actual = system + "-x86_64" if architecture in {"x86_64", "amd64"} and struct.calcsize("P") == 8 else system + "-unsupported"
        if expected not in {"windows-x86_64", "linux-x86_64"} or actual != expected:
            raise RuntimeError(f"Package/interpreter platform mismatch: package={expected}, interpreter={actual}")
        log.line("PASS: the package matches the operating system and 64-bit interpreter.")

        engine = importlib.import_module("engine")
        if engine._host() != expected:
            raise RuntimeError("The update engine platform check disagrees with the package.")
        if not all(callable(getattr(engine, name, None)) for name in ("check", "apply", "recover")):
            raise RuntimeError("The update engine API is incomplete.")
        if expected == "windows-x86_64" and "minimum_windows_version" in manifest:
            version_check = getattr(engine, "_check_windows_version", None)
            if not callable(version_check):
                raise RuntimeError("The bundled engine cannot check this package's minimum Windows version.")
            version_check(manifest)
            log.line("PASS: Windows satisfies the package's minimum version " + str(manifest["minimum_windows_version"]) + ".")
        log.line("PASS: the update engine imports and identifies the correct platform.")

        import tkinter
        root = tkinter.Tk()
        root.withdraw()
        root.update_idletasks()
        log.line("PASS: Tcl/Tk root created (Tcl " + str(root.tk.call("info", "patchlevel")) + ").")
        root.destroy()
        root = None

        import arabic_reshaper
        from bidi.algorithm import get_display
        original = "التحقق من البيانات"
        if get_display(arabic_reshaper.reshape(original)) == original:
            raise RuntimeError("Arabic display shaping did not initialize.")
        log.line("PASS: Arabic reshaping and bidirectional display dependencies import correctly.")

        gui = importlib.import_module("UPDATER_GUI")
        root = gui.Updater(package=package)
        root.withdraw()
        root.update_idletasks()
        root.destroy()
        root = None
        log.line("PASS: the full graphical updater window constructs successfully.")
        log.line("STARTUP SELF-TEST PASSED. No installation was selected and no data migration was run.")
        log.line("Startup log: " + str(log.path))
        return 0
    except Exception as error:
        log.failure(error)
        return 2
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass
        log.close()


if __name__ == "__main__":
    raise SystemExit(main())
