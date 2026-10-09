# Alpha 44 application and Builder workflow

Alpha 44 extends the Alpha 43 source without changing its workbook format.

## Desktop lifecycle

- Production launches use one isolated Chromium/Edge kiosk profile. The
  surface is borderless and full-screen, with no title bar, Close, Minimize,
  Maximize/Restore, or resize controls.
- Startup displays the SchemaCraft logo and centered current-user form on a
  transparent card.
- A successful login replaces that same full-screen surface with the main
  application; no second window is opened and no resize transition occurs.
- Confirmed shutdown invalidates the user session and expires its cookie, then
  replaces the application with the centered closing view in the same kiosk.
  The local server, kiosk process tree, and isolated browser profile are all
  closed or removed before SchemaCraft exits.

## Data Entry and Search

- Required editable lists cannot lose field focus while empty.
- Dependent editable lists remain typeable, filter their assigned values, and
  can add a new value only for the dependency value currently selected.
- Tab order includes attachment pickers, attachment-removal controls, and
  repeatable-card add/delete buttons.
- Search-filter selections are removable directly from their selected chips in
  both schema and all-schema search.

## Builder

- Schema fields use a six-unit row. Available widths are 1, 2, 3, 4, 5, and a
  full row; legacy normal and wide values migrate to 1 and 4 respectively.
- Main and repeatable categories may have parents. A child can follow a chosen
  parent field or appear at the end of its parent category.
- Field and category import selectors include general definitions. Adding a
  general definition from the general workspace first asks for its destination
  schema and then opens the normal schema editor for final specifications.
- Globalizing a category retains its descendant categories and fields as one
  linked package.
- The general-definition navigator scrolls independently, and linked-item
  disconnect controls use an unlink icon.
- Builder history names added/deleted items and their location. Edits identify
  category type, parent, appearance conditions, field name, or field type when
  those values changed; other changes use the concise settings-edit fallback.

## Collapsing

Dedicated collapse buttons were removed from collapsible application panels,
Entry categories, Builder categories, and Builder navigator branches. Clicking
unused space beside a title toggles the surface; clicking the title or an action
keeps its normal navigation or edit behavior.

## Settings

Builder history has its own page-row preference, separate from Home Builder
history and the other page histories.
