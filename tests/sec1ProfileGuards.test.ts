// REQ-SEC1-7 (AUDIT-SEC-1) — profile-guard injection tests (Firebase Emulator)
//
// Proves the defense lives INSIDE the functions, not in the UI: calls
// updateCustomerProfile / updateSupplierProfile / saveProduct DIRECTLY
// (bypassing all pages — the exact P0-2 attacker path: devtools + direct
// call) and asserts smuggled fields never land in Firestore.
//
//   (1) updateCustomerProfile({name:'x', balance:99999, openingBalance:99999,
//       createdAt:123}) → name updates, balance/openingBalance untouched.
//   (2) updateSupplierProfile — same.
//   (3) saveProduct creates with rebuilt searchableIndex + serverTimestamp,
//       and strips smuggled junk (buyQuantity, balance).
//   (4) saveProduct rejects quantity:-1 / empty name with a clear Arabic error.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/sec1ProfileGuards.test.ts"
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
  Timestamp,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// tests/setup.ts already mocks react-hot-toast before this import.
const { updateCustomerProfile, updateSupplierProfile, saveProduct } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-sec1@test.local'; // distinct from other test files
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

// --- Helpers ----------------------------------------------------------------

async function signInCashier() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, CASHIER_EMAIL, CASHIER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // users/{uid} create is admin-only → seed with rules disabled. Plain
  // cashier (no role): even stronger — proves a NON-admin cannot inject.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: CASHIER_EMAIL });
  });
  return uid;
}

async function readDoc(collectionPath: string, id: string) {
  const snap = await getDoc(doc(getDB(), collectionPath, id));
  if (!snap.exists()) throw new Error(`missing doc ${collectionPath}/${id}`);
  return snap.data() as any;
}

// --- (1)+(2) direct-injection guards -------------------------------------------

describe('REQ-SEC1-7: smuggled balance never reaches Firestore', () => {
  it('updateCustomerProfile applies name but drops balance/openingBalance/createdAt', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'customers', 'cust-sec1'), {
        name: 'عميل اختبار', phone: '010', address: 'القاهرة',
        balance: 500, openingBalance: 200, createdAt: Date.now(),
      });
    });
    await signInCashier();

    // Attacker path: direct call, UI fully bypassed.
    await updateCustomerProfile('cust-sec1', {
      name: 'اسم معدل', phone: '011', address: 'الجيزة',
      balance: 99999, openingBalance: 99999, createdAt: 123,
    } as any);

    const after = await readDoc('customers', 'cust-sec1');
    expect(after.name).toBe('اسم معدل');
    expect(after.phone).toBe('011');
    expect(after.balance).toBe(500);
    expect(after.openingBalance).toBe(200);
    expect(after.createdAt).not.toBe(123);
  });

  it('updateSupplierProfile applies name but drops balance/openingBalance', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'suppliers', 'sup-sec1'), {
        name: 'مورد اختبار', phone: '010', address: 'القاهرة',
        balance: 700, openingBalance: 300, createdAt: Date.now(),
      });
    });
    await signInCashier();

    await updateSupplierProfile('sup-sec1', {
      name: 'مورد معدل', balance: 99999, openingBalance: 99999,
    } as any);

    const after = await readDoc('suppliers', 'sup-sec1');
    expect(after.name).toBe('مورد معدل');
    expect(after.balance).toBe(700);
    expect(after.openingBalance).toBe(300);
  });
});

// --- (3)+(4) saveProduct behavior ------------------------------------------------

describe('REQ-SEC1-7: saveProduct whitelist + validation', () => {
  it('creates with rebuilt searchableIndex + serverTimestamp, strips junk fields', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    const id = await saveProduct({
      code: 'SEC1-001', name: 'منتج حماية', categoryId: 'cat-1',
      quantity: 10, price: 100, retailCashPrice: 100,
      buyQuantity: 999, balance: 99999,
    } as any);
    expect(typeof id).toBe('string');

    const after = await readDoc('products', id as string);
    expect(after.code).toBe('SEC1-001');
    expect(after.quantity).toBe(10);
    expect(Array.isArray(after.searchableIndex)).toBe(true);
    expect(after.searchableIndex.length).toBeGreaterThan(0);
    expect(after.createdAt).toBeInstanceOf(Timestamp);
    expect(after).not.toHaveProperty('buyQuantity');
    expect(after).not.toHaveProperty('balance');
  });

  it('rejects quantity:-1 and empty name with a clear Arabic error (no write)', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    await expect(saveProduct({
      code: 'SEC1-002', name: 'منتج مرفوض', categoryId: 'cat-1',
      quantity: -1, price: 100,
    } as any)).rejects.toThrow(/غير صالحة/);

    await expect(saveProduct({
      code: 'SEC1-003', name: '   ', categoryId: 'cat-1',
      quantity: 5, price: 100,
    } as any)).rejects.toThrow(/مطلوب/);
  });
});
