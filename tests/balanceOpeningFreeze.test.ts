// REQ-SEC1-8 Phase 0 — openingBalance freeze + amount/total guards (Rules only, Firebase Emulator)
//
// Rules under test (firestore.rules):
//   - customers/suppliers: read+create open to active users; update denies any
//     openingBalance change for non-admins (balance itself stays writable —
//     BUG-P0-2 residual, documented below, full fix needs Cloud Functions/Blaze).
//   - invoices/returns/purchaseInvoices/supplierReturns: create+update require
//     total >= 0.
//   - customerPayments/supplierPayments: create+update require amount > 0.
//
// Legitimate paths untouched: addCustomer/addSupplier set openingBalance once
// at create; updateCustomerProfile/updateSupplierProfile write name/phone/
// address only; the six balance transactions write balance only.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/balanceOpeningFreeze.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// --- Helpers ----------------------------------------------------------------

async function seedActiveUser(uid: string, role?: string) {
  // users/{uid} create is admin-only in the rules → seed with rules disabled
  // (mirrors how a real admin provisions accounts before first use).
  // RBAC-2026-09: default to cashier when no role passed (legacy tests assumed active user without role)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role: role ?? 'cashier' });
  });
}

function mkCustomer(balance = 500, openingBalance = 200) {
  return {
    name: 'عميل اختبار',
    phone: '010',
    address: 'القاهرة',
    balance,
    openingBalance,
    createdAt: Date.now(),
  };
}

function mkSupplier(balance = 700, openingBalance = 300) {
  return {
    name: 'مورد اختبار',
    phone: '010',
    address: 'القاهرة',
    balance,
    openingBalance,
    createdAt: Date.now(),
  };
}

async function seedDoc(collectionPath: string, docId: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

async function readField(db: any, collectionPath: string, docId: string, field: string) {
  const snap = await getDoc(doc(db, collectionPath, docId));
  return snap.exists() ? (snap.data() as any)[field] : undefined;
}

// --- AC-01: openingBalance frozen for cashiers, open for admins --------------

describe('REQ-SEC1-8 Phase 0: openingBalance freeze (AC-01)', () => {
  it('AC-01: cashier direct openingBalance overwrite is rejected (customers)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8a');
    await seedDoc('customers', 'cust-sec8-1', mkCustomer());
    const db = testEnv.authenticatedContext('cashier-sec8a').firestore();

    await assertFails(updateDoc(doc(db, 'customers', 'cust-sec8-1'), { openingBalance: 99999 }));
    expect(await readField(db, 'customers', 'cust-sec8-1', 'openingBalance')).toBe(200);
  });

  it('AC-01: cashier smuggled openingBalance alongside a profile edit is rejected (customers)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8b');
    await seedDoc('customers', 'cust-sec8-2', mkCustomer());
    const db = testEnv.authenticatedContext('cashier-sec8b').firestore();

    await assertFails(updateDoc(doc(db, 'customers', 'cust-sec8-2'), { name: 'اسم معدل', openingBalance: 0 } as any));
    expect(await readField(db, 'customers', 'cust-sec8-2', 'openingBalance')).toBe(200);
  });

  it('AC-01: cashier direct openingBalance overwrite is rejected (suppliers)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8c');
    await seedDoc('suppliers', 'sup-sec8-1', mkSupplier());
    const db = testEnv.authenticatedContext('cashier-sec8c').firestore();

    await assertFails(updateDoc(doc(db, 'suppliers', 'sup-sec8-1'), { openingBalance: 99999 }));
    expect(await readField(db, 'suppliers', 'sup-sec8-1', 'openingBalance')).toBe(300);
  });

  it('AC-01: admin can still correct openingBalance (both collections)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('admin-sec8', 'admin');
    await seedDoc('customers', 'cust-sec8-3', mkCustomer());
    await seedDoc('suppliers', 'sup-sec8-2', mkSupplier());
    const db = testEnv.authenticatedContext('admin-sec8').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-sec8-3'), { openingBalance: 111 }));
    expect(await readField(db, 'customers', 'cust-sec8-3', 'openingBalance')).toBe(111);

    await assertSucceeds(updateDoc(doc(db, 'suppliers', 'sup-sec8-2'), { openingBalance: 222 }));
    expect(await readField(db, 'suppliers', 'sup-sec8-2', 'openingBalance')).toBe(222);
  });
});

// --- AC-02: legitimate cashier flows unaffected ------------------------------

describe('REQ-SEC1-8 Phase 0: legitimate cashier flows unaffected (AC-02)', () => {
  it('AC-02: cashier profile edit (name/phone/address, no openingBalance) succeeds', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8d');
    await seedDoc('customers', 'cust-sec8-4', mkCustomer());
    await seedDoc('suppliers', 'sup-sec8-3', mkSupplier());
    const db = testEnv.authenticatedContext('cashier-sec8d').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-sec8-4'), { name: 'اسم معدل', phone: '011' } as any));
    expect(await readField(db, 'customers', 'cust-sec8-4', 'name')).toBe('اسم معدل');

    await assertSucceeds(updateDoc(doc(db, 'suppliers', 'sup-sec8-3'), { name: 'مورد معدل' } as any));
    expect(await readField(db, 'suppliers', 'sup-sec8-3', 'name')).toBe('مورد معدل');
  });

  it('AC-02: cashier can create a customer/supplier WITH openingBalance (addCustomer/addSupplier path)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8e');
    const db = testEnv.authenticatedContext('cashier-sec8e').firestore();

    await assertSucceeds(setDoc(doc(db, 'customers', 'cust-sec8-new'), mkCustomer(0, 0)));
    expect(await readField(db, 'customers', 'cust-sec8-new', 'openingBalance')).toBe(0);

    await assertSucceeds(setDoc(doc(db, 'suppliers', 'sup-sec8-new'), mkSupplier(150, 150)));
    expect(await readField(db, 'suppliers', 'sup-sec8-new', 'openingBalance')).toBe(150);
  });

  it('AC-02 (residual, expected): cashier direct balance write still succeeds — BUG-P0-2 NOT closed by Phase 0', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8f');
    await seedDoc('customers', 'cust-sec8-5', mkCustomer());
    const db = testEnv.authenticatedContext('cashier-sec8f').firestore();

    // Phase 0 freezes openingBalance only. A lone balance write (the exact
    // BUG-P0-2 attacker path) still passes Rules — the full fix needs Cloud
    // Functions/Blaze (REQ-SEC1-8 Phase 1, owner-gated). This assertion
    // documents the accepted residual so no future reader mistakes Phase 0
    // for a complete close.
    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-sec8-5'), { balance: 0 }));
    expect(await readField(db, 'customers', 'cust-sec8-5', 'balance')).toBe(0);
  });
});

// --- AC-03: amount/total numeric guards --------------------------------------

describe('REQ-SEC1-8 Phase 0: amount/total numeric guards (AC-03)', () => {
  it('AC-03: negative/zero payments rejected, positive payments accepted', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8g');
    const db = testEnv.authenticatedContext('cashier-sec8g').firestore();

    await assertFails(setDoc(doc(db, 'customerPayments', 'pay-neg'), { customerId: 'c1', amount: -50, date: Date.now() }));
    await assertFails(setDoc(doc(db, 'customerPayments', 'pay-zero'), { customerId: 'c1', amount: 0, date: Date.now() }));
    await assertSucceeds(setDoc(doc(db, 'customerPayments', 'pay-ok'), { customerId: 'c1', amount: 100, date: Date.now() }));

    await assertFails(setDoc(doc(db, 'supplierPayments', 'spay-neg'), { supplierId: 's1', amount: -10, date: Date.now() }));
    await assertFails(setDoc(doc(db, 'supplierPayments', 'spay-zero'), { supplierId: 's1', amount: 0, date: Date.now() }));
    await assertSucceeds(setDoc(doc(db, 'supplierPayments', 'spay-ok'), { supplierId: 's1', amount: 250, date: Date.now() }));
  });

  it('AC-03: negative totals rejected, zero/positive totals accepted (invoices + purchase + returns)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-sec8h');
    const db = testEnv.authenticatedContext('cashier-sec8h').firestore();

    await assertFails(setDoc(doc(db, 'invoices', 'inv-neg'), { total: -1, subtotal: 0, items: [] }));
    await assertSucceeds(setDoc(doc(db, 'invoices', 'inv-ok'), { total: 500, subtotal: 500, items: [] }));

    await assertFails(setDoc(doc(db, 'purchaseInvoices', 'pur-neg'), { total: -1, subtotal: 0, items: [] }));
    await assertSucceeds(setDoc(doc(db, 'purchaseInvoices', 'pur-ok'), { total: 800, subtotal: 800, items: [] }));

    await assertFails(setDoc(doc(db, 'returns', 'ret-neg'), { total: -5, items: [] }));
    await assertSucceeds(setDoc(doc(db, 'returns', 'ret-ok'), { total: 120, items: [] }));

    await assertFails(setDoc(doc(db, 'supplierReturns', 'sret-neg'), { total: -5, items: [] }));
    await assertSucceeds(setDoc(doc(db, 'supplierReturns', 'sret-ok'), { total: 60, items: [] }));
  });
});
