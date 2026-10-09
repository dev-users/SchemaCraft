# Alpha 31 Home metric tiles

Alpha 31 focuses the Data Entry and Builder Home modules on their numbers. It
removes the additional overview label and summary title, leaving a direct row
of individual statistic tiles followed by the existing schema content.

## Statistic tiles

- Every metric has its own softly colored translucent surface.
- The short metric name appears above a larger tabular number.
- A restrained decorative mark differentiates the tiles without suggesting a
  trend or adding another text label.
- General statistics use a responsive full-width grid.
- The selected schema's own statistics appear immediately above its charts and
  history in Data Entry, or above its history in Builder.

The tiles use lavender, green, amber, and blue tones in rotation. They collapse
to a denser two-column arrangement on small screens and retain a solid fallback
when reduced transparency is requested.

## Schema navigation rail

The schema selector is now one continuous rounded translucent rail. Inactive
tabs are visually quiet; the selected schema uses a white inner surface, subtle
shadow, and thin accent indicator. Horizontal scrolling uses smooth motion and
scroll snapping, while arrow-key, Home, and End navigation remains unchanged.

## Content order

Data Entry keeps its two independently configurable charts and history table.
Builder remains chart-free. No table or history behavior changed in this visual
pass.
