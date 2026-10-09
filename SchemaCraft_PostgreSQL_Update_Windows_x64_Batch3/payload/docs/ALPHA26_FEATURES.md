# Alpha 26 — deliberate entry navigation and fast Builder commits

## Data Entry

- Recently opened profiles now appear at the end of the left rail and reuse the
  same visual card component as in-page search results. Their ID remains a
  one-click clipboard action.
- Filling a list or date never advances focus automatically. Tab is the only
  way to move to the next field.
- Date controls accept `DD-MM-YY` or `DD-MM-YYYY`; two-digit years resolve to
  the matching year nearest the middle of the supported calendar range.
- A typed list value must be an allowed option before focus can leave the
  field. The optional plus action adds a new value. For a dependent list, the
  new option is mapped only to the source value in the current record/card.

## Dialogs, histories, and exports

- Dialog action footers consistently place the affirmative action on the right
  and Cancel on its left in the RTL interface.
- Import history has an explicit skipped-row column.
- Export history stores a sanitized copy of reusable configuration. Clicking a
  table-export history row restores its schema, selected fields, filters,
  criteria, related-data option, and attachment option; the destination is
  deliberately not restored.
- Home, Data Entry, Search, Import, and Export each have an independent visible
  history limit. Every limit is a free integer from 1 through 100. Existing
  shared Alpha 25 preferences migrate automatically.

## Builder

- The change-history dialog is scoped to the current schema. In General Fields
  it shows only general-definition changes and identifies that scope in its
  heading. Clearing affects only the displayed scope.
- Category creation asks for the parent first. A root category then asks for
  its position among root categories; a child asks only for its insertion field
  inside the selected parent.
- Related-person field mapping first chooses either main-category data or a
  unique checkbox from a repeated category. Main mode lists all compatible main
  fields; repeated mode lists compatible fields only from the selected
  checkbox's category.

## Builder save performance and recovery

The remaining delay came from rebuilding the complete Excel workbook inside
the HTTP request for every schema edit. Linked general-definition edits also
created a redundant whole-workspace backup before each schema's own destructive
backup logic ran.

In a normal multi-schema workspace, `schema.json` and the in-memory indexed
snapshot now commit first. The Excel workbook is an immediate background
projection of that revision, so ordinary add/edit/delete responses no longer
wait for every record row to be rewritten. Destructive migrations keep their
per-schema automatic backup. A revision marker in the workbook prevents stale
Excel labels from being imported during projection; if shutdown interrupts the
background write, cold launch detects the revision mismatch and completes the
projection before serving that schema. Direct single-schema/test mode retains
the original synchronous atomic schema/workbook pair.
