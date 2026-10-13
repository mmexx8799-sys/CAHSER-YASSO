// P0-HARDENING — RED-first negative tests for Firestore rules (Emulator, direct SDK writes).
// REQ-CLOSE-1: moneyOk-only scope — amount/cap guards + unauth/product/update/delete locks.
// Covers: unauth(4) + product-prices(9) + invoices(8) + returns(8) + payments(7)
// + balance-exception(3) = 39. Shape tests removed per owner decision 2026-10-13.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0Hardening.test.ts"
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

async function seedUser(uid: string, role: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role });
  });
}
async function seedDoc(col: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data);
  });
}
const dbFor = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

const baseProduct = (qty = 20) => ({
  name: 'صنف', code: 'C1', categoryId: 'cat1', quantity: qty,
  price: 100, retailCashPrice: 100, retailCreditPrice: 100,
  wholesaleCashPrice: 100, wholesaleCreditPrice: 100,
});
const legitInvoice = () => ({
  items: [{ id: 'p1', name: 'صنف', buyQuantity: 1, price: 100 }],
  subtotal: 100, discount: 0, total: 100, paymentMethod: 'نقدا',
  dailyArchiveId: '2026-10-12', invoiceNumber: 'INV-000001', createdAt: serverTimestamp(),
});
const legitReturn = () => ({
  items: [{ id: 'p1', name: 'صنف', buyQuantity: 1, price: 100 }],
  total: 100, dailyArchiveId: '2026-10-12', returnNumber: 'RET-000001', createdAt: serverTimestamp(),
});
const legitCustPay = () => ({ customerId: 'c1', amount: 50, date: serverTimestamp() });
const legitSupPay = () => ({ supplierId: 's1', amount: 50, date: serverTimestamp() });

describe('P0-A unauthenticated writes denied (4)', () => {
  it('A1 anon cannot write products', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anonDb(), 'products', 'x'), baseProduct()));
  });
  it('A2 anon cannot write invoices', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anonDb(), 'invoices', 'x'), legitInvoice()));
  });
  it('A3 anon cannot write returns', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anonDb(), 'returns', 'x'), legitReturn()));
  });
  it('A4 anon cannot write payments', async () => {
    await testEnv.clearFirestore();
    await assertFails(setDoc(doc(anonDb(), 'customerPayments', 'x'), legitCustPay()));
  });
});

describe('P0-B product price protection for staff (9)', () => {
  it('B1 cashier cannot change price alone', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { price: 1 }));
  });
  it('B2 cashier cannot change retailCashPrice alone', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { retailCashPrice: 1 }));
  });
  it('B3 bundled quantity+price change denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { quantity: 40, wholesaleCreditPrice: 1 } as any));
  });
  it('B4 mixed name+price change denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { name: 'جديد', price: 5 } as any));
  });
  it('B5 quantity-only change allowed', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertSucceeds(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { quantity: 15 }));
  });
  it('B6 negative quantity denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(updateDoc(doc(dbFor('c-b'), 'products', 'pb1'), { quantity: -5 }));
  });
  it('B7 owner price change allowed', async () => {
    await testEnv.clearFirestore();
    await seedUser('o-b', 'owner'); await seedDoc('products', 'pb1', baseProduct());
    await assertSucceeds(updateDoc(doc(dbFor('o-b'), 'products', 'pb1'), { price: 150 }));
  });
  it('B8 cashier create with price denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-b'), 'products', 'pb-new'), { ...baseProduct(), price: 80 }));
  });
  it('B9 cashier delete denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-b', 'cashier'); await seedDoc('products', 'pb1', baseProduct());
    await assertFails(deleteDoc(doc(dbFor('c-b'), 'products', 'pb1')));
  });
});

describe('P0-C invoices create-guard (8)', () => {
  it('C1 legit invoice create succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-c'), 'invoices', 'inv-ok'), legitInvoice()));
  });
  it('C2 negative total denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-c'), 'invoices', 'inv-neg'), { ...legitInvoice(), total: -5 }));
  });
  it('C5 missing total denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    const noTotal: any = { ...legitInvoice() };
    delete noTotal.total;
    await assertFails(setDoc(doc(dbFor('c-c'), 'invoices', 'inv-nototal'), noTotal));
  });
  it('C6 subtotal negative denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-c'), 'invoices', 'inv-sub'), { ...legitInvoice(), subtotal: -1 }));
  });
  it('C9 cashier update total denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    await seedDoc('invoices', 'inv-ex', legitInvoice());
    await assertFails(updateDoc(doc(dbFor('c-c'), 'invoices', 'inv-ex'), { total: 999 } as any));
  });
  it('C10 admin update allowed', async () => {
    await testEnv.clearFirestore(); await seedUser('a-c', 'admin');
    await seedDoc('invoices', 'inv-ex', legitInvoice());
    await assertSucceeds(updateDoc(doc(dbFor('a-c'), 'invoices', 'inv-ex'), { total: 101 }));
  });
  it('C11 cashier delete denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-c', 'cashier');
    await seedDoc('invoices', 'inv-ex', legitInvoice());
    await assertFails(deleteDoc(doc(dbFor('c-c'), 'invoices', 'inv-ex')));
  });
  it('C12 accountant create denied', async () => {
    await testEnv.clearFirestore(); await seedUser('acct-c', 'accountant');
    await assertFails(setDoc(doc(dbFor('acct-c'), 'invoices', 'inv-acct'), legitInvoice()));
  });
});

describe('P0-D returns create-guard (8)', () => {
  it('D1 legit return create succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-d'), 'returns', 'ret-ok'), legitReturn()));
  });
  it('D2 negative total denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-d'), 'returns', 'ret-neg'), { ...legitReturn(), total: -5 }));
  });
  it('D5 missing total denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    const noTotal: any = { ...legitReturn() };
    delete noTotal.total;
    await assertFails(setDoc(doc(dbFor('c-d'), 'returns', 'ret-nototal'), noTotal));
  });
  it('D7 linked return with originalInvoiceId succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-d'), 'returns', 'ret-link'), { ...legitReturn(), originalInvoiceId: 'inv1', customerId: 'c1' }));
  });
  it('D9 cashier update denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await seedDoc('returns', 'ret-ex', legitReturn());
    await assertFails(updateDoc(doc(dbFor('c-d'), 'returns', 'ret-ex'), { total: 999 } as any));
  });
  it('D10 admin update allowed', async () => {
    await testEnv.clearFirestore(); await seedUser('a-d', 'admin');
    await seedDoc('returns', 'ret-ex', legitReturn());
    await assertSucceeds(updateDoc(doc(dbFor('a-d'), 'returns', 'ret-ex'), { total: 101 }));
  });
  it('D11 purchase invoice legit create succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-d'), 'purchaseInvoices', 'pur-ok'),
      { items: [{ id: 'p1', buyQuantity: 2, price: 50 }], subtotal: 100, total: 100, supplierId: 's1', invoiceNumber: 'PUR-000001', createdAt: serverTimestamp() }));
  });
  it('D12 supplier return legit create succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-d', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-d'), 'supplierReturns', 'sret-ok'),
      { items: [{ id: 'p1', buyQuantity: 1, price: 50 }], total: 50, supplierId: 's1', returnNumber: 'SRET-000001', createdAt: serverTimestamp() }));
  });
});

describe('P0-E payments create-guard (7)', () => {
  it('E1 legit customer payment succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-e'), 'customerPayments', 'pay-ok'), legitCustPay()));
  });
  it('E2 zero amount denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-e'), 'customerPayments', 'pay-zero'), { ...legitCustPay(), amount: 0 }));
  });
  it('E3 negative amount denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-e'), 'customerPayments', 'pay-neg'), { ...legitCustPay(), amount: -10 }));
  });
  it('E6 legit supplier payment succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-e'), 'supplierPayments', 'spay-ok'), legitSupPay()));
  });
  it('E7 supplier zero denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertFails(setDoc(doc(dbFor('c-e'), 'supplierPayments', 'spay-zero'), { ...legitSupPay(), amount: 0 }));
  });
  it('E9 payment with notes succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await assertSucceeds(setDoc(doc(dbFor('c-e'), 'customerPayments', 'pay-notes'), { ...legitCustPay(), notes: 'تحصيل' }));
  });
  it('E10 cashier update payment denied', async () => {
    await testEnv.clearFirestore(); await seedUser('c-e', 'cashier');
    await seedDoc('customerPayments', 'pay-ex', legitCustPay());
    await assertFails(updateDoc(doc(dbFor('c-e'), 'customerPayments', 'pay-ex'), { amount: 999 } as any));
  });
});

describe('P0-F balance exception isolation RA-01 (3)', () => {
  it('F1 balance-only update allowed for staff', async () => {
    await testEnv.clearFirestore(); await seedUser('c-f', 'cashier');
    await seedDoc('customers', 'cust1', { name: 'عميل', balance: 100, openingBalance: 0 });
    await assertSucceeds(updateDoc(doc(dbFor('c-f'), 'customers', 'cust1'), { balance: 150 }));
  });
  it('F2 documents customer.write behavior: cashier name+balance update succeeds', async () => {
    // Documentary (D-P7 intended rule): cashier holds customer.write, so the
    // profile branch allows name+balance together; only openingBalance is frozen.
    await testEnv.clearFirestore(); await seedUser('c-f', 'cashier');
    await seedDoc('customers', 'cust1', { name: 'عميل', balance: 100, openingBalance: 0 });
    await assertSucceeds(updateDoc(doc(dbFor('c-f'), 'customers', 'cust1'), { balance: 150, name: 'عميل محدث' }));
  });
  it('F3 openingBalance change denied for staff', async () => {
    await testEnv.clearFirestore(); await seedUser('c-f', 'cashier');
    await seedDoc('customers', 'cust1', { name: 'عميل', balance: 100, openingBalance: 0 });
    await assertFails(updateDoc(doc(dbFor('c-f'), 'customers', 'cust1'), { openingBalance: 500 } as any));
  });
});
