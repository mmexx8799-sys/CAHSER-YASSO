// REQ-TX3-RETURN (AUDIT-TX-3) — processReturn stable-key idempotency.
// RED-FIRST: written and run against UNCHANGED returns.ts first (which
// takes FIVE params, so the extra 6th `{ opKey }` is ignored at runtime →
// same-key-twice MUST fail there with duplicates, and the linked-full
// re-press MUST fail the remaining-quantity check). tsc fails during RED
// for the same excess-arg reason and turns green only with the fix.
// Only then is the fix applied.
//
// KEY DERIVATION (no assumption — read from services/api/returns.ts):
//   stored total = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0)
// Raw float sum, NO rounding in the write path. The fix hoists this exact
// expression above the transaction and reuses the ONE value for both the
// request fingerprint and the write — identical expression on identical
// inputs yields identical doubles, so a legitimate re-press can NEVER
// false-mismatch (worse than a duplicate). round2 inside buildFingerprint
// absorbs float repr dust at compare time. The unlinked-cash case uses a
// FRACTIONAL price (33.33×3) to exercise the rounding path for real.
//
// FINGERPRINT (per spec): request side uses the NORMALIZED linkedInvoiceId
// (trimmed, '' → undefined — same normalization as the write path, never
// the raw param); party = customer?.id ?? null. Comparison set = pairs
// (id,buyQuantity) + total + customerId + originalInvoiceId + dailyArchiveId,
// each null-normalized on BOTH sides (links compared alongside the
// fingerprint — the unit test pins that the fingerprint alone ignores them).
//
// Validation (assertValidOpKey) is the FIRST line — before assertOnline()
// and before the pre-transaction getDocs(returnsQuery). opts is the SIXTH
// param after __testOnRetry; tests pass undefined for the 5th.
//
// Existence-read-first order and the stock/remaining-quantity guards are
// UNCHANGED (remaining check stays the second line of defense, exactly as
// in REQ-TX2-RETURN).
//
// Cases (cashier unless noted): unlinked-cash-same-key-twice ×2
// (cashier+admin, fractional), linked-full-10/10-same-key-twice ×2
// (cashier+admin, RQ/balance/stock/archive/counter once),
// linked-partial-4/10-same-key-twice ×2 (cashier+admin),
// re-press-fully-returned-linked (ambiguous deadline on full 10/10 →
// manual re-press RESOLVES, never trips the remaining check),
// mismatched-total, different-invoice-same-items-total,
// different-customer-same-key, different-dailyArchive-same-key,
// parallel-same-key, key-format (pre-contact), no-key-unchanged.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx3Return.test.ts"
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
const { toast } = await import('react-hot-toast');
const { docFingerprint, fingerprintsEqual } = await import('../services/api/opKey');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx3return@test.local'; // distinct from other test files
const ADMIN_EMAIL = 'admin-tx3return@test.local';
const PASSWORD = 'secret123';

// Fractional price for the cash case — expectations use the SAME expression
// as the service write path (bit-identical, not a 99.99 literal).
const C_PRICE = 33.33, C_QTY = 3, C_TOT = C_PRICE * C_QTY;
const PRICE = 12;

// Fixed v4 UUIDs (3rd group 4xxx, 4th 8/9/a/bxxx) — deterministic per test.
const K_CASH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const K_CASH_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const K_FULL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const K_FULL_ADMIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const K_PART = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const K_PART_ADMIN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const K_REPRESS = '11111111-1111-4111-8111-111111111113';
const K_MISMATCH = '22222222-2222-4222-8222-222222222224';
const K_DIFFINV = '33333333-3333-4333-8333-333333333335';
const K_DIFFCUST = '44444444-4444-4444-8444-444444444446';
const K_DIFFDAY = '55555555-5555-4555-8555-555555555557';
const K_PAR = '66666666-6666-4666-8666-666666666668';

const MISMATCH_MSG = 'سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة';
const RET_OK_TOAST = 'تمت عملية الإرجاع بنجاح!';
const RET_FAIL_TOAST = 'حدث خطأ أثناء عملية الإرجاع.';

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

function mkProductDoc(price: number, quantity: number) {
  return {
    name: 'صنف اختبار', quantity, price,
    retailCashPrice: price, retailCreditPrice: price,
    wholesaleCashPrice: price, wholesaleCreditPrice: price,
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

function mkItem(id: string, price: number, qty: number) {
  return { id, name: 'صنف اختبار', price, buyQuantity: qty, priceType: 'retail' } as any;
}

function mkInvoiceDoc(prodId: string, price: number, qty: number) {
  return {
    items: [{ id: prodId, name: 'صنف اختبار', buyQuantity: qty, price }],
    createdAt: Date.now(),
  };
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'returns'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

async function countDocs() {
  return (await getDocs(collection(getDB(), 'returns'))).size;
}

async function readRQ(invId: string, prodId: string) {
  return ((((await getDoc(doc(getDB(), 'invoices', invId))).data() as any).returnedQuantities || {})[prodId]);
}

// Attempt 1 REALLY commits, then the response is "lost" with the given code.
function loseFirstResponseAs(code: string) {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr(code);
  });
}

// --- docFingerprint unit (stored-shape input) ------------------------------------

describe('REQ-TX3-RETURN: docFingerprint unit', () => {
  it('ignores extra stored keys; links compared separately from the fingerprint', () => {
    const stored = {
      returnNumber: 'RET-000007',
      items: [{ id: 'p', buyQuantity: 3, price: 33.33 }],
      total: 33.33 * 3, customerId: 'c', customerName: 'عميل',
      originalInvoiceId: 'inv', dailyArchiveId: 'day', createdAt: 123,
    };
    const req = { items: [{ id: 'p', buyQuantity: 3, price: 33.33 }], total: 33.33 * 3, customerId: 'c' };
    expect(fingerprintsEqual(docFingerprint(stored, 'customerId'), docFingerprint(req, 'customerId'))).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint(stored, 'customerId'),
      docFingerprint({ ...req, total: 200 }, 'customerId'),
    )).toBe(false);
    // Pins the two-layer design: link fields live OUTSIDE the fingerprint —
    // a day-only difference is fingerprint-equal, so the service compares
    // originalInvoiceId/dailyArchiveId alongside (null-normalized).
    expect(fingerprintsEqual(
      docFingerprint({ ...stored, dailyArchiveId: 'other-day' }, 'customerId'),
      docFingerprint(req, 'customerId'),
    )).toBe(true);
  });
});

// --- processReturn stable-key emulator cases ---------------------------------------

describe('REQ-TX3-RETURN: stable key lost-commit is idempotent', () => {
  it('unlinked-cash-same-key-twice: 33.33×3 no customer, two calls same key → 1 doc, all move once, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-prod', mkProductDoc(C_PRICE, 100));
    await seed('dailyArchives', 'tx3rt-day', mkArchiveDoc());
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_CASH } as any);
    await processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_CASH } as any);

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3rt-day'))).data() as any);
    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs(),
      // Same expression as the service write path — bit-identical.
      storedTotal: ((await getDoc(doc(getDB(), 'returns', K_CASH))).data() as any).total,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3rt-prod'))).data() as any).quantity,
      totalReturns: arch.totalReturns,
      cash: arch.totalReturnsCash,
      onAccount: arch.totalReturnsOnAccount,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.storedTotal).toBe(C_TOT);
    expect.soft(observed.stock).toBe(100 + C_QTY);
    expect.soft(observed.totalReturns).toBe(C_TOT);
    expect.soft(observed.cash).toBe(C_TOT);
    expect.soft(observed.onAccount).toBe(0);
    expect.soft(observed.counter).toBe(before + 1);
    expect.soft(toastSuccessMock).toHaveBeenCalledWith(RET_OK_TOAST);
  });

  it('unlinked-cash-same-key-twice-admin: 33.33×3 as admin → 1 doc, all move once', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-prod', mkProductDoc(C_PRICE, 100));
    await seed('dailyArchives', 'tx3rt-day', mkArchiveDoc());
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_CASH_ADMIN } as any);
    await processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_CASH_ADMIN } as any);

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3rt-day'))).data() as any);
    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_CASH_ADMIN))).data() as any).total).toBe(C_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3rt-prod'))).data() as any).quantity).toBe(100 + C_QTY);
    expect.soft(arch.totalReturns).toBe(C_TOT);
    expect.soft(arch.totalReturnsCash).toBe(C_TOT);
    expect.soft(arch.totalReturnsOnAccount).toBe(0);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('linked-full-same-key-twice: 10/10 ×12, two calls same key → 1 doc, RQ 10, balance/stock/archive/counter once, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-full-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-full-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-full-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-full-inv', mkInvoiceDoc('tx3rt-full-prod', PRICE, 10));
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-full-prod', PRICE, 10)], 'tx3rt-full-day', { id: 'tx3rt-full-cust', name: 'عميل' }, 'tx3rt-full-inv', undefined, { opKey: K_FULL } as any);
    await processReturn([mkItem('tx3rt-full-prod', PRICE, 10)], 'tx3rt-full-day', { id: 'tx3rt-full-cust', name: 'عميل' }, 'tx3rt-full-inv', undefined, { opKey: K_FULL } as any);

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3rt-full-day'))).data() as any);
    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs(),
      rq: await readRQ('tx3rt-full-inv', 'tx3rt-full-prod'),
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx3rt-full-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3rt-full-prod'))).data() as any).quantity,
      totalReturns: arch.totalReturns,
      onAccount: arch.totalReturnsOnAccount,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.rq).toBe(10);
    expect.soft(observed.balance).toBe(200 - 10 * PRICE);
    expect.soft(observed.stock).toBe(110);
    expect.soft(observed.totalReturns).toBe(10 * PRICE);
    expect.soft(observed.onAccount).toBe(10 * PRICE);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('linked-full-same-key-twice-admin: 10/10 ×12 as admin → 1 doc, RQ 10, all move once', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-full-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-full-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-full-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-full-inv', mkInvoiceDoc('tx3rt-full-prod', PRICE, 10));
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-full-prod', PRICE, 10)], 'tx3rt-full-day', { id: 'tx3rt-full-cust', name: 'عميل' }, 'tx3rt-full-inv', undefined, { opKey: K_FULL_ADMIN } as any);
    await processReturn([mkItem('tx3rt-full-prod', PRICE, 10)], 'tx3rt-full-day', { id: 'tx3rt-full-cust', name: 'عميل' }, 'tx3rt-full-inv', undefined, { opKey: K_FULL_ADMIN } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(await readRQ('tx3rt-full-inv', 'tx3rt-full-prod')).toBe(10);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3rt-full-cust'))).data() as any).balance).toBe(80);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3rt-full-prod'))).data() as any).quantity).toBe(110);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('linked-partial-same-key-twice: 4/10 ×12, two calls same key → 1 doc, RQ 4, all move once, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-part-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-part-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-part-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-part-inv', mkInvoiceDoc('tx3rt-part-prod', PRICE, 10));
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-part-prod', PRICE, 4)], 'tx3rt-part-day', { id: 'tx3rt-part-cust', name: 'عميل' }, 'tx3rt-part-inv', undefined, { opKey: K_PART } as any);
    await processReturn([mkItem('tx3rt-part-prod', PRICE, 4)], 'tx3rt-part-day', { id: 'tx3rt-part-cust', name: 'عميل' }, 'tx3rt-part-inv', undefined, { opKey: K_PART } as any);

    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs(),
      rq: await readRQ('tx3rt-part-inv', 'tx3rt-part-prod'),
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx3rt-part-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3rt-part-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.rq).toBe(4);
    expect.soft(observed.balance).toBe(200 - 4 * PRICE);
    expect.soft(observed.stock).toBe(104);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('linked-partial-same-key-twice-admin: 4/10 ×12 as admin → 1 doc, RQ 4, all move once', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-part-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-part-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-part-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-part-inv', mkInvoiceDoc('tx3rt-part-prod', PRICE, 10));
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processReturn([mkItem('tx3rt-part-prod', PRICE, 4)], 'tx3rt-part-day', { id: 'tx3rt-part-cust', name: 'عميل' }, 'tx3rt-part-inv', undefined, { opKey: K_PART_ADMIN } as any);
    await processReturn([mkItem('tx3rt-part-prod', PRICE, 4)], 'tx3rt-part-day', { id: 'tx3rt-part-cust', name: 'عميل' }, 'tx3rt-part-inv', undefined, { opKey: K_PART_ADMIN } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(await readRQ('tx3rt-part-inv', 'tx3rt-part-prod')).toBe(4);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3rt-part-cust'))).data() as any).balance).toBe(152);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3rt-part-prod'))).data() as any).quantity).toBe(104);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('re-press-fully-returned-linked: ambiguous deadline on full 10/10, same-key re-press RESOLVES (never trips remaining check)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-rp-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-rp-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-rp-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-rp-inv', mkInvoiceDoc('tx3rt-rp-prod', PRICE, 10));
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('deadline-exceeded');
    // First call surfaces the ambiguous failure (as the UI would show it).
    await expect(
      processReturn([mkItem('tx3rt-rp-prod', PRICE, 10)], 'tx3rt-rp-day', { id: 'tx3rt-rp-cust', name: 'عميل' }, 'tx3rt-rp-inv', undefined, { opKey: K_REPRESS } as any),
    ).rejects.toThrow('deadline-exceeded');
    // Manual re-press with the SAME key converges to a no-op success — the
    // remaining-quantity check is never reached (guard returns first).
    let threw: string | null = null;
    try {
      await processReturn([mkItem('tx3rt-rp-prod', PRICE, 10)], 'tx3rt-rp-day', { id: 'tx3rt-rp-cust', name: 'عميل' }, 'tx3rt-rp-inv', undefined, { opKey: K_REPRESS } as any);
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: await countDocs(),
      rq: await readRQ('tx3rt-rp-inv', 'tx3rt-rp-prod'),
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx3rt-rp-cust'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3rt-rp-prod'))).data() as any).quantity,
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

  it('mismatched-total-same-key: seeded 1×100, call 2×100 same key → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('dailyArchives', 'tx3rt-mm-day', mkArchiveDoc());
    await seed('returns', K_MISMATCH, {
      items: [{ id: 'tx3rt-mm-prod', name: 'صنف', price: 100, buyQuantity: 1 }],
      total: 100, returnNumber: 'RET-000001', createdAt: Date.now(),
      dailyArchiveId: 'tx3rt-mm-day',
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processReturn([mkItem('tx3rt-mm-prod', 100, 2)], 'tx3rt-mm-day', undefined, undefined, undefined, { opKey: K_MISMATCH } as any);
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
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(RET_FAIL_TOAST);
    // Nothing moved: doc unchanged, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_MISMATCH))).data() as any).total).toBe(100);
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('different-invoice-same-items-total: seeded linked invA, call linked invB same items/total → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('dailyArchives', 'tx3rt-di-day', mkArchiveDoc());
    await seed('customers', 'tx3rt-di-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('returns', K_DIFFINV, {
      items: [{ id: 'tx3rt-di-prod', name: 'صنف', price: PRICE, buyQuantity: 1 }],
      total: PRICE, returnNumber: 'RET-000001', createdAt: Date.now(),
      dailyArchiveId: 'tx3rt-di-day',
      customerId: 'tx3rt-di-cust', customerName: 'عميل',
      originalInvoiceId: 'tx3rt-di-invA',
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processReturn([mkItem('tx3rt-di-prod', PRICE, 1)], 'tx3rt-di-day', { id: 'tx3rt-di-cust', name: 'عميل' }, 'tx3rt-di-invB', undefined, { opKey: K_DIFFINV } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(RET_FAIL_TOAST);
    // Nothing moved: seeded doc keeps invA, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_DIFFINV))).data() as any).originalInvoiceId).toBe('tx3rt-di-invA');
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('different-customer-same-key: seeded customer A, call customer B same items/total/invoice/day → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('dailyArchives', 'tx3rt-dc-day', mkArchiveDoc());
    await seed('invoices', 'tx3rt-dc-inv', mkInvoiceDoc('tx3rt-dc-prod', PRICE, 10));
    await seed('returns', K_DIFFCUST, {
      items: [{ id: 'tx3rt-dc-prod', name: 'صنف', price: PRICE, buyQuantity: 1 }],
      total: PRICE, returnNumber: 'RET-000001', createdAt: Date.now(),
      dailyArchiveId: 'tx3rt-dc-day',
      customerId: 'tx3rt-dc-custA', customerName: 'عميل أ',
      originalInvoiceId: 'tx3rt-dc-inv',
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processReturn([mkItem('tx3rt-dc-prod', PRICE, 1)], 'tx3rt-dc-day', { id: 'tx3rt-dc-custB', name: 'عميل ب' }, 'tx3rt-dc-inv', undefined, { opKey: K_DIFFCUST } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(RET_FAIL_TOAST);
    // Nothing moved: seeded doc keeps customer A, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_DIFFCUST))).data() as any).customerId).toBe('tx3rt-dc-custA');
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('different-dailyArchive-same-key: seeded dayA, call dayB same items/total/invoice/customer → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('dailyArchives', 'tx3rt-dd-dayA', mkArchiveDoc());
    await seed('customers', 'tx3rt-dd-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('invoices', 'tx3rt-dd-inv', mkInvoiceDoc('tx3rt-dd-prod', PRICE, 10));
    await seed('returns', K_DIFFDAY, {
      items: [{ id: 'tx3rt-dd-prod', name: 'صنف', price: PRICE, buyQuantity: 1 }],
      total: PRICE, returnNumber: 'RET-000001', createdAt: Date.now(),
      dailyArchiveId: 'tx3rt-dd-dayA',
      customerId: 'tx3rt-dd-cust', customerName: 'عميل',
      originalInvoiceId: 'tx3rt-dd-inv',
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processReturn([mkItem('tx3rt-dd-prod', PRICE, 1)], 'tx3rt-dd-dayB', { id: 'tx3rt-dd-cust', name: 'عميل' }, 'tx3rt-dd-inv', undefined, { opKey: K_DIFFDAY } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(RET_FAIL_TOAST);
    // Nothing moved: seeded doc keeps dayA, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_DIFFDAY))).data() as any).dailyArchiveId).toBe('tx3rt-dd-dayA');
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('parallel-same-key: two concurrent same-key unlinked calls → 1 doc, once-only, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-prod', mkProductDoc(C_PRICE, 100));
    await seed('dailyArchives', 'tx3rt-day', mkArchiveDoc());
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await Promise.allSettled([
      processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_PAR } as any),
      processReturn([mkItem('tx3rt-prod', C_PRICE, C_QTY)], 'tx3rt-day', undefined, undefined, undefined, { opKey: K_PAR } as any),
    ]);

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3rt-day'))).data() as any);
    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'returns', K_PAR))).data() as any).total).toBe(C_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3rt-prod'))).data() as any).quantity).toBe(100 + C_QTY);
    expect.soft(arch.totalReturns).toBe(C_TOT);
    expect.soft(arch.totalReturnsCash).toBe(C_TOT);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('key-format: invalid key rejected before any Firestore contact', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      // Linked args on purpose: on old/wrong ordering this would reach getDocs first.
      await processReturn([mkItem('tx3rt-prod', PRICE, 1)], 'tx3rt-day', { id: 'tx3rt-cust', name: 'عميل' }, 'tx3rt-inv', undefined, { opKey: 'not-a-uuid' } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });

  it('no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3rt-prod', mkProductDoc(PRICE, 100));
    await seed('dailyArchives', 'tx3rt-day', mkArchiveDoc());
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await processReturn([mkItem('tx3rt-prod', PRICE, 1)], 'tx3rt-day');
    await processReturn([mkItem('tx3rt-prod', PRICE, 1)], 'tx3rt-day');

    const arch = ((await getDoc(doc(getDB(), 'dailyArchives', 'tx3rt-day'))).data() as any);
    expect.soft(await countDocs()).toBe(2);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3rt-prod'))).data() as any).quantity).toBe(102);
    expect.soft(arch.totalReturns).toBe(2 * PRICE);
    expect.soft(arch.totalReturnsCash).toBe(2 * PRICE);
    expect.soft(await readCounter()).toBe(before + 2);
  });
});
