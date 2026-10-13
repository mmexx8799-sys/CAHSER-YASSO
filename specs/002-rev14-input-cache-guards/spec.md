# SPEC — REV1-4 input guards + logout cache clear (cycle: spec → plan → tasks → STOP → implement)

Cycle: REV1-4 on Nour-Elrahman (casher-yasoo, React/TS + Firebase + Vite PWA).
Base: merge `cadf9f3` (PR #26, post AUDIT-REV1). Scope = exactly the 2 items
below; anything else observed goes to `docs/backlog.md` as an entry only
(no code change).
Status: SPECIFY phase — no production code written under this spec yet.

Conventions: file:line references are against BASE (`cadf9f3`). Arabic UI
strings below are normative (copy verbatim, never retype from memory).
`test:rules` = `firebase emulators:exec --only firestore,auth "npx vitest
run --fileParallelism=false"`. Installed SDK: firebase@10.14.1.

---

## REQ-REV1-4a — Number.isFinite on totals/subtotal/amount (pre-network)

### Problem
Four money fields reach Firestore writes without a finiteness check, so
`NaN`/`Infinity` can be persisted into financial documents:
- `invoiceData.total`, `invoiceData.subtotal` in `processSale`
- `purchaseData.total`, `purchaseData.subtotal` in `processPurchase`
- `payment.amount` in `addCustomerPayment` / `addSupplierPayment`

### Root (read verbatim at BASE — honest per-site matrix)
- `services/api/sales.ts:118` (`if (invoiceData.subtotal < 0)`) and `:124`
  (`if (invoiceData.total < 0)`): `NaN < 0` is false and `Infinity < 0` is
  false ⇒ **NaN and +Infinity pass**; only `-Infinity` is rejected.
- `services/api/purchases.ts:103` (`typeof … !== 'number' || … < 0`) and
  `:106` (same shape for total): `NaN` passes both arms ⇒ **NaN and
  +Infinity pass**; only `-Infinity` is rejected.
- `services/api/customers.ts:135` and `services/api/suppliers.ts:134`
  (`if (!payment.amount || payment.amount <= 0)`): `NaN` is already
  rejected (`!NaN`), `-Infinity` is already rejected (`<= 0`) ⇒ **only
  +Infinity slips through**.
- All three sites' checks sit AFTER `await assertOnline()` (sales in-tx
  phase; purchases in-tx phase; payments post-preflight), so a hostile or
  corrupted value also costs a network round-trip before failing.

### Evidence
- Recon grep `typeof.*total|total (<=?|<) 0|!.*amount|amount (<=?|<) 0` over
  `services/api` (6 validation lines, zero `Number.isFinite` on the four
  named fields; `products.ts` already uses `Number.isFinite` for catalog
  guards — the pattern to mirror).
- UI sends floats it computes itself (`POSPage.tsx:499`,
  `SupplierAccountPage.tsx:1014/1409/1471`, `ReturnsPage.tsx:315`,
  `Customer/SupplierAccountPage.tsx:109/115` with a `<= 0` toast guard that
  still lets `Infinity` through: `Number("Infinity")` is `Infinity`).

### Acceptance Criteria
- AC-4a.1: `processSale` rejects non-finite `subtotal`/`total`
  (NaN, Infinity, -Infinity) before any network contact.
- AC-4a.2: `processPurchase` rejects non-finite `subtotal`/`total`
  (NaN, Infinity, -Infinity) before any network contact.
- AC-4a.3: both payment functions reject non-finite `amount` before any
  network contact — NaN and -Infinity are already rejected today, but only
  AFTER the network gate (`customers.ts:135`, `suppliers.ts:134` sit past
  `await assertOnline()`); the new guard moves rejection pre-network for
  all three (NaN, Infinity, -Infinity).
- AC-4a.4: rejection carries an Arabic message on the thrown Error itself
  (pre-try position, same convention as REV1-3/REV1-1 guards).
- AC-4a.5: valid finite values (incl. 0) flow through unchanged — covered
  by the existing emulator suite (every existing call site passes finite
  values; zero new green-path tests needed).

### Normative messages (proposed — owner may reword in review, then frozen)
- sale subtotal: `الإجمالي الفرعي للبيع غير صالح`
- sale total: `المبلغ النهائي للبيع غير صالح`
- purchase subtotal: `الإجمالي الفرعي لفاتورة الشراء غير صالح`
- purchase total: `إجمالي فاتورة الشراء غير صالح`
- payment amount (both): `قيمة الدفعة غير صالحة`
Shape: `typeof x !== 'number' || !Number.isFinite(x)` for totals/subtotal;
`!Number.isFinite(payment.amount)` added beside (not instead of) the
existing `!amount || amount <= 0` guard for payments.

### Edge cases
`discount` is NOT in scope (still only the in-transaction `<` check).
`totalReturnAmount` (returns.ts:95, purchases.ts:186) is computed
in-service from REV1-3-validated finite items — out of scope by construction.
Repeated-digit dust (0.1+0.2) is REV1-2 territory, unaffected: finite values
pass these guards untouched.

### Non-goals
No change to in-transaction checks (they stay as defense in depth). No
fingerprint/doc-shape changes. No new dependencies.

---

## REQ-REV1-4b — clear dataCache on logout (ordering-safe)

### Problem
`services/dataCache.ts` keeps three module-level stores —
`collectionEntries` (:32), `cache` (:18), `activeSubscriptions` (:19) —
that are never wiped: not on last unsubscribe, not on logout, not on user
switch. After logout, live listeners keep firing against rules that now
deny the signed-out (or different) user, producing `permission-denied`
noise, and a later subscriber briefly sees the previous user's data (F6).

### Root (read verbatim at BASE)
- `services/auth.ts:22-24`: `signOut` is a bare `firebaseSignOut(auth)` —
  no cache interaction.
- Callers: `contexts/AuthContext.tsx:78`, `App.tsx:43`, `App.tsx:227`.
- Watcher insertion point: top of the `onAuthStateChangedListener` callback
  (`contexts/AuthContext.tsx:40-54`), comparing `(user ? user.uid : null)`
  against a new `lastUidRef` before any other handling.
- `dataCache.ts` has zero `.clear()` calls; the only map `.delete` is the
  per-key refcount release at `:195` (`activeSubscriptions.delete` in the
  document path). `collectionEntries` has get (:79) + set (:82) only.

### Evidence
- Recon greps: `signOut` absent from `pages/`; `\.clear\(\)` absent from
  `dataCache.ts`; F6 backlog entry (REV1-1 docs) already records the
  never-cleared behavior as text.

### Acceptance Criteria
- AC-4b.1: a new exported `clearSubscriptionCache()` (dataCache.ts only)
  synchronously invokes every stored `unsubscribe` (collection entries +
  document cache entries) EXACTLY ONCE per entry, each call guarded so one
  throwing listener cannot block the rest, marks every entry dead
  (`listening = false` + `callbacks.clear()`), then empties all three maps.
  The dead-marking is load-bearing: a still-mounted component calling its
  old closure afterwards must NOT re-trigger an SDK unsubscribe (that
  closure only unsubscribes while `target.listening === true`).
- AC-4b.2: `signOut` in `services/auth.ts` calls it FIRST, then
  `firebaseSignOut` — listener teardown strictly precedes auth loss, so no
  `permission-denied` storm from orphaned listeners.
- AC-4b.3: after a clear, resubscribing the same query creates a FRESH
  listener (no sharing with the dropped entry).
- AC-4b.4: double-clear and clear-with-no-subscribers are safe no-ops.
- AC-4b.5: `subscribeToDocument` behavior otherwise unchanged (its entries
  ride the same clear path; no keying change).
- AC-4b.6: stale-closure safety — subscribe, `clearSubscriptionCache()`,
  then invoke the ORIGINAL unsubscribe closure: the Firestore unsubscribe
  fires exactly ONCE in total (once from the clear, never again from the
  stale closure). (Reviewer correction, recorded honestly: AC-1.7b proves
  same-closure-invoked-twice safety only — it does NOT cover a closure
  invoked after its entry was dropped by a clear. This AC does.)
- AC-4b.7: the AuthContext auth-state watcher (`contexts/AuthContext.tsx`,
  `onAuthStateChangedListener` callback ~:40-54) also calls
  `clearSubscriptionCache()` when the uid transitions to null (logout) or
  to a different uid (account switch / other-tab logout / session expiry
  with re-login) — tracked via a new `lastUidRef` compared at the top of
  the callback. The FIRST call inside `signOut` (AC-4b.2) is KEPT for the
  strict teardown-before-auth-loss ordering.

### Edge cases
In-flight snapshot arriving mid-clear: per-listener try/catch contains
it; entries are marked dead AND maps emptied synchronously, so no new
subscriber can join a dropped entry and no stale closure can re-fire an
unsubscribe (AC-4b.6). Synchronous (not microtask) teardown is REQUIRED
here — the ordering guarantee (unsubscribe before signOut resolves)
cannot hold through `safeUnsubscribe`'s deferred path; that workaround
stays for normal per-subscriber release only. Session-expiry without an
explicit `signOut` call is covered by the watcher (AC-4b.7), not by the
`signOut` first-call.

### Non-goals
No per-user cache partitioning. No auto-clear on tab close. No change to
`safeUnsubscribe`, ref-counting, or sharing semantics.

---

## OUT OF SCOPE (explicit — backlog entries only, zero code)
- `firestore.rules`, `package.json`, `firebase.json`, `.github` — untouched.
- Daily-archive totals float accumulation (`sales.ts:154-159`,
  `returns.ts:247-252`): backlog entry text only at implement time.
- Any refactoring beyond the two items above.
