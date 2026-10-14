// REQ-RULES-2 item 3 — ledger update money guards unified on moneyOk (Emulator)
//
// Rule under test (firestore.rules update branches):
//   - invoices / returns / purchaseInvoices / supplierReturns:
//     `total >= 0` → `moneyOk(total, true)`
//   - customerPayments / supplierPayments:
//     `amount > 0` → `moneyOk(amount, false)`
// Why: `Infinity >= 0` and `Infinity > 0` are TRUE in rules, so the old
// comparisons admitted Infinity; moneyOk also binds the type (is number)
// and the < 1e12 cap. Zero stays allowed for totals, forbidden for amounts
// — exactly the old boundary semantics.
//
// Red-green contract: NEG tests PASS on unpatched rules (Infinity/2e12
// wrongly succeed ⇒ assertFails throws ⇒ RED proof) and pass after.
// POS tests (normal admin corrections incl. a regular payment update)
// stay green before and after.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/ledgerUpdateMoneyRules.test.ts"

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

async function seedDoc(col: string, docId: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, docId), data);
  });
}

async function getField(db: any, col: string, docId: string, field: string) {
  const snap = await getDoc(doc(db, col, docId));
  return snap.exists() ? (snap.data() as any)[field] : undefined;
}

// --- NEG: Infinity / out-of-range totals --------------------------------------

describe('REQ-RULES-2 item3 NEG: update rejects Infinity/huge totals', () => {
  it('admin cannot update invoices.total to Infinity', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-1', 'admin');
    await seedDoc('invoices', 'inv-u3-1', { total: 100, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-1').firestore();

    await assertFails(updateDoc(doc(db, 'invoices', 'inv-u3-1'), { total: Infinity }));
    expect(await getField(db, 'invoices', 'inv-u3-1', 'total')).toBe(100);
  });

  it('admin cannot update returns.total to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-2', 'admin');
    await seedDoc('returns', 'ret-u3-2', { total: 50, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-2').firestore();

    await assertFails(updateDoc(doc(db, 'returns', 'ret-u3-2'), { total: 2000000000000 }));
    expect(await getField(db, 'returns', 'ret-u3-2', 'total')).toBe(50);
  });

  it('admin cannot update purchaseInvoices.total to Infinity', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-3', 'admin');
    await seedDoc('purchaseInvoices', 'pur-u3-3', { total: 200, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-3').firestore();

    await assertFails(updateDoc(doc(db, 'purchaseInvoices', 'pur-u3-3'), { total: Infinity }));
    expect(await getField(db, 'purchaseInvoices', 'pur-u3-3', 'total')).toBe(200);
  });

  it('admin cannot update supplierReturns.total to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-4', 'admin');
    await seedDoc('supplierReturns', 'sret-u3-4', { total: 70, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-4').firestore();

    await assertFails(updateDoc(doc(db, 'supplierReturns', 'sret-u3-4'), { total: 2000000000000 }));
    expect(await getField(db, 'supplierReturns', 'sret-u3-4', 'total')).toBe(70);
  });
});

// --- NEG: Infinity / out-of-range amounts --------------------------------------

describe('REQ-RULES-2 item3 NEG: update rejects Infinity/huge amounts', () => {
  it('admin cannot update customerPayments.amount to Infinity', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-5', 'admin');
    await seedDoc('customerPayments', 'cp-u3-5', { customerId: 'c1', amount: 40 });
    const db = testEnv.authenticatedContext('adm-u3-5').firestore();

    await assertFails(updateDoc(doc(db, 'customerPayments', 'cp-u3-5'), { amount: Infinity }));
    expect(await getField(db, 'customerPayments', 'cp-u3-5', 'amount')).toBe(40);
  });

  it('admin cannot update supplierPayments.amount to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-6', 'admin');
    await seedDoc('supplierPayments', 'sp-u3-6', { supplierId: 's1', amount: 60 });
    const db = testEnv.authenticatedContext('adm-u3-6').firestore();

    await assertFails(updateDoc(doc(db, 'supplierPayments', 'sp-u3-6'), { amount: 2000000000000 }));
    expect(await getField(db, 'supplierPayments', 'sp-u3-6', 'amount')).toBe(60);
  });
});

// --- POS: normal admin corrections incl. a regular payment ----------------------

describe('REQ-RULES-2 item3 POS: normal admin corrections stay writable', () => {
  it('admin can correct invoices.total 100 -> 200', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-7', 'admin');
    await seedDoc('invoices', 'inv-u3-7', { total: 100, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-7').firestore();

    await assertSucceeds(updateDoc(doc(db, 'invoices', 'inv-u3-7'), { total: 200 }));
    expect(await getField(db, 'invoices', 'inv-u3-7', 'total')).toBe(200);
  });

  it('admin can set returns.total to 0', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-8', 'admin');
    await seedDoc('returns', 'ret-u3-8', { total: 50, items: [] });
    const db = testEnv.authenticatedContext('adm-u3-8').firestore();

    await assertSucceeds(updateDoc(doc(db, 'returns', 'ret-u3-8'), { total: 0 }));
    expect(await getField(db, 'returns', 'ret-u3-8', 'total')).toBe(0);
  });

  it('admin can update a regular customer payment 40 -> 45', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-9', 'admin');
    await seedDoc('customerPayments', 'cp-u3-9', { customerId: 'c1', amount: 40 });
    const db = testEnv.authenticatedContext('adm-u3-9').firestore();

    await assertSucceeds(updateDoc(doc(db, 'customerPayments', 'cp-u3-9'), { amount: 45 }));
    expect(await getField(db, 'customerPayments', 'cp-u3-9', 'amount')).toBe(45);
  });

  it('admin can update a regular supplier payment 60 -> 55', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-u3-10', 'admin');
    await seedDoc('supplierPayments', 'sp-u3-10', { supplierId: 's1', amount: 60 });
    const db = testEnv.authenticatedContext('adm-u3-10').firestore();

    await assertSucceeds(updateDoc(doc(db, 'supplierPayments', 'sp-u3-10'), { amount: 55 }));
    expect(await getField(db, 'supplierPayments', 'sp-u3-10', 'amount')).toBe(55);
  });
});
