# Alpha 35 unified Home headers

Alpha 35 standardizes Home card headings and simplifies the schema-tab
transition further.

## Identical card headers

Data Entry, Builder, Search, Import, and Export now use the same direct
title-only header markup and the same `home-unified-card-heading` style. Every
heading therefore has identical height, padding, typography, background,
border, and shadow behavior.

The former eyebrow and explanatory text are removed from the Home card headers.
Clicking a title still opens its page, while clicking empty header space keeps
the existing collapse behavior.

## Borderless schema tabs

- Tab buttons have no border.
- The tab row has no border.
- The schema-panel wrapper has no border.
- The selected inner panel remains transparent and borderless.
- Desktop tab height is reduced to 38 pixels; narrow layouts use 36 pixels.
- The active tab extends nine pixels into the shared panel background, removing
  the hard change between navigation and content.

The tabs retain smooth horizontal scrolling, keyboard navigation, panel
animation, and accessibility preferences.
