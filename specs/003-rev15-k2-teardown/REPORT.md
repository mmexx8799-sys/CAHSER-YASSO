# REPORT — REV1-5: deferred-unsubscribe logout teardown (K2) + epoch guard (K3-variant)

Base: `a15d8fe` (REV1-4 final evidence + REPORT). Commits: `fcc5cd9`
(REQ-5a) + `a7bdcad` (REQ-5b) + docs commit (this REPORT + changelog /
backlog / known-issues entries + tasks.md boxes + final evidence + zip).
No `firestore.rules` / `firestore.indexes.json` / `firebase.json` /
`package.json` / `package-lock.json` / `.github` / `services/auth.ts` /
`contexts` / `pages` / `components` changes in the whole cycle (proven in
`evidence/final/constraints.txt` — section 1 empty; section 2 shows only
allowed files).

## Classification (honesty — reviewer will check)

**K2: fix applied; mock-level proof + live-emulator T7 runs (old impl did
not reproduce, new impl clean); real-device logout-during-live-list test
still REQUIRED before deploy. NOT closed. NOT verified.**

K3-variant (5b): defensive guard applied with behavioral + mutation proof;
nobody was exposed before it (one subscriber per document key everywhere —
expected from code analysis), so this is hardening, not a bug fix.

## REQ-REV1-5a — deferred teardown (K2)

- **Problem:** `clearSubscriptionCache` invoked raw SDK
  `entry.unsubscribe()` synchronously (collection + document loops),
  bypassing `safeUnsubscribe` (queueMicrotask) — the documented workaround
  for SDK 10.14.1 `INTERNAL ASSERTION FAILED: Unexpected state` when
  teardown races an in-flight watch event. The per-call try/catch caught
  synchronous throws only.
- **Fix (`services/dataCache.ts` only):** hoisted `safeUnsubscribe` (+
  `Unsubscribe` type) above `clearSubscriptionCache` verbatim; replaced
  BOTH raw calls with `safeUnsubscribe(entry.unsubscribe)`; kept the
  `entry.listening` / `activeSubscriptions.has(key)` guards, the
  synchronous dead-marking (`listening = false` + `callbacks.clear()`),
  and the three map clears exactly as-is. New ordering invariant
  (AC-5a.4): scheduled unsubs run before any auth-state-change
  notification deliverable after `firebaseSignOut` (microtask FIFO precedes
  the macrotask). `services/auth.ts` NOT modified (already clear-first).
- **RED→GREEN:** on unfixed code, `tests/rev15K2.test.ts` gives 4 failed /
  3 passed (T1 sync-0 fails, T2 sync-empty fails, T6 ×2 fail; T3/T5 pass
  already as regression locks; T7 `not feasible` without emulator) —
  `evidence/REV1-5/red-k2.txt`. After the fix: 28/28 across both files —
  `evidence/REV1-5/green-k2.txt` (+ `green-k2-restored.txt` post-mutation).
- **Mutation:** revert 5a.1 (raw sync calls restored) → T1/T2/T6 fail (4
  rev15 assertions) plus the 3 updated rev14 ordering assertions fail —
  `evidence/REV1-5/mutation-5a1.txt` (7 failed / 21 passed). T3/T4/T5/T7
  unaffected, as designed.
- **Behavior change (intended, the only one):** SDK unsubscribes now land
  one microtask after `clearSubscriptionCache()` returns instead of
  synchronously. Same-tick resubscribe briefly coexists with queued unsubs
  of dead entries — safe by construction (dead entries are unreachable
  from the maps; queued unsubs hold the function value, not the map slot).

## REQ-REV1-5b — document epoch guard (K3-variant, defensive)

- **Problem (expected from code analysis, never observed):**
  `subscribeToDocument`'s release closure addresses entries BY KEY, so a
  pre-clear release after clear + same-key resubscribe would unsubscribe
  the NEW listener. Nobody exposed today (single subscriber per key).
- **Fix (same file, 3 lines):** `let cacheEpoch = 0`, `+= 1` first line of
  the clear, `const myEpoch = cacheEpoch` at subscribe time, early return
  when `myEpoch !== cacheEpoch`. No other change to either subscribe
  function.
- **RED→GREEN + mutation:** T4 added with the 5b commit; revert 5b.2
  (guard removed) → exactly T4 fails, 7 pass —
  `evidence/REV1-5/mutation-5b2.txt`. T4 failing pre-5b also proves the
  stale-release kill it guards against (release A unsubscribed B's
  listener through the shared key).

## T7 — best-effort real-SDK reproduction (emulator)

- Method: `onSnapshot` mock delegates to the REAL SDK behind a flag;
  signed in as cashier (tx2Sale pattern: Auth emulator + `users` doc via
  `withSecurityRulesDisabled`); seeded 8 readable collections × 300 docs
  rules-disabled; opened 8 real listeners via `subscribeToCollection`;
  cleared at delays 0/1/5/20/50 ms; failed on any `unhandledRejection`,
  `uncaughtException`, or `console.error` matching `/INTERNAL ASSERTION/`;
  with a loud non-vacuity probe (seeded doc readable through the app
  client before the scenarios).
- Against the OLD (sync) implementation: seeded 8×300 in 6 batches, all 5
  delays torn down, **no error signal — did NOT reproduce** (consistent
  with the narrow race window + memory-cache fallback in Node; the manual
  browser test also did not reproduce). NOT proof of absence — worded that
  way in the test log and here.
- Against the NEW implementation (full `test:rules` suite): same live run,
  no error signal. Without an emulator (plain `vitest run`): honest `not
  feasible` (TCP probe, no Firebase call) and pass — nothing faked.
- Evidence: `evidence/REV1-5/red-k2-emulator.txt` (old impl, genuine live
  run), `evidence/final/test-rules.txt` line 614 (new impl, live run).

## Existing-test edit (only allowed one) + stop-gate

`tests/rev14CacheClear.test.ts` ordering assertions updated to the new
invariant: `await flush()` before unsub counts (tests 1, resubscribe,
AC-4b.6, double-clear), and the signOut test now asserts the clear CALL
precedes `firebaseSignOut` with deferred completion (`['auth']`
synchronously — the mock's sync push models the CALL, not the macrotask
notification — then `['auth','unsub','unsub']` after flush; the true
notification ordering is proven by rev15K2 T2). Static wiring tests and
all other files untouched. **Stop-gate: no other existing test needed to
change** — full suite 63 files / 681 tests green (62/673 at base, +8 new;
zero regressions, no retry).

## Edge cases (covered or noted)

Logout with an empty cache: no-op (T3-adjacent + rev14 clear-empty test,
both green). Clear during an in-flight snapshot callback: callbacks
already cleared ⇒ no notification (dead-marking sync; T7's 0 ms delay
exercises this live). `safeUnsubscribe`'s own try/catch still swallows SDK
errors (`console.warn` — noted, not failed, in T7). Entries released
before the clear are not unsubscribed twice (guards — rev14
release-then-clear ×2 + T3, green).

## What was / was not run

Ran: `npx vitest run tests/rev15K2.test.ts` RED plain (4F/3P) + RED under
emulator (4F/3P, T7 genuinely live on old impl) → fix → GREEN 28/28 →
both mutations → restore GREEN → `npx tsc --noEmit` clean →
`npm run build` clean (precache 42, 18.03s) → full `npm run test:rules`
63/681 green (342s, exit 0) → `npm run lint` totals 349/112/237 identical
to baseline (all 112 errors confined to pre-existing `.scratch/*.cjs`;
touched files 0 errors) → `git diff --stat` + full diff + constraints.
Raw outputs pasted in `evidence/REV1-5/` and `evidence/final/`.

NOT run: no real cashier device, no production traffic, no real browser
walkthrough, no logout-during-live-list test on a device (REQUIRED before
deploy — K2 stays open). Nothing deployed. No recommendation to deploy.

## Honest deviations from the plan

- (a) T7 collections are 8 REAL readable ones (products/categories/…),
  seeded rules-disabled as a signed-in cashier — arbitrary collections are
  rules-denied, so the spec's literal "8 collections" was instantiated
  with real ones (documented in the test + here; no spec change needed).
- (b) T7's first probe revision (`__rev15probe__`) was rejected by the
  emulator (reserved name) and the unauthenticated write hung; fixed by
  TCP pre-probe + authenticated tx2Sale-pattern flow. Both dead ends are
  preserved in `red-k2-emulator.txt` history? No — overwritten; recorded
  here instead (one file keeps the genuine live RED run).
- (c) The 5a.1 mutation additionally fails 3 rev14 ordering assertions
  (they assert the new invariant) — beyond the required T1/T2/T6, and
  consistent with it.
- (d) Pre-existing untracked clutter (`tatus --short` file,
  `.opencode/skills/*/`) was already in the tree before this cycle
  (visible in the first directory read) — left untouched, not committed.
- No other deviation exists in specs/003 beyond what this list states.
