# Alpha 33 attached schema tabs

Alpha 33 adapts the reference tab composition to SchemaCraft's neutral Home
palette. Data Entry and Builder now read as complete workspaces rather than a
heading followed by unrelated surfaces.

## Workspace hierarchy

Each Data Entry and Builder workspace contains, in order:

1. The page title.
2. The general statistic cards.
3. One schema tab for every available schema.
4. The selected schema panel.

The former eyebrow and explanatory line are omitted from these two workspace
headings. Search, Import, and Export retain their existing compact card design.

## Attached schema tabs

The tab bar no longer has its own rounded rail. Every tab rises directly from
the workspace, with rounded upper corners and a straight lower edge. The active
tab shares its border and neutral background with the schema panel and overlaps
that panel by one pixel, producing one continuous silhouette.

Tabs remain horizontally scrollable with smooth motion and scroll snapping.
They keep their accessible `tab`/`tabpanel` semantics and keyboard navigation.
The tabs are now shown even when only one schema exists, because each schema is
represented explicitly.

## Preserved content

- General totals remain neutral statistic cards beneath the page title.
- Schema-specific totals remain compact tags beside the schema name.
- Data Entry retains both configurable charts and its history table.
- Builder remains chart-free and retains its edit history.
- Collapse and title-navigation behavior is unchanged.
