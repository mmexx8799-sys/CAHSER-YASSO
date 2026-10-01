// REQ-TX2-RETURN (AUDIT-TX-2) — processReturn lost-commit idempotency.
// RED-FIRST: this file is written and run against UNCHANGED returns.ts
// first. Case 1 MUST show duplicate/double/counter+2; case 2 MUST show the
// spurious "no remaining quantity" rejection although attempt 1 committed;
// case 3 MUST show duplicate + returnedQuantities 8 (not 4).
//
// Expected numbers, computed from services/api/returns.ts BEFORE writing:
//   totalReturnAmount = Σ price×buyQuantity; stock moves by buyQuantity;
//   customer present → balance −total, archive totalReturns+total and
//   totalReturnsOnAccount+total (NOT totalReturnsCash).
// 1. unlinked: return 1×12 (total 12), balance 50 → 38; stock 100 → 101;
//    archive totalReturns 12 + onAccount 12; counters/returns +1; 1 doc.
// 2. linked FULL: invoice buyQuantity 10, return 10×12 (total 120),
//    balance 200 → 80; stock 100 → 110; returnedQuantities == 10;
//    NEW code RESOLVES (OLD code rejects: remaining 0).
// 3. linked PARTIAL: invoice buyQuantity 10, return 4×12 (total 48),
//    balance 200 → 152; stock 100 → 104; returnedQuantities == 4
//    (OLD code writes 8 + duplicate doc).
//
// A thrown error is ALWAYS captured into `observed.threw` (never aborts);
// all values observed first, then asserted softly. Mock replaces ONLY
// `runTransaction` (same pattern as tests/paymentRetry.test.ts); the
// wrapper under test is the REAL runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx2Return.test.ts"
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
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
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
const { processReturn } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx2return@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';

const PRICE = 12;

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
  // cashier holds return by default matrix.
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

function mkProductDoc(quantity: number) {
  return {
    name: 'صنف اختبار', quantity, price: PRICE,
    retailCashPrice: PRICE, retailCreditPrice: PRICE,
    wholesaleCashPrice: PRICE, wholesaleCreditPrice: PRICE,
    categoryId: 'cat-1', createdAt: Date.now(),
  };
}

function mkArchiveDoc() {
  return {
    startTime: Date.now(), status: 'open',
    totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0,
    totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0,
    totalReturnsOnAccount: 0,
  } as any;
}

function mkItem(id: string, qty: number) {
  return { id, name: 'صنف اختبار', price: PRICE, buyQuantity: qty, priceType: 'retail' } as any;
}

// Attempt 1 REALLY commits, then the response is "lost".
function loseFirstResponse() {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr('unavailable');
  });
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'returns'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

describe('REQ-TX2-RETURN: return lost-commit is idempotent', () => {
  it('unlinked: 1×12 with customer → 1 doc, balance 38, stock 101, returns+12/+12, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2r-prod', mkProductDoc(100));
    await seed('dailyArchives', 'tx2r-day', mkArchiveDoc());
    await seed('customers', 'tx2r-cust', { name: 'عميل', balance: 50, openingBalance: 50, createdAt: Date.now() });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    let threw: string | null = null;
    try {
      await processReturn([mkItem('tx2r-prod', 1)], 'tx2r-day', { id: 'tx2r-cust', name: 'عميل' });
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx2r-day'))).data() as any);
    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: (await getDocs(collection(getDB(), 'returns'))).size,
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx2r-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2r-prod'))).data() as any).quantity,
      totalReturns: arch.totalReturns,
      onAccount: arch.totalReturnsOnAccount,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toBeNull();
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(38);
    expect.soft(observed.stock).toBe(101);
    expect.soft(observed.totalReturns).toBe(12);
    expect.soft(observed.onAccount).toBe(12);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('linked FULL (10 of 10): resolves, 1 doc, RQ == 10, balance 80, stock 110, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2r-full-prod', mkProductDoc(100));
    await seed('dailyArchives', 'tx2r-full-day', mkArchiveDoc());
    await seed('customers', 'tx2r-full-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx2r-full-inv', {
      items: [{ id: 'tx2r-full-prod', name: 'صنف اختبار', buyQuantity: 10, price: PRICE }],
      createdAt: Date.now(),
    });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    let threw: string | null = null;
    try {
      await processReturn([mkItem('tx2r-full-prod', 10)], 'tx2r-full-day', { id: 'tx2r-full-cust', name: 'عميل' }, 'tx2r-full-inv');
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: (await getDocs(collection(getDB(), 'returns'))).size,
      rq: (((await getDoc(doc(getDB(), 'invoices', 'tx2r-full-inv'))).data() as any).returnedQuantities || {})['tx2r-full-prod'],
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx2r-full-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2r-full-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toBeNull();
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.rq).toBe(10);
    expect.soft(observed.balance).toBe(80);
    expect.soft(observed.stock).toBe(110);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('linked PARTIAL (4 of 10): 1 doc, RQ == 4, balance 152, stock 104, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2r-part-prod', mkProductDoc(100));
    await seed('dailyArchives', 'tx2r-part-day', mkArchiveDoc());
    await seed('customers', 'tx2r-part-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx2r-part-inv', {
      items: [{ id: 'tx2r-part-prod', name: 'صنف اختبار', buyQuantity: 10, price: PRICE }],
      createdAt: Date.now(),
    });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    let threw: string | null = null;
    try {
      await processReturn([mkItem('tx2r-part-prod', 4)], 'tx2r-part-day', { id: 'tx2r-part-cust', name: 'عميل' }, 'tx2r-part-inv');
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: (await getDocs(collection(getDB(), 'returns'))).size,
      rq: (((await getDoc(doc(getDB(), 'invoices', 'tx2r-part-inv'))).data() as any).returnedQuantities || {})['tx2r-part-prod'],
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx2r-part-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2r-part-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toBeNull();
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.rq).toBe(4);
    expect.soft(observed.balance).toBe(152);
    expect.soft(observed.stock).toBe(104);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('unlinked-cash-no-customer: 2×12, no customer → 1 doc, stock 102, cash +24, onAccount 0, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2r-cash-prod', mkProductDoc(100));
    await seed('dailyArchives', 'tx2r-cash-day', mkArchiveDoc());
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    let threw: string | null = null;
    try {
      await processReturn([mkItem('tx2r-cash-prod', 2)], 'tx2r-cash-day');
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx2r-cash-day'))).data() as any);
    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: (await getDocs(collection(getDB(), 'returns'))).size,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2r-cash-prod'))).data() as any).quantity,
      totalReturns: arch.totalReturns,
      cash: arch.totalReturnsCash,
      onAccount: arch.totalReturnsOnAccount,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toBeNull();
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.stock).toBe(102);
    expect.soft(observed.totalReturns).toBe(24);
    expect.soft(observed.cash).toBe(24);
    expect.soft(observed.onAccount).toBe(0);
    expect.soft(observed.counter).toBe(before + 1);
  });
});
