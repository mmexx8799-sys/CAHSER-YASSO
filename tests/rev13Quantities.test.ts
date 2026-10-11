// REQ-REV1-3 — buyQuantity shape validation for processSale/processReturn.
// RED-FIRST: run against UNFIXED services first; every rejection case MUST
// fail there (no validation → proceeds past the would-be check).
//
// What this file proves, through the REAL opKeyStore.submitWithOpKey loop
// (stubbed getRecordDoc exists:false — no network lookup), NOT by calling
// the services directly:
// - every bad quantity rejects with the Arabic message ON THE ERROR;
// - every bad price rejects with its Arabic message ON THE ERROR;
// - a rejected call writes NOTHING (no invoice/return doc, no stock,
//   archive, or counter movement — scoped to this file's fixtures; cash
//   fixtures carry no customer, so no party balance exists to assert);
// - a mixed cart (one valid item + one bad item) rejects with NOTHING written;
// - a corrected re-call succeeds normally via lookup-miss + fresh key;
// - the same uncorrected cart reuses the same key and repeats the error
//   (peek proves key identity across both calls);
// - an offline-at-lookup re-call aborts with lookup-failed (old record
//   first left behind by a rejected call — the record lingers harmlessly
//   until TTL, exactly as the corrected spec states);
// - a valid fractional quantity (1.5) and a valid zero price pass validation.
// No toast-path assertions: the throw precedes try{} BY DESIGN (defense in
// depth — normal UI never sends bad quantities).
//
// No mocks except the repo-global toast mock (tests/setup.ts). Real
// transactions, real emulator.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/rev13Quantities.test.ts"

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

// tests/setup.ts already mocks react-hot-toast before these imports.
import { processSale, processReturn } from '../services/api';
import { getDB, getAuthInstance } from '../services/firebase';
import { opKeyStore, createOpKeyStore } from '../utils/opKeyStore';
import type { DecideChoice, KeyValueStorage, RecordedInfo, TxFlow } from '../utils/opKeyStore';
import { docFingerprint } from '../services/api/opKey';
import { PaymentMethod } from '../types';
import type { CartItem } from '../types';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const ADMIN_EMAIL = 'admin-rev13@test.local'; // distinct from other test files
const PASSWORD = 'secret123';

const DAY = 'rev13-day';
const PROD = 'rev13-p';
const UNIT_PRICE = 100;

const SALE_BAD_MSG = 'كمية البيع غير صالحة';
const RETURN_BAD_MSG = 'كمية المرتجع غير صالحة';
const SALE_PRICE_MSG = 'سعر البيع غير صالح';
const RETURN_PRICE_MSG = 'سعر المرتجع غير صالح';

const noDoc: (flow: TxFlow, key: string) => Promise<RecordedInfo> = async () => ({ exists: false });
const abortDecide = async (): Promise<DecideChoice> => 'abort';

const BASE_PRODUCT = {
  id: PROD,
  code: 'R13',
  name: 'صنف REV1-3',
  price: UNIT_PRICE,
  retailCashPrice: UNIT_PRICE,
  retailCreditPrice: UNIT_PRICE,
  wholesaleCashPrice: UNIT_PRICE,
  wholesaleCreditPrice: UNIT_PRICE,
  quantity: 10000,
  categoryId: 'rev13-cat',
  createdAt: Date.now(),
  searchableIndex: [] as string[],
};

function cartItem(qty: unknown, price: unknown = UNIT_PRICE): CartItem {
  return { ...BASE_PRODUCT, buyQuantity: qty as number, priceType: 'retail' as const, price: price as number };
}

// Price override WITHOUT the default-parameter trap: cartItem(1, undefined)
// would silently substitute UNIT_PRICE. Spreading after forces undefined.
function pricedItem(price: unknown): CartItem {
  return { ...cartItem(1), price: price as number };
}

async function signInAdmin() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, ADMIN_EMAIL, PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: ADMIN_EMAIL, role: 'admin' });
  });
}

async function seedFixtures() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'dailyArchives', DAY), {
      status: 'open', totalSales: 0, totalCash: 0, totalReturns: 0, totalReturnsCash: 0,
    });
    await setDoc(doc(db, 'products', PROD), { ...BASE_PRODUCT });
  });
}

async function stockOf(): Promise<number> {
  const snap = await getDoc(doc(getDB(), 'products', PROD));
  const data: unknown = snap.data();
  if (typeof data !== 'object' || data === null || !('quantity' in data)) {
    throw new Error('rev13 fixture product missing');
  }
  return Number((data as { quantity: unknown }).quantity);
}

async function archiveTotals(): Promise<{ sales: number; returns: number }> {
  const snap = await getDoc(doc(getDB(), 'dailyArchives', DAY));
  const data: unknown = snap.data();
  const pick = (k: string): number => {
    if (typeof data !== 'object' || data === null || !(k in data)) return 0;
    return Number((data as Record<string, unknown>)[k] || 0);
  };
  return { sales: pick('totalSales'), returns: pick('totalReturns') };
}

async function counterOf(counterId: string): Promise<number | null> {
  const snap = await getDoc(doc(getDB(), 'counters', counterId));
  const data: unknown = snap.data();
  if (!snap.exists() || typeof data !== 'object' || data === null || !('lastNumber' in data)) return null;
  return Number((data as { lastNumber: unknown }).lastNumber);
}

async function docCount(coll: string): Promise<number> {
  return (await getDocs(collection(getDB(), coll))).size;
}

function saleSend(items: CartItem[]) {
  const subtotal = items.reduce((s, i) => s + i.price * (i.buyQuantity as number), 0);
  const invoiceData = {
    items,
    subtotal,
    discount: 0,
    total: subtotal,
    paymentMethod: PaymentMethod.Cash,
    dailyArchiveId: DAY,
  };
  const identity = {
    fp: docFingerprint({ ...invoiceData, customerId: undefined }, 'customerId'),
    extra: { paymentMethod: PaymentMethod.Cash as string },
  };
  return opKeyStore.submitWithOpKey('sale', identity, (key) => processSale(invoiceData, { opKey: key }), {
    decide: abortDecide,
    getRecordDoc: noDoc,
  });
}

function returnSend(items: CartItem[]) {
  const total = items.reduce((s, i) => s + i.price * (i.buyQuantity as number), 0);
  const identity = {
    fp: docFingerprint({ items, total, customerId: undefined }, 'customerId'),
    extra: { originalInvoiceId: null, dailyArchiveId: DAY },
  };
  return opKeyStore.submitWithOpKey(
    'return',
    identity,
    (key) => processReturn(items, DAY, undefined, undefined, undefined, { opKey: key }),
    { decide: abortDecide, getRecordDoc: noDoc },
  );
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
    await createUserWithEmailAndPassword(fbAuth, ADMIN_EMAIL, PASSWORD);
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
    if (code.indexOf('email-already-in-use') < 0) throw e;
  }
  await signInAdmin();
  await seedFixtures();
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(() => {
  opKeyStore.clear('sale');
  opKeyStore.clear('return');
});

const BAD_QTYS: unknown[] = [0, -1, NaN, Infinity, '2', undefined];

describe('REQ-REV1-3: sale rejects bad buyQuantity before any write', () => {
  test.each(BAD_QTYS)('buyQuantity=%s rejects with the Arabic message', async (q) => {
    await expect(saleSend([cartItem(q)])).rejects.toThrow(SALE_BAD_MSG);
  });

  test('rejected sale writes nothing (stock/archive/docs/counters unchanged)', async () => {
    const stockBefore = await stockOf();
    const archBefore = await archiveTotals();
    const nBefore = await docCount('invoices');
    const cBefore = await counterOf('invoices');
    await expect(saleSend([cartItem(0)])).rejects.toThrow(SALE_BAD_MSG);
    expect(await stockOf()).toBe(stockBefore);
    expect(await archiveTotals()).toEqual(archBefore);
    expect(await docCount('invoices')).toBe(nBefore);
    expect(await counterOf('invoices')).toBe(cBefore);
  });

  test('mixed cart (valid item + zero-qty item) rejects with nothing written', async () => {
    const stockBefore = await stockOf();
    const nBefore = await docCount('invoices');
    const cBefore = await counterOf('invoices');
    await expect(saleSend([cartItem(2), cartItem(0)])).rejects.toThrow(SALE_BAD_MSG);
    expect(await stockOf()).toBe(stockBefore);
    expect(await docCount('invoices')).toBe(nBefore);
    expect(await counterOf('invoices')).toBe(cBefore);
  });

  test('valid fraction 1.5 passes and moves stock once', async () => {
    const stockBefore = await stockOf();
    const result = await saleSend([cartItem(1.5)]);
    expect(result.outcome).toBe('sent');
    expect(await stockOf()).toBe(stockBefore - 1.5);
  });
});

describe('REQ-REV1-3: return rejects bad buyQuantity before any write', () => {
  test.each(BAD_QTYS)('buyQuantity=%s rejects with the Arabic message', async (q) => {
    await expect(returnSend([cartItem(q)])).rejects.toThrow(RETURN_BAD_MSG);
  });

  test('rejected return writes nothing (stock/archive/docs/counters unchanged)', async () => {
    const stockBefore = await stockOf();
    const archBefore = await archiveTotals();
    const nBefore = await docCount('returns');
    const cBefore = await counterOf('returns');
    await expect(returnSend([cartItem(-3)])).rejects.toThrow(RETURN_BAD_MSG);
    expect(await stockOf()).toBe(stockBefore);
    expect(await archiveTotals()).toEqual(archBefore);
    expect(await docCount('returns')).toBe(nBefore);
    expect(await counterOf('returns')).toBe(cBefore);
  });

  test('mixed cart (valid item + zero-qty item) rejects with nothing written', async () => {
    const stockBefore = await stockOf();
    const nBefore = await docCount('returns');
    const cBefore = await counterOf('returns');
    await expect(returnSend([cartItem(1), cartItem(0)])).rejects.toThrow(RETURN_BAD_MSG);
    expect(await stockOf()).toBe(stockBefore);
    expect(await docCount('returns')).toBe(nBefore);
    expect(await counterOf('returns')).toBe(cBefore);
  });

  test('valid fraction 1.5 passes and moves stock once', async () => {
    const stockBefore = await stockOf();
    const result = await returnSend([cartItem(1.5)]);
    expect(result.outcome).toBe('sent');
    expect(await stockOf()).toBe(stockBefore + 1.5);
  });
});

describe('REQ-REV1-3: opKey state across reject + recall', () => {
  test('reject then corrected recall succeeds (fresh key, no lingering block)', async () => {
    await expect(saleSend([cartItem(0)])).rejects.toThrow(SALE_BAD_MSG);
    const nBefore = await docCount('invoices');
    const result = await saleSend([cartItem(2)]);
    expect(result.outcome).toBe('sent');
    expect(await docCount('invoices')).toBe(nBefore + 1);
  });

  test('same uncorrected cart reuses the key and repeats the error', async () => {
    const bad = [cartItem(0)];
    await expect(saleSend(bad)).rejects.toThrow(SALE_BAD_MSG);
    const keyAfterFirst = opKeyStore.peek('sale')?.key;
    expect(keyAfterFirst).toBeTruthy();
    await expect(saleSend(bad)).rejects.toThrow(SALE_BAD_MSG);
    // Same identity ⇒ memoryHit ⇒ the SAME key reused (no rotation).
    expect(opKeyStore.peek('sale')?.key).toBe(keyAfterFirst);
    const badRet = [cartItem(NaN)];
    await expect(returnSend(badRet)).rejects.toThrow(RETURN_BAD_MSG);
    const retKeyAfterFirst = opKeyStore.peek('return')?.key;
    expect(retKeyAfterFirst).toBeTruthy();
    await expect(returnSend(badRet)).rejects.toThrow(RETURN_BAD_MSG);
    expect(opKeyStore.peek('return')?.key).toBe(retKeyAfterFirst);
  });
});

const BAD_PRICES: unknown[] = [-1, NaN, Infinity, '10', undefined];

describe('REQ-REV1-3: sale rejects bad price before any write', () => {
  test.each(BAD_PRICES)('price=%s rejects with the Arabic message', async (p) => {
    await expect(saleSend([pricedItem(p)])).rejects.toThrow(SALE_PRICE_MSG);
  });

  test('valid zero price passes validation', async () => {
    // Shape-valid (passes the new check) but policy-rejected by the
    // pre-existing 50%-floor rule (BUG-P0-3, out of scope): proves the
    // shape gate let 0 through and something ELSE said no.
    const p = (await saleSend([cartItem(1, 0)]).catch((e: unknown) => e)) as unknown;
    const msg = p instanceof Error ? p.message : String(p);
    expect(msg).toContain('غير مقبول');
    expect(msg).not.toContain('غير صالح');
  });
});

describe('REQ-REV1-3: return rejects bad price before any write', () => {
  test.each(BAD_PRICES)('price=%s rejects with the Arabic message', async (p) => {
    await expect(returnSend([pricedItem(p)])).rejects.toThrow(RETURN_PRICE_MSG);
  });

  test('valid zero price passes validation', async () => {
    // Shape-valid (passes the new check) but policy-rejected by the
    // pre-existing 50%-floor rule (BUG-P0-3, out of scope): proves the
    // shape gate let 0 through and something ELSE said no.
    const p = (await returnSend([cartItem(1, 0)]).catch((e: unknown) => e)) as unknown;
    const msg = p instanceof Error ? p.message : String(p);
    expect(msg).toContain('غير مقبول');
    expect(msg).not.toContain('غير صالح');
  });
});

describe('REQ-REV1-3: offline at lookup aborts without send', () => {
  test('old record lingers, corrected cart aborts with lookup-failed', async () => {
    const mem = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => { mem.set(k, v); },
      removeItem: (k) => { mem.delete(k); },
    };
    const store = createOpKeyStore({ storage });
    const lookupFails = async (): Promise<RecordedInfo> => {
      throw new Error('offline');
    };
    const badIdentity = {
      fp: docFingerprint({ items: [cartItem(0)], subtotal: 0, discount: 0, total: 0, paymentMethod: PaymentMethod.Cash }, 'customerId'),
      extra: {},
    };
    // First: rejected validation call mints K1; the record lingers.
    await expect(
      store.submitWithOpKey('sale', badIdentity, (key) => processSale({
        items: [cartItem(0)], subtotal: 0, discount: 0, total: 0,
        paymentMethod: PaymentMethod.Cash, dailyArchiveId: DAY,
      }, { opKey: key }), { decide: abortDecide, getRecordDoc: noDoc }),
    ).rejects.toThrow(SALE_BAD_MSG);
    expect(store.peek('sale')?.key).toBeTruthy();
    // Then: corrected cart + failing lookup ⇒ aborted/lookup-failed, no send.
    const fixed = [cartItem(2)];
    const subtotal = 200;
    const fixedIdentity = {
      fp: docFingerprint({
        items: fixed, subtotal, discount: 0, total: subtotal,
        paymentMethod: PaymentMethod.Cash, dailyArchiveId: DAY,
      }, 'customerId'),
      extra: {},
    };
    const nBefore = await docCount('invoices');
    const result = await store.submitWithOpKey('sale', fixedIdentity, (key) => processSale({
      items: fixed, subtotal, discount: 0, total: subtotal,
      paymentMethod: PaymentMethod.Cash, dailyArchiveId: DAY,
    }, { opKey: key }), { decide: abortDecide, getRecordDoc: lookupFails });
    expect(result).toEqual({ outcome: 'aborted', reason: 'lookup-failed' });
    expect(await docCount('invoices')).toBe(nBefore);
  });
});
