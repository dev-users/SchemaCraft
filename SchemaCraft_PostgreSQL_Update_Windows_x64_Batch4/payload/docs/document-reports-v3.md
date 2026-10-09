# Document-first Advanced Reports (v3)

## Start here

Open **Export → Advanced Reports → Open document editor**. The editor opens in
a separate RTL dialog. Closing or pressing Escape saves the draft first; a failed
save keeps the editor open. Reopening preserves the document and selected element.
Nested dialogs close independently. Write a paragraph, insert an
atomic field token from the category browser, then add document or data blocks.

Choose **Collection Report** for one document over a selection, or **Per-profile
Report** to execute the entire document independently for every selected profile.
A collection root deliberately has no Current Profile. Put profile fields inside
a profile repeater, or choose per-profile mode. Moving content never rebinds its
field contexts; use the clickable Problems panel to find invalid references.

Drafts autosave as native JSON. **Save Ready Version** creates an immutable
version. **Generate Report** opens Parameters / Records / Output / Review, and
uses a Ready Version, not subsequent draft edits. Preview explicitly uses the
current draft and the same structured PDF renderer as final generation.

## Implemented

- Structured text and field/parameter/calculation/system tokens; headings 1–3,
  paragraph alignment, block bold/italic, sections, proportional layout rows,
  dividers, spacers, explicit page breaks, local PNG/JPEG images and automatic TOC.
- A4/A3/Letter/Legal pages in portrait or landscape, RTL, configurable safe
  margins/font size, embedded DejaVu fonts, repeated header/footer content,
  optional first-page-specific header/footer content, current/total page tokens,
  vector charts, selectable PDF text, wrapping tables with repeating column
  headers, and TOC numbers/links obtained from final layout passes.
- Explicit profile/card/row/group contexts; stable schema/category/field IDs;
  nested card repetition only along actual parent category relationships.
- One nested ALL/ANY/EXISTS filter representation for tables, charts, repeaters,
  visibility and calculations. Conditions inside an EXISTS/card scope evaluate
  against one card. Separate EXISTS clauses may match different cards.
- Schema-aware numeric, text, checkbox, choice, multi-choice and date handling.
  Yes/No is a choice, not a boolean. Numeric-text fields cannot be summed.
  Gregorian/Hijri/Persian values are not implicitly converted between calendars.
- Typed run parameters, defaults, required validation and numeric bounds; token,
  filter, arithmetic and filename use. Run presets support prompted values.
- Repeaters with filters, multi-sort, limits, empty text, page-per-item behavior,
  nested body containers, item index/count/first/last values and inline joins.
- Tables with field/parent-profile/row-number/calculated columns, relative widths,
  column reordering, grouping, column totals and subtotals. Card row count differs
  from distinct profile count. Wide tables produce a validation warning.
- Safe structured arithmetic, explicit percentage/ratio operands, reusable
  calculation references, dependency-cycle rejection, age/date difference,
  count/nonempty/distinct/sum/average/min/max/median and source explanations.
  Division by zero produces an explained undefined value, never NaN/Infinity.
- Direct-data vertical/horizontal bar, line, pie, donut, stacked and 100%-stacked
  charts; optional series, Gregorian date grouping and explicit Top N/Other.
- Versioned reusable document blocks (including charts, tables, sections,
  calculations-as-blocks, and branding rows). Insert linked to Latest Ready or
  a pinned version, or insert an independent copy. Runs record resolved versions.
- Global new-document page defaults, default header/footer and profile safety cap.
- Server-side worker generation, progress, cancellation, strict/tolerant behavior,
  combined PDF / separate PDFs / ZIP, safe dynamic filenames, and explicit
  Completed/Partial/Failed/Cancelled states. Browser closure does not cancel a
  running worker while the application process remains alive.
- Immutable generated outputs with Ready Version, source/schema snapshots,
  parameters, selection rule, actual selected profiles, operator/time, component
  versions, errors and calculation traces. Inspection reads historical snapshots,
  never silently refreshes from live workbooks.

## Boundaries still requiring follow-up

This is a substantial replacement, **not completion of every item in the supplied
product specification**. In particular:

- The authoring canvas shows A4 sheets at explicit page breaks. Automatic
  overflow pagination, exact TOC page numbers and all final wrapping are visible
  in PDF Preview, not continuously repaginated in the editable DOM.
- Formatting is block-level; arbitrary mixed-font/range-level rich text, track
  changes and general Word compatibility are not implemented.
- Page-size/orientation, first-page-specific headers/footers and current/total
  page tokens are now supported. Page tokens are intentionally limited to page
  chrome (headers/footers). Oversized layout rows are allowed to split when the
  PDF renderer can do so; pathological rows still fail explicitly instead of
  being silently cropped or truncated.
- Standalone chart/table **style preset** libraries, a centralized asset manager,
  and automatic retention/purge policies are not implemented. Images/branding
  can be saved as reusable blocks. Stored history is retained until managed by
  the workspace owner; snapshots can contain sensitive report data.
- Grouping is supported inside tables, but a separate grouped-summary source
  browser is not provided. Numeric parameter bounds, calculated table columns,
  and system first/last tokens are exposed in the editor; more complex row
  formulas still have narrower UI exposure than the engine. Reusable components
  with external calculation or parameter dependencies require those definitions
  in the destination template; missing definitions produce validation errors.
- Batch workers survive browser closure, not application-process termination.
  Interrupted runs become Failed on reopening, with an explicit reason; they do
  not resume automatically. Evaluation/preflight happens before the PDF worker
  starts, with explicit safety limits rather than silent truncation.
- The new immutable run history is separate from the older general Export
  History table. Downloads use the browser download location rather than the
  older native export-location picker.
- Legacy Markdown/v1/v2 templates stay untouched in their original stores. Old
  backend APIs and regression fixtures remain available for compatibility, but
  the old report wizard is no longer loaded. There is no automatic migration or
  new in-editor legacy-template viewer.

## Architecture / security

`schemacraft_document_v3.py` owns structured evaluation, validation, PDF rendering,
JSON stores and worker runs. `SchemaCraft.report_api` routes `writer_*` actions
**after the existing require_builder_access guard**. There is no second report
authorization system. The uploaded application uses builder-unlocked access for
Advanced Reports; no new field-level ACL model is invented.

Source access uses the existing workspace contexts, workbook lock, snapshot API,
field definitions and display utilities. Reports never write to source workbooks.
Filters/calculations/hidden blocks also validate their field references. No raw
SQL, scripts, eval, imported HTML, remote fonts or remote images are executed.

Native report storage is under `data/document-reports/`: drafts, immutable Ready
Versions, immutable component versions, presets, settings, run snapshots and
outputs. Draft saves are revision-checked and atomic. There are no delete or
overwrite endpoints for Ready Versions or completed outputs.

Frontend source: `app/src/pages/exchange/document-writer.js` and
`app/src/styles/document-writer.css`. Manifests and generated bundles are updated.
Old report sources remain on disk for legacy reference but are not bundled.

## Verification

Commands:

```sh
python build_frontend.py
python -m unittest discover -s tests -p 'test_*.py'
npm ci
npm run test:ui
npm run test:writer
```

The new tests cover cross-card filtering, context changes, deleted IDs, typed
parameters, choice identities, numeric-text fields, safe arithmetic/cycles,
group calculations, chart shapes, long-table pagination, TOC, Arabic PDF layout,
version/restore behavior, pinned components, immutable snapshots, authorization,
unchanged source workbooks, and real API-backed editor interactions.

PDF pages were rasterized for visual QA only; final PDFs themselves remain text
and vector based. Chromium download was unavailable in this environment, so
visual browser screenshots and Windows executable building remain release checks.
