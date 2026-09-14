// BUG-P0-4 — unit tests for calculateNetCash (pure function, no Emulator).
//
// BR-1: net cash = collected cash MINUS cash returns only (on-account
// customer returns never leave the drawer).
//
// Run: npx vitest run tests/archiveCalculations.test.ts

import { describe, it, expect } from 'vitest';
import { calculateNetCash } from '../utils/archiveCalculations';

describe('BUG-P0-4: calculateNetCash', () => {
  it('AC-01: archive with cash-only returns', () => {
    expect(calculateNetCash({
      totalCash: 1000,
      totalReturns: 150,
      totalReturnsCash: 150,
    })).toBe(850);
  });

  it('AC-02: archive with cash + on-account returns excludes the on-account part', () => {
    expect(calculateNetCash({
      totalCash: 1000,
      totalReturns: 300,
      totalReturnsCash: 150,
    })).toBe(850);
  });

  it('AC-03: archive with no returns equals totalCash', () => {
    expect(calculateNetCash({
      totalCash: 1000,
      totalReturns: 0,
      totalReturnsCash: 0,
    })).toBe(1000);
  });

  it('Edge: on-account-only archive (cash split missing) treats cash returns as zero', () => {
    expect(calculateNetCash({
      totalCash: 1000, totalReturns: 200, totalReturnsOnAccount: 200,
    } as any)).toBe(1000); // لا 800 — كل المرتجع كان آجلًا، لا نقد خرج من الدرج
  });

  it('Edge: genuinely old archive (both split fields absent) falls back to totalReturns', () => {
    expect(calculateNetCash({
      totalCash: 1000,
      totalReturns: 200,
    } as any)).toBe(800); // هذا صحيح: لا توجد بيانات تقسيم إطلاقًا
  });

  it('Edge: missing/zero fields default to 0 instead of NaN', () => {
    expect(calculateNetCash({} as any)).toBe(0);
  });
});
