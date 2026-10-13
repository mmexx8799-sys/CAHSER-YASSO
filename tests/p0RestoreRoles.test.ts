// P0-VERIFY-RR — Step 1 (tests only, no prod change).
// Payload sources (cashier full shapes mirror prod writes exactly):
//  invoices: POSPage.tsx:235-243 + sales.ts:153-158 (createdAt=serverTimestamp→Timestamp)
//  returns: returns.ts:215-224 (createdAt=serverTimestamp)
//  customerPayments: CustomerAccountPage.tsx:126 + customers.ts:181 (date=serverTimestamp)
//  supplierPayments: SupplierAccountPage.tsx:132 + suppliers.ts:180 (date=serverTimestamp)
//  purchaseInvoices: SupplierAccountPage.tsx:1076-1086 + purchases.ts:138-147
//  supplierReturns: purchases.ts:263-271
// NOTE: returnedQuantities is update-only (returns.ts:230 transaction.update;
// rules:178-180 update branch) — excluded from create shapes (item 5).
// Expected BEFORE rules change: RR-a + RR-control GREEN; rest RED.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0RestoreRoles.test.ts"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

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
// v1 backup shapes: minimal keys, epoch-millis dates, no dailyArchiveId.
const V1: Record<string, () => any> = {
  invoices: () => ({ total: 100, subtotal: 100, items: [], createdAt: Date.now() }),
  returns: () => ({ total: 40, items: [], createdAt: Date.now() }),
  customerPayments: () => ({ customerId: 'c1', amount: 25, date: Date.now() }),
  supplierPayments: () => ({ supplierId: 's1', amount: 25, date: Date.now() }),
  purchaseInvoices: () => ({ items: [], subtotal: 200, total: 200, supplierId: 's1', createdAt: Date.now() }),
  supplierReturns: () => ({ items: [], total: 60, supplierId: 's1', createdAt: Date.now() }),
};
// Full modern shapes exactly as the app writes (serverTimestamp = Timestamp).
const FULL: Record<string, () => any> = {
  invoices: () => ({
    items: [{ id: 'p1', name: 'صنف', buyQuantity: 1, price: 100 }],
    subtotal: 100, discount: 0, total: 100, paymentMethod: 'نقدا', customerId: 'c1',
    dailyArchiveId: '2026-10-12', invoiceNumber: 'INV-000001', createdAt: serverTimestamp(),
  }),
  returns: () => ({
    items: [{ id: 'p1', name: 'صنف', buyQuantity: 1, price: 100 }],
    total: 100, returnNumber: 'RET-000001', createdAt: serverTimestamp(),
    dailyArchiveId: '2026-10-12', customerId: 'c1', customerName: 'عميل', originalInvoiceId: 'inv1',
  }),
  customerPayments: () => ({ customerId: 'c1', amount: 50, notes: 'تحصيل', date: serverTimestamp() }),
  supplierPayments: () => ({ supplierId: 's1', amount: 50, notes: 'سداد', date: serverTimestamp() }),
  purchaseInvoices: () => ({
    invoiceNumber: 'PUR-000001', items: [{ id: 'p1', buyQuantity: 2, price: 50 }],
    subtotal: 100, total: 100, supplierId: 's1', supplierName: 'مورد',
    priceFlagged: false, createdAt: serverTimestamp(),
  }),
  supplierReturns: () => ({
    items: [{ id: 'p1', buyQuantity: 1, price: 50 }], total: 50, returnNumber: 'SRET-000001',
    supplierId: 's1', supplierName: 'مورد', createdAt: serverTimestamp(),
  }),
};
const COLS = Object.keys(V1);
const NEG: Record<string, () => any> = {
  invoices: () => ({ ...FULL.invoices(), total: -5 }),
  returns: () => ({ ...FULL.returns(), total: -5 }),
  customerPayments: () => ({ ...FULL.customerPayments(), amount: 0 }),
  supplierPayments: () => ({ ...FULL.supplierPayments(), amount: -1 }),
  purchaseInvoices: () => ({ ...FULL.purchaseInvoices(), total: -5 }),
  supplierReturns: () => ({ ...FULL.supplierReturns(), total: -5 }),
};

describe('P0-VERIFY-RR-a owner succeeds with v1 shape (must keep working)', () => {
  for (const col of COLS) {
    it(`RR-a ${col}: owner succeeds`, async () => {
      await testEnv.clearFirestore(); await seedUser('owner-rr', 'owner');
      const db = testEnv.authenticatedContext('owner-rr').firestore();
      await assertSucceeds(setDoc(doc(db, col, `rr-v1-owner-${col}`), V1[col]()));
    });
  }
});

describe('P0-VERIFY-RR-control cashier full modern shape succeeds (must keep working)', () => {
  for (const col of COLS) {
    it(`RR-control ${col}: cashier succeeds`, async () => {
      await testEnv.clearFirestore(); await seedUser('cashier-ctl', 'cashier');
      const db = testEnv.authenticatedContext('cashier-ctl').firestore();
      await assertSucceeds(setDoc(doc(db, col, `rr-full-cashier-${col}`), FULL[col]()));
    });
  }
});

describe('P0-VERIFY-RR-c owner bound by amount guards (RED now)', () => {
  for (const col of COLS) {
    it(`RR-c ${col}: owner negative denied`, async () => {
      await testEnv.clearFirestore(); await seedUser('owner-rrc', 'owner');
      const db = testEnv.authenticatedContext('owner-rrc').firestore();
      await assertFails(setDoc(doc(db, col, `rr-neg-owner-${col}`), NEG[col]()));
    });
  }
});

describe('P0-VERIFY-RR-cap upper bound denied for cashier AND owner (RED now)', () => {
  for (const role of ['cashier', 'owner']) {
    for (const val of [Infinity, 1000000000000]) {
      it(`RR-cap invoices total=${val} ${role} denied`, async () => {
        await testEnv.clearFirestore(); await seedUser(`u-cap-${role}`, role);
        const db = testEnv.authenticatedContext(`u-cap-${role}`).firestore();
        await assertFails(setDoc(doc(db, 'invoices', `rr-cap-${role}-${val}`), { ...FULL.invoices(), total: val }));
      });
      it(`RR-cap customerPayments amount=${val} ${role} denied`, async () => {
        await testEnv.clearFirestore(); await seedUser(`u-cap-${role}`, role);
        const db = testEnv.authenticatedContext(`u-cap-${role}`).firestore();
        await assertFails(setDoc(doc(db, 'customerPayments', `rr-capay-${role}-${val}`), { ...FULL.customerPayments(), amount: val }));
      });
    }
  }
});

// Upper bound extended: total/amount caps bind cashier AND owner on all six (RED now).
const CAPEXT: Record<string, (v: number) => any> = {
  returns: (v) => ({ ...FULL.returns(), total: v }),
  purchaseInvoices: (v) => ({ ...FULL.purchaseInvoices(), total: v }),
  supplierReturns: (v) => ({ ...FULL.supplierReturns(), total: v }),
  supplierPayments: (v) => ({ ...FULL.supplierPayments(), amount: v }),
};
describe('P0-VERIFY-RR-cap-ext upper bound on remaining four (RED now)', () => {
  for (const col of Object.keys(CAPEXT)) {
    for (const role of ['cashier', 'owner']) {
      for (const val of [Infinity, 1000000000000]) {
        it(`RR-cap-ext ${col}=${val} ${role} denied`, async () => {
          await testEnv.clearFirestore(); await seedUser(`u-capx-${role}`, role);
          const db = testEnv.authenticatedContext(`u-capx-${role}`).firestore();
          await assertFails(setDoc(doc(db, col, `rr-capx-${col}-${role}-${val}`), CAPEXT[col](val)));
        });
      }
    }
  }
});

describe('P0-VERIFY-RR-subinf subtotal/discount Infinity denied (RED now)', () => {
  for (const role of ['cashier', 'owner']) {
    it(`RR-subinf subtotal=Infinity ${role} denied`, async () => {
      await testEnv.clearFirestore(); await seedUser(`u-sub-${role}`, role);
      const db = testEnv.authenticatedContext(`u-sub-${role}`).firestore();
      await assertFails(setDoc(doc(db, 'invoices', `rr-sub-${role}`), { ...FULL.invoices(), subtotal: Infinity, total: 100 }));
    });
    it(`RR-subinf discount=Infinity ${role} denied`, async () => {
      await testEnv.clearFirestore(); await seedUser(`u-sub-${role}`, role);
      const db = testEnv.authenticatedContext(`u-sub-${role}`).firestore();
      await assertFails(setDoc(doc(db, 'invoices', `rr-disc-${role}`), { ...FULL.invoices(), discount: Infinity }));
    });
  }
});

// Update paths unchanged (GREEN locks, before and after).
describe('P0-VERIFY-RR-upd update branches unchanged', () => {
  it('RR-upd cashier returnedQuantities-only update succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('cashier-rq2', 'cashier');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invoices', 'rr-rq'), FULL.invoices());
    });
    const db = testEnv.authenticatedContext('cashier-rq2').firestore();
    await assertSucceeds(updateDoc(doc(db, 'invoices', 'rr-rq'), { returnedQuantities: { 'p1': 1 } }));
  });
  it('RR-upd admin total update succeeds', async () => {
    await testEnv.clearFirestore(); await seedUser('admin-rq2', 'admin');
    const db = testEnv.authenticatedContext('admin-rq2').firestore();
    await assertSucceeds(setDoc(doc(db, 'invoices', 'rr-adm'), FULL.invoices()));
    await assertSucceeds(updateDoc(doc(db, 'invoices', 'rr-adm'), { total: 120 }));
  });
});

describe('P0-VERIFY-RR-perf owner restore batch timing (informational measurement, not a gate)', () => {
  it('RR-perf 500 owner v1 creates all succeed; timing logged only', async () => {
    await testEnv.clearFirestore(); await seedUser('owner-perf', 'owner');
    const db = testEnv.authenticatedContext('owner-perf').firestore();
    const t0 = Date.now();
    let ok = 0;
    for (let i = 0; i < 500; i++) {
      await setDoc(doc(db, 'invoices', `rr-perf-${i}`), V1.invoices());
      ok++;
    }
    const totalMs = Date.now() - t0;
    console.log(`RR-perf owner 500 creates: ok=${ok} totalMs=${totalMs} avgPerDoc=${(totalMs / 500).toFixed(1)}ms (timing only — pass/fail is ok==500)`);
    expect(ok).toBe(500);
  });
});
