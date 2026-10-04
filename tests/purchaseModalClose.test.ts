// REQ-UI-2 (AUDIT-TX-3 UI layer, purchase) — purchase modal close-transition
// unit suite. Node env, no DOM: exercises the exported close-transition
// helper (the exact body the modal close effect delegates to) with fakes.
//
// RED-FIRST: written before/against the wiring; the first test FAILS if the
// forget call is removed from resetPurchaseModalOnClose (verified by
// temporarily deleting that line → red → restoring → green).
// Residual (documented): if the effect itself stopped calling the helper,
// these tests would still pass — effect wiring is covered by tsc + code
// review + manual QA. The helper is the SOLE forget call site for purchase
// (grep-able).
//
// Run single file:
//   npx vitest run tests/purchaseModalClose.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resetPurchaseModalOnClose,
  forgetPurchaseKey,
} from '../pages/SupplierAccountPage';
import { opKeyStore } from '../utils/opKeyStore';
import { docFingerprint } from '../services/api/opKey';

function purchaseIdentity() {
  return {
    fp: docFingerprint(
      {
        items: [{ id: 'p', buyQuantity: 2, price: 50 }],
        total: 100,
        subtotal: 100,
        supplierId: 's',
      },
      'supplierId',
    ),
    extra: {},
  };
}

beforeEach(() => {
  opKeyStore.clear('purchase');
});

describe('REQ-UI-2: purchase modal close-transition forget', () => {
  it('close idle (true→false, not submitting): reset runs + forget called', async () => {
    const v = await opKeyStore.prepare('purchase', purchaseIdentity());
    expect(v.kind).toBe('fresh');
    const reset = vi.fn();
    const forget = vi.fn();
    const ran = resetPurchaseModalOnClose({
      wasOpen: true, isOpen: false, isSubmitting: false, reset, forgetKey: forget,
    });
    expect(ran).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
    // RED anchor: deleting the forget call below makes this fail.
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('forgetPurchaseKey drops the singleton key memory', async () => {
    const v = await opKeyStore.prepare('purchase', purchaseIdentity());
    expect(v.kind).toBe('fresh');
    expect(opKeyStore.peek('purchase')?.key).not.toBeNull();
    forgetPurchaseKey();
    // Memory-only in node (no sessionStorage): nothing remains.
    expect(opKeyStore.peek('purchase')).toBeNull();
  });

  it('no forget on mount, while open, or during an in-flight submit', () => {
    const reset = vi.fn();
    const forget = vi.fn();
    expect(resetPurchaseModalOnClose({
      wasOpen: false, isOpen: false, isSubmitting: false, reset, forgetKey: forget,
    })).toBe(false);
    expect(resetPurchaseModalOnClose({
      wasOpen: true, isOpen: true, isSubmitting: false, reset, forgetKey: forget,
    })).toBe(false);
    expect(resetPurchaseModalOnClose({
      wasOpen: true, isOpen: false, isSubmitting: true, reset, forgetKey: forget,
    })).toBe(true);
    // Only the submitting-close ran the reset — without the key forget:
    expect(reset).toHaveBeenCalledTimes(1);
    expect(forget).not.toHaveBeenCalled();
  });
});
