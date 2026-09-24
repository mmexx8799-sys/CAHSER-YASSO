// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// REQ-RBAC-4 — migration planning + emulator apply/idempotent/rollback (AC-01…07)
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/migrateRoles.test.ts"
// (وضع المحاكي: FIRESTORE_EMULATOR_HOST مضبوط تلقائيًا داخل emulators:exec)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { planMigration, rollbackPlan, EXPECTED_PROJECT, DEFAULT_OWNER } = await import('../scripts/migrateRoles.mjs');

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

// --- T4.1: دالة التخطيط النقية ---

describe('migrateRoles plan (pure, T4.1)', () => {
  const base = [
    { id: 'u1', email: 'izatadel007@gmail.com', role: 'admin', disabled: false },
    { id: 'u2', email: 'mexx.maxx104@hotmail.com', role: 'admin', disabled: false },
    { id: 'u3', email: 'esraa.man104@gmail.com', role: 'cashier', disabled: false },
  ];
  it('dry-run plan: مرشح واحد admin -> owner بكتابة واحدة فقط', () => {
    const p = planMigration(base, 'izatadel007@gmail.com');
    expect(p.ok).toBe(true);
    expect(p.writes).toBe(1);
    expect(p.changes).toEqual([{ id: 'u1', email: 'izatadel007@gmail.com', from: 'admin', to: 'owner' }]);
    expect(p.idempotent).toBe(false);
  });
  it('Fail-closed: لا مرشح', () => {
    const p = planMigration(base, 'nobody@example.com');
    expect(p.ok).toBe(false);
    expect(p.writes).toBe(0);
    expect(p.errors.join(' ')).toMatch(/لا مرشح/);
  });
  it('Fail-closed: أكثر من مطابقة (بريد مكرر بحالة مختلفة)', () => {
    const dup = [...base, { id: 'u4', email: 'IZATADEL007@GMAIL.COM', role: 'admin', disabled: false }];
    const p = planMigration(dup, 'izatadel007@gmail.com');
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/أكثر من مطابقة/);
  });
  it('Fail-closed: المرشح disabled', () => {
    const dis = base.map((u) => (u.id === 'u1' ? { ...u, disabled: true } : u));
    const p = planMigration(dis, 'izatadel007@gmail.com');
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/معطّل/);
  });
  it('Fail-closed: المرشح بلا role', () => {
    const norole = base.map((u) => (u.id === 'u1' ? { id: 'u1', email: 'izatadel007@gmail.com', disabled: false } : u));
    const p = planMigration(norole, 'izatadel007@gmail.com');
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/بلا role/);
  });
  it('Fail-closed: مالك آخر موجود', () => {
    const other = [...base, { id: 'u9', email: 'other@example.com', role: 'owner', disabled: false }];
    const p = planMigration(other, 'izatadel007@gmail.com');
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/مالك آخر/);
  });
  it('حسابان بلا role (الاختباريان) = تحذيرات لا رفض', () => {
    const withTest = [...base,
      { id: 't1', email: 'ramypro0120@gmail.com', disabled: false },
      { id: 't2', email: 'mmexx8799@gmail.com', disabled: false },
    ];
    const p = planMigration(withTest, 'izatadel007@gmail.com');
    expect(p.ok).toBe(true);
    expect(p.writes).toBe(1);
    expect(p.warnings.length).toBe(2);
  });
  it('Idempotent: المرشح owner أصلًا = صفر كتابة', () => {
    const already = base.map((u) => (u.id === 'u1' ? { ...u, role: 'owner' } : u));
    const p = planMigration(already, 'izatadel007@gmail.com');
    expect(p.ok).toBe(true);
    expect(p.writes).toBe(0);
    expect(p.idempotent).toBe(true);
  });
  it('rollbackPlan يعيد role كما كان', () => {
    const backup = base;
    const current = base.map((u) => (u.id === 'u1' ? { ...u, role: 'owner' } : u));
    const r = rollbackPlan(backup, current);
    expect(r.writes).toBe(1);
    expect(r.changes[0]).toMatchObject({ id: 'u1', fromRole: 'owner', toRole: 'admin' });
  });
  it('EXPECTED_PROJECT = casher-yasoo والمالك الافتراضي D-1', () => {
    expect(EXPECTED_PROJECT).toBe('casher-yasoo');
    expect(DEFAULT_OWNER).toBe('izatadel007@gmail.com');
  });
});

// --- T4.3: المحاكي (dry/apply/idempotent/rollback) عبر Admin SDK ---

describe('migrateRoles emulator (T4.3)', () => {
  it('dry-run بلا كتابة + apply + read-back + idempotent + rollback', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      console.log('skip: no emulator (run via npm run test:rules)');
      return;
    }
    const appMod = await import('firebase-admin/app');
    const fsMod = await import('firebase-admin/firestore');
    if (appMod.getApps().length === 0) appMod.initializeApp({ projectId: PROJECT_ID });
    const db = fsMod.getFirestore();

    await testEnv.clearFirestore();
    const seed = [
      { id: 'mig-owner', email: 'izatadel007@gmail.com', role: 'admin', disabled: false },
      { id: 'mig-admin', email: 'mexx.maxx104@hotmail.com', role: 'admin', disabled: false },
      { id: 'mig-cash', email: 'esraa.man104@gmail.com', role: 'cashier', disabled: false },
    ];
    for (const u of seed) await db.collection('users').doc(u.id).set({ email: u.email, role: u.role, disabled: u.disabled });

    const fetchUsers = async () => (await db.collection('users').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

    // dry-run: plan فقط — صفر كتابة (نتحقق أن الدور لم يتغير)
    const dry = planMigration(await fetchUsers(), 'izatadel007@gmail.com');
    expect(dry.ok).toBe(true);
    expect(dry.writes).toBe(1);
    console.log(`[dry-run] writes=${dry.writes} target=${dry.target.email} ${dry.target.role}->owner`);
    expect((await db.collection('users').doc('mig-owner').get()).data()?.role).toBe('admin');

    // apply: كتابة واحدة فقط
    for (const ch of dry.changes) await db.collection('users').doc(ch.id).update({ role: ch.to });
    const afterApply = await db.collection('users').doc('mig-owner').get();
    console.log(`[apply] read-back: role=${afterApply.data()?.role}`);
    expect(afterApply.data()?.role).toBe('owner');
    // لا مستخدم آخر تغيّر
    expect((await db.collection('users').doc('mig-admin').get()).data()?.role).toBe('admin');

    // idempotent: التشغيل الثاني = صفر كتابة
    const second = planMigration(await fetchUsers(), 'izatadel007@gmail.com');
    expect(second.ok).toBe(true);
    expect(second.writes).toBe(0);
    expect(second.idempotent).toBe(true);
    console.log(`[idempotent] writes=${second.writes}`);

    // rollback: يعيد admin
    const backup = seed;
    const r = rollbackPlan(backup, await fetchUsers());
    expect(r.writes).toBe(1);
    for (const c of r.changes) await db.collection('users').doc(c.id).update({ role: c.toRole, disabled: c.toDisabled });
    console.log(`[rollback] writes=${r.writes}`);
    expect((await db.collection('users').doc('mig-owner').get()).data()?.role).toBe('admin');
  });
});
