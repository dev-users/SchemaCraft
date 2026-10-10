# SchemaCraft PostgreSQL consolidation — Batch 7

1. Extract the entire ZIP to a separate folder. Do not run it inside the ZIP.
2. Save your work and close SchemaCraft and the workspace's Excel files.
3. Run `UPDATE.bat`.
4. Choose the existing application folder containing `data`. Confirm that the app is closed.
5. Click **Check data**, then **Update and clean up**.
6. After successful completion, click **Open SchemaCraft** or open `SchemaCraft.exe` in the updated application folder. The app is already built; no rebuilding or Python installation is required.

This update requires PostgreSQL for deployed applications. An existing PostgreSQL database is verified and retained; an Excel installation is migrated and checked before activation. Record, schema, metadata and attachment fingerprints must match before cleanup can complete.

After successful verification, identified old storage workbooks, existing app recovery/backup archives, PostgreSQL migration originals and this installation's updater backups are removed. Temporary transactional copies exist until the updated database passes verification at its final location. A failed or interrupted operation keeps the recovery material needed to resolve that operation; **Recover interrupted update** remains available.

Saved imports, exports, Excel documents outside identified storage paths, attachments, history, settings, access credentials and customized interface wording are preserved. Future automatic and manual backup features remain enabled and can create new backups normally. Backups belonging to other installations are preserved. Unrecognized content in a recovery folder stops cleanup for review instead of being guessed at.

The installed app contains the prebuilt executable, interface assets, fonts and its managed PostgreSQL runtime. Recognized obsolete source/build tools are retired from the installed copy. The updater's own private Python is only inside this separate update package. PostgreSQL's sealed runtime files remain complete. Vite/Nuxt is deferred to a separate frontend change.

Successful verification receipt: `data/.postgresql/consolidation-update.json` in the updated app. The updater also offers **Open report** and **Save report copy**. All data stays on this computer. After closing the successful updater, its separate extracted package folder can be removed.

## تعليمات التطبيق

استخرج الحزمة كاملة في مجلد منفصل، ثم احفظ العمل وأغلق البرنامج وملفات Excel التابعة له. شغل `UPDATE.bat` واختر مجلد البرنامج الحالي الذي يحتوي على `data`. اضغط **التحقق من البيانات** ثم **التحديث والتنظيف**. بعد اكتمال العملية افتح البرنامج من زر **فتح SchemaCraft** أو من `SchemaCraft.exe`. النسخة جاهزة ولا تحتاج إلى إعادة بناء.

بعد نجاح التحقق يحذف التحديث ملفات Excel القديمة الخاصة بالتخزين ونسخ الاستعادة والتحديث الموجودة. يحتفظ بملفات الاستيراد والتصدير والمرفقات والإعدادات وسجل العمليات وكلمات المرور ونصوص الواجهة المعدلة. تبقى ميزات النسخ الاحتياطي المستقبلية متاحة. لا تحذف نسخ العمل المؤقتة إلا بعد نجاح التحقق من قاعدة البيانات في مسارها النهائي. إذا توقفت العملية تبقى مواد الاستعادة اللازمة ويمكن استخدام زر استعادة التحديث المتوقف.
