// REQ-RULES-2 V3 — customers/suppliers balance range guard (Emulator)
//
// Rule under test (firestore.rules → match /customers + /suppliers update):
//   - staff balance-only branch: balance must satisfy balanceOk()
//     (is number && > -1e12 && < 1e12 — negative ACCEPTED per REQ-NEG-1 D1)
//   - cap branch (customer.write/supplier.write holders): same guard whenever
//     'balance' is among the affected keys; profile-only edits unaffected.
//   - create/openingBalance: OUT OF SCOPE (deferred → REQ-RULES-3).
//
// Red-green contract: the NEG tests below PASS on unpatched rules (writes
// wrongly succeed ⇒ assertFails throws ⇒ test fails = RED proof) and pass
// after the patch. POS tests stay green before and after (no legit breakage).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/balanceRangeRules.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

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

async function seedUser(uid: string, role: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role });
  });
}

async function seedCustomer(docId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'customers', docId), {
      name: 'عميل',
      phone: '01000000000',
      balance: 10,
      openingBalance: 10,
      createdAt: Date.now(),
    });
  });
}

async function seedSupplier(docId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'suppliers', docId), {
      name: 'مورد',
      phone: '01000000000',
      balance: 10,
      openingBalance: 10,
      createdAt: Date.now(),
    });
  });
}

async function getBalance(db: any, col: string, docId: string) {
  const snap = await getDoc(doc(db, col, docId));
  return snap.exists() ? (snap.data() as any).balance : undefined;
}

// --- NEG: staff balance-only branch ------------------------------------------

describe('REQ-RULES-2 V3 NEG: staff balance-only branch rejects junk', () => {
  it('cashier cannot set customers.balance to a string', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-1', 'cashier');
    await seedCustomer('cust-v3-1');
    const db = testEnv.authenticatedContext('cash-v3-1').firestore();

    await assertFails(updateDoc(doc(db, 'customers', 'cust-v3-1'), { balance: 'hacked' } as any));
    expect(await getBalance(db, 'customers', 'cust-v3-1')).toBe(10);
  });

  it('cashier cannot set customers.balance to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-2', 'cashier');
    await seedCustomer('cust-v3-2');
    const db = testEnv.authenticatedContext('cash-v3-2').firestore();

    await assertFails(updateDoc(doc(db, 'customers', 'cust-v3-2'), { balance: 2000000000000 }));
    expect(await getBalance(db, 'customers', 'cust-v3-2')).toBe(10);
  });

  it('cashier cannot set suppliers.balance to a string', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-3', 'cashier');
    await seedSupplier('sup-v3-3');
    const db = testEnv.authenticatedContext('cash-v3-3').firestore();

    await assertFails(updateDoc(doc(db, 'suppliers', 'sup-v3-3'), { balance: 'hacked' } as any));
    expect(await getBalance(db, 'suppliers', 'sup-v3-3')).toBe(10);
  });

  it('cashier cannot set suppliers.balance to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-4', 'cashier');
    await seedSupplier('sup-v3-4');
    const db = testEnv.authenticatedContext('cash-v3-4').firestore();

    await assertFails(updateDoc(doc(db, 'suppliers', 'sup-v3-4'), { balance: 2000000000000 }));
    expect(await getBalance(db, 'suppliers', 'sup-v3-4')).toBe(10);
  });
});

// --- NEG: cap branch smuggling ------------------------------------------------

describe('REQ-RULES-2 V3 NEG: cap branch cannot smuggle junk balance', () => {
  it('customer.write holder cannot smuggle string balance inside a profile edit', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-5', 'cashier'); // holds customer.write by matrix default
    await seedCustomer('cust-v3-5');
    const db = testEnv.authenticatedContext('cash-v3-5').firestore();

    await assertFails(
      updateDoc(doc(db, 'customers', 'cust-v3-5'), { name: 'اسم جديد', balance: 'hacked' } as any),
    );
    expect(await getBalance(db, 'customers', 'cust-v3-5')).toBe(10);
  });

  it('admin cannot smuggle -2e12 balance inside a profile edit', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v3-6', 'admin');
    await seedCustomer('cust-v3-6');
    const db = testEnv.authenticatedContext('adm-v3-6').firestore();

    await assertFails(updateDoc(doc(db, 'customers', 'cust-v3-6'), { name: 'اسم جديد', balance: -2000000000000 }));
    expect(await getBalance(db, 'customers', 'cust-v3-6')).toBe(10);
  });

  it('supplier.write holder cannot smuggle string balance inside a profile edit', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-7', 'cashier'); // holds supplier.write by matrix default
    await seedSupplier('sup-v3-7');
    const db = testEnv.authenticatedContext('cash-v3-7').firestore();

    await assertFails(
      updateDoc(doc(db, 'suppliers', 'sup-v3-7'), { name: 'اسم جديد', balance: 'hacked' } as any),
    );
    expect(await getBalance(db, 'suppliers', 'sup-v3-7')).toBe(10);
  });

  it('admin cannot smuggle 2e12 balance inside a supplier profile edit', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v3-8', 'admin');
    await seedSupplier('sup-v3-8');
    const db = testEnv.authenticatedContext('adm-v3-8').firestore();

    await assertFails(updateDoc(doc(db, 'suppliers', 'sup-v3-8'), { name: 'اسم جديد', balance: 2000000000000 }));
    expect(await getBalance(db, 'suppliers', 'sup-v3-8')).toBe(10);
  });
});

// --- POS: legit balances (incl. negative) stay writable -----------------------

describe('REQ-RULES-2 V3 POS: legit balances incl. negative stay writable', () => {
  it('cashier can set customers.balance to -50 (REQ-NEG-1 D1)', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-9', 'cashier');
    await seedCustomer('cust-v3-9');
    const db = testEnv.authenticatedContext('cash-v3-9').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-v3-9'), { balance: -50 }));
    expect(await getBalance(db, 'customers', 'cust-v3-9')).toBe(-50);
  });

  it('cashier can set customers.balance to 0', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-10', 'cashier');
    await seedCustomer('cust-v3-10');
    const db = testEnv.authenticatedContext('cash-v3-10').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-v3-10'), { balance: 0 }));
    expect(await getBalance(db, 'customers', 'cust-v3-10')).toBe(0);
  });

  it('cashier can set suppliers.balance to -50', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-11', 'cashier');
    await seedSupplier('sup-v3-11');
    const db = testEnv.authenticatedContext('cash-v3-11').firestore();

    await assertSucceeds(updateDoc(doc(db, 'suppliers', 'sup-v3-11'), { balance: -50 }));
    expect(await getBalance(db, 'suppliers', 'sup-v3-11')).toBe(-50);
  });

  it('boundary 999999999999 succeeds, 1000000000000 is rejected', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-12', 'cashier');
    await seedCustomer('cust-v3-12a');
    await seedCustomer('cust-v3-12b');
    const db = testEnv.authenticatedContext('cash-v3-12').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-v3-12a'), { balance: 999999999999 }));
    expect(await getBalance(db, 'customers', 'cust-v3-12a')).toBe(999999999999);
    await assertFails(updateDoc(doc(db, 'customers', 'cust-v3-12b'), { balance: 1000000000000 }));
    expect(await getBalance(db, 'customers', 'cust-v3-12b')).toBe(10);
  });
});

// --- POS (addition 2): profile-only edits by cap holders -----------------------

describe('REQ-RULES-2 V3 POS: cap holder profile edits without balance succeed', () => {
  it('customer.write holder edits name/phone without touching balance (customers)', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-13', 'cashier');
    await seedCustomer('cust-v3-13');
    const db = testEnv.authenticatedContext('cash-v3-13').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customers', 'cust-v3-13'), { name: 'اسم محدث', phone: '01111111111' }));
    expect(await getBalance(db, 'customers', 'cust-v3-13')).toBe(10);
  });

  it('supplier.write holder edits name/phone without touching balance (suppliers)', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v3-14', 'cashier');
    await seedSupplier('sup-v3-14');
    const db = testEnv.authenticatedContext('cash-v3-14').firestore();

    await assertSucceeds(updateDoc(doc(db, 'suppliers', 'sup-v3-14'), { name: 'اسم محدث', phone: '01111111111' }));
    expect(await getBalance(db, 'suppliers', 'sup-v3-14')).toBe(10);
  });
});
