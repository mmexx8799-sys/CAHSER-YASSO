// E-5-MON — تسجيل استنفاد المحاولات في processReturn (Firebase Emulator).
//
// (أ) دفع processReturn الحقيقية للاستنفاد (runTransaction مرمي {code:'aborted'}
//     دائمًا) ← reportError تُستدعى مرة واحدة برسالة يبنيها الكود نفسه.
// (ب) خطأ بيزنس حقيقي (تجاوز المتبقي) ← reportError لا تُستدعى إطلاقًا.
// (ج) reportError ترمي عمدًا ← الرفض والـtoast كما هما تمامًا.
// (د) الرسالة الناتجة فعلًا تُكتب بكاشير تحت firestore.rules الحالية وتُقرأ كأدمن.
//
// Run single:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/txExhaustedMon.test.ts"

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, Invoice, DailyArchive, CartItem } from '../types';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: vi.fn() };
});

vi.mock('../services/monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/monitoring')>();
  return { ...actual, reportError: vi.fn() };
});

// tests/setup.ts already mocks react-hot-toast before these imports.
const { processReturn } = await import('../services/api');
const { getAuthInstance } = await import('../services/firebase');
const { reportError } = await import('../services/monitoring');
const { toast } = await import('react-hot-toast');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

const reportErrorMock = vi.mocked(reportError);
const toastErrorMock = vi.mocked(toast.error);

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo';
const TEST_EMAIL = 'cashier@test.local';
const TEST_PASSWORD = 'secret123';
const ARCHIVE_ID = '2026-09-13';
const CONGESTION_TOAST = 'تعذر الإتمام بسبب زحمة متزامنة على نفس الفاتورة — حاول مجددًا.';

function abortedErr(): Error {
  const e = new Error('aborted') as Error & { code: string };
  e.code = 'aborted';
  return e;
}

async function signInTestUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in — fine */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  return fbAuth.currentUser!.uid;
}

async function seedUserDoc(uid: string, role = 'cashier') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL, role });
  });
}

function makeRawCart(qty: number): CartItem[] {
  return [{
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
    buyQuantity: qty,
    priceType: 'retail',
  } as CartItem];
}

async function seedInvoice5(ctx: RulesTestContext) {
  const db = ctx.firestore();
  const product: Product = {
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    retailCashPrice: 100,
    retailCreditPrice: 100,
    wholesaleCashPrice: 80,
    wholesaleCreditPrice: 80,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
  const archive: DailyArchive = {
    id: ARCHIVE_ID,
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
  };
  const invoice: Invoice = {
    id: 'inv-1',
    invoiceNumber: 'INV-000001',
    items: [{ ...product, id: 'prod-1', buyQuantity: 5, priceType: 'retail', price: 100 } as CartItem],
    subtotal: 500,
    discount: 0,
    total: 500,
    paymentMethod: 'نقدا' as Invoice['paymentMethod'],
    createdAt: Date.now(),
    dailyArchiveId: archive.id,
  };
  await setDoc(doc(db, 'products', product.id), { ...product, createdAt: Date.now() });
  await setDoc(doc(db, 'dailyArchives', archive.id), { ...archive, startTime: Date.now() } as any);
  await setDoc(doc(db, 'invoices', invoice.id), { ...invoice, createdAt: Date.now() } as any);
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
    await createUserWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(() => {
  reportErrorMock.mockReset();
  runTxMock.mockReset();
  toastErrorMock.mockClear();
});

describe('E-5-MON: tx-exhaustion logging in processReturn', () => {
  it('(أ) الاستنفاد الحقيقي ← reportError مرة واحدة بالرسالة التي بناها الكود نفسه', async () => {
    await testEnv.clearFirestore();
    const uid = await signInTestUser();
    await seedUserDoc(uid);
    runTxMock.mockImplementation(async () => { throw abortedErr(); });

    // Unlinked return: no fixture reads needed — the mocked transaction always aborts.
    await expect(processReturn(makeRawCart(1), ARCHIVE_ID)).rejects.toMatchObject({
      _txExhausted: true,
      code: 'aborted',
    } as any);

    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [errArg, ctxArg] = reportErrorMock.mock.calls[0];
    expect(errArg).toBeInstanceOf(Error);
    const msg = (errArg as Error).message;
    expect(msg.startsWith('[TX_EXHAUSTED]')).toBe(true);
    expect(msg).toContain('label=processReturn');
    expect(msg).toContain('code=aborted');
    expect(msg).toContain('attempts=7');
    expect(msg.length).toBeLessThanOrEqual(1000);
    expect(ctxArg).toEqual({ source: 'processReturn' });
  }, 30000);

  it('(ب) خطأ بيزنس حقيقي ← reportError لا تُستدعى', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedInvoice5(ctx);
    });
    const uid = await signInTestUser();
    await seedUserDoc(uid);
    // Real transaction: business validation rejects before any commit.
    runTxMock.mockImplementation((...a: unknown[]) =>
      (actualFs as any).runTransaction(...(a as [unknown, unknown])),
    );

    await expect(processReturn(makeRawCart(6), ARCHIVE_ID, undefined, 'inv-1')).rejects.toThrow(/تتجاوز|متبق/);
    expect(reportErrorMock).not.toHaveBeenCalled();
  }, 30000);

  it('(ج) reportError ترمي ← نفس الرفض الأصلي ونفس الـtoast', async () => {
    await testEnv.clearFirestore();
    const uid = await signInTestUser();
    await seedUserDoc(uid);
    runTxMock.mockImplementation(async () => { throw abortedErr(); });
    reportErrorMock.mockImplementationOnce(() => { throw new Error('log down'); });

    const caught: unknown = await processReturn(makeRawCart(1), ARCHIVE_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toMatchObject({ _txExhausted: true, code: 'aborted' } as any);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(CONGESTION_TOAST);
  }, 30000);

  it('(د) المسار الإنتاجي الحقيقي ← reportError الفعلية تكتب سجلًا يُقرأ كأدمن', async () => {
    await testEnv.clearFirestore();
    const uid = await signInTestUser();
    await seedUserDoc(uid);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'admin-mon'), { email: 'admin@t.local', role: 'admin' });
    });
    runTxMock.mockImplementation(async () => { throw abortedErr(); });

    await expect(processReturn(makeRawCart(1), ARCHIVE_ID)).rejects.toMatchObject({
      _txExhausted: true,
    } as any);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [errArg, ctxArg] = reportErrorMock.mock.calls[0];

    // المسار الإنتاجي الفعلي: reportError الحقيقية بنفس الوسائط الناتجة (لا إعادة بناء).
    const realMonitoring = await vi.importActual<typeof import('../services/monitoring')>('../services/monitoring');
    realMonitoring.reportError(errArg as Error, ctxArg as { source: string });

    // الكتابة fire-and-forget بمعرّف تلقائي — polling كأدمن (قراءة الكاشير مرفوضة تصميمًا) حتى 3s.
    const adminDb = testEnv.authenticatedContext('admin-mon').firestore();
    const ALLOWED = ['message', 'stack', 'source', 'url', 'createdAt', 'uid'];
    let found: Record<string, unknown> | null = null;
    for (let i = 0; i < 10 && !found; i++) {
      const snap = await getDocs(collection(adminDb, 'clientErrors'));
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (typeof data.message === 'string' && data.message.startsWith('[TX_EXHAUSTED]')) {
          found = data;
          break;
        }
      }
      if (!found) await new Promise((r) => setTimeout(r, 300));
    }
    expect(found).not.toBeNull();
    expect(Object.keys(found!).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(typeof found!.message).toBe('string');
    expect(typeof found!.createdAt).toBe('number');
  }, 30000);
});
