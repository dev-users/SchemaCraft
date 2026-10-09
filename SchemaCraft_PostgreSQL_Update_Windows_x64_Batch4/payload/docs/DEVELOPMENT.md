# Development workflow

## Prerequisites

- Python 3.13 for the supported Windows build.
- Node.js for the browser workflow test.
- Runtime Python packages from `requirements.txt`.
- npm development packages from the committed lockfile.

## Setup

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
```

On Windows, activate with `.venv\Scripts\activate` or invoke the environment's
Python directly.

## Editing frontend code

1. Edit only `app/src/`.
2. Keep JavaScript dependencies in `javascript.manifest` order.
3. Update the owning section of `styles/application.css`; do not create
   chronological override files.
4. Run `python build_frontend.py`.
5. Run both test suites.

## Editing backend code

Keep storage-domain logic in its existing modules when possible:

- security/session code in `schemacraft_security.py`;
- workspace/path/context code in `schemacraft_workspace.py`;
- import/export workbook code in `schemacraft_io.py`;
- histories, definitions, packages, and PDF code in
  `schemacraft_advanced.py`;
- request orchestration and record-domain behavior in `SchemaCraft.py`.

Never log request bodies, passwords, session tokens, startup capabilities, or
attachment contents.

## Documentation contract

Update the relevant prose document with behavior changes. Regenerate the API
catalogue after changing functions, routes, stable HTML IDs, or CSS variables:

```bash
python tools/generate_api_reference.py
```

The generated file must be committed together with the source change.
