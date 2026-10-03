# AUDIT-TX-3 — Design: stable operation idempotency key

> **Status:** design v2 (owner-amended) — NO execution, NO code/rules/test changes.
> **Owner decisions recorded (2026-10-01):** (a) key minted AT SUBMIT; (b) success message UNCHANGED on match; (c) sessionStorage YES — key + request fingerprint, cleared ONLY on confirmed success; (d) NO change to RETRYABLE_TX_CODES now, and `cancelled` + `internal` are NEVER added (`deadline-exceeded` left undecided); (e) min-version gate is a SEPARATE item.
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
- Generation: `crypto.randomUUID()` at the submit handler (POS payment confirm, purchase modal confirm, return confirm, payment-form submit), held in a local `useRef`/component state for the duration of that submission (NOT in the zustand store — no cross-screen leakage, no persistence questions).
- Clearing: ONLY on confirmed success (the `await process*` resolved). On ANY failure — retryable or not, ambiguous or not — the key is KEPT and the SAME key is re-sent if the user presses again (button stays armed; the form does not regenerate).
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

**Early return is NOT always silent (owner-amended v2).** On `existing.exists()`, compare the stored doc against the incoming request using EXISTING fields only (no new fields stored):

| Function | Compare set (all already on the doc) |
|---|---|
| `processSale` | `total` + `items.length` + `customerId` (normalize missing → null on both sides) |
| `processPurchase` | `total` + `items.length` + `supplierId` |
| `processSupplierReturn` | `total` + `items.length` + `supplierId` |
| `processReturn` | `total` + `items.length` + `customerId` (normalize missing → null) |
| payments | `amount` + `customerId` / `supplierId` |

- **MATCH → success with the UNCHANGED success toast** (owner decision (b)) + return the original identifiers (same shape as today). Receipt reprint uses the returned id; cart clears normally.
- **MISMATCH → explicit Arabic error, no write, cart NOT cleared:** `"سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة"`. Reason (why not silent, why keep the cart): the realistic trigger is the cashier EDITING the cart after an ambiguous failure (different total/items/customer) and re-pressing with the STALE key still held from the failed submit. Silent success would confirm the WRONG cart as done and clear it, losing the operator's edits and hiding the discrepancy; the explicit error forces a look at the last invoice, after which the operator either discards the stale key (new submit = new key) or corrects the cart.
- Receipts/statements need no change: same doc id ⇒ same numbers, same statement rows, same counters (early return happens BEFORE counter reads in every function — no gap, per TX2 layout).

**Open question for owner:** silent-success vs distinct "already recorded" toast (default proposed: silent; receipt reprint uses returned id either way).

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

**Risks:** key loss on reload/navigation between failure and re-press (mitigation DECIDED: submit-handler scope + `sessionStorage` backup holding key + request fingerprint, cleared ONLY on confirmed success — NOT `localStorage`/IndexedDB, to avoid resurrecting stale keys across sessions); key collision across two DIFFERENT carts (`randomUUID` — negligible, plus the atomic get protects anyway); mismatch-error UX depends on the operator actually reading the last invoice (training note, not code); P2 interplay if P2 ships a different key format first (execution must reconcile, not fork).

**Owner decisions applied (v2 — former open questions, now closed):** key born AT SUBMIT (§2); success message UNCHANGED on match (§4); sessionStorage YES with fingerprint, clear-on-success-only; NO RETRYABLE change now, `cancelled` + `internal` NEVER added (`deadline-exceeded` undecided); min-version gate is a SEPARATE item. REMAINING open: none — execution may proceed on approval.

**Execution split (independent REQs, one commit each, RED→GREEN):** TX3-SALE, TX3-PURCHASE, TX2-SUPRET-equivalent (supplier return), TX3-RETURN, TX3-PAYMENTS (both), then TX3-UI last (key mint/hold/clear + sessionStorage + toasts across POS / purchase modal / return confirm / payment forms). Each function REQ carries its tests from the list above (role-matrix variants ride with their function); the UI REQ carries `mismatched` UX assertions (cart NOT cleared) and cross-flow checks.

**Files an execution would touch (proposal):** `services/api/{sales,purchases,returns,customers,suppliers}.ts` (optional trailing param + deterministic ref + existing guard reuse — NO new guard logic needed, the TX-2 guards already do the check), `pages/*` submit handlers (key mint/hold/clear — UI-only), NEW `tests/tx3*.test.ts`. NOT touched: `firestore.rules`, `firestore.indexes.json`, `services/api/core.ts`, `stores/*` (under recommended option), backup/restore, specs of other tracks.
