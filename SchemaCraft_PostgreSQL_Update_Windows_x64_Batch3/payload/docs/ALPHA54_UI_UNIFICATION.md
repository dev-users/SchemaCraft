# Alpha 54 — Unified Application Visual System

This revision consolidates SchemaCraft's shared UI language without changing application workflows.

- Common buttons, controls, cards, tables, dialogs, tabs, and focus states use one visual system.
- Destructive actions retain their danger styling on hover/focus.
- Import/export/search/history surfaces use consistent nested-card and table treatment.
- The PDF profile export search keeps its data input dominant and its search action compact.
- Settings owns Apply/Discard actions per tab; the detached dialog-wide discard footer was removed.
- Advanced Reports keeps its existing document-editor styling and behavior.

The canonical stylesheet remains `app/src/styles/application.css`; rebuild with `python build_frontend.py`.
