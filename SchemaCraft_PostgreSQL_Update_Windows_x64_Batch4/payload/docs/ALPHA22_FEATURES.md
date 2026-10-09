# Alpha 22 feature batch

## Application shell

- The official seven-size Windows ICO embedded in `build-windows-cli.bat` is
  extracted by `build_frontend.py` and reused by startup, closing, privacy,
  browser, and attachment-viewer surfaces.
- Settings is hidden and unreachable outside administrator mode.
- Scrollbars use a wider thumb and white track throughout the application.
- Page-name title rows are permanently absent. The explanation preference now
  controls descriptive/subtitle copy only.
- `app/src/ui_text.json` centralizes general buttons and headings for rebuild-
  time renaming.

## Home

Home uses a logical 6 × 6 card grid with coordinate/size attributes reserved
for a later layout editor. It includes record tags, completion percentage,
list-field pie distribution, and the first three entries from Search, Entry,
Import, Export, and Builder histories. Each history card can clear its own
authoritative history permanently.

## Shared filtering

Search and Excel Export call the same renderer and criteria serializer. The
component supports:

- adjacent empty and non-empty flags;
- number equality, greater/less, inclusive comparisons, and inclusive ranges;
- date equality, before/after, and inclusive ranges;
- live value suggestions narrowed as the user types;
- builder-defined dependent-list constraints;
- removal by clicking the filter label.

The backend evaluates the same typed criteria for indexed and non-indexed
records, and exposes distinct values through `/api/search/field-values`.

## Data entry and readonly views

- Reopening the entry search-field picker preserves its temporary selection.
- Automatic advance follows real focusable form controls and skips headings.
- Image attachments open in a centered, bordered, same-origin viewer.
- Read-only profiles keep the category navigator on the right.

## Histories, export, and settings

- Search/import/export clearing empties the server store and deletes retained
  archives; legacy browser caches are removed rather than used as fallback.
- Export destinations automatically receive the expected `.xlsx`, `.pdf`, or
  `.zip` suffix when the user omits it.
- Admin/user shortcuts open the exact same dialogs as their header controls and
  never change session state directly.
- The default-app creator makes an independent copy with hierarchical options
  to remove histories/users, records/attachments, or the whole schema/data
  workspace.
