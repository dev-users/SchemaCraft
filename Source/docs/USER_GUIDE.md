# User guide

## Starting SchemaCraft

1. Run `SchemaCraft.exe` or `python SchemaCraft.py`.
2. SchemaCraft opens one borderless full-screen window without the normal
   Windows title-bar buttons.
3. Choose or type the current user's name in the centered branded form.
4. Select **Open workspace**. The main application becomes visible only after
   the user session and schema are ready.

The selected name is used for audit fields and histories. It is not the
administrator password.

## Normal mode

Normal mode provides Home, Search, and Data Entry. Choose a schema using the
sticky schema tabs. Create or open records, edit fields, manage repeatable
cards, add attachments, save, archive, and use read-only reports as configured
by the schema. The Data Entry action rail keeps a collapsible list of recently
opened profiles. In a list field, type a new value and choose the inline add
option when no similar value exists to save it permanently.

## Administrator mode

Choose the lock badge and enter the Builder password. Administrator mode shows
Import, Export, and Builder functionality. The password is stored only as a
bcrypt hash. Lock administrator mode when finished.

In Home, every Builder tab contains statistics, two independently configurable
charts, and recent edits. Choose each chart separately to set its structure
measure and bar or circular presentation.

The Builder's general-fields/categories tab uses the same editable category
tree as a normal schema. You can edit nested categories and fields, add
appearance conditions, and then add the reusable package to a schema. An
appearance condition is imported only when both the controlling field and its
target are inside the selected category package.

## Search

- Schema-specific search supports configured filters, empty/non-empty matching,
  archive state, selected columns, and saved search definitions.
- Global search queries one or more schemas and reports where values matched.
- Results open in separate windows; saved-search results use the same behavior.

The number of history rows shown by Search, Import, and Export is one shared
setting under Settings. Deleting a profile also removes it from saved-search
snapshots and recent-profile caches.

## Closing

Use the red power button or `Ctrl+Q`. Confirm the close request. SchemaCraft
logs out the active user, keeps the same borderless window full-screen while
showing the centered closing view, waits for active work, stops the local
server, and then terminates the complete application window process.

If unsaved changes exist, the confirmation explicitly warns about them. If an
operation is still running, wait until it finishes and close again.


## General Builder changes and hover details

All categories without a parent, whether main or repeated, appear together in
Builder tabs. General definitions always include a **الحقول العامة المنفصلة** tab
on that same bar, even when no standalone fields have been added.

General edits, additions, deletions and ordering changes stay in a draft. Use
**حفظ التغييرات** in the left sidebar to commit them, or **تجاهل التغييرات** to
restore the saved definitions. Only saved changes propagate to linked schemas.
Closing the app warns about unsaved general changes. Adding a general definition
to a schema commits the general draft first, then opens the existing insertion
workflow. When a save fails, uncommitted changes remain available in the draft;
revision conflicts require reloading the saved definitions before retrying.

Hover labels appear when a name is truncated or a button has only an icon.
Builder fields and category names instead show detail cards with the full name
and properties. Category cards also list their fields. Field cards show the type,
width, required status, searchability and other configured properties. Press Escape to dismiss a hover card.

Deleting a saved general definition retains the existing schema copies and
record values while detaching their links. A small metadata recovery ZIP keeps
the pre-deletion general definitions and affected schema JSON files; it does not
copy unchanged workbooks or attachments. RECOVERY.txt inside that archive explains
how to restore those metadata files with the app closed. Normal full-workspace
backups remain available through the existing backup action.

Home keeps the last loaded statistics visible while checking for changes.
Charts load as their tabs are opened. Hover over a chart, or focus it using the
keyboard, to see its name, color key, counts and percentages. Press Escape to
close the card. Both Home tab groups use rounded, lightly indented tabs whose
labels shrink and truncate when space is limited, like Data Entry categories.

Attachment controls and gallery cards show the actual filename with a styled
information card. It includes the field, category, repeated-card title when
available, file type and saved status; newly selected files also show their size.
The right-side navigators in Data Entry, read-only and Builder do not show hover popups.

Profile PDF export follows the read-only report layout: category headings,
repeated-card titles, field labels above values and the six-column Builder widths.
Empty fields, system fields and spacers are omitted as in read-only. Attachment
filenames are included when selected. Long content wraps and continues across
PDF pages; each selected schema starts on a new page.

PDF field choices show only the schemas checked in the profile table. Before
exporting, two independent options let you include profile images at the top-left
of their categories and append attachments after all selected profiles. Images
are embedded, and PDF attachments contribute all their original pages, including
landscape pages. Missing or password-protected attachments produce an error
instead of being silently omitted. Other attachment formats cannot be rendered
as PDF pages; export those files through the attachment export option.

Tab labels use their full natural width when space permits, including repeated
cards. They shrink and truncate only when the available tab row is crowded.

PDF batch export accepts IDs separated by spaces, commas (including Arabic
commas), semicolons or new lines. IDs are normalized to uppercase and duplicates
are searched once. The results form a matrix with one row per ID and one column per schema.
Each available ID/schema cell has an independent checkbox. Field choices are shared by schema across the
selected people. IDs with no matching profiles are listed in the status message.
After changing the input IDs, run the search again before choosing a destination.

One input ID exports a PDF directly. Multiple input IDs export one ZIP containing
an independent `SchemaCraft-profile-ID.pdf` for each person with selected rows.
The profile-image and attachment options apply separately inside each report.
All reports are generated before saving the ZIP; if any report fails, no partial
batch replaces the destination file. Export history stores the batch IDs and
schema choices, and restoring a batch recovers the full ID list.

In the PDF matrix, schema-header checkboxes select or clear that schema for all
IDs that have it. Several schema columns can be selected together. A dash means
that the ID has no file in that schema. Use the separate Include checkbox in a
row to include or exclude that person; the header Include checkbox controls all
available IDs. Excluding a person preserves their schema choices, including
changes made through schema headers, without including them in the export.
An included ID must have at least one selected schema. All selected schemas for
one ID still belong to that person's single PDF.

Excel import now inspects every worksheet (excluding SchemaCraft metadata).
For each sheet choose its main or repeated category, choose the combined main
fields option for a sheet spanning several main categories, or ignore the sheet.
Map its columns independently; sample values appear beneath the column names.
Sheets join by the same profile ID. Multiple sheets and repeated-card sheets
require IDs. Generating IDs for blank cells is available only for a single main
sheet, because blank IDs cannot reliably connect records across sheets.

Each row in a repeated sheet is a card. In the default Merge mode, map the card
number to update an existing card; a blank card number adds a new card. Unknown
or duplicate card numbers are reported for correction. Unmapped fields and
unmentioned cards remain intact. Replace mode explicitly replaces that category's
cards for each imported ID, with removals visible in the review. Nested repeated
categories can map the parent card number; sheets for their parent categories
can be included in the same workbook. For an existing parent, its current card
number can be used. Conflicting main values for one ID are rejected rather than
silently choosing whichever sheet was read last.

The left-side Excel action opens a review and does not save the workbook.
Profile cards show additions, edits, unchanged records and validation problems.
Every proposed change shows the category/field and previous/new values;
overwriting an existing value is highlighted. Exclude an entire profile, decline
individual updates, or use the search and bulk actions for the visible profiles.
New profiles are approved as a whole so required fields cannot be accidentally
omitted. Declined changes keep their original values. Uniqueness, field rules,
required values and links between selected profiles are checked again before
saving; invalid selections must be corrected rather than partially applied.

A review expires after 30 minutes and must be regenerated if the schema or
workbook changes. Confirming saves the selected changes in one workbook write,
with an automatic backup first. Cancelling the review writes nothing. The result
dialog and Import history retain profile IDs, source sheets/rows and the actual
approved before/after changes, plus excluded/unchanged/rejected outcomes. Notes
can still be added to the history. Excel does not import attachment file bytes;
unmapped existing attachments are retained.
