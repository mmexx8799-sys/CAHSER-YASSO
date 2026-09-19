// REQ-RBAC-1 AC-06 — اليوميات: create = canOpenDay, update = staff على مفتوحة بلا status أو admin, delete = admin (SR-06 / BR-05)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/archiveTransitions.test.ts"

import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { UserRole } from '../types';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

async function seedUser(uid: string, role: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role });
  });
}
async function seedArchive(id: string, status: 'open' | 'closed', totalSales = 0) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dailyArchives', id), {
      status, startTime: Date.now(), totalSales, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0,
    });
  });
}

describe('Archive transitions (SR-06)', () => {
  it('create: owner/admin/supervisor ALLOWED, cashier/accountant DENIED', async () => {
    for (const [role, shouldAllow] of [
      [UserRole.Owner, true],
      [UserRole.Admin, true],
      [UserRole.Supervisor, true],
      [UserRole.Cashier, false],
      [UserRole.Accountant, false],
    ] as const) {
      await testEnv.clearFirestore();
      await seedUser(`arch-cre-${role}`, role);
      const db = testEnv.authenticatedContext(`arch-cre-${role}`).firestore();
      const ref = doc(db, 'dailyArchives', `arch-${role}-${Date.now()}`);
      const data = { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 };
      if (shouldAllow) await assertSucceeds(setDoc(ref, data));
      else await assertFails(setDoc(ref, data));
    }
  });

  it('update totals on open archive: isStaff ALLOWED (without touching status), accountant DENIED', async () => {
    await testEnv.clearFirestore();
    await seedArchive('arch-open-totals', 'open', 100);
    for (const [role, shouldAllow] of [
      [UserRole.Owner, true],
      [UserRole.Admin, true],
      [UserRole.Supervisor, true],
      [UserRole.Cashier, true],
      [UserRole.Accountant, false],
    ] as const) {
      await seedUser(`upd-tot-${role}`, role);
      const db = testEnv.authenticatedContext(`upd-tot-${role}`).firestore();
      // each role gets fresh archive to avoid cross-contamination
      const id = `arch-open-${role}`;
      await seedArchive(id, 'open', 100);
      const ref = doc(db, 'dailyArchives', id);
      if (shouldAllow) await assertSucceeds(updateDoc(ref, { totalSales: 200 } as any));
      else await assertFails(updateDoc(ref, { totalSales: 200 } as any));
    }
  });

  it('close open archive (status open -> closed): only isAdmin ALLOWED', async () => {
    for (const [role, shouldAllow] of [
      [UserRole.Owner, true],
      [UserRole.Admin, true],
      [UserRole.Supervisor, false],
      [UserRole.Cashier, false],
      [UserRole.Accountant, false],
    ] as const) {
      await testEnv.clearFirestore();
      await seedArchive('arch-to-close', 'open');
      await seedUser(`close-${role}`, role);
      const db = testEnv.authenticatedContext(`close-${role}`).firestore();
      if (shouldAllow) await assertSucceeds(updateDoc(doc(db, 'dailyArchives', 'arch-to-close'), { status: 'closed' } as any));
      else await assertFails(updateDoc(doc(db, 'dailyArchives', 'arch-to-close'), { status: 'closed' } as any));
    }
  });

  it('update totals on closed archive: only isAdmin ALLOWED, isStaff DENIED', async () => {
    for (const [role, shouldAllow] of [
      [UserRole.Owner, true],
      [UserRole.Admin, true],
      [UserRole.Supervisor, false],
      [UserRole.Cashier, false],
      [UserRole.Accountant, false],
    ] as const) {
      await testEnv.clearFirestore();
      await seedArchive('arch-closed', 'closed', 500);
      await seedUser(`upd-closed-${role}`, role);
      const db = testEnv.authenticatedContext(`upd-closed-${role}`).firestore();
      if (shouldAllow) await assertSucceeds(updateDoc(doc(db, 'dailyArchives', 'arch-closed'), { totalSales: 600 } as any));
      else await assertFails(updateDoc(doc(db, 'dailyArchives', 'arch-closed'), { totalSales: 600 } as any));
    }
  });

  it('isStaff cannot bypass by changing status and totals together', async () => {
    await testEnv.clearFirestore();
    await seedArchive('arch-bypass', 'open');
    await seedUser('cashier-bypass', UserRole.Cashier);
    const db = testEnv.authenticatedContext('cashier-bypass').firestore();
    await assertFails(updateDoc(doc(db, 'dailyArchives', 'arch-bypass'), { status: 'closed', totalSales: 999 } as any));
  });

  it('delete: isAdmin ALLOWED, others DENIED (R1)', async () => {
    for (const [role, shouldAllow] of [
      [UserRole.Owner, true],
      [UserRole.Admin, true],
      [UserRole.Supervisor, false],
      [UserRole.Cashier, false],
      [UserRole.Accountant, false],
    ] as const) {
      await testEnv.clearFirestore();
      await seedArchive(`arch-del-${role}`, 'closed');
      await seedUser(`del-${role}`, role);
      const db = testEnv.authenticatedContext(`del-${role}`).firestore();
      if (shouldAllow) await assertSucceeds(deleteDoc(doc(db, 'dailyArchives', `arch-del-${role}`)));
      else await assertFails(deleteDoc(doc(db, 'dailyArchives', `arch-del-${role}`)));
    }
  });

  it('no new get() needed — sale on open archive succeeds for staff (resource.data only)', async () => {
    // This is AC-15 micro-check: sale-like write (totalSales) on open archive by cashier must succeed
    // If rule introduced a get() on user doc per write, concurrent high-N would degrade (SR-09)
    await testEnv.clearFirestore();
    await seedArchive('arch-sale', 'open', 0);
    await seedUser('cashier-sale', UserRole.Cashier);
    const db = testEnv.authenticatedContext('cashier-sale').firestore();
    await assertSucceeds(updateDoc(doc(db, 'dailyArchives', 'arch-sale'), { totalSales: 150 } as any));
  });
});
