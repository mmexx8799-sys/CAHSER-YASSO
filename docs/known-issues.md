# Known Issues — Nour-Elrahman

## RBAC-2026-09 — Owner Decisions (G0) — 2026-09-19

> بوابة G0 موقّعة — لا يبدأ R1 قبل هذه القرارات. الافتراضي = ما يُطبَّق إن لم يصدر قرار (محافظ/صفر كسر) — المرجع SPEC-PLAN-TASKS §1.3.

| # | القرار | القيمة المعتمدة | المالك | التاريخ |
|---|---|---|---|---|
| D-1 | بريد حساب **Owner** الوحيد | `izatadel007@gmail.com` | Owner | 2026-09-19 |
| D-2 | سطح الكاشير (التقارير/الأرشيف/التصدير/إنشاء منتج) | **(أ) كما اليوم** — لا تغيير UX في هذه الدورة | Owner | 2026-09-19 |
| D-3 | الأدمن غير المالك يفقد: إدارة المستخدمين، الاستعادة/ضبط المصنع، حذف السجلات الدفترية، تصدير النسخة | **موافقة** — يطابق Least Privilege | Owner | 2026-09-19 |
| D-4 | إطلاق دوري المشرف والمحاسب الآن أم لاحقًا | **الآن (قواعد + واجهة؛ بلا حسابات مُسنَدة حتى ينشئها المالك)** | Owner | 2026-09-19 |
| D-5 | سياسة الخصم حسب الدور (سقف مشرف 20% …) | **بلا تغيير — Deferred** | Owner | 2026-09-19 |
| D-6 | عمليات الموردين للكاشير | **يبقى (كما اليوم)** | Owner | 2026-09-19 |
| D-7 | زر «بدء يومية» للمشرف داخل POS | **لاحقًا** — القدرة موجودة بالقواعد (canOpenDay) دون سطح واجهة | Owner | 2026-09-19 |

- **المصدر:** مراجعة «خطة العرض على الخبير» مقابل الكود عند `e24fe3e` — الأساس المفحوص E-01…E-16.
- **الأثر:** R1 يقبل `owner` في `isAdmin()`/`isStaff()`؛ R5 ينقل `users.manage` + حذف دفتري إلى `isOwner()` فقط بعد تعيين المالك في R4؛ `balance`/الكميات تبقى Accepted Risk (backlog:22).

## OFFLINE-P1 — Owner Decisions (2026-09-21) — D-O1…D-O7

> بوابة P1 موقّعة — لا يبدأ REQ-OFF1-1 قبل هذه القرارات. الافتراضي = ما يُطبّق إن لم يصدر قرار — المرجع `docs/SPEC-PLAN-OFFLINE-P1.md §1.5`.

| # | القرار | القيمة المعتمدة | المالك | التاريخ |
|---|---|---|---|---|
| D-O1 | تسجيل PWA تلقائي أم بضغطة "تثبيت" | **(أ) تلقائي** — يضمن فتح أوفلاين دون تدريب | Owner | 2026-09-21 |
| D-O2 | سلوك زر البيع أوفلاين | **(أ) معطّل + tooltip** — أوضح وأسرع | Owner | 2026-09-21 |
| D-O3 | بانر القراءة فقط | **(أ) ثابت أعلى الصفحة** — لا يُفقد | Owner | 2026-09-21 |
| D-O4 | تنبيه الإصدار الجديد | **(أ) بانر + زر "تحديث الآن"** — يمنع نسخة قديمة | Owner | 2026-09-21 |
| D-O5 | تسجيل الانقطاعات | **(أ) محلي (IndexedDB) + `clientErrors`** — يُرى من Console حتى لو الجهاز مُسح | Owner | 2026-09-21 |
| D-O6 | مدة القياس قبل تقرير P2 | **(أ) 14 يومًا** — عينة أدق | Owner | 2026-09-21 |
| D-O7 | تحديث PWA للـ APK (Capacitor) | **(ب) ويب فقط الآن** — أقل مخاطرة إطلاق | Owner | 2026-09-21 |
| D-O8 | نطاق الرفض الفوري (طبقة الخدمة) | **(أ) assertOnline() في أول كل دالة كتابة في `services/api.ts`** — بدون `clientErrors` (fire-and-forget) وبدون Auth — القائمة الموقعة 21 + إضافة `factoryReset` بعد الجرد (نفس فئة خطر `restoreData`) = **22 دالة محمية** + تعطيل أزرار AC-03 فقط | Owner | 2026-09-21 |

- **المصدر:** `docs/SPEC-PLAN-OFFLINE-P1.md` مراجَع ومطابق للكود سطرًا بسطر (J-01…J-08) + مراجعة OFF1-2 الجرد (6 transactions + 15 كتابة عادية — `persistentLocalCache` يصفف محليًا).
- **الأثر:** REQ-OFF1-1…4 تُنفذ بهذه القيم؛ P2 مؤجلة حتى أرقام P1 (count ≥ 5 أو avg ≥ 2min في 14 يومًا).
- **تفاصيل D-O8 (أ) — الرفض الفوري على مستوى الخدمة:** دالة `assertOnline()` مشتركة تفحص `navigator.onLine` ثم preflight `getDocFromServer` بحسب (ج) وترمي الخطأ العربي الموحّد قبل أي `Firestore` — تُستدعى في أول كل دالة كتابة: `addCustomerPayment, addSupplierPayment, processPurchase, processSupplierReturn, processSale, processReturn, updateAppSettings, addUser, setUserCapOverrides, updateCustomerProfile, updateSupplierProfile, saveProduct, addCategory, addCustomer, addSupplier, deleteDocument, updateDocument, startNewDailyArchive, closeDailyArchive, backupData, restoreData` (21 دالة — 6 + 15) + `factoryReset` = **22 دالة محمية** — مستثناة: `monitoring.ts` و `auth.ts`. مع إصلاح retry (a9ce533): عند `offline-timeout` تُعاد المحاولة مرة واحدة بنفس المهلة (2s) قبل الرفض؛ أخطاء الشبكة الحقيقية تُرفض من أول مرة. تعطيل الأزرار AC-03 فقط.
- **شرطان للجرد قبل تنفيذ assertOnline:** (1) `updateDocument`/`deleteDocument` مساعدان عامان — مثبت بالـgrep الخام: `findstr /n "updateDocument deleteDocument" services\monitoring.ts services\auth.ts` → لا مخرجات (فارغ) — الاستثناءان سليمان (`monitoring.ts` يكتب `clientErrors` عبر `addDoc` مباشرة، و `auth.ts` عبر `setDoc` مباشرة + Auth SDK) — المستدعيان الوحيدان داخليان في `api.ts:136` (`deleteUser`) و `api.ts:146` (`setUserDisabled`) وهما محميان transitively، (2) `assertOnline()` أول سطر في الدالة قبل أي `await` أو `Firestore` — حتى لو `saveProduct` يستدعي `updateDocument` داخليًا فالفحص المزدوج مقبول.
- **تقييم أداء assertOnline (D-O8):** كل عملية كتابة تضيف round-trip واحد `getDocFromServer(counters/invoices)` قبل أن تبدأ — التأخير المتوقع: ~50-200ms على شبكة جيدة، حتى ~4s (مهلتان 2s+2s — retry مرة واحدة على offline-timeout) عند بطء الشبكة/portal — لا يمنع البيع في الزحمة لكنه يضيف انتظارًا محسوسًا لكل ضغطة "تأكيد". عدد القراءات: +1 قراءة Firestore لكل كتابة (تُحسب في حصة Spark الشهرية 50K/يوم — عند 100 بيع/يوم = +100 قراءة/يوم، مهمل؛ عند retry +2). تحسين لاحق مقترح (بعد OFF1-2): تخزين نتيجة آخر ping ناجح لثوانٍ قليلة (مثل 10s) بدل تكراره في نفس الجلسة — يُقيَّم بعد قياس 14 يومًا إن اشتكى الكاشير.
- **نتيجة اختبار OFF1-2 على المحاكي (2026-09-22 — service-layer, emulator):** baseline → محاولة أوفلاين → مقارنة IndexedDB → تحقق Admin SDK — **21/21**: كل دالة رمت الخطأ العربي (`أنت غير متصل بالإنترنت…`) و `mutations 0→0` و `total` ثابت و `emu-final == emu-baseline` (بما فيها `closeDailyArchive/restoreData/factoryReset`) — `updateDocument` (22) مثبتة كودًا + transitively. Captive Portal — قياس خام بعد إصلاح retry (a9ce533): `processSale` رفض بعد **4021ms**، `closeDailyArchive` رفض بعد **2611ms** — **غير مفسَّر بالقياس** — مع `navigator.onLine=true` وحجب `127.0.0.1:8080` → `لا يوجد اتصال بالإنترنت — تحقق من الشبكة` — monitoring: لا استدعاء لها من `api.ts` أصلًا (من تشغيل 09-22). تصحيح: اختبار `slow1500` لم ينجح — الخام كان `fail:أنت غير متصل … elapsed 8` (navigator.onLine=false، لم يصل لمسار الـping أصلًا)؛ سطر "Slow3G success 356ms" بدون throttling لا يختبر الـretry ويُسحب.
- **إغلاق OFF1-2 (2026-09-22 — Done):** 22 دالة محمية بـ`assertOnline()` على مستوى الخدمة + `OfflineGuardError` بعلامة مميزة (`code='offline-guard'`) تُمرر عبر 19 catch داخلية بلا استبدال + تمييز في 18 موقع UI (تعرض الرسالة العربية للحارس فقط، وأي خطأ آخر بسلوكه القديم) + اختبار مسار كان صامتًا بالكامل (`processPurchase` من SupplierAccountPage — صار يعرض التوست العربي + `mut 0→0`). ملاحظة: `handleStartDay` يميّز ثلاثيًا (حارس → رسالته، خطأ SDK له `code` → عامة، خطأ عمل عادي بلا `code` → رسالته) حتى لا تضيع رسائل اليومية المفيدة.
- **قاعدة التصنيف (D-O8 — توثيق صريح):** `SettingsPage.handleStartDay`: تمييز ثلاثي — `OfflineGuardError` → رسالته، أي خطأ يحمل `.code` → رسالة عامة (افتراض: أخطاء SDK)، غير ذلك → رسالته الأصلية (افتراض: أخطاء عمل نصية عربية بلا `code`). تحذير مستقبلي: إن أضاف كود لاحقًا خطأ SDK بلا `code` أو خطأ عمل يحمل `code`، ينكسر التصنيف بصمت — راجع هذه القاعدة عند أي تغيير في أخطاء اليومية.
- **فجوة تغطية اختبارية (OFF1-2 — مفتوح):** `assertOnline()` بلا تغطية اختبارية آلية (تجاوز كامل في `vitest` عبر `MODE==='test'`) — التحقق الوحيد يدوي (Playwright: 21/21 + Captive 2/2 مع القياس أعلاه). مطلوب لاحقًا: اختبار مخصص لـ`assertOnline` بمحاكاة الشبكة (`navigator.onLine` + حجب `getDocFromServer`) بدل تجاوزه بالكامل.
- **فجوة مفتوحة — نجاح الـretry على ping بطيء لم يُقَس في المتصفح:** الحالة `أول ping >2s وثانيه ينجح` مثبتة فقط بمحاكاة منفصلة على mock، ولم تُقَس في المتصفح (اختبار `slow1500` كان أوفلاين فعلاً) — الحارس بلا اختبار آلي.
- **حد معروف — انقطاع غير مغلق (OFF1-4):** لو أُغلق التبويب وهو أوفلاين، `logOfflineEnd` لا تُنفذ — الانقطاع يبقى `end: undefined` في IndexedDB إلى الأبد، ولا يدخل ضمن `getOfflineStats()` (يتطلب `durationMs` و`end`) ولا يُنظّف تلقائيًا — `MAX_ENTRIES` يحد الحجم فقط.
- **الأساس المقاس (REQ-OFF1-0 2026-09-21 — HEAD 1ab34cd — tag pre-offline-p1):** `npx tsc --noEmit` نظيف (0) · `npx eslint . --quiet` 7 أخطاء معروفة (PERM backlog) · `npm run test:rules` **340/340 أخضر (32 ملف)** — 101.20s · `npm run build` نظيف (938.00 kB `index-Bp9vaXPN.js` — 19.62s) · `git status --short` نظيف بعد الوسم · `vite.config.ts`/`index.html`/`public/` بلا PWA · `OfflineNotifier.tsx` إشعار فقط · `processSale` بلا رفض فوري · الجرد الخام (ب→هـ) في تقرير REQ-OFF1-0.

## OFFLINE-P1 — الفجوات المقبولة المجمعة (مؤقتة — 2026-09-23)

> كلها موثقة كـ Accepted Risk مؤقت — لا تُعتبر حلًا نهائيًا، وتُراجع قبل P2.

- **assertOnline() بلا تغطية آلية:** تجاوز كامل في `vitest` — التحقق الوحيد يدوي (Playwright 21/21 + Captive 2/2) — مطلوب: اختبار مخصص بمحاكاة الشبكة.
- **انقطاع غير مغلق:** تبويب يُغلق وهو أوفلاين → `end: undefined` للأبد في IndexedDB — `MAX_ENTRIES` يحد الحجم فقط.
- **تكلفة الأداء:** +1 `getDocFromServer` لكل كتابة (~50-200ms حتى ~4s مع retry مرة واحدة على offline-timeout) — يُقيَّم بعد 14 يومًا؛ مقترح cache لـping 10s.
- **قاعدة تصنيف handleStartDay:** ثلاثي (`OfflineGuardError` / `.code` / غيره) — إن أضيف خطأ SDK بلا `code` أو عمل بـ`code` ينكسر بصمت.
- **الأيقونات مؤقتة:** `maskable-512.png` نسخة من `icon-512.png` — تُستبدل بالشعار الحقيقي قبل النشر.
- **بوابة النشر:** ممنوع `firebase deploy` حتى إغلاق P1 بالكامل — `registerType:'prompt'` بلا بانر يبقي نسخًا قديمة.
- **خط Cairo أوفلاين:** `runtimeCaching:[]` — يقع على النظام — مقبول.
- **مراجعة 14 يوم:** بعد 14 يومًا من النشر الفعلي — المالك يفتح `الإعدادات → حالة الاتصال` أو يصدّر JSON ويرسله للوكيل — عتبة P2: `count≥5` أو `avg≥2min` — الخطوة التالية منفصلة (P2) ومؤجلة حتى هذا القياس.
- **دقة سجل الانقطاعات (D-O5):** سجل الانقطاعات (`offlineLog`) يحسب أي انتقال offline→online بغض النظر عن السبب — فصل شبكة فعلي، أو نوم الجهاز، أو التاب في الخلفية، تُحسب جميعها كانقطاع — عند مراجعة إحصائيات الإنتاج بعد 14 يومًا لقرار P2، يُستبعد أي انقطاع أطول من (مثلًا) 5 دقائق من حساب المتوسط ما لم يُؤكَّد أنه انقطاع شبكة حقيقي، لتفادي تضخيم المتوسط بأحداث نوم الجهاز.

## AC-04 Follow-up — Roleless test accounts (2026-09-19)

- `ramypro0120@gmail.com` (uid: `s162boAmSEbgaLDmRNG2SoisoN23`) — بلا `role` عمدًا، حساب تجريبي غير مستخدَم، مجدول للحذف بعد اكتمال الإنتاج النهائي. محروم من كل كتابة (Default-deny — BR-01) — لا أثر تشغيلي.
- `mmexx8799@gmail.com` (uid: `OQTdQOxDCAbMld06A8oT1Yhm7hC3`) — نفس الحالة، نفس السبب.
- إجراء الحذف (Auth ثم Firestore) يُنفَّذ يدويًا بعد انتهاء دورة RBAC بالكامل — لا يُنسى.
- الجرد النهائي AC-04 (2026-09-19): 4 حسابات فعّالة بلا تأثر (izatadel007@gmail.com `admin→owner`، mexx.maxx104@hotmail.com `admin`، abdelrhmanyasoo@gmail.com `admin`، esraa.man104@gmail.com `cashier`) + حسابان أعلاه بلا دور عمدًا (الأكثر أمانًا لحساب غير مستخدَم — القواعد تمنعه تلقائيًا).
- تحديث 2026-09-20 (لقطة `/users` الحية): ظهر حساب سابع `sehelly2018@gmail.com` بلا `role` (—) لم يكن في الجرد الأصلي. الحالة: Default-deny (محروم من الكتابة تلقائيًا — لا أثر تشغيلي)؛ إن احتاج وصولًا يُسند له دور من `/users` بواسطة المالك.

## R2 — Restore/Reset temporarily owner-only, no owner yet (2026-09-19)

- `data.restore`/`data.reset` now require `role=owner` (R2 `utils/permissions.ts`), but no `owner` exists in production until R4.
- No operational risk: all current production data is test/dummy data (confirmed by project owner) — no real backup/restore need expected before R4 completes.
- **Resolved by R4 (2026-09-20):** `izatadel007@gmail.com` أصبح `owner` فعليًا — الاستعادة/الضبط متاحان له الآن.

## R3 — Backup button also hidden for admin, no owner yet (2026-09-20)

- `backup.export` now owner-only in UI (`SettingsPage`), same root cause as R2's restore/reset gap.
- No operational risk (dummy data), but reinforces need to complete R4 soon.
- **Resolved by R4 (2026-09-20):** زر النسخ متاح للمالك الآن.

## R4 — Owner migration production run (2026-09-20)

- الطريقة: تعديل يدوي عبر Console (حقل `role: admin → owner` على وثيقة `izatadel007@gmail.com`) — لتعذّر Admin SDK محليًا (لا `GOOGLE_APPLICATION_CREDENTIALS` على الجهاز، والسكربت يرفض العمل بلا اعتماد — AUDIT-SEC-2). التغيير = حقل واحد في وثيقة واحدة، مطابق لما كان سيفعله `scripts/migrateRoles.mjs --apply` (كتابة واحدة).
- Read-back: لقطة Console تُظهر `role: "owner"` + لقطة `/users` حية تُظهر `izatadel007@gmail.com` بصفة **مالك** محمي (`محمي — Break-glass فقط`، بلا أزرار حذف/تعطيل) — دخول فعلي ناجح.
- `abdelrhmanyasoo@gmail.com` بقي `admin` كما اتفقنا (لم يُمس).

## مفتوحة (Open)

Console-TypeError-startTime (لقطة Smoke حي P0-4 — 2026-09-13): Uncaught TypeError: Cannot read properties of undefined (reading 'startTime') في reportAllChanges — غير مرتبط بـ BUG-P0-4 — Status: مفتوح (لم يُشخَّص بعد، يُحتمل DevTools/Extension لا كود التطبيق)

UX-raw-auth-error (مراجعة BUG-P0-6 — 2026-09-14): أخطاء Firebase خارج الثلاثة المترجمة (مثل network-request-failed) تُعرض خامًا بالإنجليزية في SettingsPage — ليست ثغرة (لا تسريب)، فقط تجربة أقل احترافًا في حالات نادرة — Status: مفتوح (لا إصلاح بعد)

BUG-P0-1 (دفعة 2026-09-13 — انهيار processReturn عند ربط مرتجع بفاتورة: transaction.get(Query) غير مدعوم في firebase v10)
Severity: Critical
Status: Fixed in code + covered by TEST-REG-P0-1 (commit 86f7f4e — خيار A بقرار المالك، Accepted Risk لنافذة السباق موثّق، والبديل الذري TECH-P0-1b في backlog) — TASK-P0-1-09: مغلق (2026-09-16) — التحقق جاء من مراجعة استخدام حي فعلي لا اختبار مقصود: كشف حساب عميل حقيقي (نور الرحمن للملابس) أظهر 4 عمليات مرتجع مرتبطة بـ 3 فواتير أصلية مختلفة (يومي 13–14 سبتمبر) بتسلسل رصيد متطابق بلا أي فجوة حسابية — Closed
Ref: tests/processReturn.test.ts (8/8 green على Emulator)، tsc + build نظيفان

BUG-P0-1
Problem: المرتجعات مش مربوطة بفاتورة أصلها (لا يوجد originalInvoiceId)
Severity: High
Status: Fixed (REQ-P0-1 — 2026-09-12)

BUG-P0-1b
Problem: ترقيم الفواتير/المشتريات عشوائي (Date.now()) بدل تسلسلي
Severity: Medium
Status: Fixed (REQ-P0-1b — 2026-09-12)

BUG-P0-3
Problem: لا تحقق أن السعر المُرسَل من العميل يطابق سعر المنتج المسجَّل فعليًا في المنتجات (احتمال تلاعب بالسعر عبر استدعاء مباشر)
Severity: High
Status: Fixed — Partial (REQ-P0-3 — 2026-09-12) — سياسة 50% مؤقتة، انظر التفاصيل
Details (2026-09-12):
- تمت إضافة تحقق سعري خادمي في processSale (+ processReturn) داخل نفس مرحلة قراءات productDocs — قبل أي كتابة (services/api.ts).
- القاعدة: item.price مقبول إذا (a) يطابق تمامًا أحد الأسعار المعرّفة للمنتج (price/retailCash/retailCredit/wholesaleCash/wholesaleCredit)، أو (b) ≥ 0.5 * min(الأسعار المعرّفة) — للمنتج وحيد السعر min=price.
- هذا يسد ثغرة "1 ج.م لمنتج بـ100" مع الإبقاء على خصم تفاوضي شرعي حتى 50% كما هو في POSPage.tsx/ReturnsPage.tsx (تعديل سعر يدوي مفتوح).
- الاستثناء موثّق كسياسة مؤقتة قابلة للمراجعة — backlog: "سياسة حد أدنى للخصم (50% مؤقت)".
- تم فحص processReturn ووجد أنه يقرأ السعر من العميل بشكل مستقل (لا يشتق من الفاتورة)، فطُبّقت نفس القاعدة عليه.

BUG-P0-4
Problem: الاستعادة (Restore) تنفّذ factoryReset (حذف كامل) قبل التحقق من صحة محتوى ملف النسخة الاحتياطية
Severity: Critical
Status: Fixed (REQ-P0-4 — 2026-09-12)

BUG-P0-4b
Problem: لا يوجد schemaVersion/appVersion في بيانات النسخ الاحتياطي
Severity: Medium
Status: Fixed (REQ-P0-4 — 2026-09-12)

BUG-P0-5
Problem: لا يوجد حارس in-flight في عملية البيع (POSPage) — إمكانية إرسال فاتورة مكررة بضغط مزدوج أثناء شبكة بطيئة (موجود بالفعل في المرتجعات)
Severity: Medium
Status: Fixed (REQ-P0-5 — 2026-09-12)

BUG-P0-6
Problem: ثغرات أمنية في التبعيات — قبل الإصلاح: 44 ثغرة (4 critical, 21 high, 16 moderate, 3 low) — بعد `npm audit fix` (بدون --force) في REQ-P0-6: 22 ثغرة متبقية (1 critical, 5 high, 16 moderate)
Severity: High
Status: Fixed — Partially Fixed (non-breaking only) — Verified Live (2026-09-12) — Re-audited 2026-09-16: 26 ثغرة (2 critical, 5 high, 19 moderate) عبر `npm audit --json` (metadata.vulnerabilities — الرقم النهائي الموثق، لا تقرير وسيط)
Details (2026-09-12):
- تم تشغيل `npm audit fix` فقط (بدون --force، بدون تعديل يدوي لـ package.json) — package.json بدون أي semver-major، package-lock.json فقط تغيّر (480 إضافات/2721 حذف).
- المتبقي 22: @capacitor/cli (tar → يحتاج 8.5.2 major)، vite (esbuild + path traversal → يحتاج 8.3.0 major)، exceljs (uuid → يقترح downgrade إلى 3.4.0 مرفوض — load-bearing لـ M10 Excel export)، react-router/react-router-dom (يحتاج 7.18.3 major)، sharp (libvips → لا يوجد fix)، @capacitor/assets + @trapezedev/project/xcode (لا يوجد fix)، بالإضافة لـ firebase/undici المتبقي (يتطلب تحديث firebase major لاحقًا).
- المرفوض/المؤجل كمخاطرة مقبولة أو Backlog: @capacitor/cli, vite, exceljs, @capacitor/assets, sharp — سيتم إعادة التقييم عند ترقية major مخططة.
- AC-06 — اختبار حي حقيقي (ليس محاكى بالبناء): تم تشغيل `firebase deploy --only firestore:rules` ثم اختبار فعلي على مشروع Firebase الحي — بيع نقدي: success، بيع آجل (customer): success — تم بعد نشر القواعد التي كانت معلّقة منذ REQ-P0-9/d5d7d0f وcounters rule. فجوة النشر السابقة موثّقة كحادثة مغلقة أدناه.
Re-audit 2026-09-16 (المرحلة 1 — بند 1.2 — إغلاق نهائي، بلا أي تغيير في package.json/package-lock.json):
- الأمر المرجعي: `npm audit --json` → metadata.vulnerabilities = {critical: 2, high: 5, moderate: 19, total: 26} — الزيادة 22→26 ليست تبعيات جديدة بل advisories جديدة نُشرت بعد 2026-09-12 (vitest UI RCE 9.8، sharp libheif، undici <6.28.0، tar GHSA-r292/vmf3/w8wr/23hp).
- `npm audit fix --dry-run` أُعيد تشغيله: ما زال 26/26 — أي لا يوجد إصلاح non-breaking حقيقي (سطر "fix available via npm audit fix" بجانب undici مضلل: firebase المثبت 10.14.1 هو آخر 10.x وما زال داخل النطاق المتأثر 10.13.0–10.14.1، والإصلاح الحقيقي يتطلب firebase 11 major).
- الحرجة (2): tar عبر @capacitor/cli 6.2.1 (أداة بناء فقط — الاستغلال يتطلب فك ضغط tar خبيث أثناء البناء؛ الإصلاح يتطلب @capacitor/cli 8.5.2 major → يكسر build الأندرويد الحالي v6 — مرفوض) + vitest UI RCE 9.8 (سيرفر اختبار dev فقط — لا يُفتح إطلاقًا في الإنتاج؛ الإصلاح يتطلب vitest 5 major — مرفوض).
- العالية (5): undici عبر firebase 10.14.1 (يتطلب firebase 11 major — مرفوض؛ التطبيق لا يخاطب undici مباشرة بل عبر Firestore SDK، ولا مسار تسريب أسرار)، sharp عبر @capacitor/assets (توليد أيقونات فقط — لا كود إنتاج)، vite server.fs.deny bypass (dev server فقط — الإنتاج static على Firebase Hosting)، والباقي تبعي لنفس السلاسل.
- exceljs 4.4.0 (uuid GHSA-w5hq): "No fix available" — load-bearing لتصدير M10، والاستغلال يتطلب تمرير buf يدويًا وهو ما لا يفعله التطبيق — يبقى كما هو.
- القرار: لا --force، لا major bumps، لا downgrades — الوضع الحالي هو الحد الأقصى الآمن على هذا الـ stack، ويُعاد التقييم فقط عند ترقية major مخططة.

BUG-P1-2
Problem: importmap يشير لـ aistudiocdn.com موجود في ملف الإنتاج المبني فعليًا
Severity: Low
Status: Fixed (REQ-P1-2 — 2026-09-12)

BUG-P0-14 (جديد، منفصل تمامًا عن BUG-P0-13)
العنوان: معاملات Firestore متزامنة تمامًا قد ترفض بـ PERMISSION_DENIED بسبب تقييم isActiveUser()/get() تحت تنافس — 5/5 تكرار على الـ Emulator، لم يُختبر بعد على Firestore الحي.
الحالة: مفتوح — يحتاج Reproduce على بيئة حية قبل تحديد الخطورة الفعلية (انظر Golden Bug Rule §16 — لم نصل بعد لـ Root Cause، فقط لموقع الاشتباه).
تحديث REQ-P0-14c (مرتبط بـ BUG-P0-13): السبب الجذري المثبت ليس RBAC (admin == cashier حرفيًا 9/96/0 حيًا) بل رفض صحيح من شرط +1 مع PERMISSION_DENIED غير قابل لإعادة المحاولة من الـSDK — شُحن تخفيف فوري: bounded retry (×4 + jitter) حول runTransaction في processSale/processPurchase (بلا مساس بالقاعدة). القياس الحي: N=5 → 87-100% (مقبول للشحن)؛ التزامن العالي (10+) residual risk معروف ومتفق عليه. الحل البنيوي (Cloud Function بصلاحية Admin SDK) مؤجل — لا sharded counters (الترقيم التسلسلي متطلب محاسبي).
تحديث Stage-3 (3.2 — 2026-09-17 — محاكي، ليس حيًا): tests/concurrentSalesHigh.test.ts يقيس فوق N=5 بثوابت صارمة (عدّاد==قبل+ناجح، أرقام فريدة، مخزون/أرشيف بالمليم): N=10 same-tick → 10/10، N=12 متموج (5ms) → 12/12، N=15 same-tick → 15/15، N=10 متعدد المنتجات → 10/10. رقم الثقة قبل الإطلاق ارتفع للتزامن ≤15 على المحاكي؛ السلوك الحي تحت تزامن عالٍ وفوق N=15 ما زال residual risk موثقًا (لم يُختبر حيًا).

## مخاطرة مقبولة — بقرار مالك المنتج (Accepted Risk — Owner Decision)

BUG-P0-2 — 2026-09-12
Problem: أي مستخدم نشط (مش admin بس) يقدر يعدّل customers/suppliers/invoices/returns مباشرة من الـ SDK (balance/openingBalance)
Severity: Critical → Accepted Risk
Status: Accepted Risk (Owner Decision — 2026-09-12) — لا يُعد ثغرة عاجلة
Decision Rationale:
- كل المستخدمين المصرح لهم بالدخول موظفون معروفون وموثوقون، وليس عملاء أو أطراف خارجية.
- الاستغلال يتطلب معرفة تقنية متعمدة (أدوات المطور + كتابة كود مباشر) غير متوفرة لدى مستخدمي النظام الفعليين.
- الإصلاح الكامل يتطلب إما getAfter/complex rules أو ترقية إلى Blaze (Cloud Functions) — غير مبرر حاليًا.
- تم اختبار التضييق المقترح (diff().affectedKeys() على balance/openingBalance) وتبيّن أنه يكسر المسار الطبيعي: processSale/addCustomerPayment/processReturn تصبح DENIED للكاشير (firestore.rules لا تميّز بين كتابة مباشرة و transaction شرعي). تم التراجع فورًا (git checkout firestore.rules).
Follow-up: يبقى موثّقًا للمستقبل — إعادة التقييم عند الترقية لـ Blaze أو عند إضافة أدوار/مستخدمين خارجيين.
Ref: docs/REQ-P0-2-baseline.md — تقرير الخطوات 0-2
Update REQ-SEC1-8 — إغلاق نهائي (2026-09-16): Phase 0 حية ومثبتة (تجميد openingBalance + حواجز amount/total — Ref: tests/balanceOpeningFreeze.test.ts 9/9 + live smoke: DENIED على الإنتاج). Phase 1/2 (Cloud Functions/Blaze): **Declined — Owner Decision (Ahmed, 2026-09-16)** — لا Visa/فوترة على مشروع Spark مجاني، وكل المستخدمين (بمن فيهم الأدمن) بلا خلفية تقنية تمكّنهم من استغلال Dev Console/SDK عمليًا. **كتابة balance المنفردة عبر SDK تبقى مفتوحة لغير الأدمن إلى أجل غير مسمى — هذا وضع مقصود وموثق، وليس إغفالًا يحتاج إصلاحًا لاحقًا.**

## مُغلَقة (Closed)

BUG-P1-2 — importmap aistudiocdn — Status: Fixed (REQ-P1-2 — 2026-09-12)
BUG-P0-3 — تلاعب بالسعر — Status: Fixed (partial 50% floor, REQ-P0-3 — 2026-09-12)
BUG-P0-5 — حارس الإرسال المكرر — Status: Fixed (REQ-P0-5 — 2026-09-12)
BUG-P0-1b — ترقيم عشوائي — Status: Fixed (REQ-P0-1b — 2026-09-12)
BUG-P0-1 — المرتجعات بدون ربط — Status: Fixed (REQ-P0-1 — 2026-09-12)
BUG-P0-6 — ثغرات npm audit — Status: Fixed (partial non-breaking 44→22, live smoke verified 2026-09-12)
BUG-P0-4 — الاستعادة قبل التحقق — Status: Fixed (REQ-P0-4 — 2026-09-12)
BUG-P0-4b — لا يوجد schemaVersion — Status: Fixed (REQ-P0-4 — 2026-09-12)
BUG-P0-8 — عدم استقرار البناء المزعوم — Status: Closed (كان PASS فعليًا، تأكد ببناء نظيف)
BUG-P0-9 — بيع/مرتجع ممكن على يومية مقفولة — Status: Fixed (commit d5d7d0f)
BUG-P0-10 — بيع منتج وهمي بدون خصم مخزون — Status: Fixed (commit dd438b2)
BUG-P0-11 — لا تحقق من إجمالي/خصم سالب على مستوى الخادم — Status: Fixed (commit dd438b2)
BUG-P0-12 — دفعات بقيمة سالبة أو صفر مقبولة — Status: Fixed (commit dd438b2)
BUG-P0-15 (عدادات النسخ الاحتياطي — 2026-09-15)
Problem: مجموعة counters مستبعدة من BUSINESS_DATA_COLLECTIONS — أي استعادة تعيد فواتير بأرقام موجودة بينما العداد يبقى على قيمته الحية (أو يُمسح) → تكرار invoiceNumber/purchaseInvoiceNumber بعد أي استعادة. كل النسخ الموجودة حاليًا v1 (بلا counters).
Severity: Critical (تكرار أرقام فواتير حقيقي، أخطر من فجوة الترقيم المقبولة)
Status: Fixed — Verified via Emulator (2026-09-16) — tests/backupCounters.test.ts (4/4 green: v2 round-trip, v1 derivation, backward-protection, RBAC no-regression)
Accepted Risk (قرار مالك 2026-09-15): القواعد لا تميز "admin أثناء restore" عن "admin يكتب يدويًا" — أي admin يستطيع ضبط العداد لأي قيمة عبر SDK. مقبول لأن الـ admin يملك أصلًا صلاحيات تدميرية أوسع (حذف اليوميات/المنتجات)، والتجاوز هو ما يجعل الاستعادة المرقمة ممكنة أصلًا.

REQ-BARCODE pagination gap (ثغرة مسح منتج غير محمّل في POS — 2026-09-17)
Problem: التنفيذ الأول لـ REQ-BARCODE كان يبحث بالباركود في المصفوفة المحمّلة جزئيًا فقط (getProductsPaginated — أول 30 + infinite scroll) بلا أي احتياطي سحابي — أي منتج موجود في Firestore لكن خارج الصفحة المحمّلة كان يُعطي Toast خاطئ "الباركود غير موجود بالمخزون".
Discovery: اكتُشفت بمراجعة الكود لا بالاختبار — tests/posBarcodeSearch.test.ts فاتها لأنها تستخدم كتالوجًا ثابتًا صغيرًا كاملًا في الذاكرة لا يحاكي pagination (البحث المحلي ينجح دائمًا هناك، بينما يفشل إنتاجيًا للمنتجات خارج الصفحة المحمّلة).
Severity: Medium (Toast مضلّل + بيع متعذّر لمنتج موجود — بلا فقدان بيانات)
Status: Fixed (REQ-BARCODE-FIX-1 — 2026-09-17): getProductByBarcodeCloud في services/api.ts كخطوة ثانية عند miss محلي فقط + حارس isResolvingBarcode + رسالة شبكة مميزة + نفس getScanBlockReason على النتيجة السحابية — Ref: tests/posBarcodeCloudFallback.test.ts (7/7 green)، tsc + build نظيفان

REQ-BARCODE camera-dead (محرك المسح لا يرصد — فيديو حي بلا نتيجة — 2026-09-18)
Problem: نسخ zxing_reader.wasm إلى public/ وحده لا يكفي — barcode-detector يجلب الـwasm افتراضيًا من jsDelivr CDN (موثق في zxing-wasm/share.d.ts)، وهذا الجلب محجوب إنتاجيًا بواسطة CSP (connect-src بلا jsdelivr) ويخرق AC-10 أصلًا. كل detect() كان يرمي NotSupportedError كل إطار والـcatch يبتلعه → فيديو يعمل بلا رصد وبلا رسالة. الملصق المطبوع نفسه سليم (CODE128 صحيح).
Discovery: بلاغ ميداني + صور (فيديو يعمل، لا تفاعل) — شخص بـ locateFile الافتراضي في node_modules/barcode-detector/dist/es/zxing-exported.js (سطر CDN).
Severity: High (ميزة المسح بالكاميرا معطلة بالكامل — مسار USB/يدوي غير متأثر)
Status: Fixed (REQ-BARCODE-FIX-2 — 2026-09-18): prepareZXingModule({overrides:{locateFile}}) مرة واحدة (مطابقة المشروع المرجعي العامل) + إنشاء الماسح بعد video.play() + صيغ بلا qr_code + خطأ 'engine' مرئي بعد 15 إخفاق detect() متتالٍ + اختبارا انحدار على resolveZxingWasmUrl (لا jsdelivr) — Ref: tests/posBarcodeSearch.test.ts (16/16 green)، tsc + build نظيفان
Update FIX-2b (دقة VGA — 2026-09-18): التشخيص الميداني (SCANDBG-v2) أثبت المحرك يعمل (518 إطار @22ms بلا أخطاء) لكن video=480x640 — قضبان Code128 تحت البكسل. الإصلاح: width/height ideal=1280x720 في getUserMedia.
Update FIX-3 (استقرار — 2026-09-18): بلاغ "تعليق بعد عدة مبيعات يُحل بإعادة دخول الصفحة" — السبب: استعلام سحابي معلّق (شبكة متقطعة) يُبقي isResolvingBarcodeRef=true للأبد فتُسقط كل المسحات بصمت. الإصلاح: مهلة 8s (withCloudTimeout → cloud-error صريح) + حذف صندوق DEBUG-SCAN (كان يعيد رسم المودال كل ثانية) — Ref: اختبار التعليق في tests/posBarcodeCloudFallback.test.ts.

REQ-BARCODE-AUTOCART + REQ-BARCODE-RETURNS (2026-09-18)
Problem: بعد نجاح المسح كانت الكاميرا تبقى مفتوحة والسلة لا تُفتح (خطوة يدوية زائدة)؛ وصفحة المرتجعات بلا مسح باركود أصلًا (مستبعدة صراحة من REQ-BARCODE الأول).
Status: Shipped — REQ-A: إغلاق الكاميرا + فتح سلة البيع تلقائيًا عند إضافة فعلية فقط (نتيجة boolean من الـstore تمنع الفتح عند رفض المخزون الداخلي + isCameraOpenRef يمنع الفتح بعد إغلاق يدوي أثناء fallback معلّق + مسار USB بلا auto-open). REQ-B: حقل مسح (يدوي/USB + كاميرا) دائم الظهور في المرتجعات (كتالوج + فاتورة مربوطة) عبر utils/barcodeResolution.ts المشتركة، بلا حارسي نفاد/بيع (الإرجاع شرعي)، وقواعد ربط الفاتورة تُطبَّق من handleAddToReturnCart نفسها. Ref: tests/cartAddResult.test.ts (5/5)، tsc + build نظيفان — UAT ميداني مطلوب لكل AC قبل الإغلاق

## حوادث مغلقة — دروس منهجية (Closed Incidents — Methodology)

INC-2026-09-12 — فجوة نشر firestore.rules
Incident: قواعد firestore.rules المحدّثة عبر REQ-P0-9 (d5d7d0f — منع البيع على يومية مقفولة) وإضافة `counters` في REQ-P0-1b تم دفعها إلى git فقط دون تنفيذ `firebase deploy --only firestore:rules` على المشروع الحي — مما تسبب في انقطاع كامل لعملية الدفع (403 batchGet) حتى تم اكتشافه يدويًا ونشره في 2026-09-12.
Root Cause: قالب الـ REQ كان يطلب tsc/build/git diff فقط كأدلة — لا يغطي النشر الحي للقواعد، ونجاح البناء المحلي لا يعطي أي معلومات عن ما هو مُطبّق فعليًا في الإنتاج.
Fix: إضافة قاعدة دائمة جديدة لقالب REQ (موثّقة في docs/req-template.md) — أي REQ يلمس firestore.rules يجب أن يحتوي AC إضافي يطلب تشغيل `firebase deploy --only firestore:rules` ولصق مخرجاته كدليل، ولا يُعتبر مكتملًا حتى يتم تأكيد النشر الحي.
Status: Closed — Deployment gap resolved 2026-09-12

## PERM-2026-09 — Known Issues (2026-09-21)

- **حسابات بلا `role` لا تُعطَّل/تُحذف من `/users`:** الواجهة تخفي أزرار التعطيل/الحذف للحساب بلا دور صالح — الإجراء الوحيد عبر Console (Firestore + Auth) — لا أثر تشغيلي (Default-deny).
- **قائمة مشوهة من Console تمنع تعطيل صاحبها من الواجهة:** إذا كُتبت `capGrants/capDenies` بقيمة غير `list` أو خارج `overridableCaps()` من Console، فإن `capListsValid` تفشل على `update` حتى لتعطيل الحساب — صحّح القائمة أولًا من Console ثم عطّل — الأمان لا يتأثر (الحساب مغلق fail-closed).
- **تحذير `canOpenDay` غير مستخدمة:** `firestore.rules:32 canOpenDay` تظهر `[W] Unused function` بعد REQ-PERM-2 — الدالة استُبدلت بـ`hasCap('archive.open', [...])` — تُحذف في تنظيف لاحق — بلا أثر.
- **وثائق `permissionAudit` لا تُحذف من التطبيق:** لا زر حذف ولا `delete` في القواعد (`update, delete: false`) — تنظيفها قبل الانطلاق يتم من Console فقط — خارج النسخ الاحتياطي وضبط المصنع عمدًا.
- **منع `product.create` يخفي تبويب المنتجات:** `buildNavItems` يربط التبويب بهذه القدرة — منحها/منعها يظهر/يخفي التبويب كاملًا — مقصود.
- **الواجهة بلا إشعار إصدار جديد:** لا يوجد تنبيه `New version available` بعد نشر الاستضافة — يحتاج تحديث يدوي للصفحة — Backlog.

## OFFLINE-P1 — Known Issues / Open Items (2026-09-21 — REQ-OFF1-1)

- **الأيقونات مؤقتة (REQ-OFF1-1):** `public/icons/maskable-512.png` نسخة مطابقة لـ `public/icons/icon-512.png` (نفس الـmd5) — والمانيفست يستخدم `purpose:'any maskable'` مدموجًا في مدخل واحد. تُستبدل بالشعار الحقيقي كمدخلين منفصلين (`any` / `maskable`) قبل أي نشر — بند مفتوح.
- **بوابة النشر (OFFLINE-P1):** ممنوع `firebase deploy` لأي جزء من OFFLINE-P1 حتى إغلاق REQ-OFF1-3 — السبب: `registerType:'prompt'` بلا بانر يُبقي نسخًا قديمة عالقة بلا تحديث.
- **قيد معروف — خط Cairo أوفلاين:** `runtimeCaching:[]` يعني خط Cairo (Google Fonts) لا يُخزَّن أوفلاين — يقع على خط النظام عند الانقطاع — متوقع ومقبول.
