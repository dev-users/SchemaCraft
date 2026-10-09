# Alpha 37 Home refinement

Alpha 37 is a visual-only Home dashboard refinement. It does not change schema,
record, history, chart-selection, or persistence behavior.

## Seamless schema tabs

- The schema tab strip has no block or inline padding.
- The former eight-pixel reserved strip and active-tab pseudo-element bridge are
  removed.
- The panel surface overlaps the tab edge by one pixel, so the selected tab and
  its content render as one continuous surface without a visible gap.
- The first RTL tab remains flush with the right content edge.

## Visual hierarchy

- All five Home card titles use the same larger heading treatment.
- General statistic labels, schema names, schema tag labels, and chart field
  names are slightly larger.
- Home-only subtitles and explanatory copy are removed, including the chart
  configuration explanation. Functional field labels and the selected schema
  context remain.

## Shape and interaction

- Workspace, tab, content, metric, and operation-card radii are reduced for a
  cleaner and less inflated shape language.
- Cards remain neutral at rest.
- Hover-capable devices receive a short pale-blue background transition, light
  elevation, and restrained shadow on dashboard cards, metrics, charts, and
  history rows.
- Motion is disabled when the operating system requests reduced motion.

## Source locations

- Home structure: `app/src/pages/home/home.html`
- Home behavior: `app/src/pages/home/home.js`
- Canonical styling: `app/src/styles/application.css`
- Regression coverage: `tests/test_alpha37_home_refinement.py`
