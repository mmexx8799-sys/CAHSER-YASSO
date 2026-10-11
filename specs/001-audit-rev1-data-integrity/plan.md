# PLAN — AUDIT-REV1 data integrity

Base: `pre-rev1` = `ca729db`. Baseline: evidence/00-baseline/manifest.txt
(tsc 0; test:rules 56/527 exit 0; build 0 precache 41; eslint 112 errors
ALL in `.scratch/` + 239 warnings). Rollback per REQ = `git revert` of
that REQ's commit (each REQ is one commit; revert order is reverse).
Mechanical verification everywhere: `npm run typecheck`;
targeted `npx vitest run <file>`; FULL `npm run test:rules`
(no filtering, single retry only for the known cold-run migrateRoles
timeout flake, both outputs saved); `npm run build`; `npx eslint .`
with outside-`.scratch` counts compared to baseline (must not increase).

Global risks: Firestore emulator cold-start flake (mitigated: retry-once
rule); Arabic message typos (mitigated: copy from spec, verify in full
diff); scope creep (mitigated: ALLOWED-FILES stop-gate per REQ).

---

## REQ-REV1-3 — buyQuantity validation (implement FIRST: smallest)

Approach: insert the purchases.ts:94-shaped check into `processSale`
(between sales.ts:31 and :32) and `processReturn` (between returns.ts:46
and :47), i.e. after `assertValidOpKey`, before `assertOnline()` and any
read. Both points precede their `try {` (`sales.ts:33`, `returns.ts:68`),
so the error escapes any catch BY DESIGN (defense in depth — normal UI
never sends bad quantities) and the normative artifact is the Arabic
message ON THE THROWN ERROR (e.g. `كمية البيع غير صالحة للصنف …` /
`كمية المرتجع غير صالحة للصنف …`): NO toast-path assertion, and the old
`:172`-misroute hypothesis is STRUCK (unreachable by construction —
verified on code 2026-10-06). CORRECTED 2026-10-06: the service IS
invoked as `send` inside `submitWithOpKey`, and `prepare()` mints the key
(writeRecord) BEFORE `send`; on plain throw the key+record LINGER
harmlessly until TTL (only mismatch/success clear). Hence tests go through
the REAL `submitWithOpKey` with stubbed `getRecordDoc` (exists:false):
corrected cart ⇒ lookup-miss ⇒ fresh key ⇒ success; uncorrected cart ⇒
same key ⇒ same error; offline at lookup ⇒ aborted/lookup-failed. Price: mirror purchases.ts:97 check only;
50%-floor untouched.

ALLOWED-FILES (exact):
- `services/api/sales.ts` (validation block only)
- `services/api/returns.ts` (validation block only)
- `tests/` — ONE new file (boundary suite, `test.each`)
- `docs/backlog.md`, `docs/known-issues.md`, `docs/changelog.md`,
  `docs/current-state-map.md` (entries only, same commit)

Risks: message-substring misroute (covered by AC-3.2 test); valid
fractions must keep passing (D-3(a) test case). Rollback: revert commit.

Test strategy (test-guard: Rule 3 `test.each` over
[0, -1, NaN, Infinity, '2', undefined, 0.0] × {processSale,
processReturn} THROUGH the real `submitWithOpKey` (stubbed `getRecordDoc`
exists:false); Rule 4 — each case asserts reject-with-Arabic-message +
nothing-written; plus one valid-fraction case + one
reject-then-corrected-recall-succeeds case + one
same-cart-uncorrected-repeats-error case;
Rule 6 — reference the reviewer repro): emulator-backed
service tests (repo pattern), real carts, assert no doc/stock/balance/
counter movement via Admin SDK reads.

---

## REQ-REV1-1 — cache key (implement SECOND)

Approach: replace string-key sharing with per-path entry lists holding
BUILT queries: on subscribe, build `q = query(collection(db, path),
...constraints)` (no network — pure construction) and compare with
stored entries via public `queryEqual` (verified export, see spec D-1).
Match ⇒ share (ref-count, existing machinery). No match ⇒ own entry +
own listener. Construction throws or equivalence indeterminable ⇒ FAIL
CLOSED (private entry, no sharing). Delete the `_toFieldFilter` branch
and the `c.type` fallback. Additionally (independent review 2026-10-06):
each shared entry holds a SET of subscriber callbacks (fan-out) — the
single `onSnapshot` notifies ALL of them; unsubscribe removes only that
subscriber's callback; last release tears down via the existing
microtask path. Preserve: ref-count semantics, microtask-safe
`safeUnsubscribe`, immediate cached-data callback, cleanup on unmount.
NO constraint reordering/normalization of any kind: orderBy order is
semantically meaningful and must never be sorted; a mere order difference
in `where` yields missed sharing (safe), never collision — so unequal
order ⇒ no-share, no normalize step exists.

ALLOWED-FILES (exact):
- `services/dataCache.ts` (generateCacheKey + subscribeToCollection
  sharing logic only; subscribeToDocument untouched)
- `tests/` — ONE new file (REAL `query()`/`where()`/`orderBy()` from the
  SDK; only `onSnapshot` mocked at the boundary — OR emulator-backed if
  cleaner at implement time, decided in tasks)
- docs ×4 (entries only, same commit)

Risks: listener-count change in hot paths (mitigated: equal-constraint
sharing test); queryEqual order semantics (mitigated: dedicated edge
test). Rollback: revert commit.

Test strategy: collision A-vs-B (B never receives A's data); equal
constraints share one listener; B-shared receives every live update (RED-
able on current code: today B gets the first snapshot only);
unsubscribe-A-keeps-B-receiving; last-release teardown; fail-closed on
throwing constraints; churn; empty constraints.

F6 (backlog only, no code — rides in REV1-1's docs update): the cache is
never cleared (not on last unsubscribe, not on logout) — a new subscriber
briefly sees stale data, and after a user switch in the same browser
session may briefly see the previous user's data. Entry text goes to
`docs/backlog.md` in the REV1-1 commit; zero code change.

---

## REQ-REV1-2 — decimal dust (implement THIRD: widest)

Approach:
1. `services/api/opKey.ts`: add `export` to existing `round2` (:60) —
   semantics untouched (constraint 5 safe: fingerprint math identical).
2. New `utils/money.ts`: `import { round2 }` (single source) +
   `isSettled(b) = Math.abs(Number(b) || 0) < 0.005`. (< 0.005 so an
   exact 0.01 creditor still reads as creditor.)
3. Writes — round the NEW balance with `round2(...)` inside the existing
   transaction, exact sites (NaN-safe: missing balance reads as `0`,
   matching `returns.ts:231` — never let `round2` silently convert a
   missing balance where the old code stored loud NaN; sales uses
   `round2((currentBalance || 0) + invoiceData.total)`):
   - `services/api/sales.ts:129` (`(currentBalance || 0) + invoiceData.total`)
   - `services/api/returns.ts:232` (`currentBalance - totalReturnAmount`, already `|| 0`)
   - `services/api/customers.ts:172-173` (`currentBalance - payment.amount`)
   - `services/api/suppliers.ts:171-172` (same)
   - `services/api/purchases.ts:111` (`+ purchaseData.total`) and `:251`
     (`- totalReturnAmount`)
   - `services/api/backup.ts`: NO balance arithmetic found (verbatim
     restore) — re-verify at implement; excluded unless found, with grep
     evidence in the REQ folder.
4. UI — every sign/zero comparison through the helper, exact sites (10):
   - `pages/CustomersPage.tsx:86,87` (badge text/color), `:223` (delete guard)
   - `pages/SuppliersPage.tsx:86,87` (badge), `:224` (delete guard)
   - `pages/CustomerAccountPage.tsx:567` (badge text), `:568` (value color),
     `:483` (footer `>= 0`)
   - `pages/SupplierAccountPage.tsx:582` (badge text), `:583` (value color),
     `:494` (footer)
    - Footer rule (corrected 2026-10-06 — old "settled ⇒ neutral" was
      WRONG): `:483`/`:494` are Excel font colors where exact `0` is RED
      today and no neutral exists; settled ⇒ SAME red branch, e.g.
      `(isSettled(b) || b > 0) ? 'FFB91C1C' : 'FF15803D'`. Screen badges
      keep their existing neutral gray class for settled.
   - Reviewed, display-only, unchanged: statement running totals
     (`CustomerAccountPage.tsx:273-276`, `SupplierAccountPage.tsx:284-287`,
     already `toFixed(2)`), `pages/ReturnsPage.tsx:508`.
   - DashboardPage/ReportsPage: no debt-total aggregation found —
     re-verify at implement with grep evidence.
5. `negativeBalancePolicy.test.ts` compatibility: tolerance is
   display/guard-only; services still write exact (rounded) values
   including negatives — existing 4 cases must pass unchanged.

ALLOWED-FILES (exact):
- `utils/money.ts` (NEW), `services/api/opKey.ts` (`export` keyword only)
- `services/api/sales.ts`, `services/api/returns.ts`,
  `services/api/customers.ts`, `services/api/suppliers.ts`,
  `services/api/purchases.ts` (balance-write lines only)
- `pages/CustomersPage.tsx`, `pages/SuppliersPage.tsx`,
  `pages/CustomerAccountPage.tsx`, `pages/SupplierAccountPage.tsx`
  (comparison lines only)
- `tests/` — new files (pure unit for helper + emulator service tests +
  grep-backed no-raw-comparison assertion, exact plan in tasks)
- docs ×4 (entries only, same commit)

Risks: missed comparison site (mitigated: grep sweep task + assertion);
overpayment 0.01 misread (mitigated: strict `< 0.005` + dedicated test);
double-rounding drift (mitigated: single `round2` source, no second
implementation). Rollback: revert commit.

Test strategy: pure unit table for round2/isSettled incl.
19.99/33.33/10.1/7.7, 0.1+0.2, and a 1000-iteration random 2-decimal
accumulate-then-pay property asserting stored-exactly-0; per-service
emulator tests asserting rounded stored balances INCLUDING a
missing-balance case (sale on a customer doc without `balance` stores a
finite rounded number, never NaN); no-raw-comparison
assertion (grep or helper-level test, documented).
