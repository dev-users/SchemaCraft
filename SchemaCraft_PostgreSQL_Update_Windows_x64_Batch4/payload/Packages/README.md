# SchemaCraft offline Windows packages

This folder contains the complete pinned wheel set used by the supported offline Windows build.

- Target: Windows 64-bit (`win_amd64`)
- Python: CPython 3.13 64-bit
- Installation mode: local only (`--no-index`)
- Build toolchain: PyInstaller and its pinned dependencies
- Runtime packages: openpyxl, bcrypt, Pillow, charset-normalizer, ReportLab, pypdf,
  psycopg 3.3.3, psycopg-binary 3.3.3, tzdata 2026.5, typing-extensions 4.15.0
- Complete pinned wheel count: 18, including Windows-only conditional dependencies
- Advanced Reports PDF rendering: ReportLab + Pillow + charset-normalizer

`build-windows-cli.bat` creates/reuses `.build-env` and installs
`requirements-build.txt` exclusively from this folder. The normal build does
not need internet access once Python 3.13 64-bit is installed on Windows.

`prepare-packages.bat` is only for intentionally refreshing the wheelhouse on
an online Windows machine.

PostgreSQL server binaries are separate from the Python wheelhouse. The normal
build requires a reviewed PostgreSQL 18 Windows x86-64 runtime at
`runtime/postgresql`, with a matching sealed inventory. Use
`prepare-packages.bat /postgresql "C:\verified-runtime"` to verify and copy an
explicitly supplied runtime. See `docs/MANAGED_POSTGRESQL_RUNTIME.md`. No server
binary is automatically downloaded or installed as a system service.

To verify file integrity on a system with `sha256sum`:

    sha256sum -c Packages/SHA256SUMS.txt

`schemacraft_windows_build_check.py --wheelhouse .` verifies checksums,
Windows CPython 3.13 wheel compatibility, and active `Requires-Dist` metadata
for Windows before building. This includes psycopg's Windows-only `tzdata`
dependency, which a resolver running on Linux can otherwise overlook.


## SchemaCraft offline runtime

The normal Windows build uses this folder with `pip --no-index`; no internet connection is required. Runtime browser networking is also locked to the local SchemaCraft server. See `docs/OFFLINE_MODE.md`.
