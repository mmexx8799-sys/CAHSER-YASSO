// P0-VERIFY-11 — dailyArchives totals writable by staff (Emulator, direct SDK).
// Proves staff can write totalSales/totalCash/... bypassing sale/return flows.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0ArchiveTotals.test.ts"
import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

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
async function seedOpenArchive(id: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dailyArchives', id), {
      startTime: Date.now(), status: 'open', totalSales: 1000, totalCash: 600,
    });
  });
}

describe('P0-VERIFY-11 dailyArchives totals', () => {
  it('T1 cashier CAN overwrite totalSales/totalCash directly (the gap)', async () => {
    await testEnv.clearFirestore();
    await seedUser('c-t', 'cashier'); await seedOpenArchive('arch-1');
    const db = testEnv.authenticatedContext('c-t').firestore();
    await assertSucceeds(updateDoc(doc(db, 'dailyArchives', 'arch-1'), { totalSales: 1, totalCash: 1 } as any));
  });
  it('T2 anon CANNOT write archives', async () => {
    await testEnv.clearFirestore(); await seedOpenArchive('arch-1');
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'dailyArchives', 'arch-1'), { totalSales: 1 } as any));
  });
});
