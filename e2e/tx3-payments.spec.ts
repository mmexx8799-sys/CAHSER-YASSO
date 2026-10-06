// E2E pilot (Playwright + Chromium) — TX3-UI supplier-payment binding.
//
// Scope: login → supplier payment success with stable-key proof
// (doc id is UUID-shaped == opKey, balance moved once, key cleared) →
// 1ms double-submit still yields exactly one doc (processingRef guard).
//
// Run on Windows cmd (official command; needs emulators + free port + browser):
//   set E2E_PORT=5174 && set E2E_CHANNEL=chrome && npx firebase emulators:exec --only firestore,auth "npx playwright test e2e/tx3-payments.spec.ts"
// (sh: E2E_PORT=5174 E2E_CHANNEL=chrome npx firebase emulators:exec ...)
// E2E_PORT defaults to 5173; E2E_CHANNEL (e.g. 'chrome') uses the system
// browser when Playwright's own browsers can't be downloaded.
// Safety: emulator-backed browser via VITE_USE_EMULATORS=1 — never production.
// Emulator reads go through Firestore REST (no firebase-admin: its native
// chains crash Node under the Playwright loader on this machine).
import { test, expect } from '@playwright/test';

const PROJECT_ID = 'casher-yasoo';
const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-admin@test.local';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-secret-123';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fsBase(): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  return `http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}

const num = (f: any): number => Number(f?.integerValue ?? f?.doubleValue);

// REST verification goes through the emulator with the owner bypass
// (rules would otherwise apply to these bare HTTP calls; the app itself
// authenticates normally in the browser).
const REST_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

async function seedSupplier(id: string, balance: number) {
  const res = await fetch(`${fsBase()}/suppliers?documentId=${id}`, {
    method: 'POST',
    headers: REST_HEADERS,
    body: JSON.stringify({
      fields: {
        name: { stringValue: `مورّد E2E ${id}` },
        balance: { integerValue: String(balance) },
        createdAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  if (!res.ok) throw new Error('seedSupplier failed: ' + res.status);
}

async function supplierBalance(id: string): Promise<number> {
  const res = await fetch(`${fsBase()}/suppliers/${id}`, { headers: REST_HEADERS });
  if (!res.ok) throw new Error('supplier read failed: ' + res.status);
  const doc = (await res.json()) as any;
  return num(doc.fields?.balance);
}

interface PayDoc {
  id: string;
  amount: number;
  supplierId: string;
}

async function supplierPayments(supplierId: string): Promise<PayDoc[]> {
  const res = await fetch(`${fsBase()}:runQuery`, {
    method: 'POST',
    headers: REST_HEADERS,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'supplierPayments' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'supplierId' },
            op: 'EQUAL',
            value: { stringValue: supplierId },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error('runQuery failed: ' + res.status);
  const rows = (await res.json()) as any[];
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      id: String(r.document.name).split('/').pop() as string,
      amount: num(r.document.fields?.amount),
      supplierId: r.document.fields?.supplierId?.stringValue,
    }));
}

async function login(page: any) {
  await page.goto('/#/login');
  await page.locator('#email').fill(E2E_EMAIL);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.getByTestId('login-submit').click();
  // Authenticated shell: user email in the header (the 'نقطة البيع' nav
  // label also matches a hidden mobile element, so assert the email).
  await expect(page.getByText(E2E_EMAIL).first()).toBeVisible({ timeout: 15000 });
}

test.describe('E2E pilot — supplier payment stable-key binding', () => {
  test('payment success: one UUID-id doc, balance once, key cleared', async ({ page }) => {
    const sid = 'e2e-pay-sup-1';
    await seedSupplier(sid, 2800);
    await login(page);

    await page.goto(`/#/suppliers/${sid}`);
    await expect(page.locator('#supplierPaymentAmount')).toBeVisible({ timeout: 15000 });
    await page.locator('#supplierPaymentAmount').fill('100');
    await page.locator('#supplierPaymentNotes').fill('E2E pilot');
    await page.locator('form', { has: page.locator('#supplierPaymentAmount') }).getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText('تمت إضافة الدفعة بنجاح').first()).toBeVisible({ timeout: 15000 });

    const docs = await supplierPayments(sid);
    expect(docs.length).toBe(1);
    // Stable-key proof: with opKey the doc id IS the UUID key (random path
    // would mint a 20-char Firestore id).
    expect(docs[0].id).toMatch(UUID_RE);
    expect(docs[0].amount).toBe(100);
    expect(docs[0].supplierId).toBe(sid);
    expect(await supplierBalance(sid)).toBe(2700);
    // Key lifecycle: cleared after success.
    expect(await page.evaluate(() => sessionStorage.getItem('tx-opkey:supplierPayment'))).toBeNull();
  });

  test('1ms double submit: exactly one doc (processingRef guard)', async ({ page }) => {
    const sid = 'e2e-pay-sup-2';
    await seedSupplier(sid, 1900);
    await login(page);

    await page.goto(`/#/suppliers/${sid}`);
    await expect(page.locator('#supplierPaymentAmount')).toBeVisible({ timeout: 15000 });
    await page.locator('#supplierPaymentAmount').fill('100');
    await page.evaluate(() => {
      const input = document.getElementById('supplierPaymentAmount') as HTMLInputElement;
      const form = input.closest('form')!;
      form.requestSubmit();
      setTimeout(() => form.requestSubmit(), 1);
    });
    await expect(page.getByText('تمت إضافة الدفعة بنجاح').first()).toBeVisible({ timeout: 15000 });

    const docs = await supplierPayments(sid);
    expect(docs.length).toBe(1);
    expect(docs[0].id).toMatch(UUID_RE);
    expect(await supplierBalance(sid)).toBe(1800);
  });

  test('login works against the emulators', async ({ page }) => {
    await login(page);
    // Fresh emulator has no open archive: the guard heading is visible.
    await expect(page.getByRole('heading', { name: 'لم يتم فتح اليومية' })).toBeVisible({ timeout: 15000 });
  });
});
