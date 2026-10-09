# Alpha 39 Home information architecture

Alpha 39 completes the Data Entry and Builder dashboard workspaces while keeping
Search, Import, and Export unchanged.

## Data Entry

- The general strip reports schema count, total profiles, archived profiles,
  and non-archived profiles.
- Administrators may add up to three optional metrics. Each metric can aggregate
  filled records, checked records, or distinct values for chosen fields across
  one or more schemas. These dashboard preferences stay local to the app.
- Every schema name appears only in its browser-style tab. Selecting the tab body
  changes the visible schema; selecting its name opens that schema in Data Entry.
- The active schema panel centers its compact profile statistics and retains the
  established history plus two independently configurable charts.

## Builder

- Builder always starts with a dedicated **general fields and categories** tab,
  followed by one tab per schema. A schema tab name opens that schema in Builder.
- The overview separates schemas, category structure, and field structure. It
  reports main/repeated placement, independent/child placement, and
  general/schema-specific sources.
- Each active tab is a single borderless three-column surface: structural
  statistics, a configurable chart, and edit history.
- Builder charts can use a percentage-bar or semicircular pie/gauge presentation
  for category kind, category parentage, category source, field placement, field
  parentage, field source, or field-type distribution.
- General-definition statistics additionally report fields that are not attached
  to any category.

## Navigation and accessibility

- Tab labels are real tab controls with `aria-controls`, `aria-selected`, and
  keyboard navigation.
- The schema-name span is a separate navigation target, so users can either
  inspect a dashboard or enter its corresponding working page.
- Narrow layouts move Builder history below the statistics and chart, then stack
  all three sections on phones.

## Typography

Home typography now uses a balanced 125-percent scale instead of Alpha 38's
150-percent scale. Titles remain prominent, while statistics, tabs, chart labels,
legends, and history metadata are compact enough for dense operational screens.
