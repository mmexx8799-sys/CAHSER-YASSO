// tests/setUserCapOverrides.test.ts — emulator test for real api function (REQ-PERM-4)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';

const { setUserCapOverrides } = await import('../services/api');
const { getAuthInstance } = await import('../services/firebase');
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

async function ensureUser(email: string, password: string, role: string) {
  const auth = getAuthInstance();
  try { await firebaseSignOut(auth); } catch { /* already signed out */ }
  try { await createUserWithEmailAndPassword(auth, email, password); } catch (e:any) { if (!String(e?.code).includes('email-already-in-use')) throw e; }
  await signInWithEmailAndPassword(auth, email, password);
  const uid = auth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email, role });
  });
  return uid;
}

describe('setUserCapOverrides — real api + rules', () => {
  it('owner sets grants/denies ⇒ user doc has lists and stamp, audit exists', async () => {
    await testEnv.clearFirestore();
    const ownerUid = await ensureUser('owner-cap@test.local', 'secret123', UserRole.Owner);
    const victimUid = 'victim-cap-1';
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', victimUid), { email: 'victim@test.local', role: UserRole.Cashier });
    });
    // ensure signed in as owner
    await signInWithEmailAndPassword(getAuthInstance(), 'owner-cap@test.local', 'secret123');
    await setUserCapOverrides(victimUid, { grants: ['product.price'], denies: ['sell'] });
    let victimSnap: any;
    await testEnv.withSecurityRulesDisabled(async ctx => { victimSnap = await getDoc(doc(ctx.firestore(), 'users', victimUid)); });
    const data = victimSnap.data() as any;
    expect(data.capGrants).toEqual(['product.price']);
    expect(data.capDenies).toEqual(['sell']);
    expect(data.permsUpdatedBy).toBe(ownerUid);
    expect(data.permsUpdatedAt).toBeTruthy();
    let auditSnap: any;
    await testEnv.withSecurityRulesDisabled(async ctx => { auditSnap = await getDocs(collection(ctx.firestore(), 'permissionAudit')); });
    const found = auditSnap.docs.map((d:any)=>d.data() as any).find((a:any)=>a.targetUid===victimUid);
    expect(found).toBeTruthy();
    expect(found.by).toBe(ownerUid);
    expect(found.at).toBeTruthy();
    expect(found.before).toBeTruthy();
    expect(found.after.grants).toEqual(['product.price']);
  });

  it('owner clears ⇒ fields deleted', async () => {
    await testEnv.clearFirestore();
    await ensureUser('owner-cap@test.local', 'secret123', UserRole.Owner);
    const victimUid = 'victim-cap-2';
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', victimUid), { email: 'victim2@test.local', role: UserRole.Cashier, capGrants: ['product.price'], capDenies: ['sell'], permsUpdatedBy: 'x', permsUpdatedAt: new Date() });
    });
    await signInWithEmailAndPassword(getAuthInstance(), 'owner-cap@test.local', 'secret123');
    await setUserCapOverrides(victimUid, { grants: [], denies: [] });
    let snap: any;
    await testEnv.withSecurityRulesDisabled(async ctx => { snap = await getDoc(doc(ctx.firestore(), 'users', victimUid)); });
    const data = snap.data() as any;
    expect(data.capGrants).toBeUndefined();
    expect(data.capDenies).toBeUndefined();
  });

  it('admin/cashier cannot set', async () => {
    await testEnv.clearFirestore();
    await ensureUser('owner-cap@test.local', 'secret123', UserRole.Owner);
    const victimUid = 'victim-cap-3';
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', victimUid), { email: 'victim3@test.local', role: UserRole.Cashier });
    });
    await ensureUser('admin-cap@test.local', 'secret123', UserRole.Admin);
    await signInWithEmailAndPassword(getAuthInstance(), 'admin-cap@test.local', 'secret123');
    await expect(setUserCapOverrides(victimUid, { grants: ['product.price'], denies: [] })).rejects.toThrow();
    await ensureUser('cashier-cap2@test.local', 'secret123', UserRole.Cashier);
    await signInWithEmailAndPassword(getAuthInstance(), 'cashier-cap2@test.local', 'secret123');
    await expect(setUserCapOverrides(victimUid, { grants: ['product.price'], denies: [] })).rejects.toThrow();
  });
});
