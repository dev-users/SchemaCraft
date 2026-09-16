# Visual report studio

Advanced Reports now exposes only the visual document editor. The former text editor and its dialogs have been removed from the page. Saved legacy files and backend compatibility remain intact.

Implemented:
- Movable, duplicable document blocks with accessible reorder controls and template undo/redo.
- Single fields, conditional blocks, dynamic tables and column totals, repeating row sections, covers and page breaks.
- Profile and repeated-card datasets; card conditions retain field pairing. Main fields are available on card rows. Nested cards retain their parent reference.
- Reusable aggregates and restricted arithmetic expressions with dependency validation. Data-cell overrides recalculate all consumers; metric overrides recalculate their dependents without altering source cells.
- Source inspection and paginated contributing-row views; formula dependency drill-down.
- Reasoned overrides, restoration, refresh comparison, conflict choices, frozen template/source hashes and a bounded local edit history.
- Persistent run recipes and batch export of up to 20 separate report PDFs in one ZIP, with cancellation between report generation requests.
- Arabic PDF contents with actual page numbers and links; repeated table headings and shared exact PDF preview.

Compatibility and limits are documented in `advanced-reports.md`. Existing version 1 templates remain stored, but are not editable in the visual interface. Visual template import requires document metadata. The studio is opened from the Advanced Report page and saves `.md` templates with version 2 metadata. No new production dependency is required.

Verification includes engine tests for repeated-row matching, dependent calculations, cycle/code rejection, overrides, source refresh conflicts, Markdown/draft round-trips, real-workbook row identities, recipes and separate batch PDFs. A Chromium workflow uses the actual Python document/PDF engine with isolated fixture data. Existing backend and UI regression suites are also run. Windows executable building is not performed in this environment.

## Visual workflow update

- Drag blocks from the palette to stable insertion targets, or add with a click / between-block button. Move existing blocks using handles or accessible up/down buttons; undo/redo restores ordering. The editor scrolls near the edge during dragging.
- Guided summary, table and detailed-profile starters connect datasets and blocks automatically. Individual data blocks also offer contextual source setup.
- Live structural previews for text, headings, tables, metrics and charts, with explicit labels distinguishing placeholders from real data.
- Contextual help, visible missing-configuration hints, column ordering, grouped template actions, and optional filters/sorting behind expandable settings.
- Saved drafts and recipes open directly in the application step. Template saves lock editing until completion.

Validation: all 337 Python tests, the existing app UI suite, and Chromium checks covering drag/drop, undo/redo, live edits, guided starters, connected calculations, refresh/override review, drafts, recipes, PDF preview/batch export and narrow layouts passed.

## Report page and dialog polish

- Refined the Advanced Report landing page, reusable template cards, and direct entry points for drafts and recurring recipes.
- Consistent RTL dialog headings, step navigation, save status, source setup, inline validation, and responsive spacing. Validation retains entered values.
- Template saving rebinds editing controls to the saved model, so subsequent edits persist correctly. Cancelling template switches restores the selected template. Undoing back to the saved document clears the unsaved-template warning.
- Reopening the same data source preserves filters, columns and totals without creating duplicate datasets.
- Ctrl/Cmd+S saves the draft in the application step and the template elsewhere, even after preview rebuilding; nested dialogs retain their own keyboard behavior.
- The application step identifies missing block settings and distinguishes an older generated preview from changes awaiting regeneration.

## Inline values and conditional counting

- Insert field values, dates and reusable metrics at the cursor within a single sentence. Inline fields validate their source and require one matched row; references retain provenance and participate in cell overrides and refresh.
- Per-metric AND/OR criteria compose with dataset criteria for conditional counts, sums and averages. Count profiles distinctly, count rows, and distinguish empty/non-empty values. Profile count provenance deduplicates IDs.
- Datasets can use all current profiles in a schema, optionally including archives, with explicit size limits and live refresh behavior.
- Failures open a foreground dialog with readable details and recovery guidance, including failures from nested workflows. Existing Markdown templates retain their structured metadata format.
- Validation includes 345 backend tests, real-engine Chromium inline insertion/calculation/export recovery tests and Arabic PDF visual inspection.

## Integrated workspace and Builder interaction update

- Advanced Report is a page-level workspace reached directly from its own export tab. The separate launch page and modal editor wrapper are removed. Templates, drafts, recipes, source refresh and contextual sidebar actions remain accessible.
- Revisiting the page preserves the model, draft and rendered controls; initial catalog loading is shared. Explicit source refresh remains available.
- Builder field dialogs expose category selection and destination placement. Main-to-main moves preserve existing record values and field IDs. With records present, moves involving repeated categories remain guarded because their card-value mapping needs an explicit migration. Without existing records, category moves remain available.
- Checkbox controls show their checkbox and name only; configured true/false meanings still apply to value display and reporting.
- Builder field names have no hover card. Field-body hover retains details; pointer selection dismisses cards and selected items suppress details while their action controls are visible.
- Shared keyboard focus is clearer, and error notices remain visible longer.
- Fixed the first-use operator-name prompt being hidden by the startup privacy screen; only the prompt is revealed after the session check.
- The report canvas uses the available page width, and block insertion points show a single plus icon.

Validation: 347 backend tests, four security lifecycle checks, the app UI suite, the report workflow browser suite and full-app integration checks passed. Full-app checks cover field-body/label hover, selected controls, the category dialog, report navigation, sidebar error recovery and preserving unsaved edits across page switches. Windows executable validation remains a release check.

## Restore the report page and visual-editor dialog

- Restored the previous Advanced Report landing page, template cards, launch actions and modal visual editor, including its original export navigation.
- Report headings, tabs, cards and surfaces now follow the application's configured theme. The document canvas and explicit error styling remain intact.
- Retained the latest Builder category-move, checkbox and hover fixes, startup prompt fix and single block-insertion icon.
- Existing report templates, calculations, inline values, traceability, draft overrides, recurring recipes and PDF workflows are unchanged.

Validation: full-app browser checks and the report workflow suite passed, including restored navigation, modal close/reopen with retained edits, responsive layout, inline values, conditional counts, manual refresh and PDF error recovery. Desktop and narrow-window screenshots were reviewed. Backend code is unchanged from the previously validated release.
