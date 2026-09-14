// REQ-P0-14 — LIVE reproduction probe for BUG-P0-14 (diagnostic ONLY).
//
// Question: do fully-concurrent multi-doc transactions get rejected with
// PERMISSION_DENIED on real Firestore (as on the Emulator 5/5), or does the
// live backend retry them (ABORTED → success) as designed?
//
// Usage (credentials via ENVIRONMENT ONLY — never on the command line):
//   $env:REPRO_EMAIL="cashier@test.local"; $env:REPRO_PASSWORD="***"; node scripts/repro-bug-p0-14.mjs "5,10,20" 3
//   (cmd.exe: set REPRO_EMAIL=... && set REPRO_PASSWORD=... && node scripts/...)
//
// What it does (ALL documents are TEST-P0-14-* isolated; never real data):
//   1. Signs in as the given (non-admin) user on the LIVE project.
//   2. Ensures products/TEST-P0-14 exists (large quantity, fixed prices).
//   3. Ensures counters/TEST-P0-14 exists (created with lastNumber=1 on first
//      run per the +1 rule; reused afterwards — gaps are meaningless here).
//   4. For each concurrency level N (default 5,10,20), repeated R rounds
//      (default 3): fires N same-tick runTransaction() calls; each reads the
//      TEST product + TEST counter and writes counter=last+1 plus a
//      quantity-neutral product touch (same value — still a contended write).
//   5. Prints per round: fulfilled / PERMISSION_DENIED / ABORTED / other,
//      the first full error text, and the counter before→after.
//
// Reads firestore.rules or app code? NO — this REQ forbids touching them.
// Writes? ONLY TEST-P0-14-* docs. No cleanup: the TEST docs stay as evidence.
//
// Exit code: 0 if the probe itself ran (even when transactions fail —
// failures are DATA, not script errors); 1 on setup/auth errors.

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, runTransaction,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDkP4sNYxHkVffXADVdunXU0iDxlXAWuDE",
  authDomain: "casher-yasoo.firebaseapp.com",
  projectId: "casher-yasoo",
  storageBucket: "casher-yasoo.firebasestorage.app",
  messagingSenderId: "285707912161",
  appId: "1:285707912161:web:fcda41b3d68bc8dbc7c8a0"
};

const PROD_ID = "TEST-P0-14";
const COUNTER_ID = "TEST-P0-14";

const email = process.env.REPRO_EMAIL;
const password = process.env.REPRO_PASSWORD;
const levels = (process.argv[2] || "5,10,20").split(",").map(Number);
const rounds = Number(process.argv[3] || 3);

if (!email || !password) {
  console.error("Set REPRO_EMAIL and REPRO_PASSWORD env vars first (never pass credentials on the command line).");
  process.exit(1);
}

function classifyError(e) {
  const msg = String(e?.message || e);
  if (e?.code === "permission-denied" || msg.includes("PERMISSION_DENIED")) return "PERMISSION_DENIED";
  if (e?.code === "aborted" || msg.includes("ABORTED")) return "ABORTED";
  return "OTHER:" + (e?.code || "?");
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log(`Signing in as ${email} (LIVE casher-yasoo)...`);
  await signInWithEmailAndPassword(auth, email, password);
  const uid = auth.currentUser.uid;
  console.log("Signed in, UID:", uid);

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    console.error("FATAL: no users/{uid} doc — isActiveUser() will deny everything. Provision the account first.");
    process.exit(1);
  }
  console.log("users/{uid} role:", userSnap.data().role || "(none — cashier path)");
  if (userSnap.data().role === "admin") {
    console.log("WARNING: account IS admin — isAdmin() short-circuits; results won't reflect the cashier path.");
  }

  const prodRef = doc(db, "products", PROD_ID);
  const prodSnap = await getDoc(prodRef);
  if (!prodSnap.exists()) {
    console.log("Creating isolated product", PROD_ID);
    await setDoc(prodRef, {
      code: "C-TEST-P0-14", name: "منتج اختبار تزامن P0-14",
      price: 100, retailCashPrice: 100, retailCreditPrice: 100,
      wholesaleCashPrice: 100, wholesaleCreditPrice: 100,
      quantity: 1000000, categoryId: "cat-1",
      createdAt: Date.now(), searchableIndex: [],
    });
  } else {
    console.log("Isolated product exists, qty:", prodSnap.data().quantity);
  }

  const counterRef = doc(db, "counters", COUNTER_ID);
  const counterSnap = await getDoc(counterRef);
  if (!counterSnap.exists()) {
    console.log("Creating isolated counter", COUNTER_ID, "with lastNumber=1");
    await setDoc(counterRef, { lastNumber: 1 });
  } else {
    console.log("Isolated counter exists, lastNumber:", counterSnap.data().lastNumber);
  }

  // Post-fix version: mirrors runTransactionWithRetry() in services/api.ts
  // (max 4 attempts, jittered 100–400ms backoff, whole-tx rerun). Fidelity
  // note: node cannot import services/api.ts (react-hot-toast/browser init),
  // so the retry SHAPE is duplicated here — the app code itself is covered
  // by the BUG-P0-14c emulator integration test instead.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRYABLE = ["permission-denied", "aborted", "unavailable"];
  const oneTx = async () => {
    let lastErr = null;
    for (let a = 1; a <= 4; a++) {
      try {
        return await runTransaction(db, async (tx) => {
          const [pSnap, cSnap] = await Promise.all([tx.get(prodRef), tx.get(counterRef)]);
          const last = cSnap.exists() ? (cSnap.data().lastNumber || 0) : 0;
          tx.update(counterRef, { lastNumber: last + 1 });
          tx.update(prodRef, { quantity: (pSnap.data()?.quantity || 0) }); // value-neutral, still contended
        });
      } catch (e) {
        lastErr = e;
        if (!RETRYABLE.includes(String(e?.code || "")) || a === 4) throw e;
        await sleep(100 + Math.floor(Math.random() * 300));
      }
    }
    throw lastErr;
  };

  const grand = { fulfilled: 0, PERMISSION_DENIED: 0, ABORTED: 0, OTHER: 0 };

  for (const n of levels) {
    for (let r = 1; r <= rounds; r++) {
      const before = (await getDoc(counterRef)).data().lastNumber;
      const results = await Promise.allSettled(Array.from({ length: n }, oneTx));
      const after = (await getDoc(counterRef)).data().lastNumber;
      const tally = { fulfilled: 0, PERMISSION_DENIED: 0, ABORTED: 0, OTHER: 0 };
      let firstErr = null;
      for (const res of results) {
        if (res.status === "fulfilled") { tally.fulfilled++; continue; }
        const cls = classifyError(res.reason);
        if (cls === "PERMISSION_DENIED") tally.PERMISSION_DENIED++;
        else if (cls === "ABORTED") tally.ABORTED++;
        else tally.OTHER++;
        if (!firstErr) firstErr = String(res.reason?.message || res.reason).slice(0, 1200);
      }
      for (const k of Object.keys(grand)) grand[k] += tally[k];
      console.log(`LEVEL=${n} ROUND=${r} fulfilled=${tally.fulfilled}/${n} PERMISSION_DENIED=${tally.PERMISSION_DENIED} ABORTED=${tally.ABORTED} OTHER=${tally.OTHER} counter ${before}->${after}`);
      if (firstErr) console.log(`  FIRST-ERROR: ${firstErr}`);
    }
  }

  console.log(`GRAND fulfilled=${grand.fulfilled} PERMISSION_DENIED=${grand.PERMISSION_DENIED} ABORTED=${grand.ABORTED} OTHER=${grand.OTHER}`);
  console.log("DONE — TEST-P0-14-* docs intentionally left in place as evidence.");
  process.exit(0);
}

main().catch((e) => {
  console.error("PROBE-SETUP-FAILED:", e?.code || "", String(e?.message || e).slice(0, 500));
  process.exit(1);
});
