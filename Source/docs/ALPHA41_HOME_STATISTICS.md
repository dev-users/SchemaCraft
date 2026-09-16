# Alpha 41 reconciled Home statistics

Alpha 41 refines the Home statistics introduced in Alpha 39 and Alpha 40 while
preserving the existing Data Entry and Builder tab behavior.

## General statistics

- General statistic tiles no longer show the decorative corner glyph.
- Each tile centers its label and count.
- Data Entry keeps up to three configurable statistics, but the add action is a
  standalone plus control instead of another statistic tile.

## Builder overview

The Builder overview contains exactly three top-level surfaces:

1. A compact schema-count tile.
2. A category surface split into total, repeatable, and independent sections.
3. A field surface split into total, repeatable, and independent sections.

The repeatable and independent sections include miniature pie indicators. Each
pie uses the corresponding category or field total as its denominator and has
an accessible Arabic description containing the value, total, and percentage.

## Builder tab statistics

Each Builder tab retains separate category and field groups. Every group begins
with its total and then stacks complete structural partitions beneath it:

- Main and repeatable.
- Independent and parented.
- General and schema-specific for schema tabs.
- Uncategorized fields are included in both applicable general-field
  partitions so those rows continue to reconcile with the field total.

Charts, history tables, tab selection, and the active-tab navigation rule are
unchanged.
