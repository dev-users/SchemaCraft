# Vendored PDF dependency

`reportlab/` contains ReportLab 4.4.9 for deterministic offline PDF builds.
SchemaCraft uses only its pure-Python text, TrueType font, table, and PDF paths.
The optional Pillow import in `reportlab/lib/utils.py` is guarded because
SchemaCraft profile reports do not render raster images. ReportLab remains
available under its BSD license in `reportlab/LICENSE`.
