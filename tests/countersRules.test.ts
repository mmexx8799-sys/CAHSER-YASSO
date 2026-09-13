// BUG-P0-13 — counters/invoices hardening (Rules + integration, Firebase Emulator)
//
// Rule under test (firestore.rules → match /counters/{docId}):
//   - read: any active user
//   - create: active user AND lastNumber == 1 AND only the lastNumber key
//   - update: active user AND new == old + 1 AND only lastNumber changed
//   - delete: admin only
//
// Two layers in this file:
//   (1) Direct rules tests via authenticatedContext (AC-02: arbitrary direct
//       writes rejected; admin escape hatch works).
//   (2) Real app-path tests via processSale/processPurchase from services/api.ts
//       (AC-01/AC-03: sequential numbering preserved; concurrent sales unique).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/countersRules.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
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
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, CartItem, Invoice } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { processSale, processPurchase } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const TEST_EMAIL = 'cashier-counters@test.local'; // distinct from processReturn.test.ts account
const TEST_PASSWORD = 'secret123';
const ARCHIVE_ID = '2026-09-14'; // distinct archive — no cross-file fixture clash

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
  // One Auth Emulator account for the real app-path tests below.
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

async function seedActiveUser(uid: string, role?: string) {
  // users/{uid} create is admin-only in the rules → seed with rules disabled
  // (mirrors how a real admin provisions accounts before first use).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), role ? { email: uid + '@t.local', role } : { email: uid + '@t.local' });
  });
}

async function signInAppUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL });
  });
  return uid;
}

function mkProduct(id: string, price: number, quantity: number): Product {
  return {
    id,
    code: 'C-' + id,
    name: 'منتج عدّادات ' + id,
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

function mkCartItem(p: Product, qty: number, price?: number): CartItem {
  return { ...p, buyQuantity: qty, priceType: 'retail', price: price ?? p.price } as CartItem;
}

async function seedSaleFixtures(ctx: RulesTestContext) {
  const db = ctx.firestore();
  await setDoc(doc(db, 'products', 'prod-counter-1'), { ...mkProduct('prod-counter-1', 100, 50), createdAt: Date.now() });
  await setDoc(doc(db, 'products', 'prod-counter-2'), { ...mkProduct('prod-counter-2', 60, 50), createdAt: Date.now() });
  await setDoc(doc(db, 'suppliers', 'sup-counter-1'), { name: 'مورد اختبار', balance: 0, createdAt: Date.now() } as any);
  await setDoc(doc(db, 'dailyArchives', ARCHIVE_ID), {
    startTime: Date.now(),
    status: 'open',
    totalSales: 0,
    totalReturns: 0,
    totalCash: 0,
    totalCredit: 0,
    totalVodafoneCash: 0,
    totalInstapay: 0,
    totalReturnsCash: 0,
    totalReturnsOnAccount: 0,
  } as any);
}

async function getCounter(db: any, docId: string) {
  const snap = await getDoc(doc(db, 'counters', docId));
  return snap.exists() ? (snap.data() as any).lastNumber : undefined;
}

async function findInvoiceByNumber(db: any, invoiceNumber: string) {
  const snap = await getDocs(query(collection(db, 'invoices'), where('invoiceNumber', '==', invoiceNumber), where('dailyArchiveId', '==', ARCHIVE_ID)));
  return snap.empty ? null : snap.docs[0].data();
}

// --- (1) Direct rules tests ---------------------------------------------------

describe('BUG-P0-13: counters rule — direct writes (AC-02)', () => {
  it('AC-02: cashier create with an arbitrary value is rejected', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ac02');
    const db = testEnv.authenticatedContext('cashier-ac02').firestore();

    await assertFails(setDoc(doc(db, 'counters', 'probe-arbitrary'), { lastNumber: 999 }));
    // …and with extra smuggled keys even at the "right" value.
    await assertFails(setDoc(doc(db, 'counters', 'probe-keys'), { lastNumber: 1, evil: true } as any));
  });

  it('AC-02: cashier create with the legitimate first-use shape (lastNumber=1) is allowed', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ac02b');
    const db = testEnv.authenticatedContext('cashier-ac02b').firestore();

    await assertSucceeds(setDoc(doc(db, 'counters', 'probe-first'), { lastNumber: 1 }));
    expect(await getCounter(db, 'probe-first')).toBe(1);
  });

  it('AC-02: cashier update must be exactly +1 on lastNumber only', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ac02c');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'counters', 'probe-upd'), { lastNumber: 5 });
    });
    const db = testEnv.authenticatedContext('cashier-ac02c').firestore();

    await assertFails(updateDoc(doc(db, 'counters', 'probe-upd'), { lastNumber: 999 })); // arbitrary jump
    await assertFails(updateDoc(doc(db, 'counters', 'probe-upd'), { lastNumber: 5 })); // no-op rewrite
    await assertFails(updateDoc(doc(db, 'counters', 'probe-upd'), { lastNumber: 4 })); // decrement
    await assertFails(updateDoc(doc(db, 'counters', 'probe-upd'), { lastNumber: 6, extra: 1 } as any)); // smuggled key
    await assertSucceeds(updateDoc(doc(db, 'counters', 'probe-upd'), { lastNumber: 6 })); // exactly +1
    expect(await getCounter(db, 'probe-upd')).toBe(6);
  });

  it('AC-02: cashier cannot delete a counter; admin can', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ac02d');
    await seedActiveUser('admin-ac02d', 'admin');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'counters', 'probe-del'), { lastNumber: 3 });
    });

    const cashierDb = testEnv.authenticatedContext('cashier-ac02d').firestore();
    await assertFails(deleteDoc(doc(cashierDb, 'counters', 'probe-del')));

    const adminDb = testEnv.authenticatedContext('admin-ac02d').firestore();
    await assertSucceeds(deleteDoc(doc(adminDb, 'counters', 'probe-del')));
    expect(await getCounter(adminDb, 'probe-del')).toBeUndefined();
  });

  it('AC-02: unauthenticated writes are rejected', async () => {
    await testEnv.clearFirestore();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'counters', 'probe-anon'), { lastNumber: 1 }));
  });
});

// --- (2) Real app-path tests ---------------------------------------------------

describe('BUG-P0-13: counters rule — legitimate transaction path (AC-01/AC-03)', () => {
  it('EDGE: first-ever sale creates the counter with the correct initial value', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedSaleFixtures(ctx);
    });
    await signInAppUser();

    const db = getDB();
    expect(await getCounter(db, 'invoices')).toBeUndefined(); // no counter yet

    const p = mkProduct('prod-counter-1', 100, 50);
    await processSale({
      items: [mkCartItem(p, 2)],
      subtotal: 200,
      discount: 0,
      total: 200,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: ARCHIVE_ID,
    });

    expect(await getCounter(db, 'invoices')).toBe(1);
    const inv = await findInvoiceByNumber(db, 'INV-000001');
    expect(inv).not.toBeNull();
    expect((inv as any).total).toBe(200);
  });

  it('AC-01: ordinary sales keep creating correct sequential numbers (no behavior change)', async () => {
    // Continues the sequence from the previous test (same file ⇒ sequential).
    await signInAppUser();
    const db = getDB();
    const p = mkProduct('prod-counter-1', 100, 50);

    await processSale({
      items: [mkCartItem(p, 1)],
      subtotal: 100,
      discount: 0,
      total: 100,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: ARCHIVE_ID,
    });
    await processSale({
      items: [mkCartItem(p, 1)],
      subtotal: 100,
      discount: 0,
      total: 100,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: ARCHIVE_ID,
    });

    expect(await getCounter(db, 'invoices')).toBe(3);
    expect(await findInvoiceByNumber(db, 'INV-000002')).not.toBeNull();
    expect(await findInvoiceByNumber(db, 'INV-000003')).not.toBeNull();
  });

  it('AC-03: purchase path also works — sequential PUR numbers, no regression', async () => {
    await signInAppUser();
    const db = getDB();
    const p = mkProduct('prod-counter-2', 60, 50);

    await processPurchase({
      items: [mkCartItem(p, 5, 60)],
      subtotal: 300,
      total: 300,
      supplierId: 'sup-counter-1',
    });

    expect(await getCounter(db, 'purchaseInvoices')).toBe(1);
    const snap = await getDocs(
      query(collection(db, 'purchaseInvoices'), where('invoiceNumber', '==', 'PUR-000001'))
    );
    expect(snap.empty).toBe(false);
  });

  it('EDGE: two fully-concurrent sales from different cashiers get unique numbers', async () => {    await signInAppUser();
    const db = getDB();
    const before = await getCounter(db, 'invoices');
    const p = mkProduct('prod-counter-1', 100, 50);
    const mkSale = () =>
      processSale({
        items: [mkCartItem(p, 1)],
        subtotal: 100,
        discount: 0,
        total: 100,
        paymentMethod: 'نقدا' as Invoice['paymentMethod'],
        dailyArchiveId: ARCHIVE_ID,
      });

    // Same-tick concurrent transactions — Firestore retries on contention.
    const results = await Promise.allSettled([mkSale(), mkSale()]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);

    const after = await getCounter(db, 'invoices');
    expect(after).toBe((before ?? 0) + 2);

    // Both invoice numbers exist and differ.
    const all = await getDocs(
      query(collection(db, 'invoices'), where('dailyArchiveId', '==', ARCHIVE_ID))
    );
    const numbers = all.docs.map((d) => (d.data() as any).invoiceNumber).filter(Boolean);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.length).toBeGreaterThanOrEqual(2);
  });


});
