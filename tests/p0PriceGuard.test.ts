// P0-VERIFY-8/9 — price-guard hole proof (pure unit, no emulator).
// Premise: getDefinedPrices counts 0 as defined (core.ts) and the product form
// defaults all prices to 0 (ProductsPage.tsx:115-119).
// Run: npx vitest run tests/p0PriceGuard.test.ts
import { describe, it, expect } from 'vitest';
import { isPriceAccepted, getDefinedPrices } from '../services/api/core';

describe('P0-VERIFY-8 price guard with zero reference', () => {
  it('G1 zero is counted as defined', () => {
    expect(getDefinedPrices({ price: 100, wholesaleCashPrice: 0 })).toContain(0);
  });
  it('G2 product price=100 + wholesaleCashPrice=0 ACCEPTS sale at 1 (the hole)', () => {
    expect(isPriceAccepted(1, { price: 100, wholesaleCashPrice: 0 })).toBe(true);
  });
  it('G3 all-zero product ACCEPTS any price (the hole)', () => {
    expect(isPriceAccepted(9999, { price: 0, retailCashPrice: 0 })).toBe(true);
  });
  it('G4 healthy product still floored at 50%', () => {
    expect(isPriceAccepted(49, { price: 100 })).toBe(false);
    expect(isPriceAccepted(50, { price: 100 })).toBe(true);
  });
});
