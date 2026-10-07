# TASKS — AUDIT-REV1 (atomic; each ends with its verification command)

Order: REV1-3 → REV1-1 → REV1-2. Within a REQ: tests FIRST (RED proof on
unfixed code), then fix, then verification, docs, commit. Do not start a
REQ's fix before its RED output is saved.

## REV1-3 — quantities (AC-3.1..3.5)
- [ ] T3.1 Write `tests/<name>.test.ts` (`test.each` over
  [0, -1, NaN, Infinity, '2', undefined, 0.0] × processSale/processReturn
  THROUGH the real `opKeyStore.submitWithOpKey` (stubbed `getRecordDoc`
  exists:false) + one valid-fraction case + one
  reject-then-corrected-recall-succeeds case (lookup-miss ⇒ fresh key)
  + one same-cart-uncorrected-repeats-error case (same key reused).
  Asserts: Arabic message ON THE ERROR, nothing written
  (no doc/stock/balance/counter). NO toast-path assertions (throw
  precedes try by design).
  Verify: `npx vitest run <file>` (expect RED on unfixed code; save raw
  to evidence/REV1-3/red.txt).
- [ ] T3.2 Implement validation blocks (sales.ts:31-32 gap,
  returns.ts:46-47 gap) + parity price check. Verify: targeted vitest run
  (expect GREEN) + full diff Arabic check.
- [ ] T3.3 Run: `npm run typecheck`, full `npm run test:rules`
  (retry-once only for migrateRoles cold flake, save both outputs),
  `npm run build`. Save raw + exit codes to evidence/REV1-3/.
- [ ] T3.4 Update docs ×4, commit `fix(sales,returns): ... (REQ-REV1-3)`.

## REV1-1 — cache key + fan-out (AC-1.1..1.7)
- [ ] T1.1 Write `tests/<name>.test.ts` (REAL query/where/orderBy;
  onSnapshot mocked at boundary OR emulator-backed): A-vs-B collision,
  equal sharing, B-shared RECEIVES LIVE UPDATES (RED-able on current
  code: today B gets the first snapshot only), A-out-while-B-stays
  (B keeps receiving), last-release teardown, fail-closed,
  churn, empty constraints. Verify: run vs UNFIXED code (expect RED:
  B receives A's data / B gets no live updates); save raw to
  evidence/REV1-1/red.txt.
- [ ] T1.2 Implement queryEqual sharing + fan-out Set in
  services/dataCache.ts (delete `_toFieldFilter` branch; preserve
  ref-count + microtask unsubscribe + immediate callback; NO constraint
  reordering anywhere). Verify: targeted run GREEN.
- [ ] T1.3 Run typecheck + full test:rules (+build). Save raw + exits
  to evidence/REV1-1/.
- [ ] T1.4 Update docs ×4 INCLUDING the F6 backlog entry (never-cleared
  cache — entry text only, zero code), commit `fix(cache): ... (REQ-REV1-1)`.

## REV1-2 — dust (AC-2.1..2.5)
- [ ] T2.1 Write pure unit `tests/<name>.test.ts` for round2/isSettled
  (table incl. 19.99/33.33/10.1/7.7, 0.1+0.2, 0.01-creditor-kept-creditor,
  1000-iteration random property → exactly 0). Verify: RED where
  applicable (helper is new — RED = property fails against raw math);
  save raw to evidence/REV1-2/red.txt.
- [ ] T2.2 Write emulator service tests (each of the 6 writers stores
  rounded balances; INCLUDES missing-balance sale → finite rounded
  number, never NaN) + no-raw-comparison assertion. Verify RED on
  unfixed (dust present), save raw.
- [ ] T2.3 Implement: export round2; utils/money.ts; 6 write sites (sales
  with `(currentBalance || 0)`); 10 UI comparison sites (incl. :568/:583
  value colors; footers settled⇒red branch). Verify: targeted runs GREEN +
  grep sweep shows zero raw sites + negativeBalancePolicy unchanged-green
  + footer-color test (dust ≈ 0 renders exactly like exact 0).
- [ ] T2.4 Run typecheck + full test:rules (+build). Save raw + exits
  to evidence/REV1-2/.
- [ ] T2.5 Update docs ×4, commit `fix(money): ... (REQ-REV1-2)`.

## Finish (after all 3 commits)
- [ ] TF.1 Final verification at HEAD into evidence/final/ (status, log,
  diff-stat, typecheck, full test:rules, build, eslint incl. .scratch
  comparison) + REPORT.md per prompt §6 + zip evidence/.
