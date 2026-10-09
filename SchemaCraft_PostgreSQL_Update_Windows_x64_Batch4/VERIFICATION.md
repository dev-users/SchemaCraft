# Windows Batch 4 verification — 2026-10-09

## Problem and repair

Batch 3's payload did not contain the canonical build scripts or build requirements. The migration preserved the company's existing developer files, so an older builder could freeze the PostgreSQL app without its dynamically loaded psycopg driver. Batch 4 includes the current builder, frontend assembler, requirements and complete offline wheelhouse.

The private-Python marker also selected the batch launcher in make_user_copy.py after a successful EXE build, while the graphical builder expected an EXE. Explicit executable packaging fixes that mismatch. The GUI recognizes both valid layouts and distinguishes incomplete output from a failing build process.

A real Windows dependency resolution test found psycopg's conditional tzdata dependency absent from the earlier wheelhouse. Batch 4 adds it to both the private interpreter and frozen build. The offline preflight evaluates Windows markers even on Linux. PyInstaller's actual Windows archive serializes timezone resources as binary entries; the final checker accepts the correct serialization and validates the resource's TZif contents rather than only its name.

## Completed checks

- 47 relevant Python checks pass: build dependency/negative archive checks, subprocess GUI completion and failure outcomes, frozen versus source package selection, data-free runtime probing, environment isolation and existing package/UI behavior.
- All 18 pinned Windows x64/CPython 3.13 wheels pass metadata, tag and SHA-256 verification; all 11 active Windows dependency relationships resolve. A fresh isolated Python interpreter loads the dependency checker from the verified offline packaging wheel.
- Actual Windows Python 3.13.13, pip and Tcl/Tk run in a disposable Wine 11 prefix. Offline dependency installation, pip consistency, binary psycopg 3.3.3 and timezone resource imports pass.
- Actual Windows PyInstaller 6.16 creates a windowed one-file EXE containing required psycopg modules, both native extensions and libpq/OpenSSL DLLs. Its UTC resource has been extracted and parsed successfully.
- The fresh EXE's --verify-build probe returns verified_build and frozen=true with binary driver 3.3.3, timezone_support=true and the sealed PostgreSQL 18 Windows runtime. The probe executes the runtime's version commands to confirm those tools can run; it does not open a workspace or start a database.
- The complete Windows CLI pipeline exits with code 0 after archive validation, frozen import checks and explicit EXE packaging. Source and clean-release executable hashes match; the clean layout contains no developer data, private interpreter or build tools.
- The actual Windows Tk builder completion handler shows Build completed, enables the output-folder action and sets progress to 100 against the real generated EXE package.
- The final frozen EXE starts and stops the managed PostgreSQL server for two readback probes against a closed copy of synthetic migrated data. Both match the logical, snapshot and attachment fingerprints, including all 6 records, 9 children and 78 identity entries. Poisoned inherited PostgreSQL client settings are cleared correctly.
- The cumulative updater passes an already-migrated synthetic PostgreSQL update and a repeat update at the exact company target path. Read-only preflight, complete byte-verified backup, obsolete broken EXE retirement, staged restart/readback and published restart/readback all pass. All 6 records, 9 children, 78 identity entries and 2 synthetic attachments remain identical. The repeat update does not import historical Excel workbooks.

Logical fingerprint: a7a1476de9d7cfaba9ffcf6110fe88b521d60d8a032a1a81924a840811849411.
Snapshot fingerprint: c5835c40e4d233f717f9d194158169c7eda30eb6f83836699ae894449ca27d10.
Attachment fingerprint: 025ee1ad64876317ba7a96c4861949228e7bd2942402899704eaffa61671e722.

Final synthetic Windows build: 31,304,208 bytes; SHA-256 357fc483c12a889b805038a655eae6e822dfb8c57f2e1677f0e995df03a3a416. This test EXE and synthetic data are excluded from the updater ZIP; the company rebuilds its EXE using the delivered scripts.

## Execution boundary

No company data was available, read or copied. Only the supplied path and counts informed synthetic fixtures. Native Microsoft Windows/NTFS and Chrome/Edge application-window behavior remain outside this Linux/Wine validation; native_execution_verified stays false.

The Wine test clone selects the official full 64-bit Python interpreter directly because the optional Python Launcher installer is 32-bit and unsupported by this private Wine runtime. It decodes the exact embedded icon using Python because Wine's PowerShell lacks .NET. The test process receives normal Windows COMSPEC, WINDIR and PATH values: Wine's direct EXE invocation otherwise omits the shell environment required by PostgreSQL's subprocess launcher. These adaptations exist only in the disposable test environment. The production build still uses the existing Python Launcher and Windows PowerShell. The actual PyInstaller command, archive checks, frozen dependency probe and package helper execute without bypassing verification.

Database/backup/recovery behavior from Batch 3 is retained. PostgreSQL binaries are unchanged and retain their sealed inventory. See VERIFICATION_BATCH3.md and VERIFICATION_BATCH2.md for prior migration verification. SHA256SUMS.txt covers the package; manifest.json covers all payload assets. Synthetic fixtures, logs and company credentials are excluded from the ZIP.
