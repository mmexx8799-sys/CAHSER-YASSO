// REQ-RULES-2 V2 — products five-price range guard (Emulator)
//
// Rule under test (firestore.rules → match /products/{docId}):
//   - create + update: every present price field (price, retailCashPrice,
//     retailCreditPrice, wholesaleCashPrice, wholesaleCreditPrice) must
//     satisfy moneyOk(v, true) — i.e. is number && >= 0 && < 1e12.
//   - No conflict with the PPRICE-CREATE gate: non-holders stay limited to
//     absent-or-zero (0 passes moneyOk), holders gain range+type checks.
//
// Red-green contract: NEG tests PASS on unpatched rules (junk prices wrongly
// succeed ⇒ assertFails throws ⇒ RED proof) and pass after the patch.
// POS tests (price 0 create/update, cashier quantity-only update) stay green
// before and after.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/productPriceRangeRules.test.ts"

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

function mkProduct(price: number) {
  return {
    code: 'C-V2',
    name: 'منتج أسعار',
    price,
    retailCashPrice: price,
    retailCreditPrice: price,
    wholesaleCashPrice: price,
    wholesaleCreditPrice: price,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
}

async function seedProduct(docId: string, price = 100) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', docId), mkProduct(price));
  });
}

async function getField(db: any, docId: string, field: string) {
  const snap = await getDoc(doc(db, 'products', docId));
  return snap.exists() ? (snap.data() as any)[field] : undefined;
}

// --- NEG: create --------------------------------------------------------------

describe('REQ-RULES-2 V2 NEG: create rejects out-of-range prices', () => {
  it('owner cannot create a product with price -5', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v2-1', 'owner');
    const db = testEnv.authenticatedContext('own-v2-1').firestore();

    await assertFails(setDoc(doc(db, 'products', 'prod-v2-1'), mkProduct(-5)));
  });

  it('owner cannot create a product with price 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v2-2', 'owner');
    const db = testEnv.authenticatedContext('own-v2-2').firestore();

    await assertFails(setDoc(doc(db, 'products', 'prod-v2-2'), mkProduct(2000000000000)));
  });

  it('owner cannot create a product with retailCashPrice -1 (others zero)', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v2-3', 'owner');
    const db = testEnv.authenticatedContext('own-v2-3').firestore();

    await assertFails(setDoc(doc(db, 'products', 'prod-v2-3'), { ...mkProduct(0), retailCashPrice: -1 }));
  });
});

// --- NEG: update --------------------------------------------------------------

describe('REQ-RULES-2 V2 NEG: update rejects out-of-range prices', () => {
  it('admin cannot update price to -1', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v2-4', 'admin');
    await seedProduct('prod-v2-4');
    const db = testEnv.authenticatedContext('adm-v2-4').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-v2-4'), { price: -1 }));
    expect(await getField(db, 'prod-v2-4', 'price')).toBe(100);
  });

  it('admin cannot update wholesaleCreditPrice to 2e12', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v2-5', 'admin');
    await seedProduct('prod-v2-5');
    const db = testEnv.authenticatedContext('adm-v2-5').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-v2-5'), { wholesaleCreditPrice: 2000000000000 }));
    expect(await getField(db, 'prod-v2-5', 'wholesaleCreditPrice')).toBe(100);
  });

  it('admin cannot update price to Infinity', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v2-6', 'admin');
    await seedProduct('prod-v2-6');
    const db = testEnv.authenticatedContext('adm-v2-6').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-v2-6'), { price: Infinity }));
    expect(await getField(db, 'prod-v2-6', 'price')).toBe(100);
  });
});

// --- POS: legit zero prices + quantity-only staff update -----------------------

describe('REQ-RULES-2 V2 POS: zero prices and quantity-only updates stay writable', () => {
  it('owner can create a product with price 0', async () => {
    await testEnv.clearFirestore();
    await seedUser('own-v2-7', 'owner');
    const db = testEnv.authenticatedContext('own-v2-7').firestore();

    await assertSucceeds(setDoc(doc(db, 'products', 'prod-v2-7'), mkProduct(0)));
    expect(await getField(db, 'prod-v2-7', 'price')).toBe(0);
  });

  it('admin can update price to 0', async () => {
    await testEnv.clearFirestore();
    await seedUser('adm-v2-8', 'admin');
    await seedProduct('prod-v2-8');
    const db = testEnv.authenticatedContext('adm-v2-8').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-v2-8'), { price: 0 }));
    expect(await getField(db, 'prod-v2-8', 'price')).toBe(0);
  });

  it('cashier quantity-only update still succeeds', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v2-9', 'cashier');
    await seedProduct('prod-v2-9');
    const db = testEnv.authenticatedContext('cash-v2-9').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-v2-9'), { quantity: 40 }));
    expect(await getField(db, 'prod-v2-9', 'quantity')).toBe(40);
    expect(await getField(db, 'prod-v2-9', 'price')).toBe(100);
  });
});
