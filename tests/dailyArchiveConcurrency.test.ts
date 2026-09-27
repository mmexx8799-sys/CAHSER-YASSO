// REQ-ARCHIVE-1 (E-4) — سباق startNewDailyArchive: الفحص + الإنشاء داخل transaction واحدة.
//
// السياق: النسخة السابقة كانت قراءتين مستقلتين (getOpenDailyArchive ثم getDoc)
// ثم setDoc — فجوة زمنية تسمح لنداء متزامن (ضغطة مزدوجة/جهازان) بالكتابة فوق
// يومية بدأت للتو. الإصلاح: فحص today-doc + إنشاؤه داخل runTransactionWithRetry
// (مرجع مباشر — الـquery يبقى خارجيًا إجباريًا لقيد firebase v10 الموثق في BUG-P0-1).
//
// withInFlightGuard عدّاد فقط (services/inflight.ts) — لا يُسلسل — لذا
// Promise.allSettled في نفس الـtick تزامن حقيقي لا وهمي.
//
// التشغيل:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/dailyArchiveConcurrency.test.ts"
// السويت الكامل تسلسلي إجباريًا:
//   npm run test:rules
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
  getDocs,
  collection,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// tests/setup.ts يربط singletons المحاكيات + يزيف toast قبل هذا الاستيراد.
const { startNewDailyArchive, closeDailyArchive } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // يطابق services/firebase.ts
const OWNER_EMAIL = 'owner-archive-race@test.local';
const OWNER_PASSWORD = 'secret123';

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
    await createUserWithEmailAndPassword(fbAuth, OWNER_EMAIL, OWNER_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function signInOwner() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, OWNER_EMAIL, OWNER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // archive.open يتطلب owner/admin/supervisor — نزرع owner (clearFirestore يمسح users).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: OWNER_EMAIL, role: 'owner' });
  });
}

describe('REQ-ARCHIVE-1 — startNewDailyArchive atomicity (E-4)', () => {
  it('نداءان متزامنان لنفس اليوم: واحد ينجح والآخر يُرفض — يومية واحدة فقط', async () => {
    await testEnv.clearFirestore();
    await signInOwner();
    const db = getDB();

    const [a, b] = await Promise.allSettled([
      startNewDailyArchive(),
      startNewDailyArchive(),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const bad = [a, b].filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);

    // الغالب same-tick: "موجودة ومغلقة بالفعل" (كلا الـpre-checks يجتاز قبل أي commit)؛
    // لو تأخر أحد النداءين فرأى المفتوحة فالبديل "ما زالت مفتوحة" — كلتاهما رفض منطقي مقصود.
    const msg = String((bad[0] as PromiseRejectedResult).reason?.message ?? '');
    expect(msg).toMatch(/موجودة|مفتوحة/);

    // Σ = يومية واحدة فقط — لا كتابة فوق كتابة.
    const snap = await getDocs(collection(db, 'dailyArchives'));
    expect(snap.size).toBe(1);
    const data = snap.docs[0].data() as any;
    expect(data.status).toBe('open');
    expect(data.totalSales).toBe(0);
    expect(data.totalReturns).toBe(0);
  });

  it('المسار العادي بلا تزامن: نفس الرسائل ونفس البيانات كما قبل الإصلاح', async () => {
    await testEnv.clearFirestore();
    await signInOwner();

    const archive = await startNewDailyArchive();
    expect(archive.status).toBe('open');
    expect(archive.totalSales).toBe(0);

    // يومية مفتوحة → رفض بنفس النص الحرفي.
    await expect(startNewDailyArchive()).rejects.toThrow(/ما زالت مفتوحة/);

    // إغلاق ثم محاولة نفس اليوم → رفض بنفس النص الحرفي.
    await closeDailyArchive(archive.id);
    await expect(startNewDailyArchive()).rejects.toThrow(/موجودة ومغلقة بالفعل/);
  });
});
