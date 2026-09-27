// S-1 — addUser: fail-fast على users.manage (owner فقط منذ R5) قبل إنشاء حساب Auth.
//
// الفجوة: addUser كان يتحقق من assertOnline وصحة الدور فقط، بلا فحص قدرة المتصل —
// غير المالك كان ينشئ حساب Auth يتيمًا (createUserWithEmailAndPassword ينجح) ثم
// يُرفض setDoc(users/uid) بقواعد Firestore (admin DENIED على users.create).
// الإصلاح: await assertCan('users.manage') بعد فحص الدور وقبل أي Auth.
//
// حد تغطية مقصود: مسار النجاح (owner + دور صالح) غير مغطى هنا — addUser ينشئ
// secondary app whose Auth غير موصول بمحاكي Auth (tests/setup.ts يوصل الـsingleton
// فقط)، فتشغيله في الاختبار سيخاطب Production Auth (casher-yasoo الحي) وينشئ
// مستخدمًا حقيقيًا. الاختباران أدناه مرفوضان قبل أي Auth SDK call فهما آمنان.
// مسار النجاح مغطى يدويًا عبر UsersPage (محجوبة بـcan('users.manage')).
//
// التشغيل:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/addUserGuards.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// tests/setup.ts يربط singletons المحاكيات + يزيف toast قبل هذا الاستيراد.
const { addUser } = await import('../services/api');
const { getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // يطابق services/firebase.ts

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function signInAs(email: string, password: string, role: string) {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  try {
    await createUserWithEmailAndPassword(fbAuth, email, password);
  } catch (e: any) {
    if (!String(e?.code).includes('email-already-in-use')) throw e;
  }
  await signInWithEmailAndPassword(fbAuth, email, password);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email, role, disabled: false });
  });
}

describe('S-1 — addUser capability preflight', () => {
  it('admin بدور صالح يُرفض قبل إنشاء أي حساب Auth (بلا يتيم)', async () => {
    await testEnv.clearFirestore();
    await signInAs('addguard-admin@test.local', 'secret123', 'admin');
    const freshEmail = `orphan-${Date.now()}@test.local`;

    await expect(addUser(freshEmail, 'secret123', 'cashier' as any)).rejects.toThrow(
      /ليس لديك صلاحية/i,
    );

    // الإثبات الميكانيكي لعدم اليتم: الحساب لم يُنشأ أصلًا — الدخول به مستحيل.
    await expect(
      signInWithEmailAndPassword(getAuthInstance(), freshEmail, 'secret123'),
    ).rejects.toThrow(/user-not-found|invalid-credential/i);
  });

  it('غير مسجل الدخول يُرفض قبل أي عمل', async () => {
    await testEnv.clearFirestore();
    try { await firebaseSignOut(getAuthInstance()); } catch { /* noop */ }
    await expect(addUser('nouser@test.local', 'secret123', 'cashier' as any)).rejects.toThrow(
      /تسجيل الدخول/i,
    );
  });
});
