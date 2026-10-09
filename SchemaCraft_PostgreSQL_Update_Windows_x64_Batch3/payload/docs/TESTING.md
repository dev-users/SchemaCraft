# Testing

## Python suite

```bash
python -m unittest discover -s tests -p "test_*.py"
```

The suite uses temporary directories and isolated servers. It covers schema
validation, records, Excel, attachments, backups, imports/exports, workspace
management, multi-schema mapping, search, bcrypt migration, session protection,
lifecycle assets, and graceful shutdown.
Alpha 22 adds coverage for typed range operators, empty/non-empty filters, the
6 × 6 Home contract, official ICO extraction, admin-only settings/shortcuts,
automatic export suffixes, the attachment viewer, and sanitized app copies.
Alpha 23 adds coverage for the four-card Home geometry, per-schema chart
configuration, field summary counts, contained result windows, definitive
scrollbar styling, and conditional removal of the administrator hash.
Alpha 24 adds coverage for collapsible Home cards, the three-section schema
dashboard, removable result chips, record-ID copying, category collapse/focus,
safe import mapping defaults, parent-field placement, custom card prefixes,
update-only last-editor values, and cross-repeatable automatic updates.
Alpha 25 adds coverage for retired tags/completeness, title-led Home navigation,
shared history limits, recent profiles, runtime list growth, unified Builder
types, checkbox-triggered date/user values, unique repeatable checkboxes,
selected-card related imports, history/cache purging, and the optimized schema
save path.

## Browser workflow

```bash
npm ci
npm test
```

The jsdom test starts isolated developer, user, and multi-schema servers and
executes the complete interface workflow. It must never copy or mutate the
real `data/` directory.

## Build consistency

Run the frontend build before testing. A release should also verify:

```bash
python -m py_compile SchemaCraft.py schemacraft_*.py build_frontend.py
sha256sum -c Packages/SHA256SUMS.txt
python tools/generate_api_reference.py
```

Do not package `node_modules`, test-only Python dependencies, bytecode caches,
application logs, or generated build work directories.
