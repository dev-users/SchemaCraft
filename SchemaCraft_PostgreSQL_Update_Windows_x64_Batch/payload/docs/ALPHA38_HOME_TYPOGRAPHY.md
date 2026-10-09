# Alpha 38 Home typography

Alpha 38 enlarges Home-page typography while keeping the rest of SchemaCraft at
its established scale.

## Typography

- Inherited Home text is scaled to 150 percent.
- Explicit Home sizes are increased for section titles, statistic labels and
  values, schema tabs, schema names, compact schema tags, chart labels and
  values, chart legends, and history metadata.
- Section titles receive the strongest increase so they remain clearly above
  the enlarged supporting text.
- The mobile title size is reduced slightly to protect narrow layouts.

## Hover behavior

- The blue background tint introduced in Alpha 37 is removed.
- Dashboard cards, statistic tiles, charts, and history rows keep their resting
  background while hovered.
- Hover feedback is limited to a restrained neutral shadow and one- or two-pixel
  lift.
- Reduced-motion preferences disable the lift animation.

## Scope

These changes are scoped under `.home-view`; Builder, Entry, Search, Import,
Export, Settings, and dialogs retain their previous type scale.
