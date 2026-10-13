// scripts/surveyBackup.mjs — READ-ONLY backup survey. Never writes, never connects.
// Usage: node scripts/surveyBackup.mjs --file <path-to-backup.json>
// Exit 0 + printed report; exit 2 on missing/unreadable file.
import { readFileSync } from 'node:fs';

const PRICE_FIELDS = ['price', 'retailCashPrice', 'retailCreditPrice', 'wholesaleCashPrice', 'wholesaleCreditPrice'];
const ALLOW = {
  invoices: ['items', 'subtotal', 'discount', 'total', 'paymentMethod', 'customerId', 'customerName', 'dailyArchiveId', 'invoiceNumber', 'createdAt', 'returnedQuantities'],
  returns: ['items', 'total', 'returnNumber', 'createdAt', 'dailyArchiveId', 'customerId', 'customerName', 'originalInvoiceId'],
  customerPayments: ['customerId', 'amount', 'date', 'notes'],
  supplierPayments: ['supplierId', 'amount', 'date', 'notes'],
  purchaseInvoices: ['invoiceNumber', 'items', 'subtotal', 'total', 'supplierId', 'supplierName', 'priceFlagged', 'createdAt'],
  supplierReturns: ['items', 'total', 'returnNumber', 'supplierId', 'supplierName', 'createdAt'],
};
function argFile() {
  const i = process.argv.indexOf('--file');
  const p = i >= 0 ? process.argv[i + 1] : undefined;
  if (!p) { console.error('Usage: node scripts/surveyBackup.mjs --file <backup.json>'); process.exit(2); }
  return p;
}

const path = argFile();
let raw;
try { raw = readFileSync(path, 'utf8'); } catch { console.error(`cannot read file: ${path}`); process.exit(2); }
const data = JSON.parse(raw);

const products = Array.isArray(data.products) ? data.products : [];
let noPositive = 0, partialZero = 0;
for (const p of products) {
  const vals = PRICE_FIELDS.filter((f) => typeof p[f] === 'number').map((f) => p[f]);
  if (vals.length === 0 || !vals.some((v) => v > 0)) noPositive++;
  else if (vals.some((v) => v === 0)) partialZero++;
}

const invoices = Array.isArray(data.invoices) ? data.invoices : [];
const invNoArch = invoices.filter((d) => d.dailyArchiveId === undefined).length;

const extraKeyReport = {};
for (const [col, allow] of Object.entries(ALLOW)) {
  const docs = Array.isArray(data[col]) ? data[col] : [];
  let count = 0; const keys = new Set();
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      if (k === 'id') continue;
      if (!allow.includes(k)) { count++; keys.add(k); }
    }
  }
  extraKeyReport[col] = { docsWithExtraKeys: count, extraKeys: [...keys].sort() };
}

console.log(`file=${path}`);
console.log(`schemaVersion=${data.schemaVersion}`);
console.log(`products total=${products.length} noPositivePrice=${noPositive} partialZero=${partialZero}`);
console.log(`invoices total=${invoices.length} withoutDailyArchiveId=${invNoArch}`);
for (const [col, r] of Object.entries(extraKeyReport)) {
  console.log(`${col}: docsWithExtraKeys=${r.docsWithExtraKeys} extraKeys=[${r.extraKeys.join(',')}]`);
}

// Totals arithmetic drift + missing money fields + maxima (read-only).
let maxItems = 0, drift = 0;
for (const d of invoices) {
  if (Array.isArray(d.items)) maxItems = Math.max(maxItems, d.items.length);
  if (typeof d.total === 'number' && typeof d.subtotal === 'number') {
    const disc = typeof d.discount === 'number' ? d.discount : 0;
    if (Math.abs(d.total - (d.subtotal - disc)) > 0.011) drift++;
  }
}
const noTotal = ['invoices', 'returns', 'purchaseInvoices', 'supplierReturns']
  .reduce((n, c) => n + (Array.isArray(data[c]) ? data[c].filter((d) => d.total === undefined).length : 0), 0);
const noAmount = ['customerPayments', 'supplierPayments']
  .reduce((n, c) => n + (Array.isArray(data[c]) ? data[c].filter((d) => d.amount === undefined).length : 0), 0);
const maxTotal = Math.max(0, ...['invoices', 'returns', 'purchaseInvoices', 'supplierReturns']
  .flatMap((c) => (Array.isArray(data[c]) ? data[c] : []).map((d) => d.total).filter((v) => typeof v === 'number')));
const maxAmount = Math.max(0, ...['customerPayments', 'supplierPayments']
  .flatMap((c) => (Array.isArray(data[c]) ? data[c] : []).map((d) => d.amount).filter((v) => typeof v === 'number')));
console.log(`invoices maxItems=${maxItems} arithmeticDrift=${drift}`);
console.log(`missingTotal=${noTotal} missingAmount=${noAmount} maxTotal=${maxTotal} maxAmount=${maxAmount}`);
