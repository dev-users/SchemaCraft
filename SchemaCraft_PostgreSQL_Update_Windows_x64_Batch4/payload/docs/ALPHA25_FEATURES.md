# Alpha 25 — unified field behavior and authoritative histories

Alpha 25 removes two concepts from the active application model: category/card
tags and record completeness. Older schemas remain readable, but those legacy
definitions are discarded during normalization and new Excel workbooks do not
create completion columns.

## Home and history

- Home cards have no open/collapse buttons. A title opens its page; unused card
  space toggles the card body.
- History tables contain clickable titles instead of open/delete/clear actions.
  Data titles use every field marked as a result title, with the record ID below.
- Builder history opens the exact edited field or category. Import and Export
  history opens the retained source/destination through its page.
- Export history resolves stable schema IDs to current schema names.
- Profile and operation deletion immediately update server stores, dataset
  snapshots, recent-profile state, saved-search snapshots, and browser caches.

## Entry, Search, Import, and Export

- Entry adds a collapsible recent-profile rail. Record IDs remain read-only and
  copy to the clipboard when selected.
- List fields accept a typed value and offer an optional plus button for adding
  a new schema option. Tab focus stays on data controls; category collapse is
  manual.
- Search result fields and Export result selections use the same removable-chip
  interaction as filters.
- Search history clearing lives with the history table. Search, Import, and
  Export use one Settings value for displayed history rows.
- Import inspection ignores unrecognized columns by default and provides an
  ignore-all action. Export clears the operation note after a successful save.

## Builder model

- The sidebar owns Add Category and Add Field; it omits the active schema name
  and adds a cross-schema change-history dialog with an authoritative clear.
- Text is one type with short/long presentation. List is one type with custom or
  yes/no values. Date is one type with manual Gregorian/Hijri/Persian or
  automatic Gregorian timing.
- Automatic dates and audit-user fields can react to the latest
  unchecked-to-checked transition of a chosen main-category checkbox.
- A checkbox in a repeatable category can be unique across that category's
  cards. Related-profile imports can use this constraint to select exactly one
  source card.
- New root categories are placed at the end or before a chosen root category.
  Child categories are placed after an exact field in their parent. Repeatable
  categories use this mechanism and do not expose a separate placement rule.
- A repeatable card uses a custom numbered prefix only when no title field is
  selected. Attachment names may use fields from every main category and, for
  a repeated attachment, only fields from its own repeated category.

## List-save performance

The slow path was caused by reading the full Excel workbook to synchronize
labels, deep-copying the full record collection, and then letting migration
copy it again before rewriting the workbook. Schema saves now read the current
JSON schema directly and pass a shallow record list into the migration routine,
which owns the single defensive copy. The workbook is still written atomically,
and destructive changes still create an automatic backup.
