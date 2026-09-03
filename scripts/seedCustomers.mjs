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

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node scripts/seedCustomers.mjs <email> <password>");
  console.error("Example: node scripts/seedCustomers.mjs izatadel007@gmail.com YOUR_PASSWORD");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const names = ['أحمد','محمد','علي','حسن','فاطمة','مريم','يوسف','إبراهيم','خديجة','عائشة','عمر','حسين','سارة','نور','ليلى','كريم','ياسر','طارق','ريم','دينا','سامر','هالة','وليد','غادة','باسم','نادر','سلمى','رامي','لمياء','خالد','منى','فيصل','دلال','ماجد','هدى','أنس','رنا','بكر','رغد','نبيل','سهام','وسيم','هيا','عادل','شيماء','فهد','لمى','رشا','حمد','تهاني','صالح','عزيزة','محمود','فوزية','سعد','حليمة','مجدي','ثريا','جميلة'];

async function seed() {
  console.log(`Signing in as ${email}...`);
  await signInWithEmailAndPassword(auth, email, password);
  console.log("Signed in, UID:", auth.currentUser.uid);

  const batch = writeBatch(db);
  names.forEach((name, i) => {
    const ref = doc(collection(db, 'customers'));
    batch.set(ref, {
      name: name,
      phone: `0100${String(1000000 + i).padStart(7, '0')}`,
      balance: Math.floor(Math.random() * 1000),
      createdAt: Date.now()
    });
  });
  await batch.commit();
  console.log(`✅ Added ${names.length} customers`);
  process.exit(0);
}

seed().catch(e => {
  console.error("Failed:", e.code, e.message);
  process.exit(1);
});
