# Advanced Reports — post-Codex assessment and repair

## Confirmed Linux preview failure

The remaining blank/text-only Preview failure was not caused by report configuration. The new document-first PDF renderer imports **ReportLab** when a PDF preview is created, but ReportLab was not declared in the application's runtime dependencies. A development/test machine that already had ReportLab installed therefore passed tests, while a clean Linux installation could reach `writer_preview` and then fail on the first PDF import. That exception fell through to the application's generic Arabic “internal unexpected error” response.

The runtime dependency list now explicitly includes `reportlab==4.4.9` and its `charset-normalizer==3.4.7` dependency. The Preview/PDF boundary also converts a missing ReportLab installation into a direct actionable report error telling Linux users to run `python -m pip install -r requirements.txt` and restart the application. Unexpected Advanced Reports writer exceptions are logged to `data/logs/application.log` and returned through a report-specific error boundary instead of an unhelpful generic failure where possible.

A separate image-validation defect found in the earlier review is also retained: image blocks now verify their decoded PNG/JPEG content before PDF rendering instead of accepting any string with a `data:image/...` prefix.

## Product/UX repairs applied

- Advanced Report outputs now use the **existing Export page history table** instead of maintaining a competing user-facing Generated Reports / History area inside Advanced Reports.
- Completed/partial Advanced Report artifacts are recorded in unified Export History with their report/run metadata.
- Deleting an Advanced Report row from Export History also deletes SchemaCraft's internally retained generated artifact and updates/removes its retained run metadata. Ordinary external-export history keeps its previous behavior.
- Advanced Report templates can be deleted from the template list. Their editable draft/saved template versions are removed without retroactively deleting already generated external history unless that history is explicitly deleted.
- The Advanced Reports dashboard is intentionally simplified to **Templates** and **Reusable Components**; generated-output history lives in Export History.
- The final Preview/Create review step no longer lists old Run Presets / previous reports. A saved Run Preset, when wanted, is selected earlier as an optional input and the final step shows only the current run summary, preflight and Preview/Generate controls.
- Property editing is less disruptive: the selected node remains selected, right-sidebar scroll is restored after redraw, and filter/sort configuration sections stay open instead of collapsing after every edit.
- The editor layout was visually tightened: more stable toolbar behavior, clearer properties cards, less wrapping/clutter, wider working sidebars and cleaner review summary styling.
- Page presets support A4, A3, Letter and Legal, portrait or landscape.
- Editor page sheets follow selected size/orientation.
- First-page header/footer behavior supports same, different or none.
- Current-page and total-pages tokens are available in page headers/footers.
- Automatic bottom page numbering can be disabled when custom page numbering is used.
- Numeric parameters expose optional minimum/maximum bounds.
- Table authoring exposes calculated columns supported by the engine.
- First/last repeater system tokens are exposed.
- Oversized layout rows can split when safe; impossible layouts fail explicitly rather than silently clipping.
- Global settings expose default page size/orientation for new reports.
- Active documentation was corrected and the old Markdown-oriented assessment is marked as legacy.

## Linux update requirement

If this source tree replaces an already installed copy on Linux, updating the files alone does **not** install newly declared Python dependencies into the existing environment. From the project directory run:

```bash
python -m pip install -r requirements.txt
```

using the same Python/virtual environment that launches SchemaCraft, then fully restart the application.

The Chromium/GTK terminal messages about `atk-bridge`, GCM `DEPRECATED_ENDPOINT`, WebGPU limits, GPU adapters and X11 atom caching are unrelated browser-runtime diagnostics and are not the Advanced Reports PDF exception.

## Offline Windows wheelhouse note

The pinned Windows build requirements now also declare ReportLab and charset-normalizer. The checked-in offline `Packages/` directory from the uploaded archive predates these dependencies, so it must be regenerated with the project's package-preparation workflow before performing a completely offline Windows rebuild. This Linux-focused repair does not pretend that missing wheel files were downloaded in the network-restricted review environment.

## Important limitations that remain

These are larger product additions rather than the Preview bug:

- The editable canvas is not a continuously repaginating Microsoft Word layout engine. Exact automatic overflow, final wrapping and TOC page numbers remain authoritative in PDF Preview.
- Rich text remains primarily block-level rather than arbitrary range-level Word-style formatting. Track changes/general Word compatibility are not current product goals.
- Standalone chart/table style-preset libraries and a centralized asset manager are not yet full management surfaces.
- Automatic retention/purge policies are not implemented.
- Report jobs survive browser closure but not full application-process termination; interrupted jobs become explicit failures rather than resuming automatically.
- Legacy Markdown/v1/v2 templates remain in their original stores; there is no automatic lossy migration into the new editor.

## Verification

The report-focused regression suite currently passes **70 tests**, including Preview/PDF handling, missing-ReportLab behavior, unified Export History integration and deletion, template deletion, image validation, page orientation, first-page headers/footers, report history and legacy reporting regressions.

The frontend bundle rebuild succeeds; `document-writer.js`, `exchange.js` and the bundled `app.js` pass JavaScript syntax validation; and the Python backend modules compile successfully.

The repository's browser writer test still cannot be executed in this Linux review environment because `jsdom` is not bundled/installed and network access is unavailable. The application archive therefore should not claim that browser test was executed.
