# TASKS — REV1-4 (atomic; each ends with its verification command)

Order: T4.1 → T4.2 → T4.3 → T4.4 → T4.5 → T4.6. Within an item: tests
FIRST (RED proof on unfixed code), then fix, then verification, docs,
commit. Do not start a fix before its RED output is saved.

## REV1-4a — finite guards (AC-4a.1..4a.5)
- [ ] T4.1 Write `tests/rev14FiniteGuards.test.ts` (NO emulator, NO network
  wait): mock `../services/api/core` by spreading actual and overriding
  ONLY `assertOnline` with a vi.fn throwing `STOP-AFTER-GUARD`. Invalid
  inputs (NaN / Infinity / -Infinity × the 4 sites) assert the VERBATIM
  Arabic message from spec.md AND that the mocked `assertOnline` was never
  called (proves pre-network position); valid controls (0, 19.99, 100)
  assert termination WITH `STOP-AFTER-GUARD` (guard passed, gate reached).
  Verify: `npx vitest run <file>` (expect RED on unfixed code for ALL 18
  invalid cases — every one ends at STOP-AFTER-GUARD instead of Arabic
  (sale/purchase -Infinity falls in-transaction past the gate; payments
  NaN/-Infinity fall at the post-gate amount check); only the valid
  controls are GREEN; save raw to evidence/REV1-4/red-finite.txt).
- [ ] T4.3 Implement pre-network finite blocks (sales.ts after the REV1-3
  item loop; purchases.ts after assertValidOpKey :41; payments after the
  opKey strip, before assertOnline) with the frozen Arabic messages.
  Verify: targeted vitest run (expect GREEN) + full diff Arabic check.

## REV1-4b — logout cache clear (AC-4b.1..4b.5)
- [ ] T4.2 Write `tests/rev14CacheClear.test.ts` (mocked `onSnapshot` at
  the boundary, rev1Cache pattern — NO emulator): collection + document
  subscribes → `clearSubscriptionCache()` invokes both unsubscribes
  EXACTLY ONCE each; AC-4b.6 (subscribe → clear → invoke ORIGINAL closure
  → mocked SDK unsubscribe total is exactly 1); resubscribe creates a
  FRESH listener; `didAuthIdentityChange` truth-table unit test (predicate
  unit, NOT a rendered-component test — rationale in plan.md);
  `signOut()` ordering (cache teardown strictly before the mocked auth
  call); double-clear and clear-empty no-ops. Verify: `npx vitest run
  <file>` (expect RED on unfixed code for nearly the whole file — missing
  exports ⇒ TypeError everywhere (clear, predicate, and everything
  downstream: double-clear, clear-empty, resubscribe, ordering, 4b.6);
  dead-entry sharing; save raw to evidence/REV1-4/red-clear.txt).
- [ ] T4.4 Implement `clearSubscriptionCache` in services/dataCache.ts
  (synchronous per-listener try/catch, exactly-once invoke per entry,
  dead-mark `listening = false` + `callbacks.clear()`, then clear all
  three maps) + `didAuthIdentityChange` predicate export + one call line
  first inside services/auth.ts `signOut` + AuthContext watcher wiring
  (`lastUidRef` + predicate at the callback top). Verify: targeted vitest
  run (expect GREEN) + ordering proof in output.

## REV1-4 — verification, docs, commits
- [ ] T4.5 Run: `npm run typecheck`, full `npm run test:rules`
  (retry-once only for migrateRoles cold flake, save both outputs),
  `npm run build`, `npx eslint` (must not exceed 349/112/237 locally;
  CI-scope gate: `npm run lint` exits 0 with 0 errors and ≤ 237
  warnings). Save raw + exit codes to evidence/REV1-4/.
- [ ] T4.6 Update docs ×4 (changelog entry for both items + backlog entry
  for archive totals (text only, zero code) + tasks.md boxes; known-issues
  / current-state-map only with grep-proven cause), commit code
  `fix(guards): finite-amount guards + logout cache clear (REQ-REV1-4)`,
  commit docs, STOP (no push without a written order).

## Finish (after both commits)
- [ ] TF.2 Final verification at HEAD into evidence/final/ (status, log,
  diff-stat, constraints proof, typecheck, full test:rules, build, eslint)
  + REPORT addendum per prompt §6 + zip evidence/.
