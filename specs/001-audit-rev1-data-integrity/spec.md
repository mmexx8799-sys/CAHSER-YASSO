# SPEC — AUDIT-REV1 data integrity (cycle: spec → plan → tasks → STOP → implement)

Cycle: AUDIT-REV1 on Nour-Elrahman (casher-yasoo, React/TS + Firebase + Vite PWA).
Base: tag `pre-rev1` = `ca729db`. Scope = exactly the 3 REQs below; anything
else observed goes to `docs/backlog.md` as an entry only (no code change).
Status: SPECIFY phase — no production code written under this spec yet.

Conventions: file:line references are against BASE. Arabic UI strings are
normative (copy verbatim, never retype from memory). `test:rules` =
`firebase emulators:exec --only firestore,auth "npx vitest run
--fileParallelism=false"`. Baseline (evidence/00-baseline/manifest.txt):
tsc exit 0; test:rules 56 files / 527 tests exit 0 (one cold-run
migrateRoles timeout flake on first attempt, full retry green);
build exit 0 (precache 41); eslint exit 1 with 112 errors ALL in
`.scratch/` (git-ignored) + 239 warnings, 0 errors elsewhere.

---

## REQ-REV1-1 — dataCache key collision (services/dataCache.ts:21-28)

### Problem
`generateCacheKey` builds the sharing key from constraint *types* only.
Two subscriptions to the same collection with different constraint VALUES
(e.g. `where('customerId','==','A')` vs `...'B'`) compute the SAME key, so
subscriber B receives A's cached data and no second listener is created.

A SECOND, larger defect in the same function (independent review
2026-10-06, `services/dataCache.ts:72-89`): the single `onSnapshot`
listener is bound to the FIRST subscriber's `callback` closure only. A
second subscriber on the same key gets the cached snapshot once and then
NEVER receives live updates; if the first subscriber unsubscribes while
the second is active, the listener keeps invoking the first (possibly
unmounted) callback. Fixing the key alone would leave shared subscribers
without live updates.

### Evidence
- `services/dataCache.ts:21-28`: key = `constraints.map(c =>
  JSON.stringify((c as any)._toFieldFilter ? ... : c.type)).join(';')`.
- `_toFieldFilter` does NOT exist in the installed SDK
  (@firebase/firestore 4.7.3 — 0 matches in node_modules), so every field
  filter degrades to `c.type` (`"where"`), and `orderBy` degrades to
  `"orderBy"`. A vs B ⇒ identical key `invoices::"where";"orderBy"`.
- Independently reproduced by the reviewer: subscriber B receives A's data
  from the shared entry; a concurrent differently-filtered subscription
  creates no listener of its own.
- Sharing machinery to preserve: ref-count in `activeSubscriptions`
  (dataCache.ts:63-64, 92-101, 119-120, 145-156) and the microtask-safe
  `safeUnsubscribe` (dataCache.ts:32-47, workaround for SDK 10.14.1
  INTERNAL ASSERTION on mid-watch teardown).

### Acceptance Criteria
- AC-1.1: two subscriptions to the same path whose constraint VALUES differ
  never share a cache entry or a listener.
- AC-1.2: same path + semantically equal constraints still share ONE
  listener (ref-counted; unsubscribe of A while B active keeps the
  listener; last release unsubscribes via the existing microtask path).
- AC-1.3: no reliance on private SDK members (`_...`); the `_toFieldFilter`
  branch is deleted.
- AC-1.4: if equivalence cannot be determined (e.g. Query construction
  throws), FAIL CLOSED — no sharing — rather than risk sharing.
- AC-1.5: existing subscribers' observable behavior unchanged (immediate
  cached-data callback on subscribe, live updates, cleanup on unmount).
- AC-1.6 (added 2026-10-06): each shared entry holds a SET of subscriber
  callbacks (fan-out); the single `onSnapshot` notifies ALL of them, so a
  second subscriber on an equal query receives every live update not just
  the first cached snapshot.
- AC-1.7 (added 2026-10-06): unsubscribe removes ONLY that subscriber's
  callback; A leaving while B is active changes nothing for B; the last
  release tears the listener down through the existing microtask path.
  (No ALLOWED-FILES change — all inside `services/dataCache.ts`.)

### Edge cases
Reordered constraints; `limit`/`startAfter` cursors; callback fired from
stale cache after switching customer; unsubscribe of A while B active;
subscribe/unsubscribe/subscribe churn; empty constraints; constraints array
rebuilt per render (fresh object identity must NOT defeat equality).

### Non-goals
No change to `subscribeToDocument` keying (`path/docId`, already exact).
No TTL/eviction policy. No P0-2 work.

---

## REQ-REV1-2 — decimal dust in balances

### Problem
Balances are computed with raw IEEE-754 arithmetic and stored unrounded,
so fully-settled parties keep dust (e.g. `-2.66e-15`), and exact
comparisons/badges misbehave.

### Evidence
- Reviewer reproduction: invoices 19.99 + 33.33 + 10.1 + 7.7 paid
  individually ⇒ stored balance `-2.66e-15`; lump payment 71.12 ⇒
  `-1.42e-14`; `balance !== 0` is then true.
- Writers (all compute `current ± amount/total` with no rounding):
  `services/api/sales.ts:129`, `services/api/returns.ts:232`,
  `services/api/customers.ts:172-173`, `services/api/suppliers.ts:171-172`,
  `services/api/purchases.ts:111` and `:251`. `services/api/backup.ts`
  (restore) writes documents verbatim — no balance arithmetic found
  (to be re-confirmed at implement time; if none, it is excluded with
  this evidence).
- NaN hazard (added 2026-10-06): `round2` maps NaN → `0` silently
  (`Number(n) || 0`). `services/api/sales.ts:128` reads
  `customerData.balance` with NO `|| 0` (unlike `returns.ts:231`), so a
  missing balance today stores NaN (loud, detectable) but would store `0`
  after naive rounding (silent debt loss). Fix: sales writes
  `round2((currentBalance || 0) + invoiceData.total)` — same shape as
  `returns.ts:231` — plus a dedicated missing-balance test.
- Comparisons/badges/delete-guards (10 sites):
  `pages/CustomersPage.tsx:86,87` (badge text/color), `:223` (`!== 0`
  delete guard);
  `pages/SuppliersPage.tsx:86,87` (badge), `:224` (delete guard);
  `pages/CustomerAccountPage.tsx:567` (liveBalance badge text), `:568`
  (liveBalance value color), `:483` (Excel footer font color
  `liveBalance >= 0 ? 'FFB91C1C' (red) : 'FF15803D' (green)` — exact `0`
  is RED today, NO neutral color exists there);
  `pages/SupplierAccountPage.tsx:582` (badge text), `:583` (value color),
  `:494` (Excel footer, same red/green rule).
  Footer rule (corrected 2026-10-06 — the old "settled ⇒ neutral,
  byte-identical to exact-`0`" was WRONG): settled ⇒ SAME treatment as
  exact `0` today, i.e. the RED branch, e.g.
  `(isSettled(b) || b > 0) ? 'FFB91C1C' : 'FF15803D'`. Screen badges
  (`:567/:568`, `:582/:583`) keep their EXISTING neutral gray class for
  the settled branch (it exists there).
  Statement running totals (`CustomerAccountPage.tsx:273-276`,
  `SupplierAccountPage.tsx:284-287`) are derived display values already
  shown with `toFixed(2)`; `pages/ReturnsPage.tsx:508` is display-only.
  No debt-total aggregation found in DashboardPage/ReportsPage (re-confirm
  at implement time).
- Canonical rounding already in repo: `services/api/opKey.ts:60`
  `const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;`
  (module-private — reuse via a new `export`, do not fork the logic).

### Acceptance Criteria
- AC-2.1: new shared helper module (proposed `utils/money.ts`) exports
  `round2(n)` (identical semantics to opKey.ts:60, via import — single
  source of truth) and `isSettled(balance)` = `|b| < 0.005`.
- AC-2.2: EVERY balance write listed above rounds the NEW balance with
  `round2` inside the existing transaction (no new transactions, no
  reordering of reads/writes).
- AC-2.3: EVERY UI sign/zero comparison listed above (`=== 0`, `!== 0`,
  `> 0`, `< 0`, `>= 0`, badges, delete guards, footer colors) goes through
  the helper; no raw balance comparison remains (grep-backed assertion
  recorded in plan).
- AC-2.4: after paying any combination of 2-decimal invoices in full, the
  STORED balance is exactly `0`.
- AC-2.5: already-dusty production documents are handled by UI tolerance
  only. NO migration script (Spark-plan constraint).

### Edge cases
Partial payments; overpayment (creditor of exactly 0.01 must still read
as creditor, not settled); negative balances (allowed per REQ-NEG-1 —
tolerance must not block or mask them); returns reducing balance;
1000-item accumulation; classic `0.1 + 0.2`.

### Non-goals
No integer-piaster storage change. No migration. No P0-2 work. No change
to opKey fingerprint semantics (round2 there is untouched in behavior;
only an `export` keyword is added).

---

## REQ-REV1-3 — buyQuantity validation missing in sales/returns

### Problem
`processSale` and `processReturn` accept any `buyQuantity` (0, negative,
NaN, Infinity, non-number strings) — no shape check, no boundary test —
while `processPurchase` rejects them.

### Evidence
- Parity reference: `services/api/purchases.ts:94`
  (`typeof item.buyQuantity !== 'number' || !Number.isFinite(item.buyQuantity)
  || item.buyQuantity <= 0` → `كمية الشراء غير صالحة للصنف …`) and
  `:230` (supplier-return equivalent). `services/api/sales.ts:82-92`
  (existence + stock checks only) and `services/api/returns.ts:146-181`
  (remaining-quantity checks only) have NO equivalent shape check.
- Insertion point (per AC): immediately after `assertValidOpKey`, BEFORE
  `assertOnline()` and before any pre-transaction read —
  `services/api/sales.ts:31-32`, `services/api/returns.ts:46-47`.
  Consequence (verified on code, independent review 2026-10-06): both
  points sit BEFORE their `try {` (`sales.ts:33`, `returns.ts:68`), so the
  error is thrown OUTSIDE the catch — the `sales.ts:172` heuristic is
  unreachable by construction, and the caller (e.g. `pages/POSPage.tsx:277-282`)
  shows its generic toast. This is deliberate defense-in-depth (normal UI
  never sends bad quantities); the normative artifact is the Arabic
  message ON THE THROWN Error itself, not any toast path.
- opKeyStore behavior on pre-write throw (corrected 2026-10-06 after
  independent review — the previous "never invoked / no key minted"
  wording was WRONG): the service IS invoked as `send` inside
  `submitWithOpKey` (e.g. `pages/POSPage.tsx:249-252`), and `prepare()`
  (`utils/opKeyStore.ts:401-432`) calls `writeRecord` — minting the key
  in memory+storage — BEFORE `send` ever runs; on a plain throw `run()`
  (`:491-505`) rethrows with NO clear (only mismatch/success clear).
  Consequences, all verified on code: the key+record LINGER harmlessly
  until TTL; a CORRECTED cart (changed identity) goes through lookup of
  the old key (doc absent — nothing was written → exists:false), mints a
  fresh key and succeeds; an UNCORRECTED cart hits `memoryHit` on the same
  key and repeats the same error; offline at lookup ⇒
  aborted/lookup-failed. Tests must exercise this through the REAL
  `submitWithOpKey` with a stubbed `getRecordDoc`, not by calling the
  service directly.

### Acceptance Criteria
- AC-3.1: `processSale` and `processReturn` validate EVERY item
  synchronously at the stated position, rejecting non-number, NaN,
  Infinity, `0`, and negatives with an Arabic message distinct from
  existing messages.
- AC-3.2 (corrected 2026-10-06 after independent review): the error is
  thrown BEFORE the `try` (by design — defense in depth), and the Arabic
  message exists ON THE THROWN ERROR ITSELF. The old `:172`-misroute
  hypothesis is STRUCK (unreachable by construction); no test asserts any
  toast path.
- AC-3.3: price validation parity only — validate what `purchases.ts:97`
  validates; the 50%-floor policy (BUG-P0-3) is untouched.
- AC-3.4: a rejected call writes NOTHING (no invoice/return doc, no
  stock/balance/counter movement), including when one bad item hides among
  valid ones.
- AC-3.5 (corrected 2026-10-06): a rejected call leaves its minted key +
  record lingering harmlessly until TTL; the immediate CORRECTED re-call
  succeeds via lookup (exists:false) + fresh key; the UNCORRECTED re-call
  reuses the same key and repeats the error. Both proven through the real
  `submitWithOpKey` with a stubbed `getRecordDoc` (exists:false), plus an
  offline-at-lookup case ⇒ aborted/lookup-failed.

### Edge cases
Empty cart; one bad item among valid ones; string `"2"`; very large
numbers; returns linked via `originalInvoiceId`; fractional `1.5`
(valid iff D-3 = (a)).

### Non-goals
No refactor of the `:172` heuristic. No price-policy change. No
`__testOnRetry` signature change.

---

## Decisions for the owner (D-1..D-3) — APPROVED (أ / أ / أ), 2026-10-06

### D-1 (cache key)
- (a) Compare built queries with public `queryEqual()` per path
  (verified present in installed SDK:
  `node_modules/@firebase/firestore/.../lite-api/reference.d.ts` →
  `function queryEqual(left: Query, right: Query): boolean`, re-exported
  through `firebase/firestore`). Exact, no private API. **Recommended.**
- (b) Callers pass explicit `cacheKey`; no key = no sharing. Coarse,
  touches every call site, split-brain risk if two callers disagree.
- (c) Both. Extra machinery without a second concrete need (YAGNI).

**Recommendation: (a).**

### D-2 (dust)
- (a) `round2` at write + `|b| < 0.005` tolerance in UI. No migration.
  **Recommended.**
- (b) Integer-piaster storage. Correct but requires migrating existing
  production data — rejected unless the owner insists.

**Recommendation: (a).**

### D-3 (quantities)
- (a) Mirror purchases exactly: finite number and `> 0` (fractions
  allowed). Parity, smallest semantic delta. **Recommended.**
- (b) Additionally require integers — only if the owner confirms no
  fractional units are ever sold.

**Recommendation: (a)** (switch to (b) only on explicit confirmation).
