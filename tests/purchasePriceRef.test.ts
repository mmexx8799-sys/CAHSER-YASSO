// PURCHASE-PRICE-REF — dynamic purchase-price reference (service + rules-compat, Firebase Emulator)
//
// Spec under test:
//   - Product.lastPurchasePrice?: number — absent/0 = never purchased → first purchase seeds the
//     reference with NO check (priceFlagged=false).
//   - From the 2nd purchase of the same product: |new - ref| / ref > 0.40 → invoice recorded with
//     priceFlagged=true (warning, never a rejection); otherwise priceFlagged=false.
//   - The reference updates atomically with every successful purchase (quantity + lastPurchasePrice
//     in the same transaction as the invoice).
//   - firestore.rules UNTOUCHED: cashier {quantity, lastPurchasePrice} update passes the BUG-P0-3
//     price freeze (lastPurchasePrice is not one of the five sale-price fields); purchaseInvoices
//     create only gates total >= 0 + supplier.ops cap (no hasOnly on keys).
//   - processSupplierReturn intentionally untouched (return is not a purchase).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/purchasePriceRef.test.ts"
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
  getDocs,
  collection,
  query,
  where,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, CartItem } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { processPurchase, isPurchasePriceDeviated, PURCHASE_PRICE_DEVIATION_THRESHOLD } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const TEST_EMAIL = 'cashier-ppr@test.local'; // distinct account — no cross-file fixture clash
const TEST_PASSWORD = 'secret123';

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
    await createUserWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

// --- Helpers ----------------------------------------------------------------

async function signInAppUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL, role: 'cashier' });
  });
  return uid;
}

function mkProduct(id: string, price: number, quantity: number): Product {
  return {
    id,
    code: 'C-' + id,
    name: 'منتج سعر مرجعي ' + id,
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

function mkCartItem(p: Product, qty: number, price: number): CartItem {
  return { ...p, buyQuantity: qty, priceType: 'retail', price } as CartItem;
}

async function seedFixtures(prodId: string, supId: string, seedRef?: number) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const prod: any = { ...mkProduct(prodId, 100, 50), createdAt: Date.now() };
    if (seedRef !== undefined) prod.lastPurchasePrice = seedRef;
    await setDoc(doc(db, 'products', prodId), prod);
    await setDoc(doc(db, 'suppliers', supId), { name: 'مورد مرجعي', balance: 0, createdAt: Date.now() } as any);
  });
}

async function getProductField(db: any, prodId: string, field: string) {
  const snap = await getDoc(doc(db, 'products', prodId));
  return snap.exists() ? (snap.data() as any)[field] : undefined;
}

async function buy(db: any, prod: Product, supId: string, qty: number, price: number) {
  await processPurchase({
    items: [mkCartItem(prod, qty, price)],
    subtotal: qty * price,
    total: qty * price,
    supplierId: supId,
  });
}

async function latestInvoice(db: any, supId: string) {
  const snap = await getDocs(query(collection(db, 'purchaseInvoices'), where('supplierId', '==', supId)));
  expect(snap.empty).toBe(false);
  const docs = snap.docs.map((d) => d.data() as any);
  docs.sort((a, b) => String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)));
  return docs[docs.length - 1];
}

// --- Pure helper --------------------------------------------------------------

describe('PURCHASE-PRICE-REF: isPurchasePriceDeviated (pure)', () => {
  it('threshold is 0.40 and first-purchase shapes never flag', async () => {
    expect(PURCHASE_PRICE_DEVIATION_THRESHOLD).toBe(0.4);
    expect(isPurchasePriceDeviated(undefined, 100)).toBe(false);
    expect(isPurchasePriceDeviated(0, 100)).toBe(false);
    expect(isPurchasePriceDeviated(-5, 100)).toBe(false);
    expect(isPurchasePriceDeviated(NaN, 100)).toBe(false);
    expect(isPurchasePriceDeviated('100' as any, 100)).toBe(false);
  });

  it('boundary: exactly 40% is NOT flagged; just above IS flagged (both directions)', async () => {
    expect(isPurchasePriceDeviated(100, 140)).toBe(false); // +40% exactly
    expect(isPurchasePriceDeviated(100, 60)).toBe(false); // -40% exactly
    expect(isPurchasePriceDeviated(100, 140.01)).toBe(true); // just above
    expect(isPurchasePriceDeviated(100, 59.99)).toBe(true); // just below
    expect(isPurchasePriceDeviated(100, 110)).toBe(false); // normal +10%
    expect(isPurchasePriceDeviated(100, 150)).toBe(true); // +50%
    expect(isPurchasePriceDeviated(100, 50)).toBe(true); // -50%
  });
});

// --- App path -----------------------------------------------------------------

describe('PURCHASE-PRICE-REF: reference lifecycle via processPurchase', () => {
  it('first purchase seeds the reference with priceFlagged=false (no check)', async () => {
    await testEnv.clearFirestore();
    await seedFixtures('ppr-prod-1', 'ppr-sup-1');
    await signInAppUser();
    const db = getDB();

    await buy(db, mkProduct('ppr-prod-1', 100, 50), 'ppr-sup-1', 2, 80);

    expect(await getProductField(db, 'ppr-prod-1', 'lastPurchasePrice')).toBe(80);
    expect(await getProductField(db, 'ppr-prod-1', 'quantity')).toBe(52);
    const inv = await latestInvoice(db, 'ppr-sup-1');
    expect(inv.priceFlagged).toBe(false);
  });

  it('second purchase +50% flags the invoice AND advances the reference', async () => {
    await testEnv.clearFirestore();
    await seedFixtures('ppr-prod-2', 'ppr-sup-2');
    await signInAppUser();
    const db = getDB();

    await buy(db, mkProduct('ppr-prod-2', 100, 50), 'ppr-sup-2', 1, 80);
    await buy(db, mkProduct('ppr-prod-2', 100, 50), 'ppr-sup-2', 1, 120); // +50% over ref 80

    expect(await getProductField(db, 'ppr-prod-2', 'lastPurchasePrice')).toBe(120);
    const inv = await latestInvoice(db, 'ppr-sup-2');
    expect(inv.priceFlagged).toBe(true);
  });

  it('second purchase +10% does NOT flag but still advances the reference', async () => {
    await testEnv.clearFirestore();
    await seedFixtures('ppr-prod-3', 'ppr-sup-3');
    await signInAppUser();
    const db = getDB();

    await buy(db, mkProduct('ppr-prod-3', 100, 50), 'ppr-sup-3', 1, 100);
    await buy(db, mkProduct('ppr-prod-3', 100, 50), 'ppr-sup-3', 1, 110); // +10% over ref 100

    expect(await getProductField(db, 'ppr-prod-3', 'lastPurchasePrice')).toBe(110);
    const inv = await latestInvoice(db, 'ppr-sup-3');
    expect(inv.priceFlagged).toBe(false);
  });

  it('cashier end-to-end passes unchanged rules (BUG-P0-3 price freeze intact)', async () => {
    await testEnv.clearFirestore();
    await seedFixtures('ppr-prod-4', 'ppr-sup-4', 70);
    await signInAppUser();
    const db = getDB();

    // Seeded ref 70 → buying at 70 is 0% deviation → no flag; sale-price fields untouched.
    await buy(db, mkProduct('ppr-prod-4', 100, 50), 'ppr-sup-4', 3, 70);

    expect(await getProductField(db, 'ppr-prod-4', 'lastPurchasePrice')).toBe(70);
    expect(await getProductField(db, 'ppr-prod-4', 'quantity')).toBe(53);
    expect(await getProductField(db, 'ppr-prod-4', 'price')).toBe(100); // sale price untouched
    const inv = await latestInvoice(db, 'ppr-sup-4');
    expect(inv.priceFlagged).toBe(false);
  });
});
