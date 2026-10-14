#!/usr/bin/env node
// scripts/surveyMoneyRanges.mjs — READ-ONLY production survey for REQ-RULES-2-RELEASE.
// Counts docs that would violate the new update-path guards. Reads only, never modifies.
// Owner runs (nothing here connects from CI or from any other machine):
//   $env:GOOGLE_APPLICATION_CREDENTIALS='<service-key.json>'; node scripts/surveyMoneyRanges.mjs --project casher-yasoo
// Exit 0 + printed report on success; exit 2 on args/auth/connection errors.
// Read-only proof: a findstr scan for mutating calls over this file returns empty.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const CAP = 1000000000000;
const PAGE = 500;
const MAX_SAMPLES = 10;
const EXPECTED_PROJECT = 'casher-yasoo';

const PRICE_FIELDS = ['price', 'retailCashPrice', 'retailCreditPrice', 'wholesaleCashPrice', 'wholesaleCreditPrice'];

// Mirrors firestore.rules moneyOk(v, allowZero) + balanceOk(v), plus an
// explicit finite check (typeof NaN is 'number'; rules deny it via comparisons).
function moneyOkAllowZero(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < CAP;
}
function moneyOkPositive(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < CAP;
}
function balanceOk(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > -CAP && v < CAP;
}
function quantityOk(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function fmt(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function scanAll(db, col, visit) {
  let last = null;
  let n = 0;
  for (;;) {
    let q = db.collection(col).orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) { visit(d.id, d.data() || {}); n++; }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  return n;
}

function bucket() {
  return { violations: 0, missing: 0, samples: [] };
}
function flag(b, id, field, value) {
  b.violations++;
  if (b.samples.length < MAX_SAMPLES) b.samples.push({ id, field, value: fmt(value) });
}

const project = arg('--project');
if (project !== EXPECTED_PROJECT) {
  console.error(`refusing: --project ${EXPECTED_PROJECT} is required (got: ${project})`);
  process.exit(2);
}

try {
  if (getApps().length === 0) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyPath) { console.error('refusing: GOOGLE_APPLICATION_CREDENTIALS is not pointing at a key file'); process.exit(2); }
    initializeApp({ credential: cert(keyPath), projectId: EXPECTED_PROJECT });
  }
  const db = getFirestore();
  const rep = {};
  let totalViolations = 0;

  // products: quantity + five price fields (present-field semantics mirror the rules).
  {
    const b = bucket();
    const scanned = await scanAll(db, 'products', (id, d) => {
      if (!('quantity' in d)) { b.missing++; return; }
      if (!quantityOk(d.quantity)) { flag(b, id, 'quantity', d.quantity); return; }
      for (const f of PRICE_FIELDS) {
        if ((f in d) && !moneyOkAllowZero(d[f])) flag(b, id, f, d[f]);
      }
    });
    rep.products = { scanned, ...b };
    totalViolations += b.violations;
  }

  // customers + suppliers: balance range (negative accepted).
  for (const col of ['customers', 'suppliers']) {
    const b = bucket();
    const scanned = await scanAll(db, col, (id, d) => {
      if (!('balance' in d)) { b.missing++; return; }
      if (!balanceOk(d.balance)) flag(b, id, 'balance', d.balance);
    });
    rep[col] = { scanned, ...b };
    totalViolations += b.violations;
  }

  // ledger totals (allow zero).
  for (const col of ['invoices', 'returns', 'purchaseInvoices', 'supplierReturns']) {
    const b = bucket();
    const scanned = await scanAll(db, col, (id, d) => {
      if (!('total' in d)) { b.missing++; return; }
      if (!moneyOkAllowZero(d.total)) flag(b, id, 'total', d.total);
    });
    rep[col] = { scanned, ...b };
    totalViolations += b.violations;
  }

  // payment amounts (strictly positive).
  for (const col of ['customerPayments', 'supplierPayments']) {
    const b = bucket();
    const scanned = await scanAll(db, col, (id, d) => {
      if (!('amount' in d)) { b.missing++; return; }
      if (!moneyOkPositive(d.amount)) flag(b, id, 'amount', d.amount);
    });
    rep[col] = { scanned, ...b };
    totalViolations += b.violations;
  }

  console.log('REQ-RULES-2-RELEASE money-range survey (read-only):');
  for (const [col, r] of Object.entries(rep)) {
    console.log(`- ${col}: scanned=${r.scanned} violations=${r.violations} missing-field=${r.missing}`);
    for (const s of r.samples) console.log(`    e.g. ${s.id} ${s.field}=${s.value}`);
  }
  console.log(`VIOLATIONS_TOTAL=${totalViolations}`);
  if (totalViolations > 0) console.log('GATE: violations present — do NOT deploy rules before data remediation.');
  else console.log('GATE: clean — restore-check may proceed.');
} catch (e) {
  console.error(`survey failed: ${(e && e.message) || e}`);
  process.exit(2);
}
