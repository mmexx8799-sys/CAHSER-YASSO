// REV1-2 T2.1 (AUDIT-REV1) — pure unit contract for utils/money.
//
// RED-FIRST: ../utils/money DOES NOT EXIST YET. This file fails at import
// time (vitest module-resolve error) and `tsc --noEmit` fails with
// "Cannot find module '../utils/money'". Both failures are the RED proof.
// No suppression of any kind (no `any`, no ts-expect-error, no skip).
//
// Contract under test (to be implemented in Phase B):
//   round2(x): cents rounding; non-finite/non-number input ⇒ 0.
//   isSettled(b): true iff |b| < 0.005 (strict); non-finite ⇒ true.
//
// Two documented float-honesty notes (see tests below):
//   (a) 1.005 is stored as 1.0049999999999999, so naive
//       Math.round(x*100)/100 yields 1, not 1.01. LOCKED at 1 — NO Phase B
//       choice: AC-2.1 mandates the exact opKey.ts:60 semantics (naive,
//       `Math.round((Number(n) || 0) * 100) / 100`), and epsilon correction
//       of any kind is forbidden.
//   (b) round2(-1e-9): predicted -0 (Object.is) under the naive
//       implementation — derivation in the test comment. The assertion
//       itself only requires === 0 (either zero passes), so it is
//       implementation-agnostic; the -0 finding is recorded, not assumed.
//
// Run single (expect file-level RED until utils/money.ts exists):
//   npx vitest run tests/rev12MoneyHelper.test.ts

import { describe, it, expect } from 'vitest';
import { round2, isSettled } from '../utils/money';

const UNDEF = undefined as unknown as number;
const NULLV = null as unknown as number;

describe('REV1-2 T2.1 — round2 contract', () => {
  it.each([
    [19.99, 19.99],
    [33.33, 33.33],
    [10.1, 10.1],
    [7.7, 7.7],
    [0.1 + 0.2, 0.3],
    // 1.005 ⇒ 1, locked (header note (a): opKey.ts:60 naive, no epsilon).
    [1.005, 1],
    [Number.NaN, 0],
    [UNDEF, 0],
    [NULLV, 0],
  ] as Array<[number, number]>)('round2(%p) === %p', (input, expected) => {
    expect(round2(input)).toBe(expected);
  });

  it('round2 of a tiny negative is zero (either signed zero passes ===)', () => {
    // Predicted under naive Math.round(x*100)/100: -0.004*100 = -0.4…06e-1?
    // Exactly: -0.004 is stored ≈ -0.00400000000000000008; ×100 ≈ -0.4000…;
    // Math.round gives -0; -0/100 is -0. Either zero === 0, so this holds
    // for any correct rounder.
    expect(round2(-0.004) === 0).toBe(true);
  });

  it('round2(-1e-9): recorded, not assumed (predicted Object.is -0)', () => {
    // Derivation (naive impl): -1e-9 ≈ -1.0000000000000000209e-9;
    // ×100 ≈ -1.0000000000000000209e-7 ∈ (-1, 0) ⇒ Math.round ⇒ -0;
    // -0/100 ⇒ -0. EXPECTED Object.is(result, -0) === true — recorded here
    // as prediction; the binding assertion below only needs === 0 so it
    // stays green for any rounder that maps dust to zero.
    // Predicted: Object.is(round2(-1e-9), -0) === true (confirm in Phase B).
    expect(round2(-1e-9) === 0).toBe(true);
  });
});

describe('REV1-2 T2.1 — isSettled contract (|b| < 0.005, strict)', () => {
  it.each([
    [0.004, true],
    [0.005, false],
    [0.01, false],
    [-0.004, true],
    [-0.01, false],
    [Number.NaN, true],
    [UNDEF, true],
  ] as Array<[number, boolean]>)('isSettled(%p) === %p', (input, expected) => {
    expect(isSettled(input)).toBe(expected);
  });
});

// Deterministic PRNG (fixed seed — Math.random is forbidden here).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('REV1-2 T2.1 — 1000-round settlement property', () => {
  it('random cent-exact invoices accumulated with round2 settle to exactly 0', () => {
    const rand = mulberry32(20261010);
    for (let round = 0; round < 1000; round++) {
      // Amounts are born as integer cents ÷ 100: always cent-exact inputs.
      const nInvoices = 1 + Math.floor(rand() * 4);
      let balance = 0;
      let totalCents = 0;
      for (let i = 0; i < nInvoices; i++) {
        const cents = 1 + Math.floor(rand() * 99999);
        totalCents += cents;
        balance = round2(balance + cents / 100);
      }
      // Pay the exact cent total (integer cents ÷ 100).
      balance = round2(balance - totalCents / 100);
      // === (not toBe): a -0 settlement is still settled.
      expect(balance === 0).toBe(true);
    }
  });
});
