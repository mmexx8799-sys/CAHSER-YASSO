// TEST-REG-P0-1 — BUG-P0-1 regression test (integration, Firebase Emulator)
//
// Reproduces the processReturn crash when linking a return to an original invoice.
// Root cause (pre-fix): (transaction as any).get(returnsQuery) — transaction.get()
// only accepts DocumentReference in firebase v10; passing a Query throws before
// any network call.
//
// Run: npx firebase emulators:exec --only firestore,auth "npx vitest run"
//
// The test imports the REAL processReturn from services/api.ts. tests/setup.ts
// connects the app singletons (initializeFirestore()/getAuth()) to the local
// emulators — initializeFirestore() does NOT honor FIRESTORE_EMULATOR_HOST on
// its own, so the explicit connectFirestoreEmulator there is load-bearing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, Invoice, DailyArchive, CartItem } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { processReturn } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const TEST_EMAIL = 'cashier@test.local';
const TEST_PASSWORD = 'secret123';

/**
 * Signs the pre-created Auth Emulator user into the app singleton used by
 * api.ts. Returns the uid. Call seedFixtures with rules disabled to also
 * create the users/{uid} doc (admin-only create path in the rules).
 */
async function signInTestUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in — fine */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  return fbAuth.currentUser!.uid;
}

/**
 * Seeds the users/{uid} doc with rules disabled — mirrors how a real admin
 * provisions the cashier account before first use. Rules: isActiveUser()
 * requires the doc to exist without disabled=true.
 */
async function seedUserDocWithRulesDisabled(env: RulesTestEnvironment, uid: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL, role: 'cashier' });
  });
}

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

// --- Fixtures ---------------------------------------------------------------

async function seedFixtures(ctx: RulesTestContext, overrides: Partial<{ invoiceItems: Array<{ id: string; qty: number }>; priorReturns: Array<Array<{ id: string; qty: number }>> }> = {}) {
  const db = ctx.firestore();

  const product: Product = {
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    retailCashPrice: 100,
    retailCreditPrice: 100,
    wholesaleCashPrice: 80,
    wholesaleCreditPrice: 80,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };

  const archive: DailyArchive = {
    id: '2026-09-13',
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
  };

  const invoiceItems = overrides.invoiceItems ?? [{ id: 'prod-1', qty: 10 }];
  const mkCartItems = (arr: Array<{ id: string; qty: number }>): CartItem[] =>
    arr.map((x) => ({
      ...(x.id === 'prod-1' ? product : product),
      id: x.id,
      buyQuantity: x.qty,
      priceType: 'retail' as const,
      price: 100,
    }));

  const invoice: Invoice = {
    id: 'inv-1',
    invoiceNumber: 'INV-000001',
    items: mkCartItems(invoiceItems),
    subtotal: 1000,
    discount: 0,
    total: 1000,
    paymentMethod: 'نقدا' as Invoice['paymentMethod'],
    createdAt: Date.now(),
    dailyArchiveId: archive.id,
  };

  await setDoc(doc(db, 'products', product.id), { ...product, createdAt: Date.now() });
  await setDoc(doc(db, 'dailyArchives', archive.id), { ...archive, startTime: Date.now() } as any);
  await setDoc(doc(db, 'invoices', invoice.id), { ...invoice, createdAt: Date.now() } as any);

  // Optional prior partial returns linked to the same invoice.
  const priorReturns = overrides.priorReturns ?? [];
  for (let i = 0; i < priorReturns.length; i++) {
    const items = mkCartItems(priorReturns[i]);
    await setDoc(doc(db, 'returns', `prior-return-${i}`), {
      items,
      total: items.reduce((s, it) => s + it.price * it.buyQuantity, 0),
      createdAt: Date.now(),
      dailyArchiveId: archive.id,
      originalInvoiceId: invoice.id,
    });
  }

  return { product, archive, invoice, mkCartItems };
}

// --- Tests ------------------------------------------------------------------

describe('TEST-REG-P0-1: processReturn linked to original invoice (BUG-P0-1)', () => {
  beforeAll(async () => {
    // Create the Auth Emulator account once; the users/{uid} doc is seeded
    // per-test inside withSecurityRulesDisabled (admin-only create path).
    const fbAuth = getAuthInstance();
    try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
    try {
      await createUserWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
    } catch (e: any) {
      if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
    }
  });

  it('AC-01: linked return within remaining quantity succeeds and updates archive totalReturns', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedFixtures(ctx);
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);
    const items = [{ id: 'prod-1', code: 'P001', name: 'منتج اختبار', price: 100, quantity: 50, categoryId: 'cat-1', createdAt: Date.now(), searchableIndex: [], buyQuantity: 3, priceType: 'retail' } as CartItem];

    // processReturn runs its own runTransaction on the singleton db — which
    // points at the emulator because FIRESTORE_EMULATOR_HOST is set for the
    // whole process by initializeTestEnvironment.
    await processReturn(items, '2026-09-13', undefined, 'inv-1');

    const db = getDB();
    const returnSnap = await getDocs(collection(db, 'returns'));
    const linked = returnSnap.docs.filter((d) => d.data().originalInvoiceId === 'inv-1');
    expect(linked.length).toBe(1);
    expect((linked[0].data() as any).items[0].buyQuantity).toBe(3);

    const archiveDoc = await getDoc(doc(db, 'dailyArchives', '2026-09-13'));
    expect((archiveDoc.data() as any).totalReturns).toBe(300);
  });

  it('AC-02: returning more than remaining is rejected with a clear Arabic message (no raw JS exception)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedFixtures(ctx, { invoiceItems: [{ id: 'prod-1', qty: 5 }] });
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = [{ id: 'prod-1', code: 'P001', name: 'منتج اختبار', price: 100, quantity: 50, categoryId: 'cat-1', createdAt: Date.now(), searchableIndex: [], buyQuantity: 6, priceType: 'retail' } as CartItem];

    await expect(processReturn(items, '2026-09-13', undefined, 'inv-1')).rejects.toThrow(/تتجاوز|المتبقي/);

    const db = getDB();
    const returnSnap = await getDocs(collection(db, 'returns'));
    expect(returnSnap.empty).toBe(true); // nothing saved on rejection
  });

  it('AC-03: two sequential partial returns accumulate correctly', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedFixtures(ctx, { invoiceItems: [{ id: 'prod-1', qty: 10 }] });
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const mk = () => [{ id: 'prod-1', code: 'P001', name: 'منتج اختبار', price: 100, quantity: 50, categoryId: 'cat-1', createdAt: Date.now(), searchableIndex: [], buyQuantity: 4, priceType: 'retail' } as CartItem];

    await processReturn(mk(), '2026-09-13', undefined, 'inv-1'); // 4 of 10
    // Second partial return of 4 more (prior=4, remaining=6) must pass.
    await processReturn(mk(), '2026-09-13', undefined, 'inv-1'); // cumulative 8 of 10

    const db = getDB();
    const returnSnap = await getDocs(collection(db, 'returns'));
    const linked = returnSnap.docs.filter((d) => d.data().originalInvoiceId === 'inv-1');
    expect(linked.length).toBe(2);

    // Third return of 4 must now fail: prior=8, remaining=2.
    await expect(processReturn(mk(), '2026-09-13', undefined, 'inv-1')).rejects.toThrow(/تتجاوز|المتبقي/);

    const archiveDoc = await getDoc(doc(db, 'dailyArchives', '2026-09-13'));
    expect((archiveDoc.data() as any).totalReturns).toBe(800); // 2 × 400
  });

  it('AC-04: unlinked cash return (no originalInvoiceId) still works exactly as before', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { product } = await seedFixtures(ctx);
      void product;
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = [{ id: 'prod-1', code: 'P001', name: 'منتج اختبار', price: 100, quantity: 50, categoryId: 'cat-1', createdAt: Date.now(), searchableIndex: [], buyQuantity: 2, priceType: 'retail' } as CartItem];

    await processReturn(items, '2026-09-13'); // no originalInvoiceId

    const db = getDB();
    const returnSnap = await getDocs(collection(db, 'returns'));
    expect(returnSnap.docs.length).toBe(1);
    expect((returnSnap.docs[0].data() as any).originalInvoiceId).toBeUndefined();

    const archiveDoc = await getDoc(doc(db, 'dailyArchives', '2026-09-13'));
    expect((archiveDoc.data() as any).totalReturnsCash).toBe(200);
  });

  // --- Edge cases from SPEC ---------------------------------------------------

  it('EDGE: originalInvoiceId pointing to a deleted invoice is rejected clearly', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedFixtures(ctx);
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = makeRawCart(1);
    await expect(processReturn(items, '2026-09-13', undefined, 'inv-missing')).rejects.toThrow(/الفاتورة الأصلية غير موجودة/);
  });

  it('EDGE: return for a different customer than the credit invoice is rejected', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const { product, archive, invoice, mkCartItems } = await seedFixtures(ctx, { invoiceItems: [{ id: 'prod-1', qty: 5 }] });
      // Make the invoice a credit invoice for customer A.
      await setDoc(doc(db, 'customers', 'cust-a'), { name: 'عميل أ', balance: 0, createdAt: Date.now() } as any);
      await setDoc(doc(db, 'customers', 'cust-b'), { name: 'عميل ب', balance: 0, createdAt: Date.now() } as any);
      await setDoc(doc(db, 'invoices', invoice.id), { ...invoice, paymentMethod: 'آجل', customerId: 'cust-a', items: mkCartItems([{ id: 'prod-1', qty: 5 }]), createdAt: Date.now() } as any);
      void product; void archive;
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = makeRawCart(1);
    // Return tied to customer B while invoice belongs to customer A → reject.
    await expect(processReturn(items, '2026-09-13', { id: 'cust-b', name: 'عميل ب' }, 'inv-1')).rejects.toThrow(/لا تخص نفس العميل/);
  });

  it('EDGE: empty-string originalInvoiceId is treated as unlinked (undefined)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedFixtures(ctx);
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = makeRawCart(1);
    // Empty string must behave like no link at all — no invoice lookup path.
    await processReturn(items, '2026-09-13', undefined, '   ');

    const db = getDB();
    const returnSnap = await getDocs(collection(db, 'returns'));
    expect(returnSnap.docs.length).toBe(1);
    expect((returnSnap.docs[0].data() as any).originalInvoiceId).toBeUndefined();
  });

  it('EDGE: old invoice with missing/empty items array does not crash the calculation', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const { product, archive } = await seedFixtures(ctx);
      void product;
      await setDoc(doc(db, 'invoices', 'inv-1'), {
        id: 'inv-1',
        invoiceNumber: 'INV-000001',
        items: [], // legacy/corrupt invoice with no items
        subtotal: 0,
        discount: 0,
        total: 0,
        paymentMethod: 'نقدا',
        createdAt: Date.now(),
        dailyArchiveId: archive.id,
      } as any);
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    const items = makeRawCart(1);
    await expect(processReturn(items, '2026-09-13', undefined, 'inv-1')).rejects.toThrow(/غير موجود في الفاتورة الأصلية/);
  });
});

function makeRawCart(qty: number): CartItem[] {
  return [{
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
    buyQuantity: qty,
    priceType: 'retail',
  } as CartItem];
}
