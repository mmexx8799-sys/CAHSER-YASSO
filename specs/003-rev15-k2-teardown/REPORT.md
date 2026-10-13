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
  (AC-5a.4): every scheduled unsubscribe is queued before
  `firebaseSignOut` is called (microtask FIFO), so any notification
  queued at-or-after that call follows them. `services/auth.ts` NOT
  modified (already clear-first). CORRECTION (follow-up): the earlier
  "macrotask" phrasing for SDK delivery is withdrawn — SDK
  notification-delivery timing was NOT verified against SDK code; the
  same correction was applied to the dataCache.ts comment.
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
  no error signal. Without an emulator (plain `vitest run`): T7 reports
  SKIPPED via `ctx.skip()` with the reason on stdout (follow-up change —
  the old silent `not feasible` pass is gone) — nothing faked.
- Evidence: `evidence/REV1-5/red-k2-emulator.txt` (old impl, genuine live
  run), `evidence/final/test-rules.txt` line 614 (new impl, live run).

## Existing-test edit (only allowed one) + stop-gate

`tests/rev14CacheClear.test.ts` ordering assertions updated to the new
invariant: `await flush()` before unsub counts (tests 1, resubscribe,
AC-4b.6, double-clear), and the signOut test now asserts the clear CALL
precedes `firebaseSignOut` with deferred completion (`['auth']`
synchronously — the mock's sync push models the CALL, not a verified SDK
notification — then `['auth','unsub','unsub']` after flush). Ordering
against modeled async deliveries is proven by rev15K2 T2 (macrotask mode)
and T2b-i (microtask mode); synchronous delivery is shown NOT to preserve
it (T2b-ii observes `['auth-lost','unsub','unsub']`, pinned and reported,
not silently weakened). Real-SDK delivery timing was not verified — see
the T2b section below. Follow-up rename (title only): the signOut test is
now 'signOut() calls clear before firebaseSignOut; SDK unsubscribes run
after via microtask (ordering proven in rev15K2 T2)'. Static wiring tests
and all other files untouched. **Stop-gate: no other existing test needed to
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
Follow-up runs (tests/docs/whitespace/comment only — zero runtime
behavior change, so no full-suite re-run; the 63/681 green stands on
semantically identical production code): follow-up targeted plain run →
29 passed / 1 skipped (T7 SKIPPED —
`evidence/REV1-5/green-followup.txt`); same two files under
emulators:exec → 30/30 with T7 live-clean including the swallowed-warn
assertion (`evidence/REV1-5/green-followup-emulator.txt`); small-prompt
batch targeted plain run → 29 passed / 2 skipped (T7+T2c SKIPPED —
`evidence/REV1-5/green-smallprompt.txt`); same two files under
emulators:exec → 31/31 (`evidence/REV1-5/green-smallprompt-emulator.txt`:
T2c measured 5/5 unsubs-first with latencies; T7 live-clean);
`npx tsc --noEmit` re-run exit 0 (command + exit code in
`evidence/final/typecheck.txt`).

NOT run: no real cashier device, no production traffic, no real browser
walkthrough, no logout-during-live-list test on a device (REQUIRED before
deploy — K2 stays open). Nothing deployed. No recommendation to deploy.

## T2b — delivery-mode boundary (follow-up, observed, not weakened)

The mocked `firebase/auth` signOut gained a switchable `authDelivery`
mode; each mode models a HYPOTHETICAL delivery — none is a verified SDK
claim:
- T2b-i (microtask: `await Promise.resolve()` then push): observed
  `['unsub','unsub','auth-lost']`. Guaranteed by FIFO for anything queued
  at-or-after the signOut call, in the mock.
- T2b-ii (sync: push inside the call before any microtask drains):
  observed `['auth-lost','unsub','unsub']`. Ordering is NOT guaranteed in
  this mode; the order is pinned as observed and reported here — the
  assertion was not silently weakened.
- `ctx.skip()` note: the installed vitest 2.1.9 types
  (`@vitest/runner`) and runtime define `skip: () => void` — no reason
  argument. T7 logs its skip reason to stdout, then calls `ctx.skip()`.

## T2c — real auth-emulator order measurement (small-prompt batch)

Answers T2b-ii's open question against the REAL auth SDK on the
emulator: 5 rounds of sign-in → subscribe ×2 → clear + REAL signOut (same
order as `services/auth.ts`; its own signOut can't be used — this file
mocks `firebase/auth` signOut for T2/T2b), with the null-callback tag
pushed into the SHARED order log so each round's slice is the TRUE
interleave. Firestore listeners stay mocked; completion asserted, order
recorded.
- Observed (emulator, 5/5 rounds): `[unsub,unsub,rN:auth-null]` — both
  unsubs executed before the real auth-null callback every round.
- Latency data: auth-null arrived ~0ms after signOut resolved in the
  final run — but a diagnostic run needed >300ms per round (callbacks had
  not arrived 300ms+flush after signOut;
  `evidence/REV1-5/t2c-diag-slow-callback.txt`). Callback latency varies
  run-to-run (0ms to 300ms+ observed); unsubs are ~immediate microtasks
  in all runs.
- Honest reading: on the emulator the margin favored unsubs-first in all
  measured rounds, but the variance proves timing-dependence — a
  fast-callback inversion is conceivable in principle (never observed)
  and production timing is a different transport altogether. Recorded,
  not pinned; K2 stays open.
- Measurement-bug episode (kept honest): the first T2c revision appeared
  to show zero callbacks — root cause was a split event log (auth tags
  went to a separate array while slices read only the unsub channel),
  not an SDK behavior; fixed by unifying the log. Failing run preserved
  in `evidence/REV1-5/t2c-v2-split-channel.txt`; final green run in
  `evidence/REV1-5/green-smallprompt-emulator.txt` (31/31).

## Stale-closure coverage (follow-up, item 3)

The stale COLLECTION closure after a same-key resubscribe is covered by
T5 (entry identity: release A is a no-op, release B unsubs exactly
once) — no duplicate test was added.

## T7 hardening (follow-up)

- (a) Any `console.warn` matching `/Firestore unsubscribe swallowed/` now
  fails T7 (it is routed to `failures`, not `notes`). Verified live: the
  follow-up emulator run shows only the benign IndexedDB-fallback warn —
  no false positive.
- (b) Without an emulator, T7 reports SKIPPED via `ctx.skip()` with the
  reason on stdout (plain run: 29 passed / 1 skipped). The old silent
  `not feasible` pass is gone.

## Follow-up observed: vite `esbuild.drop` blinds manual browser logout tests

- Observed (read verbatim): `vite.config.ts:39-41` sets an unconditional
  `esbuild: { drop: ['console', 'debugger'] }`.
- Observed (measured after `npm run build`): neither `Firestore
  unsubscribe swallowed` (safeUnsubscribe's warn) nor `Error notifying
  subscriber` (dataCache's error callbacks) appears anywhere in
  `dist/assets/*.js` — the drop strips app `console.*` from the
  production bundle.
- Expected consequence (NOT run as a manual browser test in this cycle):
  manual logout tests on preview/dev builds cannot display the app's own
  console output — including the ONLY visible trace of a swallowed SDK
  assertion error. A manual "logout during heavy list, watch console"
  check therefore cannot confirm or refute K2; console silence there is
  not evidence (a crash/hang would still show). Dev-mode stripping is
  expected from config semantics (the drop sits in the shared `esbuild`
  key, not under `build`, so it applies to dev transforms too) — stated
  as expected, not re-verified with a dev-mode probe in this cycle.
- Unaffected: automated T7 capture (vitest runs unbundled code, including
  the warn-fail assertion of item 1a — there is no test named "T7a"; that
  wording is corrected everywhere it appeared — which is why the tests can
  assert on console output at all).

## Owner-reported manual-debug observation (separate open issue, cause unconfirmed)

Source: owner screenshot, debug preview build on :4174 (temporary
untracked `vite.debug.config.ts`, created at owner request, never
committed, kept until the owner confirms no further debug runs are
needed), post-logout state (#/login + toast «تم تسجيل الخروج بنجاح.»):
- Observed: toast «حدث خطأ أثناء تحميل المنتجات.» with the full console
  line `Error fetching paginated products: FirebaseError: Missing or
  insufficient permissions.` (source: `services/api/products.ts:235-236`
  — one-shot `getDocs` from POSPage/ProductsPage/ReturnsPage).
- Classification: read-vs-auth-loss race during the transition (expected
  from code analysis — NOT proven). NOT an `INTERNAL ASSERTION`, NOT a K2
  signal (no `Error listening to ...`, no swallowed-unsub warn in the
  shot; T7's fail conditions would not have fired on it).
- Separately in the same shot: `Failed to check users existence ...
  permissions` (×2, LoginPage bundle) — anonymous read of `users`,
  denied by rules (`LoginPage.tsx:23` runs on page mount while logged
  out) — pre-existing noise newly visible under the debug build, outside
  K2 scope.
- NOT observed in the captured shot: any Listen request with 400, any
  `INTERNAL ASSERTION`. A claimed Listen-400 needs Network details
  (Request URL + Response) from a re-observed run to be recorded
  precisely. Recorded in `docs/known-issues.md` as
  POST-LOGOUT-PRODUCTS-FETCH (open, owner-reported).

## Honest deviations from the plan

- (a) T7 collections are 8 REAL readable ones (products/categories/…),
  seeded rules-disabled as a signed-in cashier — arbitrary collections are
  rules-denied, so the spec's literal "8 collections" was instantiated
  with real ones (documented in the test + here; no spec change needed).
- (b) T7's first probe revision (`__rev15probe__`) was rejected by the
  emulator (reserved name) and the unauthenticated write hung; fixed by
  TCP pre-probe + authenticated tx2Sale-pattern flow. The committed
  `red-k2-emulator.txt` keeps the genuine live RED run.
- (c) The 5a.1 mutation additionally fails 3 rev14 ordering assertions
  (they assert the new invariant) — beyond the required T1/T2/T6, and
  consistent with it.
- (d) Untracked clutter at cycle time (`tatus --short`,
  `.opencode/skills/*/`) was observed in the tree before any write in
  this cycle (first read-only directory listing) and recorded as
  untracked in committed `evidence/final/constraints.txt` §3 — left
  untouched and uncommitted throughout. CORRECTION at follow-up:
  `tatus --short` no longer exists in the working tree (verified:
  `Get-Item -LiteralPath 'tatus --short'` fails with ItemNotFound, and
  `git status --short` is clean of it), so no CreationTime can be
  reported and no before/after comparison against the cycle's first
  commit (`fcc5cd9`, 2026-10-12 13:31:22 +0300) is possible. The earlier
  "pre-existing" wording is therefore downgraded from filesystem fact to
  recollected observation. No delete command for it was issued in this
  cycle (no `del`, no `git clean`, only scoped `git add <paths>`); it was
  presumably removed outside the cycle, as the follow-up task anticipates
  ("owner deletes"). The file was never read, executed, staged, or
  deleted here — per instruction it stays unhandled. `.opencode/skills/*/`
  remains untouched/unstaged.
- (e) Line-ending note (follow-up): committed evidence text files
  (`evidence/final/constraints.txt`, `test-rules.txt`, etc.) are
  LF-normalized by git on commit, while the gitignored evidence zip
  (`specs/REV1-5-evidence.zip`) holds the on-disk CRLF bytes; the hash in
  `specs/REV1-5-evidence.sha256` pins the zip as stored.
- No other deviation exists in specs/003 beyond what this list states.
