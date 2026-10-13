# SPEC — REV1-5: deferred-unsubscribe logout teardown (K2) + epoch guard (K3-variant)

Cycle: REV1-5 on Nour-Elrahman (casher-yasoo, React/TS + Firebase + Vite PWA).
Base: `a15d8fe` (REV1-4 final evidence + REPORT). Scope = exactly the 2 items
below; anything else observed goes to `docs/backlog.md` as an entry only
(no code change).
Status: SPECIFY phase — no production code written under this spec yet.

Conventions: file:line references are against BASE (`a15d8fe`). Installed
SDK: firebase@10.14.1. `test:rules` = `firebase emulators:exec --only
firestore,auth "npx vitest run --fileParallelism=false"`. Baseline suite at
base: 62 test files / 673 tests green. Do NOT push. Do NOT deploy.

---

## REQ-REV1-5a — logout teardown via deferred `safeUnsubscribe` (K2)

### Problem
`services/dataCache.ts` `clearSubscriptionCache` (:53-85) invokes the raw SDK
`entry.unsubscribe()` SYNCHRONOUSLY for collection entries (:61) and document
entries (:76). The normal per-subscriber release path defers through
`safeUnsubscribe` (:105-114, `queueMicrotask`) — the documented workaround
for SDK 10.14.1 `INTERNAL ASSERTION FAILED: Unexpected state` when teardown
races an in-flight watch event. The logout path bypasses it. The per-call
try/catch catches synchronous throws only; the SDK assertion can surface
inside its async queue, so the catch is not evidence of safety.

Heavy subscribers at logout (expected from code analysis, not observed on a
device): ReportsPage (4), SupplierAccountPage (up to 7),
CustomerAccountPage (4), DashboardPage (3), POSPage, ProductsPage,
ReturnsPage, ArchivePage, UsersPage, BulkBarcodePrintModal.

A manual browser test on a local preview build did NOT reproduce the
assertion (Firestore uses `persistentLocalCache` + a tiny dataset, so the
race window is very narrow). That is not proof of absence.

### Root (read verbatim at BASE)
- `clearSubscriptionCache` calls `entry.unsubscribe()` directly, twice
  (collection loop :61, document loop :76).
- `safeUnsubscribe` (microtask + own try/catch + `console.warn`) is used
  ONLY by the two normal release closures (:194, :246).
- `services/auth.ts` `signOut` (:23-28) already calls
  `clearSubscriptionCache()` first, then `firebaseSignOut` — auth.ts is NOT
  modified by this cycle.

### Acceptance Criteria
- AC-5a.1: in `clearSubscriptionCache`, replace BOTH raw
  `entry.unsubscribe()` calls with `safeUnsubscribe(entry.unsubscribe)`.
  Hoist `safeUnsubscribe` (and its `Unsubscribe` type) above
  `clearSubscriptionCache`; no behavior change to `safeUnsubscribe` itself.
- AC-5a.2: everything else stays synchronous and unchanged:
  `listening = false`, `callbacks.clear()`, and emptying all three maps.
  Dead-marking stays sync so stale closures can never re-fire an SDK
  unsubscribe.
- AC-5a.3: keep the `if (entry.listening)` / `activeSubscriptions.has(key)`
  guards — each live SDK unsubscribe is still scheduled EXACTLY ONCE; a
  second `clearSubscriptionCache()` schedules nothing.
- AC-5a.4 (ordering invariant, replaces the old "sync before auth"
  wording): every scheduled unsubscribe runs BEFORE any
  auth-state-change notification can be delivered after `firebaseSignOut`
  (microtask FIFO precedes the macrotask). `services/auth.ts` is NOT
  modified (it already calls clear first, then signOut).

### Edge cases
Logout with an empty cache (no-op); clear during an in-flight snapshot
callback (callbacks already cleared ⇒ no notification); `safeUnsubscribe`'s
own try/catch still swallows SDK errors (`console.warn`); entries released
before the clear are not unsubscribed twice (guards, AC-5a.3).

### Non-goals
No change to `safeUnsubscribe` semantics, ref-counting, or sharing. No
change to `services/auth.ts`, `contexts/**`, `pages/**`, `components/**`.

---

## REQ-REV1-5b (OPTIONAL, defensive — K3 variant) — same file

### Problem
`subscribeToDocument`'s release closure addresses the entry BY KEY
(`cache.get(cacheKey)`), not by instance: a pre-clear subscriber releasing
after a clear + resubscribe on the same key would unsubscribe the NEW
subscriber's listener. Nobody is exposed today (one subscriber per document
key everywhere — `AppSettings`, account pages — expected from code
analysis), and the collection path is already safe by entry identity.

### Acceptance Criteria
- AC-5b.1: module-level `let cacheEpoch = 0`; incremented inside
  `clearSubscriptionCache`.
- AC-5b.2: `subscribeToDocument` captures `const myEpoch = cacheEpoch` at
  subscribe time; its release closure returns immediately if
  `myEpoch !== cacheEpoch` (a pre-clear subscriber must never touch
  post-clear counts or entries).
- AC-5b.3: no other behavior change to `subscribeToDocument` /
  `subscribeToCollection`.

---

## OUT OF SCOPE (explicit — backlog entries only, zero code)
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`,
  `package.json`, `package-lock.json`, `.github/**`, `services/auth.ts`,
  `contexts/**`, `pages/**`, `components/**` — untouched (proven in
  `evidence/final/constraints.txt` — empty).
- K2 is NOT closed/verified by this cycle even on success (see REPORT
  honesty rules): a real-device logout-during-live-list test is still
  REQUIRED before deploy.
