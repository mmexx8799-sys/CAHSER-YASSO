// REQ-PERM-2 — rules tests for per-user capability overrides (Emulator)
// (1) characterization قبل تعديل القواعد: سُجّل أخضر على القواعد القديمة (المالك يحدّث وثيقة بلا role بنجاح) — يبقى هنا ليثبت عدم التغير بعده.
// (2) لكل قدرة طبقة A: حامل ⇒ ينجح · حامل+منع ⇒ يفشل · غير حامل ⇒ يفشل · غير حامل+منح ⇒ ينجح (حيث يقبل الدور المنح) · منح+منع ⇒ يفشل.
// (3) عزل + تصعيد + INV-9 (ومراياه الثلاث) + D-P7 بدوال api.ts الحقيقية.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { UserRole } from '../types';

// tests/setup.ts already mocks react-hot-toast + connects app singletons to emulators.
const { processSale, processReturn, addCustomerPayment, processPurchase, processSupplierReturn, addSupplierPayment, updateCustomerProfile, updateSupplierProfile } = await import('../services/api');
const { getDB, getAuthInstance } = await import('../services/firebase');
import { signOut as firebaseSignOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

let testEnv: RulesTestEnvironment;
const PROJECT_ID = 'casher-yasoo';
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

async function seedRaw(uid: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}
async function seedDoc(col: string, id: string, data: any) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data);
  });
}
function userDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}
const PROD_SEED = { name: 'منتج', code: 'C1', quantity: 50, price: 10, categoryId: 'cat1', searchableIndex: [] };
const ARCH_SEED = { status: 'open', startTime: Date.now(), totalSales: 0, totalReturns: 0, totalCash: 0, totalCredit: 0, totalVodafoneCash: 0, totalInstapay: 0, totalReturnsCash: 0, totalReturnsOnAccount: 0 };

// Representative write per Layer-A capability
async function doCapOp(db: any, cap: string): Promise<void> {
  switch (cap) {
    case 'sell': await setDoc(doc(db, 'invoices', 'p2-inv'), { total: 100, subtotal: 100, items: [] }); return;
    case 'return': await setDoc(doc(db, 'returns', 'p2-ret'), { total: 50, items: [] }); return;
    case 'customer.payment': await setDoc(doc(db, 'customerPayments', 'p2-cp'), { customerId: 'c1', amount: 10, date: Date.now() }); return;
    case 'supplier.ops': await setDoc(doc(db, 'purchaseInvoices', 'p2-pur'), { total: 200, subtotal: 200, items: [] }); return;
    case 'customer.write': await setDoc(doc(db, 'customers', 'p2-cust'), { name: 'عميل', balance: 0, openingBalance: 0, createdAt: Date.now() }); return;
    case 'supplier.write': await setDoc(doc(db, 'suppliers', 'p2-sup'), { name: 'مورد', balance: 0, openingBalance: 0, createdAt: Date.now() }); return;
    case 'product.create': await setDoc(doc(db, 'products', 'p2-prod'), { ...PROD_SEED }); return;
    case 'product.price': await updateDoc(doc(db, 'products', 'p2-price'), { price: 999 }); return;
    case 'product.delete': await deleteDoc(doc(db, 'products', 'p2-del')); return;
    case 'category.write': await setDoc(doc(db, 'categories', 'p2-cat'), { name: 'تصنيف' }); return;
    case 'settings.write': await setDoc(doc(db, 'appSettings', 'p2-main'), { appName: 'X' }); return;
    case 'archive.open': await setDoc(doc(db, 'dailyArchives', 'p2-day'), { ...ARCH_SEED }); return;
    case 'archive.close': await updateDoc(doc(db, 'dailyArchives', 'p2-close'), { status: 'closed' }); return;
    default: throw new Error('unknown cap ' + cap);
  }
}
async function seedFor(cap: string) {
  if (cap === 'product.price') await seedDoc('products', 'p2-price', { ...PROD_SEED });
  if (cap === 'product.delete') await seedDoc('products', 'p2-del', { ...PROD_SEED });
  if (cap === 'archive.close') await seedDoc('dailyArchives', 'p2-close', { ...ARCH_SEED });
}

describe('PERM-2 characterization — owner updating role-less user doc (pre-rules-change)', () => {
  it('owner updates a role-less doc (sehelly2018-like) — record current behavior', async () => {
    await testEnv.clearFirestore();
    await seedRaw('owner-char', { email: 'owner@t.local', role: UserRole.Owner });
    await seedRaw('norole-char', { email: 'norole@t.local' });
    const db = testEnv.authenticatedContext('owner-char').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'norole-char'), { disabled: false } as any));
    let exists = false;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const s = await getDoc(doc(ctx.firestore(), 'users', 'norole-char'));
      exists = s.exists();
    });
    expect(exists).toBe(true);
  });
});

// cap -> [default holder, default non-holder, grant-eligible non-holder or null when N/A (accountant-blocked)]
const LAYER_A: Record<string, { holder: UserRole; nonHolder: UserRole; grantee: UserRole | null }> = {
  'sell': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'return': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'customer.payment': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'supplier.ops': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'customer.write': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'supplier.write': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'product.create': { holder: UserRole.Cashier, nonHolder: UserRole.Accountant, grantee: null },
  'product.price': { holder: UserRole.Admin, nonHolder: UserRole.Supervisor, grantee: UserRole.Supervisor },
  'product.delete': { holder: UserRole.Admin, nonHolder: UserRole.Supervisor, grantee: UserRole.Supervisor },
  'category.write': { holder: UserRole.Admin, nonHolder: UserRole.Supervisor, grantee: UserRole.Supervisor },
  'settings.write': { holder: UserRole.Admin, nonHolder: UserRole.Supervisor, grantee: UserRole.Supervisor },
  'archive.open': { holder: UserRole.Supervisor, nonHolder: UserRole.Cashier, grantee: UserRole.Cashier },
  'archive.close': { holder: UserRole.Admin, nonHolder: UserRole.Supervisor, grantee: UserRole.Supervisor },
};

describe('PERM-2 Layer-A — grant/deny per capability', () => {
  for (const [cap, r] of Object.entries(LAYER_A)) {
    it(`${cap}: holder ok · holder+deny fail · non-holder fail · grantee ok · grants+denies fail`, async () => {
      // 1) holder default succeeds
      await testEnv.clearFirestore();
      await seedFor(cap);
      await seedRaw(`p2-${cap}-h`, { email: 'h@t.local', role: r.holder });
      await assertSucceeds(doCapOp(userDb(`p2-${cap}-h`), cap));
      // 2) holder + denies fails
      await testEnv.clearFirestore();
      await seedFor(cap);
      await seedRaw(`p2-${cap}-hd`, { email: 'hd@t.local', role: r.holder, capDenies: [cap] });
      await assertFails(doCapOp(userDb(`p2-${cap}-hd`), cap));
      // 3) non-holder default fails
      await testEnv.clearFirestore();
      await seedFor(cap);
      await seedRaw(`p2-${cap}-n`, { email: 'n@t.local', role: r.nonHolder });
      await assertFails(doCapOp(userDb(`p2-${cap}-n`), cap));
      // 4) grantee + grants succeeds (or accountant-blocked stays denied for staff-held caps)
      await testEnv.clearFirestore();
      await seedFor(cap);
      if (r.grantee) {
        await seedRaw(`p2-${cap}-g`, { email: 'g@t.local', role: r.grantee, capGrants: [cap] });
        await assertSucceeds(doCapOp(userDb(`p2-${cap}-g`), cap));
      } else {
        await seedRaw(`p2-${cap}-g`, { email: 'g@t.local', role: r.nonHolder, capGrants: [cap] });
        await assertFails(doCapOp(userDb(`p2-${cap}-g`), cap));
      }
      // 5) grants + denies seeded raw (bypasses write whitelist) -> deny wins at read
      await testEnv.clearFirestore();
      await seedFor(cap);
      await seedRaw(`p2-${cap}-gd`, { email: 'gd@t.local', role: r.holder, capGrants: [cap], capDenies: [cap] });
      await assertFails(doCapOp(userDb(`p2-${cap}-gd`), cap));
    });
  }
});

describe('PERM-2 isolation — grant X does not open Y', () => {
  it('cashier granted product.price can update price but cannot delete product or write categories', async () => {
    await testEnv.clearFirestore();
    await seedDoc('products', 'p2-price', { ...PROD_SEED });
    await seedDoc('products', 'p2-del', { ...PROD_SEED });
    await seedRaw('p2-iso', { email: 'iso@t.local', role: UserRole.Cashier, capGrants: ['product.price'] });
    const db = userDb('p2-iso');
    await assertSucceeds(updateDoc(doc(db, 'products', 'p2-price'), { price: 777 }));
    await assertFails(deleteDoc(doc(db, 'products', 'p2-del')));
    await assertFails(setDoc(doc(db, 'categories', 'p2-iso-cat'), { name: 'x' }));
  });
});

describe('PERM-2 escalation — overrides are owner-only', () => {
  it('cashier/admin cannot write capGrants/capDenies (self or others)', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner', { email: 'o@t.local', role: UserRole.Owner });
    await seedRaw('p2-cash', { email: 'c@t.local', role: UserRole.Cashier });
    await seedRaw('p2-admin', { email: 'a@t.local', role: UserRole.Admin });
    await seedRaw('p2-victim', { email: 'v@t.local', role: UserRole.Cashier });
    const cashDb = userDb('p2-cash');
    await assertFails(updateDoc(doc(cashDb, 'users', 'p2-cash'), { capGrants: ['product.price'] } as any));
    await assertFails(updateDoc(doc(cashDb, 'users', 'p2-victim'), { capGrants: ['product.price'] } as any));
    const adminDb = userDb('p2-admin');
    await assertFails(updateDoc(doc(adminDb, 'users', 'p2-victim'), { capDenies: ['sell'] } as any));
  });
  it('owner writes with stamp succeed; without stamp fail', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner2', { email: 'o2@t.local', role: UserRole.Owner });
    await seedRaw('p2-victim2', { email: 'v2@t.local', role: UserRole.Cashier });
    const db = userDb('p2-owner2');
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim2'), { capGrants: ['product.price'] } as any));
    await assertSucceeds(updateDoc(doc(db, 'users', 'p2-victim2'), {
      capGrants: ['product.price'], permsUpdatedBy: 'p2-owner2', permsUpdatedAt: serverTimestamp(),
    } as any));
  });
  it('whitelist enforced: root/users.manage/ledger.delete rejected; string-instead-of-list rejected; null rejected', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner3', { email: 'o3@t.local', role: UserRole.Owner });
    await seedRaw('p2-victim3', { email: 'v3@t.local', role: UserRole.Cashier });
    const db = userDb('p2-owner3');
    const stamp = { permsUpdatedBy: 'p2-owner3', permsUpdatedAt: serverTimestamp() } as any;
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim3'), { capGrants: ['root'], ...stamp } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim3'), { capGrants: ['users.manage'], ...stamp } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim3'), { capGrants: ['ledger.delete'], ...stamp } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim3'), { capGrants: 'sell', ...stamp } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim3'), { capGrants: null, ...stamp } as any));
  });
  it('owner cannot demote an owner doc: role change owner->cashier fails, email-only update succeeds', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner4', { email: 'o4@t.local', role: UserRole.Owner });
    await seedRaw('p2-owner4b', { email: 'o4b@t.local', role: UserRole.Owner });
    const db = userDb('p2-owner4');
    const stamp = { permsUpdatedBy: 'p2-owner4', permsUpdatedAt: serverTimestamp() } as any;
    await assertFails(updateDoc(doc(db, 'users', 'p2-owner4'), { capGrants: ['sell'], ...stamp } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-owner4'), { capDenies: ['sell'], ...stamp } as any));
    // real demotion attempts
    await assertFails(updateDoc(doc(db, 'users', 'p2-owner4'), { role: 'cashier' } as any));
    await assertFails(updateDoc(doc(db, 'users', 'p2-owner4b'), { role: 'admin' } as any));
    // narrow guard: non-role update on own owner doc still succeeds
    await assertSucceeds(updateDoc(doc(db, 'users', 'p2-owner4'), { email: 'o4-new@t.local' } as any));
  });
  it('accountant cannot be granted sell (INV-3 at write)', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner5', { email: 'o5@t.local', role: UserRole.Owner });
    await seedRaw('p2-acct', { email: 'acct@t.local', role: UserRole.Accountant });
    const db = userDb('p2-owner5');
    const stamp = { permsUpdatedBy: 'p2-owner5', permsUpdatedAt: serverTimestamp() } as any;
    await assertFails(updateDoc(doc(db, 'users', 'p2-acct'), { capGrants: ['sell'], ...stamp } as any));
    await assertSucceeds(updateDoc(doc(db, 'users', 'p2-acct'), { capDenies: ['report.view'], ...stamp } as any));
  });
});

describe('PERM-2 INV-9 — malformed lists fail closed (owner immune)', () => {
  it("cashier holding sell by default with capGrants:'sell' (string) is DENIED; owner with same is ALLOWED", async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-mal1', { email: 'm1@t.local', role: UserRole.Cashier, capGrants: 'sell' as any });
    await assertFails(setDoc(doc(userDb('p2-mal1'), 'invoices', 'm1'), { total: 10, subtotal: 10, items: [] }));
    await seedRaw('p2-mal1o', { email: 'm1o@t.local', role: UserRole.Owner, capGrants: 'sell' as any });
    await assertSucceeds(setDoc(doc(userDb('p2-mal1o'), 'invoices', 'm1o'), { total: 10, subtotal: 10, items: [] }));
  });
  it('cashier with capDenies:123 is DENIED; owner with same is ALLOWED', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-mal2', { email: 'm2@t.local', role: UserRole.Cashier, capDenies: 123 as any });
    await assertFails(setDoc(doc(userDb('p2-mal2'), 'invoices', 'm2'), { total: 10, subtotal: 10, items: [] }));
    await seedRaw('p2-mal2o', { email: 'm2o@t.local', role: UserRole.Owner, capDenies: 123 as any });
    await assertSucceeds(setDoc(doc(userDb('p2-mal2o'), 'invoices', 'm2o'), { total: 10, subtotal: 10, items: [] }));
  });
  it('cashier with capGrants:null is DENIED', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-mal3', { email: 'm3@t.local', role: UserRole.Cashier, capGrants: null as any });
    await assertFails(setDoc(doc(userDb('p2-mal3'), 'invoices', 'm3'), { total: 10, subtotal: 10, items: [] }));
  });
});

describe('PERM-2 characterization 2 — owner sets {disabled:true} on role-less doc (before/after)', () => {
  it('record literal result on current rules', async () => {
    await testEnv.clearFirestore();
    await seedRaw('owner-char2', { email: 'owner2@t.local', role: UserRole.Owner });
    await seedRaw('norole-char2', { email: 'norole2@t.local' });
    const db = testEnv.authenticatedContext('owner-char2').firestore();
    // حرفي: يُسجَّل السلوك كما هو (ناجح أم مرفوض) — قارن مخرج قبل/بعد التعديل
    let outcome = 'unknown';
    try {
      await updateDoc(doc(db, 'users', 'norole-char2'), { disabled: true } as any);
      outcome = 'ALLOWED';
    } catch {
      outcome = 'DENIED';
    }
    // eslint-disable-next-line no-console
    console.log(`[char2] owner sets disabled:true on role-less doc => ${outcome}`);
    expect(['ALLOWED', 'DENIED']).toContain(outcome);
  });
});

describe('PERM-2 pre-deploy (4): editor paths for REQ-PERM-4', () => {
  it('create user doc with both lists: succeeds with valid stamp, fails without', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner6', { email: 'o6@t.local', role: UserRole.Owner });
    const db = userDb('p2-owner6');
    await assertFails(setDoc(doc(db, 'users', 'p2-new1'), {
      email: 'n1@t.local', role: 'cashier', capGrants: ['product.price'], capDenies: ['sell'],
    } as any));
    await assertSucceeds(setDoc(doc(db, 'users', 'p2-new2'), {
      email: 'n2@t.local', role: 'cashier', capGrants: ['product.price'], capDenies: ['sell'],
      permsUpdatedBy: 'p2-owner6', permsUpdatedAt: serverTimestamp(),
    } as any));
  });
  it('stamp with foreign permsUpdatedBy fails', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner7', { email: 'o7@t.local', role: UserRole.Owner });
    await seedRaw('p2-victim7', { email: 'v7@t.local', role: UserRole.Cashier });
    const db = userDb('p2-owner7');
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim7'), {
      capGrants: ['product.price'], permsUpdatedBy: 'someone-else', permsUpdatedAt: serverTimestamp(),
    } as any));
  });
  it('clearing both lists (deleteField) requires stamp', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-owner8', { email: 'o8@t.local', role: UserRole.Owner });
    await seedRaw('p2-victim8', { email: 'v8@t.local', role: UserRole.Cashier, capGrants: ['product.price'], capDenies: ['sell'] });
    const db = userDb('p2-owner8');
    await assertFails(updateDoc(doc(db, 'users', 'p2-victim8'), {
      capGrants: deleteField(), capDenies: deleteField(),
    } as any));
    await assertSucceeds(updateDoc(doc(db, 'users', 'p2-victim8'), {
      capGrants: deleteField(), capDenies: deleteField(),
      permsUpdatedBy: 'p2-owner8', permsUpdatedAt: serverTimestamp(),
    } as any));
  });
  it("admin with capDenies:['customer.write'] still writes {balance} side-effect", async () => {
    await testEnv.clearFirestore();
    await seedDoc('customers', 'p2-adm-cust', { name: 'عميل', phone: '', address: '', balance: 100, openingBalance: 100, createdAt: Date.now() });
    await seedRaw('p2-adm-denied', { email: 'ad@t.local', role: UserRole.Admin, capDenies: ['customer.write'] });
    const db = userDb('p2-adm-denied');
    await assertSucceeds(updateDoc(doc(db, 'customers', 'p2-adm-cust'), { balance: 150 } as any));
    await assertFails(updateDoc(doc(db, 'customers', 'p2-adm-cust'), { name: 'معدل' } as any));
  });
});
describe('PERM-2 permissionAudit — append-only owner log', () => {
  it('owner creates with by/at; others cannot; update/delete never', async () => {
    await testEnv.clearFirestore();
    await seedRaw('p2-aud-o', { email: 'ao@t.local', role: UserRole.Owner });
    await seedRaw('p2-aud-c', { email: 'ac@t.local', role: UserRole.Cashier });
    const ownerDb = userDb('p2-aud-o');
    await assertSucceeds(setDoc(doc(ownerDb, 'permissionAudit', 'a1'), {
      by: 'p2-aud-o', at: serverTimestamp(), targetUid: 'x', before: {}, after: {},
    } as any));
    const cashDb = userDb('p2-aud-c');
    await assertFails(setDoc(doc(cashDb, 'permissionAudit', 'a2'), {
      by: 'p2-aud-c', at: serverTimestamp(), targetUid: 'x', before: {}, after: {},
    } as any));
    await assertFails(updateDoc(doc(ownerDb, 'permissionAudit', 'a1'), { targetUid: 'y' } as any));
    await assertFails(deleteDoc(doc(ownerDb, 'permissionAudit', 'a1')));
  });
});

// --- D-P7 via real api.ts functions (sec1ProfileGuards pattern: real Auth + app singletons) ---
const D7_EMAIL = 'perm2-cashier@test.local';
const D7_PASSWORD = 'secret123';

async function signInD7Cashier() {
  const fbAuth = getAuthInstance();
  try { await firebaseSignOut(fbAuth); } catch { /* not signed in */ }
  try {
    await createUserWithEmailAndPassword(fbAuth, D7_EMAIL, D7_PASSWORD);
  } catch (e: any) {
    if (String(e?.code).indexOf('email-already-in-use') < 0) throw e;
  }
  await signInWithEmailAndPassword(fbAuth, D7_EMAIL, D7_PASSWORD);
  const uid = fbAuth.currentUser!.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { email: D7_EMAIL, role: 'cashier', capDenies: ['customer.write', 'supplier.write'] });
    await setDoc(doc(db, 'dailyArchives', 'perm2-day'), { ...ARCH_SEED });
    await setDoc(doc(db, 'products', 'perm2-prod'), { ...PROD_SEED });
    await setDoc(doc(db, 'customers', 'perm2-cust'), { name: 'عميل D7', phone: '', address: '', balance: 0, openingBalance: 0, createdAt: Date.now() });
    await setDoc(doc(db, 'suppliers', 'perm2-sup'), { name: 'مورد D7', phone: '', address: '', balance: 0, openingBalance: 0, createdAt: Date.now() });
  });
  return uid;
}

describe('PERM-2 D-P7 — side-effect writes pass with customer.write/supplier.write denied; profile writes fail', () => {
  it('six api functions succeed; profile updates fail', async () => {
    await testEnv.clearFirestore();
    await signInD7Cashier();
    const db = getDB();
    const snap = async (col: string, id: string) => (await getDoc(doc(db, col, id))).data() as any;

    await addCustomerPayment({ customerId: 'perm2-cust', amount: 5 } as any);
    expect((await snap('customers', 'perm2-cust')).balance).toBe(-5);

    await processSale({ items: [{ id: 'perm2-prod', name: 'منتج', price: 10, buyQuantity: 1 } as any], subtotal: 10, discount: 0, total: 10, paymentMethod: 'نقدا', dailyArchiveId: 'perm2-day' } as any);

    await processReturn([{ id: 'perm2-prod', name: 'منتج', price: 10, buyQuantity: 1 } as any], 'perm2-day');

    await processPurchase({ items: [{ id: 'perm2-prod', name: 'منتج', price: 10, buyQuantity: 2 } as any], subtotal: 20, total: 20, supplierId: 'perm2-sup' });

    await processSupplierReturn([{ id: 'perm2-prod', name: 'منتج', price: 10, buyQuantity: 1 } as any], 'perm2-sup');

    await addSupplierPayment({ supplierId: 'perm2-sup', amount: 5 } as any);

    await expect(updateCustomerProfile('perm2-cust', { name: 'اسم جديد', phone: '', address: '' })).rejects.toThrow();
    await expect(updateSupplierProfile('perm2-sup', { name: 'اسم جديد', phone: '', address: '' })).rejects.toThrow();
  }, 120000);
  it('affectedKeys nuance (1): {name,balance} together from denied user fails', async () => {
    await testEnv.clearFirestore();
    await signInD7Cashier();
    const db = getDB();
    const { updateDoc: uDoc } = await import('firebase/firestore');
    await expect(uDoc(doc(db, 'customers', 'perm2-cust'), { name: 'x', balance: 999 } as any)).rejects.toThrow();
  });
  it('affectedKeys nuance (2): no-op profile update is allowed and harmless (documented)', async () => {
    await testEnv.clearFirestore();
    await signInD7Cashier();
    const db = getDB();
    const before = ((await getDoc(doc(db, 'customers', 'perm2-cust'))).data() as any).name;
    const { updateDoc: uDoc } = await import('firebase/firestore');
    await uDoc(doc(db, 'customers', 'perm2-cust'), { name: before, phone: '', address: '' } as any);
    const after = ((await getDoc(doc(db, 'customers', 'perm2-cust'))).data() as any).name;
    expect(after).toBe(before);
  });
  it("affectedKeys nuance (3): updateCustomerProfile on customer without address key fails for denied user", async () => {
    await testEnv.clearFirestore();
    await signInD7Cashier();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'customers', 'perm2-noaddr'), { name: 'بلا عنوان', phone: '', balance: 0, openingBalance: 0, createdAt: Date.now() });
    });
    await expect(updateCustomerProfile('perm2-noaddr', { name: 'معدل', phone: '', address: '' })).rejects.toThrow();
  });
});
