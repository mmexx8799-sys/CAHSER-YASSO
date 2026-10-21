// REQ-RULES-5 — القواعد تشترط دورًا معروفًا ضمن الأدوار الخمسة
// المرجع: ALL_ROLES في utils/permissions.ts:146-151 (owner/admin/supervisor/cashier/accountant)
// Run: ضمن npm run test:rules (firebase emulators:exec --only firestore,auth)

import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';

// المجموعات الثلاث عشرة التي قراءتها عبر isActiveUser() (firestore.rules)
const ACTIVE_READ_COLLECTIONS = [
  'appSettings',
  'categories',
  'products',
  'customers',
  'invoices',
  'returns',
  'customerPayments',
  'suppliers',
  'supplierPayments',
  'purchaseInvoices',
  'supplierReturns',
  'dailyArchives',
  'counters',
] as const;

const KNOWN_ROLES = ['owner', 'admin', 'supervisor', 'cashier', 'accountant'] as const;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

async function seedUser(uid: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', ...data });
  });
}

async function seedDoc(col: string, id: string, data: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data);
  });
}

async function seedOneDocPerCollection() {
  for (const col of ACTIVE_READ_COLLECTIONS) {
    await seedDoc(col, 'doc1', {});
  }
}

describe('REQ-RULES-5 (أ): حساب بلا role لا يقرأ أي collection', () => {
  it('role-less user: every isActiveUser collection read is DENIED', async () => {
    await testEnv.clearFirestore();
    await seedUser('nrole', {});
    await seedOneDocPerCollection();
    const db = testEnv.authenticatedContext('nrole').firestore();
    for (const col of ACTIVE_READ_COLLECTIONS) {
      await assertFails(getDoc(doc(db, col, 'doc1')));
    }
  });
});

describe('REQ-RULES-5 (ب): دور غير معروف مرفوض', () => {
  it('unknown role: every isActiveUser collection read is DENIED', async () => {
    await testEnv.clearFirestore();
    await seedUser('badrole', { role: 'manager' });
    await seedOneDocPerCollection();
    const db = testEnv.authenticatedContext('badrole').firestore();
    for (const col of ACTIVE_READ_COLLECTIONS) {
      await assertFails(getDoc(doc(db, col, 'doc1')));
    }
  });
});

describe('REQ-RULES-5 (ج): الأدوار الخمسة تقرأ ما كانت تقرؤه', () => {
  it('each known role reads every isActiveUser collection', async () => {
    await testEnv.clearFirestore();
    await seedOneDocPerCollection();
    for (const role of KNOWN_ROLES) {
      await seedUser('u-' + role, { role });
      const db = testEnv.authenticatedContext('u-' + role).firestore();
      for (const col of ACTIVE_READ_COLLECTIONS) {
        await assertSucceeds(getDoc(doc(db, col, 'doc1')));
      }
    }
  });
  it('accountant explicitly still reads every isActiveUser collection', async () => {
    await testEnv.clearFirestore();
    await seedUser('acc', { role: 'accountant' });
    await seedOneDocPerCollection();
    const db = testEnv.authenticatedContext('acc').firestore();
    for (const col of ACTIVE_READ_COLLECTIONS) {
      await assertSucceeds(getDoc(doc(db, col, 'doc1')));
    }
  });
});

describe('REQ-RULES-5 (د): حذف وثيقة بلا role — للمالك فقط', () => {
  it('owner can delete a users doc without a role field', async () => {
    await testEnv.clearFirestore();
    await seedUser('nrole-del', {});
    await seedUser('own-del', { role: 'owner' });
    const dbOwner = testEnv.authenticatedContext('own-del').firestore();
    await assertSucceeds(deleteDoc(doc(dbOwner, 'users', 'nrole-del')));
  });
  it('non-owner cannot delete a users doc without a role field', async () => {
    await testEnv.clearFirestore();
    await seedUser('nrole-del2', {});
    await seedUser('adm-del', { role: 'admin' });
    const dbAdmin = testEnv.authenticatedContext('adm-del').firestore();
    await assertFails(deleteDoc(doc(dbAdmin, 'users', 'nrole-del2')));
  });
});

describe('REQ-RULES-5 (هـ): المالك يسند دورًا لوثيقة users بلا role', () => {
  it('owner can update a role-less users doc to role cashier', async () => {
    await testEnv.clearFirestore();
    await seedUser('nrole-asg', {});
    await seedUser('own-asg', { role: 'owner' });
    const dbOwner = testEnv.authenticatedContext('own-asg').firestore();
    await assertSucceeds(updateDoc(doc(dbOwner, 'users', 'nrole-asg'), { role: 'cashier' }));
  });
});
