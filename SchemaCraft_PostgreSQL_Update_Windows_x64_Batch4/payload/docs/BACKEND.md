# Backend

## Process lifecycle

`SchemaCraft.py` configures rotating local logs, enforces one Windows instance,
starts the loopback server, immediately opens the splash, initializes the
workspace, publishes readiness, and waits for graceful shutdown.

`DataEntryHTTPServer` tracks browser heartbeats, active requests, startup state,
session requirements, and the shutdown grace period. Tests instantiate it with
session enforcement disabled by default; production `run()` explicitly enables
sessions and lifecycle-window management.

## Request routing

`DataEntryRequestHandler` serves the generated frontend and implements the JSON
and file API. It validates Host and Origin, applies security headers, checks
startup readiness and browser authentication, selects the schema context, and
maps display-safe application errors to responses.

See [HTTP API](HTTP_API.md) for the endpoint contract and the generated
[API reference](API_REFERENCE.md) for every callable.

## Record engine

The backend validates field types, dates, numbers, options, conditions,
dependent values, uniqueness, required values, repeatable/nested categories,
links, attachments, archive state, and optimistic concurrency. Repeated-card
tags and record completeness are retired; legacy definitions are stripped
during normalization. A repeatable checkbox may be constrained to one checked
card, and date/user fields may react only to an unchecked-to-checked transition
of a configured main-category checkbox.
Automatic-update rules may read a main field, the current repeatable card, or
another repeatable category. Cross-category rules use the first source card in
document order that satisfies the rule, matching the browser preview exactly.

Records are loaded into coherent dataset snapshots containing ID/code indexes,
unique-value indexes, and normalized search indexes. Record/schema commits
publish a new snapshot. Background Excel schema projection preserves that hot
snapshot after its atomic replace, so the next Builder edit does not reread and
re-index the complete workbook.

Schema-to-Excel projection uses one coalescing maintenance queue. It snapshots
the committed revision under the shared lock, builds the workbook outside that
lock, then publishes only if the revision is still current. Destructive schema
changes enqueue a pre-edit recovery package before orphaned attachments are
removed. Multiple quick edits to the same schema collapse into one current
projection instead of competing writer threads.

## Search

Search supports:

- Arabic normalization and diacritic removal.
- Exact/contains comparisons and typed number/date/boolean operators.
- Empty and non-empty values.
- Repeatable and nested-repeatable paths.
- Archive state, record IDs, and schema-wide queries.
- Schema-specific tables and multi-schema/global results.
- Live distinct-value suggestions for the shared filter component.

Number comparisons support equality, greater/less, inclusive greater/less,
and an inclusive two-bound range. Date comparisons support equality, before,
after, and an inclusive two-bound range. Empty and non-empty remain explicit
operators rather than magic text values.

## Imports and exports

Excel imports are inspected before commit and report every field/sheet mapping
problem. Portable packages are inspected before application. Exports include
filtered Excel, profile PDF, and schema-portable ZIP formats. Import/export
history records the audit user and retained source/destination metadata.
Deleting or clearing an operation history also deletes its retained archive;
the server history files are authoritative and are never rebuilt from browser
cache.

## Default-app copies

The admin-only settings workflow copies the running application into a new,
uniquely named folder. It rejects destinations inside the active application,
never overwrites an existing folder, excludes logs/backups/build caches and the
developer access key, and can remove histories/users, records/attachments, or
the complete data workspace. Record removal implies history removal; complete
schema removal implies both.
When complete schema removal is selected, the cloned `builder-auth.json` is
also removed. That schema-free application therefore asks its new
administrator to create a password on first use. Copies that retain the schema
keep the existing administrator hash.

## Error handling

`ApplicationError`, `WorkspaceError`, `WorkbookExchangeError`, and
`AdvancedFeatureError` describe user-correctable problems. Unexpected
exceptions are logged locally and returned as a generic internal-error message;
request payloads and passwords are never logged.
