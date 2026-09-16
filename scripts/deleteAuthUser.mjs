// AUDIT-SEC-2c — سكريبت إداري لحذف حساب Firebase Auth اليتيم (يدوي فقط).
//
// لماذا هذا السكريبت منفصل؟ services/api.ts → deleteUser() يحذف مستند
// users/{uid} من Firestore فقط، ولا يقدر يحذف حساب Auth بتاع مستخدم تاني
// من الـ client SDK (قيد من Firebase نفسه، مش خطأ في الكود). هذا السكريبت
// لا يُستدعى من الواجهة إطلاقًا — يُشغَّل يدويًا بـ Node.js فقط.
//
// الاستخدام:
//   node scripts/deleteAuthUser.mjs <uid-or-email>
//
// المتطلب:
//   متغير بيئة FIREBASE_SERVICE_ACCOUNT_KEY_PATH يشاور على مسار ملف
//   service account JSON (المسار، مش محتوى الملف كنص)، والملف يُنزَّل من:
//   Firebase Console → Project Settings → Service Accounts →
//   Generate New Private Key.
//
// تحذير:
//   ملف مفتاح service account مايتحطش في المشروع ولا يتعمله commit إطلاقًا —
//   أخطر من أي API key تاني في المشروع لأنه بيدي صلاحيات إدارية كاملة على
//   المشروع بالكامل (Auth + Firestore + كل حاجة).

import admin from "firebase-admin";
import { existsSync, readFileSync } from "node:fs";
import readline from "node:readline";

console.warn("⚠️  هذا السكريبت يحذف حساب Auth نهائيًا. تأكد إن مستند users/{uid} في Firestore محذوف بالفعل عبر واجهة التطبيق (Delete User) قبل تشغيله.");

const identifier = process.argv[2];

if (!identifier) {
  console.error("Usage: node scripts/deleteAuthUser.mjs <uid-or-email>");
  process.exit(1);
}

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

if (!keyPath) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_KEY_PATH env var first (path to a service account JSON file on disk, never the key content).");
  process.exit(1);
}

if (!existsSync(keyPath)) {
  console.error(`FIREBASE_SERVICE_ACCOUNT_KEY_PATH file not found: ${keyPath}`);
  process.exit(1);
}

function askConfirmation(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  try {
    const userRecord = identifier.includes("@")
      ? await admin.auth().getUserByEmail(identifier)
      : await admin.auth().getUser(identifier);

    console.log("User found:");
    console.log(`  uid: ${userRecord.uid}`);
    console.log(`  email: ${userRecord.email}`);
    console.log(`  disabled: ${userRecord.disabled}`);
    console.log(`  creationTime: ${userRecord.metadata.creationTime}`);

    const answer = await askConfirmation('للتأكيد اكتب "yes" حرفيًا ثم Enter (أي شيء آخر = إلغاء): ');

    if (answer !== "yes") {
      console.log("تم الإلغاء");
      process.exit(0);
    }

    await admin.auth().deleteUser(userRecord.uid);
    console.log(`تم حذف حساب Auth بنجاح — uid: ${userRecord.uid} email: ${userRecord.email}`);
    process.exit(0);
  } catch (e) {
    console.error(e?.code || "", e?.message || e);
    process.exit(1);
  }
}

main();
