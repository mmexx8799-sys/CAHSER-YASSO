# PLAN — REV1-4 (implement AFTER owner approves this file)

## REQ-REV1-4a — finite guards (implement FIRST)

Approach: add pre-network shape blocks mirroring the REV1-3 position —
after the opKey validation lines, immediately before `await
assertOnline()`, outside any try so the Arabic message reaches the caller
verbatim:
- `processSale` (`services/api/sales.ts`, after the REV1-3 item loop
  ~:35-42): `typeof invoiceData.subtotal !== 'number' ||
  !Number.isFinite(invoiceData.subtotal)` → sale-subtotal message;
  same shape for `invoiceData.total` → sale-total message.
- `processPurchase` (`services/api/purchases.ts`, after
  `assertValidOpKey` :41, before `await assertOnline()` :42): same two
  shapes on `purchaseData.subtotal` / `purchaseData.total`.
- `addCustomerPayment` (`services/api/customers.ts`, after the opKey
  strip ~:133, before `await assertOnline()` :134) and
  `addSupplierPayment` (`services/api/suppliers.ts`, same position):
  `!Number.isFinite(payment.amount)` → amount message, ADDED beside the
  existing `!amount || amount <= 0` guard (that guard stays untouched).
No other line in these functions moves; read/write order inside the
transactions is unchanged.

Test strategy (no emulator, no network wait — rejection precedes any
I/O): new `tests/rev14FiniteGuards.test.ts` with `assertOnline` mocked to
throw `STOP-AFTER-GUARD` (mock `../services/api/core` by spreading the
actual module — verified single import source for all four services — and
overriding only `assertOnline`): invalid inputs assert the VERBATIM Arabic
message AND that the mocked `assertOnline` was never called (this second
assertion is what proves the pre-network position); valid controls (0,
19.99, 100) assert termination WITH `STOP-AFTER-GUARD` (guard passed,
execution reached the network gate, nothing further). RED on current code
for ALL 18 invalid cases (sale 2 fields × 3 values + purchase 2 × 3 +
customer-payment 3 + supplier-payment 3): sale/purchase NaN/+Infinity sail
through to the gate, sale/purchase -Infinity is caught only
in-transaction past the gate, and all three payment values reach the
post-gate amount check — every one of them ends at STOP-AFTER-GUARD
instead of the Arabic message (payments NaN/-Infinity were already
rejected, but only after the network gate). Only the valid controls are
GREEN on current code. Green path through the network is already covered
by the full existing emulator suite.

Risks: a UI somewhere legitimately sending non-finite totals would now
fail fast (mitigated: recon shows all UI totals are computed floats or
`Number(x)` conversions; `Infinity` can only arrive via hostile input).
Rollback: revert commit.

## REQ-REV1-4b — logout cache clear (implement SECOND)

Approach (all inside `services/dataCache.ts` + one line in
`services/auth.ts` + watcher wiring in `contexts/AuthContext.tsx`):
- New exported `clearSubscriptionCache()`: synchronously invoke every
  stored `unsubscribe` EXACTLY ONCE per entry — all `collectionEntries`
  lists, then all `cache` (document) values — each call individually
  try/caught (silent: logout path, no toast surface) — then mark every
  entry dead (`listening = false` + `callbacks.clear()`) and `.clear()`
  all three maps (`collectionEntries`, `cache`, `activeSubscriptions`).
  The dead-marking is what makes AC-4b.6 hold: a still-mounted
  component's stale closure finds `listening === false` and stops.
- New exported pure predicate `didAuthIdentityChange(prevUid, nextUid)`
  (`prev !== next`, both `string | null`) in `services/dataCache.ts`,
  co-located with the cache it guards (no new file): covers logout
  (uid → null), account switch and other-tab/session-expiry transitions
  (uidA → uidB), and stays silent on null → null.
- `services/auth.ts` `signOut`: call `clearSubscriptionCache()` first,
  then `firebaseSignOut` (two lines; nothing else changes) — kept for the
  strict ordering guarantee.
- `contexts/AuthContext.tsx`: at the top of the
  `onAuthStateChangedListener` callback, compare the incoming uid against
  a new `lastUidRef` via the predicate; on true, clear first, then update
  the ref and continue with existing handling untouched.
- Synchronous teardown is load-bearing: the AC-4b.2 ordering guarantee
  cannot hold through the microtask path.

Test strategy (mocked `onSnapshot` at the boundary, rev1Cache pattern —
no emulator needed): new `tests/rev14CacheClear.test.ts`:
- subscribe collection A + document B → `clearSubscriptionCache()` →
  both unsubscribes invoked EXACTLY ONCE each, resubscribe creates a FRESH
  listener (RED-able: function missing today ⇒ TypeError; dead-entry
  sharing).
- AC-4b.6: subscribe → clear → invoke the ORIGINAL closure → assert the
  mocked SDK unsubscribe total is exactly 1 (RED-able: stale closure
  re-fires today because nothing marks entries dead).
- `signOut()` ordering with `firebase/auth` signOut mocked: dataCache
  unsubscribes resolve BEFORE the auth call (RED-able: untouched today).
- `didAuthIdentityChange` truth table unit test (null→null false,
  null→uid / uid→null / uidA→uidB true, uid→same false; RED today — the
  predicate does not exist ⇒ TypeError). CHOICE,
  stated for review: predicate unit, NOT a rendered-AuthContext test —
  a full-component test would need React rendering plus Auth mocking
  plus async effect churn (brittle, slow, emulator-adjacent), while the
  wiring itself is ~5 lines reviewed by eye and the predicate carries
  the whole decision contract.
- double-clear + clear-empty are no-ops that call the missing export
  (RED today via TypeError; GREEN after the fix — they lock the safety
  behavior, not pre-existing green).

Risks: a component unmounting mid-logout double-releases (mitigated:
Set-delete + `listening` flag make the same-closure-twice case idempotent,
proven by AC-1.7b — corrected honestly: AC-1.7b does NOT cover a stale
closure invoked after its entry was dropped by a clear; that distinct
case is why the clear marks entries dead, proven by the new AC-4b.6
test). Rollback: revert commit.

## ALLOWED-FILES (exact)
- `tests/` — TWO new files only (`tests/rev14FiniteGuards.test.ts`,
  `tests/rev14CacheClear.test.ts`)
- `services/api/sales.ts` (pre-network finite block only)
- `services/api/purchases.ts` (pre-network finite block only)
- `services/api/customers.ts` (one finite line + `round2` import if needed —
  none; no import change: no new identifier used)
- `services/api/suppliers.ts` (same, one line)
- `services/dataCache.ts` (`clearSubscriptionCache` + `didAuthIdentityChange`
  predicate + nothing else)
- `contexts/AppSettingsContext.tsx` (gate the appSettings subscription on
  `currentUser?.uid` + `shouldSubscribeAppSettings` predicate export only)
- `services/auth.ts` (one call line inside `signOut`)
- `contexts/AuthContext.tsx` (watcher wiring: `lastUidRef` + predicate call
  at the callback top only)
- `specs/002-rev14-input-cache-guards/evidence/` (raw outputs)
- docs ×4 (entries only, same commit as the docs commit)

## Evidence protocol (mandatory, per step)
`npx vitest run <file>` RED on unfixed (save raw) → fix → GREEN →
`npm run typecheck` → full `npm run test:rules` (retry-once only for
migrateRoles cold flake, save both outputs) → `npm run build` →
`npx eslint` (must not exceed 349 problems / 112 errors / 237 warnings
locally; CI-scope gate on top: `npm run lint` exits 0 with 0 errors and
≤ 237 warnings).
Save raw + exit codes under `specs/002-rev14-input-cache-guards/evidence/`.

## Docs (at commit time, entries only)
changelog entry (both items, behavior notes) + backlog entry for archive
totals (text only, zero code) + tasks.md boxes. `known-issues.md` and
`current-state-map.md` get entries only if a line explicitly demands it
(decide with grep at the time).

## Order
T4.1 (finite tests RED) → T4.2 (clear tests RED) → T4.3 (finite fix GREEN)
→ T4.4 (clear fix + auth wiring GREEN) → T4.5 (full verification +
evidence) → T4.6 (docs ×4 + commits). No fix before its RED output is
saved. One code commit + one docs commit (cycle convention).
