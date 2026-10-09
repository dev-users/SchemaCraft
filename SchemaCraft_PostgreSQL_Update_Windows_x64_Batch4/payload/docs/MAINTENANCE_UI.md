# Alpha 53 maintenance: deliberate navigation and inline history

- The main header is white with dark text on every page. Schema navigation uses
  one persistent workspace primary color, independent of schema identity.
- Unclassified buttons no longer receive a generated open-arrow icon. Explicit
  file-opening icons remain in place. Clear actions take precedence over search
  keywords when selecting their X icon.
- Read-only page content uses the available width instead of a centered width cap.
- Profile images are direct field-grid children occupying one column, using a
  3:4 portrait frame and spanning enough rows for neighboring fields to fill the space.
  Child categories retain their position in the same field ordering.
- Entry validation shows inline errors without reportValidity focus changes,
  delayed refocusing, or list Tab traps. Adding/removing cards, changing link
  mode, and restoring a workspace do not programmatically move field focus.
  Explicit Tab and repeated-tab arrow keys remain supported. Date separators
  keep focus on the current part; mouse selection in list menus retains the editor.
- Builder history is a table at the end of the main Builder view, including
  general-definition scope. Its filter is applied before the configured row limit.
- Builder, Search, Import and Export filters live immediately before their clear
  buttons in RTL table toolbars and update on input. Sidebar history-search
  panels have been removed. Existing history data and clear confirmations remain.
- History toolbars never wrap the search above the clear button.
- Search, Import, Export panels and the Builder history table collapse via their
  heading, including keyboard Enter/Space. Interactive heading controls do not toggle them.
- Read-only labels and values are grouped into fields in a responsive six-unit
  grid, using their configured Builder widths.
- The shared white header uses centered pill navigation, session controls on
  the right and the exit control on the left. The schema strip reaches both
  page edges without changing its workspace color.
- Editing a repeated card no longer reparents its DOM node or re-sorts its
  siblings. Labels still update; sorting runs when cards load, are added or
  removed. This preserves native focus during list and date changes.
- New schema creation can follow another schema's profile membership. The
  dialog explains the one-way deletion behavior before creation; the schema
  management panel displays the chosen source afterward.
- Parentless main categories in Data Entry now share the repeated-card tab
  design with a white content surface. Tabs contain category names only, with
  no add/delete controls or category-collapse heading. Nested categories stay
  inside their parent. Switching tabs keeps existing controls and values mounted.
- Main tabs support RTL arrow navigation and Home/End. The right navigator
  selects the containing main tab before opening nested content. Inactive tab
  controls are excluded from keyboard traversal, while saving still collects
  and validates values from every tab. Conditional visibility also applies to
  tab labels without unexpectedly selecting a newly revealed category.
- Data Entry and both Builder scopes use small circular plus/minus buttons
  for navigator branches. These buttons expose expanded state and support
  standard keyboard activation; clicking the category name navigates separately.
- Field grids use ordered row placement without dense backfilling. Empty gaps
  remain when a subsequent item does not fit. Checkbox labels reserve the same
  label space as neighboring inputs, aligning the checkbox with the controls.
- Main category tabs use light-blue inactive labels, small rounded corners and
  inset rail ends. Labels shrink with ellipsis when space is limited; their full
  names remain available to accessibility tools and hover tooltips. The open
  panel has vertical padding and a separate gap before the attachment gallery.
- Explicit Tab traverses each main category label, its available fields and
  nested content, then the next category label. Reaching a destination label
  opens that category. Shift+Tab reverses this order, including across category
  boundaries. Disabled controls and conditionally hidden categories are skipped;
  value input itself never switches the active category.
- Builder's schema-specific categories and fields panel now uses the shared
  Entry category layout and tab renderer, with the same widths, ordered grid,
  portrait sizing and nested category placement. Repeated categories display
  one example card representing the schema template. All conditional fields
  remain visible here so their definitions can always be edited.
- Field names are keyboard-accessible selection buttons. Selecting a name
  reveals exactly four contextual actions: delete, edit, move left (later in
  RTL order), and move right (earlier). Boundary arrows are disabled. Existing
  dialogs, deletion confirmations, dirty state and global-definition edit
  detachment behavior are retained. Escape or clicking elsewhere dismisses
  the toolbar. Reordering retains the selected field and open category.
- Category names expose the same four actions. Category arrows reorder peers
  with the same parent and placement, rather than stepping through unrelated
  descendants. The right navigator opens the containing preview tab.
- Preview controls are inert clones of Entry widgets, with record event
  handlers and discovery attributes removed. Preview interactions cannot edit
  records, upload attachments, add list options or create related profiles.
  Main tabs have unique IDs per surface, and previews do not alter Entry's
  active category, values or draft. General-definition management stays in
  its separate scope.
- Exit hover uses a red background; the unlocked administrator icon is green.
- Portrait grids use four-pixel row increments and their existing vertical gap,
  reducing unused space below images to less than four pixels of rounding.
  All direct grid items are measured without dense backfilling, and narrow
  screens return to natural single-column rows.
- Builder hover titles describe field types, widths and constraints, or category
  kinds and parent relationships. Preview inputs show their configured helper
  text, with a type hint when it is empty. Contextual toolbars are positioned
  under the selected name and re-aligned on resize. Arrow positions are swapped.
- The new `spacer` field type (`مساحة فارغة`) reserves the configured grid width
  without a label, input, value or keyboard stop in Data Entry. Builder shows a
  subtle editable placeholder so it can be selected, moved, resized or deleted.
  The field dialog hides name and value-related settings for this type.

Validation: Python regression suite and jsdom workflow tests. The DOM tests now
assert the new non-trapping validation and one-cell portrait contracts, and wait
for record saves to finish before attempting discard/navigation workflows.
Native Windows rendering and executable packaging require a Windows environment.

Search pagination and long field values:
- Single-schema search results now place summary, scrolling table, and pagination
  in matching grid rows in both the dialog and separate results window. The table
  has no outer margins or forced height that can overlap the pagination footer.
- Unfocused single-line Entry values use ellipsis. The shared styled hover card
  measures the actual displayed text and shows complete overflowing input/list
  values; textarea overflow is also supported. Short values stay quiet, editing
  preserves the full value, and navigator hover suppression remains in place.
