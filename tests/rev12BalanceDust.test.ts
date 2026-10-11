// REV1-2 T2.2 (AUDIT-REV1) — emulator proof that the six writers persist
// float dust on the RAW code, plus the no-raw-comparison UI static test.
//
// RED-FIRST: run against UNCHANGED services on emulators. Every numeric
// expectation below is a literal computed in cents (never round2), so raw
// float arithmetic misses it (RED); after a correct fix (round at the six
// write sites) the stored values land exactly (GREEN).
//   - 0.1 + 0.2 is 0.30000000000000004 (classic): ±0.3 expectations RED raw.
//   - "expect 0" assertions use `=== 0` (not toBe): a -0 settlement is
//     still settled (toBe/Object.is distinguishes -0 and would lie).
//   - creditor-kept (-0.01) is GREEN already (Sterbenz-exact subtraction)
//     and must STAY green: it guards against a fix that swallows small
//     creditors. Justified GREEN, not a missing RED.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/rev12BalanceDust.test.ts"
// (tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { PaymentMethod, type CartItem } from '../types';

// tests/setup.ts already mocks react-hot-toast before these imports.
const {
  processSale,
  processReturn,
  addCustomerPayment,
  addSupplierPayment,
  processPurchase,
  processSupplierReturn,
} = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;

const PROJECT_ID = 'casher-yasoo'; // must match services/firebase.ts config
const CASHIER_EMAIL = 'cashier-rev12dust@test.local'; // distinct from other test files
const PASSWORD = 'secret123';

function dustItem(id: string, price: number, qty = 1): CartItem {
  return {
    id,
    code: id,
    name: 'صنف غبار',
    price,
    quantity: 1000,
    categoryId: 'dust-cat',
    createdAt: 1,
    searchableIndex: [],
    buyQuantity: qty,
    priceType: 'retail',
  };
}

function mkArchive(): Record<string, unknown> {
  return {
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
}

async function seed(collectionPath: string, docId: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

async function readBalance(collectionPath: string, id: string): Promise<unknown> {
  const snap = await getDoc(doc(getDB(), collectionPath, id));
  if (!snap.exists()) throw new Error(`missing doc ${collectionPath}/${id}`);
  return (snap.data() as { balance?: unknown }).balance;
}

async function signInCashier() {
  const fbAuth = getAuthInstance();
  try {
    await firebaseSignOut(fbAuth);
  } catch {
    /* not signed in */
  }
  try {
    await createUserWithEmailAndPassword(fbAuth, CASHIER_EMAIL, PASSWORD);
  } catch (e: unknown) {
    const code = (e as { code?: unknown } | undefined)?.code;
    if (String(code).indexOf('email-already-in-use') < 0) throw e;
  }
  await signInWithEmailAndPassword(fbAuth, CASHIER_EMAIL, PASSWORD);
  const uid = fbAuth.currentUser;
  if (!uid) throw new Error('cashier sign-in failed');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid.uid), {
      email: CASHIER_EMAIL,
      role: 'cashier',
    });
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

describe('REV1-2 T2.2 — the six writers persist dust (raw code)', () => {
  it('sale-dust: credit total 0.1+0.2 on balance 0 stores 0.30000000000000004, not 0.3', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-p1', { name: 'صنف غبار', quantity: 100, price: 0.1 });
    await seed('products', 'dust-p2', { name: 'صنف غبار', quantity: 100, price: 0.2 });
    await seed('dailyArchives', 'dust-day', mkArchive());
    await seed('customers', 'dust-cust', { name: 'عميل غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processSale({
      items: [dustItem('dust-p1', 0.1), dustItem('dust-p2', 0.2)],
      subtotal: 0.1 + 0.2,
      discount: 0,
      total: 0.1 + 0.2,
      paymentMethod: PaymentMethod.Credit,
      customerId: 'dust-cust',
      dailyArchiveId: 'dust-day',
    });
    // Literal cents: 30/100. Raw stores 0.30000000000000004.
    expect(await readBalance('customers', 'dust-cust')).toBe(0.3);
  });

  it('return-dust: on-account return 0.1+0.2 on balance 0 stores -0.30000000000000004, not -0.3', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-rp1', { name: 'صنف غبار', quantity: 100, price: 0.1 });
    await seed('products', 'dust-rp2', { name: 'صنف غبار', quantity: 100, price: 0.2 });
    await seed('dailyArchives', 'dust-rday', mkArchive());
    await seed('customers', 'dust-rcust', { name: 'عميل غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processReturn(
      [dustItem('dust-rp1', 0.1), dustItem('dust-rp2', 0.2)],
      'dust-rday',
      { id: 'dust-rcust', name: 'عميل غبار' },
    );
    expect(await readBalance('customers', 'dust-rcust')).toBe(-0.3);
  });

  it('payment-cust-dust (dusty-input): amount 0.1+0.2 on balance 0 stores -0.30000000000000004, not -0.3', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'dust-pcust', { name: 'عميل غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addCustomerPayment({ customerId: 'dust-pcust', amount: 0.1 + 0.2 });
    expect(await readBalance('customers', 'dust-pcust')).toBe(-0.3);
  });

  it('payment-sup-dust (dusty-input): amount 0.1+0.2 on balance 0 stores -0.30000000000000004, not -0.3', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'dust-psup', { name: 'مورد غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addSupplierPayment({ supplierId: 'dust-psup', amount: 0.1 + 0.2 });
    expect(await readBalance('suppliers', 'dust-psup')).toBe(-0.3);
  });

  it('payment-cust-cents: balance 0.3 paid 0.1 stores exactly 0.2', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'dust-ccust', { name: 'عميل غبار', balance: 0.3, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addCustomerPayment({ customerId: 'dust-ccust', amount: 0.1 });
    // Literal cents: 30-10 = 20 ⇒ 0.2. Raw: 0.3-0.1 = 0.19999999999999998.
    expect(await readBalance('customers', 'dust-ccust')).toBe(0.2);
  });

  it('payment-sup-cents: balance 0.3 paid 0.1 stores exactly 0.2', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'dust-csup', { name: 'مورد غبار', balance: 0.3, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addSupplierPayment({ supplierId: 'dust-csup', amount: 0.1 });
    expect(await readBalance('suppliers', 'dust-csup')).toBe(0.2);
  });

  it('purchase-dust: total 0.1+0.2 on balance 0 stores 0.30000000000000004, not 0.3', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-pp1', { name: 'صنف غبار', quantity: 100, price: 0.1 });
    await seed('products', 'dust-pp2', { name: 'صنف غبار', quantity: 100, price: 0.2 });
    await seed('suppliers', 'dust-psup2', { name: 'مورد غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processPurchase({
      items: [dustItem('dust-pp1', 0.1), dustItem('dust-pp2', 0.2)],
      subtotal: 0.1 + 0.2,
      total: 0.1 + 0.2,
      supplierId: 'dust-psup2',
    });
    expect(await readBalance('suppliers', 'dust-psup2')).toBe(0.3);
  });

  it('supplier-return-dust: return 0.1+0.2 on balance 0 stores -0.30000000000000004, not -0.3', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-srp', { name: 'صنف غبار', quantity: 100, price: 0.1 });
    await seed('products', 'dust-srp2', { name: 'صنف غبار', quantity: 100, price: 0.2 });
    await seed('suppliers', 'dust-srsup', { name: 'مورد غبار', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processSupplierReturn(
      [dustItem('dust-srp', 0.1), dustItem('dust-srp2', 0.2)],
      'dust-srsup',
    );
    expect(await readBalance('suppliers', 'dust-srsup')).toBe(-0.3);
  });
});

describe('REV1-2 T2.2 — AC-2.4 settlement (cents literals)', () => {
  const P19 = 19.99;
  const P33 = 33.33;
  const P10 = 10.1;
  const P7 = 7.7;
  // Cents math: 1999+3333+1010+770 = 7112 ⇒ 71.12. Written as literal.
  const TOTAL = 71.12;

  async function seedAc24(tag: string) {
    await testEnv.clearFirestore();
    await seed('products', `${tag}-a`, { name: 'صنف', quantity: 100, price: P19 });
    await seed('products', `${tag}-b`, { name: 'صنف', quantity: 100, price: P33 });
    await seed('products', `${tag}-c`, { name: 'صنف', quantity: 100, price: P10 });
    await seed('products', `${tag}-d`, { name: 'صنف', quantity: 100, price: P7 });
    await seed('dailyArchives', `${tag}-day`, mkArchive());
    await seed('customers', `${tag}-cust`, { name: 'عميل', balance: 0, openingBalance: 0, createdAt: 1 });
    await signInCashier();
  }

  function ac24Items(tag: string): CartItem[] {
    return [
      dustItem(`${tag}-a`, P19),
      dustItem(`${tag}-b`, P33),
      dustItem(`${tag}-c`, P10),
      dustItem(`${tag}-d`, P7),
    ];
  }

  async function ac24Sale(tag: string) {
    await processSale({
      items: ac24Items(tag),
      subtotal: P19 + P33 + P10 + P7,
      discount: 0,
      total: P19 + P33 + P10 + P7,
      paymentMethod: PaymentMethod.Credit,
      customerId: `${tag}-cust`,
      dailyArchiveId: `${tag}-day`,
    });
  }

  it('single-payment: 19.99+33.33+10.1+7.7 credit then one 71.12 payment ⇒ stored === 0', async () => {
    await seedAc24('ac24s');
    await ac24Sale('ac24s');
    await addCustomerPayment({ customerId: 'ac24s-cust', amount: TOTAL });
    const bal = await readBalance('customers', 'ac24s-cust');
    expect(bal === 0).toBe(true);
  });

  it('split-payments: same sale then literal 53.32 and 17.8 ⇒ stored === 0', async () => {
    // Literals (cents: 5332/100, 1780/100). Dusty-input settlement is
    // already covered by the single-payment twin (computed total) and the
    // six writer tests, so no dusty-input variant is kept here.
    await seedAc24('ac24p');
    await ac24Sale('ac24p');
    await addCustomerPayment({ customerId: 'ac24p-cust', amount: 53.32 });
    await addCustomerPayment({ customerId: 'ac24p-cust', amount: 17.8 });
    const bal = await readBalance('customers', 'ac24p-cust');
    expect(bal === 0).toBe(true);
  });
});

describe('REV1-2 T2.2 — missing balance, kept creditor, kept negative', () => {
  it('missing-balance: credit sale on a customer doc WITHOUT balance stores finite 100, never NaN', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-mprod', { name: 'صنف', quantity: 100, price: 100 });
    await seed('dailyArchives', 'dust-mday', mkArchive());
    await seed('customers', 'dust-mcust', { name: 'عميل بلا رصيد', openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processSale({
      items: [dustItem('dust-mprod', 100)],
      subtotal: 100,
      discount: 0,
      total: 100,
      paymentMethod: PaymentMethod.Credit,
      customerId: 'dust-mcust',
      dailyArchiveId: 'dust-mday',
    });
    const bal = await readBalance('customers', 'dust-mcust');
    expect(Number.isFinite(bal)).toBe(true);
    expect(bal).toBe(100);
  });

  it('payment-cust-missing-balance: 100 on a customer doc WITHOUT balance stores exactly -100 (finite)', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'dust-mpcust', { name: 'عميل بلا رصيد', openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addCustomerPayment({ customerId: 'dust-mpcust', amount: 100 });
    const bal = await readBalance('customers', 'dust-mpcust');
    expect(Number.isFinite(bal)).toBe(true);
    expect(bal).toBe(-100);
  });

  it('payment-sup-missing-balance: 100 on a supplier doc WITHOUT balance stores exactly -100 (finite)', async () => {
    await testEnv.clearFirestore();
    await seed('suppliers', 'dust-mpsup', { name: 'مورد بلا رصيد', openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addSupplierPayment({ supplierId: 'dust-mpsup', amount: 100 });
    const bal = await readBalance('suppliers', 'dust-mpsup');
    expect(Number.isFinite(bal)).toBe(true);
    expect(bal).toBe(-100);
  });

  it('creditor-kept: balance 0.01 paid 0.02 stays exactly -0.01 (Sterbenz-exact, must never be swallowed)', async () => {
    await testEnv.clearFirestore();
    await seed('customers', 'dust-ccust', { name: 'عميل', balance: 0.01, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await addCustomerPayment({ customerId: 'dust-ccust', amount: 0.02 });
    // 0.01-0.02 is exact by Sterbenz (0.01 ≤ 0.02 ≤ 2×0.01): GREEN already.
    expect(await readBalance('customers', 'dust-ccust')).toBe(-0.01);
  });

  it('negative-fractional-persists: balance 0.05 minus dusty 0.3 return stores exactly -0.25 (still negative)', async () => {
    await testEnv.clearFirestore();
    await seed('products', 'dust-np1', { name: 'صنف غبار', quantity: 100, price: 0.1 });
    await seed('products', 'dust-np2', { name: 'صنف غبار', quantity: 100, price: 0.2 });
    await seed('dailyArchives', 'dust-nday', mkArchive());
    await seed('customers', 'dust-ncust', { name: 'عميل', balance: 0.05, openingBalance: 0, createdAt: 1 });
    await signInCashier();

    await processReturn(
      [dustItem('dust-np1', 0.1), dustItem('dust-np2', 0.2)],
      'dust-nday',
      { id: 'dust-ncust', name: 'عميل' },
    );
    // Raw: 0.05 - 0.30000000000000004 ≈ -0.25000000000000006 ≠ -0.25.
    expect(await readBalance('customers', 'dust-ncust')).toBe(-0.25);
  });
});

const BALANCE_RAW_PATTERNS = [
  /(?:^|[^.\w])(balance|liveBalance)\s*(>=|<=|>|<|===|!==|==|!=)\s*0(?![\d.])/,
  /(customer\.balance|supplier\.balance)\s*(!==|===|==|!=)\s*0/,
];

function lineNeedsSettled(text: string): boolean {
  return BALANCE_RAW_PATTERNS.some((re) => re.test(text));
}

describe('REV1-2 T2.2 — no raw balance comparisons in the four pages', () => {
  it('every raw balance-vs-0 comparison shares its line with isSettled( (incl. footers 483/494)', () => {
    const files = [
      '../pages/CustomersPage.tsx',
      '../pages/SuppliersPage.tsx',
      '../pages/CustomerAccountPage.tsx',
      '../pages/SupplierAccountPage.tsx',
    ];
    const bad: Array<{ file: string; line: number; text: string }> = [];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), 'utf8').split('\n');
      src.forEach((text, i) => {
        if (lineNeedsSettled(text) && text.indexOf('isSettled(') < 0) {
          bad.push({ file: f, line: i + 1, text: text.trim() });
        }
      });
    }
    // Raw code: all 10 plan-listed sites (CustomersPage 86,87,223 ·
    // SuppliersPage 86,87,224 · CustomerAccountPage 567,568,483 ·
    // SupplierAccountPage 582,583,494) lack isSettled( on their line.
    expect(bad).toEqual([]);
  });

  it('static-check self-test: guarded lines pass, unguarded lines fail (rule is not blind)', () => {
    const guarded = "const t = isSettled(balance) ? 'x' : balance > 0 ? 'y' : 'z';";
    const unguarded = "const t = balance > 0 ? 'y' : 'z';";
    const guardedOk = !lineNeedsSettled(guarded) || guarded.indexOf('isSettled(') >= 0;
    const unguardedOk = !lineNeedsSettled(unguarded) || unguarded.indexOf('isSettled(') >= 0;
    expect(guardedOk).toBe(true);
    expect(unguardedOk).toBe(false);
  });
});
