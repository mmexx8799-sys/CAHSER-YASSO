# REPORT — REV1-4: finite-amount guards + logout cache clear

Base: merge `cadf9f3` (PR #26, post AUDIT-REV1). No `firestore.rules` /
`package.json` / `firebase.json` / `package-lock.json` / `.github` changes
in the whole cycle (proven in `evidence/final/constraints.txt` — empty).

## REQ-REV1-4a — Number.isFinite guards (pre-network)

- **Problem:** four money fields reached Firestore writes without a
  finiteness check: `invoiceData.total`/`subtotal` (processSale),
  `purchaseData.total`/`subtotal` (processPurchase), `payment.amount`
  (both payment functions).
- **Root (read verbatim at base):** `NaN < 0` and `Infinity < 0` are both
  false, so sale/purchase checks (`< 0`, with/without typeof) passed NaN
  and +Infinity; payments rejected NaN (`!amount`) and -Infinity (`<= 0`)
  but let +Infinity through; and every old check sat after
  `assertOnline()`, costing a network round-trip before failing.
- **Fix:** pre-network shape blocks after the opKey lines, before `await
  assertOnline()`, outside any try — `typeof x !== 'number' ||
  !Number.isFinite(x)` for the four totals, `!Number.isFinite(amount)`
  beside (not instead of) the old payment guard. Frozen Arabic messages
  (spec.md normative). No other line in these functions moves.
- **Commits:** `58b32bc` (code+tests+evidence) + `15a8777` (docs).
- **RED→GREEN:** 18 RED / 12 GREEN of 30 on unfixed (every invalid case ended at
  STOP-AFTER-GUARD instead of Arabic, proving the pre-fix gap was
  post-gate) → GREEN 30/30.
- **Behavior change:** NaN/±Infinity totals and +Infinity payments now
  fail fast with Arabic errors before any network contact; valid finite
  values (incl. 0) flow through byte-identically (full suite green).
- Evidence: `evidence/REV1-4/red-finite.txt`, `green-finite.txt`.

## REQ-REV1-4b — logout cache clear (ordering-safe)

- **Problem:** `dataCache.ts` module stores (`collectionEntries`, `cache`,
  `activeSubscriptions`) were never wiped — not on last unsubscribe, not
  on logout, not on user switch — expected from code analysis (not
  observed on a device or in a run): orphaned listeners may fire
  `permission-denied` after auth loss, and a previous user's cached data
  may be shown briefly (F6).
- **Root (read verbatim at base):** `auth.ts:22-24` bare
  `firebaseSignOut`; zero `.clear()` in dataCache.ts; only per-key
  refcount delete.
- **Fix:** exported `clearSubscriptionCache()` — synchronously invokes
  every LIVE stored unsubscribe exactly once (collections: only
  `entry.listening`; documents: only ref-counted keys), per-call
  try/catch, dead-marks entries, empties all three maps; `signOut` calls
  it FIRST; AuthContext watcher clears on uid transition (logout/switch/
  other-tab/expiry) via `lastUidRef` + pure `didAuthIdentityChange`
  predicate; `AppSettingsProvider` subscribes only once
  `currentUser?.uid` is set (predicate `shouldSubscribeAppSettings`).
- **Commits:** `58b32bc` + `15a8777` (same two).
- **RED→GREEN:** 11 RED of 11, then 6 RED / 11 GREEN of 17 on the guard additions (TypeError +
  double-unsubscribe totals) → GREEN 17/17 + 3 wiring tests (20/20);
  three wiring mutations each isolated exactly its target (1/19).
- **Behavior changes:** logout/teardown now synchronously drops all
  listeners before auth loss; app name loads after user identification,
  not at mount; clear also fires on login (null → uid), intended.
- Evidence: `evidence/REV1-4/red-clear.txt`,
  `red-clear-guard.txt`, `mutation-wiring-{1,2,3}.txt`, `green-clear.txt`.

## Honest deviations from the plan

- (a) `AppSettingsContext.tsx` changed per review order (not in the
  original plan): the login-time clear would otherwise have orphaned its
  mount-once subscription; recorded in plan.md ALLOWED-FILES.
- (b) 6 guard tests (release-then-clear ×2, predicate table ×4) were added
  after the first clear RED, per review order — RED proven via a
  dedicated mutation run (`red-clear-guard.txt`: 6 RED / 11 GREEN).
- (c) 3 static wiring tests + 3 wiring mutations added per review (K1,
  L1) — static text assertions with mutation proofs instead of RED.
- (d) Clear-test count evolved 11 → 17 (guard tests) → 20 (wiring tests).
- (e) The plan's claim that AC-1.7b proves post-clear double-release
  safety was corrected on record (it covers same-closure-twice only;
  AC-4b.6 covers the stale case) — see plan.md Risks.
- (f) Predicate-unit (not rendered-component) testing chosen with stated
  rationale in plan.md; harness `afterEach` hygiene added to the clear
  test file after a cross-test order-log pollution was found and
  explained (microtask + F6-kept entries, not a fix bug).
- No other deviation exists in specs/002 beyond what this list states.

## Residual risks (classified)

- **Code analysis — unobserved:** K2 — synchronous teardown skips
  `safeUnsubscribe` (the SDK 10.14.1 INTERNAL ASSERTION workaround);
  try/catch catches sync errors only; mocked tests cannot cover a real
  mid-event teardown.
- **Code analysis — nobody exposed today:** K3 — document unsubscribe
  counted by key, not instance (single subscriber per key everywhere).
- **Backlog, untreated:** archive-totals float accumulation (entry text
  only, zero code).
- **Code analysis:** appName subscription now waits for user
  identification (one extra render with the default name at boot).

## Untested

No real cashier device, no production traffic, no real browser
walkthrough, no logout-during-live-list-flow test.

## Deploy status

Nothing deployed. No recommendation. Suggested manual checks before any
deploy: (1) logout during a heavy list flow, watching console for
INTERNAL ASSERTION FAILED; (2) log in as a second account in the same
browser, verifying app name and data; (3) reload while signed in,
verifying all data appears.
