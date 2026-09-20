#!/usr/bin/env node
// scripts/migrateRoles.mjs — REQ-RBAC-4: تعيين المالك (D-1) عبر Admin SDK
//
// G0: D-1 owner = izatadel007@gmail.com (الافتراضي في --owner إن لم يُمرَّر)
// الافتراضي DRY-RUN: لا كتابة إطلاقًا بلا --apply (AC-01)
// Fail-closed (AC-03/EC-07): لا مرشح · أكثر من مطابقة · المرشح بلا role · المرشح disabled · مالك آخر موجود
// ملاحظة موثقة: المستخدمون الآخرون بلا role (حسابا الاختبار ramypro0120/mmexx8799 — known-issues AC-04 Follow-up)
//   يُسجَّلون كتحذيرات لا كرفض، حتى لا تُحجب R4 بسبب حسابين مجدولين للحذف ومحرومين أصلًا (Default-deny).
// Idempotent (AC-04/EC-06): التشغيل الثاني والمرشح owner أصلًا = صفر كتابة
// Rollback (AC-05): --rollback <users-backup-*.json> يعيد role/disabled كما كانت — يُشغَّل قبل أي تراجع قواعد/واجهة (EC-09)
// الاعتماد (AC-06/AUDIT-SEC-2): من GOOGLE_APPLICATION_CREDENTIALS فقط — أي --key-file/--credentials مرفوض + لا يمس Firebase Auth
// الحماية من المشروع الخطأ (AC-07/EC): --apply يتطلب --project casher-yasoo صراحةً
// لا يُشغَّل ضد الإنتاج إلا بإذن صريح بعد مخرجات المحاكي الأربعة (dry/apply/read-back/idempotent/rollback)

import { readFileSync, writeFileSync } from 'node:fs';

export const EXPECTED_PROJECT = 'casher-yasoo';
export const VALID_ROLES = ['owner', 'admin', 'supervisor', 'cashier', 'accountant'];
export const DEFAULT_OWNER = 'izatadel007@gmail.com';

export function normalizeEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}

/**
 * planMigration — دالة تخطيط نقية (T4.1)
 * @param {Array<{id:string,email:string,role?:string,disabled?:boolean}>} users
 * @param {string} ownerEmail
 * @returns {{ok:boolean, errors:string[], warnings:string[], target:any|null, changes:Array<{id:string,email:string,from:string,to:string}>, writes:number, idempotent:boolean}}
 */
export function planMigration(users, ownerEmail) {
  const errors = [];
  const warnings = [];
  const target = normalizeEmail(ownerEmail);
  if (!target || !target.includes('@')) {
    return { ok: false, errors: ['البريد المطلوب للمالك غير صالح'], warnings, target: null, changes: [], writes: 0, idempotent: false };
  }
  const list = Array.isArray(users) ? users : [];
  const matches = list.filter((u) => normalizeEmail(u?.email) === target);
  if (matches.length === 0) {
    errors.push(`لا مرشح: لا يوجد مستخدم بالبريد ${target}`);
    return { ok: false, errors, warnings, target: null, changes: [], writes: 0, idempotent: false };
  }
  if (matches.length > 1) {
    errors.push(`أكثر من مطابقة للبريد ${target}: ${matches.map((m) => m.id).join(', ')} — مرفوض (Fail-closed)`);
    return { ok: false, errors, warnings, target: null, changes: [], writes: 0, idempotent: false };
  }
  const candidate = matches[0];
  if (candidate?.disabled === true) {
    errors.push(`المرشح ${target} معطّل (disabled=true) — مرفوض (Fail-closed)`);
  }
  if (!candidate?.role) {
    errors.push(`المرشح ${target} بلا role — مرفوض (Fail-closed)`);
  }
  // مالك آخر موجود غير المرشح = رفض (قاعدة «مالك واحد» إجرائية)
  const otherOwners = list.filter((u) => u?.role === 'owner' && u?.id !== candidate?.id);
  if (otherOwners.length > 0) {
    errors.push(`يوجد مالك آخر: ${otherOwners.map((o) => `${o.email} (${o.id})`).join(', ')} — مرفوض (Fail-closed)`);
  }
  // تحذيرات (لا ترفض): مستخدمون آخرون بلا role أو بدور غريب
  for (const u of list) {
    if (u?.id === candidate?.id) continue;
    if (!u?.role) warnings.push(`بلا role: ${u?.email ?? u?.id} (${u?.id}) — محروم تلقائيًا (Default-deny)، لا أثر على الترحيل`);
    else if (!VALID_ROLES.includes(u.role)) warnings.push(`دور غريب: ${u?.email} role=${u?.role} — محروم تلقائيًا، لا أثر على الترحيل`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings, target: candidate, changes: [], writes: 0, idempotent: false };
  }
  if (candidate.role === 'owner') {
    return { ok: true, errors, warnings, target: candidate, changes: [], writes: 0, idempotent: true };
  }
  return {
    ok: true, errors, warnings, target: candidate,
    changes: [{ id: candidate.id, email: candidate.email, from: candidate.role, to: 'owner' }],
    writes: 1, idempotent: false,
  };
}

/**
 * rollbackPlan — يحسب التغييرات اللازمة لإعادة role/disabled كما في النسخة الاحتياطية
 */
export function rollbackPlan(backupUsers, currentUsers) {
  const changes = [];
  const currentById = new Map((currentUsers ?? []).map((u) => [u.id, u]));
  for (const b of backupUsers ?? []) {
    const c = currentById.get(b.id);
    if (!c) continue; // وثيقة حُذفت بعد النسخة — لا نعيد إنشاءها تلقائيًا
    if ((c.role ?? null) !== (b.role ?? null) || Boolean(c.disabled) !== Boolean(b.disabled)) {
      changes.push({ id: b.id, email: b.email, fromRole: c.role ?? null, toRole: b.role ?? null, fromDisabled: Boolean(c.disabled), toDisabled: Boolean(b.disabled) });
    }
  }
  return { changes, writes: changes.length };
}

function printPlan(plan) {
  console.log('--- plan ---');
  if (plan.target) console.log(`candidate: ${plan.target.email} (${plan.target.id}) role=${plan.target.role ?? '—'} disabled=${Boolean(plan.target.disabled)}`);
  for (const ch of plan.changes) console.log(`  ${ch.id} ${ch.email}: ${ch.from} -> ${ch.to}`);
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  for (const e of plan.errors) console.log(`error: ${e}`);
  console.log(`writes: ${plan.writes}${plan.idempotent ? ' (idempotent — already owner)' : ''}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/migrateRoles.mjs --owner <email> [--dry-run|--apply --project casher-yasoo] | --rollback <backup.json> [--dry-run|--apply --project casher-yasoo]');
    console.log(`Default owner: ${DEFAULT_OWNER}. Default mode: --dry-run (no writes). Credentials: GOOGLE_APPLICATION_CREDENTIALS only.`);
    process.exit(0);
  }
  // AUDIT-SEC-2: لا مفاتيح عبر argv أو ملفات في المستودع
  for (const bad of ['--key-file', '--keyfile', '--credentials', '--service-account', '--serviceAccount']) {
    if (argv.some((a) => a === bad || a.startsWith(bad + '='))) {
      console.error(`مرفوض: ${bad} — بيانات الاعتماد من GOOGLE_APPLICATION_CREDENTIALS فقط (AUDIT-SEC-2)`);
      process.exit(1);
    }
  }
  const getArg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const isApply = argv.includes('--apply');
  const isRollback = argv.includes('--rollback');
  const project = getArg('--project');

  const appMod = await import('firebase-admin/app');
  const fsMod = await import('firebase-admin/firestore');
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!useEmulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('مرفوض: GOOGLE_APPLICATION_CREDENTIALS غير مضبوط (ولا محاكي) — لا بيانات اعتماد عبر argv (AUDIT-SEC-2)');
    process.exit(1);
  }
  if (appMod.getApps().length === 0) {
    if (useEmulator) appMod.initializeApp({ projectId: getArg('--emulator-project') || EXPECTED_PROJECT });
    else appMod.initializeApp();
  }
  const db = fsMod.getFirestore();

  const snap = await db.collection('users').get();
  const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // --- Rollback path ---
  if (isRollback) {
    const file = getArg('--rollback');
    if (!file) { console.error('مرفوض: --rollback يتطلب مسار ملف النسخة'); process.exit(1); }
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    const backupUsers = Array.isArray(backup) ? backup : backup.users;
    const { changes, writes } = rollbackPlan(backupUsers, users);
    console.log('--- rollback plan ---');
    for (const c of changes) console.log(`  ${c.id} ${c.email}: role ${c.fromRole} -> ${c.toRole}, disabled ${c.fromDisabled} -> ${c.toDisabled}`);
    console.log(`writes: ${writes}`);
    if (!isApply) { console.log('DRY-RUN — لا كتابة (rollback). أضف --apply --project casher-yasoo للتنفيذ.'); process.exit(0); }
    if (project !== EXPECTED_PROJECT) { console.error(`مرفوض: --apply للتراجع يتطلب --project ${EXPECTED_PROJECT} صراحةً`); process.exit(1); }
    for (const c of changes) {
      await db.collection('users').doc(c.id).update({ role: c.toRole, disabled: c.toDisabled });
    }
    console.log(`rollback done: ${writes} write(s)`);
    process.exit(0);
  }

  // --- Migrate path ---
  const ownerEmail = getArg('--owner') || DEFAULT_OWNER;
  const plan = planMigration(users, ownerEmail);
  printPlan(plan);
  if (!plan.ok) { console.error('مرفوض (Fail-closed) — لا كتابة'); process.exit(1); }
  if (!isApply) { console.log('DRY-RUN — لا كتابة. أضف --apply --project casher-yasoo للتنفيذ.'); process.exit(0); }
  if (project !== EXPECTED_PROJECT) { console.error(`مرفوض: --apply يتطلب --project ${EXPECTED_PROJECT} صراحةً (حماية من المشروع الخطأ)`); process.exit(1); }

  // نسخة احتياطية محلية قبل أي كتابة (AC)
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `users-backup-${ts}.json`;
  writeFileSync(backupFile, JSON.stringify(users, null, 2), 'utf8');
  console.log(`backup: ${backupFile} (${users.length} users)`);

  if (plan.idempotent) { console.log('idempotent: المرشح owner أصلًا — صفر كتابة'); }
  else {
    for (const ch of plan.changes) {
      await db.collection('users').doc(ch.id).update({ role: ch.to });
    }
    console.log(`apply done: ${plan.writes} write(s)`);
  }
  // Read-back (AC-07)
  const after = await db.collection('users').doc(plan.target.id).get();
  console.log(`read-back: ${plan.target.email} role=${after.data()?.role} disabled=${Boolean(after.data()?.disabled)}`);
  console.log('تحقق: ادخل بحساب المالك فعليًا وافتح /users');
}

const invokedAsScript = Boolean(process.argv?.[1]) && String(process.argv[1]).replace(/\\/g, '/').endsWith('scripts/migrateRoles.mjs');
if (invokedAsScript) {
  main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}
