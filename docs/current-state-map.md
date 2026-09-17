PROJECT STATUS — Nour-Elrahman (casher-yasoo) — 2026-09-17
(Stage-3 — الاختبارات: البنود 3.1/3.2/3.3 مغلقة — كان تاريخ هذا الملف 2026-09-10
ويدّعي "Automated Tests: Not Started" وهو غير صحيح منذ أسابيع)

Core Architecture (React/TS/Firebase/Capacitor)   ✅ Stable
Database (Firestore)                              🟡 Needs Review (indexes/rules ناقصين تاريخيًا)
Authentication                                     ✅ Stable
RBAC (صلاحيات admin/cashier)                        🟡 Accepted Risk — P0-2 (قرار مالك المنتج 2026-09-12، موثّق في known-issues.md)
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
Automated Tests (vitest + Emulator)                ✅ Active — 64 اختبارًا على المحاكيات (firestore/auth) عبر `npm run test:rules` — تسلسلي (--fileParallelism=false):
  archiveCalculations 6 (pure) · balanceOpeningFreeze 9 · changePassword 4 · clientErrorsRules 3 ·
  processReturn 8 (TEST-REG-P0-1) · productsRules 9 · sec1ProfileGuards 4 · countersRules 11 (منها N=5 بوابة ≥4/5 + N=20 توثيقي) ·
  backupCounters 5 (BUG-P0-15) · e2eJourney 1 (رحلة كاملة خدميًا — Stage-3 3.1) · concurrentSalesHigh 4 (N=10/N=12/N=15/متعدد — Stage-3 3.2)
E2E (Playwright/Chromium — حقيقي بالمتصفح)         ✅ Added (Stage-3 3.1 — يحتاج تشغيلًا يدويًا: `npm run test:e2e` بعد `npx playwright install --with-deps chromium`):
  e2e/happy-path.spec.ts — دخول → فتح أرشيف → بيع نقدي UI → مرتجع نقدي UI → إغلاق أرشيف → نسخ (download حقيقي) → استرجاع (filechooser حقيقي) — ضد المحاكيات فقط عبر VITE_USE_EMULATORS=1 (services/firebase.ts) — لا يلمس الإنتاج.
  المرتجع *المربوط* بفاتورة مغطى خدميًا في e2eJourney (بحث العميل التفاعلي هش كأتمتة UI — القرار موثق في رأس الـ spec).
High-Concurrency Confidence (BUG-P0-14)             ✅ Raised (Stage-3 3.2): بوابات جديدة N=10 same-tick ≥8/10، N=12 متموج (5ms — الأقرب لواقع الكاشير) ≥10/12، N=15 ضغط ≥10/15، N=10 متعدد المنتجات ≥8/10 — كلها بثوابت صارمة (عدّاد == قبل+ناجح، أرقام فريدة، مخزون وأرشيف بالمليم). residual risk فوق N=15 ما زال موثقًا (الحل البنيوي Cloud Function مؤجل — لا sharded counters).
Staging Environment                                 🟡 Partial — alias محجوز + runbook في DEPLOY.md (إنشاء المشروع من Console)
Monitoring / Error Tracking                         ✅ Free tier نشط — مجموعة clientErrors + services/monitoring.ts (Stage-2 2.2-free)
Android APK Build                                   🟡 Blocked (مسار المجلد بحروف عربي — مؤجل لحد النقل)
CI                                                  ✅ lint + typecheck + build + الـ 64 اختبارًا على كل PR (.github/workflows/ci.yml) — نشر firestore:rules بعد الدمج + موافقة environment
