// REQ-NEG-1 (AUDIT-SEC-1) — negative balance is an ALLOWED state (D1).
//
// Locks the existing behavior with explicit tests; ZERO production change.
//   1. overpay-customer: payment larger than balance → negative persisted.
//   2. overpay-supplier: same for suppliers.
//   3. return-drives-negative: processReturn below zero succeeds.
//   4. supplier-return-drives-negative: processSupplierReturn below zero succeeds.
// Incidental predecessor: tests/permissionsRules.test.ts:351-352
// (amount 5 → balance -5) stays green unchanged.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/negativeBalancePolicy.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  doc,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// tests/setup.ts already mocks react-hot-toast before this import.
const { addCustomerPayment, addSupplierPayment, processReturn, processSupplierReturn } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-negpol@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  try {
    await createUserWithEmailAndPassword(fbAuth, CASHIER_EMAIL, CASHIER_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function signInCashier() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, CASHIER_EMAIL, CASHIER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // cashier holds customer.payment / return / supplier.ops by default matrix.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: CASHIER_EMAIL, role: 'cashier' });
  });
  return uid;
}

async function seed(collectionPath: string, docId: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

async function readBalance(collectionPath: string, id: string) {
  const snap = await getDoc(doc(getDB(), collectionPath, id));
  if (!snap.exists()) throw new Error(`missing doc ${collectionPath}/${id}`);
  return (snap.data() as any).balance;
}

describe('REQ-NEG-1: negative balance is allowed and persists', () => {
  it('overpay-customer: payment 15 over balance 10 → balance -5', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'neg-cust', { name: 'عميل سالب', balance: 10, openingBalance: 10, createdAt: Date.now() });
    await signInCashier();

    await addCustomerPayment({ customerId: 'neg-cust', amount: 15 });
    expect(await readBalance('customers', 'neg-cust')).toBe(-5);
  });

  it('overpay-supplier: payment 20 over balance 8 → balance -12', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'neg-sup', { name: 'مورد سالب', balance: 8, openingBalance: 8, createdAt: Date.now() });
    await signInCashier();

    await addSupplierPayment({ supplierId: 'neg-sup', amount: 20 });
    expect(await readBalance('suppliers', 'neg-sup')).toBe(-12);
  });

  it('return-drives-negative: return total 12 on balance 5 → balance -7', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'neg-ret-cust', { name: 'عميل مرتجع', balance: 5, openingBalance: 5, createdAt: Date.now() });
    await seed('products', 'neg-ret-prod', { name: 'صنف', quantity: 100, price: 12 });
    await seed('dailyArchives', 'neg-day', { status: 'open', totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 });
    await signInCashier();

    // Unlinked ON-ACCOUNT return (customer passed → totalReturnsOnAccount).
    await processReturn([{ id: 'neg-ret-prod', name: 'صنف', price: 12, buyQuantity: 1 } as any], 'neg-day', { id: 'neg-ret-cust', name: 'عميل مرتجع' });
    expect(await readBalance('customers', 'neg-ret-cust')).toBe(-7);
  });

  it('supplier-return-drives-negative: return total 10 on balance 3 → balance -7', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'neg-sret-sup', { name: 'مورد مرتجع', balance: 3, openingBalance: 3, createdAt: Date.now() });
    await seed('products', 'neg-sret-prod', { name: 'صنف', quantity: 100, price: 10 });
    await signInCashier();

    await processSupplierReturn([{ id: 'neg-sret-prod', name: 'صنف', price: 10, buyQuantity: 1 } as any], 'neg-sret-sup');
    expect(await readBalance('suppliers', 'neg-sret-sup')).toBe(-7);
  });
});
