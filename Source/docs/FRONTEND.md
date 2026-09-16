# Frontend

The generated browser assets keep canonical source wording. At request time,
the local server applies replacements from `app/ui_text.json` to HTML,
JavaScript, and CSS. Edit catalog values and restart the app; rebuilding is not
required for wording-only changes.

## Build model

The browser frontend uses plain HTML, CSS, and JavaScript with no production
framework. `build_frontend.py` generates the runtime files:

| Generated file | Source |
| --- | --- |
| `app/index.html` | `app/src/shell.html` plus page/dialog includes |
| `app/app.js` | Files in `app/src/javascript.manifest` |
| `app/workspace.js` | `app/src/core/workspace.js` |
| `app/styles.css` | `app/src/styles.manifest` |
| `app/ui_text.json` | Runtime catalog copied from `app/src/ui_text.json` |
| Lifecycle files | `app/src/lifecycle/*` |
| Attachment viewer | `app/src/viewer/*` |
| `app/assets/schemacraft.ico` | Icon payload embedded in `build-windows-cli.bat` |

Always edit source files, then rebuild.

## JavaScript order and responsibilities

The concatenated script shares one application scope, so manifest order is an
API contract:

1. `foundation.js`: constants, state, DOM references, common utilities.
2. Page renderers and controllers.
3. `core/filters.js`: the shared Search and Excel Export filter component.
4. `multischema.js` and `advanced.js`: workspace-wide behavior.
5. `runtime.js`: authentication, initialization, lifecycle.
6. `events.js`: final event binding and application start.

`window.fetch` is wrapped to add the active schema header and count active API
requests. Authentication uses an HttpOnly cookie and therefore is not readable
from JavaScript.

## Styles

`app/src/styles/application.css` is the canonical stylesheet. It is divided
into numbered semantic sections in intentional cascade order. The former base/page/
`alpha*` source files were consolidated because later chronological files had
become an implicit override chain.

Do not add a new override file for a feature. Update the owning semantic
section. Use existing variables and shared components before creating a new
selector. `!important` remains only where the existing interaction contract
requires it; new uses should be justified.

## Editable interface text

`app/src/ui_text.json` is the source-of-truth catalogue for general interface
labels that do not come from a schema. Keep each JSON key unchanged and edit
only its value. `build_frontend.py` applies replacements without cascades, so a
short label cannot accidentally alter a longer one. Run the frontend build
after every text change.

## Home and shared filters

Home cards declare `data-grid-x`, `data-grid-y`, `data-grid-w`, and
`data-grid-h` on a six-column/six-row logical grid. Those coordinates are the
stable basis for a later drag/resize editor. The full-width data card creates a
panel for every active schema. Each panel combines record/archive counts, its
own three-record history, and separate clickable percentage and gauge charts.
Every Builder tab has a three-column statistics/chart/history layout. Its chart
column contains two vertically stacked, independently configured slots. Builder
bar comparisons share one stacked bar and render the percentage inside every
segment. Chart names and complete color legends appear in shared hover cards
with counts and percentages, also available when a chart receives keyboard focus.
Clicking a card title opens its page; clicking unused card space collapses or
expands it without a dedicated toggle. History titles open the corresponding
profile, Builder definition, retained import, or retained export. The Builder
card records field/category changes per schema. Chart choices are stored by
stable schema/field IDs in local storage; percentage bars measure populated
records, while the semicircular gauge shows list or checkbox distributions.

Search results are copied into a dedicated window container whose table owns
both axes of scrolling. The window shell stays fixed to the viewport, so wide
tables and long result sets cannot escape the bordered result panel.

Search and Excel Export both render their criteria through `core/filters.js`.
It owns empty/non-empty flags, numeric/date operators and inclusive ranges,
dependent option constraints, click-to-remove labels, and live distinct-value
suggestions.

Entry keeps a collapsible recent-profile list in the left action rail. List
fields render as accessible searchable comboboxes: typing filters their inline
menu, and when there are no similar values that same menu offers to save the
typed text through the runtime option endpoint. There is no external plus
button, and focus cannot leave a non-empty list until its value is selected or
added. Tab order is calculated from visible field controls only, including
fields inside repeated cards. Dates use day, month, and year selects; a dash in
day or month moves to the next date part without becoming data. Category
collapse remains manual.

Settings exposes independent 1–100 page limits for Entry, Search, Import, and
Export, plus independent Home limits for the Data, Builder, Search, Import, and
Export history cards. Home limits default to three.

## General Builder packages

General categories render through the same category tree and field-row visual
language as schema Builder. New general fields and categories are created only
from the side action rail; category surfaces do not introduce separate inline
creation buttons. Root categories, child categories, and their fields are
editable in place and retain general-only actions. General appearance conditions
occupy their own schema-style panel. Their dialogs use a temporary package
schema so the established schema Builder editor, validation, and operator
choices remain the single implementation.

Package conditions refer to category and field keys rather than transient
schema IDs. Serialization excludes a condition when either endpoint is outside
the package; importing a selected subset performs the same check before local
IDs are created.

## Application dialogs

Destructive confirmation, text-entry, and selection workflows use reusable
`dialog` elements inside the application shell. Browser-native `alert`,
`confirm`, and `prompt` calls are prohibited because they cannot share the
application's Arabic layout, button order, accessibility styling, or lifecycle
guards.

## Privacy and lifecycle

- `startup.html` is the first page in the borderless full-screen kiosk and
  displays the logo with the centered user form.
- It changes from loading to audit-user selection only after backend readiness.
- The main shell starts with `session-pending`; header, pages, dialogs, and
  toasts remain invisible until session validation and schema load succeed.
- Shutdown asks for confirmation in the main app, revokes the browser session,
  sends a `BroadcastChannel` close event to auxiliary SchemaCraft windows, and
  replaces the main page with `closing.html` in the same full-screen kiosk.
- Startup, closing, privacy, viewer, browser favicon, and the Windows executable
  all use the exact multi-resolution ICO payload embedded in the build script.

## Stable DOM API

JavaScript controllers use element IDs and `data-*` attributes as their DOM
API. The generated [API reference](API_REFERENCE.md) catalogs every source HTML
ID and named JavaScript function.


General definitions now share one tab rail, including an always-present tab for
standalone fields. The shared preview also tabs every parentless repeated
category. `general-draft.js` stages general mutations, handles Save/Discard and
revision-checked commits, and protects pending changes from metadata reloads.
`hover.js` centralizes styled, truncation-aware label tooltips and Builder
field and category detail cards; it suppresses native title duplication and preserves
accessible labels. Category detail content is created only when requested.

Category type validation compares against the persisted schema category, only
outside general-definition editors. Temporary general-editor placeholders must
not inherit the active schema’s record-count restriction. The backend continues
to validate changes propagated into real schemas.

Home retains its panels between visits and coalesces overlapping refreshes.
`/api/home/schema` compares schema/workbook file signatures before opening Excel;
unchanged responses omit the schema payload. Changed workbooks still synchronize
Excel field labels. Server snapshots are bounded to 64 schemas. Client counts
are cached by dataset signature and query (including selected values), with a
200-entry bound and failed requests removed for retry. Hidden tabs load their
charts when selected; active charts share in-flight field-value requests.

Excel label synchronization reads the two header rows once per worksheet and
shares them between main categories. This avoids per-field XML reparsing in
openpyxl’s read-only worksheets, including during the first Home/schema load.

Attachment hover metadata is derived from the live file control, including its
pending upload name; saved gallery cards reuse the same resolver. Navigator
hover is disabled in Entry/Builder/read-only, including native mouseover titles.
`_record_report_sections` supplies PDF fields in read-only order with Builder
widths, explicit false/zero values and attachment filenames. `readonly_pdf_grid`
places them in six RTL columns without dense backfilling; bounded continuation
rows prevent oversized spanned cells from producing sparse PDF pages.

The profile PDF field picker rebuilds from checked schema rows each time it
opens, preserving choices for temporarily unchecked schemas. The appearance
dialog sends independent `show_profile_image` and `show_attachments` booleans;
cancelling it creates no export. `_profile_pdf_media` resolves files beneath the
attachment root and maps portraits to their original category/card. Pillow
orients and scales embedded images; pypdf appends PDF attachments after the full
report without changing their page dimensions. Both packages are included in
the pinned requirements and Windows offline wheels.

Tab widths use shrinkable natural content sizing; previous fixed label caps no
longer truncate labels when the tab row has spare room.

Tab labels must not use percentage inline padding: browsers omit that padding
from intrinsic width calculations, causing ellipses even on uncrowded rails.
Tabs now own fixed inline padding and use shrinkable max-content widths, while
the label spans have zero padding. Chromium checks cover full labels at 900px
and compact, non-overflowing rails at 240px, including nested repeated tabs.

Profile export inspection aggregates per-ID responses. Checkbox identity is the
pair `(record_code, schema_id)`; field selectors deduplicate schema definitions.
Input changes require a fresh inspection. The `profile_pdf_batch` export type
sends `record_codes` and `schema_ids_by_record`; the destination picker selects a
ZIP. The backend invokes the existing PDF renderer independently per ID, then
writes each completed report to the archive. Empty schema selections do not
fall back to all schemas in a batch. A generation failure prevents saving the
entire batch. The history configuration preserves both new properties.

The PDF selection matrix stores cell choices by `(record_code, schema_id)` and
ID inclusion separately. `selectedProfileExportInputs` is the shared effective
selection for report fields and export payloads. Column controls update all
available cells, preserving excluded IDs; the ID inclusion master and schema
masters synchronize checked/indeterminate states independently. Unavailable
memberships have no checkbox. Re-rendering after changes to information formats
retains row inclusion and cell choices. Export validation prevents silently
omitting included IDs whose schema selection is empty.

Multi-sheet Excel imports use `sheet_inspections`, `categories`, and `all_fields`
from `/api/import/inspect`. Each `sheet_mappings` entry contains sheet name,
category ID, column mapping, and merge/replace mode. `__main__` supports native
exports containing several main categories. Special mappings include person ID,
minor card number, linked person ID, and parent card number/internal ID.

`POST /api/import/preview` normalizes and validates a proposal without writing.
The server retains up to four 30-minute reviews, bound to schema and audit user,
with schema/workbook fingerprints and stable generated identities. Only public
field differences and a random review token reach the browser. Dates in public
changes use ISO values. `POST /api/import/apply-review` accepts the token and
per-profile change IDs, rechecks the fingerprints, reconstructs selections from
the server proposal, validates the final dataset, then backs up and writes once.
Multi-sheet direct commits are blocked; the legacy single-sheet API remains
available for older callers. A completed token cannot be reused. History retains
actual changes rather than the entire unapproved proposal.
