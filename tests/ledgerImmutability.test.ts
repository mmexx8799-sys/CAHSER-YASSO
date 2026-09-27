// REQ-RBAC-1 AC-05 — السجلات الدفترية غير قابلة للتعديل لغير الأدمن (SR-05 / BR-04)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/ledgerImmutability.test.ts"

import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { UserRole } from '../types';

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

const LEDGER_COLS = [
  { col: 'invoices', data: { total: 100, subtotal: 100, items: [] } },
  { col: 'returns', data: { total: 50, items: [] } },
  { col: 'customerPayments', data: { customerId: 'c1', amount: 20, date: Date.now() } },
  { col: 'supplierPayments', data: { supplierId: 's1', amount: 30, date: Date.now() } },
  { col: 'purchaseInvoices', data: { total: 200, subtotal: 200, items: [] } },
  { col: 'supplierReturns', data: { total: 60, items: [] } },
];

describe('Ledger immutability — non-admin cannot update ledger docs (SR-05)', () => {
  for (const { col, data } of LEDGER_COLS) {
    it(`cashier create ${col} ALLOWED, update DENIED; admin update ALLOWED`, async () => {
      await testEnv.clearFirestore();
      await seedUser('cashier-ledger', UserRole.Cashier);
      await seedUser('admin-ledger', UserRole.Admin);
      // cashier create should succeed (isStaff)
      const dbCash = testEnv.authenticatedContext('cashier-ledger').firestore();
      await assertSucceeds(setDoc(doc(dbCash, col, `${col}-new`), data));
      // seed a doc to try to update
      await seedDoc(col, `${col}-existing`, data);
      // cashier update -> DENIED
      await assertFails(updateDoc(doc(dbCash, col, `${col}-existing`), { total: 999 } as any));
      // supervisor update -> DENIED
      await seedUser('sup-ledger', UserRole.Supervisor);
      const dbSup = testEnv.authenticatedContext('sup-ledger').firestore();
      await assertFails(updateDoc(doc(dbSup, col, `${col}-existing`), { total: 999 } as any));
      // accountant create already DENIED (tested in matrix), update also DENIED
      await seedUser('acct-ledger', UserRole.Accountant);
      const dbAcct = testEnv.authenticatedContext('acct-ledger').firestore();
      await assertFails(updateDoc(doc(dbAcct, col, `${col}-existing`), { total: 999 } as any));
      // admin update -> ALLOWED (isAdmin)
      const dbAdmin = testEnv.authenticatedContext('admin-ledger').firestore();
      await assertSucceeds(updateDoc(doc(dbAdmin, col, `${col}-existing`), { total: 101 } as any));
      // owner update -> ALLOWED
      await seedUser('owner-ledger', UserRole.Owner);
      const dbOwner = testEnv.authenticatedContext('owner-ledger').firestore();
      await assertSucceeds(updateDoc(doc(dbOwner, col, `${col}-existing`), { total: 102 } as any));
    });
  }
  it('delete is owner-only in R5 (owner can delete; admin/cashier cannot)', async () => {
    await testEnv.clearFirestore();
    await seedUser('cashier-del', UserRole.Cashier);
    await seedUser('admin-del', UserRole.Admin);
    await seedUser('owner-del', UserRole.Owner);
    await seedDoc('invoices', 'inv-del-ledger', { total: 10 });
    const dbCash = testEnv.authenticatedContext('cashier-del').firestore();
    const dbAdmin = testEnv.authenticatedContext('admin-del').firestore();
    const dbOwner = testEnv.authenticatedContext('owner-del').firestore();
    await assertFails(deleteDoc(doc(dbCash, 'invoices', 'inv-del-ledger')));
    await assertFails(deleteDoc(doc(dbAdmin, 'invoices', 'inv-del-ledger')));
    await assertSucceeds(deleteDoc(doc(dbOwner, 'invoices', 'inv-del-ledger')));
  });
});

// TECH-P0-1b — narrow staff exception: return-cap holders may update ONLY
// returnedQuantities on invoices (the atomic counter processReturn bumps inside
// its own transaction). Everything else on the doc stays admin-only.

describe('TECH-P0-1b: invoices.returnedQuantities staff exception', () => {
  it('cashier/supervisor single-key update succeeds; total/multi-key/non-map/accountant still denied', async () => {
    await testEnv.clearFirestore();
    await seedUser('cashier-rq', UserRole.Cashier);
    await seedUser('sup-rq', UserRole.Supervisor);
    await seedUser('acct-rq', UserRole.Accountant);
    await seedDoc('invoices', 'inv-rq', { total: 1000, subtotal: 1000, items: [] });
    const dbCash = testEnv.authenticatedContext('cashier-rq').firestore();
    const dbSup = testEnv.authenticatedContext('sup-rq').firestore();
    const dbAcct = testEnv.authenticatedContext('acct-rq').firestore();

    // Single-key map update — the processReturn write shape — ALLOWED.
    await assertSucceeds(updateDoc(doc(dbCash, 'invoices', 'inv-rq'), { returnedQuantities: { 'prod-1': 6 } }));
    await assertSucceeds(updateDoc(doc(dbSup, 'invoices', 'inv-rq'), { returnedQuantities: { 'prod-1': 8 } }));

    // Same key, non-map value — DENIED by the is-map guard.
    await assertFails(updateDoc(doc(dbCash, 'invoices', 'inv-rq'), { returnedQuantities: 'x' } as any));

    // Mixed with a ledger field — DENIED by hasOnly.
    await assertFails(updateDoc(doc(dbCash, 'invoices', 'inv-rq'), { returnedQuantities: { 'prod-1': 1 }, total: 999 } as any));

    // Plain total touch — DENIED (SR-05 intact).
    await assertFails(updateDoc(doc(dbCash, 'invoices', 'inv-rq'), { total: 999 } as any));

    // Accountant holds no return cap — DENIED even single-key.
    await assertFails(updateDoc(doc(dbAcct, 'invoices', 'inv-rq'), { returnedQuantities: { 'prod-1': 1 } }));
  });
});
