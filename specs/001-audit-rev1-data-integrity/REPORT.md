# REPORT — AUDIT-REV1: data-integrity fixes (REV1-3 → REV1-1 → REV1-2)

Base: tag `pre-rev1` = `ca729db`. Branch: `master`. No `firestore.rules` /
`package.json` / CI changes in the whole cycle (proven in
`evidence/final/constraints.txt` — empty diff on all hard-constraint paths).

## REQ-REV1-3 — buyQuantity/price shape validation in processSale/processReturn

- **Problem:** `processSale`/`processReturn` accepted non-finite, zero, or
  negative quantities (and negative prices) before any network contact.
- **Root:** no shape check at the service boundary (gap at
  `services/api/sales.ts:31-32`, `services/api/returns.ts:46-47`).
- **Fix:** validation blocks before `assertOnline()` and before any
  read/write; finite `buyQuantity > 0`, finite `price >= 0` per item, with
  the Arabic message on the thrown Error itself. Fractions allowed
  (purchase parity, owner decision D-3a).
- **Commits:** `c859d0d` (code+tests+spec/evidence), `9573e92` (docs).
- **RED→GREEN:** RED 18/20 on unfixed (the 2 passing were the valid-fraction
  cases) → GREEN 33/33. Full suite 560/560 (527 old + 33 new).
- **Behavior change (intended):** negative-price returns are now rejected
  (cashier sees the generic toast, not the precise message); price 0 passes
  the new check but the old 50%-floor (BUG-P0-3) still rejects it;
  empty-cart/missing-items out of scope (optional backlog).
- Evidence: `evidence/REV1-3/`.

## REQ-REV1-1 — dataCache key collision + fan-out

- **Problem:** (1) different queries shared one cache entry/listener;
  (2) only the first subscriber ever received live updates.
- **Root:** `generateCacheKey` degraded every constraint to `c.type`
  (`_toFieldFilter` does not exist in installed firebase@10.14.1), so all
  `where`s on a path shared one key; the single `onSnapshot` invoked only
  the first subscriber's closure (later ones got one cached snapshot, then
  silence; after the first unsubscribed, the listener kept calling the
  stale closure).
- **Fix (`services/dataCache.ts` only):** per-path entries holding the BUILT
  query; sharing decided solely by public `queryEqual`; each entry holds a
  Set of callbacks all notified by the single `onSnapshot`; unsubscribe
  removes only its own callback; last release tears down via the existing
  microtask `safeUnsubscribe`; query construction first (throw ⇒ fail
  closed, nothing stored, no leaked count); per-callback try/catch +
  `console.error` isolation. No constraint reordering anywhere.
  `subscribeToDocument` untouched.
- **Commits:** `0307dc2` (code+tests+evidence), `0742a3d` (docs incl. F6).
- **RED→GREEN:** RED 18/9 of 27 on unfixed (incl. a mutation proof that the
  try/catch alone greens AC-1.6b: 26/27 without it) → GREEN 27/27. Full
  suite 587/587 (560 old + 27 new, one migrateRoles cold-flake retry).
- **Behavior changes (intended):** `[where, orderBy]` ≡ `[orderBy, where]`
  share (SDK canonicalizes into separate slots — verified empirically);
  `[where a, where b]` ≢ `[where b, where a]` never share; orderBy order
  never normalized.
- **Production exposure (from code analysis — not measured, not observed live):**
  per-entity filtered paths shared one entry across customers/suppliers/
  archives (`customerPayments/invoices/returns`, `supplierPayments/
  purchaseInvoices/supplierReturns`, Reports `invoices/returns`) —
  expected effect is a flicker of the previous entity's data until the
  first snapshot; the call-site grep found no overlapping subscription on the same path.
- Evidence: `evidence/REV1-1/` (red.txt → red-6.txt, green.txt,
  mutation-6b.txt, full verification set).

## REQ-REV1-2 — decimal dust in balances + raw UI comparisons

- **Problem:** stored balances accumulated binary dust (e.g. `0.1+0.2 ⇒
  0.30000000000000004`, measured on emulator for all six writers) and the
  UI compared raw balances (`=== 0`, `> 0`, `< 0`).
- **Root:** the six writers stored raw float arithmetic; 12 UI sites
  (the plan said 10; 3 per page × 4) compared unrounded values; missing
  balance read as `undefined` (sale stored NaN — proven on
  emulator; payments would have stored silent 0 under round2 alone).
- **Fix:** `round2` around the new balance inside the existing transaction
  at all six write sites (sales/returns/customers/suppliers/purchases×2);
  new `utils/money.ts` (`round2` re-exported from `opKey.ts` — one source;
  `isSettled(b) = |b| < 0.005`); 12 UI sites via `isSettled` on the same
  line (badges keep gray first, delete guards `!isSettled`, footers settled
  ⇒ red branch like current zero). `round2` moved from inside
  `buildFingerprint` to module scope with `export` (identical semantics —
  opKeyStore 34/34 intact). Missing balance reads as 0 via `|| 0` (sale +
  both payments, covered by dedicated tests).
- **Commits:** `336faac` (code+tests+evidence), `920020d` (docs).
- **RED→GREEN:** unit file-level RED (missing module) → 19/19; service
  11/1 of 12 → 13/2 of 15 (A2) → 17/17 incl. 2 R1 tests; tx3Payments
  17/17 after the documented expectation update; negativeBalancePolicy
  4/4; opKeyStore 34/34. Full suite 623/623 first try (60 files).
- **Behavior changes (intended):** NaN/missing-balance parties now
  deletable (were blocked by `!== 0`); `-0` is actually stored on dusty
  over-settlement (measured on emulator — harmless: `isSettled(-0)`,
  display via `Math.abs`); 0.01 creditor stays creditor; negative balances
  stay allowed (NEG-1 intact).
- **AC-2.5:** no migration (Spark constraint) — old dusty docs handled by
  UI tolerance only; production volume unmeasured (REV1-2-SCAN backlog).
- Evidence: `evidence/REV1-2/`.

## Honest deviations from the plan

- (a) `tx3Payments`: 8 expectations edited under documented owner
  exception — they asserted raw dust (`200 - AMT = 166.67000000000002`)
  and were replaced with cents literals (166.67 / 133.34).
- (b) The plan said 10 UI sites; the lines are 12 (3 per page × 4).
- (c) `round2` was local inside `buildFingerprint`, so it was hoisted to
  module scope with `export` (logic byte-identical).
- (d) R1 review caught that payments would silently store 0 on missing
  balance under round2 alone → `(currentBalance || 0)` added + 2 tests.
- (e) `_toFieldFilter` does not exist in SDK 10.14.1 — every `where`
  collided, worse than the plan's assumed partial degradation.
- (f) REV1-1 tests were corrected mid-review (call-count → last-call
  content; real fail-closed design; `[where, orderBy]` interleave shares).

## Residual risks (classified)

- **Measured:** `-0` stored in one over-settlement shape (emulator);
  harmless by construction (`===`, `Math.abs`, `isSettled`).
- **Code analysis (not observed live):** F6 — the subscription cache is
  never cleared; after REV1-1 entries grow with distinct queries
  (customer/supplier/archive) — session growth unmeasured live.
- **Code analysis (not observed live):** previous-entity flicker in account
  pages until first snapshot; delete guard now admits NaN balances;
  pre-fix dusty balances in production are unmeasured (REV1-2-SCAN).
- **Untested:** no real cashier device, no production traffic, no real
  browser walkthrough — emulator + static + unit only.

## Deploy status

Nothing deployed. Production remains `ca729db` / DEPLOY-3. No deploy
recommendation — owner's call. Optional pre-deploy checks: run
REV1-2-SCAN, plus manual walkthrough of three flows (account-to-account
navigation, full credit settlement to 0, negative-price return rejection).
