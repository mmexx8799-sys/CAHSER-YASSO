// REQ-TX3-SUPRET (AUDIT-TX-3) — processSupplierReturn stable-key idempotency.
// RED-FIRST: written and run against UNCHANGED purchases.ts first (which
// takes TWO args, so the extra `{ opKey }` is ignored at runtime →
// same-key-twice MUST fail there with duplicates). tsc fails during RED
// for the same excess-arg reason and turns green only with the fix.
// Only then is the fix applied.
//
// KEY DERIVATION (no assumption — read from purchases.ts:180):
//   stored total = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0)
// Raw float sum, NO rounding in the write path. The fix hoists this exact
// expression above the transaction and reuses the ONE value for both the
// request fingerprint and the write — identical expression on identical
// inputs yields identical doubles, so a legitimate re-press can NEVER
// false-mismatch (a false mismatch on a legit repress is worse than a
// duplicate). round2 inside buildFingerprint absorbs float repr dust at
// compare time. The same-key-twice cases therefore use FRACTIONAL prices
// (33.33×3 cashier, 19.99×2 admin) to exercise the rounding path for real.
//
// Unit: docFingerprint ignores extra stored keys (returnNumber,
// supplierName, createdAt). Emulator (mock commit-then-error pattern from
// paymentRetry.test.ts): same-key-twice (cashier + admin), no-key-unchanged,
// ambiguous-deadline-manual-repress, mismatched-payload-same-key (fixed
// toast once, never generic), parallel-same-key (state only),
// in-session-repress (same success toast), key-format (pre-contact), plus
// the two edge cases: different-supplier-same-key and
// different-product-same-total-key.
//
// Stock guard and existence-read-first order are UNCHANGED (guard stays the
// second line of defense, exactly as in REQ-TX2-SUPRET).
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx3SupplierReturn.test.ts"
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
const { toast } = await import('react-hot-toast');
const { docFingerprint, fingerprintsEqual } = await import('../services/api/opKey');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
const toastErrorMock = vi.mocked(toast.error);
const toastSuccessMock = vi.mocked(toast.success);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-tx3supret@test.local'; // distinct from other test files
const ADMIN_EMAIL = 'admin-tx3supret@test.local';
const PASSWORD = 'secret123';

// Fractional prices — the rounding path is exercised for real. Expected
// totals use the SAME expression as the service write path.
const C_PRICE = 33.33, C_QTY = 3, C_TOT = C_PRICE * C_QTY;
const A_PRICE = 19.99, A_QTY = 2, A_TOT = A_PRICE * A_QTY;

// Fixed v4 UUIDs (3rd group 4xxx, 4th 8/9/a/bxxx) — deterministic per test.
const K_SAME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const K_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const K_DEADLINE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const K_MISMATCH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const K_PAR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const K_SESS = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const K_DIFFSUP = '11111111-1111-4111-8111-111111111112';
const K_DIFFPROD = '22222222-2222-4222-8222-222222222223';

const MISMATCH_MSG = 'سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة';
const SRT_OK_TOAST = 'تم تسجيل مرتجع المورد بنجاح!';
const SRT_FAIL_TOAST = 'حدث خطأ أثناء تسجيل مرتجع المورد.';

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

function mkReturn(supplierId: string, prodId: string, price: number, qty: number) {
  return [{ id: prodId, name: 'صنف', price, buyQuantity: qty }] as any;
}

async function readCounter() {
  const snap = await getDoc(doc(getDB(), 'counters', 'supplierReturns'));
  return snap.exists() ? ((snap.data() as any).lastNumber as number) : 0;
}

async function countDocs() {
  return (await getDocs(collection(getDB(), 'supplierReturns'))).size;
}

// Attempt 1 REALLY commits, then the response is "lost" with the given code.
function loseFirstResponseAs(code: string) {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr(code);
  });
}

// --- docFingerprint unit (stored-shape input) ------------------------------------

describe('REQ-TX3-SUPRET: docFingerprint unit', () => {
  it('ignores extra stored keys; equal shapes match', () => {
    const stored = {
      returnNumber: 'SRET-000007',
      items: [{ id: 'p', buyQuantity: 3, price: 33.33 }],
      total: 33.33 * 3, supplierId: 's', supplierName: 'مورد',
      createdAt: 123,
    };
    const req = { items: [{ id: 'p', buyQuantity: 3, price: 33.33 }], total: 33.33 * 3, supplierId: 's' };
    expect(fingerprintsEqual(docFingerprint(stored, 'supplierId'), docFingerprint(req, 'supplierId'))).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint(stored, 'supplierId'),
      docFingerprint({ ...req, total: 200 }, 'supplierId'),
    )).toBe(false);
  });
});

// --- processSupplierReturn stable-key emulator cases -------------------------------

describe('REQ-TX3-SUPRET: stable key lost-commit is idempotent', () => {
  it('supret-same-key-twice: 33.33×3, two calls same key → 1 doc, once-only, counter +1, 3 attempts', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: C_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_SAME } as any);
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_SAME } as any);

    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs(),
      storedTotal: ((await getDoc(doc(getDB(), 'supplierReturns', K_SAME))).data() as any).total,
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx3sr-sup'))).data() as any).balance,
      stock: ((await getDoc(doc(getDB(), 'products', 'tx3sr-prod'))).data() as any).quantity,
      counter: await readCounter(),
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    // Same expression as the service write path — bit-identical, not 99.99 literal.
    expect.soft(observed.storedTotal).toBe(C_TOT);
    expect.soft(observed.balance).toBe(0 - C_TOT);
    expect.soft(observed.stock).toBe(100 - C_QTY);
    expect.soft(observed.counter).toBe(before + 1);
  });

  it('supret-same-key-twice-admin: 19.99×2 as admin → 1 doc, once-only', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: A_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(ADMIN_EMAIL, 'admin');
    const before = await readCounter();

    loseFirstResponseAs('unavailable');
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', A_PRICE, A_QTY), 'tx3sr-sup', { opKey: K_ADMIN } as any);
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', A_PRICE, A_QTY), 'tx3sr-sup', { opKey: K_ADMIN } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'supplierReturns', K_ADMIN))).data() as any).total).toBe(A_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3sr-sup'))).data() as any).balance).toBe(0 - A_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3sr-prod'))).data() as any).quantity).toBe(100 - A_QTY);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: 10, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', 10, 1), 'tx3sr-sup');
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', 10, 1), 'tx3sr-sup');

    expect.soft(await countDocs()).toBe(2);
    expect.soft(await readCounter()).toBe(before + 2);
  });

  it('ambiguous-deadline-manual-repress: post-commit deadline-exceeded, same key → no-op, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: C_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    loseFirstResponseAs('deadline-exceeded');
    // First call surfaces the ambiguous failure (as the UI would show it).
    await expect(
      processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_DEADLINE } as any),
    ).rejects.toThrow('deadline-exceeded');
    // Manual re-press with the SAME key converges to a no-op success.
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_DEADLINE } as any);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3sr-sup'))).data() as any).balance).toBe(0 - C_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3sr-prod'))).data() as any).quantity).toBe(100 - C_QTY);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('mismatched-payload-same-key: seeded 1×33.33, call 3×33.33 → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('supplierReturns', K_MISMATCH, {
      items: [{ id: 'tx3sr-prod', name: 'صنف', price: C_PRICE, buyQuantity: 1 }],
      total: C_PRICE * 1, supplierId: 'tx3sr-sup', supplierName: 'مورد',
      returnNumber: 'SRET-000001', createdAt: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_MISMATCH } as any);
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
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SRT_FAIL_TOAST);
    // Nothing moved: doc unchanged, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'supplierReturns', K_MISMATCH))).data() as any).total).toBe(C_PRICE * 1);
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('parallel-same-key: two concurrent same-key calls → 1 doc, once-only, counter +1', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: C_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    await Promise.allSettled([
      processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_PAR } as any),
      processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: K_PAR } as any),
    ]);

    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3sr-sup'))).data() as any).balance).toBe(0 - C_TOT);
    expect.soft(((await getDoc(doc(getDB(), 'products', 'tx3sr-prod'))).data() as any).quantity).toBe(100 - C_QTY);
    expect.soft(await readCounter()).toBe(before + 1);
  });

  it('in-session-repress-doc-exists: same success toast, resolves, 1 doc', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'tx3sr-prod', { name: 'صنف', quantity: 100, price: C_PRICE, createdAt: Date.now() });
    await seed('suppliers', 'tx3sr-sup', { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    // Key held "in memory" (local var, submit-handler scope) across presses.
    const heldKey = K_SESS;
    loseFirstResponseAs('unavailable');
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: heldKey } as any);
    await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: heldKey } as any);

    expect.soft(toastSuccessMock).toHaveBeenCalledWith(SRT_OK_TOAST);
    expect.soft(await countDocs()).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3sr-sup'))).data() as any).balance).toBe(0 - C_TOT);
  });

  it('key-format: invalid key rejected before any Firestore contact', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-sup', { opKey: 'not-a-uuid' } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });

  it('different-supplier-same-key: seeded supplier A, same items/total with supplier B → OpKeyMismatchError, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('supplierReturns', K_DIFFSUP, {
      items: [{ id: 'tx3sr-prod', name: 'صنف', price: C_PRICE, buyQuantity: C_QTY }],
      total: C_TOT, supplierId: 'tx3sr-supA', supplierName: 'مورد أ',
      returnNumber: 'SRET-000001', createdAt: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processSupplierReturn(mkReturn('tx3sr-supB', 'tx3sr-prod', C_PRICE, C_QTY), 'tx3sr-supB', { opKey: K_DIFFSUP } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SRT_FAIL_TOAST);
    // Nothing moved: seeded doc keeps supplier A, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'supplierReturns', K_DIFFSUP))).data() as any).supplierId).toBe('tx3sr-supA');
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });

  it('different-product-same-total-key: seeded X×1/100, call Y×1/100 same key → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('supplierReturns', K_DIFFPROD, {
      items: [{ id: 'tx3sr-prodX', name: 'صنف س', price: 100, buyQuantity: 1 }],
      total: 100, supplierId: 'tx3sr-sup', supplierName: 'مورد',
      returnNumber: 'SRET-000001', createdAt: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');
    const before = await readCounter();

    let thrown: any = null;
    try {
      await processSupplierReturn(mkReturn('tx3sr-sup', 'tx3sr-prodY', 100, 1), 'tx3sr-sup', { opKey: K_DIFFPROD } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SRT_FAIL_TOAST);
    // Nothing moved: seeded doc keeps product X, counter untouched.
    expect.soft(((await getDoc(doc(getDB(), 'supplierReturns', K_DIFFPROD))).data() as any).items[0].id).toBe('tx3sr-prodX');
    expect.soft(await readCounter()).toBe(before);
    expect.soft(await countDocs()).toBe(1);
  });
});
