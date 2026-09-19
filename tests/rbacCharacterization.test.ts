// REQ-RBAC-1 AC-12 — اختبارات توصيف المخاطرة المقبولة (SR-08)
// كتابة balance داخل معاملة بيع آجل من كاشير تبقى تنجح — موثقة بالاختبار وتكسر إن حاول أحد تشديدًا يكسر processSale (درس REQ-P0-2)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/rbacCharacterization.test.ts"

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
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

describe('RBAC Characterization — Accepted Risk (SR-08)', () => {
  it('cashier writes customers.balance inside a sale transaction — SUCCESS (Accepted Risk)', async () => {
    await testEnv.clearFirestore();
    await seedUser('cashier-char', UserRole.Cashier);
    await seedDoc('customers', 'cust-char', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await seedDoc('products', 'prod-char', { name: 'منتج', code: 'C1', quantity: 10, price: 50, categoryId: 'cat1', searchableIndex: [] });
    await seedDoc('dailyArchives', '2026-09-19', { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 });

    const db = testEnv.authenticatedContext('cashier-char').firestore();
    // Simulate processSale transaction: update customer balance + decrement product quantity + create invoice
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const custRef = doc(db, 'customers', 'cust-char');
        const prodRef = doc(db, 'products', 'prod-char');
        const invRef = doc(db, 'invoices', 'inv-char');
        const custSnap = await tx.get(custRef);
        const prodSnap = await tx.get(prodRef);
        if (!custSnap.exists() || !prodSnap.exists()) throw new Error('missing');
        tx.update(custRef, { balance: (custSnap.data() as any).balance + 50 });
        tx.update(prodRef, { quantity: (prodSnap.data() as any).quantity - 1 });
        tx.set(invRef, { total: 50, subtotal: 50, items: [], paymentMethod: 'آجل', customerId: 'cust-char', dailyArchiveId: '2026-09-19' });
      })
    );

    // Verify balance actually moved (read via same authenticated context — isActiveUser can read)
    const afterSnap = await getDoc(doc(db, 'customers', 'cust-char'));
    const after = afterSnap.data() as any;
    expect(after).toBeDefined();
    expect(after.balance).toBe(150);
  });

  it('accountant direct balance write is still DENIED? No — accountant cannot write customers at all (SR-07), but cashier balance write is the risk', async () => {
    // This documents the asymmetry: accountant is blocked on all writes, but staff balance write is allowed.
    // If someone tries to "fix" balance by denying it for cashiers, this test will FAIL and signal breakage of processSale.
    await testEnv.clearFirestore();
    await seedUser('acct-char', UserRole.Accountant);
    await seedDoc('customers', 'cust-acct', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    const db = testEnv.authenticatedContext('acct-char').firestore();
    // accountant customer update should fail (SR-07) — not the characterization itself, just sanity
    const { assertFails } = await import('@firebase/rules-unit-testing');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'customers', 'cust-acct'), { balance: 0 } as any));
  });
});
