// REQ-RBAC-2 — Preflight + fail-fast (AC-01…05)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/restorePreflight.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { signOut as firebaseSignOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

const { getAuthInstance } = await import('../services/firebase');
const { restoreData, factoryReset } = await import('../services/api');

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
  // Warm up getDB() Firestore instance before any test — avoids "Firestore has already been started" race on first restoreData
  try {
    const { getDB } = await import('../services/firebase');
    const { getDoc: getDocWarm, doc: docWarm } = await import('firebase/firestore');
    await getDocWarm(docWarm(getDB(), 'users', 'warmup-noop'));
  } catch {}
});
afterAll(async () => { await testEnv.cleanup(); });

async function signInAs(email: string, password: string, role: string) {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch {}
  try { await createUserWithEmailAndPassword(fbAuth, email, password); } catch (e: any) {
    if (!String(e?.code).includes('email-already-in-use')) throw e;
  }
  await signInWithEmailAndPassword(fbAuth, email, password);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email, role, disabled: false });
  });
  return uid;
}

async function countDocsPrivileged(col: string): Promise<number> {
  let size = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), col));
    size = snap.size;
  });
  return size;
}

function makeBackup(): any {
  return {
    schemaVersion: 2,
    appVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    categories: [{ id: 'cat1', name: 'تصنيف' }],
    customers: [],
    products: [],
    dailyArchives: [],
    invoices: [],
    returns: [],
    customerPayments: [],
    suppliers: [],
    supplierPayments: [],
    purchaseInvoices: [],
    supplierReturns: [],
    counters: [],
  };
}

describe('REQ-RBAC-2 Preflight — factoryReset/restoreData', () => {
  // Warmup: first restoreData call after emulator start is sensitive to Firestore settings race — run a no-op owner restore first to warm up getDB
  it('owner can restore successfully', async () => {
    await testEnv.clearFirestore();
    await signInAs('preflight-owner@test.local', 'secret123', 'owner');
    const backup = makeBackup();
    await expect(restoreData(backup)).resolves.not.toThrow();
    expect(await countDocsPrivileged('categories')).toBe(1);
  });

  it('admin restore → rejected (preflight)', async () => {
    await testEnv.clearFirestore();
    await signInAs('preflight-admin@test.local', 'secret123', 'admin');
    const backup = makeBackup();
    await expect(restoreData(backup)).rejects.toThrow(/ليس لديك صلاحية|صلاحية|مسموح/i);
  });

  it('admin restore does not cause half-wipe (separate verification)', async () => {
    await testEnv.clearFirestore();
    // Seed business data with privileged context BEFORE sign-in to avoid settings race
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'customers', 'cust-hw'), { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    });
    await signInAs('preflight-admin-hw@test.local', 'secret123', 'admin');
    const backup = makeBackup();
    await expect(restoreData(backup)).rejects.toThrow(/ليس لديك صلاحية/i);
    // Verify seeded doc still exists
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'customers', 'cust-hw'));
      expect(snap.exists()).toBe(true);
    });
  });

  it('cashier/supervisor/accountant restore → rejected', async () => {
    for (const [role, email] of [
      ['cashier', 'preflight-cashier@test.local'],
      ['supervisor', 'preflight-sup@test.local'],
      ['accountant', 'preflight-acct@test.local'],
    ] as const) {
      await testEnv.clearFirestore();
      await signInAs(email, 'secret123', role);
      const backup = makeBackup();
      await expect(restoreData(backup)).rejects.toThrow(/ليس لديك صلاحية|صلاحية|مسموح/i);
    }
  });

  it('factoryReset preflight — non-owner rejected before any delete', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'customers', 'cust-2'), { name: 'عميل2', balance: 0, openingBalance: 0, createdAt: Date.now() });
    });
    const before = await countDocsPrivileged('customers');
    await signInAs('preflight-admin2@test.local', 'secret123', 'admin');
    await expect(factoryReset()).rejects.toThrow(/ليس لديك صلاحية|صلاحية|مسموح/i);
    expect(await countDocsPrivileged('customers')).toBe(before);
  });

  it('addUser rejects invalid role', async () => {
    await signInAs('adduser-admin@test.local', 'secret123', 'admin');
    const { addUser } = await import('../services/api');
    await expect(addUser('badrole@test.local', 'secret123', 'manager' as any)).rejects.toThrow(/دور|role/i);
  });
});
