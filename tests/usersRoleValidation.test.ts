// REQ-USERROLE — قواعد users تشترط دورًا معروفًا ضمن الأدوار الخمسة بالضبط
// عند كل create/update (الصورة بعد الدمج؛ الغائب في get('role','') == '').
// المراجع: firestore.rules (helper isKnownRole + تعليقات REQ-USERROLE) ·
// ALL_ROLES في utils/permissions.ts · REQ-RULES-5 (قراءة فقط — لم تتغير).
// كل الحالات هنا كتبات عبر القواعد (لا withSecurityRulesDisabled إلا للبذر).
// Run: ضمن npm run test:rules (firebase emulators:exec --only firestore,auth)

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';

const KNOWN_ROLES = ['owner', 'admin', 'supervisor', 'cashier', 'accountant'] as const;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

// البذر فقط يتجاوز القواعد (بنية REQ-RULES-5 نفسها)؛ الكتابات المقاسة تحتها بالقواعد.
async function seedUser(uid: string, data: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', ...data });
  });
}

// سياق مالك حقيقي — كل عملياته تمر عبر القواعد.
function ownerDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

// بذر المالك نفسه عبر withSecurityRulesDisabled عمدًا: إنشاء self-doc عبر غير
// المالك مرفوض بالقواعد (REQ-RULES-4b — noUserDocRules.test.ts:118-126) —
// البذر تمهيد فقط وليس الكتابة قيد القياس.
async function seedOwner(uid: string) {
  await seedUser(uid, { role: 'owner' });
}

// شكل addUser من الواجهة (services/api/users.ts:83-87): email/role/disabled:false.
const newUserShape = (role: unknown) => ({ email: 'new@t.local', role, disabled: false });

describe('REQ-USERROLE (أ) — إنشاء بدور صالح من الخمسة: ALLOWED', () => {
  for (const role of KNOWN_ROLES) {
    it(`owner create بدور ${role}`, async () => {
      await seedOwner('own-' + role);
      const db = ownerDb('own-' + role);
      await assertSucceeds(setDoc(doc(db, 'users', 'u-' + role), newUserShape(role)));
    });
  }
});

describe('REQ-USERROLE (ب) — إنشاء بدور خارج الأدوار الخمسة بدقة: DENIED', () => {
  const BAD_SHAPES: Array<[string, unknown]> = [
    ['Cashier', 'Cashier'],
    ['cashier ', 'cashier '],
    ['', ''],
    ['غياب الحقل', undefined],
    ['رقم', 3],
  ];
  for (const [label, role] of BAD_SHAPES) {
    it(`owner create بـ ${label}`, async () => {
      await seedOwner('own-bad');
      const db = ownerDb('own-bad');
      const payload: Record<string, unknown> = { email: 'bad@t.local', disabled: false };
      // غياب الحقل نهائيًا حين role === undefined — لا نرسله null (المقصود هو الغياب الفعلي).
      if (role !== undefined) payload.role = role;
      await assertFails(setDoc(doc(db, 'users', 'u-bad'), payload));
    });
  }
});

describe('REQ-USERROLE (ج) — تحديث الدور على مستند موجود', () => {
  it('owner يغيّر role من cashier إلى admin: ALLOWED', async () => {
    await seedOwner('own-cha');
    await seedUser('u-cha', { role: 'cashier' });
    const db = ownerDb('own-cha');
    await assertSucceeds(updateDoc(doc(db, 'users', 'u-cha'), { role: 'admin' }));
  });
  it('owner يغيّر role إلى Cashier على مستند admin: DENIED', async () => {
    await seedOwner('own-cha2');
    await seedUser('u-cha2', { role: 'admin' });
    const db = ownerDb('own-cha2');
    await assertFails(updateDoc(doc(db, 'users', 'u-cha2'), { role: 'Cashier' }));
  });
  it('owner يغيّر role إلى Cashier على مستند cashier: DENIED', async () => {
    await seedOwner('own-cha3');
    await seedUser('u-cha3', { role: 'cashier' });
    const db = ownerDb('own-cha3');
    await assertFails(updateDoc(doc(db, 'users', 'u-cha3'), { role: 'Cashier' }));
  });
});

describe('REQ-USERROLE (د) — وثيقة بلا role', () => {
  it('owner يُسند cashier لوثيقة بلا role: ALLOWED (الصورة بعد الدمج تحمل دورًا معروفًا)', async () => {
    await seedOwner('own-asg');
    await seedUser('norole-asg', {});
    const db = ownerDb('own-asg');
    await assertSucceeds(updateDoc(doc(db, 'users', 'norole-asg'), { role: 'cashier' }));
  });
  it('owner يعطّل وثيقة بلا role عبر disabled فقط (الصورة تبقى بلا role): DENIED', async () => {
    await seedOwner('own-dis1');
    await seedUser('norole-dis', {});
    const db = ownerDb('own-dis1');
    await assertFails(updateDoc(doc(db, 'users', 'norole-dis'), { disabled: true }));
  });
  it('owner يعطّل وثيقة بلا role مع إسناد role صالح في نفس الكتابة: ALLOWED', async () => {
    await seedOwner('own-dis2');
    await seedUser('norole-dis2', {});
    const db = ownerDb('own-dis2');
    await assertSucceeds(updateDoc(doc(db, 'users', 'norole-dis2'), { disabled: true, role: 'cashier' }));
  });
});

describe('REQ-USERROLE (هـ) — الحماية عبر merge: update جزئي يحمل role القديم', () => {
  it('owner يعطّل cashier (disabled:true فقط): ALLOWED — الصورة بعد الدمج تحمل role القديم', async () => {
    await seedOwner('own-tgl');
    await seedUser('cash-tgl', { role: 'cashier' });
    const db = ownerDb('own-tgl');
    // setUserDisabled (services/api/users.ts:124) يبعث {disabled} — الصورة بعد الدمج تحمل role القديم تلقائيًا.
    await assertSucceeds(updateDoc(doc(db, 'users', 'cash-tgl'), { disabled: true }));
    await assertSucceeds(updateDoc(doc(db, 'users', 'cash-tgl'), { disabled: false }));
  });
});

describe('REQ-USERROLE (و) — الحمايات القديمة تبقى', () => {
  it('owner لا يعطّل وثيقة owner (R1): DENIED', async () => {
    await seedOwner('own-pro');
    await seedUser('owner-tgt', { role: 'owner' });
    const db = ownerDb('own-pro');
    await assertFails(updateDoc(doc(db, 'users', 'owner-tgt'), { disabled: true }));
  });
  it('admin لا يكتب users: DENIED', async () => {
    await seedUser('adm-dis', { role: 'admin' });
    await seedUser('cash-tgt', { role: 'cashier' });
    const db = ownerDb('adm-dis');
    await assertFails(updateDoc(doc(db, 'users', 'cash-tgt'), { disabled: true }));
    await assertFails(updateDoc(doc(db, 'users', 'cash-tgt'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'users', 'new-via-admin'), newUserShape('admin')));
  });
});
