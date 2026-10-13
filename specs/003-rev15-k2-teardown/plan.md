# PLAN — REV1-5 (implement AFTER owner approves this file)

## REQ-REV1-5a — deferred teardown (implement FIRST)

Approach (all inside `services/dataCache.ts`, plus the ordering assertion
in `tests/rev14CacheClear.test.ts`):
- Move the `type Unsubscribe` + `safeUnsubscribe` block verbatim above
  `clearSubscriptionCache` (pure hoist; body byte-identical).
- In `clearSubscriptionCache`, replace both `try { entry.unsubscribe(); }
  catch {}` blocks with bare `safeUnsubscribe(entry.unsubscribe)` calls,
  keeping the `if (entry.listening)` / `activeSubscriptions.has(key)`
  guards, the sync dead-marking (`listening = false` +
  `callbacks.clear()`), and the three map `.clear()` calls exactly as-is.
  Bump `cacheEpoch` (5b) on the same path — see below; 5a alone does not
  add it.
- Update ONLY the ordering assertions in `tests/rev14CacheClear.test.ts`
  (the two sync `['unsub','unsub']` expectations ~:92/:126, the
  AC-4b.6 sync count ~:114, the resubscribe/double-clear sync
  `listenerCount()` reads): `await flush()` before asserting unsub counts,
  per the new AC-5a.4 invariant. Rationale: the old expectations assert
  the very synchronous behavior this REQ removes; the auth-ordering proof
  moves to T2 (macrotask-delivered `auth-lost` vs microtask unsubs). If ANY
  other existing test needs to change → STOP and report (stop-gate).

Test strategy (new `tests/rev15K2.test.ts`, rev14 mock pattern — mocked
`onSnapshot` at the boundary, mocked `firebase/auth` signOut delivering
`auth-lost` via `setTimeout(0)`; real `signOut()` from `services/auth`):
- T1: after `clearSubscriptionCache()`, raw SDK unsubscribe mocks called 0
  times synchronously, exactly once each after `await flush()`.
- T2: ordering — synchronously after invoking `signOut()` the order log is
  still empty (deferred, not sync); after settle, all `unsub` events
  precede `auth-lost`. The sync-empty half is what fails on the old
  implementation (old code pushes unsubs synchronously), so T2 joins
  T1/T6 in the 5a.1 mutation proof.
- T3: double clear schedules zero additional unsubscribes.
- T5: collection regression — stale release after clear + resubscribe stays
  safe by entry identity (passes before and after; locks AC-4b.6 under the
  deferred path).
- T6: static wiring (source text, whitespace-tolerant) — the
  `clearSubscriptionCache` slice references `safeUnsubscribe` and contains
  no direct `entry.unsubscribe()`.
- T7: best-effort real-SDK reproduction on the Firestore emulator (only
  runs when the emulator is reachable; otherwise logs `not feasible` and
  passes without faking): the `onSnapshot` mock delegates to the REAL SDK
  while a module flag is set; seed 8 collections × ~300 docs via `getDB()`,
  open 8 real listeners via `subscribeToCollection`, call
  `clearSubscriptionCache` at delays 0/1/5/20/50 ms; fail on any
  `unhandledRejection`, `uncaughtException`, or `console.error` matching
  `/INTERNAL ASSERTION/`. A pass here is NOT proof of absence (stated in
  the test log and the REPORT).

Risks: deferred teardown means a same-tick resubscribe briefly coexists
with queued unsubs of the dead entries — safe by construction (dead entries
are unreachable from the maps; queued unsubs hold the function value, not
the map slot). Rollback: revert commit.

## REQ-REV1-5b — epoch guard (implement SECOND)

Approach (same file): add `let cacheEpoch = 0` at module level; `+= 1` as
the first line of `clearSubscriptionCache`; capture `const myEpoch =
cacheEpoch` at the top of `subscribeToDocument`; early-return the release
closure when `myEpoch !== cacheEpoch`. Nothing else in either subscribe
function moves.

Test strategy: T4 (added with the 5b commit) — document A →
clear → document B (same key) → release A: B's SDK unsubscribe NOT called;
release B: called exactly once. On pre-5b code, release A kills B (key, not
instance), so T4 is the 5b.2 mutation target.

## ALLOWED-FILES (exact)
- `services/dataCache.ts` (5a hoist + 2 deferred calls; 5b epoch ×3 lines)
- `tests/rev15K2.test.ts` (NEW; T1-T7)
- `tests/rev14CacheClear.test.ts` (ordering assertion only)
- `specs/003-rev15-k2-teardown/**` (spec/plan/tasks/REPORT/evidence)
- docs ×3 (`docs/backlog.md`, `docs/known-issues.md`, `docs/changelog.md` —
  entries only, docs commit)

## Evidence protocol (mandatory, per step)
`npx vitest run <file>` RED on unfixed (save raw) → fix → GREEN →
mutation reverts (5a.1 → T1/T2/T6 fail; 5b.2 → T4 fails; save raw) →
`npx tsc --noEmit` → `npm run build` → full suite (expect 62 → 63 files,
all green) → eslint CI-scope 0 errors → `git diff --stat` + FULL diff
(incl. untracked) → `evidence/final/constraints.txt` (zero-diff proof for
the 10 hard-constraint paths) → evidence zip + sha256.
One commit per REQ, then one docs commit. No push. No deploy.

## Docs (at commit time, entries only)
REPORT.md (with honesty classification — K2 stays open), changelog entry,
backlog entry, known-issues K2/K3 update, tasks.md boxes.
