# Alpha 47: general Builder and dual charts

## Home Builder charts

Every Builder tab now contains two chart slots in one chart column. The slots
are stacked vertically and each stores its own chart type and structural data
source. Existing single-chart preferences migrate into the first slot; the
second starts with the field-type distribution.

Bar comparisons use one stacked bar for all values. Each segment displays its
percentage directly, and the centered legend retains the label and count.

## General fields and categories

The general-definition scope behaves like a reusable general schema:

- Root and child categories use the normal Builder category surface.
- Fields at every tree depth use the normal editable field rows.
- Category and field actions include reordering, editing, deletion, adding
  children and fields, and adding or editing appearance conditions.
- General-only actions, including adding a definition to a schema and breaking
  a link, remain available.
- The right navigator includes the complete nested general tree.

## Portable appearance conditions

A reusable category tree stores appearance conditions with package-local
category and field keys instead of schema IDs. When the package is added to a
schema, fresh local IDs are assigned and every valid condition is remapped.

A condition is copied only when its source field and target field/category are
both present in the selected imported package. Rules that depend on anything
outside that package are deliberately omitted, so imports never create broken
references.

## Compatibility

Legacy general categories without a `category_tree` are normalized into a
single-root tree when opened. Existing linked schema IDs remain stable when a
general package is updated, preserving records and relationships.
