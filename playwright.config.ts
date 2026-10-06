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
// E2E-PILOT-1: port/channel overridable for machines where 5173 is held
// (orphaned vite) or Playwright browsers are uninstallable (CDN blocked):
//   E2E_PORT=5174 E2E_CHANNEL=chrome npx playwright test ...
// Built purely in JS (no shell expansion, no new dependency) so it works
// on Windows cmd as-is. reuseExistingServer stays false: the config always
// starts its own emulator-backed vite (VITE_USE_EMULATORS=1).
// E2E_PORT defaults to 5173; both trimmed so Windows cmd trailing spaces
// (`set E2E_PORT=5174 && ...`) can never leak into the values.
const E2E_PORT = (process.env.E2E_PORT || '5173').trim() || '5173';
const E2E_CHANNEL = ((process.env.E2E_CHANNEL || '').trim() || undefined) as 'chrome' | undefined;
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(E2E_CHANNEL ? { channel: E2E_CHANNEL } : {}) } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_USE_EMULATORS: '1' },
  },
});
