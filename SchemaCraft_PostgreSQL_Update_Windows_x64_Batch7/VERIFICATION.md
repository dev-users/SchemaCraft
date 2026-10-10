# Batch 7 verification

This release changes only external interface assets. It reuses the byte-identical Batch 6 platform executable, PostgreSQL runtime, portable updater interpreter and updater implementation. The frozen application serves interface files from the app directory beside its executable, allowing this frontend update without rebuilding the backend.

Only synthetic disposable workspaces are used in development. Company data is unavailable here. The updater verifies each company workspace locally before activation and cleanup. Saved imports, exports and document attachments retain the established protection policy; existing recovery backups are removed only after successful verification, and future backups remain available.

See VERIFICATION_REPORT.json for checks actually performed for Batch 7 and their scope. Previously tested components are identified separately from newly verified release assets. Native Microsoft Windows is unavailable; any Windows execution check is identified as Wine-based. Linux binaries retain the Batch 6 Ubuntu 24.04 x86_64/glibc 2.39 compatibility requirement; older glibc versions are not verified.
