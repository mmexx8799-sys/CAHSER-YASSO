PROJECT STATUS — Nour-Elrahman (casher-yasoo) — 2026-09-23 — **OFFLINE-P1 مكتمل** (REQ-OFF1-0…5 Done — precache 37 فريد، حارس 22 دالة، بانر تحديث + حماية كتابة جارية، تسجيل 14 يوم في الإعدادات) — P2 (الطابور) مؤجل حتى 2026-10-06
(Stage-3 — الاختبارات: البنود 3.1/3.2/3.3 مغلقة — كان تاريخ هذا الملف 2026-09-10 — الآن PERM مغلقة)

PERM-2026-09 — نموذج الصلاحيات
- وثيقة `users/{uid}`: `role, disabled, capGrants?: string[], capDenies?: string[], permsUpdatedBy/At` — غياب الحقلين = السلوك القديم — `effectiveCan` يطبق: disabled/role فاسد → false, owner → مصفوفة, غير قابلة → مصفوفة, منع → false, منح (محاسب كتابة يُتجاهل) → true, وإلا مصفوفة — `capListsValid` تفرض `hasOnly(overridableCaps)` و`!hasAny` و`owner بلا حقول` و`accountant ⊆ ui`.
- القابلة للتجاوز (17): طبقة A تُفرض في القواعد (13): `sell, return, customer.payment, supplier.ops, product.create, product.price, product.delete, category.write, settings.write, archive.open, archive.close, customer.write, supplier.write` — طبقة B واجهة فقط (4): `report.view, archive.view, dashboard.view, statement.export` — كلها في `utils/permissions.ts: OVERRIDABLE_CAPS` و`firestore.rules: overridableCaps()` — مواءمة regex في `tests/permissionsParity`.
- غير قابلة (5): `users.manage, data.restore, data.reset, ledger.delete, backup.export` — `NON_OVERRIDABLE_CAPS` — منحها يُتجاهل.

Core Architecture (React/TS/Firebase/Capacitor)   ✅ Stable
Database (Firestore)                              🟡 Needs Review (indexes/rules ناقصين تاريخيًا)
Authentication                                     ✅ Stable
RBAC (صلاحيات admin/cashier)                        ✅ Done — RBAC-2026-09 Done (REQ-RBAC-2 bc46c07, REQ-RBAC-3 d61c246, REQ-RBAC-4 b1ebb4b, REQ-RBAC-5 e7771f2 — 2026-09-19→20) ثم وُسِّعت بـPERM-2026-09 (22 قدرة — `utils/permissions.ts:8` 22 سطر `| '...'`)
Customers / Suppliers Accounts                     ✅ Complete (REQ-M6..M9-fix2)
Statement / Excel Export                           ✅ Complete (web only) — APK path 🟡 Pending (مسار المشروع عربي)
POS + Returns Cart UX                               ✅ Complete
Daily Archive Lock                                  ✅ Fixed (P0-9)
Financial Guardrails (phantom product/negative)     ✅ Fixed (P0-10/11/12)
Return↔Invoice Linking                              ✅ Fixed (P0-1 — 2026-09-12)
Sequential Invoice Numbering                        ✅ Fixed (P0-1b — 2026-09-12)
Backup/Restore Safety                               ✅ Fixed (P0-4/P0-4b — 2026-09-12)
Double-Submit Guard (POS Sale)                      ✅ Fixed (P0-5 — 2026-09-12)
Dependency Security (npm audit)                     🟡 Partial — P0-6 (26: 2 critical/5 high/19 moderate عبر `npm audit --json` — الحد الأقصى الآمن بلا major، أُعيد التدقيق 2026-09-16)
Price Tampering Guard (unit price 50% floor)          ✅ Fixed (P0-3 — 2026-09-12 — سياسة مؤقتة)
Build Scaffold Cleanup (importmap aistudiocdn)       ✅ Fixed (P1-2 — 2026-09-12)
Invoice/Receipt Modal (theme-adaptive Grid)         ✅ Fixed (UI-1 — 2026-09-12)
Invoice/Receipt Credit Distinction (آجل badge)       ✅ Fixed (UI-1b — 2026-09-12)
Automated Tests (vitest + Emulator)                ✅ Active — **130 اختبارًا** على المحاكيات (firestore/auth) عبر `npm run test:rules` — تسلسلي (--fileParallelism=false) — مقاس فعليًا 2026-09-19 على e24fe3e (كان «64» رقمًا قديمًا من 2026-09-17):
  archiveCalculations 6 (pure) · dashboardAggregation 12 · stockAlerts 14 · balanceOpeningFreeze 9 · changePassword 4 · clientErrorsRules 3 ·
  processReturn 8 (TEST-REG-P0-1) · productsRules 9 · sec1ProfileGuards 4 · countersRules 11 (منها N=5 بوابة ≥4/5 + N=20 توثيقي) ·
  backupCounters 5 (BUG-P0-15) · e2eJourney 1 (رحلة كاملة خدميًا — Stage-3 3.1) · concurrentSalesHigh 4 (N=10/N=12/N=15/متعدد — Stage-3 3.2) ·
  posBarcodeSearch 16 · posBarcodeCloudFallback 8 · fixDashboard09 5 · barcodeGeneration 6 · cartAddResult 5 — الإجمالي 130/130 أخضر (18/18 ملف) — مدة 45.58s
  تصحيح E-15: «64» كان من current-state-map 2026-09-17؛ الفارق 66 = باركود/داشبورد/تنبيهات مخزون أُضيفت بعد 2026-09-17 دون تحديث العداد (يثبت بالقياس أعلاه).
E2E (Playwright/Chromium — حقيقي بالمتصفح)         ✅ Added (Stage-3 3.1 — يحتاج تشغيلًا يدويًا: `npm run test:e2e` بعد `npx playwright install --with-deps chromium`):
  e2e/happy-path.spec.ts — دخول → فتح أرشيف → بيع نقدي UI → مرتجع نقدي UI → إغلاق أرشيف → نسخ (download حقيقي) → استرجاع (filechooser حقيقي) — ضد المحاكيات فقط عبر VITE_USE_EMULATORS=1 (services/firebase.ts) — لا يلمس الإنتاج.
  المرتجع *المربوط* بفاتورة مغطى خدميًا في e2eJourney (بحث العميل التفاعلي هش كأتمتة UI — القرار موثق في رأس الـ spec).
High-Concurrency Confidence (BUG-P0-14)             ✅ Raised (Stage-3 3.2 + G0 re-measured 2026-09-19): N=10 same-tick **10/10**، N=12 متموج (5ms — الأقرب لواقع الكاشير) **12/12**، N=15 ضغط **15/15**، N=10 متعدد المنتجات **10/10** — كلها بثوابت صارمة (عدّاد == قبل+ناجح، أرقام فريدة، مخزون وأرشيف بالمليم). N=5 بوابة ≥4/5 و N=20 توثيقي في countersRules أيضًا أخضر. residual risk فوق N=15 ما زال موثقًا (الحل البنيوي Cloud Function مؤجل — لا sharded counters). **خط الأساس لـ R1: أي انحدار تحت هذه الأرقام = Stop.**
Staging Environment                                 🟡 Partial — alias محجوز + runbook في DEPLOY.md (إنشاء المشروع من Console)
Monitoring / Error Tracking                         ✅ Free tier نشط — مجموعة clientErrors + services/monitoring.ts (Stage-2 2.2-free)
Android APK Build                                   ✅ Exists — `android/` موجود في الشجرة (فحص E-16 في R0: `git status` نظيف — ليس محذوفًا؛ كان يظهر D في أرشيف قديم لا في الشجرة الحالية)
CI                                                  ✅ lint + typecheck + build + **الـ 130 اختبارًا** على كل PR (.github/workflows/ci.yml — كان يذكر 64؛ يُصحح في R0/AC-02) — نشر firestore:rules بعد الدمج + موافقة environment
RBAC Baseline (G0 — 2026-09-19)                      📏 `npx tsc --noEmit` نظيف (0 أخطاء) · `npm run build` نظيف (ذروة 938.00 kB `index-C-4EqcBk.js` — 16.59s) · `npm run test:rules` **130/130 أخضر (18/18)** — 45.58s · `git status --short` نظيف · E-16: `android/` ليس محذوفًا · جرد users الإنتاج: يتطلب فحص Console يدويًا قبل W0 (لا مستخدم بلا role صالح — فيتو R1) — المحاكي بلا users
