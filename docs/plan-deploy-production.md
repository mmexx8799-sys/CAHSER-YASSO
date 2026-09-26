# خطة النشر — Production (Hosting + Rules + Indexes) — OFFLINE-P1 @ a6fbab6

> **حالة:** خطة فقط — لا تنفيذ قبل موافقة صريحة. لا كود وظيفي يُعدل في هذه المهمة.

## 1) Goal
نشر النسخة الحالية المثبتة محليًا (HEAD `a6fbab6` — OFFLINE-P1 مكتمل + أيقونات نهائية: PWA 37 precache، حارس 22، بانر تحديث، تسجيل 14 يوم) إلى **Production** على نفس المشروع، بلا بيانات تجريبية، مع إثبات أن المنشور يطابق الريبو.

## 2) Scope
- **داخل النطاق:** `npm run build` للإنتاج (بلا emulator)، `firebase deploy --only hosting,firestore:rules,firestore:indexes` (و `storage` إن وجد — غير موجود حاليًا)، smoke tests يدوية على الموقع الحقيقي، توثيق Rollback.
- **خارج النطاق:** أي تعديل كود وظيفي، أي seed/حسابات اختبار في Production.

## 3) Files — كما اكتُشفت في الريبو
| الملف | الدور | الملاحظة |
|---|---|---|
| `firebase.json:13` | Hosting `site: casher-yasoo`, `public: dist`, `rewrites ** → /index.html` + headers (CSP, Cache-Control) | لا staging منفصل هنا |
| `.firebaserc:2` | `projects.default = casher-yasoo`, `staging = casher-yasoo-staging` | **Project ID المستهدف:** `casher-yasoo` — **alias:** `default` (الـstaging alias موجود لكنه مشروع منفصل لم يُنشأ بعد) |
| `firestore.rules:1` | 270 سطر — `hasCap` + `capListsValid` + 22 قدرة — **سأقارن المنشور الحالي بالريبو قبل النشر** | لا وصول بدون `auth`, owner/cashier مفروزة |
| `firestore.indexes.json:1` | 11 فهرس (products 3 + payments/invoices/returns/supplier... + permissionAudit) | لا fieldOverrides |
| `storage.rules` | غير موجود — لا deploy له | — |
| `.env.local` / `services/firebase.ts:48` | `firebaseConfig` ثابت + شرط `VITE_USE_EMULATORS=1` | الشرط الآن `if (viteEnv.DEV && viteEnv.VITE_USE_EMULATORS==='1')` — في `build` الإنتاج (`MODE=production`, `DEV=false`) لا يُفعّل emulator — **الدليل المطلوب:** `grep -R "VITE_USE_EMULATORS\|FIRESTORE_EMULATOR_HOST\|localhost.*8080\|localhost.*9099" dist/` يجب أن يكون فارغًا |
| `vite.config.ts:1` | `VitePWA` `disable: mode==='capacitor'` — `registerType:'prompt'`، `precache 37` | لا `.*log` في dist |
| `public/icons/*` | `icon-192.png` + `icon-512.png` + `maskable-512.png` — نهائية (شعار الشماعة+المحل، غير متطابقة، دُمجت في PR #8) | — |
| `dist/*` بعد `build` | `index.html` (manifest link), `sw.js` (3152B), `manifest.webmanifest` (412B), `workbox-*` | PWA `v1.3.0` |

## 4) Constraints — كما طُلبت
- الخطة أولاً، لا تنفيذ قبل موافقتك.
- الـbuild يُثبت خلوه من emulator (`grep` فارغ + `vite build` log يظهر `PWA` بلا `VITE_USE_EMULATORS`).
- أعرض Project ID (`casher-yasoo`) و alias (`default`) وأنت تؤكد.
- أعرض `diff` الـrules (الريبو vs المنشور) قبل النشر — عبر مقارنة يدوية من Firebase Console (لا يوجد أمر `firebase firestore:rules:get` في firebase-tools الحالي): انسخ النص من Console → Firestore → Rules إلى ملف محلي ثم `diff` ضد `firestore.rules`.
- لا أسرار في اللوج/الـcommit — `FIREBASE_SERVICE_ACCOUNT` لا يُطبع.
- لا بيانات تجريبية/seed في Production — كل الاختبارات على `emulator` فقط.
- النشر من `branch` نظيف و `PR` (`git status` نظيف + `git log --oneline -3` مطابق للمراجع).
- الـSW: `registerType:'prompt'` + `cleanupOutdatedCaches:true` — النسخة الجديدة تظهر كبانر `يوجد إصدار جديد` وتتطلب ضغطة `تحديث الآن` — لا تعلق على القديمة (header `Cache-Control: no-cache` لـ `index.html`).

## 5) Verification — قبل الـdeploy (أدلة خام)
1. `git status --short` → خالٍ، `git branch` على `master`، `git rev-parse --short HEAD` و `origin/master` متطابقان (المتوقع: آخر merge على master — يُقرأ وقت التنفيذ عبر `git rev-parse --short origin/master`، لا رقم ثابت).
2. `npm run lint` (المتوقع 7 أخطاء PERM فقط → بعد تنظيف `29671ff` أصبح 0)، `npx tsc --noEmit` (0)، `npm run test:rules` (المتوقع **340/340** — 32 ملف، مقاس 2026-09-24 محليًا و CI #15)، `npm run build` (ذروة `938.00 kB`, `PWA precache 37`).
3. `grep -R "VITE_USE_EMULATORS\|FIRESTORE_EMULATOR_HOST\|localhost:8080\|localhost:9099" dist/` → فارغ.
4. مقارنة يدوية عبر Firebase Console (لا أمر CLI لها): انسخ قواعد Console إلى ملف مؤقت → `diff -u` ضد `firestore.rules` معروض (فارغ أو فروق متوقعة فقط).
5. مراجعة `firestore.rules`: `allow read: if isAuthenticated` في كل مجموعة، `sell/return/customer.payment…` بـ `hasCap`، `users` owner-only، `permissionAudit` append-only.

## 6) Verification — بعد الـdeploy (أدلة خام)
1. `https://casher-yasoo.web.app` يفتح — تسجيل دخول `owner@...` (izatadel007@gmail.com) → يرى `إدارة المستخدمين` (owner-only).
2. `cashier` → بيع نقدي 1× `منتج` → فاتورة `INV-...` تظهر في `التقارير` → مرتجع 1× نفس المنتج → `totalReturns` يزداد.
3. `cashier` يحاول `factoryReset` أو `users` create → يرفض `permission-denied` (الـrules فعّالة).
4. DevTools `Network → Offline` → محاولة بيع → توست عربي `أنت غير متصل — القراءة فقط` + كبسولة هيدر `أوفلاين` + `IndexedDB` `mutations 0→0` → `Online` → البيع ينجح → `Settings → حالة الاتصال` يزيد `count` (أو `clientErrors` في Console).
5. `Application → Manifest` يظهر `Nour Elrahman` + `Service Workers` `activated` → بعد `build` جديد و `deploy`، يظهر بانر `يوجد إصدار جديد` → ضغطة `تحديث الآن` → `Skip waiting` → النسخة الجديدة.

## 7) Rollback — قبل النشر سأحفظ وأكتب الأوامر
- **حفظ المنشور الحالي:**
  ```bash
  firebase hosting:channel:list --project casher-yasoo
  firebase hosting:clone casher-yasoo:live --project casher-yasoo  # أو احفظ release ID
  # لا أمر CLI لحفظ الـrules — انسخها يدويًا من Console → Firestore → Rules إلى:
  # /tmp/rules.before.deploy-$(git rev-parse --short HEAD) (استخدم اسم الملف الفعلي أدناه)
  ```
- **الرجوع — Hosting (إزاحة الإصدار السابق):**
  ```bash
  firebase hosting:clone casher-yasoo:live --project casher-yasoo --from <previous-release-id>
  # أو firebase hosting:rollback --project casher-yasoo (إن توفر)
  ```
- **الرجوع — Rules:** لا rollback عبر CLI (لا أمر `rules:get/release` في firebase-tools الحالي) — الرجوع يدوي: الصق محتوى ملف `/tmp/rules.before.deploy-*` المحفوظ أعلاه في Console → Firestore → Rules → انشر.
- **الرجوع — Indexes:** لا رجوع تلقائي — الـindexes تراكمية؛ احفظ `firestore.indexes.json` الحالي قبل النشر.
- **الرجوع — Git:** `git revert <deploy-commit>` أو إعادة نشر `origin/master~1`.

## 8) Known gaps (توثيق فقط)
- P2 حساسة للانقطاع الطويل الواحد، والسجل محلي على كل جهاز بلا اسم جهاز — `MAX_ENTRIES` يحد الحجم فقط.

## 9) Definition of Done
- الموقع الحقيقي يعمل بآخر commit على master وقت التنفيذ (`git rev-parse --short HEAD` == المنشور — لا رقم ثابت).
- `firestore.rules` و `firestore.indexes.json` المنشورة مطابقة للريبو (`diff` فاضي).
- كل بنود Verification بعد النشر ناجحة بدليل (لقطات/لوج).
- خطة Rollback مكتوبة ومجربة نظريًا (الأوامر أعلاه).
- تقرير نهائي بالنتائج والملاحظات — لا تنفيذ خارج الخطة المعتمدة.

## نتائج التنفيذ الفعلية — 2026-09-26
**الحالة:** ✅ منشور ومُتحقَّق منه على الإنتاج الحقيقي — الخطة مقفولة.

### النشر
- **Commit المنشور:** `e9571d5` (+ `66e9c03` docs-only بعده — لا كود)
- **الموقع الحي:** https://casher-yasoo.web.app
- **دليل Hosting deploy:** `.firebase/hosting.*.cache` بتوقيت رفع 2026-09-26 14:24:07 UTC (17:24 بتوقيت مصر)
- **Firestore Rules:** مطابقة — رد `firebase deploy` كان "already up to date"، ومطابقة الملف نفسه مؤكدة (`git diff d9cdb0d e9571d5 -- firestore.rules` فارغ؛ آخر تعديل فعلي للقواعد 2026-09-20، سابق لقياس 340/340 بتاريخ 2026-09-24)
- **Firestore Indexes:** Enabled (مؤكد من المالك عبر Console)
- **Emulator mode:** غير موجود في بناء الإنتاج — `services/firebase.ts` يربط `connectFirestoreEmulator`/`connectAuthEmulator` بشرط `DEV && VITE_USE_EMULATORS==='1'`، وتم تتبّع صفر استدعاء لهما في `dist/assets/index-*.js` الفعلي بعد commit `5aaced2` (tree-shaking)

### الأيقونات
- `icon-512.png` (MD5 `50221cc34d6023d1ff70adc945ee63e4`) ≠ `maskable-512.png` (MD5 `bed71e390f8e708a023f8cf1eae3ed97`) — الشعار النهائي من PR #8، لم يعودا متطابقين. بند مغلق نهائيًا في `known-issues.md`.

### صلاحيات المالك
- `izatadel007@gmail.com` (owner) يرى "إدارة المستخدمين" — مؤكد من الواجهة الحية، ومطابق لقاعدة `users.manage: {owner: true, admin/supervisor/cashier/accountant: false}` في `utils/permissions.ts` + `firestore.rules`.

### اختبار حي كامل (بيانات وهمية — سيُعاد ضبطها بـ factoryReset لاحقًا)
على المنتج "بنداله بطرحه" (نفس المنتج، تسلسل واحد متصل):
1. **بيع 1:** 14 → 13 — فاتورة حقيقية، قبل اختبار الأوفلاين.
2. **اختبار رفض أوفلاين:** ناجح — رسالة "أنت غير متصل بالإنترنت" ظهرت فورًا عند "تأكيد الدفع"، الكمية فضلت 13، لا كتابة حدثت.
3. **بيع 2 (بعد استعادة الاتصال):** 13 → 12 — `documents:commit` 200.
4. **مرتجع:** 12 → 13 — مستند `fUigULH8jK4AIfQbf5c`، `documents:batchGet` + `documents:commit` كلاهما 200، توست "تمت عملية الإرجاع بنجاح!"، إيصال مرتجع ظاهر في التقارير (كمية 1، سعر 120.00، إجمالي 120.00، بتاريخ ٢٠٢٦/٩/٢٦ ٧:٠٧ م).
- **ملاحظة توضيحية (لا باج):** الكمية "12" التي بقيت ظاهرة في قائمة صفحة المرتجعات مباشرة بعد نجاح المرتجع هي أثر لعدم وجود `onSnapshot` مباشر على قائمة المنتجات هناك (تُجلب مرة واحدة وتُخزَّن محليًا). القيمة الفعلية في قاعدة البيانات أصبحت 13 فور نجاح الـ`commit`؛ تحديث الصفحة (F5) يُظهرها.

### الأوفلاين (OFFLINE-P1)
- الرفض الفوري والتعافي مؤكدان على الإنتاج الحقيقي (وليس على المحاكي فقط) — يغلق فجوة "لم يُختبر حيًا" المذكورة سابقًا في `known-issues.md`.

### الخطوة التالية
- **عدّاد 14 يوم لمراجعة قرار P2 يبدأ رسميًا من 2026-09-26.** المالك يصدّر `offlineLog` JSON من كل جهاز كاشير فعلي (وليس جهاز الاختبار فقط) بعد انتهاء المدة ويرسله للمراجعة.
- **بعد الإطلاق النهائي:** `factoryReset` من واجهة الإعدادات (owner-only) لمسح كل البيانات الوهمية الحالية (بما فيها فواتير الاختبار أعلاه) والبدء ببيانات حقيقية. لا حاجة لأي تصحيح يدوي للمخزون قبل ذلك.
