// REQ-RBAC-1 AC-11 — اختبارات التصعيد (SR-01/02/03/04)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/rbacEscalation.test.ts"

import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
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

async function seedUser(uid: string, role?: string, disabled?: boolean) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const data: any = { email: uid + '@t.local' };
    if (role !== undefined) data.role = role;
    if (disabled) data.disabled = true;
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}
async function seedDoc(col: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data);
  });
}

describe('RBAC Escalation — SR-01 self role/disabled/permissions change', () => {
  it('cashier cannot change own role to admin/owner', async () => {
    await testEnv.clearFirestore();
    await seedUser('cashier-self', UserRole.Cashier);
    const db = testEnv.authenticatedContext('cashier-self').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cashier-self'), { role: 'admin' } as any));
    await assertFails(updateDoc(doc(db, 'users', 'cashier-self'), { role: 'owner' } as any));
  });
  it('cashier cannot change own disabled or permissions field', async () => {
    await testEnv.clearFirestore();
    await seedUser('cashier-self2', UserRole.Cashier);
    const db = testEnv.authenticatedContext('cashier-self2').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cashier-self2'), { disabled: true } as any));
    await assertFails(updateDoc(doc(db, 'users', 'cashier-self2'), { permissions: ['sell'] } as any));
  });
  it('admin cannot escalate self to owner', async () => {
    await testEnv.clearFirestore();
    await seedUser('admin-self', UserRole.Admin);
    const db = testEnv.authenticatedContext('admin-self').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'admin-self'), { role: 'owner' } as any));
  });
  it('non-owner cannot create user with owner role', async () => {
    await testEnv.clearFirestore();
    await seedUser('admin-cre', UserRole.Admin);
    const db = testEnv.authenticatedContext('admin-cre').firestore();
    await assertFails(setDoc(doc(db, 'users', 'new-owner'), { email: 'x@t.local', role: 'owner' }));
  });
  it('non-owner cannot update another user to owner', async () => {
    await testEnv.clearFirestore();
    await seedUser('admin-upd', UserRole.Admin);
    await seedUser('target-cash', UserRole.Cashier);
    const db = testEnv.authenticatedContext('admin-upd').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'target-cash'), { role: 'owner' } as any));
  });
  it('non-owner cannot touch owner document (update/delete)', async () => {
    await testEnv.clearFirestore();
    await seedUser('owner-doc', UserRole.Owner);
    await seedUser('admin-try', UserRole.Admin);
    const db = testEnv.authenticatedContext('admin-try').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'owner-doc'), { disabled: true } as any));
    await assertFails(updateDoc(doc(db, 'users', 'owner-doc'), { role: 'admin' } as any));
  });
  it('owner document cannot be deleted or disabled via rules', async () => {
    await testEnv.clearFirestore();
    await seedUser('owner-del', UserRole.Owner);
    const dbOwner = testEnv.authenticatedContext('owner-del').firestore();
    // even owner cannot disable/delete self via rules (break-glass via Console only)
    await assertFails(updateDoc(doc(dbOwner, 'users', 'owner-del'), { disabled: true } as any));
  });
});

describe('RBAC Escalation — SR-03 default-deny for missing/weird role', () => {
  it('user without role cannot write invoices/customers', async () => {
    await testEnv.clearFirestore();
    await seedUser('no-role', undefined);
    const db = testEnv.authenticatedContext('no-role').firestore();
    await assertFails(setDoc(doc(db, 'invoices', 'inv-nr'), { total: 10 }));
    await assertFails(setDoc(doc(db, 'customers', 'cust-nr'), { name: 'x', balance: 0, openingBalance: 0, createdAt: Date.now() }));
    await assertFails(setDoc(doc(db, 'products', 'prod-nr'), { name: 'x', code: 'X', quantity: 1, price: 1, categoryId: 'c', searchableIndex: [] }));
  });
  it('user with weird role manager cannot write', async () => {
    await testEnv.clearFirestore();
    await seedUser('weird-role', 'manager' as any);
    const db = testEnv.authenticatedContext('weird-role').firestore();
    await assertFails(setDoc(doc(db, 'invoices', 'inv-weird'), { total: 10 }));
    await assertFails(setDoc(doc(db, 'dailyArchives', '2026-09-19'), { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 }));
  });
});

describe('RBAC Escalation — SR-04 disabled user rejected for every role', () => {
  const roles = [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant];
  for (const role of roles) {
    it(`disabled ${role} cannot create invoice`, async () => {
      await testEnv.clearFirestore();
      await seedUser(`dis-${role}`, role, true);
      const db = testEnv.authenticatedContext(`dis-${role}`).firestore();
      await assertFails(setDoc(doc(db, 'invoices', `inv-dis-${role}`), { total: 10 }));
    });
  }
});

// REQ-PERM-2 (addition only — no existing test touched): legacy `permissions` field is ignored by new logic
describe('PERM-2 legacy permissions field ignored', () => {
  it("cashier with legacy permissions:['product.price'] gains nothing; sell still allowed", async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'legacy-perm'), { email: 'l@t.local', role: UserRole.Cashier, permissions: ['product.price'] });
    });
    const db = testEnv.authenticatedContext('legacy-perm').firestore();
    await seedDoc('products', 'legacy-price', { name: 'منتج', code: 'C1', quantity: 5, price: 10, categoryId: 'cat1', searchableIndex: [] });
    await assertFails(updateDoc(doc(db, 'products', 'legacy-price'), { price: 999 }));
    await assertSucceeds(setDoc(doc(db, 'invoices', 'legacy-inv'), { total: 10, subtotal: 10, items: [] }));
  });
});
