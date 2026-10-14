#!/usr/bin/env node
// scripts/surveyBackupMoney.mjs — READ-ONLY local backup survey for REQ-RULES-2-RELEASE.
// Reads one local backup JSON file. No network, no admin SDK, no key, never modifies.
// Usage: node scripts/surveyBackupMoney.mjs --file <path-to-backup.json>
// Checks mirror surveyMoneyRanges.mjs literally:
//   products: quantity (missing OR invalid = violation, then the 5 prices are
//     still checked for the same doc) + five price fields when present.
//   customers/suppliers: balance range ±1e12 exclusive, negative accepted;
//     missing balance = missing info only (no violation).
//   invoices/returns/purchaseInvoices/supplierReturns: total missing OR invalid = violation.
//   customerPayments/supplierPayments: amount missing OR invalid (must be > 0) = violation.
// Output: table collection -> scanned -> violations -> missing -> samples (<=10 IDs),
// then VIOLATIONS_TOTAL. Exit 0 + report; exit 2 on missing/unreadable/invalid file.
// Read-only proof: a findstr scan for mutating calls over this file returns empty.

import { readFileSync } from 'node:fs';

const CAP = 1000000000000;
const MAX_SAMPLES = 10;

const PRICE_FIELDS = ['price', 'retailCashPrice', 'retailCreditPrice', 'wholesaleCashPrice', 'wholesaleCreditPrice'];
const LEDGER_TOTALS = ['invoices', 'returns', 'purchaseInvoices', 'supplierReturns'];
const PAYMENT_AMOUNTS = ['customerPayments', 'supplierPayments'];
const PARTIES = ['customers', 'suppliers'];

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
  try {
    const s = JSON.stringify(v);
    return s === undefined ? 'undefined' : s;
  } catch { return String(v); }
}
function docId(d, i) {
  return (d && typeof d.id === 'string' && d.id) ? d.id : `#${i}`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function bucket() {
  return { scanned: 0, violations: 0, missing: 0, samples: [] };
}
function flag(b, id, field, value) {
  b.violations++;
  if (b.samples.length < MAX_SAMPLES) b.samples.push({ id, field, value: fmt(value) });
}
function asArray(data, col) {
  const v = data[col];
  return Array.isArray(v) ? v : null;
}

const path = arg('--file');
if (!path) { console.error('Usage: node scripts/surveyBackupMoney.mjs --file <backup.json>'); process.exit(2); }
let raw;
try { raw = readFileSync(path, 'utf8'); }
catch { console.error(`cannot read file: ${path}`); process.exit(2); }
let data;
try { data = JSON.parse(raw); }
catch { console.error(`file is not valid JSON: ${path}`); process.exit(2); }
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  console.error(`file is not a backup object: ${path}`);
  process.exit(2);
}

const rep = {};
let totalViolations = 0;
function close(col, b) {
  rep[col] = b;
  totalViolations += b.violations;
}

// products: quantity missing/invalid = violation (no early exit — prices still checked).
{
  const b = bucket();
  const docs = asArray(data, 'products');
  if (docs === null) { console.error('backup missing products array'); process.exit(2); }
  docs.forEach((d, i) => {
    b.scanned++;
    const id = docId(d, i);
    if (!d || typeof d !== 'object') { flag(b, id, 'doc', d); return; }
    if (!('quantity' in d) || !quantityOk(d.quantity)) flag(b, id, 'quantity', d.quantity);
    for (const f of PRICE_FIELDS) {
      if ((f in d) && !moneyOkAllowZero(d[f])) flag(b, id, f, d[f]);
    }
  });
  close('products', b);
}

// customers + suppliers: missing balance = info only.
for (const col of PARTIES) {
  const b = bucket();
  const docs = asArray(data, col);
  if (docs === null) { console.error(`backup missing ${col} array`); process.exit(2); }
  docs.forEach((d, i) => {
    b.scanned++;
    const id = docId(d, i);
    if (!d || typeof d !== 'object') { flag(b, id, 'doc', d); return; }
    if (!('balance' in d)) { b.missing++; return; }
    if (!balanceOk(d.balance)) flag(b, id, 'balance', d.balance);
  });
  close(col, b);
}

// ledger totals: missing OR invalid = violation.
for (const col of LEDGER_TOTALS) {
  const b = bucket();
  const docs = asArray(data, col);
  if (docs === null) { console.error(`backup missing ${col} array`); process.exit(2); }
  docs.forEach((d, i) => {
    b.scanned++;
    const id = docId(d, i);
    if (!d || typeof d !== 'object') { flag(b, id, 'doc', d); return; }
    if (!('total' in d) || !moneyOkAllowZero(d.total)) flag(b, id, 'total', d.total);
  });
  close(col, b);
}

// payment amounts: missing OR invalid (must be > 0) = violation.
for (const col of PAYMENT_AMOUNTS) {
  const b = bucket();
  const docs = asArray(data, col);
  if (docs === null) { console.error(`backup missing ${col} array`); process.exit(2); }
  docs.forEach((d, i) => {
    b.scanned++;
    const id = docId(d, i);
    if (!d || typeof d !== 'object') { flag(b, id, 'doc', d); return; }
    if (!('amount' in d) || !moneyOkPositive(d.amount)) flag(b, id, 'amount', d.amount);
  });
  close(col, b);
}

console.log('REQ-RULES-2-RELEASE backup money survey (read-only, local file):');
for (const [col, r] of Object.entries(rep)) {
  console.log(`- ${col}: scanned=${r.scanned} violations=${r.violations} missing=${r.missing}`);
  for (const s of r.samples) console.log(`    e.g. ${s.id} ${s.field}=${s.value}`);
}
console.log(`VIOLATIONS_TOTAL=${totalViolations}`);
if (totalViolations > 0) console.log('GATE: violations present — do NOT deploy rules before data remediation.');
else console.log('GATE: clean — restore-check may proceed.');
