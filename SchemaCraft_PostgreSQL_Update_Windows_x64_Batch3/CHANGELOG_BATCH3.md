# Windows Batch 3 — 2026-10-09

The company report completed source verification and backup, then failed before database import while PostgreSQL logged normal startup and shutdown. Its generic StorageError hid the client-side cause.

- Compact .scu working root keeps all 127 native payload assets below 260 characters for the exact reported application path (maximum 243 versus 266 previously). Full target folder names and UUID leaves remain preserved. Longer placements block before creating a backup/journal; no Windows registry change is required.
- Private updater children and deployed application startup clear inherited PG* and PSYCOPG_IMPL settings before driver import. Machine/user environment settings and source-development runs remain unchanged.
- Blocked migration reports now include stage, operation, safe validation/SQLSTATE/OS codes and value-free cause/traceback metadata. They point to the actual staged PostgreSQL log. Cleanup failures preserve the primary failure.
- Recovery accepts current and earlier private backup roots with strict ownership/link checks. Backups and source/readback validation remain required; no company values are repaired or discarded.
- A tested optional read-only diagnostic collector is included under diagnostics.

The server log does not prove the original company failure's exact cause. Path shortening and isolation fix demonstrated client-side risks; enhanced diagnostics identify remaining failures without exporting company values.
