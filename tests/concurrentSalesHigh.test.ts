// Stage-3 (3.2) — سيناريوهات التزامن العالي الموسّعة (BUG-P0-14).
//
// السياق: counters/invoices يتقدم +1 ذريًا داخل transaction البيع، والخاسر
// في سباق الـ commit يُرفض بـ PERMISSION_DENIED (قاعدة +1) فيعيد
// runTransactionWithRetry المحاولة (×4 + jitter). القياس السابق:
// N=5 → ‎87-100%‎ حيًا (بوابة صارمة ≥4/5)، وN=20 توثيقي فقط (>0).
// البند مطلوب برقم ثقة أعلى قبل الإطلاق — هذا الملف يضيف:
//   (1) N=10 same-tick — بوابة صارمة ≥8/10 (عتبة الشحن للتزامن العالي)
//   (2) N=12 متموج (staggered 5ms — أقرب لواقع الكاشير من same-tick)
//   (3) N=15 same-tick ضغط — بوابة ليونة ≥10/15 + ثوابت صارمة
//   (4) N=10 متعدد المنتجات — التنافس على العدّاد+الأرشيف فقط لا المخزون
// الثوابت الصارمة في كل اختبار (سلامة قبل حيوية):
//   counter == before + ok، أرقام فريدة بلا تكرار، مخزون −= ok×qty،
//   archive.totalSales/totalCash == ok×100.
//
// التشغيل:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/concurrentSalesHigh.test.ts"
// السويت الكامل تسلسلي إجباريًا:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts يربط singletons المحاكيات + يزيف react-hot-toast.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, CartItem, Invoice } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { processSale } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const TEST_EMAIL = 'cashier-high-concurrency@test.local';
const TEST_PASSWORD = 'secret123';

const UNIT_PRICE = 100;

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

// --- Helpers ----------------------------------------------------------------

async function signInAppUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL, role: 'cashier' });
  });
}

function mkProduct(id: string): Product {
  return {
    id,
    code: 'C-' + id,
    name: 'منتج تزامن ' + id,
    price: UNIT_PRICE,
    retailCashPrice: UNIT_PRICE,
    retailCreditPrice: UNIT_PRICE,
    wholesaleCashPrice: UNIT_PRICE,
    wholesaleCreditPrice: UNIT_PRICE,
    quantity: 5000,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
}

function mkCartItem(p: Product, qty: number): CartItem {
  return { ...p, buyQuantity: qty, priceType: 'retail', price: UNIT_PRICE } as CartItem;
}

async function seedHighFixtures(archiveId: string, prodIds: string[]) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const pid of prodIds) {
      await setDoc(doc(db, 'products', pid), { ...mkProduct(pid), createdAt: Date.now() });
    }
    await setDoc(doc(db, 'dailyArchives', archiveId), {
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
    } as any);
  });
}

interface BurstResult {
  ok: number;
  fail: number;
  before: number;
  after: number | undefined;
  numbers: string[];
  archiveTotalSales: number;
  archiveTotalCash: number;
  stockLeft: Record<string, number>;
}

async function runBurst(
  n: number,
  archiveId: string,
  prodIds: string[],
  opts: { staggerMs?: number; qty?: number } = {},
): Promise<BurstResult> {
  const { staggerMs = 0, qty = 1 } = opts;
  await testEnv.clearFirestore();
  await seedHighFixtures(archiveId, prodIds);
  await signInAppUser();
  const db = getDB();
  const counterSnap = await getDoc(doc(db, 'counters', 'invoices'));
  const before = counterSnap.exists() ? ((counterSnap.data() as any).lastNumber as number) : 0;
  const prods = prodIds.map(mkProduct);

  const mkSale = (i: number) => {
    const p = prods[i % prods.length];
    return processSale({
      items: [mkCartItem(p, qty)],
      subtotal: UNIT_PRICE * qty,
      discount: 0,
      total: UNIT_PRICE * qty,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: archiveId,
    });
  };

  let results: PromiseSettledResult<unknown>[];
  if (staggerMs > 0) {
    // متموج: كل العمليات تنطلق معًا لكن بداياتها متباعدة (i×staggerMs) —
    // يحاكي كاشيرين يضغطان بفارق بشري مع بقاء التنفيذ متداخلًا فعلًا.
    results = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => (async () => {
        await new Promise((r) => setTimeout(r, i * staggerMs));
        return mkSale(i);
      })()),
    );
  } else {
    results = await Promise.allSettled(Array.from({ length: n }, (_, i) => mkSale(i)));
  }

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const afterSnap = await getDoc(doc(db, 'counters', 'invoices'));
  const after = afterSnap.exists() ? ((afterSnap.data() as any).lastNumber as number) : undefined;
  const all = await getDocs(
    query(collection(db, 'invoices'), where('dailyArchiveId', '==', archiveId)),
  );
  const numbers = all.docs.map((d) => (d.data() as any).invoiceNumber).filter(Boolean);
  const archiveData = (await getDoc(doc(db, 'dailyArchives', archiveId))).data() as any;
  const stockLeft: Record<string, number> = {};
  for (const pid of prodIds) {
    stockLeft[pid] = ((await getDoc(doc(db, 'products', pid))).data() as any).quantity;
  }
  // رقم الثقة يُطبع في مخرجات التشغيل لمراجعته قبل الإطلاق.
  console.log(`[high-concurrency] ${archiveId}: n=${n} stagger=${staggerMs}ms → ok=${ok}/${n}`);
  return {
    ok,
    fail: n - ok,
    before,
    after,
    numbers,
    archiveTotalSales: archiveData.totalSales || 0,
    archiveTotalCash: archiveData.totalCash || 0,
    stockLeft,
  };
}

/** الثوابت الصارمة المشتركة: تُطبق على كل سيناريو بلا استثناء. */
function expectSafetyInvariants(r: BurstResult, n: number, qty = 1, prodIds: string[]) {
  // العدّاد يتقدم بعدد الناجحات تمامًا — لا قفز ولا ثبات زائف.
  expect(r.after).toBe(r.before + r.ok);
  // كل فاتورة ناجحة مخزنة ومرقمة بلا أي تكرار.
  expect(r.numbers.length).toBe(r.ok);
  expect(new Set(r.numbers).size).toBe(r.numbers.length);
  // إجماليات الأرشيف تطابق الناجحات بالقرش.
  expect(r.archiveTotalSales).toBe(r.ok * UNIT_PRICE * qty);
  expect(r.archiveTotalCash).toBe(r.ok * UNIT_PRICE * qty);
  // المخزون الإجمالي انخفض بمقدار الناجحات فقط (موزعة round-robin على المنتجات).
  const totalLeft = prodIds.reduce((s, pid) => s + r.stockLeft[pid], 0);
  expect(totalLeft).toBe(prodIds.length * 5000 - r.ok * qty);
}

// --- Scenarios ----------------------------------------------------------------

describe('Stage-3 (3.2): high-concurrency sales — confidence numbers for launch', () => {
  it('N=10 same-tick: ≥8/10 succeed, safety invariants strict', async () => {
    const r = await runBurst(10, 'hc-10-sametick', ['prod-hc-10']);
    expect(r.ok).toBeGreaterThanOrEqual(8);
    expectSafetyInvariants(r, 10, 1, ['prod-hc-10']);
  }, 90000);

  it('N=12 staggered (5ms — أقرب لواقع الكاشير): ≥10/12, invariants strict', async () => {
    const r = await runBurst(12, 'hc-12-staggered', ['prod-hc-12'], { staggerMs: 5 });
    expect(r.ok).toBeGreaterThanOrEqual(10);
    expectSafetyInvariants(r, 12, 1, ['prod-hc-12']);
  }, 90000);

  it('N=15 same-tick stress: ≥10/15 progress, numbering never corrupts', async () => {
    const r = await runBurst(15, 'hc-15-stress', ['prod-hc-15']);
    expect(r.ok).toBeGreaterThanOrEqual(10);
    expectSafetyInvariants(r, 15, 1, ['prod-hc-15']);
  }, 120000);

  it('N=10 multi-product (منتجان — التنافس على العدّاد فقط): ≥8/10, stock split clean', async () => {
    const prodIds = ['prod-hc-mp-a', 'prod-hc-mp-b'];
    const r = await runBurst(10, 'hc-10-multiprod', prodIds);
    expect(r.ok).toBeGreaterThanOrEqual(8);
    expectSafetyInvariants(r, 10, 1, prodIds);
  }, 90000);
});
