// BUG-P0-6 — changePassword re-authentication (Auth Emulator only).
//
// Verifies services/auth.ts changePassword(currentPassword, newPassword):
//   - AC-01: correct current password → change succeeds (new password signs in).
//   - AC-02: wrong current password → Arabic rejection, password unchanged.
//   - No signed-in user → Arabic rejection.
//   - Error messages never echo passwords (no-logging constraint).
//
// Each test mints a FRESH Auth user (random email) → fully isolated, no
// ordering dependence, rerun-safe. No Firestore involved.
//
// Run:
//   npx firebase emulators:exec --only auth "npx vitest run tests/changePassword.test.ts"

import { describe, it, expect } from 'vitest';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

const { changePassword } = await import('../services/auth');
const { getAuthInstance } = await import('../services/firebase');

const PW_OLD = 'old-pass-123';
const PW_NEW = 'new-pass-456';
const PW_WRONG = 'wrong-pass-000';

function freshEmail() {
  return `chg-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

async function createAndSignIn(email: string, password: string) {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await createUserWithEmailAndPassword(fbAuth, email, password);
  return fbAuth;
}

describe('BUG-P0-6: changePassword requires current password', () => {
  it('AC-01: correct current password changes it (new password signs in)', async () => {
    const email = freshEmail();
    const fbAuth = await createAndSignIn(email, PW_OLD);

    await changePassword(PW_OLD, PW_NEW);

    await firebaseSignOut(fbAuth);
    await signInWithEmailAndPassword(fbAuth, email, PW_NEW); // proves the change
    expect(fbAuth.currentUser?.email).toBe(email);
    await firebaseSignOut(fbAuth);
  });

  it('AC-02: wrong current password rejected in Arabic, password unchanged', async () => {
    const email = freshEmail();
    const fbAuth = await createAndSignIn(email, PW_OLD);

    await expect(changePassword(PW_WRONG, PW_NEW)).rejects.toThrow('كلمة السر الحالية غير صحيحة');

    await firebaseSignOut(fbAuth);
    await signInWithEmailAndPassword(fbAuth, email, PW_OLD); // still the old one
    expect(fbAuth.currentUser?.email).toBe(email);
    await firebaseSignOut(fbAuth);
  });

  it('no signed-in user is rejected in Arabic', async () => {
    const fbAuth = getAuthInstance();
    try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
    await expect(changePassword(PW_OLD, PW_NEW)).rejects.toThrow('لا يوجد مستخدم');
  });

  it('error messages never echo passwords', async () => {
    const email = freshEmail();
    const fbAuth = await createAndSignIn(email, PW_OLD);
    try {
      await changePassword(PW_WRONG, PW_NEW);
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(String(e?.message || '')).not.toContain(PW_WRONG);
      expect(String(e?.message || '')).not.toContain(PW_NEW);
    }
    await firebaseSignOut(fbAuth);
  });
});
