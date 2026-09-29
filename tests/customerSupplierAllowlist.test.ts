// REQ-SEC1-A1 (AUDIT-SEC-1) — runtime allowlist in addCustomer/addSupplier
// (Firebase Emulator).
//
// AC-A1-1: hostile input (id / smuggled createdAt+openingBalance / unknown
//   keys) → written doc keys ⊆ {name, phone, address, balance,
//   openingBalance, createdAt}.
// AC-A1-2: legitimate form-shaped inputs produce docs identical to the old
//   verbatim spread (same keys, same values).
// AC-A1-3: missing/undefined phone/address → '' (no undefined into addDoc).
// AC-A1-4: balance/openingBalance derivation is still Number(x) || 0.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/customerSupplierAllowlist.test.ts"
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
const { addCustomer, addSupplier } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-allowlist@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';

const ALLOWED_KEYS = ['name', 'phone', 'address', 'balance', 'openingBalance', 'createdAt'].sort();

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
  // cashier holds customer.write + supplier.write by default matrix.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: CASHIER_EMAIL, role: 'cashier' });
  });
  return uid;
}

async function readDoc(collectionPath: string, id: string) {
  const snap = await getDoc(doc(getDB(), collectionPath, id));
  if (!snap.exists()) throw new Error(`missing doc ${collectionPath}/${id}`);
  return snap.data() as any;
}

// --- AC-A1-1: hostile input ----------------------------------------------------

describe('REQ-SEC1-A1: allowlist-drops-extra-keys', () => {
  it('addCustomer drops id/smuggled fields/unknown keys', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    const id = await addCustomer({
      name: 'عميل اختبار',
      phone: '010',
      address: 'القاهرة',
      balance: 100,
      id: 'smuggled-id',
      createdAt: 123,
      openingBalance: 999,
      unknownKey: 'junk',
    } as any);
    expect(typeof id).toBe('string');

    const after = await readDoc('customers', id as string);
    expect(Object.keys(after).sort()).toEqual(ALLOWED_KEYS);
    expect(after).not.toHaveProperty('id');
    expect(after).not.toHaveProperty('unknownKey');
    expect(after.name).toBe('عميل اختبار');
    expect(after.phone).toBe('010');
    expect(after.address).toBe('القاهرة');
    // Derived from balance (100), NOT the smuggled openingBalance (999).
    expect(after.balance).toBe(100);
    expect(after.openingBalance).toBe(100);
    // Stamped serverTimestamp, NOT the smuggled createdAt (123).
    expect(after.createdAt).toBeInstanceOf(Timestamp);
  });

  it('addSupplier drops id/smuggled fields/unknown keys', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    const id = await addSupplier({
      name: 'مورد اختبار',
      phone: '011',
      address: 'الجيزة',
      balance: 250,
      id: 'smuggled-id',
      createdAt: 456,
      openingBalance: 888,
      unknownKey: 'junk',
    } as any);
    expect(typeof id).toBe('string');

    const after = await readDoc('suppliers', id as string);
    expect(Object.keys(after).sort()).toEqual(ALLOWED_KEYS);
    expect(after).not.toHaveProperty('id');
    expect(after).not.toHaveProperty('unknownKey');
    expect(after.balance).toBe(250);
    expect(after.openingBalance).toBe(250);
    expect(after.createdAt).toBeInstanceOf(Timestamp);
  });
});

// --- AC-A1-2 + AC-A1-4: legit output preserved ---------------------------------

describe('REQ-SEC1-A1: allowlist-preserves-legit-output', () => {
  it('create-form object (empty-string phone/address) writes identical doc', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    // Exact shape pages/CustomersPage.tsx:20+41 produce on create.
    const id = await addCustomer({ name: 'عميل نموذج', phone: '', address: '', balance: 250 });
    const after = await readDoc('customers', id as string);
    expect(Object.keys(after).sort()).toEqual(ALLOWED_KEYS);
    expect(after.name).toBe('عميل نموذج');
    expect(after.phone).toBe('');
    expect(after.address).toBe('');
    expect(after.balance).toBe(250);
    expect(after.openingBalance).toBe(250);
    expect(after.createdAt).toBeInstanceOf(Timestamp);

    const supId = await addSupplier({ name: 'مورد نموذج', phone: '', address: '', balance: 0 });
    const supAfter = await readDoc('suppliers', supId as string);
    expect(Object.keys(supAfter).sort()).toEqual(ALLOWED_KEYS);
    expect(supAfter.balance).toBe(0);
    expect(supAfter.openingBalance).toBe(0);
  });

  it('balance derivation matrix matches Number(x) || 0', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    const cases: Array<[any, number]> = [
      [undefined, 0],
      ['', 0],
      ['abc', 0],
      [NaN, 0],
      ['5', 5],
      [7, 7],
    ];
    for (const [input, expected] of cases) {
      const id = await addCustomer({ name: `عميل ${String(input)}`, phone: '', address: '', balance: input } as any);
      const after = await readDoc('customers', id as string);
      expect(after.balance).toBe(expected);
      expect(after.openingBalance).toBe(expected);
    }
  });
});

// --- AC-A1-3: no undefined ------------------------------------------------------

describe('REQ-SEC1-A1: allowlist-no-undefined', () => {
  it('missing/undefined phone/address become empty strings', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    const id = await addCustomer({ name: 'عميل ناقص', balance: 10 } as any);
    const after = await readDoc('customers', id as string);
    expect(after.phone).toBe('');
    expect(after.address).toBe('');
    for (const v of Object.values(after)) {
      expect(v).not.toBeUndefined();
    }

    const supId = await addSupplier({ name: 'مورد ناقص', phone: undefined, address: undefined, balance: 10 } as any);
    const supAfter = await readDoc('suppliers', supId as string);
    expect(supAfter.phone).toBe('');
    expect(supAfter.address).toBe('');
    for (const v of Object.values(supAfter)) {
      expect(v).not.toBeUndefined();
    }
  });
});
