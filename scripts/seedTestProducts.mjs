// Seed marked test products to verify the server-side category filter fix (commit bddf430).
//
// Usage:  node scripts/seedTestProducts.mjs <admin-email> <admin-password> [existingCategoryId]
//
// Requires the ADMIN account (category create + product create both needed; cleanup needs
// admin too because product/category delete is admin-only per firestore.rules).
//
// What it creates (ALL documents carry _seedMarker so cleanupTestProducts.mjs can remove
// ONLY these, never real data):
//   1. A test category "فئة اختبار الفلترة" (unless an existing categoryId is passed).
//   2. 33 filler products whose names start with digits ("01 حشو اختبار"...) - digits sort
//      before ALL Arabic text in Firestore (UTF-8 codepoint order), so these 33 occupy the
//      first 30 global alphabetical positions. This reproduces the exact precondition of
//      the old bug: category products could never appear in the first 30 global results.
//   3. 10 products in the test category: 6 starting with early letters (أ ب ت ث ج ح) plus
//      "ويجر أزرق", "ويجر أحمر", "يوسفي طازج", "يوسفي بلدي" (و/ي = last Arabic letters).
//      With the OLD client-side filter these showed as "لا يوجد منتجات" (global first 30
//      = all digit fillers, none in category). With the FIX they appear on the category's
//      FIRST page immediately.
//
// Verification test after seeding (on the LIVE deployment):
//   Open POS or Products page -> filter by "فئة اختبار الفلترة"
//   -> you must see all 10 products INCLUDING "يوسفي ..." and "ويجر ..." right away.
//   Watch F12 console for any "The query requires an index" error (should be none).
//
// Cleanup: node scripts/cleanupTestProducts.mjs <admin-email> <admin-password>
// Do NOT use the in-app factory reset - it wipes ALL business data (customers, archives...).

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, doc, writeBatch } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDkP4sNYxHkVffXADVdunXU0iDxlXAWuDE",
  authDomain: "casher-yasoo.firebaseapp.com",
  projectId: "casher-yasoo",
  storageBucket: "casher-yasoo.firebasestorage.app",
  messagingSenderId: "285707912161",
  appId: "1:285707912161:web:fcda41b3d68bc8dbc7c8a0"
};

const MARKER = "TEST-SEED-2026-09";

const email = process.argv[2];
const password = process.argv[3];
const existingCategoryId = process.argv[4] || null;

if (!email || !password) {
  console.error("Usage: node scripts/seedTestProducts.mjs <admin-email> <admin-password> [existingCategoryId]");
  process.exit(1);
}

// Verbatim copy of the app's searchableIndex generation (api.ts normalizeArabic,
// ProductsPage.tsx generatePrefixes) so search behaves identically to production.
const normalizeArabic = (str) => {
  if (!str) return '';
  return str
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .toLowerCase();
};

const generatePrefixes = (word) => {
  const prefixes = [];
  for (let i = 2; i <= word.length; i++) {
    prefixes.push(word.slice(0, i));
  }
  return prefixes;
};

const buildSearchableIndex = (name, code) => {
  const nameTokens = normalizeArabic(name).split(' ').filter(Boolean);
  const codeToken = normalizeArabic(code);
  return [...new Set([
    ...nameTokens.flatMap(t => generatePrefixes(t)),
    ...generatePrefixes(codeToken)
  ])];
};

const makeProduct = (name, code, categoryId, quantity, price) => ({
  name,
  code,
  categoryId,
  quantity,
  price,
  createdAt: Date.now(),
  searchableIndex: buildSearchableIndex(name, code),
  _seedMarker: MARKER
});

async function seed() {
  console.log(`Signing in as ${email}...`);
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  console.log("Signed in, UID:", auth.currentUser.uid);

  let categoryId = existingCategoryId;

  if (!categoryId) {
    const catRef = doc(collection(db, 'categories'));
    categoryId = catRef.id;
    console.log("Creating test category:", categoryId);
    const catBatch = writeBatch(db);
    catBatch.set(catRef, { name: 'فئة اختبار الفلترة', _seedMarker: MARKER });
    await catBatch.commit();
  } else {
    console.log("Using existing category:", categoryId, "(it will NOT be deleted during cleanup)");
  }

  // 33 digit-first fillers: occupy global alphabetical positions 1-33.
  const fillers = [];
  for (let i = 1; i <= 33; i++) {
    fillers.push(makeProduct(
      `${String(i).padStart(2, '0')} حشو اختبار`,
      `S${String(i).padStart(3, '0')}`,
      '', 5, 10
    ));
  }

  // 10 category products: 6 early letters + و + ي targets.
  const categoryProducts = [
    makeProduct('أرز مصري اختبار', 'T001', categoryId, 20, 30),
    makeProduct('بصل أحمر اختبار', 'T002', categoryId, 15, 10),
    makeProduct('تمر سيوي اختبار', 'T003', categoryId, 12, 50),
    makeProduct('ثوم بلدي اختبار', 'T004', categoryId, 8, 25),
    makeProduct('جبن رومي اختبار', 'T005', categoryId, 6, 60),
    makeProduct('حلويات شرقية اختبار', 'T006', categoryId, 9, 15),
    makeProduct('ويجر أزرق اختبار', 'T007', categoryId, 4, 45),
    makeProduct('ويجر أحمر اختبار', 'T008', categoryId, 3, 45),
    makeProduct('يوسفي طازج اختبار', 'T009', categoryId, 18, 20),
    makeProduct('يوسفي بلدي اختبار', 'T010', categoryId, 11, 20)
  ];

  const batch = writeBatch(db);
  [...fillers, ...categoryProducts].forEach(p => {
    batch.set(doc(collection(db, 'products')), p);
  });
  await batch.commit();

  console.log(`✅ Seeded ${fillers.length} fillers + ${categoryProducts.length} category products (marker: ${MARKER})`);
  console.log("");
  console.log("TEST NOW (live site):");
  console.log("  1. Open POS/Products -> category filter -> 'فئة اختبار الفلترة'");
  console.log("  2. 'يوسفي ...' and 'ويجر ...' products MUST appear on the FIRST page.");
  console.log("  3. F12 console: no 'The query requires an index' errors.");
  console.log("");
  console.log("CLEANUP: node scripts/cleanupTestProducts.mjs <admin-email> <admin-password>");
  process.exit(0);
}

seed().catch(e => {
  console.error("Failed:", e.code, e.message);
  console.error("Note: category creation and product deletion require the ADMIN account (firestore.rules).");
  process.exit(1);
});
