# Windows batch updater verification — 2026-10-09

This release replaces the updater's custom EXE launchers with UPDATE_WINDOWS.bat and includes a data-free CHECK_WINDOWS_STARTUP.bat diagnostic. All Python, Tcl/Tk, PostgreSQL and application dependencies remain bundled for offline operation.

## Problems reproduced and fixed

- Embedded Windows Python resolved the original forward-slash parent entry in python313._pth to the vendor directory instead of the application/package root. Actual execution reproduced ModuleNotFoundError: UPDATER_GUI. Both private interpreters now use Windows path separators, and script entry points explicitly locate sibling modules before imports.
- The custom updater launcher hid startup errors. The batch runs a startup self-test, opens the GUI through the bundled console interpreter and pauses on failure. The UTF-8 updater-startup.log starts before GUI imports.
- pg_ctl exited after starting PostgreSQL, but detached descendants kept inherited output pipes open. Managed runtime commands now use temporary file capture and bounded process waits; text input, UTF-8 output, timeouts and secret redaction remain verified.
- Legacy ANSI argument conversion prevented PostgreSQL tools from reading Arabic deployment paths after cutover. Eight unsigned PostgreSQL executables now embed process UTF-8 manifests. Their code sections, DLLs, icons and version resources are preserved; the sealed runtime includes transformation provenance and XML copies. No system locale or registry setting is changed. Microsoft's [process UTF-8 documentation](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page) defines support from Windows 10 version 1903.
- Staging now retains the complete destination application's folder name, so Unicode and shell-sensitive characters are exercised before publication. Private work folders use short UUID names to avoid the reproduced Windows path-length failure. Legacy recovery journal paths remain supported with strict validation.
- Backup and database permissions identify the current account by ASCII SID, preserving support for localized Windows account names without decoding OEM username bytes.
- Installed and generated user applications use OPEN_SCHEMACRAFT.bat. The previous SchemaCraft.exe is retired only in staging after the complete backup verifies. Generated copies carry the private Python runtime and sealed PostgreSQL and omit developer data.

## Executed verification

All tests use synthetic data. No company files were available, opened or migrated.

- Actual Windows CPython 3.13.16 and Tcl/Tk 8.6.15 execute successfully. All packaged application dependencies import.
- Actual UPDATE_WINDOWS.bat opens the full GUI from a folder containing Arabic, spaces and an exclamation mark. Closing its own GUI returns 0. The diagnostic batch returns 0. A missing GUI module produces a visible traceback, saved log and nonzero status.
- Windows source preflight matches the Linux baseline for every synthetic schema, row, attachment and populated Excel cell. Two schemas include one archived schema, two records, four nested children and two attachments; Arabic/Persian text, an emoji, multiline values, zero and false are preserved. Source files remain byte-identical.
- The complete Windows update engine passes read-only preflight, complete backup verification, Unicode staging, lossless migration, two database startup/restart probes, publication, exact restart/readback at the published Unicode path and a second already-PostgreSQL update. The repeated update skips historical Excel reimport and preserves the complete logical snapshot.
- Missing referenced attachments block before backup/database creation and leave the original installation unchanged.
- Complete Windows user-copy creation and its batch helper pass; missing required application source returns a failure without replacing an earlier valid user copy.
- 44 synthetic updater engine tests pass, including interrupted publication/recovery, command validation, launcher retirement, Windows handles/SID permissions, minimum Windows version and Unicode staging.
- Three startup diagnostics regression tests pass. Native Linux runtime regression testing passes all 26 cases, including real disposable PostgreSQL deployments and the detached-output/timeout regression tests. Migration regression testing passes 28 cases, with two optional integration cases skipped.

Published database fingerprint: `838afbb423ca7df91ac0f9e39aaa980e6bc9dc7ab0b5f927d3fc3822e4d013dd`.
Published snapshot fingerprint: `20972c4be340b6c925284ae06f1b7f79756c92a96e22034550475c9c056a8ed4`.
Published attachment fingerprint: `5f8074ed95d88d4fe6f0e9c1cd310f715ed4ae5b1ef7717cfd4bc27d8575f908`.

## Verification boundary

Windows PE executables and Win32 branches were executed under Wine 9 for GUI/batch startup and Wine 11 for full PostgreSQL integration. This is stronger than static inspection, but does not establish native Microsoft Windows or NTFS policy verification. The package retains native_execution_verified=false. The company data will be checked by the same strict preflight and readback on the target computer.

The supported target is Windows x64: Windows 10 version 1903/build 18362 or newer, or Windows 11. Startup and engine preflight enforce this before selecting or modifying data. No separate Python or PostgreSQL installation is required.

SHA256SUMS.txt covers the package files; manifest.json covers every payload file; runtime/postgresql/runtime-manifest.json seals the PostgreSQL runtime. The original failed Windows ZIP is retained separately for comparison.
