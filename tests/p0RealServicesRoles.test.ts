// P0-VERIFY-SVC — real service paths through the NEW ledger rules, per role.
// Calls the actual services (processSale/processReturn/processPurchase/
// addCustomerPayment/addSupplierPayment/processSupplierReturn) as
// cashier, supervisor and admin on the emulator. All must succeed: the
// services write serverTimestamp() + full key sets (sales.ts:153-159,
// returns.ts:215-224, purchases.ts:138-147+263-271, customers.ts:181,
// suppliers.ts:180), which shapeOk accepts.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0RealServicesRoles.test.ts"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// tests/setup.ts already mocks react-hot-toast + connects singletons to emulators.
const {
  processSale, processReturn, processPurchase,
  addCustomerPayment, addSupplierPayment, processSupplierReturn,
} = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';
const PASSWORD = 'secret123';
const ROLES = ['cashier', 'supervisor', 'admin'] as const;
const emailOf = (r: string) => `svc-p0-${r}@test.local`;

const PRICE = 100;
function mkProduct() {
  return {
    name: 'صنف حقيقي', code: 'REAL1', quantity: 1000, price: PRICE,
    retailCashPrice: PRICE, retailCreditPrice: PRICE,
    wholesaleCashPrice: PRICE, wholesaleCreditPrice: PRICE,
    categoryId: 'cat1',
  };
}
const mkArchive = () => ({
  startTime: Date.now(), status: 'open',
  totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0,
  totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0,
  totalReturnsOnAccount: 0,
});
const saleItem = () => ({ id: 'real-prod', name: 'صنف حقيقي', buyQuantity: 2, price: PRICE, priceType: 'retail' }) as any;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  for (const r of ROLES) {
    try { await createUserWithEmailAndPassword(fbAuth, emailOf(r), PASSWORD); }
    catch (e: any) { if (String(e?.code).indexOf('email-already-in-use') < 0) throw e; }
  }
});
afterAll(async () => { await testEnv.cleanup(); });

async function signInAs(role: string) {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  await signInWithEmailAndPassword(fbAuth, emailOf(role), PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { email: emailOf(role), role });
  });
}

async function seedAll() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products', 'real-prod'), mkProduct());
    await setDoc(doc(db, 'customers', 'real-cust'), { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await setDoc(doc(db, 'suppliers', 'real-sup'), { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await setDoc(doc(db, 'dailyArchives', 'real-day'), mkArchive());
  });
}

async function count(col: string) {
  return (await getDocs(collection(getDB(), col))).size;
}

describe('P0-VERIFY-SVC real services pass new rules per role', () => {
  for (const role of ROLES) {
    it(`SVC ${role}: sale+payment+return+purchase+suppay+supret all succeed`, async () => {
      await testEnv.clearFirestore();
      await seedAll();
      await signInAs(role);

      await processSale({
        items: [saleItem()], subtotal: 200, discount: 0, total: 200,
        paymentMethod: 'نقدا' as any, dailyArchiveId: 'real-day',
      } as any);
      expect(await count('invoices')).toBe(1);

      await addCustomerPayment({ customerId: 'real-cust', amount: 50, notes: 'تحصيل' } as any);
      expect(await count('customerPayments')).toBe(1);

      await processReturn([{ ...saleItem(), buyQuantity: 1 }], 'real-day');
      expect(await count('returns')).toBe(1);

      await processPurchase({
        items: [{ ...saleItem(), buyQuantity: 5 }], subtotal: 500, total: 500, supplierId: 'real-sup',
      } as any);
      expect(await count('purchaseInvoices')).toBe(1);

      await addSupplierPayment({ supplierId: 'real-sup', amount: 60, notes: 'سداد' } as any);
      expect(await count('supplierPayments')).toBe(1);

      await processSupplierReturn([{ ...saleItem(), buyQuantity: 1 }], 'real-sup');
      expect(await count('supplierReturns')).toBe(1);
    });
  }
});
