# SchemaCraft offline Windows packages

This folder contains the complete wheel set used by `build-windows.bat`.

- Target: Windows 64-bit
- Python: CPython 3.13 64-bit
- Installation mode: local only (`--no-index`)
- Password hashing: bundled `bcrypt` CPython ABI3 wheel
- PDF images and page merging: bundled Pillow and pypdf wheels

The normal build never downloads packages from the internet. It creates or
reuses `.build-env` and installs requirements from this folder. Run
`prepare-packages.bat` only when intentionally refreshing the wheelhouse on an
online Windows machine.

From the Source folder, `sha256sum -c Packages/SHA256SUMS.txt` verifies every
included wheel on systems that provide `sha256sum`.
