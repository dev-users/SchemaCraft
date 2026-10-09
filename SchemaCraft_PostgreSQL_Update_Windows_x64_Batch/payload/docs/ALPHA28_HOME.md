# Alpha 28 Home workspace

Alpha 28 rebuilds the Home page as a modern six-column workspace with automatic
row sizing. Data Entry and Builder are structural modules rather than visible
outer cards, so their overview and per-schema surfaces appear as peers instead
of nested boxes.

## Layout

- Data Entry and Builder each span all six columns.
- Each module begins with an aggregate overview across all active schemas.
- Schema surfaces use two columns on wide screens, one column below 1100px.
- Search, Import, and Export retain their compact two-column-span history cards.
- Rows size themselves from their content; collapsed items no longer reserve
  their former multi-row height.

## Data Entry overview

The aggregate surface shows the number of schemas, active records, archived
records, and the latest opened records across every schema. Each schema surface
shows its own counts, two chart slots, and recent record history.

## Independent chart slots

Chart preferences are stored by `primary` and `secondary` slot. Each slot owns
its chart type and field, allowing any combination of percentage bars and
pie/gauge charts. The chart dialog enables its type selector and refreshes the
eligible field choices when the type changes.

Existing preferences using `barFieldId`, `gaugeFieldId`, or the earlier
single-chart shape are migrated in memory when read and written to the new slot
shape after the next configuration change.

## Builder overview

The aggregate Builder surface reports schema count, general definitions,
schema-owned fields and categories, repeated categories, and recent edits
across all schemas. Each schema retains its own structure statistics and edit
history surface.

## Interaction

- Selecting a page title opens that page.
- Selecting a schema title opens that schema in Data Entry or Builder.
- Selecting empty heading space collapses or expands the surface.
- A collapsed surface leaves only its main title visible.
- Schema charts and history rows remain independent interactive targets and do
  not trigger collapse.

