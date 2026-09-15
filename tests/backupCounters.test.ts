// BUG-P0-15 — counters in backup/restore (Firebase Emulator)
//
// Covers:
//   (1) v2 round-trip: backupData() includes counters; restoreData() brings
//       invoices AND counters back; the next sale continues the sequence
//       (no duplicate numbers).
//   (2) v1 legacy restore: a v1 backup (no counters field) derives counters
//       as max(live, highest restored INV-/PUR- number) — the exact scenario
//       "live=10, backup up to INV-000050 → next must be INV-000051".
//   (3) v1 never moves a counter backwards (live=100, backup max=50 → 100).
//   (4) P0-13 no regression: cashier arbitrary counter writes still rejected
//       after the admin bypass; admin arbitrary write succeeds (documented
//       Accepted Risk powering restore); unauthenticated writes rejected.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/backupCounters.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

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
  updateDoc,
  collection,
} from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Invoice } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { backupData, restoreData, processSale } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const ADMIN_EMAIL = 'admin-backup@test.local'; // distinct from other test files
const ADMIN_PASSWORD = 'secret123';
const ARCHIVE_ID = '2026-09-15'; // distinct archive — no cross-file fixture clash

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
    await createUserWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

// --- Helpers ----------------------------------------------------------------

async function signInAdmin() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, ADMIN_EMAIL, ADMIN_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // users/{uid} create is admin-only → seed with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: ADMIN_EMAIL, role: 'admin' });
  });
  return uid;
}

async function seedSaleFixtures() {
  // Seeded with rules disabled — mirrors provisioned data, not the paths
  // under test.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products', 'prod-backup-1'), {
      id: 'prod-backup-1',
      code: 'C-prod-backup-1',
      name: 'منتج نسخ احتياطي',
      price: 100,
      retailCashPrice: 100,
      retailCreditPrice: 100,
      wholesaleCashPrice: 100,
      wholesaleCreditPrice: 100,
      quantity: 500,
      categoryId: 'cat-1',
      createdAt: Date.now(),
      searchableIndex: [],
    });
    await setDoc(doc(db, 'dailyArchives', ARCHIVE_ID), {
      startTime: Date.now(),
      status: 'open',
      totalSales: 0,
      totalReturns: 0,
      totalCash: 0,
      totalCredit: 0,
      totalVodafoneCash: 0,
      totalInstapay: 0,
      totalReturnsCash: 0,
      totalReturnsOnAccount: 0,
    } as any);
  });
}

async function makeCashSale(db: any) {
  await processSale({
    items: [{
      id: 'prod-backup-1',
      code: 'C-prod-backup-1',
      name: 'منتج نسخ احتياطي',
      price: 100,
      quantity: 500,
      categoryId: 'cat-1',
      createdAt: Date.now(),
      searchableIndex: [],
      buyQuantity: 1,
      priceType: 'retail',
    } as any],
    subtotal: 100,
    discount: 0,
    total: 100,
    paymentMethod: 'نقدا' as Invoice['paymentMethod'],
    dailyArchiveId: ARCHIVE_ID,
  });
}

async function getCounter(db: any, docId: string) {
  const snap = await getDoc(doc(db, 'counters', docId));
  return snap.exists() ? (snap.data() as any).lastNumber : undefined;
}

function v1BackupSkeleton(overrides: Record<string, any[]> = {}) {
  return {
    schemaVersion: 1,
    appVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    categories: [],
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
    ...overrides,
  };
}

// --- (1) v2 round-trip ---------------------------------------------------------

describe('BUG-P0-15: v2 backup/restore round-trip', () => {
  it('backup includes counters; restore brings them back; next sale continues the sequence', async () => {
    await testEnv.clearFirestore();
    await seedSaleFixtures();
    await signInAdmin();
    const db = getDB();

    await makeCashSale(db);
    await makeCashSale(db);
    expect(await getCounter(db, 'invoices')).toBe(2);

    const backup = await backupData();
    expect((backup as any).schemaVersion).toBe(2);
    const backedCounters = (backup as any).counters as { id: string; lastNumber: number }[];
    expect(backedCounters.find((c) => c.id === 'invoices')?.lastNumber).toBe(2);

    // Simulate a wipe (e.g. factory reset) then restore from the backup.
    await testEnv.clearFirestore();
    await signInAdmin();
    await restoreData(JSON.parse(JSON.stringify(backup)));

    expect(await getCounter(getDB(), 'invoices')).toBe(2);

    // Next sale must be INV-000003 — never a duplicate of the restored range.
    await seedSaleFixtures();
    await signInAdmin();
    await makeCashSale(getDB());
    expect(await getCounter(getDB(), 'invoices')).toBe(3);
  });
});

// --- (2)+(3) v1 legacy restore --------------------------------------------------

describe('BUG-P0-15: v1 legacy restore derives counters', () => {
  it('live=10 + backup up to INV-000050/PUR-000007 → counters become 50/7', async () => {
    await testEnv.clearFirestore();
    // NOTE: ctx.firestore() must be called ONCE per context and reused —
    // a second call after requests started throws "Firestore has already
    // been started" (useEmulator re-applies settings). Same pattern as
    // seedSaleFixtures in countersRules.test.ts.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'counters', 'invoices'), { lastNumber: 10 });
      await setDoc(doc(db, 'counters', 'purchaseInvoices'), { lastNumber: 2 });
    });
    await signInAdmin();

    const backup = v1BackupSkeleton({
      invoices: [
        { id: 'inv-old-49', invoiceNumber: 'INV-000049', total: 100, createdAt: Date.now() },
        { id: 'inv-old-50', invoiceNumber: 'INV-000050', total: 200, createdAt: Date.now() },
      ],
      purchaseInvoices: [
        { id: 'pur-old-7', invoiceNumber: 'PUR-000007', total: 300, createdAt: Date.now() },
      ],
    });
    await restoreData(backup);

    const db = getDB();
    expect(await getCounter(db, 'invoices')).toBe(50);
    expect(await getCounter(db, 'purchaseInvoices')).toBe(7);
  });

  it('never moves a counter backwards: live=100 + backup max=50 → stays 100', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'counters', 'invoices'), { lastNumber: 100 });
    });
    await signInAdmin();

    const backup = v1BackupSkeleton({
      invoices: [
        { id: 'inv-old-50', invoiceNumber: 'INV-000050', total: 200, createdAt: Date.now() },
      ],
    });
    await restoreData(backup);

    expect(await getCounter(getDB(), 'invoices')).toBe(100);
  });
});

// --- (4) P0-13 no regression ----------------------------------------------------

describe('BUG-P0-15: counters rules — cashier still restricted, admin bypass documented', () => {
  it('cashier arbitrary writes still rejected; admin arbitrary write succeeds (restore power)', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'cashier-b15'), { email: 'c@t.local' });
      await setDoc(doc(db, 'users', 'admin-b15'), { email: 'a@t.local', role: 'admin' });
      await setDoc(doc(db, 'counters', 'probe-b15'), { lastNumber: 5 });
    });

    const cashierDb = testEnv.authenticatedContext('cashier-b15').firestore();
    await assertFails(setDoc(doc(cashierDb, 'counters', 'probe-arbitrary'), { lastNumber: 999 }));
    await assertFails(updateDoc(doc(cashierDb, 'counters', 'probe-b15'), { lastNumber: 999 }));

    const adminDb = testEnv.authenticatedContext('admin-b15').firestore();
    await assertSucceeds(setDoc(doc(adminDb, 'counters', 'probe-b15'), { lastNumber: 50 }));
    expect(await getCounter(adminDb, 'probe-b15')).toBe(50);
  });

  it('unauthenticated writes rejected', async () => {
    await testEnv.clearFirestore();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'counters', 'probe-anon'), { lastNumber: 1 }));
  });
});
