// REQ-RULES-2 V1 — products quantity explicit type guard (Emulator)
//
// Rule under test (firestore.rules → match /products/{docId}):
//   - create + update: `quantity is number && quantity >= 0`
//     (was bare `quantity >= 0`).
//
// Honesty note: there is NO red-before case here — a string quantity
// already fails closed on the old comparison (`"5" >= 0` errors ⇒ deny),
// so these tests are characterization/lock-in (green before AND after).
// Value: explicit intent, parity with the moneyOk/balanceOk style, and
// protection against any future OR-branch that might skip the comparison.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/productQuantityTypeRules.test.ts"

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

function mkProduct(quantity: any) {
  return {
    code: 'C-V1',
    name: 'منتج كمية',
    price: 0,
    retailCashPrice: 0,
    retailCreditPrice: 0,
    wholesaleCashPrice: 0,
    wholesaleCreditPrice: 0,
    quantity,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
}

async function seedProduct(docId: string, quantity = 50) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', docId), mkProduct(quantity));
  });
}

async function getQuantity(db: any, docId: string) {
  const snap = await getDoc(doc(db, 'products', docId));
  return snap.exists() ? (snap.data() as any).quantity : undefined;
}

// --- Lock-in: non-number quantities rejected -----------------------------------

describe('REQ-RULES-2 V1 lock-in: non-number quantities rejected', () => {
  it('owner cannot create a product with quantity "5" (string)', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v1-1', 'owner');
    const db = testEnv.authenticatedContext('own-v1-1').firestore();

    await assertFails(setDoc(doc(db, 'products', 'prod-v1-1'), mkProduct('5' as any)));
  });

  it('admin cannot update quantity to "5" (string)', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v1-2', 'admin');
    await seedProduct('prod-v1-2');
    const db = testEnv.authenticatedContext('adm-v1-2').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-v1-2'), { quantity: '5' } as any));
    expect(await getQuantity(db, 'prod-v1-2')).toBe(50);
  });
});

// --- POS: numeric quantities stay writable --------------------------------------

describe('REQ-RULES-2 V1 POS: numeric quantities stay writable', () => {
  it('owner can create a product with quantity 3', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v1-3', 'owner');
    const db = testEnv.authenticatedContext('own-v1-3').firestore();

    await assertSucceeds(setDoc(doc(db, 'products', 'prod-v1-3'), mkProduct(3)));
    expect(await getQuantity(db, 'prod-v1-3')).toBe(3);
  });

  it('admin can update quantity 50 -> 7', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v1-4', 'admin');
    await seedProduct('prod-v1-4');
    const db = testEnv.authenticatedContext('adm-v1-4').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-v1-4'), { quantity: 7 }));
    expect(await getQuantity(db, 'prod-v1-4')).toBe(7);
  });

  it('cashier quantity-only update still succeeds', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v1-5', 'cashier');
    await seedProduct('prod-v1-5');
    const db = testEnv.authenticatedContext('cash-v1-5').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-v1-5'), { quantity: 40 }));
    expect(await getQuantity(db, 'prod-v1-5')).toBe(40);
  });
});
