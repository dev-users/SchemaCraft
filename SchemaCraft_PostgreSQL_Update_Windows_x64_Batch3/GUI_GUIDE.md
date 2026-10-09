# Graphical update workflow

This is Batch 3. Extract to a short location such as C:\SCUpdate, close the application, and select the same original application copy. Earlier blocked staging/backup folders can remain untouched. New working copies use the short .scu folder next to the application; earlier recovery journals remain supported. If blocked again, send the new migration report, which includes the failing operation and safe cause codes. The optional diagnostics/DIAGNOSE_WINDOWS.bat collects client readiness without connecting to or changing a database.

Supported target: Windows 10 version 1903 (build 18362) or later, or Windows 11, on x64 computers. The launcher checks this before any data migration.

Start with UPDATE_WINDOWS.bat after extracting the entire package. It runs a data-free startup diagnosis before opening the English/Arabic updater. UPDATE.bat is a shortcut to the same entry point. The bundled runtimes remain included for offline operation.

Choose the current application folder. Close the application and workspace Excel files, then confirm that they are closed. Check data performs a strict, read-only inventory of all schemas, records, nested tables and attachments. A blocked report prevents cutover. Update and migrate creates a verified complete backup and a separate staged copy; activation requires exact logical and attachment verification, database startup and restart, and safe directory publication.

The completion panel provides the verification report, complete backup folder and Open SchemaCraft. The updated application starts through its private interpreter; OPEN_SCHEMACRAFT.bat is the visible application launcher. Existing desktop shortcuts to the old SchemaCraft.exe must be updated to this batch file. If update fails before publication, the original application is retained. If publication is interrupted, use Recover interrupted update and preserve the work journal and backup folders.

If startup fails, inspect the console and updater-startup.log in the extracted package. CHECK_WINDOWS_STARTUP.bat tests Python, 64-bit Windows matching, Tcl/Tk, Arabic display dependencies, the engine and full GUI construction without selecting company data. Reports generated during a migration remain in the updater's work folder. Share diagnostic logs or error codes when troubleshooting; do not include company records.
