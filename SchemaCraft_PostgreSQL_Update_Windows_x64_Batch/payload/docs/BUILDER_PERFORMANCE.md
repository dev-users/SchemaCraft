# Builder performance

The Builder used to recreate every field widget after each edit, even in closed
category tabs. A save response also rebuilt Entry and other hidden views, and
rebuilt the Builder twice. With many date fields this created thousands of
calendar/select nodes repeatedly.

The updated renderer keeps unchanged category sections and field widgets mounted.
Only changed widgets are recreated. Category tabs are reconciled by ID so their
listeners are registered once. Boundary arrows are refreshed when siblings move,
are added or are deleted. Caches are pruned after deletion and cleared when the
active schema changes. Lookup indexes exist only during a synchronous render,
so mutations cannot leave stale field/category objects in an index.

After a successful Builder save, the schema state and visible Builder update
immediately. Hidden record/search views rebuild before leaving the Builder.
Repeated saves coalesce that pending refresh to the latest saved schema. Local
record draft autosaving is suspended while the hidden controls represent an old
revision; a schema switch cancels the previous pending refresh.

Server validation, optimistic revision checks, migration, recovery backups and
background Excel synchronization are unchanged. This change does not acknowledge
a save before the server reports success.

## Reproducible measurement

Run `node tests/benchmark_builder.js` after `python build_frontend.py` and
`npm ci`. Optional positional arguments are category count and fields per
category. `SCHEMACRAFT_BENCHMARK_BUNDLE` selects an older app.js for comparison.

The workload has 40 main categories, 25 fields each (1,000 total, including 80
date fields). It renders the Builder, edits a field, adds a field, deletes a
field, then applies a successful schema save response. Results below are a single
local comparison using Node 24.19.0 and jsdom 26.1.0 on 2026-09-07.

| Operation | Before (ms) | After (ms) | Field widgets constructed, before → after |
| --- | ---: | ---: | ---: |
| initial | 4,987 | 3,636 | 1,000 → 1,000 |
| edit | 4,176 | 693 | 1,000 → 1 |
| add | 4,255 | 670 | 1,001 → 1 |
| delete | 3,852 | 670 | 1,000 → 0 |
| save acknowledgement | 10,798 | 160 | 3,000 → 0 |

These timings measure synchronous JavaScript/DOM work, including the handling of
a save response. They exclude HTTP latency, server persistence, native browser
layout/painting, and later observer callbacks. They are not Windows end-to-end
save-time guarantees. First opening of a large schema still constructs its full
preview; subsequent local edits and save acknowledgements avoid that cost.

## Regression coverage

`npm run test:ui` covers unchanged node identity, updated help text and category
labels, add/delete arrow boundaries, tab selection without duplicated listeners,
coalesced save refreshes, protection against saving stale record controls under a
new revision, navigation into the latest Entry schema, and cancellation when
switching schemas. Existing tests also cover nested/repeated layout, reorder,
edit/delete controls, spacers, calendars, multi-schema navigation and attachments.


## General definitions (2026-09-08)

General categories and standalone fields now use the same retained preview
renderer, tab rails, nested sections and contextual controls as schema Builder.
Preview IDs are deterministic and map back to the original definition/node keys;
they are never written into the live schema. The two general panels have separate
bounded caches. Unchanged refreshes skip both rendering and navigator rebuilding.

Linked definition updates use the deferred hidden-view refresh when the active
schema changed. Unrelated linked schemas do not trigger a reload of the active
schema. The backend no longer scans every schema twice to compute an unused
linked-definition flag. Persistence, revision checks, backups and migrations
remain unchanged.

Preview placeholders are empty unless the definition provides help text. Field
hover details include type, width, required/searchable status and applicable
flags. Category hover details include main/repeated type, parent, field count
and applicable category settings. Inert preview calendars keep their three-part
geometry without allocating year/month/day choices that cannot be used there.
Live Entry calendars continue to use their full choices and behavior.

Run `node tests/benchmark_general_builder.js` for 40 general categories with 25
fields each, including 80 date fields. `SCHEMACRAFT_BENCHMARK_BUNDLE` can select
the previous bundle. A local Node 24/jsdom 26 sample:

| Operation | Before (ms) | After (ms) | New preview widgets after change |
| --- | ---: | ---: | ---: |
| initial | 2,158 | 2,868 | 1,000 |
| edit | 1,088 | 518 | 1 |
| add | 928 | 455 | 1 |
| delete | 944 | 426 | 0 |
| unchanged save refresh | 900 | 1 | 0 |

The old general view was a summary list; the new initial render creates a richer
Entry-style preview and takes longer in this sample. Subsequent changes reuse
controls and complete faster. These are scripting/DOM measurements, not HTTP,
backup, disk, browser paint, or Windows end-to-end save timings.


## General deletion and explicit save (2026-09-08)

The general Builder now stages mutations and commits them with Save. Discard
reverts the staged definitions and their pending history. Repeated edits to the
same definition are coalesced into its final payload. Reordering uses a single
revision-checked `reorder_all` request per collection instead of repeated moves.
Failures retain the remaining draft and the last acknowledged server revision.

Previously, a general category or standalone-field deletion synchronously zipped
the entire workspace, including attachments, and migrated linked schema records
merely to detach global-reference metadata. The deletion path now writes a
metadata-only recovery ZIP, commits the affected JSON metadata, retains existing
record/search indexes, and schedules Excel projection in the background.

`python tests/benchmark_general_delete.py [older-SchemaCraft.py]` compares this
path in an isolated workspace with 32 MiB of unrelated attachment bytes. One
local run measured 1,693 ms before and 5.4 ms after. The recovery archive shrank
from 33,590,130 bytes to 579 bytes for an unlinked category; the attachment stayed
at 33,554,432 bytes. This is a synthetic local measurement, not a Windows timing
guarantee. Linked deletions also include the affected schema JSON in recovery.

Regression tests verify revision/order validation, recovery contents, unchanged
workbook bytes and record values, reuse of the record indexes, draft save/discard,
category hover cards and conditional name tooltips, and parentless repeated tabs.
