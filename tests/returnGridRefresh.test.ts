// REQ-RETURNS-REFRESH — grid refresh gate unit suite. Node env, no DOM,
// no vi.mock: exercises the exported outcome predicate (the exact gate the
// runReturn success branch calls before onComplete) — pure function.
//
// RED-FIRST: written against the wiring; replacing the predicate body with
// `return false` (or `return true`) makes the success (resp. failure-path)
// tests fail — verified by temporary edit → red → restore → green.
// Residual (documented): if runReturn stopped calling the helper, these
// tests would still pass — wiring is covered by tsc + code review + the
// grep-able SOLE onComplete call site in the success branch. Offline-guard
// failures and generic catch paths carry no outcome value at all, so the
// refresh is unreachable there by construction (asserted below by the
// absence of any other outcome that maps to true).
//
// Run single file:
//   npx vitest run tests/returnGridRefresh.test.ts

import { describe, it, expect } from 'vitest';
import { shouldRefreshReturnGrid } from '../pages/ReturnsPage';

describe('REQ-RETURNS-REFRESH: grid refresh only on successful return', () => {
  it("refreshes on 'sent'", () => {
    expect(shouldRefreshReturnGrid('sent')).toBe(true);
  });

  it("refreshes on 'finished-without-send'", () => {
    expect(shouldRefreshReturnGrid('finished-without-send')).toBe(true);
  });

  it("no refresh on 'mismatch' (cart + customer kept)", () => {
    expect(shouldRefreshReturnGrid('mismatch')).toBe(false);
  });

  it("no refresh on 'aborted' (user abort and lookup-failed)", () => {
    expect(shouldRefreshReturnGrid('aborted')).toBe(false);
  });

  it('no refresh on anything else (offline-guard/catch carry no success outcome)', () => {
    expect(shouldRefreshReturnGrid('')).toBe(false);
    expect(shouldRefreshReturnGrid('unknown')).toBe(false);
  });
});
