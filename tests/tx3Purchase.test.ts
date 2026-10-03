// REQ-TX3-PURCHASE (AUDIT-TX-3) — processPurchase stable-key idempotency.
// RED-FIRST: written and run against UNCHANGED purchases.ts first (which
// takes ONE arg, so the extra `{ opKey }` is ignored at runtime →
// same-key-twice MUST fail there with duplicates). tsc fails during RED
// for the same excess-arg reason and turns green only with the fix.
// Only then is the fix applied.
//
// Unit: docFingerprint ignores extra stored keys (invoiceNumber,
// createdAt, names, priceFlagged); merge/order/rounding covered in tx3Sale.
// Emulator (mock commit-then-error pattern from paymentRetry.test.ts):
//  same-key-twice (cashier + admin), no-key-unchanged,
//  ambiguous-deadline-manual-repress, mismatched-payload-same-key (fixed
//  toast once, never generic), parallel-same-key (state only),
//  in-session-repress (same success toast), key-format (pre-contact).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx3Purchase.test.ts"
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
const { toast } = await import('react-hot-toast');
const { docFingerprint, fingerprintsEqual } = await import('../services/api/opKey');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx3purchase@test.local'; // distinct from other test files
const ADMIN_EMAIL = 'admin-tx3purchase@test.local';
const PASSWORD = 'secret123';

const UNIT_PRICE = 50;
// Fixed v4 UUIDs (3rd group 4xxx, 4th 8/9/a/bxxx) — deterministic per test.
const K_SAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const K_ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const K_DEADLINE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const K_MISMATCH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const K_PAR = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const K_SESS = '99999999-9999-4999-8999-999999999999';

const MISMATCH_MSG = 'سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة';
const PUR_OK_TOAST = 'تم تسجيل فاتورة الشراء بنجاح!';
const PUR_FAIL_TOAST = 'حدث خطأ أثناء تسجيل فاتورة الشراء.';

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
  for (const email of [CASHIER_EMAIL, ADMIN_EMAIL]) {
    try {
      await createUserWithEmailAndPassword(fbAuth, email, PASSWORD);
    } catch (e: any) {
      if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
    }
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

async function signInAs(email: string, role: string) {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, email, PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email, role });
  });
  return uid;
}

async function seed(path: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path, id), data);
  });
}

function mkPurchase(supplierId: string, qty = 2, price = UNIT_PRICE) {
  return {
    items: [{ id: 'tx3p-prod', name: 'صنف', price, buyQuantity: qty }],
    subtotal: price * qty,
    total: price * qty,
    supplierId,
  } as any;
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'purchaseInvoices'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

async function countDocs() {
  return (await getDocs(collection(getDB(), 'purchaseInvoices'))).size;
}

// Attempt 1 REALLY commits, then the response is "lost" with the given code.
function loseFirstResponseAs(code: string) {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr(code);
  });
}

// --- docFingerprint unit (stored-shape input) ------------------------------------

describe('REQ-TX3-PURCHASE: docFingerprint unit', () => {
  it('ignores extra stored keys; equal shapes match', () => {
    const stored = {
      invoiceNumber: 'PUR-000007', items: [{ id: 'p', buyQuantity: 2, price: 50 }],
      subtotal: 100, total: 100, supplierId: 's', supplierName: 'مورد',
      priceFlagged: false, createdAt: 123,
    };
    const req = { items: [{ id: 'p', buyQuantity: 2, price: 50 }], subtotal: 100, total: 100, supplierId: 's' };
    expect(fingerprintsEqual(docFingerprint(stored, 'supplierId'), docFingerprint(req, 'supplierId'))).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint(stored, 'supplierId'),
      docFingerprint({ ...req, total: 200 }, 'supplierId'),
    )).toBe(false);
  });
});

// --- processPurchase stable-key emulator cases ------------------------------------

describe('REQ-TX3-PURCHASE: stable key lost-commit is idempotent', () => {
  it('purchase-same-key-twice: 2×50, two calls same key → 1 doc, once-only, counter +1, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: K_SAME } as any);
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: K_SAME } as any);

    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs(),
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx3p-sup'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3p-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(100);
    expect.soft(observed.stock).toBe(102);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('purchase-same-key-twice-admin: same shape as admin → 1 doc, once-only', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: K_ADMIN } as any);
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: K_ADMIN } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3p-sup'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3p-prod'))).data() as any).quantity).toBe(102);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await processPurchase(mkPurchase('tx3p-sup'));
    await processPurchase(mkPurchase('tx3p-sup'));

    expect.soft(await countDocs()).toBe(2);
    expect.soft(await readCounter()).toBe(before + 2);
  });

  it('ambiguous-deadline-manual-repress: post-commit deadline-exceeded, same key → no-op, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('deadline-exceeded');
    // First call surfaces the ambiguous failure (as the UI would show it).
    await expect(
      processPurchase(mkPurchase('tx3p-sup'), { opKey: K_DEADLINE } as any),
    ).rejects.toThrow('deadline-exceeded');
    // Manual re-press with the SAME key converges to a no-op success.
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: K_DEADLINE } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3p-sup'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3p-prod'))).data() as any).quantity).toBe(102);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('mismatched-payload-same-key: seeded total 100, call total 200 → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('purchaseInvoices', K_MISMATCH, {
      items: [{ id: 'tx3p-prod', name: 'صنف', price: 50, buyQuantity: 2 }],
      subtotal: 100, total: 100, supplierId: 'tx3p-sup',
      invoiceNumber: 'PUR-000001', createdAt: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processPurchase(mkPurchase('tx3p-sup', 4), { opKey: K_MISMATCH } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    // Business error: single attempt, no retry.
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    // Fixed toast exactly once — never the generic failure copy.
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(PUR_FAIL_TOAST);
    // Nothing moved: doc unchanged, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'purchaseInvoices', K_MISMATCH))).data() as any).total).toBe(100);
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('parallel-same-key: two concurrent same-key calls → 1 doc, once-only, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await Promise.allSettled([
      processPurchase(mkPurchase('tx3p-sup'), { opKey: K_PAR } as any),
      processPurchase(mkPurchase('tx3p-sup'), { opKey: K_PAR } as any),
    ]);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3p-sup'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3p-prod'))).data() as any).quantity).toBe(102);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('in-session-repress-doc-exists: same success toast, resolves, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3p-prod', { name: 'صنف', quantity: 100, price: UNIT_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3p-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    // Key held "in memory" (local var, submit-handler scope) across presses.
    const heldKey = K_SESS;
    loseFirstResponseAs('unavailable');
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: heldKey } as any);
    await processPurchase(mkPurchase('tx3p-sup'), { opKey: heldKey } as any);

    expect.soft(toastSuccessMock).toHaveBeenCalledWith(PUR_OK_TOAST);
    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3p-sup'))).data() as any).balance).toBe(100);
  });

  it('key-format: invalid key rejected before any Firestore contact', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await processPurchase(mkPurchase('tx3p-sup'), { opKey: 'not-a-uuid' } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });
});
