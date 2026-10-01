// REQ-TX2-ARCHIVE (AUDIT-TX-2) — startNewDailyArchive lost-commit.
// DOCUMENTING TEST ONLY. NO production change in this REQ.
//
// Traced from services/api/archives.ts BEFORE writing (not guessed):
// - The pre-check (getOpenDailyArchive + open-guard) runs ONCE per CALL,
//   OUTSIDE the retry loop; a lost-commit RETRY re-runs ONLY the
//   transaction callback. So attempt 2 skips the pre-check and hits the
//   in-transaction exists-guard: `transaction.get(archiveRef)` sees the
//   doc attempt 1 created → throws `يومية <today> موجودة ومغلقة بالفعل.`
// - archive-lost-commit-converts-to-rejection: attempt 1 really commits,
//   then the response is "lost" (unavailable). Asserts:
//     attempts == 2;
//     the call REJECTS with /موجودة|مغلقة/ — DOCUMENTED QUIRK: the user
//     sees a false "already exists" message although THIS call opened the
//     day (no money impact; recorded in backlog, NOT fixed here);
//     exactly 1 dailyArchives doc, id == today's date, status 'open';
//     counters collection empty (no counter involved); no customer/
//     product fixtures exist at all, so no balance/stock movement is
//     possible by construction.
//
// Mock replaces ONLY `runTransaction` (same pattern as
// tests/paymentRetry.test.ts); the wrapper under test is the REAL
// runTransactionWithRetry from services.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/tx2Archive.test.ts"
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: vi.fn() };
});

// tests/setup.ts already mocks react-hot-toast before these imports.
const { startNewDailyArchive } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

const fsMocked = await import('firebase/firestore');
const runTxMock = vi.mocked(fsMocked.runTransaction);
const actualFs = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const OWNER_EMAIL = 'owner-tx2archive@test.local'; // distinct from other test files
const OWNER_PASSWORD = 'secret123';

function retryableErr(code: string): Error {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

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
    await createUserWithEmailAndPassword(fbAuth, OWNER_EMAIL, OWNER_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  runTxMock.mockReset();
  // Default: real transaction (tests override the first call per-case).
  runTxMock.mockImplementation((db: any, fn: any) => actualFs.runTransaction(db, fn));
});

async function signInOwner() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, OWNER_EMAIL, OWNER_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  // archive.open requires owner/admin/supervisor.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: OWNER_EMAIL, role: 'owner' });
  });
  return uid;
}

describe('REQ-TX2-ARCHIVE: archive lost-commit converts to rejection', () => {
  it('archive-lost-commit-converts-to-rejection: 1 open today-doc, business error, no counter', async () => {
    await testEnv.clearFirestore();
    await signInOwner();
    const today = new Date().toISOString().split('T')[0];

    // Attempt 1 REALLY commits, then the response is "lost".
    runTxMock.mockImplementationOnce(async (db: any, fn: any) => {
      await actualFs.runTransaction(db, fn);
      throw retryableErr('unavailable');
    });

    let threw: string | null = null;
    try {
      await startNewDailyArchive();
    } catch (e: any) {
      threw = String(e?.message ?? e);
    }

    const snap = await getDocs(collection(getDB(), 'dailyArchives'));
    const observed = {
      attempts: runTxMock.mock.calls.length,
      threw,
      docs: snap.size,
      id: snap.empty ? null : snap.docs[0].id,
      status: snap.empty ? null : (snap.docs[0].data() as any).status,
      counters: (await getDocs(collection(getDB(), 'counters'))).size,
    };
    expect.soft(observed.attempts).toBe(2);
    expect.soft(observed.threw).toMatch(/موجودة|مغلقة/);
    expect.soft(observed.docs).toBe(1);
    expect.soft(observed.id).toBe(today);
    expect.soft(observed.status).toBe('open');
    expect.soft(observed.counters).toBe(0);
  });
});
