// REQ-TX2-SALE (AUDIT-TX-2) — processSale lost-commit idempotency.
// RED-FIRST: this file is written and run against UNCHANGED sales.ts first;
// both tests MUST fail there (duplicate invoice / double movement / +2
// counter), proving they pin the guard. Only then is the fix applied.
//
// 1. credit-lost-commit: credit sale 1×100 on balance 0; attempt 1 really
//    commits, then the response is "lost" (unavailable); asserts exactly 1
//    invoice doc, balance +100 ONCE, stock −1 ONCE, archive +100 ONCE,
//    counters/invoices +1 (no gap).
// 2. cash-multiproduct-lost-commit: cash sale, 2 different products ×100;
//    asserts 1 invoice doc, EACH stock −qty ONCE, archive totalSales and
//    totalCash +200 ONCE, counters/invoices +1 (no gap).
//
// Mock replaces ONLY `runTransaction` (same pattern as
// tests/paymentRetry.test.ts); every other export and the default
// per-test implementation delegate to the real module, so the wrapper
// under test is the REAL runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx2Sale.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: vi.fn() };
});

// tests/setup.ts already mocks react-hot-toast before these imports.
const { processSale } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx2sale@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';

const UNIT_PRICE = 100;

function retryableErr(code: string): Error {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

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

beforeEach(() => {
  vi.clearAllMocks();
  runTxMock.mockReset();
  // Default: real transaction (tests override the first call per-case).
  runTxMock.mockImplementation((db: any, fn: any) => actualFs.runTransaction(db, fn));
});

async function signInCashier() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, CASHIER_EMAIL, CASHIER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // cashier holds sell by default matrix.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: CASHIER_EMAIL, role: 'cashier' });
  });
  return uid;
}

async function seed(path: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path, id), data);
  });
}

function mkProductDoc() {
  return {
    name: 'صنف اختبار',
    price: UNIT_PRICE,
    retailCashPrice: UNIT_PRICE,
    retailCreditPrice: UNIT_PRICE,
    wholesaleCashPrice: UNIT_PRICE,
    wholesaleCreditPrice: UNIT_PRICE,
    quantity: 5000,
    categoryId: 'cat-1',
    createdAt: Date.now(),
  };
}

function mkArchiveDoc() {
  return {
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
  } as any;
}

function mkItem(id: string, qty = 1) {
  return { id, name: 'صنف اختبار', price: UNIT_PRICE, buyQuantity: qty, priceType: 'retail' } as any;
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'invoices'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

async function countInvoices() {
  return (await getDocs(collection(getDB(), 'invoices'))).size;
}

// Attempt 1 REALLY commits, then the response is "lost".
function loseFirstResponse() {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr('unavailable');
  });
}

describe('REQ-TX2-SALE: sale lost-commit is idempotent', () => {
  it('credit-lost-commit: 1×100 on balance 0 → 1 doc, balance 100, stock −1, archive +100, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2-prod', mkProductDoc());
    await seed('dailyArchives', 'tx2-day', mkArchiveDoc());
    await seed('customers', 'tx2-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    await processSale({
      items: [mkItem('tx2-prod')],
      subtotal: UNIT_PRICE,
      discount: 0,
      total: UNIT_PRICE,
      paymentMethod: 'آجل' as any,
      customerId: 'tx2-cust',
      dailyArchiveId: 'tx2-day',
    } as any);

    expect(await countInvoices()).toBe(1);
    expect(((await getDoc(doc(getDB(), 'customers', 'tx2-cust'))).data() as any).balance).toBe(100);
    expect(((await getDoc(doc(getDB(), 'products', 'tx2-prod'))).data() as any).quantity).toBe(4999);
    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx2-day'))).data() as any);
    expect(arch.totalSales).toBe(100);
    expect(arch.totalCredit).toBe(100);
    expect(await readCounter()).toBe(before + 1);
  });

  it('cash-multiproduct-lost-commit: 2×100 cash → 1 doc, each stock −1, totals +200, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2-pa', mkProductDoc());
    await seed('products', 'tx2-pb', mkProductDoc());
    await seed('dailyArchives', 'tx2-day2', mkArchiveDoc());
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    await processSale({
      items: [mkItem('tx2-pa'), mkItem('tx2-pb')],
      subtotal: 2 * UNIT_PRICE,
      discount: 0,
      total: 2 * UNIT_PRICE,
      paymentMethod: 'نقدا' as any,
      dailyArchiveId: 'tx2-day2',
    } as any);

    expect(await countInvoices()).toBe(1);
    expect(((await getDoc(doc(getDB(), 'products', 'tx2-pa'))).data() as any).quantity).toBe(4999);
    expect(((await getDoc(doc(getDB(), 'products', 'tx2-pb'))).data() as any).quantity).toBe(4999);
    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx2-day2'))).data() as any);
    expect(arch.totalSales).toBe(200);
    expect(arch.totalCash).toBe(200);
    expect(await readCounter()).toBe(before + 1);
  });
});
