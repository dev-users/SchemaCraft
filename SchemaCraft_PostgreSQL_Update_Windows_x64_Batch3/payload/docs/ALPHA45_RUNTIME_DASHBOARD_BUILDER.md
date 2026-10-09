# Alpha 45 runtime text and dashboard behavior

Alpha 45 extends Alpha 44 without changing the workbook or record format.

## Runtime interface text

`app/ui_text.json` is now shipped beside the generated frontend. SchemaCraft
reads it when serving HTML, JavaScript, and CSS, so changing a value takes
effect after restarting the app and does not require a frontend or executable
rebuild. Keys remain stable source phrases; only their values should be edited.

## Home

- Up to three custom Data Entry statistics are stored in
  `data/workspace-settings.json`, so they survive the isolated browser profile
  and application restarts.
- Saved statistics are visible in normal and administrator modes. Their add,
  edit, and delete controls exist only while administrator mode is unlocked.
- Home history text is more compact and every clipped title/detail exposes its
  complete text through the native hover tooltip.
- Data Entry and Builder schema panels use three equal desktop columns.
- Pie charts show one larger centered chart and its total. Segment labels and
  counts appear on hover instead of in a permanent legend.
- Builder comparison charts render all parts in one stacked bar with distinct
  colors.

## Builder

- Destination-schema prompts display schema names, not internal IDs.
- Adding a general category starts with its complete field and descendant tree
  selected. Administrators may deselect individual fields or child categories
  before inserting it.
- A new general category may select any existing general category/tree node as
  its parent. The child and its fields are stored inside that reusable package.
- Builder main panels, the category navigator, the action rail, schema
  categories, general categories, and nested general categories collapse from
  unused title-row space without separate collapse buttons.

## Data Entry

Selecting or creating a value in an editable list explicitly restores focus to
that field. Date-part navigation keeps its specialized behavior.
