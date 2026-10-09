# Alpha 29 tabbed Home dashboard

Alpha 29 refines the Home hierarchy introduced in Alpha 28. Page titles are
standalone headings over the Home background rather than separate title cards.

## Data Entry

- A compact single-row strip reports aggregate schema, active-record, and
  archived-record counts.
- With one schema, its dashboard appears directly beneath the strip.
- With multiple schemas, a horizontally scrollable browser-style tab bar is
  shown and exactly one schema dashboard is visible at a time.
- Tabs expose `tab` and `tabpanel` semantics, support Home/End and arrow-key
  navigation, and do not change the application's active Entry schema until the
  schema title itself is selected.
- Each visible schema dashboard presents chart slot one, chart slot two, and
  recent-record history in a single desktop row. Responsive layouts move the
  history below the charts and ultimately stack all three sections on small
  screens.

Chart slots remain independently configurable, so any bar/gauge combination is
supported.

## Visual structure

The Data and Builder modules remain transparent structural wrappers. Their
headings use typography, a short accent rule, and text shadow for clarity over
the Home image. Only the summary strip and actual data surfaces receive a card
background, preventing a box-inside-box appearance.

