// 2.2-free — clientErrors rules (Firestore emulator).
//
// Rules under test (firestore.rules → match /clientErrors/{docId}):
//   - create: أي مستخدم نشط، بشكل صارم (message 1..1000 + createdAt number
//     + مفاتيح مسموحة فقط) — حتى لا تتحول لمخزن عام.
//   - read/delete: أدمن فقط (تُفحص من Console). update: مرفوض للجميع.
//   - مجهول (غير مسجل): مرفوض تمامًا.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/clientErrorsRules.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config

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

async function seedActiveUser(uid: string, role?: string) {
  // RBAC-2026-09: default to cashier when no role passed
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role: role ?? 'cashier' });
  });
}

function validReport() {
  return {
    message: 'TypeError: Cannot read properties of undefined',
    stack: 'at POSPage (POSPage.tsx:100)',
    source: 'ErrorBoundary',
    url: 'https://casher-yasoo.web.app/#/pos',
    createdAt: Date.now(),
    uid: 'cashier-ce1',
  };
}

describe('2.2-free: clientErrors rules', () => {
  it('cashier can append a valid report; anon cannot', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ce1');

    const db = testEnv.authenticatedContext('cashier-ce1').firestore();
    await assertSucceeds(setDoc(doc(db, 'clientErrors', 'rep-ok'), validReport()));

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anonDb, 'clientErrors', 'rep-anon'), validReport()));
  });

  it('shape guard rejects junk (missing/empty/oversized message, extra keys)', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ce2');
    const db = testEnv.authenticatedContext('cashier-ce2').firestore();

    const noMessage = validReport() as unknown as Record<string, unknown>;
    delete noMessage.message;
    await assertFails(setDoc(doc(db, 'clientErrors', 'rep-no-msg'), noMessage));
    await assertFails(setDoc(doc(db, 'clientErrors', 'rep-empty'), { ...validReport(), message: '' }));
    await assertFails(setDoc(doc(db, 'clientErrors', 'rep-big'), { ...validReport(), message: 'x'.repeat(1001) }));
    await assertFails(setDoc(doc(db, 'clientErrors', 'rep-evil'), { ...validReport(), chat: 'hello' } as never));
    await assertFails(setDoc(doc(db, 'clientErrors', 'rep-no-ts'), { ...validReport(), createdAt: 'now' } as never));
  });

  it('cashier can neither read nor update nor delete reports; admin can', async () => {
    await testEnv.clearFirestore();
    await seedActiveUser('cashier-ce3');
    await seedActiveUser('admin-ce3', 'admin');
    // Seed one report with rules disabled (cashier could equally create it).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'clientErrors', 'rep-seed'), validReport());
    });

    const cashierDb = testEnv.authenticatedContext('cashier-ce3').firestore();
    await assertFails(getDoc(doc(cashierDb, 'clientErrors', 'rep-seed')));
    await assertFails(getDocs(collection(cashierDb, 'clientErrors')));
    await assertFails(updateDoc(doc(cashierDb, 'clientErrors', 'rep-seed'), { message: 'edited' }));
    await assertFails(deleteDoc(doc(cashierDb, 'clientErrors', 'rep-seed')));

    const adminDb = testEnv.authenticatedContext('admin-ce3').firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'clientErrors', 'rep-seed')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'clientErrors', 'rep-seed')));
    const gone = await getDoc(doc(adminDb, 'clientErrors', 'rep-seed'));
    expect(gone.exists()).toBe(false);
  });
});
