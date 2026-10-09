# Windows build and release

## Offline wheelhouse

`Packages/` contains the pinned Windows wheels used by the supported CPython
3.13 64-bit build, including bcrypt. The command-line backend installs with
`--no-index`, so the normal build never contacts the internet.

Refresh the wheelhouse only on an online Windows machine:

```bat
prepare-packages.bat
```

After an intentional refresh, regenerate `Packages/SHA256SUMS.txt` and review
every version change.

## Build

```bat
build-windows.bat
```

Double-clicking this file opens the visual builder. It reports progress, keeps
the complete build log visible, reports success or failure, and can open the
finished package folder. The builder delegates to the same supported pipeline
used by command-line automation:

```bat
build-windows-cli.bat /quiet
```

The pipeline:

1. Rebuilds frontend assets.
2. Extracts the exact multi-resolution ICO embedded in the build script for
   the executable and every lifecycle/browser surface.
3. Validates the pinned Windows x64 wheels, then creates or reuses `.build-env`.
4. Installs only from `Packages/`, checks dependency consistency and loads the
   matching psycopg binary driver.
5. Runs PyInstaller as a windowed one-file executable, explicitly collecting
   psycopg, its binary extensions and their client DLLs. The build inspects the
   finished archive and runs `SchemaCraft.exe --verify-build` before replacing
   the previous executable. This check imports the frozen driver and verifies
   the sealed external runtime without opening application data or starting a
   database.
6. Runs `make_user_copy.py --executable` to create the clean EXE user package
   under `release/`, including the external PostgreSQL runtime.

Building an EXE requires the full 64-bit Python 3.13 installation and Python
Launcher. The updater's embedded Python runs SchemaCraft and its updater; it
does not contain the build environment or pip.

The final packaging step validates every required runtime file before copying
anything. It uses Python file operations and the Windows file-attribute API
instead of shell copy/attribute commands, so a failure reports the exact missing
file or directory. To recreate only the user package after a successful build,
run `make-user-copy.bat /executable`. In a private Python developer app, running
the helper without `/executable` creates a private Python user package using
`OPEN_SCHEMACRAFT.bat`. The graphical builder recognizes both supported layouts
and reports incomplete output separately from a failing build command.

The user package intentionally starts without source, tests, build tools,
logs, or development data. In the normal Windows Explorer view only
`SchemaCraft.exe` is visible: the required `app`, `assets` and `runtime` folders and an
optional `builder-auth.json` receive the Windows hidden attribute. The app
creates `data` on first launch and hides it automatically, together with other
runtime support paths.

Hidden attributes are a presentation feature, not encryption or access
control. Administrators can inspect these files by enabling **Hidden items** in
Windows Explorer; backups and normal file permissions remain the protection
mechanisms for application data.

## Pre-release checklist

- Rebuild the frontend and API reference.
- Run Python and browser suites.
- Verify wheel hashes.
- Confirm `builder-auth.json` contains `algorithm: bcrypt` after an
  administrator password is set or successfully migrated.
- Launch the built executable and check full-screen user form → main application
  without any Windows title bar or resize controls.
- Open a read-only/search-result window and confirm `Ctrl+Q` closes auxiliary
  windows while the same full-screen kiosk shows the closing view and exits.
- Inspect the user package for logs, caches, tokens, and developer data.
- Confirm normal Explorer view shows only `SchemaCraft.exe`, then enable Hidden
  items and confirm `app` and `assets` are present.
- Launch once and confirm the newly created `data` directory is hidden.
- Change one value in the packaged `app/ui_text.json`, restart SchemaCraft, and
  confirm the served interface contains the replacement without rebuilding;
  restore the release label afterward.
- Verify the default-app creator refuses an in-app destination and that each
  cleanup option removes exactly the selected data class.
