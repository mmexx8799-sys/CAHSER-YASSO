// E2E global setup — يزرع حساب الأدمن في المحاكيات قبل فتح المتصفح.
//
// يعمل داخل `firebase emulators:exec` (توجد FIRESTORE_EMULATOR_HOST و
// FIREBASE_AUTH_EMULATOR_HOST تلقائيًا) أو ضد محاكيات تعمل يدويًا على
// المنافذ الافتراضية 8080/9099. يستخدم firebase-admin (devDependency
// موجودة أصلًا) فيتجاوز القواعد — تمامًا كما يفعّل الأدمن الحقيقي أول
// حساب قبل أول استخدام (withSecurityRulesDisabled في اختبارات vitest).
//
// بيانات الدخول ثابتة ويقرأها happy-path.spec.ts من نفس الثوابت عبر env
// مع قيم افتراضية متطابقة — لا أسرار هنا (محاكي محلي فقط).
import admin from 'firebase-admin';

const PROJECT_ID = 'casher-yasoo';
export const E2E_EMAIL = process.env.E2E_EMAIL || 'e2e-admin@test.local';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'e2e-secret-123';

async function globalSetup() {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  let uid: string;
  try {
    const existing = await admin.auth().getUserByEmail(E2E_EMAIL);
    uid = existing.uid;
  } catch {
    const created = await admin.auth().createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    });
    uid = created.uid;
  }

  // users/{uid} إنشاؤه admin-only في القواعد — Admin SDK يتجاوزها للزرع فقط.
  await admin
    .firestore()
    .doc(`users/${uid}`)
    .set({ email: E2E_EMAIL, role: 'admin' }, { merge: true });
}

export default globalSetup;
