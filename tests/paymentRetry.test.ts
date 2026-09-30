// REQ-TX-1 (AUDIT-TX-1) — payments on runTransactionWithRetry (Firebase Emulator).
//
// AC-T1-2: one `aborted`, then success → balance + payment doc correct (×2).
// AC-T1-3: persistent `aborted` → `_txExhausted === true` rethrown + FIXED
//   toast strings verbatim (no error.message) (×2).
// AC-T1-4: amount<=0 throws before any transaction (no retry) (×2).
// AC-T1-6: REAL wrapper, commit-then-lost-response: first attempt runs the
//   real transaction and commits, then surfaces `unavailable`; the retry
//   must hit the existence guard and NOT move the balance again — balance
//   moves ONCE, exactly one payment doc exists (×2).
//
// The `firebase/firestore` module mock replaces ONLY `runTransaction`
// (same pattern as tests/txExhaustedMon.test.ts); every other export and
// the default per-test implementation delegate to the real module, so the
// wrapper under test is the REAL runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/paymentRetry.test.ts"
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

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
const toastErrorMock = vi.mocked(toast.error);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-payretry@test.local'; // distinct from other test files
const CASHIER_PASSWORD = 'secret123';
const ADMIN_EMAIL = 'admin-payretry@test.local'; // privileged variant (AC-TX-1 mutation contrast)
const ADMIN_PASSWORD = 'secret123';

const CUSTOMER_FAIL_TOAST = 'حدث خطأ أثناء تسجيل الدفعة.';
const SUPPLIER_FAIL_TOAST = 'حدث خطأ أثناء تسجيل دفعة المورد.';

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
  // Default: real transaction (tests override per-case with mock*Once).
  runTxMock.mockImplementation((db: any, fn: any) => actualFs.runTransaction(db, fn));
});

async function signInCashier() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, CASHIER_EMAIL, CASHIER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // cashier holds customer.payment + supplier.ops by default matrix.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: CASHIER_EMAIL, role: 'cashier' });
  });
  return uid;
}

async function signInAdmin() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  try {
    await createUserWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
  await signInWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // admin passes isAdmin() (customerPayments/supplierPayments update gate).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: ADMIN_EMAIL, role: 'admin' });
  });
  return uid;
}

async function seed(collectionPath: string, docId: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

async function readBalance(collectionPath: string, id: string) {
  const snap = await getDoc(doc(getDB(), collectionPath, id));
  if (!snap.exists()) throw new Error(`missing doc ${collectionPath}/${id}`);
  return (snap.data() as any).balance;
}

async function countDocs(collectionPath: string) {
  const snap = await getDocs(collection(getDB(), collectionPath));
  return snap.size;
}

// --- AC-T1-2: retry-then-succeed -------------------------------------------------

describe('REQ-TX-1: payment-retries-aborted-then-succeeds', () => {
  it('customer: one aborted, then success → balance 70, one payment doc', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'rt-cust', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    runTxMock.mockRejectedValueOnce(retryableErr('aborted'));

    await addCustomerPayment({ customerId: 'rt-cust', amount: 30 });
    expect(await readBalance('customers', 'rt-cust')).toBe(70);
    expect(await countDocs('customerPayments')).toBe(1);
  });

  it('supplier: one aborted, then success → balance 70, one payment doc', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'rt-sup', { name: 'مورد', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    runTxMock.mockRejectedValueOnce(retryableErr('aborted'));

    await addSupplierPayment({ supplierId: 'rt-sup', amount: 30 });
    expect(await readBalance('suppliers', 'rt-sup')).toBe(70);
    expect(await countDocs('supplierPayments')).toBe(1);
  });
});

// --- AC-T1-6: commit-then-lost-response is idempotent -----------------------------

describe('REQ-TX-1: payment-retry-after-commit-is-idempotent', () => {
  it('customer: real commit, then unavailable → balance moves ONCE, one doc', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'idem-cust', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    // Attempt 1 REALLY commits, then the response is "lost".
    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    await addCustomerPayment({ customerId: 'idem-cust', amount: 30 });
    // Without the existence guard this would be 40 (double deduction).
    expect(await readBalance('customers', 'idem-cust')).toBe(70);
    expect(await countDocs('customerPayments')).toBe(1);
  });

  it('supplier: real commit, then unavailable → balance moves ONCE, one doc', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'idem-sup', { name: 'مورد', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    await addSupplierPayment({ supplierId: 'idem-sup', amount: 30 });
    expect(await readBalance('suppliers', 'idem-sup')).toBe(70);
    expect(await countDocs('supplierPayments')).toBe(1);
  });
});

// NOTE (cashier failure mode without the guard — observed, not assumed):
// the retried attempt's `transaction.set` on the now-existing payment doc
// evaluates as rules-`update` (customerPayments/supplierPayments update is
// isAdmin()-only), so a cashier retry exhausts with permission-denied
// AFTER the balance already moved once — NOT a silent 40. Do not claim
// "would be 40" for the cashier path; the 40-vs-70 assertion below holds
// only for the admin variant, where the retry IS rules-allowed.

// --- AC-T1-6 admin variant: retry IS allowed → guard is the only net ------

describe('REQ-TX-1: payment-retry-after-commit-is-idempotent [admin-variant]', () => {
  it('admin-variant customer: real commit, then unavailable → balance 70, one doc', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'idem-adm-cust', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInAdmin();

    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    await addCustomerPayment({ customerId: 'idem-adm-cust', amount: 30 });
    // Without the existence guard the allowed retry re-reads 70 and writes
    // 40 while overwriting the same payment doc (double deduction, one doc).
    expect(await readBalance('customers', 'idem-adm-cust')).toBe(70);
    expect(await countDocs('customerPayments')).toBe(1);
  });

  it('admin-variant supplier: real commit, then unavailable → balance 70, one doc', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'idem-adm-sup', { name: 'مورد', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInAdmin();

    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    await addSupplierPayment({ supplierId: 'idem-adm-sup', amount: 30 });
    expect(await readBalance('suppliers', 'idem-adm-sup')).toBe(70);
    expect(await countDocs('supplierPayments')).toBe(1);
  });
});

// --- AC-T1-3: exhaustion keeps flag + fixed toast ---------------------------------

describe('REQ-TX-1: payment-exhaustion-preserves-flag-and-toast', () => {
  it('customer: persistent aborted → _txExhausted + fixed toast string', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'exh-cust', { name: 'عميل', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    runTxMock.mockImplementation(async () => { throw retryableErr('aborted'); });

    let thrown: any;
    try {
      await addCustomerPayment({ customerId: 'exh-cust', amount: 30 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?._txExhausted).toBe(true);
    expect(toastErrorMock).toHaveBeenCalledWith(CUSTOMER_FAIL_TOAST);
    // Nothing committed across the exhausted attempts.
    expect(await readBalance('customers', 'exh-cust')).toBe(100);
    expect(await countDocs('customerPayments')).toBe(0);
  });

  it('supplier: persistent aborted → _txExhausted + fixed toast string', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'exh-sup', { name: 'مورد', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await signInCashier();

    runTxMock.mockImplementation(async () => { throw retryableErr('aborted'); });

    let thrown: any;
    try {
      await addSupplierPayment({ supplierId: 'exh-sup', amount: 30 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?._txExhausted).toBe(true);
    expect(toastErrorMock).toHaveBeenCalledWith(SUPPLIER_FAIL_TOAST);
    expect(await readBalance('suppliers', 'exh-sup')).toBe(100);
    expect(await countDocs('supplierPayments')).toBe(0);
  });
});

// --- AC-T1-4: amount guard pre-transaction -----------------------------------------

describe('REQ-TX-1: payment-amount-guard-no-retry', () => {
  it('customer amount<=0 throws before any transaction', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    await expect(addCustomerPayment({ customerId: 'x', amount: 0 })).rejects.toThrow('قيمة الدفعة يجب أن تكون أكبر من صفر');
    await expect(addCustomerPayment({ customerId: 'x', amount: -5 })).rejects.toThrow('قيمة الدفعة يجب أن تكون أكبر من صفر');
    expect(runTxMock).not.toHaveBeenCalled();
  });

  it('supplier amount<=0 throws before any transaction', async () => {
    await testEnv.clearFirestore();
    await signInCashier();

    await expect(addSupplierPayment({ supplierId: 'x', amount: 0 })).rejects.toThrow('قيمة الدفعة يجب أن تكون أكبر من صفر');
    expect(runTxMock).not.toHaveBeenCalled();
  });
});
