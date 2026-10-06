// E2E global setup — يزرع حساب الأدمن في المحاكيات قبل فتح المتصفح.
//
// يعمل داخل `firebase emulators:exec` (توجد FIRESTORE_EMULATOR_HOST و
// FIREBASE_AUTH_EMULATOR_HOST تلقائيًا) أو ضد محاكيات تعمل يدويًا على
// المنافذ الافتراضية 8080/9099.
//
// يستخدم REST المحاكيات مباشرة (بلا firebase-admin إطلاقًا): سلسلة
// jsonwebtoken/semver وgrpc-js-ts في firebase-admin تُسقط Node بخطأ
// داخلي تحت محمّل Playwright على هذا الجهاز — REST يتجاوز المشكلة
// تمامًا. Admin SDK يتجاوز القواعد؛ REST المحاكي مفتوح أصلًا للزرع فقط.
//
// بيانات الدخول ثابتة ويقرأها happy-path.spec.ts من نفس الثوابت عبر env
// مع قيم افتراضية متطابقة — لا أسرار هنا (محاكي محلي فقط).

const PROJECT_ID = 'casher-yasoo';
export const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-admin@test.local';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-secret-123';

function fsBase(): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  return `http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}

function authBase(): string {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  return `http://${host}`;
}

async function ensureEmulatorUser(email: string, password: string): Promise<string> {
  const post = (path: string, body: unknown) =>
    fetch(`${authBase()}/identitytoolkit.googleapis.com/v1/${path}?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<any>);
  const created = await post('accounts:signUp', { email, password, returnSecureToken: true });
  if (created.localId) return created.localId as string;
  if (created?.error?.message === 'EMAIL_EXISTS') {
    const signedIn = await post('accounts:signInWithPassword', { email, password, returnSecureToken: true });
    if (signedIn.localId) return signedIn.localId as string;
  }
  throw new Error('E2E auth seed failed: ' + JSON.stringify(created).slice(0, 200));
}

async function globalSetup() {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

  const uid = await ensureEmulatorUser(E2E_EMAIL, E2E_PASSWORD);

  // users/{uid} إنشاؤه admin-only في القواعد — المحاكي يقبل
  // `Authorization: Bearer owner` لتجاوز القواعد في الزرع فقط.
  // المحاكيات طازجة تحت emulators:exec فالمستند غائب؛ PATCH احتياطيًا.
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
  const url = `${fsBase()}/users?documentId=${uid}`;
  const body = JSON.stringify({
    fields: {
      email: { stringValue: E2E_EMAIL },
      role: { stringValue: 'admin' },
    },
  });
  const createdRes = await fetch(url, { method: 'POST', headers, body });
  if (createdRes.status === 409) {
    await fetch(`${fsBase()}/users/${uid}`, { method: 'PATCH', headers, body });
  } else if (!createdRes.ok) {
    throw new Error('E2E users seed failed: ' + createdRes.status);
  }
}

export default globalSetup;
