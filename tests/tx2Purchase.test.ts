// REQ-TX2-PURCHASE (AUDIT-TX-2) — processPurchase lost-commit idempotency.
// RED-FIRST: this file is written and run against UNCHANGED purchases.ts
// first; the test MUST fail there (duplicate docs / double movement / +2
// counter). Only then is the fix applied.
//
// purchase-lost-commit: purchase 2×50 on supplier balance 0, stock 100;
// attempt 1 really commits, then the response is "lost" (unavailable).
// All observed values are computed FIRST, then asserted together, so a RED
// run reports every violated invariant (not just the first):
//   - wrapper invoked exactly twice (retry really happened)
//   - exactly 1 purchaseInvoices doc
//   - supplier balance +100 ONCE, stock +qty ONCE
//   - counters/purchaseInvoices +1 (no gap)
//
// Mock replaces ONLY `runTransaction` (same pattern as
// tests/paymentRetry.test.ts); the wrapper under test is the REAL
// runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx2Purchase.test.ts"
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
const { processPurchase } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx2purchase@test.local'; // distinct from other test files
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
  const snap = await getDoc(doc(getDB(), 'counters', 'purchaseInvoices'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

describe('REQ-TX2-PURCHASE: purchase lost-commit is idempotent', () => {
  it('purchase-lost-commit: 2×50 on balance 0 → 1 doc, balance 100, stock +2, counter +1, 2 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx2p-prod', {
      name: 'صنف اختبار', quantity: 100, price: 50,
      createdAt: Date.now(),
    });
    await seed('suppliers', 'tx2p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInCashier();
    const before = await readCounter();

    // Attempt 1 REALLY commits, then the response is "lost".
    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    await processPurchase({
      items: [{ id: 'tx2p-prod', name: 'صنف اختبار', price: 50, buyQuantity: 2 } as any],
      subtotal: 100,
      total: 100,
      supplierId: 'tx2p-sup',
    });

    // Observe everything first, assert softly — a RED run must show ALL
    // violated invariants in one output, not stop at the first.
    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: (await getDocs(collection(getDB(), 'purchaseInvoices'))).size,
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx2p-sup'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx2p-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(100);
    expect.soft(observed.stock).toBe(102);
    expect.soft(observed.counter).toBe(before + 1);
  });
});
