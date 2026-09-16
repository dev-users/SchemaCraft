# Alpha 30 Home visual polish

Alpha 30 unifies the Home page around one modern, practical visual language.
The page modules remain structural rather than becoming outer cards, so the
layout avoids nested box-in-box surfaces.

## Section hierarchy

Each main area now uses a short eyebrow label followed by a clear action title:

- Records and forms — Data Entry
- Schema structure — Builder
- Data exploration — Search
- Bulk input — Import
- Files and reports — Export

The hierarchy is typographic and stays outside the content surfaces. A subtle
accent line preserves separation from the page background without adding
another container.

## Summary rows

Data Entry and Builder begin with a compact translucent summary strip. The strip
has a dedicated label area, a restrained accent rail, and divider-led metrics
instead of individual statistic boxes. This keeps the information easy to scan
while preserving a single-row silhouette on desktop.

## Schema tabs

Both Data Entry and Builder use horizontally scrollable, browser-style schema
tabs when more than one schema exists. The selected tab uses a stronger glass
surface, shadow, and bottom accent. The tab list supports arrow keys, Home, and
End and exposes standard `tab`/`tabpanel` accessibility semantics.

Only one schema panel is visible at a time. When the workspace has one schema,
the tab bar is hidden and the schema panel is shown directly.

## Schema content

- Data Entry keeps two independently configurable chart slots plus recent
  record history in one desktop row. Either slot can be a bar or gauge chart.
- Builder uses the same tabs and selected-panel behavior, but contains only
  schema statistics and edit history; it never creates chart controls.

## Surfaces and accessibility

Summary strips, selected schema panels, and operational history cards use
translucent surfaces with subtle borders, saturation, and blur. Internal
sections rely on whitespace and dividers instead of nested cards. A
`prefers-reduced-transparency` fallback replaces these surfaces with solid white
for environments where transparency is reduced.
