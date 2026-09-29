# SPEC — AUDIT-SEC-1 + AUDIT-TX-1 (merged)

> **Status:** draft for owner approval — no execution before approval.
> **Date:** 2026-09-29 — Author: Muse Spark.
> **Scope:** client code + tests + `docs/backlog.md` + `docs/changelog.md` (status lines only, per req-template.md rule 5) only. No `firestore.rules`, no production behavior change except the two retry call-swaps in D3 (same semantics, retry wrapper only).
> **Baseline (before):** `npx tsc --noEmit` clean (zero output); `npm run test:rules` → **38 files / 381 tests passed, 0 failed, 0 skipped** (Duration 236.04s, emulator, code 0). Every AC below is measured against these numbers.

---

## 1) Goal

Close the two backlog audit items with the smallest possible diff, under final owner decisions D1–D4:

- Lock the *existing* negative-balance behavior with explicit tests (zero production change).
- Add a runtime allowlist to `addCustomer` / `addSupplier` so the written doc contains only the six intended keys (zero change to any legitimate output).
- Move the two payment functions onto the standard `runTransactionWithRetry` wrapper (default attempts).
- Fix the dead `services/api.ts:715/802` references and record D1–D4 in `docs/backlog.md`.

## 2) Decisions (final, do not reopen)

- **D1.** Negative balance is an ALLOWED state (credit / رصيد دائن). No guard anywhere. Work = document + explicit tests. Non-blocking UI warning is OUT of scope.
- **D2.** Whitelist is CLIENT-SIDE ONLY in `addCustomer`/`addSupplier`. Rules-level `keys().hasOnly` is DEFERRED to a separate backlog item with two gates (production key-set check + real restore test with non-empty customers/suppliers).
- **D3.** `addCustomerPayment`/`addSupplierPayment` move to `runTransactionWithRetry` with the default attempt count (4).
- **D4.** `deleteDocument` surface is out of scope. BUG-P0-2 stays Declined (Ahmed, 2026-09-16) — do not touch balance rules.

## 3) REQs

### REQ-SEC1-A1 — runtime allowlist in addCustomer/addSupplier

**Targets:**

- `services/api/customers.ts:92-108` (`addCustomer`; spread at line 96-101).
- `services/api/suppliers.ts:92-108` (`addSupplier`; spread at line 96-101).

**Specify:**

- Replace the verbatim `{ ...customerData, balance: openingBalance, openingBalance, createdAt: serverTimestamp() }` with an explicitly constructed object containing ONLY:
  `name`, `phone`, `address`, `balance`, `openingBalance`, `createdAt`.
- Derivation stays byte-identical to today: `const openingBalance = Number(customerData.balance) || 0;` then `balance: openingBalance`.
- `createdAt: serverTimestamp()` unchanged.
- Dropped before the write: `id`, `createdAt` / `openingBalance` smuggled at runtime (the `Omit<…, 'id'|'createdAt'|'openingBalance'>` type is compile-time only today), and any unknown key.
- Do NOT add new validation (e.g. name-required in the service). UI already requires the name; service-level rejection would be a behavior change.

**MUST PRESERVE — form-output proof (why the allowlist must use `?? ''`):**

- Create path builds plain `formData`, never `undefined` for phone/address. `pages/CustomersPage.tsx:20` initializes `useState({ name: '', phone: '', address: '', balance: 0 })`; `pages/CustomersPage.tsx:24` edit-refresh uses `customer.phone || ''` / `customer.address || ''`; `pages/CustomersPage.tsx:41` create branch passes `formData` as-is: `onSave(customer ? { ...customer, ...formData } : formData)`. `pages/SuppliersPage.tsx:20,24,41` are identical for suppliers. `handleChange` (`CustomersPage.tsx:30-33`, `SuppliersPage.tsx:30-33`) keeps phone/address as strings and casts only `balance` with `Number(value)`.
- Therefore the allowlist MUST read `phone: customerData.phone ?? ''` and `address: customerData.address ?? ''` (same for supplier) so that: (a) every legitimate form output produces a byte-identical document to today (same keys, same values — empty strings stay empty strings); (b) no `undefined` value is ever passed into `addDoc` (which would throw / store differently).
- `handleSaveCustomer` (`CustomersPage.tsx:201-209`) routes create (no `id`) to `addCustomer(customerData)` and edit (has `id`) to `updateCustomerProfile`; `handleSaveSupplier` (`SuppliersPage.tsx:202-210`) mirrors it. The allowlist lives only in the create functions, so the edit path is untouched by construction.

**ACs:**

- **AC-A1-1** (mechanical): `addDoc` in each function receives an object whose keys ⊆ `{name, phone, address, balance, openingBalance, createdAt}` for: (i) the exact create-form object `{name, phone:'', address:'', balance:N}`, (ii) a hostile object with `{id, createdAt: 123, openingBalance: 999, unknownKey: 1}` added. Asserted by named test `allowlist-drops-extra-keys` (customer + supplier cases).
- **AC-A1-2** (mechanical): for every legitimate input the two forms can produce (empty-string phone/address, numeric balance incl. 0), the written document is key- and value-identical to today's implementation. Asserted by named test `allowlist-preserves-legit-output` which constructs the expected doc both ways (or replays recorded pre-change outputs) and compares.
- **AC-A1-3** (mechanical): no `undefined` value reaches `addDoc` when phone/address are missing/`undefined` in the input (fallback `?? ''` applies). Asserted by named test `allowlist-no-undefined`.
- **AC-A1-4** (mechanical): `balance`/`openingBalance` derivation unchanged — inputs `balance: ''/undefined/NaN/'abc'/5` produce today's `Number(x) || 0` results. Asserted inside `allowlist-preserves-legit-output`.
- **AC-A1-5** (suite): `npx tsc --noEmit` clean + full `npm run test:rules` passes with counts ≥ baseline (38 files / 381 + new tests, 0 failures). Raw outputs pasted.

### REQ-NEG-1 — lock D1 with explicit tests, no production change

**Targets:** tests only. Production files untouched.

**Specify:**

- Add `tests/negativeBalancePolicy.test.ts` (name fixed) with four cases, all against the emulator with real API + rules:
  1. `overpay-customer`: seed customer `balance: 10`; `addCustomerPayment({customerId, amount: 15})` succeeds; resulting `balance === -5` persisted.
  2. `overpay-supplier`: seed supplier `balance: 8`; `addSupplierPayment({supplierId, amount: 20})` succeeds; resulting `balance === -12` persisted.
  3. `return-drives-negative`: customer `balance: 5`; `processReturn` with total 12 linked or cash (whichever the test harness already uses — mirror existing `processReturn.test.ts` fixture style) succeeds; balance `-7`.
  4. `supplier-return-drives-negative`: supplier `balance: 3`; `processSupplierReturn` total 10 succeeds; balance `-7`.
- Reference the incidental assertion at `tests/permissionsRules.test.ts:351-352` (quoted):
```ts
351:     await addCustomerPayment({ customerId: 'perm2-cust', amount: 5 } as any);
352:     expect((await snap('customers', 'perm2-cust')).balance).toBe(-5);
```
  That test stays green unchanged; the new file makes the policy explicit instead of incidental.

**ACs:**

- **AC-N1-1:** the four new tests pass on the emulator; each asserts both success (no throw) and the exact negative persisted value.
- **AC-N1-2:** zero production diff for this REQ — mechanical check `git diff --stat` shows only `tests/negativeBalancePolicy.test.ts` added, plus the per-step `docs/backlog.md` (In Progress) status line required by §9 (and `docs/changelog.md` only if a REQ closes in that step; NEG-1 closes nothing).
- **AC-N1-3:** suite counts ≥ baseline with 0 failures; raw output pasted.

### REQ-TX-1 — payments use runTransactionWithRetry per D3

**Targets:**

- `services/api/customers.ts:16` (import `runTransaction`) → import `runTransactionWithRetry` from `./core`; `customers.ts:121` `await runTransaction(db, …)` → `await runTransactionWithRetry('addCustomerPayment', …)` (default attempts — no third argument).
- `services/api/suppliers.ts:18,120` — same with label `'addSupplierPayment'`.

**Reference — how processReturn surfaces exhaustion** (`services/api/returns.ts:198-223`, quoted structure):

```ts
198:         if ((error as any)?._txExhausted === true) {
199:             // E-5-MON: reportError fire-and-forget … { source: 'processReturn' }
200:             // … try { reportError(new Error(`[TX_EXHAUSTED] label=processReturn code=… attempts=… invoice=… ts=…`), { source: 'processReturn' }) } catch {}
211:             // code mapping: 'aborted'/'unavailable' → toast زحمة…; 'permission-denied' → toast راجع صلاحياتك…; else → toast error.message…
219:         } else {
220:             toast.error(error.message || 'حدث خطأ أثناء عملية الإرجاع.');
221:         }
222:         throw error;
```

  Wrapper semantics (`services/api/core.ts:151-175`): retries only `['permission-denied','aborted','unavailable']`; business `plain Error`s (incl. the `amount <= 0` check, which throws before the transaction) never retry; on final retryable failure tags `_txExhausted/_txAttempts/_txLabel` and rethrows. `processReturn` calls it with `7` (`returns.ts:193`); `processSupplierReturn`/`processPurchase`/`processSale` with default `4`.

**Specify (payments' consistent behavior):**

- Preserve: `withInFlightGuard`, first-line `assertOnline()`, the `if (!payment.amount || payment.amount <= 0) throw "قيمة الدفعة يجب أن تكون أكبر من صفر"` pre-transaction check, transaction body byte-identical (get → exists-check → `newBalance = currentBalance - amount` → `update` + `set` with `serverTimestamp()`), success toasts (`'تم تسجيل الدفعة بنجاح!'` / `'تم تسجيل دفعة المورد بنجاح!'`), failure toasts — fixed strings, NO `error.message` (correction 2026-09-29 — the draft wrongly claimed `toast.error(error.message || …)`). Actual catch blocks, quoted:
```ts
// services/api/customers.ts:133-138
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error adding customer payment:", error);
        toast.error("حدث خطأ أثناء تسجيل الدفعة.");
        throw error;
    }
// services/api/suppliers.ts:132-137
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error adding supplier payment:", error);
        toast.error("حدث خطأ أثناء تسجيل دفعة المورد.");
        throw error;
    }
```
  `isOfflineGuardError` rethrow stays first; final `throw error` keeps `_txExhausted` flag intact when present.
- Consistency rule: on `_txExhausted === true` the payments' catch keeps the CURRENT toast texts (no new strings, no new branches with different Arabic copy) and rethrows unchanged — i.e. the retry behavior becomes consistent (same wrapper, same retryable codes, same default 4 as the other non-return paths) while user-visible copy is frozen. Any code-mapped toast differentiation (زحمة vs صلاحيات) for payments is NOT specified here — see OPEN QUESTIONS.
- No `reportError`/monitoring addition for payments in this REQ (processReturn's `[TX_EXHAUSTED]` log is return-specific: label + invoice id). See OPEN QUESTIONS.

**ACs:**

- **AC-T1-1** (mechanical): `git diff` for each file shows only the import line + the call line + the existence-check read/return lines changed (expected: ~5 lines per file; no other production line touched).
- **AC-T1-2:** named test `payment-retries-aborted-then-succeeds` (mock `runTransaction` to throw `{code:'aborted'}` once, then succeed — same pattern as `tests/txExhaustedMon.test.ts`) passes for both payments.
- **AC-T1-3:** named test `payment-exhaustion-preserves-flag-and-toast` (mock always-`aborted`) asserts the thrown error keeps `_txExhausted === true` and the fixed failure strings fire verbatim: `"حدث خطأ أثناء تسجيل الدفعة."` (customer) / `"حدث خطأ أثناء تسجيل دفعة المورد."` (supplier) — no `error.message` content.
- **AC-T1-4:** existing `amount <= 0` rejection still throws before any transaction attempt (no retry on business error) — asserted by new test or existing coverage, named in the execution report.
- **AC-T1-5:** suite counts ≥ baseline, 0 failures; raw output pasted.
- **AC-T1-6** (idempotency — OPTION A per owner decision 2026-09-29): named test `payment-retry-after-commit-is-idempotent` simulates "commit succeeded server-side, response lost, retry with `unavailable`": first attempt applies the balance/payment writes, second attempt reads the existing payment doc and returns without writing; balance is deducted exactly once.

**Ref placement — evidence (OPTION A specified per Q6 ANSWERED 2026-09-29):**

- Payments create the payment ref OUTSIDE the transaction callback. Quoted — `services/api/customers.ts:117-121`:
```ts
117:     try {
118:         const customerRef = doc(db, "customers", payment.customerId);
119:         const paymentRef = doc(collection(db, "customerPayments"));
120: 
121:         await runTransaction(db, async (transaction) => {
```
  Quoted — `services/api/suppliers.ts:116-120`:
```ts
116:     try {
117:         const supplierRef = doc(db, "suppliers", payment.supplierId);
118:         const paymentRef = doc(collection(db, "supplierPayments"));
119: 
120:         await runTransaction(db, async (transaction) => {
```
- Contrast — sale/purchase/return refs are created INSIDE the callback. Quoted — `services/api/sales.ts:25-26`:
```ts
25:         await runTransactionWithRetry('processSale', async (transaction) => {
26:             const invoiceRef = doc(collection(db, 'invoices'));
```
  `services/api/purchases.ts:32-33` (`processPurchase`): `await runTransactionWithRetry('processPurchase', async (transaction) => {` → `const purchaseRef = doc(collection(db, 'purchaseInvoices'));`. `services/api/purchases.ts:129-130` (`processSupplierReturn`): same shape with `returnRef`/`supplierReturns`. `services/api/returns.ts:60-61` (`processReturn`): `await runTransactionWithRetry('processReturn', async (transaction) => {` → `const returnRef = doc(collection(db, 'returns'));`.
- Consequence of the difference: with the ref fixed outside, a retry reuses the SAME payment doc id. A retry after a server-side-success/client-side-failure (`unavailable`) re-reads the already-reduced balance and subtracts the amount a second time, while `transaction.set(paymentRef, …)` overwrites the same payment doc once — net effect: double deduction, single payment record. (Inside-created refs get a fresh id per attempt, so a retried attempt cannot overwrite the committed doc — at most a duplicate doc, never a silent double-deduction against one record.)
- **OPTION A (CHOSEN by owner 2026-09-29 — specified requirement):** inside the callback, after the customer/supplier read and BEFORE any write:
```ts
const existingPay = await transaction.get(paymentRef);
if (existingPay.exists()) return;
```
  A retried attempt whose first commit succeeded becomes a no-op. Named test per AC-T1-6. Cost: one extra read per payment; behavioral edge: a genuine id collision (practically impossible with auto-ids) would silently skip.

### REQ-DOC-1 — backlog docs only

**Target:** `docs/backlog.md` only (expected: ~10 edited/added lines, zero code).

**Specify:**

- Re-point the dead `services/api.ts:715/802` references in the AUDIT-TX-1 entry (current `docs/backlog.md:47`) to `services/api/returns.ts:60` (`processReturn`) and `services/api/purchases.ts:129` (`processSupplierReturn`); note `services/api.ts` is a 13-line barrel post-ARCH-1 so the old numbers are dead.
- Record D1–D4 verbatim in the AUDIT-SEC-1 / AUDIT-TX-1 entries.
- Add deferred item: "rules-level `hasOnly` on customers/suppliers create" with its two gates: (1) production key-set check of customers/suppliers via `check-keys.mjs` output, (2) a real restore test with non-empty customers/suppliers.
- Add backlog note: `processSale` (`services/api/sales.ts:26` — `invoiceRef` inside the callback, fresh id per attempt), `processPurchase` (`services/api/purchases.ts:33`) and `processSupplierReturn` (`services/api/purchases.ts:130`) share the retry-after-lost-commit class in the opposite direction — a retried attempt mints a FRESH doc id, so a lost-commit retry can leave a duplicate document plus a doubled balance movement. NOT fixed in this SPEC; recorded for a future item.
- Mark AUDIT-SEC-1 / AUDIT-TX-1 status per the execution outcome (no code refs beyond the above).

**ACs:**

- **AC-D1-1** (mechanical): `git diff --stat` for the DOC-1 step shows only `docs/backlog.md` + `docs/changelog.md`; `git diff` pasted raw; no `715/802` strings remain in `docs/backlog.md` (mechanical `grep` check quoted).

## 4) Files-to-touch (closed list) + expected change size

| File | Change | Expected size |
|---|---|---|
| `services/api/customers.ts` | A1 allowlist in `addCustomer` (~8 lines) + T1 import/call swap + existence-check (~5 lines) | ~13 lines |
| `services/api/suppliers.ts` | mirror of customers.ts | ~13 lines |
| `tests/negativeBalancePolicy.test.ts` | NEW — 4 tests (REQ-NEG-1) | ~80 lines |
| `tests/customerSupplierAllowlist.test.ts` | NEW — A1 ACs (drop-extra / preserve-legit / no-undefined) | ~90 lines |
| `tests/paymentRetry.test.ts` | NEW — T1 ACs (retry-then-succeed / exhaustion-flag / amount-guard) | ~70 lines |
| `docs/backlog.md` | REQ-DOC-1 re-point + D1–D4 + deferred item; PLUS the per-step (In Progress) status line before every REQ step per §9 | ~10 lines + 1 line per step |
| `docs/changelog.md` | per-step close-out line after every REQ step per req-template.md rule 5 (§9) | ~1 line per step |
| `docs/SPEC-AUDIT-SEC1-TX1.md` | this file | — |

`docs/backlog.md` is touched at every step's status update (In Progress line), not only in REQ-DOC-1. `docs/changelog.md` is touched after every REQ step closes. Both are therefore in-scope docs alongside code/tests.
Any file outside this list touched during execution = SPEC violation; stop and report.

## 5) Tests to add (names + asserts)

1. `negativeBalancePolicy / overpay-customer` — 15-over-10 succeeds, `balance === -5`.
2. `negativeBalancePolicy / overpay-supplier` — 20-over-8 succeeds, `balance === -12`.
3. `negativeBalancePolicy / return-drives-negative` — return total > balance succeeds, negative persisted.
4. `negativeBalancePolicy / supplier-return-drives-negative` — same for supplier.
5. `allowlist-drops-extra-keys` (×2 customer/supplier) — hostile input; written doc keys ⊆ six; `id`/`unknownKey` absent; smuggled `openingBalance`/`createdAt` ignored (derived/stamped values win).
6. `allowlist-preserves-legit-output` (×2) — form-shaped inputs (incl. `''` phone/address, `0` balance) produce docs identical to pre-change implementation; derivation matrix for `Number(x) \|\| 0`.
7. `allowlist-no-undefined` (×2) — missing/`undefined` phone/address → `''`; `addDoc` never receives `undefined`.
8. `payment-retries-aborted-then-succeeds` (×2) — one `aborted`, then success; balance + payment doc correct.
9. `payment-exhaustion-preserves-flag-and-toast` (×2) — persistent `aborted`; `_txExhausted === true` rethrown; fixed strings verbatim (`"حدث خطأ أثناء تسجيل الدفعة."` / `"حدث خطأ أثناء تسجيل دفعة المورد."`).
10. `payment-amount-guard-no-retry` (×2, may fold into 8/9 file) — `amount <= 0` throws pre-transaction without retry.

## 6) Risks

- **Emulator-bound rules tests.** The full suite (`npm run test:rules`) requires the Firestore/Auth emulators (~4 min). New tests must run inside that harness; standalone `vitest run` without emulators will fail on rules-dependent files. Mitigation: run the exact `test:rules` command before/after and paste raw counts.
- **Restore path unaffected by A1 — and why.** `restoreData` (`services/api/backup.ts:175-186`) writes via `batch.set(doc(db, collectionName, id), data)` directly and never calls `addCustomer`/`addSupplier`; the allowlist lives inside those two functions only. So restore round-trips (incl. legacy docs lacking `openingBalance` and `seedCustomers.mjs` docs) are byte-identical before/after. No restore test changes in this SPEC.
- **Incidental-test coupling.** `permissionsRules.test.ts:351-352` already asserts `-5`; REQ-NEG-1 makes that explicit. A future reject-negative decision would break that test + the 4 new tests + both return paths — recorded so the cost is visible.
- **Retry behavior delta.** D3 adds bounded retries (default 4, backoff `min(150*2^(n-1),1200)+jitter`) to two functions that previously failed fast on `aborted`. Semantics of success/failure values are unchanged; only transient-contention outcomes change (fewer spurious failures). `_txExhausted` tagging now applies to payments too — surfaced per §3/REQ-TX-1 with current toast copy.
- **Denied payments now fail slow (new 2026-09-29).** `permission-denied` is in `RETRYABLE_TX_CODES` (`services/api/core.ts:145`), so a genuinely denied payment (disabled user, missing capability) retries 4× with backoff and surfaces after ~1s instead of immediately. Same trade-off already accepted for sale/purchase/return paths; recorded here so the delay is not mistaken for a hang.
- **Payment idempotency on retry (2026-09-29, mitigated per OPTION A).** `paymentRef` is created OUTSIDE the transaction callback (`customers.ts:119`, `suppliers.ts:118`), unlike sale/purchase/return refs (inside). Scenario: attempt 1 commits server-side but the response is lost with a retryable code (`unavailable`); attempt 2 re-reads the already-reduced balance, subtracts the amount AGAIN, and `transaction.set` overwrites the SAME payment doc id once. Net without guard: balance deducted twice, one payment record. Mitigation (specified in REQ-TX-1): existence-check `transaction.get(paymentRef)` + early return inside the callback, covered by AC-T1-6.
- **Allowlist edge: missing `name` now fails closed (new 2026-09-29).** With the verbatim spread, an input lacking `name` wrote a nameless doc; with the explicit object, `name: undefined` reaches `addDoc`, which throws instead of writing. Behavior change only for nameless inputs, which are unreachable from the current UI (`required` + `if (!formData.name)` toast in both form modals). No new validation was added — this is a structural side effect of the allowlist, recorded here. Covered by construction (no test asserts nameless-create success; no such test exists).
- **No rules deploy.** Zero `firestore.rules` changes in this SPEC — standing rule 7 (live rules deploy proof) does not trigger.

## 7) OPEN QUESTIONS (no answers assumed unless marked ANSWERED)

1. ~~Should the service layer add `name`-required validation to `addCustomer`/`addSupplier`?~~ **ANSWERED 2026-09-29: NO** — out of scope, deferred. UI-only validation stands.
2. ~~Should payment `_txExhausted` events be reported via `reportError` (`[TX_EXHAUSTED]` in `clientErrors`)?~~ **ANSWERED 2026-09-29: NO** — out of scope, deferred. No monitoring addition in this SPEC.
3. ~~Should payments adopt processReturn's code-mapped toasts (زحمة vs صلاحيات) on exhaustion?~~ **ANSWERED 2026-09-29: NO** — out of scope, deferred. Current fixed-string copy frozen per R1.
4. Production key-set check (`check-keys.mjs` on a real backup) result — pending owner output; gates only the deferred rules item, not this SPEC.
5. `seedCustomers.mjs` (writes `{name, phone, balance, createdAt}`, no `openingBalance`/`address`) — untouched per scope; if a future rules-`hasOnly` lands, does the seed script get updated in that item? Deferred with the rules item.
6. ~~Payment idempotency guard — OPTION A vs OPTION B?~~ **ANSWERED 2026-09-29: OPTION A** — existence-check `transaction.get(paymentRef)` + early return folded into REQ-TX-1 as a normal requirement with unconditional AC-T1-6.

## 8) OUT OF SCOPE (explicit)

`firestore.rules` (no change, no deploy); `services/api/backup.ts` (incl. `restoreData`/`factoryReset`); `deleteDocument` and the api barrel (`services/api.ts`, `services/api/core.ts` except the already-exported wrapper import); `pages/*` (no UI change, no strings); `scripts/seedCustomers.mjs`; BUG-P0-2 (stays Declined); non-blocking over-balance UI warning (D1: out).

## 9) Evidence protocol for execution (mandatory per step)

- Per REQ step, in order A1 → NEG-1 → TX-1 → DOC-1: paste raw `git diff` (full, not `--stat` alone) + `git diff --stat`.
- `npx tsc --noEmit` raw output (must be empty) per step.
- Full `npm run test:rules` raw tail before (this SPEC's baseline) and after each step: `Test Files X passed`, `Tests Y passed`, failures/skips counts. No self-reports ("all green") without the pasted counts.
- Commit discipline per `docs/req-template.md`: one commit per REQ with the prescribed message; update `docs/backlog.md` (In Progress) before and `docs/changelog.md` after each REQ.
- Stop conditions: any touched file outside §4; any AC without its named test/check; any rules-file modification for any reason.
