// REQ-UI-4 (AUDIT-TX-3 UI layer, customer return) — return modal
// close-transition unit suite. Node env, no DOM, no vi.mock: exercises the
// exported close-transition helper (the exact body the modal close effect
// delegates to) with fakes, plus the store clearCart key drop.
//
// RED-FIRST: written against the wiring; the first test FAILS if the forget
// call is removed from resetReturnModalOnClose (verified by temporarily
// deleting that line → red → restoring → green).
// Residual (documented): if the effect itself stopped calling the helper,
// these tests would still pass — effect wiring is covered by tsc + code
// review + manual QA. The helper is the SOLE forget call site for this flow
// (grep-able).
//
// Run single file:
//   npx vitest run tests/returnModalClose.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resetReturnModalOnClose,
  forgetReturnKey,
} from '../pages/ReturnsPage';
import { useReturnCartStore } from '../stores/returnCartStore';
import { opKeyStore } from '../utils/opKeyStore';

beforeEach(() => {
  opKeyStore.clear('return');
});

async function returnIdentity() {
  const { docFingerprint } = await import('../services/api/opKey');
  return {
    fp: docFingerprint(
      { items: [{ id: 'p', buyQuantity: 1, price: 10 }], total: 10, customerId: 'c' },
      'customerId',
    ),
    extra: { originalInvoiceId: null, dailyArchiveId: 'd' },
  };
}

describe('REQ-UI-4: return modal close-transition forget', () => {
  it('close idle (true→false, not submitting): reset runs + forget called', () => {
    const reset = vi.fn();
    const forget = vi.fn();
    const ran = resetReturnModalOnClose({
      wasOpen: true, isOpen: false, isSubmitting: false, reset, forgetKey: forget,
    });
    expect(ran).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
    // RED anchor: deleting the forget call below makes this fail.
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('forgetReturnKey drops the singleton key memory', async () => {
    const id = await returnIdentity();
    const v = await opKeyStore.prepare('return', id);
    expect(v.kind).toBe('fresh');
    expect(opKeyStore.peek('return')?.key).not.toBeNull();
    forgetReturnKey();
    // Memory-only in node (no sessionStorage): nothing remains.
    expect(opKeyStore.peek('return')).toBeNull();
  });

  it('no forget on mount, while open, or during an in-flight submit', () => {
    const reset = vi.fn();
    const forget = vi.fn();
    expect(resetReturnModalOnClose({
      wasOpen: false, isOpen: false, isSubmitting: false, reset, forgetKey: forget,
    })).toBe(false);
    expect(resetReturnModalOnClose({
      wasOpen: true, isOpen: true, isSubmitting: false, reset, forgetKey: forget,
    })).toBe(false);
    expect(resetReturnModalOnClose({
      wasOpen: true, isOpen: false, isSubmitting: true, reset, forgetKey: forget,
    })).toBe(true);
    // Only the submitting-close ran the reset — without the key forget:
    expect(reset).toHaveBeenCalledTimes(1);
    expect(forget).not.toHaveBeenCalled();
  });

  it("store clearCart drops the 'return' key", async () => {
    const id = await returnIdentity();
    const v = await opKeyStore.prepare('return', id);
    expect(v.kind).toBe('fresh');
    expect(opKeyStore.peek('return')?.key).not.toBeNull();
    useReturnCartStore.getState().clearCart();
    expect(opKeyStore.peek('return')).toBeNull();
  });
});
