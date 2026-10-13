// P0-VERIFY-6 — restore-compat probe (READ-ONLY verification, RED purpose).
// Proves: under CURRENT rules, owner can write legacy-shape docs (v1 backup style:
// missing keys, extra keys, createdAt as number or Timestamp). Any future
// keys().hasOnly() allowlist on create MUST grandfather these shapes or exempt
// the restore path — otherwise restoreData (owner) fails MID-restore after deletes.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0RestoreCompat.test.ts"
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'owner-restore'), {
      email: 'owner-restore@t.local', role: 'owner',
    });
  });
}
const ownerDb = () => testEnv.authenticatedContext('owner-restore').firestore();

describe('P0-VERIFY-6 restore compatibility (current rules)', () => {
  it('R1 v1-shape invoice (minimal keys, createdAt as number) succeeds for owner', async () => {
    await testEnv.clearFirestore(); await seedOwner();
    await assertSucceeds(setDoc(doc(ownerDb(), 'invoices', 'v1-inv-1'), {
      total: 100, subtotal: 100, items: [], createdAt: Date.now(),
    }));
  });
  it('R2 legacy invoice with EXTRA key succeeds for owner', async () => {
    await testEnv.clearFirestore(); await seedOwner();
    await assertSucceeds(setDoc(doc(ownerDb(), 'invoices', 'v1-inv-2'), {
      total: 50, items: [], legacyField: 'old-app', createdAt: Date.now(),
    } as any));
  });
  it('R3 invoice with createdAt as Timestamp succeeds for owner', async () => {
    await testEnv.clearFirestore(); await seedOwner();
    await assertSucceeds(setDoc(doc(ownerDb(), 'invoices', 'v1-inv-3'), {
      total: 75, subtotal: 75, items: [], dailyArchiveId: '2026-10-01',
      invoiceNumber: 'INV-000001', createdAt: Timestamp.now(),
    }));
  });
  it('R4 legacy payment with extra key succeeds for owner', async () => {
    await testEnv.clearFirestore(); await seedOwner();
    await assertSucceeds(setDoc(doc(ownerDb(), 'customerPayments', 'v1-pay-1'), {
      customerId: 'c1', amount: 30, date: Date.now(), oldNote: 'x',
    } as any));
  });
});
