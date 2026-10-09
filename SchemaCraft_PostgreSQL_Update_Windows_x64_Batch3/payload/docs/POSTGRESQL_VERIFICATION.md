# PostgreSQL migration verification

This branch retains the current frontend and imports/exports while moving
operational records and shared identities to a managed local PostgreSQL database.
No company workbooks or `App/data` were used during development or testing.

## Company acceptance gate

Run the procedure in [EXCEL_POSTGRESQL_MIGRATION.md](EXCEL_POSTGRESQL_MIGRATION.md)
against an explicitly selected company workspace. A source-only pass is
`verified_source`. Activation additionally requires `activated: true` and
`readback_verified: true`; it is never inferred from a successful database
connection or matching row counts alone.

The importer independently accounts for nonempty Excel cells, reads all schemas
and identities, validates nested ownership and attachment references, hashes all
source files, writes an atomic logical snapshot, and compares exact typed JSON
after database readback. It checks source hashes again before activation.
Ambiguous or unsupported content blocks migration. The complete original files,
including Excel formatting and ancillary content, remain in a checksummed
read-only evidence copy. Those files must also have an independent company backup.

After activation, test a representative company record from each schema: display,
search, edit, save/reopen, nested cards, financial delivery, attachment preview,
Excel exchange and portable transfer to a separate deployment. Restore a logical
backup into a separate empty directory. Retain the migration report and acceptance
record. Synthetic tests cannot certify data that has not been supplied.

## Automated coverage

Real PostgreSQL tests use isolated temporary clusters, production durability
settings, and synthetic multilingual data. They cover lossless types and unknown
metadata; ownership constraints; optimistic concurrency; atomic multi-schema
writes; record/identity rollback; nested transfers; attachments; archive/delete;
schema changes; financial calculations and linked delivery; profile propagation;
Excel import/review/export; PDF export; logical backup/restore; generated copies;
and deployments without any `.xlsx` file.

Runtime tests cover initialization, authenticated ownership, roles, port conflicts,
concurrent leases, stale processes, stop/restart, directory relocation and missing
or unsafe deployment/runtime state. Transfer tests cover interrupted SQL and file
operations, active process locks, content checks, nested files, collision ownership,
and recovery after actual process exit.

The browser migration test runs real Chromium against a real PostgreSQL server. It
checks read-only preflight, the gated activation control, report download, migrated
record display, editing/saving, controlled shutdown/restart and persistence. It
compares original workbook hashes before and after all operations.

The final focused runs passed **164 tests**:

| Test area | Passed |
| --- | ---: |
| Current application operations and transfers | 70 |
| Repository integrity, snapshots and transaction completion | 15 |
| Excel migration and portable logical restore | 30 |
| Managed runtime and packaging | 19 |
| Portable attachment transactions and recovery | 19 |
| Application transaction side effects | 9 |
| Fresh application startup and missing-deployment protection | 2 |

The legacy backend suite also passed 36 tests. All 17 pinned Windows Python
dependency wheel hashes were checked and offline dependency resolution passed.
Python compilation, frontend assembly and `git diff --check` passed.

The real migration browser scenario passed, as did the existing entry/search/date,
attachment, close-lifecycle and runtime-hydration browser scenarios. JavaScript
regression testing ran 763 individual cases: 742 passed and 21 reproduced the
baseline failures listed below.

The complete Python regression run executed **1,646 cases: 1,626 passed and 20
reproduced baseline failures**, with all PostgreSQL scenario gates enabled. The
last additional helper case, two fresh-startup cases and schema-deletion case
passed separately after that run. App coverage comprises a final 69-case run and
the additional schema-deletion case; its backup was restored into an independent
database and compared exactly.

Reproduce the Python suite with the pinned dependencies installed and an explicit
PostgreSQL test binary directory:

```sh
SCHEMACRAFT_STORAGE=excel SCHEMACRAFT_POSTGRES_TEST_BIN=/path/to/postgresql/bin python -m unittest discover -s tests
```

The test gate starts disposable servers; never set it to a company cluster path.
For the browser migration test, configure Playwright, Python dependencies and
Chromium, then run `node tests/test_postgres_migration_browser.cjs`.

## Reproduced baseline test failures

The complete regression suite is not wholly green. The same failures were
reproduced on baseline commit `8fea329` before interpreting them as migration
regressions:

- Python: 20 cases in `tests/test_source_owned_links.py` (10 failures and 10 errors).
  These exercise older linking functions and expectations. Existing field-owned
  linking and PostgreSQL linked-delivery scenarios have separate passing coverage.
- JavaScript: 21 cases across `test_builder_compact.cjs`,
  `test_document_writer.cjs`, `test_record_choice_refinement.cjs`,
  `test_schema_finance.cjs`, and `test_source_owned_links.cjs`. They include stale
  stylesheet-order assertions, old linking APIs and source-fragment expectations.
- Browser: `test_builder_layout_browser.cjs`,
  `test_integrated_workspace_browser.cjs`, and `test_report_studio_browser.cjs`
  wait for controls absent from the baseline interface. The `test_reports_browser`
  entry point is an alias of the report-studio scenario.

These cases were neither removed nor silently skipped to claim a clean suite.

## Platform and release limits

The verified runtime here is Linux PostgreSQL 18.6 with Python 3.12 and psycopg
3.3.3. Windows CPython 3.13 offline driver dependencies and checksums are prepared,
but PostgreSQL Windows server binaries are not part of this source branch. A
reviewed sealed Windows runtime and a native Windows build/smoke test are required
before distributing an executable to the company. Windows launch and ACL behavior
are unverified. See [MANAGED_POSTGRESQL_RUNTIME.md](MANAGED_POSTGRESQL_RUNTIME.md).

Portable attachment transactions require hard links on one filesystem (NTFS on
Windows). Unsupported filesystems fail without replacing existing files. Live
database clusters and PostgreSQL runtime credentials are excluded from transferable backups
and generated-app seeds.

There is no claim of measured performance improvement or simultaneous office-LAN
support in this migration. The deployment remains local to one computer; exchange
between independent deployments uses the existing import/export workflows.
