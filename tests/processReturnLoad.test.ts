// E-5 load test: N=10/N=20 same-tick linked returns on the SAME invoice (Firebase Emulator).
//
// processReturn's 5th param __testOnRetry is a permanent optional test-only hook
// (zero prod effect when undefined) forwarded to runTransactionWithRetry's onRetry
// — it only COUNTS retries, never decides.
//
// Design: 4 scenarios × 15 rounds. Each round: clearFirestore + fresh isolated
// fixtures (own invoice id), N same-tick processReturn calls each with its OWN
// __testOnRetry counter → attempts[i] = 1 + retries[i]. Five-way no-oversell
// equations checked EVERY round. Summary table printed per scenario.
//
// Run: npx firebase emulators:exec --only firestore,auth "npx vitest run tests/processReturnLoad.test.ts"

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import type { Product, Invoice, DailyArchive, CartItem } from '../types';

// tests/setup.ts already mocks react-hot-toast before this import.
const { processReturn } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo';
const TEST_EMAIL = 'cashier@test.local';
const TEST_PASSWORD = 'secret123';
const ARCHIVE_ID = '2026-09-13';

async function signInTestUser() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in — fine */ }
  await signInWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
  return fbAuth.currentUser!.uid;
}

async function seedUserDocWithRulesDisabled(env: RulesTestEnvironment, uid: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: TEST_EMAIL, role: 'cashier' });
  });
}

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

function makeRawCart(qty: number): CartItem[] {
  return [{
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
    buyQuantity: qty,
    priceType: 'retail',
  } as CartItem];
}

async function seedRound(ctx: RulesTestContext, invoiceId: string, supplyQty: number) {
  const db = ctx.firestore();
  const product: Product = {
    id: 'prod-1',
    code: 'P001',
    name: 'منتج اختبار',
    price: 100,
    retailCashPrice: 100,
    retailCreditPrice: 100,
    wholesaleCashPrice: 80,
    wholesaleCreditPrice: 80,
    quantity: 50,
    categoryId: 'cat-1',
    createdAt: Date.now(),
    searchableIndex: [],
  };
  const archive: DailyArchive = {
    id: ARCHIVE_ID,
    startTime: Date.now(),
    status: 'open',
    totalSales: 0,
    totalReturns: 0,
    totalCash: 0,
    totalCredit: 0,
    totalVodafoneCash: 0,
    totalInstapay: 0,
    totalReturnsCash: 0,
    totalReturnsOnAccount: 0,
  };
  const invoice: Invoice = {
    id: invoiceId,
    invoiceNumber: 'INV-000001',
    items: [{ ...product, id: 'prod-1', buyQuantity: supplyQty, priceType: 'retail', price: 100 } as CartItem],
    subtotal: supplyQty * 100,
    discount: 0,
    total: supplyQty * 100,
    paymentMethod: 'نقدا' as Invoice['paymentMethod'],
    createdAt: Date.now(),
    dailyArchiveId: archive.id,
  };
  await setDoc(doc(db, 'products', product.id), { ...product, createdAt: Date.now() });
  await setDoc(doc(db, 'dailyArchives', archive.id), { ...archive, startTime: Date.now() } as any);
  await setDoc(doc(db, 'invoices', invoice.id), { ...invoice, createdAt: Date.now() } as any);
}

function p95(sortedAsc: number[]): number {
  if (!sortedAsc.length) return 0;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.ceil(0.95 * sortedAsc.length) - 1)];
}

type Agg = {
  rounds: number; ok: number; rejected: number; exhausted: number; unclassified: number;
  oversellRounds: number; hangRounds: number; attemptsAll: number[]; maxRoundMs: number;
};

function newAgg(): Agg {
  return { rounds: 0, ok: 0, rejected: 0, exhausted: 0, unclassified: 0, oversellRounds: 0, hangRounds: 0, attemptsAll: [], maxRoundMs: 0 };
}

function printAgg(name: string, a: Agg) {
  const s = [...a.attemptsAll].sort((x, y) => x - y);
  const mean = s.length ? (s.reduce((t, v) => t + v, 0) / s.length).toFixed(2) : 'n/a';
  console.log(
    `[E-5 ${name}] rounds=${a.rounds} ok=${a.ok} rejected=${a.rejected} exhausted=${a.exhausted} ` +
    `unclassified=${a.unclassified} oversellRounds=${a.oversellRounds} hangRounds=${a.hangRounds} ` +
    `meanAttempts=${mean} maxAttempts=${s.length ? s[s.length - 1] : 0} p95Attempts=${p95(s)} maxRoundMs=${a.maxRoundMs}`,
  );
}

async function runScenario(opts: {
  tag: string; n: number; supplyQty: number; reqQty: number; rounds: number; strictRemainingMsg: boolean;
}): Promise<Agg> {
  const db = getDB();
  const agg = newAgg();
  for (let r = 0; r < opts.rounds; r++) {
    const invoiceId = `inv-${opts.tag}-r${r}`;
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedRound(ctx, invoiceId, opts.supplyQty);
    });
    const uid = await signInTestUser();
    await seedUserDocWithRulesDisabled(testEnv, uid);

    // Per-op independent counters: attempts[i] = 1 + retries[i].
    const retries = new Array<number>(opts.n).fill(0);
    const hooks = retries.map((_, i) => () => { retries[i] += 1; });

    const t0 = Date.now();
    // Real hang detection: the round MUST settle within 30s or it counts as hang and fails.
    const ROUND_TIMEOUT_MS = 30000;
    let results;
    try {
      results = await Promise.race([
        Promise.allSettled(
          Array.from({ length: opts.n }, (_, i) =>
            processReturn(makeRawCart(opts.reqQty), ARCHIVE_ID, undefined, invoiceId, hooks[i]),
          ),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`E-5 ${opts.tag} r${r}: round timed out after ${ROUND_TIMEOUT_MS}ms (hang)`)), ROUND_TIMEOUT_MS),
        ),
      ]);
    } catch (e) {
      agg.hangRounds += 1;
      console.log(`[E-5 ${opts.tag} r${r}] HANG after ${Date.now() - t0}ms hang=true`);
      throw e; // hung round fails the test
    }
    const elapsedMs = Date.now() - t0;
    agg.maxRoundMs = Math.max(agg.maxRoundMs, elapsedMs);

    const attempts = retries.map((c) => 1 + c);
    agg.attemptsAll.push(...attempts);

    const okIdx: number[] = [];
    const badReasons: any[] = [];
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') okIdx.push(i);
      else badReasons.push((res as PromiseRejectedResult).reason);
    });
    const okQty = okIdx.length * opts.reqQty;
    agg.rounds += 1;
    agg.ok += okIdx.length;
    agg.rejected += badReasons.length;

    // Classification.
    for (const e of badReasons) {
      if (e?._txExhausted === true) { agg.exhausted += 1; continue; }
      if (!e?.code) {
        if (opts.strictRemainingMsg) {
          // Exact api.ts:1224 wording — no loose alternation.
          expect(String(e?.message ?? '')).toMatch(/كمية متبقية للإرجاع/);
        }
        continue;
      }
      agg.unclassified += 1;
    }

    // 1) No oversell.
    expect(okQty).toBeLessThanOrEqual(opts.supplyQty);
    if (okQty > opts.supplyQty) agg.oversellRounds += 1;

    // 2) Five-way equations on committed state — every round.
    const invSnap = await getDoc(doc(db, 'invoices', invoiceId));
    expect((invSnap.data() as any).returnedQuantities).toEqual({ 'prod-1': okQty });
    const linked = (await getDocs(collection(db, 'returns'))).docs.filter(
      (d) => (d.data() as any).originalInvoiceId === invoiceId,
    );
    expect(linked.length).toBe(okIdx.length);
    expect(linked.reduce((s, d) => s + ((d.data() as any).items?.[0]?.buyQuantity || 0), 0)).toBe(okQty);
    expect(((await getDoc(doc(db, 'products', 'prod-1'))).data() as any).quantity).toBe(50 + okQty);
    expect(((await getDoc(doc(db, 'dailyArchives', ARCHIVE_ID))).data() as any).totalReturns).toBe(okQty * 100);
    const counterSnap = await getDoc(doc(db, 'counters', 'returns'));
    expect((counterSnap.data() as any).lastNumber).toBe(okIdx.length);

    // Per-round line (raw evidence) with correct per-op stats.
    const okAtt = okIdx.map((i) => attempts[i]);
    const sOk = [...okAtt].sort((a, b) => a - b);
    const meanAll = (attempts.reduce((t, v) => t + v, 0) / attempts.length).toFixed(2);
    const meanOk = sOk.length ? (sOk.reduce((t, v) => t + v, 0) / sOk.length).toFixed(2) : 'n/a';
    console.log(
      `[E-5 ${opts.tag} r${r}] ok=${okIdx.length}/${opts.n} committedQty=${okQty}/${opts.supplyQty} ` +
      `avgAttemptsAllOps=${meanAll} avgAttemptsOkOps=${meanOk} ` +
      `maxAttempts=${Math.max(...attempts)} p95Attempts=${p95([...attempts].sort((a, b) => a - b))} elapsedMs=${elapsedMs} hangRounds=${agg.hangRounds} hang=false`,
    );
  }
  printAgg(opts.tag, agg);
  return agg;
}

describe('E-5 load matrix: N=10/N=20 × over/exact, 15 rounds each', () => {
  beforeAll(async () => {
    const fbAuth = getAuthInstance();
    try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
    try {
      await createUserWithEmailAndPassword(fbAuth, TEST_EMAIL, TEST_PASSWORD);
    } catch (e: any) {
      if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
    }
  });

  it('N10-A over-demand: 10×qty2 on supply 10 ×15 rounds', async () => {
    const a = await runScenario({ tag: 'N10-A', n: 10, supplyQty: 10, reqQty: 2, rounds: 15, strictRemainingMsg: true });
    expect(a.oversellRounds).toBe(0);
    expect(a.unclassified).toBe(0);
    expect(a.hangRounds).toBe(0);
  }, 300000);

  it('N10-B exact-demand: 10×qty1 on supply 10 ×15 rounds', async () => {
    const a = await runScenario({ tag: 'N10-B', n: 10, supplyQty: 10, reqQty: 1, rounds: 15, strictRemainingMsg: false });
    expect(a.oversellRounds).toBe(0);
    expect(a.unclassified).toBe(0);
    expect(a.hangRounds).toBe(0);
  }, 300000);

  it('N20-A over-demand: 20×qty2 on supply 10 ×15 rounds', async () => {
    const a = await runScenario({ tag: 'N20-A', n: 20, supplyQty: 10, reqQty: 2, rounds: 15, strictRemainingMsg: true });
    expect(a.oversellRounds).toBe(0);
    expect(a.unclassified).toBe(0);
    expect(a.hangRounds).toBe(0);
  }, 300000);

  it('N20-B exact-demand: 20×qty1 on supply 20 ×15 rounds', async () => {
    const a = await runScenario({ tag: 'N20-B', n: 20, supplyQty: 20, reqQty: 1, rounds: 15, strictRemainingMsg: false });
    expect(a.oversellRounds).toBe(0);
    expect(a.unclassified).toBe(0);
    expect(a.hangRounds).toBe(0);
  }, 300000);
});
