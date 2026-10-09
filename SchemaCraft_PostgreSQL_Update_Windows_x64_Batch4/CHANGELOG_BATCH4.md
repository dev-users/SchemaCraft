# Windows Batch 4 — EXE build repair

Batch 3 updated the PostgreSQL application runtime but omitted the developer build pipeline. Existing company copies therefore kept their older build scripts and could create an executable without psycopg. This cumulative update installs the current builder scripts, build requirements, frontend assembler and complete pinned offline wheelhouse, in addition to all Batch 3 fixes.

The complete offline dependency set includes Windows-only tzdata. Its preflight evaluates Windows dependency markers even when a release is prepared on Linux. The private application interpreter and the frozen EXE both include timezone data.

The build now imports the matching binary driver, inspects the frozen archive for Python modules and native client libraries, and executes the new EXE's data-free dependency probe before replacing the previous executable. These checks block incomplete builds instead of publishing them.

An explicit executable packaging mode prevents the updater's private-Python marker from selecting a batch-only package after a fresh EXE build. The graphical builder recognizes both supported package layouts and distinguishes missing output from a nonzero build exit. Frozen apps also clear inherited PostgreSQL client defaults before driver imports, as private-Python apps already do.

Apply this update to the original developer/application folder, then run build-windows.bat. A full 64-bit Python 3.13 installation with Python Launcher is required to build an EXE. All pinned build wheels are supplied; normal builds work offline. The updater and existing application continue to use their private Python without a system installation.

The root SchemaCraft.exe runs against that application's existing data. release/SchemaCraft-Windows-User is a clean distributable package; make_user_copy.py never copies the developer application's data into it. To recreate that EXE package explicitly, use make-user-copy.bat /executable. A private Python user package remains available through the helper's default mode.

Database activation, backup, source verification, restart/readback and recovery safeguards are unchanged. This update preserves Excel migration originals and attachments and supports already-migrated PostgreSQL applications without importing historical Excel data again.
