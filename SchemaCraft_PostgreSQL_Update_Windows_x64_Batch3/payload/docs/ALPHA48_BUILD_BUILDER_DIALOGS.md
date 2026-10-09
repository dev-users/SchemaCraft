# Alpha 48: build, Builder, and dialog fixes

## Reliable Windows user package

The build log showed that PyInstaller completed successfully and that the old
batch implementation failed only while creating the clean user copy.
`make_user_copy.py` now owns that step. It validates every expected frontend and
asset path, recreates the release directory deterministically, and applies the
Windows hidden attribute without invoking `attrib.exe`. Build failures now name
the exact missing file or directory.

## Two independent Home Builder charts

The chart column is a two-row grid. Shared chart components no longer assign a
grid area at all; Data and Builder layouts own their placements independently.
The first Builder chart is fixed to row one and the second to row two, with both
filling the complete width and exactly one half of the chart column. A rendered
computed-style test protects the final cascade rather than merely checking that
an early CSS declaration exists.

Circular charts display only the enlarged centered chart and its total. Every
SVG segment contains both a native tooltip and a visible application hover key
with the structural field name, count, and percentage. Stacked bars keep all
compared values in one bar and display each percentage directly.

## General Builder parity

General fields and categories use the schema Builder's peer-level category
cards, field rows, editing actions, conditions, and heading-based collapse
behavior. Child categories are no longer rendered as a nested box inside the
parent card; like schema categories, each is a complete category card with a
parent badge. Their creation commands stay in the side panel. The unrequested
inline “add field,” “add child category,” and direct condition buttons were
removed from the category surfaces. Appearance conditions remain available in
the same field/category editor dialogs and in the dedicated conditions panel.
General-only link, import, and package actions remain available.

## Styled application dialogs

All browser-native alerts, prompts, and confirmations were removed from the
application sources. Reusable confirmation, selection, and text-entry dialogs
now provide purpose-specific titles and actions while preserving SchemaCraft's
RTL layout and consistent cancel-button placement. The visual Windows builder
also uses builder-owned modal windows instead of operating-system message boxes.
