# Changelog — Nour-Elrahman

## Unreleased — PERM-2026-09 (2026-09-21)
- **REQ-PERM-0 — أساس وجرد (قراءة فقط):** وسم `pre-perm-2026-09` على `e7771f2`, جرد واجهة/قواعد, إثبات فصل `balance` — لا كود — **Done**
- **REQ-PERM-1 — الطبقة النقية `fcb1e2d`:** `types.ts: capGrants/capDenies` + `utils/permissions.ts: archive.view + OVERRIDABLE_CAPS + effectiveCan` + `tests/permissionsOverrides.test.ts` + `permissionsParity` + `rbacMatrix: archive.view→UI_ONLY` — 27 ملف/269 اختبار
- **REQ-PERM-2 — القواعد `d9cdb0d`:** `firestore.rules: hasCap + capListsValid + permissionAudit + D-P7` + `tests/permissionsRules.test.ts` + مواءمة — نشر `firebase deploy --only firestore:rules --project casher-yasoo` — 28 ملف/340 اختبار
- **REQ-PERM-3 — الواجهة الحية `4de2a31` + `22c0032` + `21130c1` + `98a01ad`:** `AuthContext onSnapshot` + `usePermissions effectiveCan` + `buildNavItems/resolveLanding` + بوابات `sell/return` + `statement.export` — الفهرس `permissionAudit` نُشر بالـ`Indexes` — النهاية `21130c1 → 98a01ad` مع إصلاحات lint/مهلة/حراسة
- **REQ-PERM-4 — المحرر `020dba9` + `a16b048`:** `services/api.ts:setUserCapOverrides` + `components/PermissionEditorModal.tsx` + `utils/capOverrides.ts` + `firestore.indexes.json` + `tests/capOverrides` + `setUserCapOverrides` — إصلاحات `a16b048` (toast, emulator, تعليقات, audit api)

## Unreleased — RBAC-2026-09 G0 (2026-09-19)
- **REQ-RBAC-0 — Owner decisions + measured baseline (no code change):** تسجيل قرارات G0 (D-1: izatadel007@gmail.com owner, D-2:(أ) D-3:موافقة D-4:الآن D-5:Deferred D-6:يبقى D-7:لاحقًا) في `docs/known-issues.md` + قياس خط الأساس الخام: `tsc --noEmit` نظيف · `build` نظيف (938kB) · `test:rules` **130/130 أخضر (18/18)** بدل «64» القديم (تصحيح E-15) + `concurrentSalesHigh` خط الأساس: N=10 10/10, N=12 12/12, N=15 15/15, متعدد 10/10 + E-16: `android/` موجود (ليس محذوفًا) + تحديث `backlog.md` (In Progress RBAC-0…5) و`current-state-map.md` — ⛔ STOP قبل R1 لمراجعة Claude.

## Unreleased (سابق)
### Stage-3 — اختبارات (2026-09-17)
- [3.1] E2E حقيقي (Playwright/Chromium): `e2e/happy-path.spec.ts` — دخول → فتح أرشيف → بيع → مرتجع → إغلاق أرشيف → نسخ (download) → استرجاع (filechooser) — ضد المحاكيات فقط عبر `VITE_USE_EMULATORS=1` (services/firebase.ts) + `npm run test:e2e` — مع `tests/e2eJourney.test.ts` (نفس الرحلة خدميًا: مرتجع مربوط + v2 round-trip + INV-000002 بلا تكرار — يعمل في CI بلا متصفح) — خطافات `data-testid` على الدخول/اليومية/الدفع/الإرجاع/التأكيد (بلا تغيير سلوكي)
- [3.2] تزامن عالٍ موسّع (BUG-P0-14): `tests/concurrentSalesHigh.test.ts` — N=10 same-tick ≥8/10، N=12 متموج ≥10/12، N=15 ضغط ≥10/15، N=10 متعدد المنتجات ≥8/10 — كلها بثوابت صارمة (عدّاد/فرادة/مخزون/أرشيف) — السويت الكلي 59→64
- [3.3] تحديث `docs/current-state-map.md` (التاريخ 2026-09-17 + جرد الاختبارات الحقيقي 64 + حالتي E2E والتزامن) + أرقام CI (64)
### Stage-2 — بنية الإنتاج (2026-09-16)
- [2.4] سكريبتات `lint` (eslint.config.mjs — بوابة أخطاء فقط، التحذيرات توثق AUDIT-ARCH-1 ومسارات backlog) + `typecheck` (`tsc --noEmit`) — كلاهما ناجح + بناء إنتاجي سليم + تنظيف ~35 متغيرًا/استيرادًا ميتًا بلا أي تغيير سلوكي
- [2.3] خط CI (`.github/workflows/ci.yml`): lint + typecheck + build + الـ 56 اختبارًا على المحاكيات (Java 21) لكل PR، ونشر `firestore:rules` فقط بعد الدمج في main + موافقة عبر environment — يحتاج 3 خطوات يدوية لمرة واحدة (branch protection + environment reviewers + سر FIREBASE_SERVICE_ACCOUNT) موثقة أعلى الملف
- [2.2-free] تتبع أخطاء مجاني 100% ونشط الآن: مجموعة `clientErrors` (كتابة صارمة للنشطين، قراءة/حذف للأدمن — `firestore.rules`) + مُبلِّغ Firestore محدود الحصة في `services/monitoring.ts` مربوط بـ ErrorBoundary ومعالجات window — يُفحص من Console بلا أي خدمة خارجية؛ السويت أصبح 59 (3 قواعد جديدة) — ملاحظة: القاعدة الجديدة تحتاج `firebase deploy --only firestore:rules` لتعمل إنتاجيًا
- [2.1] إعداد Staging: alias محجوز (`casher-yasoo-staging` في `.firebaserc`) + منافذ المحاكيات مثبتة في `firebase.json` + runbook إنشاء ونشر وبيانات وهمية في DEPLOY.md — إنشاء المشروع نفسه يتم من Console (لا يمكن من الكود)
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
- [REQ-SEC1-8 closeout] إغلاق نهائي: Phase 1/2 (Functions/Blaze) مرفوضة بقرار Ahmed (2026-09-16) — لا فوترة على Spark؛ كتابة balance المنفردة تبقى مفتوحة لغير الأدمن إلى أجل غير مسمى كوضع مقصود وموثق
- [Stage-1 2026-09-16] بند 1.2: إعادة تدقيق npm audit برقم حقيقي (`npm audit --json`: 26 = 2 critical + 5 high + 19 moderate) + إثبات `npm audit fix --dry-run` أنه لا يوجد إصلاح non-breaking — بلا تغيير في package.json/lock — Ref: known-issues BUG-P0-6
- [Stage-1 2026-09-16] بند 1.3: التحقق من history الـ git (وليس الكود الحالي فقط) — `git log -S private_key` فارغ + `git log --all -- *serviceAccount* *.keystore .env keystore.properties` فارغ + `git ls-files` بلا .env/serviceAccountKey/keystore/zips — لم يُكتشف أي مفتاح حقيقي مُسرّب؛ الوحيد في الـ history هو firebaseConfig (apiKey علني بطبيعته في Firebase Web — ليس سرًا) + سطر example email وهمي (izatadel007@gmail.com) أُزيل في 8e1f317؛ AUDIT-SEC-2b (env vars) و2c (key path عبر env + gitignored) ساريان في الكود الحالي
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
### Verification — 2026-09-17: testing production approval gate after bypass removal
