# Managed local PostgreSQL runtime

SchemaCraft's PostgreSQL deployment runs a private PostgreSQL 18 cluster on the
same computer as the application. It does not install a machine-wide Windows
service or connect to another application's database. Excel remains available
for imports and exports. Existing Excel workspaces require explicit verified
migration; merely starting this version does not convert company workbooks.
See [the migration and recovery procedure](EXCEL_POSTGRESQL_MIGRATION.md) for
`migrate-storage.py --verify-only`, verified activation, and portable restoration.

## Files and ownership

The application locates its reviewed server runtime at:

```text
<application>/runtime/postgresql/
    bin/           PostgreSQL server and client tools
    lib/           matching runtime libraries
    share/         matching bootstrap catalogs and extensions
    runtime-manifest.json
```

Each selected data directory has an independent deployment:

```text
<data>/.postgresql/
    cluster/             persistent PostgreSQL database files
    deployment.json      private passwords, deployment UUID, port, cluster ID
    postgres.log         server startup and operational diagnostics
    lifecycle.lock       cross-process start/stop serialization
    leases/              active application-instance ownership leases
    file-transactions/   portable attachment stages, journals and live locks
```

The cluster listens only on `127.0.0.1`, uses a dynamically allocated persistent
port, UTF-8 encoding, data checksums, and SCRAM password authentication. SchemaCraft
connects as `sc_app`, which cannot create databases or roles and is not a
superuser. The private bootstrap administrator is used only by the runtime
manager. Passwords do not appear in command arguments or UI diagnostics.

On Unix, the deployment directory is restricted to its owner and private state
files use mode `0600`. On Windows, `icacls` removes inherited access and grants
the current Windows account access to its private deployment directory. This
protects the application's credentials from other ordinary Windows accounts;
it does not encrypt database files or replace an operating-system access policy.

Portable imports coordinate new attachment files with record changes using a
durable journal and a marker in the same PostgreSQL transaction. New bytes are
first written and synchronized in a private stage, then published exclusively
with a hard link. A destination collision never overwrites or deletes an existing
file. If SQL rolls back or a process crashes, recovery removes a target only when
its staged inode proves ownership. Committed recovery checks each file's exact
SHA-256 and size; missing or changed committed files block startup for review.
Live cross-process file locks prevent a second launch from recovering a still
active import. Nested and unreferenced package attachments are preserved under
their schema's attachment directory.

A lost database COMMIT response is treated as an unknown outcome. File rollback
queries the durable SQL marker through a fresh transaction holding the same
writer lock, so the original server transaction must complete before its result
is inspected. A committed marker keeps the files. An unavailable database leaves
the files, stages, and journal intact for later recovery; it never guesses that
the record write rolled back and deletes a possibly committed attachment.

Application write groups also hold obsolete-file cleanup and profile updates
until the real outer SQL transaction completes. Nested groups join that same
completion boundary. Rollback invalidates record caches and reloads the identity
registry; post-commit cleanup checks final retained attachment references, and a
downstream profile failure schedules retry without misreporting the committed
source data as rolled back.

This publication method requires hard links on the same filesystem (normally
NTFS on Windows and standard local Linux filesystems). Unsupported filesystems,
including FAT/exFAT, or attachment directories on a different filesystem fail
closed without changing records or existing attachments. Use a supported local
data directory for PostgreSQL deployments. Windows publication and locking still
require the Windows validation described below.

Startup checks the runtime inventory and executable versions, initializes only
an empty owned deployment, and waits for authenticated readiness. An existing
cluster is adopted only when its system identifier and actual data directory
match the deployment state. A conflicting port causes a new free port to be
selected while the cluster is stopped; unrelated listeners are never stopped.

Concurrent application instances acquire separate leases. Closing one instance
keeps the cluster running for the others. The last instance performs a controlled
`pg_ctl -m fast -w stop`, after the application's work and connections have
finished. Stale leases are recognized using process creation time, not just PID.
An interrupted process can leave the database running; the next launch safely
reuses the matching cluster. Ownership or authentication failures block adoption
and shutdown rather than signaling an unverified process.

Durability remains enabled: `fsync`, `synchronous_commit`, and `full_page_writes`
are not disabled to make benchmarks faster. Do not delete `deployment.json`,
copy a running `cluster` directory as a backup, or replace PostgreSQL major
versions by copying new binaries over old ones. Database, design metadata,
attachments, and private deployment state must be covered by a coordinated
backup/recovery procedure.

## Preparing the Windows server runtime

This source branch does not include PostgreSQL Windows server binaries. Obtain
an official/reviewed PostgreSQL 18 Windows x86-64 distribution separately and
verify its publisher and archive digest before extracting it. Preserve its
matching libraries, catalogs, extension files, and license notices. The runtime
must contain all these tools:

```text
postgres.exe initdb.exe pg_ctl.exe pg_isready.exe pg_controldata.exe
psql.exe pg_dump.exe pg_restore.exe
```

After reviewing the extracted runtime and verifying the original archive against
the publisher's expected digest, seal that extraction. Substitute the real
version, source URL, and independently verified digest:

```bat
py -3.13 schemacraft_postgres_runtime.py seal-runtime ^
  --runtime-dir "C:\reviewed\postgresql" ^
  --version 18.6 ^
  --source-url "https://publisher.example/postgresql-18.6-windows-x64.zip" ^
  --source-archive "C:\reviewed\postgresql-18.6-windows-x64.zip" ^
  --expected-archive-sha256 ACTUAL_64_CHARACTER_LOWERCASE_SHA256
```

The seal checks the supplied archive hash and records SHA-256 for every runtime
file. It rejects database clusters, deployment credentials, missing dependencies,
and non-AMD64 executable headers. **A manifest is an integrity inventory, not a
publisher signature, and sealing does not prove that an extraction came from its
archive.** The release maintainer must review the vendor extraction and its
provenance before sealing. Keep the reviewed manifest with the runtime.

Install the sealed runtime and prepare the pinned offline Python wheelhouse on
an online Windows build computer:

```bat
prepare-packages.bat /postgresql "C:\reviewed\postgresql"
```

The preparation script never downloads a PostgreSQL server distribution. It
validates and copies the explicitly supplied runtime into `runtime\postgresql`.
It refuses to replace an existing runtime directory: move the old runtime only
after reviewing any update and its compatibility with deployed databases.

Then use the existing graphical `build-windows.bat` launcher or canonical
`build-windows-cli.bat`. The build verifies server and tool versions on Windows
before assembling the executable, and packages the psycopg binary driver.
Missing/unreviewed runtimes fail clearly; the previous release is not deleted by
that preflight check. A PostgreSQL major upgrade requires a separate database
upgrade project; this manager accepts major version 18 only.

## Clean generated user packages

`make_user_copy.py` now requires a verified Windows runtime by default. The clean
package includes runtime files and `storage-default.json` selecting
`managed-postgresql`; it never copies the developer's `data` directory, database
cluster, local credentials, or migration reports. New deployment identities and
private credentials are generated independently on each user computer.

The explicit compatibility/test command `make_user_copy.py --legacy-excel`
creates an Excel package without PostgreSQL. It does not migrate or change any
existing workspace. This option is not used by the normal Windows build.

## Development and verification

Source development can explicitly opt into an already installed PostgreSQL 18
binary directory. Both variables are required; frozen user applications reject
this override:

```bash
export SCHEMACRAFT_POSTGRES_DEV=1
export SCHEMACRAFT_POSTGRES_BIN=/usr/lib/postgresql/18/bin
```

Runtime tests create disposable synthetic databases under the OS temporary
directory. Manifest tests use deliberately non-executable synthetic PE fixtures.
To include real lifecycle tests with an available driver and PostgreSQL 18:

```bash
SCHEMACRAFT_POSTGRES_TEST_BIN=/usr/lib/postgresql/18/bin \
python3 -m unittest discover -s tests -p test_postgres_runtime.py -v
```

The implementation has been exercised on Linux PostgreSQL 18.6 for initialization,
Unicode persistence, restart, durable settings, non-superuser access, concurrent
startup, lease-aware shutdown, unrelated port conflicts, stale PID leases, and
cluster identity refusal. **Windows server launch, Windows ACL behavior, and a
Windows executable build still require validation with the reviewed Windows
runtime on a Windows machine.** Those results must not be inferred from Linux
tests or executable-header checks.

The focused file tests cover collisions, interrupted writes/publication,
committed and uncommitted crash recovery, real process exit releasing its lock,
unsafe journals, missing/changed committed files, interrupted rollback cleanup,
and SQL marker atomicity. Run them with the same explicit PostgreSQL test variable:

```bash
SCHEMACRAFT_POSTGRES_TEST_BIN=/usr/lib/postgresql/18/bin \
python3 -m unittest discover -s tests -p test_transfer_files.py -v
```

Primary PostgreSQL references:

- [initdb and cluster initialization](https://www.postgresql.org/docs/18/app-initdb.html)
- [pg_ctl lifecycle and shutdown modes](https://www.postgresql.org/docs/18/app-pg-ctl.html)
- [PostgreSQL major version upgrades](https://www.postgresql.org/docs/18/upgrading.html)
