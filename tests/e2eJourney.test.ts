// Stage-3 (3.1) — رحلة E2E خدمية قابلة للتنفيذ في CI بلا متصفح.
//
// نفس مسار Playwright (e2e/happy-path.spec.ts) لكن عبر طبقة الخدمات الحقيقية
// (services/api.ts) ضد محاكي Firestore — يعمل في CI ضمن السويت الحالي:
//   npm run test:rules   (fileParallelism=false — عزل namespaces مشتركة)
//
// المسار: فتح أرشيف → بيع نقدي → مرتجع مربوط بفاتورة → إغلاق أرشيف →
// رفض بيع على المقفول → نسخ احتياطي → ضبط مصنع → استرجاع → بيع لاحق بلا
// تكرار أرقام (ثابت BUG-P0-15).
//
// ملاحظة: نسخة المتصفح تغطي المرتجع النقدي غير المربوط عبر UI؛ هذه النسخة
// تغطي المرتجع *المربوط* (originalInvoiceId) — معًا يغطيان فرعي المرتجع.

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
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { CartItem, Invoice } from '../types';

// tests/setup.ts يربط singletons المحاكيات + يزيف toast قبل هذا الاستيراد.
const {
  processSale,
  processReturn,
  startNewDailyArchive,
  closeDailyArchive,
  backupData,
  factoryReset,
  restoreData,
} = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // يطابق services/firebase.ts
const ADMIN_EMAIL = 'admin-journey@test.local';
const ADMIN_PASSWORD = 'secret123';
const PROD_ID = 'prod-journey-1';

function mkCartItem(qty: number): CartItem {
  return {
    id: PROD_ID,
    code: 'C-prod-journey-1',
    name: 'منتج الرحلة',
    price: 100,
    quantity: 500,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
    buyQuantity: qty,
    priceType: 'retail',
  } as CartItem;
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
    await createUserWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function signInAdmin() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // RBAC-2026-09 R2: restore/factoryReset now requires owner — seed as owner to keep journey green
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: ADMIN_EMAIL, role: 'owner' });
  });
}

async function seedProduct() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', PROD_ID), {
      id: PROD_ID,
      code: 'C-prod-journey-1',
      name: 'منتج الرحلة',
      price: 100,
      retailCashPrice: 100,
      retailCreditPrice: 100,
      wholesaleCashPrice: 100,
      wholesaleCreditPrice: 100,
      quantity: 500,
      categoryId: 'cat-1',
      createdAt: Date.now(),
      searchableIndex: [],
    });
  });
}

describe('E2E journey (service-level, emulator): archive → sale → linked return → close → backup → restore', () => {
  it('full flow preserves totals, numbering, and restore integrity', async () => {
    await testEnv.clearFirestore();
    await seedProduct();
    await signInAdmin();
    const db = getDB();

    // 1) فتح أرشيف (المسار الحقيقي — يمنع وجود مفتوح مسبقًا).
    const archive = await startNewDailyArchive();
    expect(archive.status).toBe('open');

    // 2) بيع نقدي: 2 × 100 = 200 → INV-000001، مخزون 498.
    await processSale({
      items: [mkCartItem(2)],
      subtotal: 200,
      discount: 0,
      total: 200,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: archive.id,
    });
    const invoicesSnap = await getDocs(collection(db, 'invoices'));
    expect(invoicesSnap.size).toBe(1);
    const invoiceDoc = invoicesSnap.docs[0];
    expect((invoiceDoc.data() as any).invoiceNumber).toBe('INV-000001');
    expect((await getDoc(doc(db, 'counters', 'invoices'))).data()).toMatchObject({ lastNumber: 1 });
    expect(((await getDoc(doc(db, 'products', PROD_ID))).data() as any).quantity).toBe(498);
    expect(((await getDoc(doc(db, 'dailyArchives', archive.id))).data() as any).totalSales).toBe(200);

    // 3) مرتجع مربوط جزئي: 1 من 2 → مخزون 499، totalReturns=100.
    await processReturn([mkCartItem(1)], archive.id, undefined, invoiceDoc.id);
    const returnsSnap = await getDocs(collection(db, 'returns'));
    expect(returnsSnap.size).toBe(1);
    expect((returnsSnap.docs[0].data() as any).originalInvoiceId).toBe(invoiceDoc.id);
    expect(((await getDoc(doc(db, 'products', PROD_ID))).data() as any).quantity).toBe(499);
    const archiveAfterReturn = (await getDoc(doc(db, 'dailyArchives', archive.id))).data() as any;
    expect(archiveAfterReturn.totalReturns).toBe(100);
    expect(archiveAfterReturn.totalReturnsCash).toBe(100);

    // 4) إغلاق الأرشيف + رفض بيع لاحق على المقفول.
    await closeDailyArchive(archive.id);
    expect(((await getDoc(doc(db, 'dailyArchives', archive.id))).data() as any).status).toBe('closed');
    await expect(
      processSale({
        items: [mkCartItem(1)],
        subtotal: 100,
        discount: 0,
        total: 100,
        paymentMethod: 'نقدا' as Invoice['paymentMethod'],
        dailyArchiveId: archive.id,
      }),
    ).rejects.toThrow(/غير مفتوحة/);

    // 5) نسخ احتياطي v2 يحمل الفواتير والمرتجعات والعدّادات.
    const backup = await backupData();
    expect((backup as any).schemaVersion).toBe(2);
    expect((backup as any).invoices.length).toBe(1);
    expect((backup as any).returns.length).toBe(1);
    expect((backup as any).counters.find((c: any) => c.id === 'invoices')?.lastNumber).toBe(1);

    // 6) ضبط مصنع يمسح كل شيء، ثم استرجاع يعيد كل شيء.
    await factoryReset();
    expect((await getDocs(collection(getDB(), 'invoices'))).empty).toBe(true);
    await signInAdmin(); // الجلسة تبقى، لكن أعد التثبيت بعد المسح الشامل.
    await restoreData(JSON.parse(JSON.stringify(backup)));

    const invoicesAfter = await getDocs(collection(getDB(), 'invoices'));
    expect(invoicesAfter.size).toBe(1);
    expect((invoicesAfter.docs[0].data() as any).invoiceNumber).toBe('INV-000001');
    expect((await getDocs(collection(getDB(), 'returns'))).size).toBe(1);
    expect(((await getDoc(doc(getDB(), 'counters', 'invoices'))).data() as any).lastNumber).toBe(1);

    // 7) البيع التالي بعد الاسترجاع يكمل التسلسل (INV-000002 — لا تكرار).
    // الأرشيف المسترجع مغلق، وstartNewDailyArchive يرفض نفس اليوم المغلق،
    // لذا نفتح أرشيفًا تكميليًا مباشرة (نفس ما يفعله الكاشير في يوم جديد).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'dailyArchives', `${archive.id}-next`), {
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
    await signInAdmin();
    await processSale({
      items: [mkCartItem(1)],
      subtotal: 100,
      discount: 0,
      total: 100,
      paymentMethod: 'نقدا' as Invoice['paymentMethod'],
      dailyArchiveId: `${archive.id}-next`,
    });
    const allInvoices = await getDocs(collection(getDB(), 'invoices'));
    const numbers = allInvoices.docs.map((d) => (d.data() as any).invoiceNumber);
    expect(numbers).toContain('INV-000002');
    expect(new Set(numbers).size).toBe(numbers.length); // صفر تكرار
    expect(((await getDoc(doc(getDB(), 'counters', 'invoices'))).data() as any).lastNumber).toBe(2);
  });
});
