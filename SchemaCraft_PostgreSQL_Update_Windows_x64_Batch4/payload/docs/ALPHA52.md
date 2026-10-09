# Alpha 52

- Static and dynamically created buttons use the existing shared icon sprite. Common save, delete, discard, cancel, search, edit, archive and backup actions use consistent action icons and treatments. Navigation labels are not interpreted as destructive actions.
- Page schema navigation paints blue inactive rail segments with a transparent active tab and workspace. Horizontal inset and the tab-to-workspace gap are removed. Home, Settings and repeated-card navigation keep their independent structure.
- Profile images occupy the left two columns for four field rows by default. Nested categories use all six columns below that region. Narrow screens stack the image and fields.
- Changing a repeated-card date part retains focus. A dash explicitly moves day to month and month to year; Tab remains the way to leave the year.
- Duplicate schema-search filter tags and redundant panel titles/explanations are hidden or removed. Selection buttons lead the respective Search panels. Sidebar spacing is normalized.
- The global Builder navigator has a bounded scrolling region with bottom clearance.
- Builder history search has its own sidebar panel. It matches readable change descriptions, schema names, users and timestamps within the current scope. Empty input returns all stored entries in that scope. The history-row preference sizes the scrollable viewport rather than dropping matches.

Validation: Python regression suite, frontend build and syntax checks, browser DOM workflows with focused repeated-date and history-query assertions. Native Windows builds are not executed in the Linux validation environment.
