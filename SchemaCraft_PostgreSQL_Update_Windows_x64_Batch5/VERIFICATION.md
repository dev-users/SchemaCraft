# Batch 5 verification

All data tests use synthetic workspaces. Company data is unavailable here; the updater repeats strict local source checks and compares PostgreSQL record/schema/metadata and attachment fingerprints before completing cleanup.

- PostgreSQL application operations and transfers: 72 tests passed, including records/search/archives/schema edits, independent database packages, reviewed Excel imports/exports, attachment transactions, logical backup creation/restore, application clones and commit failure recovery.
- Exact PostgreSQL repository round trips/transactions: 15 tests passed.
- Migration, source integrity and logical backup restoration: 30 tests passed.
- PostgreSQL-only policy, cleanup, consolidation CLI, runtime and frozen archive checks: 64 focused tests passed.
- Real Chromium migration/edit/save/restart workflow passed with an isolated database.
- English and Arabic graphical completion screens passed with the updater's actual private runtime; report/app actions enabled, removed-backup action disabled.

The historical broad DOM suite has an outdated assertion at tests/test_ui_dom.js:311 expecting an intermediate category picker; the current builder opens its field editor directly. This release preserves the interface assets byte-for-byte and does not modify that workflow. The actual Chromium migration and record editing check passes.

On failure before publication, the original installation and its complete verified recovery copy remain. After publication, recovery never replaces the authoritative PostgreSQL database with an old Excel copy. Target ownership and exact protected file/hash checks guard cleanup. Successful completion removes existing app/migration/update backups; future automatic/manual backup features still create and restore logical PostgreSQL snapshots and saved documents.

Updater engine: 49 regression tests passed, including malformed configuration, uppercase XLSX ownership, target locking, verifier integrity and partial cleanup recovery.

Windows verification used the actual Windows x64 frozen EXE and bundled Windows interpreter under Wine 11. A native Microsoft Windows computer and company data were unavailable. The same EXE is delivered; no Wine-only product changes were introduced.

The complete graphical update engine flow passed on synthetic data in an Arabic/Persian application path with an uppercase XLSX catalog workbook: 2 schemas, 1 archived schema, 2 records, 4 nested children and 2 attachments, including a real Excel document. All three fingerprints match after migration, verified cleanup, activation and repeated final-location restarts. A second PostgreSQL update preserves the same hashes and does not recreate legacy storage. Missing attachments and unknown backup content block safely with the original preserved.

The installed EXE's actual HTTP startup, ordinary authentication, preserved administrator-password unlock, fresh logical backup creation/download, graceful exit and restore into a separate managed PostgreSQL deployment all passed. Browser launching was replaced by a test-only URL recorder because Wine has no Chrome/Edge; the application API ran normally. Current frontend migration/edit/save/restart was tested separately in real Chromium on Linux.

The shipped UPDATE_WINDOWS.bat created the real updater window and exited normally with code 0. Its startup self-test and English/Arabic completion screens passed. Removed-backup action stays disabled after completion; report and installed-app actions are enabled. The installed-app action isolates the private updater interpreter and PostgreSQL environment variables while preserving ordinary OS and browser preferences.

Final Windows executable SHA256: `b1289e9e5483bd11478fe96ac62fe4cc7031811e072336fafa8d9076ece67a40`.
Final updater engine SHA256: `2c2c19d3ba81f55a177d7e77445cc22540a53062cecf67995a19186c2894eac2`.

All 781 payload file hashes/sizes/permissions and complete sealed PostgreSQL runtime bytes passed independent audit. The updater stays offline; no company installation was accessed.
