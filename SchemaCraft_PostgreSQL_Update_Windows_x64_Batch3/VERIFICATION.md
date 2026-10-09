# Windows Batch 3 verification — 2026-10-09

The provided company journal has a 161-character staged application path. Joining that path with the sealed driver dependencies puts libssl at 263 and libcrypto at 266 characters. The compact .scu work root lowers the longest native asset to 243 characters for the same target. All 127 EXE/PYD/DLL paths remain below 260. Microsoft's [path-limit documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation) and the [CPython extension-loader issue](https://github.com/python/cpython/issues/126929) support avoiding long loader paths. This is a likely client-side cause, not a confirmed diagnosis of the unavailable company computer.

Synthetic real PostgreSQL tests also reproduced the supplied report shape with no server ERROR/FATAL when a client driver was unavailable or inherited PG defaults were invalid. Managed psql startup tools cleared these settings while the Python client inherited them. This release clears PG* and PSYCOPG_IMPL at private child/process startup without changing machine/user environment settings. Source development retains its environment. PostgreSQL describes these [environment defaults](https://www.postgresql.org/docs/18/libpq-envars.html).

## Completed checks

- 51 updater engine tests pass, including compact/legacy recovery paths, exact reported company path length, early native path guards, child environment isolation and safe issue display.
- 16 new migration diagnostic tests pass; all 30 existing migration tests pass, including two real disposable PostgreSQL migration/restore tests. Eight graphical update support tests pass.
- Four safe storage-code tests and two packaged environment tests pass.
- Ten read-only diagnostic collector tests pass. Actual Windows Python under Wine 11 collected legacy and compact synthetic journals, imported the driver in updater/stage interpreters, omitted synthetic secrets, and left all evidence hashes unchanged.
- Actual Windows Python, PostgreSQL 18.6 and Win32 updater branches passed full integration under Wine 11 using the exact reported native C:\data entry application\2026-10-07 Schemacraft-Accounting-V2.79 - Copy path. Synthetic data contains 2 schemas, 6 records, 9 children and 78 identity entries, including 72 retired reservations. No identities were deleted or reconciled. Arabic/Persian text, emoji, zero, false, nested ownership and attachments are included.
- The outer test process deliberately inherited PGSERVICE, PGSSLMODE and PSYCOPG_IMPL settings that independently cause client failure. The corrected private processes migrated successfully anyway.
- Read-only preflight preserved the source. Complete backup matched every original byte. Migration passed source/readback hashes, clean database restarts, publication, actual published-path restart/readback and an already-PostgreSQL repeat update without historical Excel reimport. Logical, snapshot and attachment hashes remained equal across the repeated update.
- The full Tk updater constructor/startup self-test passes using actual Windows binaries under Wine 11. Tcl/Tk and minimum Windows version checks passed.

Published logical fingerprint: `a7a1476de9d7cfaba9ffcf6110fe88b521d60d8a032a1a81924a840811849411`.
Published snapshot fingerprint: `c5835c40e4d233f717f9d194158169c7eda30eb6f83836699ae894449ca27d10`.
Published attachment fingerprint: `025ee1ad64876317ba7a96c4861949228e7bd2942402899704eaffa61671e722`.

## Verification boundary

No company data was available, opened or migrated. Only the supplied path and aggregate counts were used to construct synthetic fixtures. Wine execution is not native Microsoft Windows/NTFS validation; native_execution_verified remains false. The company error's exact underlying cause was suppressed by Batch 2. Batch 3 reports stage, operation, approved reason/SQLSTATE/OS codes and value-free cause/traceback metadata so remaining failures can be diagnosed.

Targets Windows 10 version 1903/build 18362 or newer and Windows 11, x64. Earlier backups and journals are retained and remain recoverable. Original Excel files, attachments and source settings remain preserved; PostgreSQL activation/publication still require exact verification. No Windows registry or durability setting is changed.

Original Batch 2 material is preserved separately in VERIFICATION_BATCH2.md. SHA256SUMS.txt covers this package; manifest.json covers every payload file; the bundled PostgreSQL runtime retains its existing sealed file inventory and provenance.
