// BUG-P0-3 — products/price hardening (Rules only, Firebase Emulator)
//
// Rule under test (firestore.rules → match /products/{docId}):
//   - read: any active user
//   - create: active user AND quantity >= 0 (NO diff() check — a new doc has
//     no "old" prices; split from update on purpose).
//   - update: active user AND quantity >= 0 AND (admin OR every price field
//     untouched: price, retailCashPrice, retailCreditPrice,
//     wholesaleCashPrice, wholesaleCreditPrice).
//   - delete: admin only
//
// App paths (processSale/processPurchase/processReturn in services/api.ts)
// write quantity ONLY on products, so the price freeze breaks nothing
// legitimate (regression covered by AC-03 + re-run of countersRules.test.ts).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/productsRules.test.ts"
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
  deleteDoc,
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), role ? { email: uid + '@t.local', role } : { email: uid + '@t.local' });
  });
}

function mkProductDoc(price: number, quantity: number) {
  return {
    code: 'C-P03',
    name: 'منتج أسعار',
    price,
    retailCashPrice: price,
    retailCreditPrice: price,
    wholesaleCashPrice: price,
    wholesaleCreditPrice: price,
    quantity,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
}

async function seedProduct(docId: string, price = 100, quantity = 50) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', docId), mkProductDoc(price, quantity));
  });
}

async function getPrice(db: any, docId: string) {
  const snap = await getDoc(doc(db, 'products', docId));
  return snap.exists() ? (snap.data() as any).price : undefined;
}

async function getQuantity(db: any, docId: string) {
  const snap = await getDoc(doc(db, 'products', docId));
  return snap.exists() ? (snap.data() as any).quantity : undefined;
}

// --- AC-01: admin keeps full power -------------------------------------------

describe('BUG-P0-3: admin price edits (AC-01)', () => {
  it('AC-01: admin can change a price alone', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('admin-p03', 'admin');
    await seedProduct('prod-p03-1');
    const db = testEnv.authenticatedContext('admin-p03').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-p03-1'), { price: 150 }));
    expect(await getPrice(db, 'prod-p03-1')).toBe(150);
  });

  it('AC-01: admin can change name+price+quantity together', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('admin-p03b', 'admin');
    await seedProduct('prod-p03-2');
    const db = testEnv.authenticatedContext('admin-p03b').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-p03-2'), { name: 'اسم جديد', price: 200, quantity: 30 }));
    expect(await getPrice(db, 'prod-p03-2')).toBe(200);
    expect(await getQuantity(db, 'prod-p03-2')).toBe(30);
  });
});

// --- AC-02: cashier price tampering rejected ----------------------------------

describe('BUG-P0-3: cashier price tampering rejected (AC-02)', () => {
  it('AC-02: cashier direct price overwrite is rejected', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03');
    await seedProduct('prod-p03-3');
    const db = testEnv.authenticatedContext('cashier-p03').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-p03-3'), { price: 1 }));
    await assertFails(updateDoc(doc(db, 'products', 'prod-p03-3'), { retailCashPrice: 1 }));
    await assertFails(updateDoc(doc(db, 'products', 'prod-p03-3'), { quantity: 40, wholesaleCreditPrice: 1 } as any));
    expect(await getPrice(db, 'prod-p03-3')).toBe(100); // untouched
  });
});

// --- AC-03: cashier stock flow unaffected --------------------------------------

describe('BUG-P0-3: cashier stock flow unaffected (AC-03)', () => {
  it('AC-03: cashier quantity-only update succeeds (sale/purchase path)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03b');
    await seedProduct('prod-p03-4');
    const db = testEnv.authenticatedContext('cashier-p03b').firestore();

    // Exactly what processSale/processPurchase/processReturn write: quantity only.
    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-p03-4'), { quantity: 49 }));
    expect(await getQuantity(db, 'prod-p03-4')).toBe(49);
    expect(await getPrice(db, 'prod-p03-4')).toBe(100);
  });

  it('AC-03: cashier non-price multi-field update succeeds', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03c');
    await seedProduct('prod-p03-5');
    const db = testEnv.authenticatedContext('cashier-p03c').firestore();

    await assertSucceeds(updateDoc(doc(db, 'products', 'prod-p03-5'), { name: 'اسم معدل', quantity: 45 } as any));
    expect(await getQuantity(db, 'prod-p03-5')).toBe(45);
  });

  it('AC-03: existing quantity>=0 guard still holds for cashier', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03d');
    await seedProduct('prod-p03-6');
    const db = testEnv.authenticatedContext('cashier-p03d').firestore();

    await assertFails(updateDoc(doc(db, 'products', 'prod-p03-6'), { quantity: -5 }));
    expect(await getQuantity(db, 'prod-p03-6')).toBe(50);
  });
});

// --- AC-04: create path has no diff() crash -------------------------------------

describe('BUG-P0-3: product creation (AC-04)', () => {
  it('AC-04: cashier can create a full new product (UI allows it — no admin gate)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03e');
    const db = testEnv.authenticatedContext('cashier-p03e').firestore();

    // Full shape as ProductsPage saves it (prices included) — must NOT crash
    // on diff() against a non-existent doc.
    await assertSucceeds(setDoc(doc(db, 'products', 'prod-p03-new'), mkProductDoc(80, 20)));
    expect(await getPrice(db, 'prod-p03-new')).toBe(80);
  });

  it('AC-04: create with negative quantity is still rejected', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03f');
    const db = testEnv.authenticatedContext('cashier-p03f').firestore();

    await assertFails(setDoc(doc(db, 'products', 'prod-p03-neg'), mkProductDoc(80, -3)));
  });
});

// --- Unchanged guards ------------------------------------------------------------

describe('BUG-P0-3: unchanged guards', () => {
  it('cashier cannot delete a product; unauthenticated writes rejected', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-p03g');
    await seedProduct('prod-p03-7');
    const cashierDb = testEnv.authenticatedContext('cashier-p03g').firestore();
    await assertFails(deleteDoc(doc(cashierDb, 'products', 'prod-p03-7')));

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anonDb, 'products', 'prod-p03-anon'), mkProductDoc(10, 5)));
  });
});
