# Data model

## Workspace metadata

`data/workspace.json` identifies schemas, their folders, the active schema, and
cross-schema mapping profiles. `WorkspaceManager` validates IDs and resolves a
`SchemaContext` containing the schema JSON, workbook, and attachments path.

Each active schema lives under `data/schemas/<schema-folder>/`:

- `schema.json`: metadata-driven application definition.
- `<schema-name>.xlsx`: authoritative records.
- `attachments/`: stored file fields.

Workspace-wide files include global definitions, identity registry, settings,
audit-user names, and operation histories.

General category definitions may contain a complete `category_tree`. Every
category node and field has a package-local key. An optional `conditions` list
uses `source_field_key`, `target_key`, and `target_type`, allowing the same
package to receive fresh schema IDs safely on every import. Only conditions
whose source and target both exist in the imported tree are materialized.

## Schema JSON

The schema has a stable `schema_version`, revision, `app` settings, and ordered
categories. Categories are `main` or `repeatable`; repeatable categories may
reference another category through `parent_category_id` and an exact placement
field through `parent_field_id`. `card_name_prefix` supplies the numbered
fallback title when `card_title_field_id` has no value. Fields use stable IDs,
typed behavior, validation, search settings, appearance conditions, automatic
updates, attachment naming, and optional global-definition references.

Linked category-package instances also keep `global_tree_ref` and
`global_tree_key`; imported conditions keep `global_tree_ref` and
`global_condition_key`. Those values support in-place configuration updates
without changing local category, field, or record IDs.

User-visible labels can change without changing stable IDs. The backend
normalizes and validates every schema before saving it.

Text fields use one public type with a short/long presentation option. Lists use
one public type with either a custom option set or the built-in yes/no values.
Dates use one Builder type: manual Gregorian, Hijri, or Persian; or automatic
Gregorian on creation, on a saved edit, or on the latest unchecked-to-checked
transition of a configured main-category checkbox.

A `user_name` field can capture the creator, the user who saved an existing
record, or the user active at the latest unchecked-to-checked transition of a
configured main-category checkbox. The save-on-edit mode is applied only when
the schema also contains the last-update date field.

A checkbox inside a repeatable category may set
`unique_checked_across_cards`. The backend then rejects a record containing
more than one checked card in that category. Related-profile imports use such a
checkbox to select exactly one source card. Repeatable categories do not have
tags or markers; legacy tag metadata is discarded during schema validation.

## Excel repository

The main sheet stores one row per record. Technical row 1 contains stable
headers; visible row 2 contains display labels; data begins on row 3.

Main technical columns include:

- `_record_id`, `record_code`, `created_at`, `updated_at`
- `_archived`, `_archived_at`

The former record-completeness columns are not part of new workbooks. Legacy
completion field definitions are removed when an older schema is normalized.

Each repeatable category has a separate sheet. Its rows include `_child_id`,
the parent `_record_id`, `record_code`, `minor_id`, timestamps, optional linked
record code, and optional parent-child ID for nested repeatable categories.

## Identity and links

Record codes are globally unique across workspace schemas. The identity
registry tracks where a person appears. Link/import workflows preserve schema-
specific values while allowing explicit field mappings between schemas.

### Schemas following profile membership

New schema creation accepts an optional `profile_source_schema_id`. Existing
source profiles immediately receive blank destination profiles with the same
visible `record_code`; internal row UUIDs remain independent. The destination
keeps its own fields, categories and editable values. Empty placeholders bypass
required business fields until the user fills them normally.

Source additions, including imports, create blank destination profiles. Source
deletions remove destination profiles and their data and attachments using the
normal deletion cleanup. Destination changes and deletions never modify the
source. Archiving a source profile does not delete its destination profile.

The workspace catalog stores `profile_source_seen_codes` as a membership
baseline. Destination-only deletions remain deleted during subsequent source
edits and application restarts; removing and re-adding that ID at the source
creates a fresh blank destination profile. Existing destination values are
never copied over from the source. Chained relationships are supported;
invalid source IDs and relationship cycles are rejected.

Writes are serialized and synchronization runs after the source workbook is
committed. A locked destination workbook does not roll back the source save:
background reconciliation retries, and startup also reconciles pending changes.
This is eventual synchronization, not a cross-workbook transaction. A source
schema with dependents cannot be deleted; it can be archived, or its dependent
schemas can be deleted first.

## Layout-only fields

Layout-only fields use type `spacer` and retain a normal field ID and configured
width, but their label is empty. Multiple unnamed spacers are valid. Schema
normalization clears value-related settings; spacers have no record values,
validation, search columns, import mappings or Excel columns. They remain in
schema definitions and backups so layouts round-trip. Value-based conditions
cannot use them as sources. Converting a data field into a spacer removes its
values during schema migration; Builder requests confirmation when records exist.

## Attachments

Only validated relative paths under the current schema's attachment directory
are accepted. Names are sanitized for Windows compatibility, extensions and
request sizes are bounded, and generated destinations are collision-safe.

## Histories and backups

Search, import, and export histories are bounded JSON stores. Their page-level
display limits are independent (`entry_history_limit`, `search_history_limit`,
`import_history_limit`, and `export_history_limit`). Home has a second,
independent set for its Data, Builder, Search, Import, and Export cards
(`home_*_history_limit`); every Home card defaults to three rows. Legacy
`home_history_limit` is migrated into all five Home values. Exported/imported
source files can be retained under `data/` for later opening. Deleting a record
purges it from saved-search snapshots; deleting/clearing history removes the
authoritative entry and retained file so browser caches cannot restore it.
Backups are ZIP
archives validated against path traversal, duplicate entries, excessive entry
counts, and excessive expanded size.
