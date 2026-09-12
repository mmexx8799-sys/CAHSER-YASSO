# Known Issues — Nour-Elrahman

## مفتوحة (Open)

BUG-P0-1
Problem: المرتجعات مش مربوطة بفاتورة أصلها (لا يوجد originalInvoiceId)
Severity: High
Status: Fixed (REQ-P0-1 — 2026-09-12)

BUG-P0-1b
Problem: ترقيم الفواتير/المشتريات عشوائي (Date.now()) بدل تسلسلي
Severity: Medium
Status: Fixed (REQ-P0-1b — 2026-09-12)

BUG-P0-3
Problem: لا تحقق أن السعر المُرسَل من العميل يطابق سعر المنتج المسجَّل فعليًا في المنتجات (احتمال تلاعب بالسعر عبر استدعاء مباشر)
Severity: High
Status: Open

BUG-P0-4
Problem: الاستعادة (Restore) تنفّذ factoryReset (حذف كامل) قبل التحقق من صحة محتوى ملف النسخة الاحتياطية
Severity: Critical
Status: Fixed (REQ-P0-4 — 2026-09-12)

BUG-P0-4b
Problem: لا يوجد schemaVersion/appVersion في بيانات النسخ الاحتياطي
Severity: Medium
Status: Fixed (REQ-P0-4 — 2026-09-12)

BUG-P0-5
Problem: لا يوجد حارس in-flight في عملية البيع (POSPage) — إمكانية إرسال فاتورة مكررة بضغط مزدوج أثناء شبكة بطيئة (موجود بالفعل في المرتجعات)
Severity: Medium
Status: Fixed (REQ-P0-5 — 2026-09-12)

BUG-P0-6
Problem: ثغرات أمنية في التبعيات — قبل الإصلاح: 44 ثغرة (4 critical, 21 high, 16 moderate, 3 low) — بعد `npm audit fix` (بدون --force) في REQ-P0-6: 22 ثغرة متبقية (1 critical, 5 high, 16 moderate)
Severity: High
Status: Open — Partially Fixed (non-breaking only)
Details (2026-09-12):
- تم تشغيل `npm audit fix` فقط (بدون --force، بدون تعديل يدوي لـ package.json) — package.json بدون أي semver-major، package-lock.json فقط تغيّر (480 إضافات/2721 حذف).
- المتبقي 22: @capacitor/cli (tar → يحتاج 8.5.2 major)، vite (esbuild + path traversal → يحتاج 8.3.0 major)، exceljs (uuid → يقترح downgrade إلى 3.4.0 مرفوض — load-bearing لـ M10 Excel export)، react-router/react-router-dom (يحتاج 7.18.3 major)، sharp (libvips → لا يوجد fix)، @capacitor/assets + @trapezedev/project/xcode (لا يوجد fix)، بالإضافة لـ firebase/undici المتبقي (يتطلب تحديث firebase major لاحقًا).
- المرفوض/المؤجل كمخاطرة مقبولة أو Backlog: @capacitor/cli, vite, exceljs, @capacitor/assets, sharp — سيتم إعادة التقييم عند ترقية major مخططة.

BUG-P1-2
Problem: importmap يشير لـ aistudiocdn.com موجود في ملف الإنتاج المبني فعليًا
Severity: Low
Status: Open

## مخاطرة مقبولة — بقرار مالك المنتج (Accepted Risk — Owner Decision)

BUG-P0-2 — 2026-09-12
Problem: أي مستخدم نشط (مش admin بس) يقدر يعدّل customers/suppliers/invoices/returns مباشرة من الـ SDK (balance/openingBalance)
Severity: Critical → Accepted Risk
Status: Accepted Risk (Owner Decision — 2026-09-12) — لا يُعد ثغرة عاجلة
Decision Rationale:
- كل المستخدمين المصرح لهم بالدخول موظفون معروفون وموثوقون، وليس عملاء أو أطراف خارجية.
- الاستغلال يتطلب معرفة تقنية متعمدة (أدوات المطور + كتابة كود مباشر) غير متوفرة لدى مستخدمي النظام الفعليين.
- الإصلاح الكامل يتطلب إما getAfter/complex rules أو ترقية إلى Blaze (Cloud Functions) — غير مبرر حاليًا.
- تم اختبار التضييق المقترح (diff().affectedKeys() على balance/openingBalance) وتبيّن أنه يكسر المسار الطبيعي: processSale/addCustomerPayment/processReturn تصبح DENIED للكاشير (firestore.rules لا تميّز بين كتابة مباشرة و transaction شرعي). تم التراجع فورًا (git checkout firestore.rules).
Follow-up: يبقى موثّقًا للمستقبل — إعادة التقييم عند الترقية لـ Blaze أو عند إضافة أدوار/مستخدمين خارجيين.
Ref: docs/REQ-P0-2-baseline.md — تقرير الخطوات 0-2

## مُغلَقة (Closed)

BUG-P0-5 — حارس الإرسال المكرر — Status: Fixed (REQ-P0-5 — 2026-09-12)
BUG-P0-1b — ترقيم عشوائي — Status: Fixed (REQ-P0-1b — 2026-09-12)
BUG-P0-1 — المرتجعات بدون ربط — Status: Fixed (REQ-P0-1 — 2026-09-12)
BUG-P0-4 — الاستعادة قبل التحقق — Status: Fixed (REQ-P0-4 — 2026-09-12)
BUG-P0-4b — لا يوجد schemaVersion — Status: Fixed (REQ-P0-4 — 2026-09-12)
BUG-P0-8 — عدم استقرار البناء المزعوم — Status: Closed (كان PASS فعليًا، تأكد ببناء نظيف)
BUG-P0-9 — بيع/مرتجع ممكن على يومية مقفولة — Status: Fixed (commit d5d7d0f)
BUG-P0-10 — بيع منتج وهمي بدون خصم مخزون — Status: Fixed (commit dd438b2)
BUG-P0-11 — لا تحقق من إجمالي/خصم سالب على مستوى الخادم — Status: Fixed (commit dd438b2)
BUG-P0-12 — دفعات بقيمة سالبة أو صفر مقبولة — Status: Fixed (commit dd438b2)
