# Alpha 53 — header hierarchy and consistent workspaces

The global header now owns two levels of navigation. Its first row selects the application page; its second selects the schema or special scope. The same live navigation elements move into that second row, preserving their event handlers and navigation guards. Home has no schema row, and Settings retains its own dialog navigation. Ordinary schema names are text-only, with a white underline and stronger text on the active name. The searchable All Schemas control remains available for long lists.

The Alpha 51/52 connected-card and blue-cutout variants were removed. Panels use shared corner, border, spacing and shadow tokens. Side rails share a 240px desktop width, reduce together to 216px on smaller desktops, and stack at narrow widths. The Builder navigator has its own visible scrollbar and a bounded height based on the measured header. Dialog close controls contain one close glyph; redundant generated icons are omitted from navigation labels and history rows.

The main-category portrait again uses the previous 190px-wide, 3:4 frame with no capped scrolling box. Child categories and following field groups span the complete category width below the portrait group. Narrow screens stack the portrait above the fields.

Normal date/list value changes do not call or schedule focus. Explicit Tab navigation and date separators continue to work. Repeated-tab names update in place when card membership/order is unchanged, preserving the focused element. Validation of required controls remains active.

Validation includes the Python suite and browser DOM workflows: header mounting and page switching, portrait/child structure, single close glyphs, stable repeated-tab nodes, explicit Tab after date/list changes, history filtering and existing data workflows. The test environment does not include a native Windows desktop or a browser engine for pixel-rendered screenshots; visual rules are checked through source and DOM/computed-style assertions.
