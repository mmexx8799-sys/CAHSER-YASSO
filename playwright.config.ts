import { defineConfig, devices } from '@playwright/test';

// Stage-3 (3.1) — E2E حقيقي لأهم مسار:
// تسجيل دخول → فتح أرشيف → بيع → مرتجع → إغلاق أرشيف → نسخ احتياطي → استرجاع
//
// التشغيل المحلي (يتطلب Java + firebase-tools + متصفحات Playwright):
//   1) npx playwright install --with-deps chromium
//   2) npm run test:e2e
//     (= firebase emulators:exec --only firestore,auth "playwright test")
//     الإمulators تُفرغ تلقائيًا لكل تشغيل؛ global-setup يزرع حساب أدمن E2E.
//
// ملاحظات أمان:
// - المتصفح يعمل ضد المحاكيات فقط عبر VITE_USE_EMULATORS=1 (انظر webServer
//   أدناه + services/firebase.ts) — لا يلمس الإنتاج إطلاقًا.
// - e2e/ مستثناة من tsconfig (typecheck الإنتاج) — Playwright يفحص أنواعه
//   بنفسه وقت التشغيل؛ هذا مقصود وليس إخفاء أخطاء.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_USE_EMULATORS: '1' },
  },
});
