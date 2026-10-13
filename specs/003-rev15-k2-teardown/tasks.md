# TASKS — REV1-5 (atomic; each ends with its verification command)

Order: K2-1 → K2-2 → K2-3 → K2-4 → K2-5 → K2-6 → K2-7. Within an item:
tests FIRST (RED proof on unfixed code), then fix, then verification,
docs, commit. Do not start a fix before its RED output is saved.

## REQ-REV1-5a — deferred teardown (K2) — DONE (code fcc5cd9)
- [x] K2-1 Write `tests/rev15K2.test.ts` stage-1 (T1, T2, T3, T5, T6, T7 —
  T4 arrives with 5b).
  Verify: `npx vitest run tests/rev15K2.test.ts` (expect RED on unfixed
  code: T1 sync-0 fails, T2 sync-empty fails, T3 over-counts, T6 finds raw
  calls; T5 passes already (regression lock); T7 `not feasible` without
  emulator / recorded result with emulator; save raw to
  evidence/REV1-5/red-k2.txt).
  OUTCOME: RED plain 4F/3P (T3/T5 pass as locks, T7 not-feasible) +
  RED under emulator 4F/3P with T7 genuinely LIVE on the old impl
  (8×300 seeded, all delays torn down, no error signal — did NOT
  reproduce) — evidence/REV1-5/red-k2.txt + red-k2-emulator.txt.
- [x] K2-2 Implement 5a in `services/dataCache.ts` (hoist
  `safeUnsubscribe` + `Unsubscribe` above `clearSubscriptionCache`
  verbatim; replace BOTH raw calls with
  `safeUnsubscribe(entry.unsubscribe)`; guards/dead-marking/map-clears
  untouched) + update ONLY the ordering assertions in
  `tests/rev14CacheClear.test.ts` (`await flush()` before unsub counts;
  auth-lost ordering per T2).
  Verify: targeted vitest runs for both files (expect GREEN) + stop-gate
  check (no other existing test touched).
  OUTCOME: GREEN 27/27 (stage-1) — evidence/REV1-5/green-k2-stage1.txt;
  stop-gate holds (only the ordering assertions changed, explained in
  REPORT).
- [x] K2-3 Commit REQ-5a (code + stage-1 tests + RED/GREEN evidence):
  `fix(cache): deferred-unsubscribe logout teardown (REQ-REV1-5a)`.
  OUTCOME: fcc5cd9.

## REQ-REV1-5b — epoch guard (K3-variant) — DONE (code a7bdcad)
- [x] K2-4 Add T4 to `tests/rev15K2.test.ts` + implement 5b in
  `services/dataCache.ts` (`let cacheEpoch = 0`; `+= 1` in clear;
  `myEpoch` capture + early return in `subscribeToDocument` release).
  Verify: `npx vitest run tests/rev15K2.test.ts` (expect GREEN incl. T4).
  OUTCOME: GREEN 28/28 — evidence/REV1-5/green-k2.txt.
- [x] K2-5 Mutation proofs: revert 5a.1 → T1/T2/T6 fail; revert 5b.2 →
  T4 fails. Save each raw to evidence/REV1-5/mutation-*.txt, then
  restore (working tree green again).
  OUTCOME: 5a.1 → 7 failed / 21 passed (T1/T2/T6 + 3 rev14 ordering
  assertions — they assert the new invariant); 5b.2 → exactly T4 fails;
  restored GREEN 28/28 — mutation-5a1.txt, mutation-5b2.txt,
  green-k2-restored.txt.
- [x] K2-6 Commit REQ-5b (epoch + T4 + mutation evidence):
  `fix(cache): document epoch guard against stale release (REQ-REV1-5b)`.
  OUTCOME: a7bdcad.

## Finish (after both commits)
- [x] K2-7 Full verification at HEAD into evidence/final/ (status, log,
  diff-stat + FULL diff incl. untracked, constraints proof, typecheck,
  full suite 63 files green, build, eslint CI-scope) + REPORT.md +
  changelog/backlog/known-issues entries + tasks.md boxes + evidence zip
  with sha256, then docs commit. STOP (no push without a written order).
  OUTCOME: typecheck clean; build clean (precache 42); test:rules 63
  files / 681 tests green exit 0 (T7 live-clean on fixed code);
  eslint 349/112/237 identical to baseline (112 errors all pre-existing
  .scratch; touched files 0 errors); constraints.txt section 1 empty.
  K2 stays OPEN (device test required). Nothing pushed, nothing
  deployed.
