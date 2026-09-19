// REQ-RBAC-1 AC-10 — مصفوفة مولدة من utils/permissions.ts (BR-07)
// لكل (عملية قواعدية × دور) توقع allow/deny — 100% يجب أن ينجح بعد R1
// G0: D-2 (أ) product.create=isStaff, D-6 يبقى supplier.ops=isStaff, D-4 الآن
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/rbacMatrix.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { PERMISSION_MATRIX, type Capability } from '../utils/permissions';
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

// Map capability -> representative firestore write to test Rules enforcement
function opFor(cap: Capability): { col: string; id: string; data: any; kind: 'create' | 'update' | 'delete'; seed?: any } {
  switch (cap) {
    case 'sell': return { col: 'invoices', id: 'inv-matrix', data: { total: 100, subtotal: 100, items: [] }, kind: 'create' };
    case 'return': return { col: 'returns', id: 'ret-matrix', data: { total: 50, items: [] }, kind: 'create' };
    case 'customer.payment': return { col: 'customerPayments', id: 'cpay-matrix', data: { customerId: 'c1', amount: 10, date: Date.now() }, kind: 'create' };
    case 'supplier.ops': return { col: 'purchaseInvoices', id: 'pur-matrix', data: { total: 200, subtotal: 200, items: [] }, kind: 'create' };
    case 'customer.write': return { col: 'customers', id: 'cust-matrix', data: { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() }, kind: 'create' };
    case 'supplier.write': return { col: 'suppliers', id: 'sup-matrix', data: { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() }, kind: 'create' };
    case 'product.create': return { col: 'products', id: 'prod-matrix', data: { name: 'منتج', code: 'C1', quantity: 5, price: 10, categoryId: 'cat1', searchableIndex: [] }, kind: 'create' };
    case 'product.price': return { col: 'products', id: 'prod-price', data: { price: 999 }, kind: 'update', seed: { name: 'منتج', code: 'C1', quantity: 5, price: 10, categoryId: 'cat1', searchableIndex: [] } };
    case 'product.delete': return { col: 'products', id: 'prod-del', data: {}, kind: 'delete', seed: { name: 'منتج', code: 'C1', quantity: 5, price: 10, categoryId: 'cat1', searchableIndex: [] } };
    case 'category.write': return { col: 'categories', id: 'cat-matrix', data: { name: 'تصنيف' }, kind: 'create' };
    case 'settings.write': return { col: 'appSettings', id: 'main', data: { appName: 'X' }, kind: 'create' };
    case 'archive.open': return { col: 'dailyArchives', id: '2026-09-19', data: { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 }, kind: 'create' };
    case 'archive.close': return { col: 'dailyArchives', id: 'arch-close', data: { status: 'closed' }, kind: 'update', seed: { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 } };
    case 'ledger.delete': return { col: 'invoices', id: 'inv-del', data: {}, kind: 'delete', seed: { total: 100, subtotal: 100, items: [] } };
    case 'users.manage': return { col: 'users', id: 'new-user-manage', data: { email: 'new@t.local', role: 'cashier' }, kind: 'create' };
    default: return { col: 'invoices', id: 'fallback', data: { total: 1 }, kind: 'create' };
  }
}

// Capabilities that are UI-only (لا فرض بالقواعد) — لا نختبرها هنا، تُختبر في permissionsParity (R3)
const UI_ONLY: Capability[] = ['dashboard.view', 'report.view', 'statement.export', 'backup.export'];
const DATA_ONLY: Capability[] = ['data.restore', 'data.reset']; // تُختبر عبر ledger.delete في R5
const EXCLUDED = new Set<string>([...UI_ONLY, ...DATA_ONLY]);

describe('RBAC Matrix (generated from utils/permissions.ts) — R1/AC-10', () => {
  const roles: UserRole[] = [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant];
  for (const [cap, row] of Object.entries(PERMISSION_MATRIX) as [Capability, Record<UserRole, boolean>][]) {
    if (EXCLUDED.has(cap)) continue;
    const op = opFor(cap);
    describe(`capability: ${cap} -> ${op.col} ${op.kind}`, () => {
      for (const role of roles) {
        const shouldAllow = row[role];
        it(`${role} ${shouldAllow ? 'ALLOWED' : 'DENIED'} for ${cap}`, async () => {
          await testEnv.clearFirestore();
          const uid = `matrix-${cap}-${role}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          await seedUser(uid, role);
          if (op.seed) await seedDoc(op.col, op.id, op.seed);
          const db = testEnv.authenticatedContext(uid).firestore();
          const ref = doc(db, op.col, op.id);
          let p: Promise<void>;
          if (op.kind === 'create') p = setDoc(ref, op.data);
          else if (op.kind === 'update') p = updateDoc(ref, op.data);
          else p = deleteDoc(ref);
          if (shouldAllow) await assertSucceeds(p);
          else await assertFails(p);
        });
      }
    });
  }
});

// Accountant: zero writes except clientErrors.create — verify representative ops are DENIED
describe('Accountant zero-write (SR-07)', () => {
  it('accountant cannot create invoice/return/payment/product/customer', async () => {
    await testEnv.clearFirestore();
    await seedUser('acct-zero', UserRole.Accountant);
    const db = testEnv.authenticatedContext('acct-zero').firestore();
    await assertFails(setDoc(doc(db, 'invoices', 'a1'), { total: 10 }));
    await assertFails(setDoc(doc(db, 'returns', 'a2'), { total: 10 }));
    await assertFails(setDoc(doc(db, 'customerPayments', 'a3'), { customerId: 'c1', amount: 10, date: Date.now() }));
    await assertFails(setDoc(doc(db, 'products', 'a4'), { name: 'x', code: 'X', quantity: 1, price: 1, categoryId: 'c', searchableIndex: [] }));
  });
});
