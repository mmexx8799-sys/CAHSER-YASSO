PROJECT STATUS — Nour-Elrahman (casher-yasoo) — 2026-09-10

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
Dependency Security (npm audit)                     🟡 Partial — P0-6 (44→22: 1 critical/5 high/16 moderate؛ المتبقي major/no-fix مؤجل — 2026-09-12)
Price Tampering Guard (unit price 50% floor)          ✅ Fixed (P0-3 — 2026-09-12 — سياسة مؤقتة)
Build Scaffold Cleanup (importmap aistudiocdn)       ✅ Fixed (P1-2 — 2026-09-12)
Automated Tests (unit/integration/E2E)              ❌ Not Started
Staging Environment                                 ❌ Not Started
Monitoring / Error Tracking                         ❌ Not Started
Android APK Build                                   🟡 Blocked (مسار المجلد بحروف عربي — مؤجل لحد النقل)
