PROJECT STATUS — Nour-Elrahman (casher-yasoo) — 2026-09-10

Core Architecture (React/TS/Firebase/Capacitor)   ✅ Stable
Database (Firestore)                              🟡 Needs Review (indexes/rules ناقصين تاريخيًا)
Authentication                                     ✅ Stable
RBAC (صلاحيات admin/cashier)                        🔴 Needs Review — P0-2 مفتوح
Customers / Suppliers Accounts                     ✅ Complete (REQ-M6..M9-fix2)
Statement / Excel Export                           ✅ Complete (web only) — APK path 🟡 Pending (مسار المشروع عربي)
POS + Returns Cart UX                               ✅ Complete
Daily Archive Lock                                  ✅ Fixed (P0-9)
Financial Guardrails (phantom product/negative)     ✅ Fixed (P0-10/11/12)
Return↔Invoice Linking                              🔴 Not Started — P0-1
Sequential Invoice Numbering                        🔴 Not Started — P0-1b
Backup/Restore Safety                               ✅ Fixed (P0-4/P0-4b — 2026-09-12)
Double-Submit Guard (POS Sale)                      🟡 Partial — P0-5 (موجود في المرتجعات، ناقص في البيع)
Dependency Security (npm audit)                     🔴 Needs Review — P0-6 (21 ثغرة، 2 critical)
Automated Tests (unit/integration/E2E)              ❌ Not Started
Staging Environment                                 ❌ Not Started
Monitoring / Error Tracking                         ❌ Not Started
Android APK Build                                   🟡 Blocked (مسار المجلد بحروف عربي — مؤجل لحد النقل)
