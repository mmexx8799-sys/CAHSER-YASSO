# AUDIT-TX-3 — Design: stable operation idempotency key

> **Status:** design v4.1 (owner round 3 — rotation-with-notice, in-memory lifetime, renumbered tests 1–15) — NO execution, NO code/rules/test changes. (v4: settle split, per-flow keys, widened compare. v3: fingerprint-gated keys, settle step, TTL, per-item compare.)
> **Owner decisions recorded (2026-10-01 + v4 round):** (a) key minted AT SUBMIT; (b) success message UNCHANGED on match; (c) sessionStorage YES — key + request fingerprint, cleared ONLY on confirmed success; (d) NO change to RETRYABLE_TX_CODES now, and `cancelled` + `internal` are NEVER added (`deadline-exceeded` left undecided); (e) min-version gate is a SEPARATE item. **v4 directives applied:** settle SPLIT ((a) in-session re-send, (b) restored-path prompt/rotate); per-flow storage keys; compare widened (payment fields where present, verified absent `status`, merge+round rules); 4 new tests (11–14) with test 10 revised to the prompt.
> **Date:** 2026-10-01 — Author: Muse Spark.
> **Parent findings:** AUDIT-TX-2 discovery + 5 shipped REQs (guards convert a lost-commit retry into a no-op or clean rejection inside ONE call). This design closes the remaining hole: a SECOND call with a fresh random doc id.
> **Baseline for any future execution:** `tsc` clean; `test:rules` 46 files / 410 tests on `master=2b0dc05`, which already contains everything below (TX-2 guards + tests + closure). Execution splits into independent REQs — one per function (RED→GREEN, one commit each), then a final UI-layer REQ (key mint/hold/clear + sessionStorage + toasts) with its own commit.

---

## 1) The problem (current-state facts)

Every guarded function still mints its document id FRESH PER CALL:

- `processSale`: `const invoiceRef = doc(collection(db, 'invoices'))` hoisted per call (`services/api/sales.ts:25-26` post-TX2-SALE).
- `processPurchase`: `purchaseRef` per call (`services/api/purchases.ts:32-33`).
- `processSupplierReturn`: `returnRef` per call (`services/api/purchases.ts:129-130`).
- `processReturn`: `returnRef` per call (`services/api/returns.ts:60-61`).
- `addCustomerPayment` / `addSupplierPayment`: `paymentRef` per call (`services/api/customers.ts:126`, `services/api/suppliers.ts:125`).

The TX-2 guards (`transaction.get(ref)` + early return) fire only when the RETRY reuses the SAME ref — i.e. inside one `runTransactionWithRetry` run. The failure class they do NOT cover: attempt 1 fails with a NON-retryable code, so the wrapper does NOT retry and the error reaches the UI; the cashier presses the button again → a SECOND call → a SECOND random id → the guard sees an empty doc → full duplicate (2 docs, double balance/stock/archive, 2 counter numbers).

Non-retryable codes today = everything outside `RETRYABLE_TX_CODES = ['permission-denied', 'aborted', 'unavailable']` (`services/api/core.ts:145`). Concretely: `deadline-exceeded` (client-side timeout — commit state UNKNOWN: may or may not have applied), `internal` (server-side failure — ambiguous), `cancelled` (caller-side cancellation — typically nothing applied, but indistinguishable at the catch site), plus transport errors (`network-request-failed`, `unavailable` IS retried — see §5). No opKey/client-side operation id exists anywhere in code today (repo-wide grep for `clientOpId|opKey|idempotency|randomUUID` in `*.{ts,tsx,mjs}` hits only TX-guard comments and test headers — the only design is the not-yet-built P2 offline queue, §6).

## 2) Proposed stable key: where born, when cleared, unclear failure

**Proposal (recommended): generate at PAYMENT-SCREEN submit, not at cart open.**

- Why not cart open: the cart has no session concept today (`stores/posCartStore.ts:40-43` starts empty; `clearCart()` at lines 134-140 resets to empty with no id). Minting on first `addToCart` would need a new store field + lifecycle (merge/split? cart edits keep the key — but a user who builds cart A, clears it, builds cart B must NOT reuse A's key; `clearCart` would have to rotate it, and every rotation site — `POSPage.tsx:160,182`, `ReturnsPage.tsx:182,211,604`, `SettingsPage.tsx:380,414,430` — becomes a correctness site). Minting at submit keeps exactly ONE lifecycle site per flow.
- Generation: `crypto.randomUUID()` at the submit handler (POS payment confirm, purchase modal confirm, return confirm, payment-form submit).
- Storage (owner-decided v3, refined v4): BOTH submit-handler scope AND a `sessionStorage` record (survives reload within the same tab; never `localStorage`/IndexedDB). Keys are PER-FLOW namespaced (v4) — `tx-opkey:sale`, `tx-opkey:purchase`, `tx-opkey:return`, `tx-opkey:supplierReturn`, `tx-opkey:customerPayment`, `tx-opkey:supplierPayment` — one record each, so a key minted for a sale can never leak into (or collide with) a purchase/return/payment flow when the operator jumps screens.
```ts
// sessionStorage key: one namespaced entry, e.g. 'tx-opkey'
{ key: "<uuid-v4>", fingerprint: "<see below>", createdAt: <Date.now()> }
```
- Fingerprint (owner-specified v3): sorted `(productId, quantity)` pair per line item + `total` + party — computed client-side from the request about to be sent, stored alongside the key. Per-item identity uses fields that exist verbatim on BOTH the request `CartItem` and the stored doc (`item.id`, `item.buyQuantity` — verified: `sales.ts`/`purchases.ts`/`returns.ts` read/write `item.id` + `item.buyQuantity`, and stored docs keep the `items` arrays verbatim). Concretely: `pairs = items.map(i => [i.id, i.buyQuantity]).sort()` + `total` (+ `subtotal` where the function has one) + party (`customerId` / `supplierId`, missing → null). Payments have no items: fingerprint = `amount` + `customerId`/`supplierId` (+ `notes` excluded — free text, not identity). Rationale for excluding unit prices: `total` already binds them (same (id,qty) set + same total ⇒ same effective prices; anything else changes `total` and breaks the match).
- In-memory key lifetime (v4.1): the in-memory key is DROPPED on `clearCart`, on component unmount (payment modal/form close), or the moment the live fingerprint DIVERGES from the stored one (cart edited). The sessionStorage record SURVIVES all three — so the next submit automatically falls into path (b) instead of reusing a stale in-memory key. Rationale: the common abandonment case (operator clears/edits and walks away) must never silently inherit the previous key; the record's survival is what makes (b) the default after any discontinuity.
- Clearing: ONLY on confirmed success (the `await process*` resolved) — in-memory ref dropped AND sessionStorage entry removed.
- Rotation rule (v4.1, uniform across paths): EVERY rotation caused by fingerprint mismatch — restored-path AND in-session-after-cart-edit — is preceded by `getDoc(old key)`: EXISTS ⇒ notice "سُجّلت العملية السابقة رقم X، والمتابعة ستنشئ عملية جديدة منفصلة" + the same two explicit options, NO auto-send; ABSENT ⇒ silent rotation (fresh key + fresh fingerprint, normal send). Rationale: the old key may still point at a committed-but-unseen op; rotating blindly would orphan it from the operator's view while its money already moved.
- TTL (proposed: **20 minutes**, inside the mandated 15–30 window): rationale — comfortably longer than any realistic ambiguous-failure recovery (operator notices within minutes), far shorter than a shift (bounds stale-key accumulation); sweep expired entries on POS load (a few lines in the POS mount path; expired = treated as absent).
- Settle (v4 — SPLIT, because a blanket pre-check breaks the base case it was built for):
  - (a) IN-SESSION (key alive in memory AND cart untouched since the failure): NO pre-settle `getDoc`. RE-SEND with the SAME key; the TX-2 existence guard + fingerprint compare inside the transaction end in success (match) → cart clears + same success toast. Rationale: this is the overwhelmingly common path (operator presses again immediately after an ambiguous failure); forcing a dialog here would train operators to click through it, and rotating here would re-create the very duplication the key exists to prevent (next press = new key = new doc). (A v3 draft required a pre-send check on this path too — withdrawn: the TX2-ARCHIVE-style reasoning plus new test `in-session-repress-doc-exists` below prove it converts a working success into a dead end.)
  - (b) RESTORED-FROM-SESSIONSTORAGE ONLY (reload, or cart abandoned/changed): `getDoc(stored key)` FIRST, then:
    - EXISTS + fingerprint EQUALS live cart: modal with TWO explicit options — "same recorded sale No. X — finish" (⇒ success path WITHOUT sending: return stored identifiers, clear cart, same toast) vs "new operation" (⇒ fresh key + fresh fingerprint, normal send). NEVER auto-send.
    - EXISTS + fingerprint DIFFERS: notice + ROTATE key (cart kept).
    - NOT EXISTS: reuse stored key iff live fingerprint EQUALS stored, else mint fresh.
- After a §4 mismatch error: the saved key is DELETED immediately; the next submit mints fresh (a mismatched key must never be offered again).
- Unclear failure (the target case): `deadline-exceeded`/`internal`/`cancelled` (or any non-retryable code) after an unknown commit state → UI shows the existing generic failure toast (no new copy in this design) → user presses again → second call carries the SAME key → inside the transaction, `transaction.get(doc(db, <col>, key))` finds attempt 1's doc if it committed → early return, no duplicate. If attempt 1 never committed, the doc is absent → normal full path once.

**Receipt reprint (decided, v2):** on match the caller receives the ORIGINAL identifiers (same shape as today) and proceeds exactly as on a fresh success — including cart clearing and the unchanged success toast. See §4 for the mismatch path.

## 3) Passing it in + deriving the doc id (backwards compatible, rules-clean)

**Signatures (current, unchanged shape + ONE optional trailing param):**

- `processSale(invoiceData)` (`sales.ts:22`) → `processSale(invoiceData, opts?: { opKey?: string })`
- `processPurchase(purchaseData)` (`purchases.ts:23`) → same `opts?` addition.
- `processSupplierReturn(items, supplierId)` (`purchases.ts:134`) → `..., opts?: { opKey?: string }`.
- `processReturn(items, dailyArchiveId, customer?, originalInvoiceId?, __testOnRetry?, opts?: { opKey?: string })` (`returns.ts:36`) — appended AFTER the test hook so existing positional callers (`pages/ReturnsPage.tsx:210`, all tests) keep working untouched.
- `addCustomerPayment(payment)` / `addSupplierPayment(payment)` (`customers.ts:119`, `suppliers.ts:118`) → payment object gains optional `opKey?: string` (same `Omit<…, 'id'|'date'>` pattern extended) — same reason.

**Doc-id derivation (deterministic iff key present) + strict key validation:**
```ts
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (opts?.opKey !== undefined && !UUID_V4.test(opts.opKey))
  throw new Error("مفتاح العملية غير صالح — لن تتم أي كتابة"); // FIRST line, before any Firestore contact
const ledgerRef = opts?.opKey
  ? doc(db, 'invoices', opts.opKey)          // stable across re-presses
  : doc(collection(db, 'invoices'));         // today: random per call
```
`crypto.randomUUID()` output always satisfies the regex (hex + dashes, no `/` — always a legal document id); anything else (empty string, pasted junk, a legacy id format) fails fast with a clear Arabic error BEFORE any read/write. Old callers and old PWA/APK builds send nothing → random-id path, byte-identical behavior to today (no regression, no protection — see follow-up (b) in §7).

**Rules compatibility (no change required):** first attempt writes a NON-EXISTENT doc → `create` rules (unchanged, capability + `total/amount` guards); retry/re-press `transaction.get` hits `allow read: if isActiveUser()` — verified for all four ledger collections (`invoices` + `returns` per addendum E; `purchaseInvoices` `firestore.rules:224`; `supplierReturns` `firestore.rules:233`) plus both payments collections. If execution ever indicates otherwise → STOP (not expected). This mirrors the already-accepted P2 offline-queue design (`docs/SPEC-PLAN-OFFLINE-QUEUE-P2.md:98-103,119,134,142`: `clientOpId` IS the doc id, atomic `transaction.get` check, no new field/index/rules).

## 4) Early-return behavior: match → same success; mismatch → explicit error, cart kept

**Silent-loss hole this closes (owner-raised scenario, v3; settle refined v4):** sale of one item @100 fails ambiguously with the key saved; the cashier abandons the cart (or reloads — sessionStorage restores the record); a DIFFERENT customer buys one item @100. Naive key reuse would match on (total + count + party) and return silent success while the second sale vanishes (cart cleared, stock untouched). The fingerprint (`(productId,quantity)` pairs, not bare counts) plus the v4 settle split close it: different items ⇒ different fingerprint ⇒ fresh key; same fingerprint on the RESTORED path ⇒ prompt/rotate, never auto-send; the IN-SESSION path (§2(a)) re-sends because the cart demonstrably did not change.

**Early return is NOT always silent (owner-amended v2).** On `existing.exists()`, compare the stored doc against the incoming request using EXISTING fields only (no new fields stored) — per-item fingerprint, NOT bare counts:

| Function | Compare set — per-item `(id, buyQuantity)` pairs (sorted, same-id lines merged first) + totals + party + payment fields where present, all already on the doc |
|---|---|
| `processSale` | pairs + `total` (+ `subtotal`, `discount`) + `customerId` (missing → null) + **`paymentMethod`** (on the doc via `...invoiceData`, verified `sales.ts:108-114`) |
| `processPurchase` | pairs + `total` (+ `subtotal`) + `supplierId` (no payment-method field exists on purchase docs — verified `purchases.ts:102-111`) |
| `processSupplierReturn` | pairs + `total` + `supplierId` (no payment fields on supplier-return docs) |
| `processReturn` | pairs + `total` + `customerId` (missing → null) + **`originalInvoiceId`** (missing → null) + **`dailyArchiveId`** (always present — verified `returns.ts:163-171`) |
| payments | no items: `amount` (= the paid amount — no separate paid-amount field exists) + `customerId` / `supplierId` |

Field-name verification (v4, from code): per-item `id` + `buyQuantity` stored verbatim in all `items` arrays; `paymentMethod`/`subtotal`/`discount`/`customerId`/`dailyArchiveId` on invoices; `subtotal`/`supplierId` on purchases; `dailyArchiveId` + optional `customerId`/`originalInvoiceId` on returns; `amount` + party on payments. **No `status` field exists on ANY of the six keyed collections** (`status: 'open'|'closed'` in `types.ts` belongs to `DailyArchive` only; none of the six constructors writes one) — so there is nothing status-shaped to compare; recorded here so no phantom field is ever added. Bare `items.length` is NOT used anywhere in the compare — counts alone collide across different carts.

Compare mechanics (v4, binding on execution): (i) MERGE duplicate same-`id` lines first (sum `buyQuantity` per id — `addToCart` already merges in `posCartStore.ts`, but purchase/return modals build arrays manually, so the fingerprint builder must not assume uniqueness); (ii) SORT the pairs (order-independent carts); (iii) compare `total`/`subtotal`/`amount` AFTER fixed rounding to 2 decimals on BOTH sides (float-dust guard — binary arithmetic residue must never read as tampering); (iv) normalize missing optionals to null on BOTH sides before comparing.

- **MATCH → success with the UNCHANGED success toast** (owner decision (b)) + return the original identifiers (same shape as today). Receipt reprint uses the returned id; cart clears normally.
- **MISMATCH → explicit Arabic error, no write, cart NOT cleared, saved key DELETED immediately** (v3): `"سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة"`. The next submit mints a fresh key + fresh fingerprint — a mismatched key is never offered again. Reason (why not silent, why keep the cart): the realistic trigger is the cashier EDITING the cart after an ambiguous failure (different total/items/customer) and re-pressing with the STALE key still held from the failed submit. Silent success would confirm the WRONG cart as done and clear it, losing the operator's edits and hiding the discrepancy; the explicit error forces a look at the last invoice, after which the operator either discards the stale key (new submit = new key) or corrects the cart.
- Receipts/statements need no change: same doc id ⇒ same numbers, same statement rows, same counters (early return happens BEFORE counter reads in every function — no gap, per TX2 layout).

## 5) Independent analysis: add deadline-exceeded / internal / cancelled to RETRYABLE_TX_CODES?

Current list (`core.ts:145`): `['permission-denied', 'aborted', 'unavailable']`. DO NOT change it in this design's execution (constraint below) — analysis only.

| Code | Meaning at the catch site | Retry safe WITHOUT stable key? | With stable key? |
|---|---|---|---|
| `deadline-exceeded` | client gave up waiting; server may/may not have committed | NO — blind retry can double-apply (this design's target hazard) | YES — retry converges to no-op-or-apply-once via the guard |
| `internal` | server-side failure, ambiguous commit state | NO — same duplication hazard | YES — same convergence |
| `cancelled` | caller cancelled; usually nothing applied, but not provable at the catch site | QUESTIONABLE — retrying something the user/app cancelled can surprise (e.g. user navigated away, double-press races); also most `cancelled` arise pre-commit | YES technically (guard makes it safe), but semantically dubious — recommend NOT adding; surface to UI instead |

Note on the existing entries (for completeness): `permission-denied` is provably a commit REJECTION (rule evaluation — `docs/known-issues.md:163`), so retrying it can never double-apply, only burn ~1s of backoff (recorded TX-1 risk); `aborted`/`unavailable` are the contention/transport pair the wrapper was built for. Adding the three new codes WITHOUT the key would legalize blind retries of ambiguous commits — the key must land FIRST; code-list expansion, if ever, comes second as its own decision with its own tests.

**Constraint for execution:** no change to `RETRYABLE_TX_CODES` or the wrapper in the TX-3 build. The key design must be correct with TODAY's list (manual re-press path), so any future list change is purely additive.

## 6) Interactions

- **`withInFlightGuard`** (`services/inflight.ts:40-50` — counter only, enter-on-call/leave-in-`finally`, no debounce, no arg inspection): unchanged and compatible. Double-click while in flight is still collapsed by the guard (second press while `count > 0` — UI disables via `useAnyWriteInFlight`); after failure the guard releases and the re-press carries the SAME key (key lives outside the guard, in submit-handler scope). No change needed; verify by inspection during execution (call shape identical apart from the appended optional param).
- **P2 offline queue** (`SPEC-PLAN-OFFLINE-QUEUE-P2.md:98-142`): CONVERGENT, not conflicting. P2's `clientOpId`-as-doc-id + atomic-get-check is the same mechanism proposed here; adopting one shared key format (`crypto.randomUUID()`, doc id on the online path, queue key on the offline path) lets a queued-then-replayed op and a manual re-press collapse onto the SAME document instead of two parallel idempotency schemes. Execution must not contradict P2 §2.4–2.5 (no new field/index/rules; `occurredAtLocal`/`origin` untouched).
- **Other doc-creating paths:** `addCustomerPayment`/`addSupplierPayment` take the same optional-key treatment (their `paymentRef` is already hoisted per call — TX-1 — so the key plugs into the same slot). `addCustomer`/`addSupplier` (one-shot creates, no retry wrapper, no duplicate hazard of this class) are OUT of scope. `startNewDailyArchive` (deterministic date id + exists-guard, TX2-ARCHIVE) is OUT of scope. Old builds without the key keep today's behavior exactly.

## 7) Proposed test plan (RED→GREEN, not executed), risks, open questions

**Tests** (emulator, mock commit-then-`unavailable` pattern from `paymentRetry.test.ts`, plus a NEW shape this design requires — two SEPARATE calls sharing one key):
1. `sale-same-key-twice` — call `processSale` twice with same `opKey` (second after first resolves): 1 doc, balance/stock/archive once, counter +1.
2. Same shape × `processPurchase`, `processSupplierReturn`, `processReturn` (linked-partial included), both payments (6 more).
3. `no-key-unchanged` — two calls WITHOUT key → 2 docs (documents the opt-in boundary; locks that old callers/APKs behave exactly as today).
4. `ambiguous-code-manual-repress` — first call fails `deadline-exceeded` post-commit (mock), second call same key succeeds as no-op: 1 doc, once-only movement.
5. `key-format` — unit-level: non-UUID-v4 key (incl. UUID with `/`, empty string, legacy id) rejected with the Arabic error BEFORE any Firestore call (assert the mocked `runTransaction` is never invoked); valid v4 passes validation.
6. `mismatched-payload-same-key` — seed a doc under a fixed key with total X, then call same key with total Y (same shape otherwise): call REJECTS with the mismatch message, cart untouched (assert no clear — UI-level: covered by the no-clear contract in the UI REQ), doc unchanged, counter untouched.
7. `parallel-same-key` — two CONCURRENT same-key calls (Promise.allSettled): exactly 1 doc, movement exactly once, counter +1 (one winner commits, the other finds existing and returns; contention may surface business/denied errors on the loser — assert final STATE, not which call wins).
8. Role matrix for the stable key (cashier + admin, mirroring the paymentRetry admin variants): `same-key-twice` repeated as admin — same 1-doc/once-only assertions (rules evaluate set-on-existing as update, isAdmin-only, so the admin path is the one that would double-apply without the guard).
9. `stale-key-different-cart` (v3 hole, RED-first) — record A {key K, fingerprint F_A = [(prod-X,1)] + total 100}: simulate the owner scenario (first op ambiguous-fails post-commit, then a DIFFERENT cart [(prod-Y,1)] + total 100 arrives holding K): asserts a FRESH key is minted (stored record replaced, old K never sent), second op commits as its own doc; cart of op 2 NOT cleared by op 1's shadow; stock moves exactly per op 2.
10. `restored-key-prompt` (prompt behavior: finish vs new-operation sub-cases) — sessionStorage record {K, F} restored after reload, live fingerprint EQUALS F, doc K EXISTS → modal with the two explicit options, NO auto-send. Sub-case finish: returns stored identifiers, cart clears, zero Firestore sends (assert send-count). Sub-case new-operation: fresh key minted, normal commit as its own doc. (Merges the former duplicate `restored-key-same-cart-prompt` — same scenario, one name.)
11. `in-session-repress-doc-exists` (RED-first) — key alive in memory + cart untouched + doc EXISTS from a committed first attempt: re-press RESOLVES with success identifiers, cart clears, same toast; exactly 1 doc, movement once. RED method: route the re-press through the restored-path settle instead (must show the prompt / refuse silent success) — proves the (a)/(b) split is load-bearing, not decorative.
12. `per-flow-storage` — full sale flow stores under `tx-opkey:sale` only; then a purchase flow reads `tx-opkey:purchase` (absent ⇒ mints fresh, never inherits the sale key); assert record isolation per flow in sessionStorage.
13. `payment-method-change-same-key` — same key, cart identical except `paymentMethod` cash→credit with UNCHANGED total: key reused (fingerprint has no method slot) → service compare sees `paymentMethod` differ on invoices ⇒ mismatch error, cart kept, key deleted. (If the method change also changes totals via price recalc, fingerprint differs ⇒ fresh key instead — assert that variant too where the fixture prices differ by method.)
14. `edited-cart-in-session-settle` (v4.1, RED-first) — in-session key K + cart EDITED after an ambiguous failure (live fingerprint F2 ≠ stored F1): re-press must NOT reuse K. Pre-rotation `getDoc(K)`: K EXISTS (first op committed unseen) → notice "previous op recorded No. X, continuing creates a separate new op" + two explicit options, NO auto-send; K ABSENT → silent rotation, subsequent submit uses the rotated key and commits normally. RED method: naive in-session reuse of K (must show either a second commit for the changed cart or silent success against the wrong doc).
15. `key-ttl-expired` — stored record with `createdAt` older than TTL (20 min proposed): asserts the record is treated as absent (fresh key minted, old ignored), including the POS-load sweep path.

**Risks:** key loss on reload/navigation between failure and re-press (mitigation DECIDED v4: submit-handler scope + per-flow `sessionStorage` records `{key, fingerprint, createdAt}` with the SPLIT settle — (a) in-session re-send, (b) restored-path prompt/rotate — + 20-min TTL + POS-load sweep — NOT `localStorage`/IndexedDB, to avoid resurrecting stale keys across sessions); key collision across two DIFFERENT carts (`randomUUID` — negligible, plus the atomic get protects anyway); mismatch-error UX depends on the operator actually reading the last invoice (training note, not code); P2 interplay if P2 ships a different key format first (execution must reconcile, not fork).

**Owner decisions applied (v2 — former open questions, now closed):** key born AT SUBMIT (§2); success message UNCHANGED on match (§4); sessionStorage YES with fingerprint, clear-on-success-only; NO RETRYABLE change now, `cancelled` + `internal` NEVER added (`deadline-exceeded` undecided); min-version gate is a SEPARATE item. REMAINING open: none — execution may proceed on approval.

**Execution split (independent REQs, one commit each, RED→GREEN):** TX3-SALE, TX3-PURCHASE, TX2-SUPRET-equivalent (supplier return), TX3-RETURN, TX3-PAYMENTS (both), then TX3-UI last (key mint/hold/clear + sessionStorage + toasts across POS / purchase modal / return confirm / payment forms). Each function REQ carries its tests from the list above (role-matrix variants ride with their function); the UI REQ carries `mismatched` UX assertions (cart NOT cleared) and cross-flow checks.

**Execution note 2026-10-03 (TX3-PURCHASE done, step 2/6):** shared `docFingerprint(docLike, partyField)` helper extracted in `services/api/opKey.ts` and `processSale` refactored onto it (behavior-identical, `tx3Sale` re-run green 14/14); purchase docs carry no `paymentMethod` so the fingerprint compare alone covers the mismatch case. Test-running note: the tx3 files share emulator namespaces and MUST run sequentially (`--fileParallelism=false`) — a parallel two-file run cross-contaminates fixtures (`clearFirestore` races) and fails spuriously.

**Files an execution would touch (proposal):** `services/api/{sales,purchases,returns,customers,suppliers}.ts` (optional trailing param + deterministic ref + TX-2 existence check REUSED as the first half of the guard, PLUS new compare-on-match logic with the mismatch error per the table in §4 — the compare is new logic, the existence check is reused), `pages/*` submit handlers (key mint/hold/clear + fingerprint + sessionStorage record + settle step + TTL sweep — UI-only), NEW `tests/tx3*.test.ts`. NOT touched: `firestore.rules`, `firestore.indexes.json`, `services/api/core.ts`, `stores/*` (under recommended option), backup/restore, specs of other tracks.
