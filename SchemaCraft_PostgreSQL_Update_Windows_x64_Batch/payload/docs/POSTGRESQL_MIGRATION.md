# Verified Excel → PostgreSQL migration

Existing Excel workspaces stay on Excel until an explicit migration succeeds.
The migration does not repair company data or edit the original workbooks,
registry, attachments, or schema JSON. PostgreSQL becomes active only after
every source check and exact database readback passes.

Company data was unavailable during development. No company workspace or
`App/data` was migrated or tested. Only a verification report run on the actual
company directory, followed by verified activation and operator acceptance, can
establish that its data migrated successfully.

## Graphical controls

Unlock application settings and open **تخزين البيانات**. Choose
**التحقق من بيانات Excel قبل الترحيل** to run read-only preflight. Review the
counts and issues, then choose **حفظ تقرير التحقق** to save its JSON report.
Only a passing source report enables **ترحيل البيانات إلى PostgreSQL**.
Applying repeats preflight and verifies full database readback before activation.
If any issue appears, migration remains blocked; save the report for review.

## Operator procedure

1. Close SchemaCraft and Excel. Keep an independent copy of the complete company
   `data` directory. Use the PostgreSQL runtime supplied for this installation;
   see [managed runtime deployment](MANAGED_POSTGRESQL_RUNTIME.md).
2. Run the read-only verification against the **explicit** company directory:

   ```sh
   python migrate-storage.py --data-dir "/absolute/company/data" --verify-only --report "/outside/migration-preflight.json"
   ```

   On Windows, use the installation's Python interpreter and Windows paths.
   `--data-dir` has no default. Verification needs neither PostgreSQL nor its
   Python driver and creates no database or source files. Exit code 0 means
   `status: verified_source`; exit code 2 means blocked.
3. Review the report's schema, record, child, registry, and attachment counts.
   A blocked report identifies a code and location without embedding record
   values. Resolve the issue through an independently reviewed process, then
   run verification again. This tool never silently repairs an issue.
4. With the application still closed, run:

   ```sh
   python migrate-storage.py --data-dir "/absolute/company/data" --apply --report "/outside/migration-apply.json"
   ```

   This repeats preflight, backs up the original workspace, imports into the
   private PostgreSQL database, reads everything back, rechecks every original
   file hash, and only then writes `storage.json`. Success is
   `status: activated`, `activated: true`, and `readback_verified: true`.
   Open SchemaCraft and confirm the chosen workspace and expected counts.

The built Windows executable uses the identical engine without requiring a
separate installed Python. With its reviewed runtime and offline driver bundled:

```powershell
.\SchemaCraft.exe --migrate-storage --data-dir "D:\Company\SchemaCraft\data" --verify-only --report "D:\Company\preflight.json"
.\SchemaCraft.exe --migrate-storage --data-dir "D:\Company\SchemaCraft\data" --apply --report "D:\Company\activation.json"
.\SchemaCraft.exe --migrate-storage --data-dir "D:\Company\Restored\data" --restore-backup "D:\Company\backup.zip" --report "D:\Company\restore.json"
```

Source execution also supports `python SchemaCraft.py --migrate-storage` with the
same arguments. Preparation of a sealed Windows PostgreSQL runtime and native
Windows build/smoke testing remain deployment prerequisites, documented in the
[runtime guide](MANAGED_POSTGRESQL_RUNTIME.md).

The Settings migration controls use the same verifier/importer. Do not edit
source files while applying. In-process operations share the workbook lock;
external edits are detected through full source hashes before activation.

## What is verified

- Every catalog schema, including archived schemas, its raw JSON definition,
  workbook, registry memberships, and every record/child row are inspected.
- All nonempty workbook cells enter the typed, coordinate-based evidence
  inventory. Unknown populated sheets/columns, orphan or ignored rows,
  duplicate/invalid identities, fractional/duplicate row IDs, formulas, Excel
  errors, unsafe file paths, and missing referenced attachments block import.
- Field values preserve Unicode, newlines, zero, false, dates, record archive
  information, nested ownership, links, and transaction provenance. The
  independent cell decoder must exactly match the application's Excel reader.
  Any whitespace/value/metadata loss or automatic nested-parent assignment
  blocks migration.
- Row-2 field labels that differ from schema labels block for review. The
  migration does not silently reverse supported Excel label edits. Layout
  fields cannot hide populated value columns. Raw unknown schema metadata is
  retained in PostgreSQL rather than discarded during validation.
- Referenced attachments must exist; all attachment files, including currently
  unreferenced files, receive SHA-256 hashes. The full workspace file inventory
  includes ancillary settings/history and original archive files.
- Database readback compares exact canonical JSON, retaining record and child
  order and distinguishing false/zero, integers/floats, and negative zero.
  Registry and each schema/dataset are independently read back as well.

This requires a valid multi-schema `workspace.json` and identity registry.
An older single-workbook Release-2 directory is blocked. Upgrade that workspace
with its supported application procedure on a separate reviewed copy first;
this verifier does not create missing identities or choose new schema IDs.

## Reading blocked reports

`location` points to a workspace-relative file, sheet, row/cell, or schema ID.
Record contents are not included in the report. Retain the untouched original
and independently inspect the named location. The following actions are review
instructions, not permission for this tool to change business data.

| Report code/group | Meaning / المعنى | Operator review |
| --- | --- | --- |
| `workspace_catalog_required`, `invalid_active_schema`, `missing_schema_or_workbook` | Catalog or source file is missing/inconsistent / ملف التصميم أو الفهرس غير سليم | Verify the selected directory and restore a complete matching workspace. Legacy upgrades need a separate reviewed procedure. |
| `unknown_populated_sheet`, `unknown_populated_column`, `unaccounted_workbook_metadata` | Populated Excel content has no supported mapping / بيانات Excel غير محددة في التصميم | Identify every value and its intended definition; prepare a separately reviewed, lossless supported source before retrying. |
| `invalid_or_ignored_main_row`, `invalid_or_orphan_child_row`, `duplicate_record_identity`, `invalid_or_duplicate_registry_identity` | Invalid, duplicate, or orphan identities / معرفات غير صالحة أو مكررة أو صفوف يتيمة | Compare against a known-good backup and business identity records. Do not invent or reuse IDs. |
| `formula_or_excel_error` | Formula or error cannot be imported safely / صيغة أو خطأ Excel غير آمن للترحيل | Review the formula, result, and intended representation with the data owner; preserve the original workbook. |
| `*_normalization_loss`, `unrecognized_boolean`, `minor_id_normalization_loss` | The reader would change or discard a source value / قد تتغير قيمة أو تضيع | Inspect exact source cells and supported types. Do not accept silent trimming, coercion, or automatic parent assignment. |
| `visible_field_label_requires_review` | An Excel row-2 field label differs from schema JSON / عنوان حقل Excel مختلف | Review and explicitly synchronize the intended label using the supported app workflow on a controlled copy, then verify again. |
| `registry_workbook_membership_mismatch`, `registry_orphan_membership` | Shared identity membership does not match all schemas / سجل الهوية لا يطابق التصاميم | Review registry and every schema including archives together; restore matching originals rather than automatically rebuilding registry. |
| `missing_referenced_attachment`, `attachment_path_normalization_loss` | A referenced file is absent or its path unsafe / مرفق مفقود أو مساره غير سليم | Restore the exact original file at its recorded path, verify its provenance, and rerun verification. |
| `target_contains_unrelated_or_changed_data`, `restore_requires_empty_*` | The target already has data / قاعدة أو مجلد الوجهة غير فارغ | Use a genuinely new deployment. Never erase an occupied target merely to make migration pass. |
| `postgres_*readback_mismatch`, `source_changed_*`, `target_rollback_failed` | Readback/source stability/rollback failed / فشل التطابق أو تغير المصدر أو تعذرت الاستعادة | Keep the source and evidence; review the target and concurrent processes. Stop applying until the discrepancy is understood. |
| `migration_setup_failed`, `preflight_or_storage_error` | Runtime, driver, or unsupported source error / مشكلة تشغيل أو بيانات غير مدعومة | Check runtime prerequisites and installation integrity. Review the exception type without logging credentials or record values. |

## Original evidence and retries

Before database writes, a fresh immutable-by-convention copy is created under
`data/.postgresql/migration-backups/<migration-id>/originals`. Its manifest
contains the SHA-256 hash and size of every original file. `cell-inventory.json`
contains each populated cell's location, Excel/Python type, and value hash;
original workbook bytes preserve the values, formats, labels, and unsupported
content. Evidence files/directories are made read-only and never overwritten.
The `.postgresql` runtime itself is excluded so no running cluster is copied.
This is not a substitute for an independent backup or an OS-level WORM archive.

A preexisting database with unrelated or changed data blocks migration. A retry
can reuse only a prior import whose migration fingerprint and full dataset and
registry readback exactly match this source. Database import is atomic. If
readback or the final source recheck fails, the previous logical target snapshot
is restored and PostgreSQL is not activated. A rollback failure is reported
explicitly; retain both original evidence and the target for inspection.

After PostgreSQL activation, the original Excel files remain historical
evidence. Editing them is not an update to the database. Do not switch back to
those frozen files after new PostgreSQL edits: restore a verified logical backup
or use the application's explicit Excel export.

Before cutover, a blocked migration leaves Excel authoritative; after verifying
that no source files changed, resume the Excel deployment or restore the full
original evidence into a separate controlled copy. After any PostgreSQL edits,
the old Excel evidence is no longer current. A rollback must use a recent logical
backup restored to an empty deployment, or a validated safe export of current
data; never replace new PostgreSQL changes with frozen originals.

## Portable PostgreSQL backup restore

The application's workspace ZIP includes metadata, attachments, and an
authoritative `postgresql/snapshot.json`. A running cluster and its credentials
are excluded. Restore to a **new, empty directory**:

```sh
python migrate-storage.py --data-dir "/absolute/new-empty/data" --restore-backup "/absolute/company-backup.zip" --report "/outside/restore-report.json"
```

The CLI first validates the archive without starting PostgreSQL. It rejects
absolute/traversal/Windows drive paths, symlinks, duplicate paths including
case-only duplicates, unexpected PostgreSQL entries, more than 100,000 entries,
files over 4 GiB, and expanded archives over 64 GiB. It validates catalog/schema
congruence, record/child ownership, registry membership, and attachment
references. It provisions fresh local runtime credentials, imports the logical
snapshot into an empty database, verifies exact readback, and then installs
workspace files and enables PostgreSQL. Existing workspace/database data is
never overwritten by this restore command.

The snapshot is authoritative during restore because Excel projections may be
stale or absent after PostgreSQL edits. Schema JSON projections are generated
from the verified snapshot. Cloned deployments use the same seed validator
before consuming their logical seed; they do not copy a live database cluster.

## Verification scope

`tests/test_storage_migration.py` uses only disposable synthetic directories and
an isolated PostgreSQL test cluster. It covers successful import/reopen/restore,
Unicode/date/zero/Boolean data, nested rows, metadata, missing files, malformed
workbooks, source changes, unsafe ZIPs, idempotent retries, unrelated targets,
and rollback. Real company workbooks must pass their own on-site report; test
success is not a claim that unseen company data has been migrated.
