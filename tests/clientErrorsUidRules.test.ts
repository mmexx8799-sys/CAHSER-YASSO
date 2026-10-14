// REQ-RULES-2 V5 — clientErrors uid binding (Emulator)
//
// Rule under test (firestore.rules → match /clientErrors/{docId} create):
//   appended conjunct:
//     (!('uid' in request.resource.data)
//      || request.resource.data.uid == request.auth.uid)
// Why: the old shape guard allowed ANY <=128-char string as uid, so a
// caller could file error reports attributed to another user (log
// spoofing). Absent uid stays allowed (monitoring.ts drops undefined uid
// via `clean`, and logged-out reporters send none).
//
// Red-green contract: the NEG test PASSES on unpatched rules (spoofed uid
// wrongly succeeds ⇒ assertFails throws ⇒ RED proof) and passes after.
// POS tests (no uid / own uid) stay green before and after.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/clientErrorsUidRules.test.ts"

import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc } from 'firebase/firestore';

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

// --- Helpers ----------------------------------------------------------------

async function seedUser(uid: string, role: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: uid + '@t.local', role });
  });
}

function mkReport(extra: any = {}) {
  return { message: 'boom', createdAt: Date.now(), ...extra };
}

// --- NEG: uid spoofing ---------------------------------------------------------

describe('REQ-RULES-2 V5 NEG: uid spoofing rejected', () => {
  it('cashier cannot file a report attributed to another uid', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v5-1', 'cashier');
    const db = testEnv.authenticatedContext('cash-v5-1').firestore();

    await assertFails(setDoc(doc(db, 'clientErrors', 'err-v5-1'), mkReport({ uid: 'some-owner-uid' })));
  });
});

// --- POS: absent or own uid ----------------------------------------------------

describe('REQ-RULES-2 V5 POS: absent or own uid stays writable', () => {
  it('cashier can file a report without uid', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v5-2', 'cashier');
    const db = testEnv.authenticatedContext('cash-v5-2').firestore();

    await assertSucceeds(setDoc(doc(db, 'clientErrors', 'err-v5-2'), mkReport()));
  });

  it('cashier can file a report with its own uid', async () => {
    await testEnv.clearFirestore();
    await seedUser('cash-v5-3', 'cashier');
    const db = testEnv.authenticatedContext('cash-v5-3').firestore();

    await assertSucceeds(setDoc(doc(db, 'clientErrors', 'err-v5-3'), mkReport({ uid: 'cash-v5-3' })));
  });
});
