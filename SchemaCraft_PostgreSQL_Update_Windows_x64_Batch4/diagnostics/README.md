# SchemaCraft migration diagnostic for Windows

This small collector reads an existing failed update. It does not start or stop PostgreSQL, connect to a database, rerun migration, recover, repair, delete, or change application/company files. It imports only the bundled psycopg driver in each private Python to check client readiness. The only file it creates is a new `migration-diagnostic-YYYYMMDD-HHMMSS.json` beside `diagnose.py`.

1. Extract this diagnostic ZIP to a separate folder. Keep the failed application, backup, stage, and updater folders as they are.
2. Double-click `DIAGNOSE_WINDOWS.bat`. If prompted for the **Updater folder**, paste the extracted PostgreSQL update folder containing `vendor\python\python.exe` (not the app/company folder). No system Python or download is needed.
3. At **Application parent / journal**, paste `C:\data entry application` or the full `.schemacraft-update-journal-*.json` path. If several journals appear, choose the failed one.
4. Send the newly created `migration-diagnostic-....json` from the diagnostic folder. The full report path is printed when collection finishes.

Advanced use: `DIAGNOSE_WINDOWS.bat "C:\path\to\updater" "C:\data entry application"`.

The report includes updater/stage psycopg import success, implementation/version, safe exception types and OS error numbers, known driver DLL filenames and exact path lengths, source fingerprints, selected nonsecret deployment metadata, migration report status, and PostgreSQL readiness/error presence. A native server “ready to accept connections” line proves log readiness even if a JSON runtime `ready` event is absent. Log inspection is limited to the final 2 MiB; no log lines or SQL values are copied. Missing files or unreadable evidence are reported without repair.

Only **names** of existing `PG*` environment variables and `PSYCOPG_IMPL` are collected. Their values, managed passwords, DSNs, company records, arbitrary exception messages, traceback text, and SQL statements are omitted. `deployment.json` is examined as bounded bytes for encoding and numeric `format_version`, `major`, and `port`; credential values are never decoded into JSON or copied. Share the generated diagnostic JSON, not the original deployment file, logs, or company data.

The tool accepts the legacy `.schemacraft-update-backups` and compact `.scu` workspace roots. It rejects symlinks/junctions and journals whose stage/work paths do not match the updater's installation key and layout. Each driver import has a 30-second timeout. It does not change Windows long-path settings. A path over 259 characters is evidence to investigate, not proof of a failure. Healthy PostgreSQL startup does not by itself prove the Python client can load its driver or authenticate.

## خطوات سريعة بالعربية

1. فك ضغط ملف التشخيص في مجلد مستقل. اترك مجلدات الشركة والتحديث والنسخة الاحتياطية كما هي.
2. افتح `DIAGNOSE_WINDOWS.bat`. عند طلب **Updater folder**، الصق مسار مجلد التحديث الذي يحتوي على `vendor\python\python.exe`.
3. عند طلب **Application parent / journal**، الصق `C:\data entry application` أو مسار ملف `.schemacraft-update-journal-*.json`، ثم اختر سجل التحديث الفاشل إذا ظهرت عدة سجلات.
4. أرسل فقط ملف `migration-diagnostic-....json` الجديد الموجود بجانب أداة التشخيص. يظهر مساره الكامل عند الانتهاء.

الأداة للقراءة فقط: لا تشغل أو توقف PostgreSQL، ولا تتصل بقاعدة البيانات، ولا تعيد الترحيل، ولا تصلح أو تحذف أو تعدل بيانات الشركة. لا يتضمن التقرير كلمات المرور أو قيم متغيرات البيئة أو سجلات الشركة.
