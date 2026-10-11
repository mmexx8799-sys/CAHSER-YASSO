// REV1-4 T4.1 — pre-network finite guards (NaN/Infinity/-Infinity).
//
// RED-FIRST on UNFIXED code under a STOP-AFTER-GUARD mock: `assertOnline`
// (sole import source `../services/api/core` for all four services) is
// replaced by a vi.fn that throws, so reaching the network gate is
// observable. Invalid inputs must throw the VERBATIM Arabic message AND
// must never reach the gate; valid controls must terminate AT the gate.
// No emulator, no network wait.
//
// Services import the mocked module lazily below so the mock is armed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentMethod, type CartItem } from '../types';

const STOP = 'STOP-AFTER-GUARD';

vi.mock('../services/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/core')>();
  return {
    ...actual,
    // Literal duplicated (not the STOP const): mock factories must not
    // close over module-scope bindings (hoisting/TDZ).
    assertOnline: vi.fn(async () => {
      throw new Error('STOP-AFTER-GUARD');
    }),
  };
});

const { processSale, processPurchase, addCustomerPayment, addSupplierPayment } =
  await import('../services/api');
const coreMocked = await import('../services/api/core');
const assertOnlineMock = vi.mocked(coreMocked.assertOnline);

beforeEach(() => {
  assertOnlineMock.mockClear();
});

function saleItem(): CartItem {
  return {
    id: 'rev14-prod',
    code: 'rev14-prod',
    name: 'صنف',
    price: 100,
    quantity: 1000,
    categoryId: 'rev14-cat',
    createdAt: 1,
    searchableIndex: [],
    buyQuantity: 1,
    priceType: 'retail',
  };
}

const NANV = Number.NaN;
const INF = Infinity;
const NINF = -Infinity;

describe('REV1-4 T4.1 — sale subtotal/total finiteness (pre-network)', () => {
  it.each([
    ['subtotal NaN', 'subtotal', NANV],
    ['subtotal Infinity', 'subtotal', INF],
    ['subtotal -Infinity', 'subtotal', NINF],
    ['total NaN', 'total', NANV],
    ['total Infinity', 'total', INF],
    ['total -Infinity', 'total', NINF],
  ] as Array<[string, 'subtotal' | 'total', number]>)('%s ⇒ Arabic + gate untouched', async (
    _label,
    field,
    value,
  ) => {
    const expected =
      field === 'subtotal' ? 'الإجمالي الفرعي للبيع غير صالح' : 'المبلغ النهائي للبيع غير صالح';
    const call = processSale({
      items: [saleItem()],
      subtotal: field === 'subtotal' ? value : 100,
      discount: 0,
      total: field === 'total' ? value : 100,
      paymentMethod: PaymentMethod.Cash,
      dailyArchiveId: 'rev14-day',
    });
    await expect(call).rejects.toThrow(expected);
    expect(assertOnlineMock).not.toHaveBeenCalled();
  });
});

describe('REV1-4 T4.1 — purchase subtotal/total finiteness (pre-network)', () => {
  it.each([
    ['subtotal NaN', 'subtotal', NANV],
    ['subtotal Infinity', 'subtotal', INF],
    ['subtotal -Infinity', 'subtotal', NINF],
    ['total NaN', 'total', NANV],
    ['total Infinity', 'total', INF],
    ['total -Infinity', 'total', NINF],
  ] as Array<[string, 'subtotal' | 'total', number]>)('%s ⇒ Arabic + gate untouched', async (
    _label,
    field,
    value,
  ) => {
    const expected =
      field === 'subtotal'
        ? 'الإجمالي الفرعي لفاتورة الشراء غير صالح'
        : 'إجمالي فاتورة الشراء غير صالح';
    const call = processPurchase({
      items: [saleItem()],
      subtotal: field === 'subtotal' ? value : 100,
      total: field === 'total' ? value : 100,
      supplierId: 'rev14-sup',
    });
    await expect(call).rejects.toThrow(expected);
    expect(assertOnlineMock).not.toHaveBeenCalled();
  });
});

describe('REV1-4 T4.1 — payment amount finiteness (pre-network)', () => {
  it.each([
    ['customer NaN', 'customer', NANV],
    ['customer Infinity', 'customer', INF],
    ['customer -Infinity', 'customer', NINF],
    ['supplier NaN', 'supplier', NANV],
    ['supplier Infinity', 'supplier', INF],
    ['supplier -Infinity', 'supplier', NINF],
  ] as Array<[string, 'customer' | 'supplier', number]>)('%s ⇒ Arabic + gate untouched', async (
    _label,
    party,
    value,
  ) => {
    const call =
      party === 'customer'
        ? addCustomerPayment({ customerId: 'rev14-cust', amount: value })
        : addSupplierPayment({ supplierId: 'rev14-sup', amount: value });
    await expect(call).rejects.toThrow('قيمة الدفعة غير صالحة');
    expect(assertOnlineMock).not.toHaveBeenCalled();
  });
});

describe('REV1-4 T4.1 — finite controls reach the gate (valid inputs)', () => {
  it.each([
    ['sale total 0', 'sale', 0],
    ['sale total 19.99', 'sale', 19.99],
    ['sale total 100', 'sale', 100],
    ['purchase total 0', 'purchase', 0],
    ['purchase total 19.99', 'purchase', 19.99],
    ['purchase total 100', 'purchase', 100],
    ['customer amount 0', 'customer', 0],
    ['customer amount 19.99', 'customer', 19.99],
    ['customer amount 100', 'customer', 100],
    ['supplier amount 0', 'supplier', 0],
    ['supplier amount 19.99', 'supplier', 19.99],
    ['supplier amount 100', 'supplier', 100],
  ] as Array<[string, 'sale' | 'purchase' | 'customer' | 'supplier', number]>)(
    '%s ⇒ STOP-AFTER-GUARD',
    async (_label, site, value) => {
      let call: Promise<unknown>;
      if (site === 'sale') {
        call = processSale({
          items: [saleItem()],
          subtotal: value,
          discount: 0,
          total: value,
          paymentMethod: PaymentMethod.Cash,
          dailyArchiveId: 'rev14-day',
        });
      } else if (site === 'purchase') {
        call = processPurchase({
          items: [saleItem()],
          subtotal: value,
          total: value,
          supplierId: 'rev14-sup',
        });
      } else if (site === 'customer') {
        call = addCustomerPayment({ customerId: 'rev14-cust', amount: value });
      } else {
        call = addSupplierPayment({ supplierId: 'rev14-sup', amount: value });
      }
      await expect(call).rejects.toThrow(STOP);
    },
  );
});
