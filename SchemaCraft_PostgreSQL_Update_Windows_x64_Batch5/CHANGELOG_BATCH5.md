# Batch 5

Prebuilt PostgreSQL-only application; verified retirement of legacy storage and existing recovery copies; saved exchanges/documents and future backups retained; clean deployment without obsolete app source/build tools. Cumulative Windows build/driver/timezone and migration fixes are included.

Handles Arabic/Persian and other Unicode Windows paths in migration reports; accepts uppercase XLSX storage filenames; rejects malformed managed storage configuration before starting the database.

Reads PostgreSQL PID metadata independently of the Windows console locale, preserving reliable Unicode-path shutdown and restart checks.
