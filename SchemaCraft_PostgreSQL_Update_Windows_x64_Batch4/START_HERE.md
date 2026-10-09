# SchemaCraft Windows cumulative update — Batch 4

This update also repairs EXE building. Apply it to the same original application/developer folder, then run build-windows.bat there. The build checks the finished EXE and creates release/SchemaCraft-Windows-User with SchemaCraft.exe and its PostgreSQL runtime. Full 64-bit Python 3.13 with Python Launcher is required for EXE building; the update includes all offline build wheels. See CHANGELOG_BATCH4.md for the build/package distinction.


This is Batch 4. Extract to a short location such as C:\SCUpdate, close the application, and select the same original application copy. Earlier blocked staging/backup folders can remain untouched. New working copies use the short .scu folder next to the application; earlier recovery journals remain supported. If blocked again, send the new migration report, which includes the failing operation and safe cause codes. The optional diagnostics/DIAGNOSE_WINDOWS.bat collects client readiness without connecting to or changing a database.

Supported target: Windows 10 version 1903 (build 18362) or later, or Windows 11, on x64 computers. The launcher checks this before any data migration.

1. Close SchemaCraft and any Excel windows using its files.
2. Extract this entire ZIP into a new folder outside your existing application folder. Keep the extracted files together. Do not run the batch file inside the ZIP preview.
3. Double-click **UPDATE_WINDOWS.bat**. It checks the bundled Python, Tcl/Tk and graphical window, then opens the updater. A console stays open while the updater runs.
4. Choose the existing SchemaCraft application folder: the folder containing the program and its **data** folder.
5. Click **Check data**. Read the report; resolve any blocked items before continuing.
6. Click **Update and migrate**. Wait for the verified completion message. The updater makes a complete application backup, migrates a separate staged copy, verifies the database after two starts, then publishes it.
7. Click **Open SchemaCraft**, or double-click **OPEN_SCHEMACRAFT.bat** in the updated application folder for subsequent launches.
8. To rebuild the EXE, close SchemaCraft, run **build-windows.bat** in that updated original folder and wait for **Build completed**. The new **SchemaCraft.exe** in that folder uses its existing database. **release/SchemaCraft-Windows-User** is a fresh distribution with no copied company data.

The updated application uses its bundled Python and managed local PostgreSQL. No separately installed Python, PostgreSQL or administrator installation is needed. The updater's previous custom EXE launchers are replaced with batch files. The old application EXE is retained in the complete backup and retired from the staged application; use OPEN_SCHEMACRAFT.bat after a successful update.

The original Excel workbooks and attachments are preserved. Successful activation means PostgreSQL is the active data store; retained Excel workbooks serve as migration originals. This update does not delete them.

If no window opens, the console displays the reason and remains open. Double-click **CHECK_WINDOWS_STARTUP.bat** to repeat the startup diagnosis; it never selects an application or migrates data. The diagnostic log is **updater-startup.log**, beside these batch files. If files are missing, extract a fresh complete copy of the ZIP.

This package can migrate an Excel application or update an already migrated PostgreSQL application. For interrupted updates, use the graphical **Recover interrupted update** action and preserve the updater's backup/work folders.

## تعليمات مختصرة

أغلق البرنامج وملفات Excel المرتبطة به، ثم فكّ ضغط الملف كاملاً في مجلد جديد خارج مجلد البرنامج الحالي. شغّل UPDATE_WINDOWS.bat، وحدّد مجلد البرنامج الذي يحتوي على مجلد data. اضغط «فحص البيانات»، ثم «تحديث وترحيل» عند نجاح الفحص. انتظر رسالة اكتمال التحقق، ثم شغّل البرنامج المحدّث من OPEN_SCHEMACRAFT.bat. تبقى ملفات Excel والمرفقات الأصلية محفوظة، ويصبح PostgreSQL مخزن البيانات الفعّال بعد نجاح الترحيل. إذا لم تظهر النافذة، تظهر تفاصيل الخطأ في النافذة السوداء وتُحفظ في updater-startup.log.

لإعادة بناء ملف EXE، أغلق البرنامج وشغّل build-windows.bat من مجلد البرنامج الأصلي بعد تحديثه. يلزم Python 3.13 بإصدار 64 بت مع Python Launcher. بعد ظهور Build completed، شغّل SchemaCraft.exe الموجود في المجلد الأصلي ليستخدم قاعدة البيانات الحالية. المجلد release/SchemaCraft-Windows-User مخصّص لنسخة توزيع جديدة ولا يحتوي على بيانات الشركة.
