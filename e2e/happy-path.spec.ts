// Stage-3 (3.1) — E2E حقيقي (Playwright + Chromium) لأهم مسار:
// تسجيل دخول → فتح أرشيف → بيع → مرتجع → إغلاق أرشيف → نسخ احتياطي → استرجاع
//
// التشغيل: npm run test:e2e
//   (= firebase emulators:exec --only firestore,auth "playwright test")
// المتطلبات: Java + firebase-tools + npx playwright install --with-deps chromium
// الأمان: المتصفح مربوط بالمحاكيات عبر VITE_USE_EMULATORS=1 — لا يلمس الإنتاج.
//
// تقسيم المسؤولية (مقصود وموثق):
// - هذا الملف يقود المتصفح الحقيقي بالنقرات على نفس الأزرار التي يستخدمها
//   الكاشير، ويتحقق من الحالة عبر Firestore Admin SDK (قراءة فقط).
// - متغيرات المسار الحرجة (مرتجع مربوط بفاتورة originalInvoiceId، اشتقاق
//   عدّادات v1) مغطاة خدميًا في tests/e2eJourney.test.ts الذي يعمل في CI
//   بلا متصفح — لأن ربط المرتجع بالفاتورة عبر UI يتطلب بحث عميل تفاعليًا
//   (debounce) وهو هش كأتمتة، بينما منطقه الحرج هو نفسه processReturn.
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PROJECT_ID = 'casher-yasoo';
const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-admin@test.local';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-secret-123';
const PRODUCT_NAME = 'منتج E2E — قميص';
const CATEGORY_ID = 'e2e-cat-1';
const PRODUCT_ID = 'e2e-prod-1';

function db() {
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

async function seedCatalog() {
  const firestore = db();
  await firestore.doc(`categories/${CATEGORY_ID}`).set({ name: 'E2E' });
  await firestore.doc(`products/${PRODUCT_ID}`).set({
    id: PRODUCT_ID,
    code: 'E2E-001',
    name: PRODUCT_NAME,
    price: 100,
    retailCashPrice: 100,
    retailCreditPrice: 100,
    wholesaleCashPrice: 100,
    wholesaleCreditPrice: 100,
    quantity: 50,
    categoryId: CATEGORY_ID,
    createdAt: Date.now(),
    searchableIndex: [],
  });
}

test.describe('E2E happy path — login → archive → sale → return → close → backup → restore', () => {
  test.beforeAll(async () => {
    await seedCatalog();
  });

  test('full flow in a real browser against the emulators', async ({ page }) => {
    const firestore = db();

    // --- 1) تسجيل دخول حقيقي عبر نموذج الدخول ---
    await page.goto('/#/login');
    await page.locator('#email').fill(E2E_EMAIL);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('نقطة البيع').first()).toBeVisible({ timeout: 15000 });

    // --- 2) فتح أرشيف من الإعدادات (زر حقيقي) ---
    await page.goto('/#/settings');
    await expect(page.getByTestId('archive-status')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('archive-start').click();
    const status = page.getByTestId('archive-status');
    await expect(status).toContainText('مفتوحة', { timeout: 15000 });
    const statusText = (await status.textContent()) || '';
    const archiveId = statusText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    expect(archiveId, 'archive id visible in status').toBeTruthy();

    // --- 3) بيع نقدي عبر POS (نقرات حقيقية: بطاقة → سلة → دفع → تأكيد) ---
    await page.goto('/#/');
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible({ timeout: 15000 });
    await page.getByText(PRODUCT_NAME).first().click();
    await page.getByText('عرض السلة').click();
    await expect(page.getByText('السلة').first()).toBeVisible();
    await page.getByText('دفع', { exact: true }).click();
    await expect(page.getByText('إتمام البيع')).toBeVisible();
    await page.getByTestId('pos-confirm-payment').click();
    await expect(page.getByText('تمت عملية البيع بنجاح!')).toBeVisible({ timeout: 15000 });

    const invoicesSnap = await firestore.collection('invoices').get();
    expect(invoicesSnap.size).toBe(1);
    const invoice = invoicesSnap.docs[0].data() as any;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(invoice.total).toBe(100);
    expect(invoice.dailyArchiveId).toBe(archiveId);
    const archiveSnap = await firestore.doc(`dailyArchives/${archiveId}`).get();
    expect((archiveSnap.data() as any).totalSales).toBe(100);
    const counterSnap = await firestore.doc('counters/invoices').get();
    expect((counterSnap.data() as any).lastNumber).toBe(1);

    // --- 4) مرتجع نقدي غير مربوط عبر المرتجعات (كتالوج → سلة → تأكيد) ---
    await page.goto('/#/returns');
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible({ timeout: 15000 });
    await page.getByText(PRODUCT_NAME).first().click();
    await page.getByText('سلة المرتجعات').click();
    await page.getByTestId('return-confirm').click();
    await expect(page.getByText('تمت عملية الإرجاع بنجاح!')).toBeVisible({ timeout: 15000 });

    const returnsSnap = await firestore.collection('returns').get();
    expect(returnsSnap.size).toBe(1);
    expect((returnsSnap.docs[0].data() as any).total).toBe(100);
    const archiveAfterReturn = await firestore.doc(`dailyArchives/${archiveId}`).get();
    expect((archiveAfterReturn.data() as any).totalReturns).toBe(100);

    // --- 5) إغلاق الأرشيف (زر حقيقي + مودال تأكيد حقيقي) ---
    await page.goto('/#/settings');
    await page.getByTestId('archive-close').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('archive-status')).toContainText('جميع اليوميات مغلقة', {
      timeout: 15000,
    });
    const closedSnap = await firestore.doc(`dailyArchives/${archiveId}`).get();
    expect((closedSnap.data() as any).status).toBe('closed');

    // --- 6) نسخ احتياطي (زر حقيقي + مودال تأكيد + حدث تنزيل حقيقي) ---
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      (async () => {
        await page.getByTestId('backup-create').click();
        await page.getByTestId('confirm-accept').click();
      })(),
    ]);
    const backupPath = path.join(os.tmpdir(), `e2e-backup-${Date.now()}.json`);
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    expect(backup.schemaVersion).toBe(2);
    expect(Array.isArray(backup.invoices)).toBe(true);
    expect(backup.invoices.length).toBe(1);
    expect(backup.invoices[0].invoiceNumber).toBe(invoice.invoiceNumber);
    expect(Array.isArray(backup.counters)).toBe(true);

    // --- 7) استرجاع (اختيار ملف حقيقي + تأكيد + تحقق: لا أرقام مكررة) ---
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 30000 }),
      page.getByTestId('restore-trigger').click(),
    ]);
    await fileChooser.setFiles(backupPath);
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('تمت استعادة البيانات بنجاح!')).toBeVisible({
      timeout: 30000,
    });

    const invoicesAfter = await firestore.collection('invoices').get();
    expect(invoicesAfter.size).toBe(1);
    expect((invoicesAfter.docs[0].data() as any).invoiceNumber).toBe(invoice.invoiceNumber);
    const counterAfter = await firestore.doc('counters/invoices').get();
    expect((counterAfter.data() as any).lastNumber).toBe(1);

    fs.unlinkSync(backupPath);
  });
});
