// P0-VERIFY-9 — zero-price survey on EMULATOR test data only (never production).
// Seeds products with healthy / partial-zero / all-zero prices, then counts them.
// Run: firebase emulators:exec --only firestore,auth "npx vitest run tests/p0ZeroPriceSurvey.test.ts"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

const PRICE_FIELDS = ['price', 'retailCashPrice', 'retailCreditPrice', 'wholesaleCashPrice', 'wholesaleCreditPrice'];

describe('P0-VERIFY-9 zero-price survey (emulator only)', () => {
  it('S1 seed 6 products and count zero-price shapes', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const mk = (prices: Record<string, number>) => ({
        name: 'صنف', code: 'C', categoryId: 'cat', quantity: 10, ...prices,
      });
      await setDoc(doc(db, 'products', 's-healthy'), mk({ price: 100, retailCashPrice: 100, retailCreditPrice: 100, wholesaleCashPrice: 100, wholesaleCreditPrice: 100 }));
      await setDoc(doc(db, 'products', 's-partial1'), mk({ price: 100, retailCashPrice: 0, retailCreditPrice: 0, wholesaleCashPrice: 0, wholesaleCreditPrice: 0 }));
      await setDoc(doc(db, 'products', 's-partial2'), mk({ price: 100, wholesaleCashPrice: 0 }));
      await setDoc(doc(db, 'products', 's-allzero'), mk({ price: 0, retailCashPrice: 0, retailCreditPrice: 0, wholesaleCashPrice: 0, wholesaleCreditPrice: 0 }));
      await setDoc(doc(db, 'products', 's-nokeys'), { name: 'صنف', code: 'C', categoryId: 'cat', quantity: 10 });
      await setDoc(doc(db, 'products', 's-neg'), mk({ price: -5 }));
    });
    let snap: any = undefined;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      snap = await getDocs(collection(ctx.firestore(), 'products'));
    });
    let allZero = 0, partialZero = 0, healthy = 0, noKeys = 0, invalid = 0;
    snap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const present = PRICE_FIELDS.filter((f) => typeof data[f] === 'number');
      if (present.length === 0) { noKeys++; return; }
      const vals = present.map((f) => data[f]);
      if (vals.some((v) => !(v > 0))) {
        if (vals.every((v) => v === 0)) allZero++;
        else if (vals.some((v) => v < 0) || vals.some((v) => typeof v !== 'number')) invalid++;
        else partialZero++;
      } else healthy++;
    });
    console.log(`SURVEY emulator: total=${snap.size} healthy=${healthy} partialZero=${partialZero} allZero=${allZero} noKeys=${noKeys} invalid=${invalid}`);
    expect(snap.size).toBe(6);
    expect(healthy).toBe(1);
    expect(partialZero).toBe(2);
    expect(allZero).toBe(1);
    expect(noKeys).toBe(1);
    expect(invalid).toBe(1);
  });
});
