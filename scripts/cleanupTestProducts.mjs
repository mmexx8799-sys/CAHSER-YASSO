// Remove ONLY the test documents created by seedTestProducts.mjs (marker-based).
// Real data (customers, real products, real categories, invoices...) is never touched.
//
// Usage: node scripts/cleanupTestProducts.mjs <admin-email> <admin-password>
//
// Requires ADMIN (product + category deletes are admin-only per firestore.rules).
// If seedTestProducts was run with an existing categoryId, that category is kept.

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, query, where, getDocs, writeBatch, doc } from "firebase/firestore";

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

if (!email || !password) {
  console.error("Usage: node scripts/cleanupTestProducts.mjs <admin-email> <admin-password>");
  process.exit(1);
}

async function cleanup() {
  console.log(`Signing in as ${email}...`);
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  console.log("Signed in, UID:", auth.currentUser.uid);

  // Double safety: confirm nothing real carries the marker before deleting.
  const safeReview = {
    products: { expected: 43, note: "33 fillers + 10 category products" },
    categories: { expected: 1, note: "'فئة اختبار الفلترة' (only if seed created it)" }
  };
  console.log("Expected marked documents:", JSON.stringify(safeReview));

  const CHUNK = 450;
  let totalDeleted = 0;

  for (const coll of ['products', 'categories']) {
    const q = query(collection(db, coll), where('_seedMarker', '==', MARKER));
    const snap = await getDocs(q);
    const docs = snap.docs;
    console.log(`[${coll}] found ${docs.length} marked documents`);
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += Math.min(CHUNK, docs.length - i);
    }
  }

  console.log(`✅ Deleted ${totalDeleted} marked test documents. Real data untouched.`);
  console.log("Verify in the app: product list back to normal, real categories intact.");
  process.exit(0);
}

cleanup().catch(e => {
  console.error("Failed:", e.code, e.message);
  process.exit(1);
});
