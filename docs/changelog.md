# Changelog — Nour-Elrahman

## Unreleased
### Added
- [REQ-UI-1b] تمييز الفاتورة/المرتجع الآجل في الإيصال — "إيصال بيع آجل" (paymentMethod آجل) و"إيصال مرتجع آجل" (مرتبط بعميل) بلون أزرق مميز عن النقدي، ظاهر في كل الشاشات التي تستخدم نفس المودال (components/InvoiceDetailModal.tsx)
- [REQ-UI-1] إعادة تصميم مودال الفاتورة/الإيصال — ألوان receipt theme-adaptive، شبكة Grid بمحاذاة دقيقة، شارة نوع العملية (بيع/شراء/مرتجع/مرتجع مورد) وشريحة رقم المستند monospace، إجمالي المرتجع بالأحمر (components/InvoiceDetailModal.tsx, tailwind.config.js)
- [REQ-P0-1b] ترقيم تسلسلي ذري للفواتير/فواتير الشراء عبر counters (INV-000001/PUR-000001) داخل نفس transaction (services/api.ts, firestore.rules)
- [REQ-P0-1] ربط المرتجع بالفاتورة الأصلية — اختيار فاتورة العميل + فحص الكمية المتبقية + تخزين originalInvoiceId (types.ts, services/api.ts, pages/ReturnsPage.tsx) + عرض الربط في تاب المرتجعات وكشف الحساب (pages/CustomerAccountPage.tsx)
### Fixed
- [REQ-P1-2] إزالة كتلة importmap الميتة (aistudiocdn.com) من index.html — dead scaffold من Vite bundling (index.html)
- [REQ-P0-3] التحقق السعري الخادمي — رفض المبيعات/المرتجعات بسعر متلاعب (أقل من 50% من أقل سعر معرّف) داخل نفس مرحلة قراءات productDocs قبل أي كتابة (services/api.ts) — مع استثناء خصم تفاوضي حتى 50% (POSPage/ReturnsPage تعديل يدوي) وسياسة مؤقتة موثّقة كـ backlog
- [REQ-P0-6] إصلاح ثغرات npm audit غير الكاسرة — 44→22 (1 critical, 5 high, 16 moderate) عبر `npm audit fix` بدون --force؛ package.json بدون major bump (vite, @capacitor/cli, exceljs كما هي) — package-lock فقط (package-lock.json) — اختبار حي حقيقي بعد `firebase deploy --only firestore:rules`: بيع نقدي success + بيع آجل success (2026-09-12)
- [REQ-P0-5] منع الإرسال المكرر للبيع — حارس in-flight يمنع double-click في POS (pages/POSPage.tsx) — نفس نمط ReturnsPage
- [REQ-P0-4] أمان الاستعادة: التحقق من بنية النسخة الاحتياطية و schemaVersion قبل أي حذف (services/api.ts)
### Security
- [REQ-SEC1-8 Phase 0] تجميد openingBalance عن غير الأدمن (customers/suppliers) + حواجز رقمية خادمية (customerPayments/supplierPayments amount>0، invoices/purchaseInvoices/returns/supplierReturns total>=0) — بلا أي مساس بـ services/api.ts؛ الكتابة المنفردة لـ balance تبقى مخاطرة مقبولة موثقة باختبار (firestore.rules, tests/balanceOpeningFreeze.test.ts 9/9، كامل السويت 56/56)
- [REQ-P0-4] منع فقدان البيانات عبر رفض الاستعادة من ملف ناقص/تالف قبل factoryReset
### Docs
- [P0-6 follow-up] إغلاق بدليل حي + توثيق فجوة نشر firestore.rules كحادثة مغلقة وإضافة قاعدة منهجية دائمة (docs/req-template.md#7: أي REQ يلمس firestore.rules يجب أن يرفق `firebase deploy --only firestore:rules`)
- [P0-2] توثيق BUG-P0-2 كمخاطرة مقبولة بقرار مالك المنتج (2026-09-12): المستخدمون موظفون موثوقون، الاستغلال يتطلب معرفة متعمدة، والإصلاح يكسر المسار الطبيعي — لا تغيير في الكود (firestore.rules أُعيد لحالته)

## 2026-09-10..12
### Added
- شاشة مرتجع مورد (REQ-M6)
- تصنيف دائن/مدين للعملاء والموردين (REQ-M7)
- رصيد افتتاحي منفصل وثابت (REQ-M8)
- كشف حساب موحّد مع رصيد جاري + تصدير CSV/Excel (REQ-M9, M9-fix, M9-fix2, M10)
- أسهم تعديل كمية + توگل قطاعي/جملة في المرتجعات (REQ-M13)
### Fixed
- تمرير مودال تعديل المنتج وتفاصيل الفاتورة على الشاشات الصغيرة (REQ-M11, M12)
- منع البيع/الإرجاع على منتج غير موجود، إجمالي/خصم سالب، دفعات غير موجبة (P0-10/11/12)
- منع البيع/الإرجاع على يومية مقفولة (P0-9)
### Security
- تقييد إعادة فتح يومية مقفولة على الأدمن فقط (P0-9، firestore.rules)
