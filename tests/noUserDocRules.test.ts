// REQ-RULES-4b — مستخدم مسجّل دخول **بدون** وثيقة users/{uid} ⇒ رفض شامل (fail-closed).
//
// Rule under test:
//   - كل القراءات تمر عبر isActiveUser()/hasRole() → getUserData() = get(users/auth.uid)
//     وهو يرمي لوثيقة غير موجودة (firestore.rules:10) ⇒ رفض حتى لو حقل disabled غائب.
//   - users/{uid} create: isOwner() فقط (firestore.rules:107) — غير المالك لا يُنشئ وثيقته.
//   - invoices/counters create: hasCap/isAdmin/isStaff عبر نفس getUserData().
//
// حالة ضابطة: نفس uid بعد إنشاء وثيقته بواسطة owner (role: 'cashier') يقرأ products بنجاح —
// يثبت أن الرفض مصدره غياب الوثيقة لا أي شيء آخر.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/noUserDocRules.test.ts"
// Full suite (sequential — shared emulator namespaces):
//   npm run test:rules

import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const GHOST_UID = 'nouserdoc-ghost';

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

// --- Seeds (rules disabled — كما تفعل بقية اختبارات القواعد) -----------------

async function seed(col: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data);
  });
}

async function seedOwnerViaOwnerContext() {
  // owner doc له فقط يُزوَّر خارج القواعد (create على users هو owner-only أصلاً)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', 'nouserdoc-owner'),
      { email: 'owner@t.local', role: 'owner', disabled: false },
    );
  });
  return testEnv.authenticatedContext('nouserdoc-owner').firestore();
}

// بعد إيجاد وثيقة المالك، owner ينشئ وثيقة كاشير عبر القواعد نفسها (لا تعطيل).

// --- Helpers ----------------------------------------------------------------

function ghostDb() {
  return testEnv.authenticatedContext(GHOST_UID).firestore();
}

describe('REQ-RULES-4b — signed-in WITHOUT users/{uid} doc', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    // مجموعات عليها بيانات حقيقية حتى يكون الرفض من القواعد لا من غياب الهدف
    await seed('products', 'prod-nodoc', {
      name: 'منتج', code: 'P-ND1', quantity: 5, price: 10, categoryId: 'c1', searchableIndex: [],
    });
    await seed('invoices', 'inv-nodoc', { total: 100, subtotal: 100, items: [] });
    await seed('customers', 'cust-nodoc', {
      name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now(),
    });
    await seed('counters', 'inv', { lastNumber: 3 });
    await seed('appSettings', 'main', { appName: 'X' });
  });

  it('لا يقرأ products (isActiveUser يفشل لغياب getUserData)', async () => {
    const db = ghostDb();
    await assertFails(getDoc(doc(db, 'products', 'prod-nodoc')));
  });

  it('لا يقرأ invoices', async () => {
    const db = ghostDb();
    await assertFails(getDoc(doc(db, 'invoices', 'inv-nodoc')));
  });

  it('لا يقرأ customers', async () => {
    const db = ghostDb();
    await assertFails(getDoc(doc(db, 'customers', 'cust-nodoc')));
  });

  it('لا يقرأ counters', async () => {
    const db = ghostDb();
    await assertFails(getDoc(doc(db, 'counters', 'inv')));
  });

  it('لا يقرأ appSettings', async () => {
    const db = ghostDb();
    await assertFails(getDoc(doc(db, 'appSettings', 'main')));
  });

  it('القراءة الذاتية لـ users/{uid} الغائبة مسموحة شكليًا (تعريف: self-read لا يمر عبر getUserData — قيد مسجل لا بوابة امتياز)', async () => {
    const db = ghostDb();
    await assertSucceeds(getDoc(doc(db, 'users', GHOST_UID)));
  });

  it('لا ينشئ users/{uid} الخاصة به بـ{email, role: owner}', async () => {
    const db = ghostDb();
    await assertFails(
      setDoc(doc(db, 'users', GHOST_UID), {
        email: 'lost@t.local',
        role: 'owner',
      }),
    );
  });

  it('لا ينشئ invoice', async () => {
    const db = ghostDb();
    await assertFails(setDoc(doc(db, 'invoices', 'inv-ghost-new'), {
      total: 10, subtotal: 10, items: [],
    }));
  });

  it('لا ينشئ counter', async () => {
    const db = ghostDb();
    await assertFails(setDoc(doc(db, 'counters', 'ghost-counter'), { lastNumber: 1 }));
  });
});

describe('REQ-RULES-4b — control: نفس uid بعد إنشاء وثيقته بواسطة owner', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    await seed('products', 'prod-nodoc', {
      name: 'منتج', code: 'P-ND1', quantity: 5, price: 10, categoryId: 'c1', searchableIndex: [],
    });
    const ownerDb = await seedOwnerViaOwnerContext();
    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', GHOST_UID), {
        email: 'ghost@t.local',
        role: 'cashier',
        disabled: false,
      }),
    );
  });

  it('يقرأ products بنجاح (assertSucceeds)', async () => {
    const db = ghostDb();
    await assertSucceeds(getDoc(doc(db, 'products', 'prod-nodoc')));
  });
});
