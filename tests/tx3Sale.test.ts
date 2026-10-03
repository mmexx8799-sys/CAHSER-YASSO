// REQ-TX3-SALE (AUDIT-TX-3) — processSale stable-key idempotency.
// RED-FIRST: this file is written and run against UNCHANGED sales.ts first.
// The old signature takes ONE arg, so the extra `{ opKey }` arg is ignored
// at runtime → same-key-twice tests MUST fail there (2 docs / double
// movement / counter +2). (tsc fails during RED for the same reason —
// excess arg — and turns green only with the fix; reported honestly.)
// Only then is the fix applied.
//
// Unit describes (opKey.ts, no Firestore): v4 validation accept/reject,
// fingerprint merge/order/rounding/party rules, OpKeyMismatchError shape.
// Emulator cases (mock commit-then-error pattern from paymentRetry.test.ts):
//  sale-same-key-twice (cashier + admin), no-key-unchanged,
//  ambiguous-deadline-manual-repress, mismatched-payload-same-key (fixed
//  toast asserted), parallel-same-key (state only), in-session-repress
//  (same success toast).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx3Sale.test.ts"
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
const { processSale } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');
const { toast } = await import('react-hot-toast');
const {
  assertValidOpKey,
  buildFingerprint,
  fingerprintsEqual,
  OpKeyMismatchError,
  OP_KEY_MISMATCH_CODE,
} = await import('../services/api/opKey');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx3sale@test.local'; // distinct from other test files
const ADMIN_EMAIL = 'admin-tx3sale@test.local';
const PASSWORD = 'secret123';

const UNIT_PRICE = 100;
// Fixed v4 UUIDs (3rd group 4xxx, 4th 8/9/a/bxxx) — deterministic per test.
const K_SAME = '11111111-1111-4111-8111-111111111111';
const K_ADMIN = '22222222-2222-4222-8222-222222222222';
const K_DEADLINE = '33333333-3333-4333-8333-333333333333';
const K_MISMATCH = '44444444-4444-4444-8444-444444444444';
const K_PAR = '55555555-5555-4555-8555-555555555555';
const K_SESS = '66666666-6666-4666-8666-666666666666';

const MISMATCH_MSG = 'سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة';
const SALE_OK_TOAST = 'تمت عملية البيع بنجاح!';
const SALE_FAIL_TOAST = 'حدث خطأ أثناء عملية البيع.';

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

function mkProductDoc(quantity: number) {
  return {
    name: 'صنف اختبار', quantity, price: UNIT_PRICE,
    retailCashPrice: UNIT_PRICE, retailCreditPrice: UNIT_PRICE,
    wholesaleCashPrice: UNIT_PRICE, wholesaleCreditPrice: UNIT_PRICE,
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

function mkItem(id: string, qty = 1) {
  return { id, name: 'صنف اختبار', price: UNIT_PRICE, buyQuantity: qty, priceType: 'retail' } as any;
}

function mkCreditSale(customerId: string, archiveId: string, prodId = 'tx3-prod', qty = 1) {
  return {
    items: [mkItem(prodId, qty)],
    subtotal: UNIT_PRICE * qty,
    discount: 0,
    total: UNIT_PRICE * qty,
    paymentMethod: 'آجل' as any,
    customerId,
    dailyArchiveId: archiveId,
  } as any;
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'invoices'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

async function countInvoices() {
  return (await getDocs(collection(getDB(), 'invoices'))).size;
}

// Attempt 1 REALLY commits, then the response is "lost" with the given code.
function loseFirstResponseAs(code: string) {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr(code);
  });
}

// --- opKey.ts unit describes (no Firestore) ------------------------------------

describe('REQ-TX3-SALE: opKey helper unit', () => {
  it('valid v4 passes, undefined passes (old path)', () => {
    expect(() => assertValidOpKey(K_SAME)).not.toThrow();
    expect(() => assertValidOpKey(undefined)).not.toThrow();
  });

  it('non-v4 rejected: slash UUID, empty, legacy id, garbage', () => {
    for (const bad of ['11111111-1111-4111-8111/111111111111', '', 'INV-000001', 'not-a-key']) {
      expect(() => assertValidOpKey(bad)).toThrow('مفتاح العملية غير صالح');
    }
  });

  it('fingerprints: merge/order/rounding/party rules', () => {
    const base = buildFingerprint({ pairs: [['b', 1], ['a', 2]], total: 300, subtotal: 300, discount: 0, party: 'c1' });
    // Order-independent + duplicate same-id lines merged.
    expect(fingerprintsEqual(base, buildFingerprint({ pairs: [['a', 1], ['a', 1], ['b', 1]], total: 300, subtotal: 300, discount: 0, party: 'c1' }))).toBe(true);
    // Float dust does not break equality.
    expect(fingerprintsEqual(base, buildFingerprint({ pairs: [['a', 2], ['b', 1]], total: 300.0000001, subtotal: 300, discount: 0, party: 'c1' }))).toBe(true);
    // Missing party normalizes like explicit null.
    expect(fingerprintsEqual(
      buildFingerprint({ pairs: [['a', 1]], total: 1, party: undefined }),
      buildFingerprint({ pairs: [['a', 1]], total: 1, party: null }),
    )).toBe(true);
    // Differences detected.
    expect(fingerprintsEqual(base, buildFingerprint({ pairs: [['a', 2], ['b', 1]], total: 301, subtotal: 300, discount: 0, party: 'c1' }))).toBe(false);
    expect(fingerprintsEqual(base, buildFingerprint({ pairs: [['a', 2], ['b', 1]], total: 300, subtotal: 300, discount: 0, party: 'c2' }))).toBe(false);
    expect(fingerprintsEqual(base, buildFingerprint({ pairs: [['a', 1], ['b', 1]], total: 200, subtotal: 200, discount: 0, party: 'c1' }))).toBe(false);
  });

  it('OpKeyMismatchError: fixed code + Arabic message', () => {
    const e = new OpKeyMismatchError();
    expect(e.code).toBe(OP_KEY_MISMATCH_CODE);
    expect(e.code).toBe('opkey-mismatch');
    expect(e.message).toBe(MISMATCH_MSG);
  });
});

// --- processSale stable-key emulator cases --------------------------------------

describe('REQ-TX3-SALE: stable key lost-commit is idempotent', () => {
  it('sale-same-key-twice: credit 1×100, two calls same key → 1 doc, once-only, counter +1, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_SAME } as any);
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_SAME } as any);

    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countInvoices(),
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx3-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3-day'))).data() as any);
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(100);
    expect.soft(observed.stock).toBe(4999);
    expect.soft(arch.totalSales).toBe(100);
    expect.soft(arch.totalCredit).toBe(100);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('sale-same-key-twice-admin: same shape as admin → 1 doc, once-only', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_ADMIN } as any);
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_ADMIN } as any);

    expect.soft(await countInvoices()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3-cust'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3-prod'))).data() as any).quantity).toBe(4999);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await processSale(mkCreditSale('tx3-cust', 'tx3-day'));
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'));

    expect.soft(await countInvoices()).toBe(2);
    expect.soft(await readCounter()).toBe(before + 2);
  });

  it('ambiguous-deadline-manual-repress: post-commit deadline-exceeded, same key → no-op, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('deadline-exceeded');
    // First call surfaces the ambiguous failure (as the UI would show it).
    await expect(
      processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_DEADLINE } as any),
    ).rejects.toThrow('deadline-exceeded');
    // Manual re-press with the SAME key converges to a no-op success.
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_DEADLINE } as any);

    expect.soft(await countInvoices()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3-cust'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3-prod'))).data() as any).quantity).toBe(4999);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('mismatched-payload-same-key: seeded total 100, call total 200 → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('invoices', K_MISMATCH, {
      items: [{ id: 'tx3-prod', name: 'صنف', price: 100, buyQuantity: 1 }],
      subtotal: 100, discount: 0, total: 100, customerId: 'tx3-cust',
      paymentMethod: 'نقدا', dailyArchiveId: 'tx3-day',
      invoiceNumber: 'INV-000001', createdAt: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processSale(mkCreditSale('tx3-cust', 'tx3-day', 'tx3-prod', 2), { opKey: K_MISMATCH } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe(OP_KEY_MISMATCH_CODE);
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    // Business error: single attempt, no retry.
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    // Fixed toast exactly once — never the generic failure copy.
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SALE_FAIL_TOAST);
    // Nothing moved: doc unchanged, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'invoices', K_MISMATCH))).data() as any).total).toBe(100);
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countInvoices()).toBe(1);
  });

  it('parallel-same-key: two concurrent same-key calls → 1 doc, once-only, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await Promise.allSettled([
      processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_PAR } as any),
      processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: K_PAR } as any),
    ]);

    expect.soft(await countInvoices()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3-cust'))).data() as any).balance).toBe(100);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3-prod'))).data() as any).quantity).toBe(4999);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('in-session-repress-doc-exists: same success toast, resolves, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3-prod', mkProductDoc(5000));
    await seed('dailyArchives', 'tx3-day', mkArchiveDoc());
    await seed('customers', 'tx3-cust', { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    // Key held "in memory" (local var, submit-handler scope) across presses.
    const heldKey = K_SESS;
    loseFirstResponseAs('unavailable');
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: heldKey } as any);
    await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: heldKey } as any);

    expect.soft(toastSuccessMock).toHaveBeenCalledWith(SALE_OK_TOAST);
    expect.soft(await countInvoices()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3-cust'))).data() as any).balance).toBe(100);
  });

  it('key-format: invalid key rejected before any Firestore contact', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await processSale(mkCreditSale('tx3-cust', 'tx3-day'), { opKey: 'not-a-uuid' } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });
});
