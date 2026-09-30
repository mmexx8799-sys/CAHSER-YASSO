// REQ-TX2-SUPRET (AUDIT-TX-2) — processSupplierReturn lost-commit idempotency.
// RED-FIRST: this file is written and run against UNCHANGED purchases.ts
// (processSupplierReturn region) first; case 1 MUST show duplicate/double/
// counter+2, case 2 MUST show the spurious stock-guard rejection although
// attempt 1 committed. Only then is the fix applied.
//
// 1. normal: return 1×10, stock 100, supplier balance 50 → 1
//    supplierReturns doc, balance 40 ONCE, stock 99 ONCE,
//    counters/supplierReturns +1 (no gap), exactly 2 attempts.
// 2. depletion-edge: stock == returned qty (10, return 10), supplier
//    balance 100. On OLD code the retry hits the stock guard
//    (0 < 10) and the call REJECTS although attempt 1 committed; the
//    error is captured into `observed` (test never aborts early).
//    On NEW code the call RESOLVES: 1 doc, stock 0, balance 90 once,
//    counter +1.
//
// All observed values are computed FIRST, then asserted softly, so a RED
// run lists every violated invariant. Mock replaces ONLY `runTransaction`
// (same pattern as tests/paymentRetry.test.ts); the wrapper under test is
// the REAL runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx2SupplierReturn.test.ts"
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
const { processSupplierReturn } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx2supret@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';

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
  // cashier holds supplier.ops by default matrix.
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

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'supplierReturns'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

// Attempt 1 REALLY commits, then the response is "lost".
function loseFirstResponse() {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr('unavailable');
  });
}

describe('REQ-TX2-SUPRET: supplier-return lost-commit is idempotent', () => {
  it('normal: 1×10, stock 100, balance 50 → 1 doc, balance 40, stock 99, counter +1, 2 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2s-prod', { name: 'صنف اختبار', quantity: 100, price: 10, createdAt: Date.now() });
    await seed('suppliers', 'tx2s-sup', { name: 'مورد', balance: 50, openingBalance: 50, createdAt: Date.now() });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    await processSupplierReturn(
      [{ id: 'tx2s-prod', name: 'صنف اختبار', price: 10, buyQuantity: 1 } as any],
      'tx2s-sup',
    );

    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: (await getDocs(collection(getDB(), 'supplierReturns'))).size,
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx2s-sup'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2s-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(40); // 50 − total(10×1)=40, moved ONCE
    expect.soft(observed.stock).toBe(99); // 100 − buyQuantity(1), moved ONCE
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('depletion-edge: stock 10, return 10 → resolves, 1 doc, stock 0, balance once, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2s-edge-prod', { name: 'صنف اختبار', quantity: 10, price: 10, createdAt: Date.now() });
    await seed('suppliers', 'tx2s-edge-sup', { name: 'مورد', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();
    const before = await readCounter();

    loseFirstResponse();
    // On OLD code the retry hits the stock guard (0 < 10) and REJECTS
    // although attempt 1 committed — capture it, never abort early.
    let threw: string | null = null;
    try {
      await processSupplierReturn(
        [{ id: 'tx2s-edge-prod', name: 'صنف اختبار', price: 10, buyQuantity: 10 } as any],
        'tx2s-edge-sup',
      );
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: (await getDocs(collection(getDB(), 'supplierReturns'))).size,
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx2s-edge-sup'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2s-edge-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toBeNull();
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(0); // 100 − total(10×10)=0, moved ONCE
    expect.soft(observed.stock).toBe(0);
    expect.soft(observed.counter).toBe(before + 1);
  });
});
