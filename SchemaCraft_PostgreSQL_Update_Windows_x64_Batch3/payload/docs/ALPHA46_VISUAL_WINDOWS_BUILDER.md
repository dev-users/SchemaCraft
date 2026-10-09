# Alpha 46 visual Windows builder

## Visual build workflow

`build-windows.bat` is now the normal entry point for a Windows build. It opens
a native, dependency-free builder window with:

- the source and output locations;
- a single build action;
- live pipeline output and progress feedback;
- clear success and failure states; and
- an action that opens the completed user-package folder.

The window runs the established offline build in a worker thread so it stays
responsive. Closing or changing the visual layer does not alter the executable
assembly rules.

## Command-line workflow

`build-windows-cli.bat` owns the canonical six-stage pipeline and the embedded
multi-resolution icon. Run it directly for troubleshooting or automation:

```bat
build-windows-cli.bat
build-windows-cli.bat /quiet
```

Quiet mode suppresses the final pause, which lets the visual builder and CI
receive the real process exit code.

## Clean package visibility

`make-user-copy.bat` marks the packaged `app` and `assets` directories hidden,
along with optional root configuration. A frozen SchemaCraft process also
marks its runtime-created `data` and backup paths hidden. Consequently, normal
Windows Explorer settings show only `SchemaCraft.exe` in the user-package root.

This is visual organization only. Windows hidden attributes do not encrypt
content, restrict access, or replace backups. An administrator can enable
Hidden items whenever direct inspection or recovery is required.
