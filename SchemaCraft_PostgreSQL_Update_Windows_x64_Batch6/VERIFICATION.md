# Batch 6 verification

Only synthetic disposable workspaces are used in development tests. Company data is unavailable here. The updater verifies the company's workspace locally, comparing exact data and attachment fingerprints before activation and cleanup.

The delivered platform executable is rebuilt from the current application source, including its internal-lock implementation. The updated generated interface assets are installed automatically alongside it. Sealed PostgreSQL runtime bytes and the offline updater interpreter are preserved from Batch 5.

See the release verification report for the checks actually performed on these final package hashes. Windows testing uses real Windows binaries under Wine 11; native Microsoft Windows is unavailable. Linux testing uses Ubuntu 24.04 x86_64 / glibc 2.39; older glibc versions are not verified.
