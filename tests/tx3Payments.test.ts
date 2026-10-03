// REQ-TX3-PAYMENTS (AUDIT-TX-3) — addCustomerPayment + addSupplierPayment
// stable-key idempotency, ONE req for both paths.
// RED-FIRST: written and run against UNCHANGED customers.ts/suppliers.ts
// first. The opKey travels INSIDE the payment object (same single-param
// signature), so tsc stays green and RED is runtime-only: the key is
// ignored → same-key-twice MUST fail there with duplicates + double
// balance movement. Only then is the fix applied.
//
// CONTRACT (per spec):
// - opKey is NEVER stored: `const { opKey, ...paymentData } = payment`,
//   only paymentData is written. A test pins the stored doc has NO opKey
//   and NO new fields (exact key set).
// - assertValidOpKey is the FIRST line — before the amount check and
//   before assertOnline(). (A key-format case passes amount 0 + bad key
//   to prove the key check wins.)
// - Payment fingerprint = amount + party via docFingerprint (total=amount,
//   no items). `notes` is OUTSIDE identity — a documented test proves a
//   notes-only difference converges to a no-op, never a mismatch.
// - Read order UNCHANGED (customer/supplier read first, existence guard
//   second); the compare sits directly after the existence guard.
//   Mismatch toast once with its own text — never the generic copy.
//
// Cases per path (cashier unless noted): same-key-twice ×2
// (cashier+admin, fractional 33.33, balance once, 1 doc, stored-keys pin),
// mismatched-amount, different-party (customer/supplier), notes-outside-
// identity (customer path, documented), parallel-same-key, key-format,
// no-key-unchanged.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx3Payments.test.ts"
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
const { addCustomerPayment, addSupplierPayment } = await import('../services/api');
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
const CASHIER_EMAIL = 'cashier-tx3pay@test.local'; // distinct from other test files
const ADMIN_EMAIL = 'admin-tx3pay@test.local';
const PASSWORD = 'secret123';

// Fractional amount — expectations use the same expression as the service.
const AMT = 33.33;

// Fixed v4 UUIDs (3rd group 4xxx, 4th 8/9/a/bxxx) — deterministic per test.
const K_C_SAME = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const K_C_ADMIN = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const K_C_MM = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const K_C_DIFF = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';
const K_C_NOTES = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
const K_C_PAR = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';
const K_S_SAME = '07107107-0710-4071-8071-071071071071';
const K_S_ADMIN = '18218218-1821-4182-8182-182182182182';
const K_S_MM = '29329329-2932-4293-8293-293293293293';
const K_S_DIFF = '3a43a43a-43a4-4a43-8a43-a43a43a43a43';
const K_S_PAR = '4b54b54b-54b5-4b54-8b54-b54b54b54b54';

const MISMATCH_MSG = 'سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة';
const CUST_OK_TOAST = 'تم تسجيل الدفعة بنجاح!';
const CUST_FAIL_TOAST = 'حدث خطأ أثناء تسجيل الدفعة.';
const SUP_OK_TOAST = 'تم تسجيل دفعة المورد بنجاح!';
const SUP_FAIL_TOAST = 'حدث خطأ أثناء تسجيل دفعة المورد.';

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

function custPay(customerId: string, amount: number, opKey?: string, notes = 'ملاحظة') {
  return { customerId, amount, notes, ...(opKey !== undefined ? { opKey } : {}) } as any;
}

function supPay(supplierId: string, amount: number, opKey?: string, notes = 'ملاحظة') {
  return { supplierId, amount, notes, ...(opKey !== undefined ? { opKey } : {}) } as any;
}

async function countDocs(coll: string) {
  return (await getDocs(collection(getDB(), coll))).size;
}

// Attempt 1 REALLY commits, then the response is "lost" with the given code.
function loseFirstResponseAs(code: string) {
  runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
    await actualFs.runTransaction(db, fn);
    throw retryableErr(code);
  });
}

// --- docFingerprint unit (payment shapes: total=amount, no items) -------------------

describe('REQ-TX3-PAYMENTS: payment fingerprint unit', () => {
  it('customer: amount+party identify; notes ignored', () => {
    const req = { items: [], total: 33.33, customerId: 'c' };
    const a = docFingerprint(req, 'customerId');
    expect(fingerprintsEqual(a, docFingerprint(req, 'customerId'))).toBe(true);
    // Realistic stored shape: money lives in `amount`, mapped to the
    // `total` slot exactly like the service compare does; notes ignored.
    const stored = { customerId: 'c', amount: 33.33, notes: 'أولى', date: 1 };
    expect(fingerprintsEqual(
      docFingerprint({ ...stored, total: (stored as any).amount }, 'customerId'), a,
    )).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint({ items: [], total: 50, customerId: 'c' }, 'customerId'), a,
    )).toBe(false);
    expect(fingerprintsEqual(
      docFingerprint({ items: [], total: 33.33, customerId: 'other' }, 'customerId'), a,
    )).toBe(false);
  });

  it('supplier: amount+party identify; notes ignored', () => {
    const req = { items: [], total: 33.33, supplierId: 's' };
    const a = docFingerprint(req, 'supplierId');
    const stored = { supplierId: 's', amount: 33.33, notes: 'أولى', date: 1 };
    expect(fingerprintsEqual(
      docFingerprint({ ...stored, total: (stored as any).amount }, 'supplierId'), a,
    )).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint({ items: [], total: 50, supplierId: 's' }, 'supplierId'), a,
    )).toBe(false);
    expect(fingerprintsEqual(
      docFingerprint({ items: [], total: 33.33, supplierId: 'other' }, 'supplierId'), a,
    )).toBe(false);
  });
});

// --- addCustomerPayment stable-key emulator cases --------------------------------------

describe('REQ-TX3-PAYMENTS: addCustomerPayment stable key', () => {
  it('cust-same-key-twice-cashier: 33.33 ×2 calls same key → 1 doc, balance once, 3 attempts, stored doc has NO opKey', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    loseFirstResponseAs('unavailable');
    await addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_SAME));
    await addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_SAME));

    const stored = ((await getDoc(doc(getDB(), 'customerPayments', K_C_SAME)))).data() as any;
    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs('customerPayments'),
      balance: ((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance,
      keys: Object.keys(stored ?? {}).sort(),
      hasOpKey: stored !== undefined && 'opKey' in stored,
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    // Same expression as the service: currentBalance - amount.
    expect.soft(observed.balance).toBe(200 - AMT);
    // opKey NEVER stored; no new fields — exact key set of the write path.
    expect.soft(observed.hasOpKey).toBe(false);
    expect.soft(observed.keys).toEqual(['amount', 'customerId', 'date', 'notes']);
    expect.soft(toastSuccessMock).toHaveBeenCalledWith(CUST_OK_TOAST);
  });

  it('cust-same-key-twice-admin: 33.33 as admin → 1 doc, balance once', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(ADMIN_EMAIL, 'admin');

    loseFirstResponseAs('unavailable');
    await addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_ADMIN));
    await addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_ADMIN));

    expect.soft(await countDocs('customerPayments')).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance).toBe(200 - AMT);
  });

  it('cust-mismatch-different-amount: seeded 33.33, call 50 → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('customerPayments', K_C_MM, {
      customerId: 'tx3pay-cust', amount: AMT, notes: 'ملاحظة', date: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await addCustomerPayment(custPay('tx3pay-cust', 50, K_C_MM));
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
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(CUST_FAIL_TOAST);
    // Nothing moved: doc unchanged, balance untouched.
    expect.soft(((await getDoc(doc(getDB(), 'customerPayments', K_C_MM))).data() as any).amount).toBe(AMT);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance).toBe(200);
    expect.soft(await countDocs('customerPayments')).toBe(1);
  });

  it('different-customer-same-key: seeded customer A, call customer B same amount → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-custA', { name: 'عميل أ', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('customers', 'tx3pay-custB', { name: 'عميل ب', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await seed('customerPayments', K_C_DIFF, {
      customerId: 'tx3pay-custA', amount: AMT, notes: 'ملاحظة', date: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await addCustomerPayment(custPay('tx3pay-custB', AMT, K_C_DIFF));
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(CUST_FAIL_TOAST);
    // Nothing moved: neither balance touched, seeded doc keeps customer A.
    expect.soft(((await getDoc(doc(getDB(), 'customerPayments', K_C_DIFF))).data() as any).customerId).toBe('tx3pay-custA');
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-custA'))).data() as any).balance).toBe(200);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-custB'))).data() as any).balance).toBe(0);
    expect.soft(await countDocs('customerPayments')).toBe(1);
  });

  it('cust-notes-outside-identity (documented): same amount+customer, notes changed → no-op success, never mismatch', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('customerPayments', K_C_NOTES, {
      customerId: 'tx3pay-cust', amount: AMT, notes: 'أولى', date: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');

    // notes is display-only: a re-press with edited notes converges to the
    // SAME recorded payment (no-op), it must NOT raise a mismatch.
    let threw: string | null = null;
    try {
      await addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_NOTES, 'معدّلة'));
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }
    expect.soft(threw).toBeNull();
    expect.soft(await countDocs('customerPayments')).toBe(1);
    // The call itself wrote nothing (early return): balance untouched,
    // stored notes keep the FIRST committed text.
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance).toBe(200);
    expect.soft(((await getDoc(doc(getDB(), 'customerPayments', K_C_NOTES))).data() as any).notes).toBe('أولى');
    expect.soft(toastSuccessMock).toHaveBeenCalledWith(CUST_OK_TOAST);
  });

  it('cust-parallel-same-key: two concurrent same-key calls → 1 doc, balance once', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    await Promise.allSettled([
      addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_PAR)),
      addCustomerPayment(custPay('tx3pay-cust', AMT, K_C_PAR)),
    ]);

    expect.soft(await countDocs('customerPayments')).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance).toBe(200 - AMT);
  });

  it('cust-key-format: bad key + amount 0 → key error wins (validation before amount check, pre-contact)', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      // amount 0 would trip the amount guard — the key error must win,
      // proving assertValidOpKey runs before the amount check.
      await addCustomerPayment({ customerId: 'tx3pay-cust', amount: 0, notes: 'x', opKey: 'not-a-uuid' } as any);
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });

  it('cust-no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'tx3pay-cust', { name: 'عميل', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    await addCustomerPayment(custPay('tx3pay-cust', AMT));
    await addCustomerPayment(custPay('tx3pay-cust', AMT));

    expect.soft(await countDocs('customerPayments')).toBe(2);
    expect.soft(((await getDoc(doc(getDB(), 'customers', 'tx3pay-cust'))).data() as any).balance).toBe(200 - AMT - AMT);
  });
});

// --- addSupplierPayment stable-key emulator cases --------------------------------------

describe('REQ-TX3-PAYMENTS: addSupplierPayment stable key', () => {
  it('sup-same-key-twice-cashier: 33.33 ×2 calls same key → 1 doc, balance once, 3 attempts, stored doc has NO opKey', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-sup', { name: 'مورد', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    loseFirstResponseAs('unavailable');
    await addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_SAME));
    await addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_SAME));

    const stored = ((await getDoc(doc(getDB(), 'supplierPayments', K_S_SAME)))).data() as any;
    const observed = {
      attempts: runTxMock.mock.calls.length,
      docs: await countDocs('supplierPayments'),
      balance: ((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-sup'))).data() as any).balance,
      keys: Object.keys(stored ?? {}).sort(),
      hasOpKey: stored !== undefined && 'opKey' in stored,
    };
    expect.soft(observed.attempts).toBe(3);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.balance).toBe(200 - AMT);
    // opKey NEVER stored; no new fields — exact key set of the write path.
    expect.soft(observed.hasOpKey).toBe(false);
    expect.soft(observed.keys).toEqual(['amount', 'date', 'notes', 'supplierId']);
    expect.soft(toastSuccessMock).toHaveBeenCalledWith(SUP_OK_TOAST);
  });

  it('sup-same-key-twice-admin: 33.33 as admin → 1 doc, balance once', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-sup', { name: 'مورد', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(ADMIN_EMAIL, 'admin');

    loseFirstResponseAs('unavailable');
    await addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_ADMIN));
    await addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_ADMIN));

    expect.soft(await countDocs('supplierPayments')).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-sup'))).data() as any).balance).toBe(200 - AMT);
  });

  it('sup-mismatch-different-amount: seeded 33.33, call 50 → OpKeyMismatchError, fixed toast once, nothing moves', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-sup', { name: 'مورد', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('supplierPayments', K_S_MM, {
      supplierId: 'tx3pay-sup', amount: AMT, notes: 'ملاحظة', date: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await addSupplierPayment(supPay('tx3pay-sup', 50, K_S_MM));
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SUP_FAIL_TOAST);
    expect.soft(((await getDoc(doc(getDB(), 'supplierPayments', K_S_MM))).data() as any).amount).toBe(AMT);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-sup'))).data() as any).balance).toBe(200);
    expect.soft(await countDocs('supplierPayments')).toBe(1);
  });

  it('different-supplier-same-key: seeded supplier A, call supplier B same amount → OpKeyMismatchError', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-supA', { name: 'مورد أ', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await seed('suppliers', 'tx3pay-supB', { name: 'مورد ب', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await seed('supplierPayments', K_S_DIFF, {
      supplierId: 'tx3pay-supA', amount: AMT, notes: 'ملاحظة', date: Date.now(),
    });
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await addSupplierPayment(supPay('tx3pay-supB', AMT, K_S_DIFF));
    } catch (e) {
      thrown = e;
    }
    expect.soft(thrown?.code).toBe('opkey-mismatch');
    expect.soft(thrown?.message).toBe(MISMATCH_MSG);
    expect.soft(runTxMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls.length).toBe(1);
    expect.soft(toastErrorMock.mock.calls[0][0]).toBe(MISMATCH_MSG);
    expect.soft(toastErrorMock.mock.calls.map((c) => c[0])).not.toContain(SUP_FAIL_TOAST);
    // Nothing moved: neither balance touched, seeded doc keeps supplier A.
    expect.soft(((await getDoc(doc(getDB(), 'supplierPayments', K_S_DIFF))).data() as any).supplierId).toBe('tx3pay-supA');
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-supA'))).data() as any).balance).toBe(200);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-supB'))).data() as any).balance).toBe(0);
    expect.soft(await countDocs('supplierPayments')).toBe(1);
  });

  it('sup-parallel-same-key: two concurrent same-key calls → 1 doc, balance once', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-sup', { name: 'مورد', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    await Promise.allSettled([
      addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_PAR)),
      addSupplierPayment(supPay('tx3pay-sup', AMT, K_S_PAR)),
    ]);

    expect.soft(await countDocs('supplierPayments')).toBe(1);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-sup'))).data() as any).balance).toBe(200 - AMT);
  });

  it('sup-key-format: invalid key rejected before any Firestore contact', async () => {
    await testEnv.clearFirestore();
    await signInAs(CASHIER_EMAIL, 'cashier');

    let thrown: any = null;
    try {
      await addSupplierPayment(supPay('tx3pay-sup', AMT, 'not-a-uuid'));
    } catch (e) {
      thrown = e;
    }
    expect.soft(String(thrown?.message ?? '')).toMatch('مفتاح العملية غير صالح');
    expect.soft(runTxMock).not.toHaveBeenCalled();
  });

  it('sup-no-key-unchanged: two calls WITHOUT key → 2 docs (opt-in boundary)', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'tx3pay-sup', { name: 'مورد', balance: 200, openingBalance: 200, createdAt: Date.now() });
    await signInAs(CASHIER_EMAIL, 'cashier');

    await addSupplierPayment(supPay('tx3pay-sup', AMT));
    await addSupplierPayment(supPay('tx3pay-sup', AMT));

    expect.soft(await countDocs('supplierPayments')).toBe(2);
    expect.soft(((await getDoc(doc(getDB(), 'suppliers', 'tx3pay-sup'))).data() as any).balance).toBe(200 - AMT - AMT);
  });
});
