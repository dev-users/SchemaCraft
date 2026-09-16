# SchemaCraft

The current Alpha 53 maintenance revision uses a shared white main header and a
stable, workspace-wide primary color for schema navigation. It removes inferred open-arrow decorations and gives
read-only records the available page width. Entry portraits occupy one field-grid
column with a 3:4 portrait spanning multiple rows. Entry validation stays inline
without focus trapping or delayed focus restoration; use Tab or click to move
between fields and date parts. Read-only fields retain their Builder widths.
Builder, Search, Import and Export histories have live filters beside their
clear buttons in bottom-of-page tables. Workflow panels collapse from their
headings. See [maintenance changes](docs/MAINTENANCE_UI.md).

Alpha 53 integrates page and schema navigation into one blue header, standardizes sidebar widths, restores the portrait frame, removes duplicate close icons, and makes field-value changes independent of focus navigation. See [Alpha 53 changes](docs/ALPHA53.md).

Alpha 52 unifies action icons, refines blue page tabs and transparent active workspaces, adds scoped Builder history search, and improves repeated-date focus and profile-image layout. See [Alpha 52 changes](docs/ALPHA52.md).

Alpha 51 connects page schema tabs to the full workspace and adds searchable selection for long tab lists. Home, Settings and repeated-card tabs are unchanged. See [Alpha 51 changes](docs/ALPHA51.md).

Alpha 50 simplifies action sidebars, moves backups to Settings, adds confirmed attachment/card deletion, and improves repeated-tab keyboard navigation. Search notes now include an archived-records option. See [Alpha 50 changes](docs/ALPHA50.md).

Alpha 49 unifies panel surfaces and hover labels, resolves general Builder condition labels, and replaces repeated Entry cards with Home-style tabs. Attachments use a compact browse/name or filename/delete row; checkbox and date controls have simplified labels. See [Alpha 49 changes](docs/ALPHA49.md).

SchemaCraft is a portable, local-first, metadata-driven records application.
Administrators design schemas in the Builder, operators enter and search data,
and the Python backend stores authoritative records in Excel workbooks while
keeping attachments, histories, settings, and workspace metadata beside the
application.

The package metadata identifies this source as `3.0.0-alpha.53`. The current
maintenance pass consolidates the stylesheet source, adds branded lifecycle
windows, protects the application behind a per-launch browser session, migrates
administrator password hashes to bcrypt, and adds complete project/API
documentation without changing the data-file format. Alpha 22 adds the 6 × 6
Home card grid, a single range-capable search/export filter engine, permanent
history clearing, the centered attachment viewer, admin-only settings, and a
guarded default-app copy workflow. Alpha 23 consolidates Home into one
per-schema data card plus three operation cards, adds configurable percentage
and gauge charts, contains search-result scrolling, and finalizes the wider
white-track scrollbar.
Alpha 24 makes every Home card collapsible, gives each schema separate history,
percentage, and gauge sections, adds the Builder history dashboard, and makes
result-field chips directly removable. It also completes copy-only record IDs,
field-led category placement and focus, safe import-ignore defaults, custom
repeatable-card names, last-editor-on-update semantics, and deterministic
cross-repeatable automatic updates.
Alpha 25 removes repeatable-card/category tags and the former completeness
state, unifies text/list/date field definitions, adds checkbox-triggered audit
dates and users, enforces optional one-card-only checkboxes, and makes related
profile imports select repeatable cards through that unique checkbox. Home
history is now title-led and cache-coherent, Entry has recent profiles and
extendable lists, and Search/Import/Export share one history-row preference.
Alpha 26 makes Entry navigation deliberate, validates extendable lists before
focus can leave, restores reusable export history,
separates every page's history-row limit, scopes Builder history, and moves the
expensive Excel schema projection out of the interactive Builder save request.
Alpha 27 replaces editable datalists with integrated searchable comboboxes,
restores the three-part date control with dash navigation, guarantees field-only
Tab order, and separates Home history limits by card. Builder workbook work is
now coalesced, generated outside the request lock, and keeps its search/index
snapshot hot after projection.
Alpha 30 gives Home a shared translucent visual system, strengthens the compact
summary rows and browser-style schema tabs, and applies the same one-schema-at-a-
time workspace to Builder without adding charts to its schema panels.
Alpha 31 removes the extra summary labels, presents every Data and Builder
metric as an individual pastel tile, and turns the schema selector into a
smoother continuous navigation rail while leaving the existing tables and Data
charts beneath the statistics.
Alpha 32 adopts a neutral card palette throughout Home, restores each schema's
compact statistics tags beside its title, and refines panel borders, focus
states, spacing, and responsive headings without changing dashboard behavior.
Alpha 33 places Data Entry and Builder inside unified titled workspace surfaces,
keeps their general statistics directly beneath the title, and replaces the
separate tab rail with raised neutral schema tabs attached to the active panel.
Alpha 34 removes the remaining seam between the selected schema tab and its
content: the tab row now supplies the upper boundary, the panel wrapper owns the
other three edges, and the active tab bridges directly into the panel surface.
Alpha 35 gives every Home card one identical title-only header and removes all
borders from the schema tabs and their content surface. Shorter tabs now blend
into the selected panel through a quiet background overlap.
Alpha 36 rounds the tab and schema-surface corners further and aligns the first
RTL schema tab exactly with the right edge. Reserved space inside the scrolling
tab row keeps the active-tab bridge visible instead of clipping it.
Alpha 37 removes that reserved gap and joins the selected tab directly to its
content surface. It also strengthens Home title and card-label hierarchy,
tightens corner radii, removes Home descriptions, and adds accessible subtle
blue hover feedback to dashboard surfaces.
Alpha 38 removes the blue hover fill while preserving restrained neutral hover
feedback. Home text is scaled to approximately 150 percent—including tabs,
statistics, charts, legends, and history metadata—with still larger section
titles and a narrower mobile title adjustment.
Alpha 39 balances that Home scale at 125 percent and completes the Data and
Builder information architecture. Data gains archived/non-archived totals and
up to three configurable cross-schema metrics. Builder gains a general-
definitions tab, detailed structural statistics, configurable structural
charts, and a three-column statistics/chart/history workspace for every schema.
Alpha 40 renders both Builder overview and per-tab structure values with the
same statistic-card language used by Data Entry. A closed Builder tab now opens
its dashboard first; selecting its active header again enters the corresponding
Builder scope.
Alpha 41 simplifies the general statistic tiles, replaces Data Entry's add-tile
with a standalone plus control, and composes Builder's overview into one compact
schema count plus category and field cards with proportional pie indicators.
Builder tab statistics are grouped into vertically stacked, reconcilable
partitions beneath their category or field total.
Alpha 42 increases the visual scale of the Builder statistics inside tabs and
renders category and field totals as plain centered headings rather than tags.
Alpha 43 lets custom Data statistics filter by one or more live field values,
matches Data tab navigation to Builder's two-step behavior, toggles Builder
overview pies between complementary measures, and corrects the general-field
category-presence partition.
Alpha 44 turns the desktop lifecycle into one chromeless full-screen surface,
finishes dependent editable-list and keyboard navigation behavior, makes Search
filter chips removable, and adds an independent Builder-history row limit. The
Builder now uses six-part field widths, supports parented main categories and
end-of-parent placement, imports general definitions into schema editors,
scrolls the general navigator, records specific edit details, and collapses
categories from unused title-row space without separate collapse buttons.
Alpha 45 makes `app/ui_text.json` a runtime wording catalog, persists custom
Home statistics in workspace settings, balances all three tab-content columns,
and simplifies chart presentation with tooltip-driven pies and one stacked
comparison bar. General-category packages can now be selectively added with
their complete descendant tree, general parents are available when creating a
general category, and Builder panels collapse from unused heading space.
Alpha 46 adds a visual Windows builder with live progress and logs while
preserving the scriptable offline pipeline. Clean user packages now keep only
`SchemaCraft.exe` visible in the default Windows Explorer view; packaged
support folders and runtime-created data receive the Windows hidden attribute.
Alpha 47 gives every Builder dashboard tab two independently configured,
vertically stacked structural charts and makes stacked-bar percentages directly
readable. General category definitions now use the same editable category,
child-category, field, and appearance-condition interface as schema Builder.
Reusable category conditions are stored with package-local keys and are
imported only when both their source and target belong to the selected package.
Alpha 48 fixes the clean Windows package stage with a deterministic Python
packager, gives the two Home Builder charts separate equal-height grid rows,
keeps general-definition creation in the Builder side rail, and replaces native
browser prompts and confirmations with consistent in-application dialogs.

## Start from source

```bash
python -m pip install -r requirements.txt
python build_frontend.py
python SchemaCraft.py
```

The server binds only to `127.0.0.1`. One borderless full-screen kiosk appears
first with the logo and current-user form; after login, that same window becomes
the main application and remains full-screen through the closing view.

## Source of truth

- Edit HTML, JavaScript, and CSS under `app/src/`.
- `app/index.html`, `app/app.js`, `app/workspace.js`, and `app/styles.css` are
  generated browser assets. Rebuild them with `python build_frontend.py`.
- `app/src/styles/application.css` is the one canonical application stylesheet.
- In a distributed app, edit only the values in `app/ui_text.json`, then restart
  SchemaCraft. Source builds copy this catalog from `app/src/ui_text.json`.
- Runtime data belongs under `data/`; do not put secrets into source files.
- `vendor/` is third-party ReportLab code and is not part of the first-party API.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Backend](docs/BACKEND.md)
- [Frontend](docs/FRONTEND.md)
- [Data model](docs/DATA_MODEL.md)
- [HTTP API](docs/HTTP_API.md)
- [Security model](docs/SECURITY.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
- [Windows build and release](docs/BUILD_AND_RELEASE.md)
- [Generated source API catalogue](docs/API_REFERENCE.md)
- [Alpha 22 feature notes](docs/ALPHA22_FEATURES.md)
- [Alpha 23 dashboard notes](docs/ALPHA23_DASHBOARD.md)
- [Alpha 24 workflow notes](docs/ALPHA24_WORKFLOWS.md)
- [Alpha 25 feature notes](docs/ALPHA25_FEATURES.md)
- [Alpha 26 feature notes](docs/ALPHA26_FEATURES.md)
- [Alpha 27 feature notes](docs/ALPHA27_FEATURES.md)
- [Alpha 28 Home workspace](docs/ALPHA28_HOME.md)
- [Alpha 29 tabbed Home dashboard](docs/ALPHA29_HOME_TABS.md)
- [Alpha 30 Home visual polish](docs/ALPHA30_HOME_POLISH.md)
- [Alpha 31 Home metric tiles](docs/ALPHA31_HOME_METRICS.md)
- [Alpha 32 neutral Home styling](docs/ALPHA32_HOME_NEUTRAL.md)
- [Alpha 33 attached schema tabs](docs/ALPHA33_HOME_TABS.md)
- [Alpha 34 seamless schema tabs](docs/ALPHA34_SEAMLESS_TABS.md)
- [Alpha 35 unified Home headers](docs/ALPHA35_HOME_HEADERS.md)
- [Alpha 36 rounded tab alignment](docs/ALPHA36_TAB_ALIGNMENT.md)
- [Alpha 37 Home refinement](docs/ALPHA37_HOME_REFINEMENT.md)
- [Alpha 38 Home typography](docs/ALPHA38_HOME_TYPOGRAPHY.md)
- [Alpha 39 Home information architecture](docs/ALPHA39_HOME_ARCHITECTURE.md)
- [Alpha 40 Builder dashboard refinement](docs/ALPHA40_HOME_BUILDER_TAGS.md)
- [Alpha 41 reconciled Home statistics](docs/ALPHA41_HOME_STATISTICS.md)
- [Alpha 42 Builder tab statistic hierarchy](docs/ALPHA42_BUILDER_TAB_STATISTICS.md)
- [Alpha 43 Home statistic interactions](docs/ALPHA43_HOME_INTERACTIONS.md)
- [Alpha 44 application and Builder workflow](docs/ALPHA44_WORKFLOW_REFINEMENT.md)
- [Alpha 45 runtime text and dashboard behavior](docs/ALPHA45_RUNTIME_DASHBOARD_BUILDER.md)
- [Alpha 46 visual Windows builder](docs/ALPHA46_VISUAL_WINDOWS_BUILDER.md)
- [Alpha 47 general Builder and dual charts](docs/ALPHA47_GENERAL_BUILDER_CHARTS.md)
- [Alpha 48 build, Builder, and dialog fixes](docs/ALPHA48_BUILD_BUILDER_DIALOGS.md)

## Verification

To insert deliberate space in a form, add a field in Builder, choose
**مساحة فارغة — بلا اسم أو قيمة**, and set its width. The spacer is editable in
Builder and appears as blank space in Data Entry; it adds no data column.

To create a schema that follows another schema's profiles, open Builder's
new-schema dialog, enable the profile-following option and select the source
schema. Existing IDs are created as blank profiles immediately. Later source
additions and deletions flow to the new schema; its fields and values remain
independently editable. Deleting a destination profile never deletes its source.
See [the data model](docs/DATA_MODEL.md) for synchronization details.

```bash
python -m unittest discover -s tests -p "test_*.py"
npm ci
npm test
```

The Python suite covers storage, schemas, searching, imports/exports,
multi-schema behavior, security, and lifecycle routing. The jsdom suite runs
the complete browser workflow against isolated temporary servers.

### Advanced reports and improved build progress

The Export page's **تقرير متقدم** workflow is implemented: reusable `.md` templates,
named ID groups, individual fields, numeric/distribution charts, conditional
aggregations, editable report previews and PDF export. See
[the Arabic workflow guide](docs/advanced-reports.md) for usage and calculation semantics.
The Windows graphical builder now shows stage-based progress, elapsed time and an
estimated remaining time calibrated from successful local builds.

The report workspace also includes searchable profile selection, persistent drafts,
grouped and sorted charts, median/distinct/profile counts, AND/OR conditions,
number formatting, template checks and exact PDF preview with page settings.
See [the assessment](docs/reports-assessment.md) for the improvements and remaining
boundaries, and [the Arabic guide](docs/advanced-reports.md) for instructions.

### Visual document studio

Advanced Reports now includes **فتح الاستوديو المرئي**: movable document blocks,
profile/card datasets, dynamic tables and repeating sections, connected metrics,
source inspection, reasoned overrides and reviewed refresh. Save reusable run
recipes or export several recipes as separate PDFs inside one ZIP. Version 1
text templates remain compatible. See [the Arabic workflow guide](docs/advanced-reports.md)
and [implementation notes](docs/report-studio-changes.md).
