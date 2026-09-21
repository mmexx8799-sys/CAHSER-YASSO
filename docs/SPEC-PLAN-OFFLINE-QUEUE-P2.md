# SPEC / PLAN / TASKS — المرحلة 2: طابور البيع بلا إنترنت (Offline Sales Queue)

> **الحالة:** مسودة معدلة بعد ملاحظات المراجع الحقيقي — لا يبدأ التنفيذ قبل اعتمادها.
> **السياق:** بعد إقفال PERM-2026-09 (340 اختبار، rules/indexes/hosting منشورة)، المرحلة التالية هي **موثوقية البيع تحت انقطاع متكرر**.
> **تنبيه منهجي:** المراجعة الآلية السابقة التي نُسبت لـ "Guard Review مستقل (GLM/Claude)" **غير موثوقة** — صححت أخطاء لكنها أدخلت خطأين تقنيين (P0-3 و P0-6). هذه النسخة تصححهما بناءً على ملاحظات المراجع الحقيقي.
> **سؤال معلق يوقف الانطلاق:** "تكرار الانقطاع" — هل الانقطاع متقطع (ثوانٍ/دقائق) أم طويل (ساعات)؟ الجواب يحدد سياسة إعادة المحاولة. هذه الوثيقة تفترض **الأسوأ: flapping قصير** وتقترح معاملات قابلة للضبط في `appSettings` (لا "بلا إعادة بناء" كاذبة).
> **تاريخ المسودة:** 2026-09-21 — الكاتب: Muse Spark (منفّذ) — بانتظار موافقة المالك.

---

## 1) SPEC — ماذا نريد ولماذا

### 1.1 المشكلة الحالية (Evidence)
- `services/firebase.ts:34-38` يستخدم `persistentLocalCache + persistentMultipleTabManager` — القراءات تُحفظ محليًا، لكن **كل كتابة مالية** (`services/api.ts:825 processSale`, `:625 processPurchase`, `:708 processSupplierReturn`, `:955 processReturn`) تُنفذ داخل `runTransaction` / `runTransactionWithRetry` — هذه **تفشل فورًا بلا إنترنت** (لا يوجد queue).
- `components/OfflineNotifier.tsx:5` يكتشف `navigator.onLine` لكنه **إشعار فقط** — لا يحفظ العملية ولا يعيد المحاولة.
- `pages/POSPage.tsx:165 handleProcessSale` يعرض `toast.error` ويرمي الخطأ — السلة تبقى لكن المستخدم لا يعرف هل العملية حُفظت أم ضاعت.
- **الخطر التجاري:** كاشير يضغط "تأكيد الدفع" → يرى خطأ → يعيد الضغط → قد يُنشئ فاتورتين عند رجوع الشبكة (BUG-P0-14c حاول تخفيف التزامن لكنه لا يغطي offline).

### 1.2 أهداف المرحلة 2 (Goals)
1.  **لا ضياع بيع:** أي ضغط "تأكيد" أثناء offline يُحفظ محليًا ويُعاد إرساله تلقائيًا عند الرجوع — حتى لو أُغلق التبويب/التطبيق وأُعيد فتحه **بعد رجوع الاتصال** (F-6 معدلة — انظر 1.8).
2.  **لا تكرار:** نفس العملية لا تُنشئ فاتورتين حتى مع `flapping`.
3.  **ترقيم صحيح:** `counters/invoices` يبقى تسلسليًا بلا تكرار (الترقيم المحلي مؤقت فقط).
4.  **أرصدة ومخزون متسقان:** رصيد العميل/المورد + `quantity` + `dailyArchives.total*` يُحدَّثان ذريًا عند الـ replay.
5.  **شفافية للكاشير:** يرى حالة الطابور (☐ معلق ⏳ يُرسَل ✅ تم ❌ فشل) ويستطيع إعادة المحاولة يدويًا.

### 1.3 غير أهداف (Non-Goals)
- العمل بلا حساب مسجّل (offline auth) — خارج النطاق.
- مزامنة متعددة الأجهزة لنفس الطابور — كل جهاز طابوره محلي.
- تشغيل Cloud Functions / ترقية Blaze — **ممنوع** (قرار مالك Spark مجاني — `docs/known-issues BUG-P0-2`).

### 1.4 المستخدمون والسيناريوهات
- **كاشير (cashier/supervisor):** يبيع نقدًا/آجلًا أثناء انقطاع 10-30 ثانية متكرر. يتوقع "تم حفظ البيع محليًا — سيُرسل تلقائيًا".
- **مالك (owner):** يراجع الفواتير المُعاد تشغيلها مع `occurredAtLocal` (وقت البيع الفعلي) + علامة `origin: offline-replay`.
- **مدقق:** يريد ضمان أن `invoiceNumber` النهائي هو التسلسلي الحقيقي، لا المؤقت المحلي.

### 1.5 المتطلبات الوظيفية
| # | الوصف | AC مختصر |
|---|---|---|
| F-1 | حفظ عملية البيع محليًا عند فشل `runTransaction` بسبب الشبكة | ضغط بيع بلا إنترنت → toast "حُفظ محليًا" + عنصر في الطابور + السلة تُفرغ بعد نجاح enqueue |
| F-2 | إعادة إرسال تلقائية عند `online` + زر يدوي | عند `online` يبدأ replay خلال ≤3s؛ الزر يعمل حتى لو `online` كاذب |
| F-3 | منع التكرار (idempotency) | نفس `clientOpId` لو أُرسل مرتين → فاتورة واحدة فقط (تحقق ذري داخل transaction) |
| F-4 | ترقيم سليم | الفاتورة المحلية تحمل `INV-LOCAL-…` مؤقتًا؛ بعد replay تحمل `INV-0000xx` الحقيقي بلا تكرار حتى N=15 |
| F-5 | طابور مرئي + حالات | Drawer يعرض `pending/syncing/done/failed` مع عدّاد وسبب الفشل |
| F-6 | بقاء بعد الإغلاق — **معدلة** | إن كان PWA فعالًا: إغلاق وإعادة فتح بلا إنترنت → الطابور موجود + الموقع يفتح. **بلا PWA: F-6 تصبح "إغلاق وإعادة فتح بعد رجوع الاتصال → الطابور موجود" فقط** — لذلك مرحلة 1 (PWA) شرط سابق (انظر 1.8) |
| F-7 | حدود الطابور | حد 100 عملية معلقة؛ عند الامتلاء يُرفض البيع برسالة واضحة |

### 1.6 المتطلبات غير الوظيفية
- **الأداء:** replay عملية واحدة <2s على 3G لـ ≤20 صنف.
- **السعة:** 100 × ~5KB ≈ 500KB — آمن لـ IndexedDB (حد 50MB) — `done` يُحذف بعد 7 أيام أو زر "مسح المكتمل".
- **الأمان:** نفس `hasCap('sell', …)` + نفس التحقق السعري 50% + فحوصات `discount/subtotal/total/quantity` قبل الـ replay.
- **الاختبار:** 100% على المحاكي + اختبار يدوي بقطع الشبكة من DevTools.

### 1.7 القيود الصلبة
- لا Blaze/Functions — كل المنطق client-side + `firestore.rules` فقط.
- `firestore.rules:230-238` تفرض `lastNumber == last+1` — الـ replay يحترمها.
- `persistentLocalCache` موجود — لا نستبدله، نضيف طبقة queue فوقه.

### 1.8 تناقض مع مرحلة 1 — PWA شرط سابق
**F-6 الأصلية ("إغلاق التبويب وإعادة فتحه والطابور موجود") لا تتحقق على الويب بلا PWA، لأن الموقع نفسه لا يفتح أوفلاين (صفحة الديناصور).** لذلك:
- **مرحلة 1 (PWA + رفض فوري + قراءة فقط + إشعار إصدار جديد)** هي **شرط سابق** لهذه الخطة، وليست مستقلة.
- التوصية المعتمدة: **مرحلة 1 أولًا → دورة الجاهزية (النسخ/الاستعادة/الضبط) → مرحلة 2 فقط إن أثبتت أرقام مرحلة 1 أن الانقطاع متكرر.**
- فائدة مرحلة 1 الإضافية: تسجيل مرات انقطاع الإنترنت ومدتها فعليًا أسبوعين، فتُقرر مرحلة 2 بأرقام لا بتخمين.

---

## 2) PLAN — كيف ننفذ (Architecture)

### 2.1 القرار المعماري (Option A — مُوصى به)
| الخيار | الوصف | الحكم |
|---|---|---|
| **A — طابور محلي + إعادة تشغيل نفس الـtransaction** | نحفظ `invoiceData` + `clientOpId` في IndexedDB؛ عند `online` نُعيد استدعاء `processSale` نفسها — الـ transaction تتولى قراءة العداد والمخزون والرصيد ذريًا | ✅ يحافظ على حواجز `services/api.ts` بلا تكرار منطق |
| B — كتابة تفاؤلية | نُظهر الفاتورة فورًا كـ "مؤكدة" | ❌ يكسر `dailyArchives` والرصيد |
| C — رفض البيع بلا إنترنت | نمنع الزر عند `!navigator.onLine` | ❌ يوقف البيع — مرفوض |

**الاختيار: A**

### 2.2 تدفق البيانات (مصحح — أخطاء P0-3 و P0-6 مصححة)
```
[POSPage.handleProcessSale]
      |
      +-- try: runTransactionWithRetry (online) --> success: toast + clearCart
      |
      +-- catch: error.code in ['unavailable','failed-precondition','network-request-failed'] 
                OR !navigator.onLine
                --> clientOpId = crypto.randomUUID() (مرة واحدة، محفوظ في isProcessing)
                --> try enqueueOfflineOp({type:'sale', clientOpId, uid, payload, createdAtLocal, occurredAtLocal: Date.now(), status:'pending'})
                    --> on success: clearCart (enqueue أولًا ثم clearCart)
                    --> on fail (IndexedDB غير متاح/ممتلئ): أبقِ السلة + toast "التخزين المحلي غير متاح — لا يمكن الحفظ أوفلاين"
                --> toast "حُفظ محليًا — سيُرسل تلقائيًا"

[OfflineQueueService]  (singleton)
  - storage: idb-keyval (IndexedDB) فقط — لا fallback localStorage (إن لم يتوفر IndexedDB نرفض تفعيل الطابور برسالة)
  - listens: window 'online'/'offline' + visibilitychange + periodic 15s poll — يُنظَّف عند unmount + يُوقف عند document.hidden
  - state machine: pending -> syncing (write-ahead في IndexedDB قبل البدء) -> done/failed
  - replay: for each pending oldest-first:
        1. ping getDocFromServer(doc(db,'counters','invoices')) بمهلة 3s — إن فشل/مهلة اعتبره offline (getDoc العادي يرجع من الذاكرة ويعطي "متصل" كاذب)
        2. preflight طازج: getDoc(users/{uid}) للتحقق hasCap('sell') + isPriceAccepted + discount/subtotal/total/quantity
        3. idempotency ذري (مصحح P0-3): داخل runTransaction:
             invoiceRef = doc(db,'invoices', op.clientOpId)  // clientOpId هو معرّف الوثيقة نفسه
             invoiceDoc = await transaction.get(invoiceRef)
             if (invoiceDoc.exists()) return "already done" بلا كتابة
             // ثم باقي قراءات transaction (counter, products, customer, archive) وكتاباتها كالمعتاد
             // transaction.set(invoiceRef, { ...payload, invoiceNumber: generated, occurredAtLocal: op.occurredAtLocal, createdAt: serverTimestamp(), origin:'offline-replay' })
        4. on success: mark done + store real invoiceNumber (done يُحذف بعد 7 أيام)
        5. on retryable (unavailable/aborted) => exponential backoff (انظر 2.3) — permission-denied لا يُعاد تلقائيًا (غالبًا دائم: حساب معطّل أو قدرة ممنوعة)
        6. on validation error => mark failed بلا إعادة
```

### 2.3 سياسة تكرار الانقطاع (Flapping)
- **Backoff أسي مع jitter:** 1 فور `online`، 2 بعد 5s، 3 بعد 15s، 4 بعد 30s، 5 بعد 60s — ثم `failed: needs-manual-retry`.
- **حد 5 محاولات تلقائية** — بعدها يحتاج ضغط يدوي.
- **كشف الاتصال الحقيقي:** `getDocFromServer` + مهلة 3s (لا `getDoc` ولا `navigator.onLine` وحده).
- **الإعدادات:** `OFFLINE_QUEUE_CONFIG = { maxAutoRetries:5, baseDelayMs:5000, maxOps:100 }` في `utils/offlineQueueConfig.ts` **أو** في `appSettings` — إن بقيت ثابتًا في الكود فهي تتطلب إعادة بناء؛ الادعاء السابق "يغيّرها المالك بلا إعادة بناء" حُذف — الصحيح: إما `appSettings` أو إعادة بناء.

### 2.4 نموذج البيانات
```ts
// IndexedDB store: offlineQueue (key: clientOpId)
interface QueuedOp {
  clientOpId: string;        // crypto.randomUUID() 8..64 — هو نفسه doc id للفاتورة عند المزامنة
  uid: string;               // getAuth().currentUser.uid لحظة الحفظ
  origin: 'offline-queue';
  type: 'sale';              // P2a: بيع فقط (D-6 — purchase/return مؤجل لـ P2b)
  payload: any;              // نفس شكل invoiceData (items/subtotal/total/paymentMethod/customerId/dailyArchiveId)
  createdAtLocal: number;
  occurredAtLocal: number;   // وقت البيع الفعلي (للتقارير — لا يُستخدم كـ createdAt الخادمي)
  status: 'pending' | 'syncing' | 'done' | 'failed';
  attempts: number;
  lastError?: string;
  invoiceNumberLocal?: string; // INV-LOCAL-<shortId> للعرض قبل المزامنة — لا يُكتب في Firestore
  invoiceNumberReal?: string;
  dailyArchiveId: string;      // اليومية التي كان البيع عليها لحظة الحفظ
}
```
- **Idempotency:** لا حقل `clientOpId` جديد ولا فهرس ولا تعديل قواعد — `clientOpId` هو `doc id` نفسه. الفحص `transaction.get(doc(db,'invoices',clientOpId))` ذري داخل المعاملة.
- **الترقيم:** المحلي `INV-LOCAL-…` لا يُكتب في Firestore أبدًا. الرقم الحقيقي يُولَّد داخل `processSale` أثناء الـ replay.
- **التواريخ:** `createdAt = serverTimestamp()` كما هو (وقت المزامنة)، و `occurredAtLocal` يحفظ وقت البيع الفعلي (للاستخدام المستقبلي — التقارير خارج نطاق P2).
- **الاحتفاظ:** `done` يُحذف بعد 7 أيام أو زر "مسح المكتمل"؛ `failed` يبقى حتى حذف يدوي؛ `getPendingOps()` لا ترجع `done`.
- **التقارير:** `occurredAtLocal` محفوظ فقط — لا يُعرض في التقارير ضمن P2.

### 2.5 التكامل مع القواعد والكود الحالي (مصحح)
- **`firestore.rules`:** **لا تغيير** — لا حاجة لقبول `clientOpId` ولا فهرس `clientOpId` (يسقط P0-2 و P0-7 السابقان). الـ replay يستخدم نفس `runTransactionWithRetry` ويحترم `lastNumber == last+1`. لا نشر قواعد ولا فهارس.
- **`services/api.ts` + `types.ts`:** `types.ts:Invoice` يضاف لها `occurredAtLocal?: number` و `origin?: string` (اختياريان للتوافق). `processSale` تُعدل لتقبل `clientOpId` كـ doc id: `doc(collection) → doc(db,'invoices',clientOpId)` عند وجوده، وإلا تولد id عشوائي كاليوم.
- **لا يمس `balance/openingBalance`** — يبقى Accepted Risk.

### 2.6 الواجهة (UX)
- **OfflineQueueDrawer:** زر عائم بجانب السلة يظهر عدّاد `pending`؛ Drawer يعرض `pending/syncing/done/failed` مع سبب الفشل وأزرار "إعادة المحاولة"/"حذف".
- **POSPage:** عند الحفظ المحلي يُفرغ السلة بعد نجاح enqueue + toast مميز.
- **الإعدادات:** قسم يعرض `lastSyncAt` وحجم الطابور.
- **منع إغلاق اليومية:** إن كان في الطابور عمليات `pending/syncing`، زر "إغلاق اليومية" في `SettingsPage` يُعطَّل مع tooltip "لا يمكن إغلاق اليومية — يوجد عمليات معلّقة لم تُزامن".

### 2.7 المخاطر والتخفيف (محدثة — قرارات عمل ناقصة)
| الخطر | التخفيف — **قرار للمالك** |
|---|---|
| `dailyArchive` أُغلقت قبل الـ replay (البضاعة خرجت والمال دُفع) | **خياران:** (أ) يُسجَّل في اليومية المفتوحة الحالية بعلامة "بيع متأخر" (`occurredAtLocal` يحفظ اليوم الأصلي)، (ب) يبقى `failed` ويُعاد فتح اليومية الأصلية يدويًا. **المقترح:** (أ) + منع إغلاق اليومية من نفس الجهاز ما دام فيه pending (2.6). **تنبيه محاسبي:** (أ) تُدخل نقدية الأمس في درج اليوم فقد يختل جرد الصندوق — قرارك مع محاسبك قبل اعتماد (أ) (سؤال §4.10). **يحتاج قرار مالك قبل REQ-OFF-04.** |
| مخزون لم يعد كافيًا عند المزامنة (جهاز آخر باع آخر قطعة) | **لا مخزون سالب — يخالف `firestore.rules:123,125` التي تشترط `quantity >= 0` فتُرفض الكتابة.** الحل: يبقى `failed: الكمية غير كافية` مع مسار واضح للمالك: يعدّل المخزون يدويًا (تصحيح جرد) ثم يضغط "إعادة المحاولة" من الطابور. لا تُمس القواعد. |
| تاريخ الفاتورة يظهر في يوم خاطئ بالتقارير | `createdAt` من الخادم (وقت المزامنة) + `occurredAtLocal` (وقت البيع الفعلي) محفوظان — **التقارير خارج نطاق P2** (لا REQ يمس `ReportsPage` ولا `utils/dashboardAggregation.ts` ولا حسابات الأرشيف) — `occurredAtLocal` للاستخدام المستقبلي فقط، أو يُحذف الادعاء "التقارير تعرض". |
| طابور ممتلئ (100) | نرفض البيع الجديد برسالة "الطابور ممتلئ — انتظر المزامنة" |
| `clientOpId` تصادم | `crypto.randomUUID()` — احتمال مهمل؛ وفحص transaction يحمي حتى لو حدث |
| IndexedDB غير متاح (تصفح خاص) | نرفض تفعيل الطابور برسالة واضحة — لا fallback هش لـ localStorage |

### 2.8 المقاييس والمراقبة
- كل replay ناجح/فاشل يُسجَّل في `clientErrors` مع `source:'offline-queue'`.
- عدّاد `pending` يُعرض في الـ drawer.
- **مرحلة 1 تسجل إضافيًا:** كل انقطاع `offline`/`online` مع مدته في `clientErrors` أو `appSettings.offlineStats` — لتقرير أسبوعين بأرقام حقيقية.

---

## 3) TASKS — تقسيم التنفيذ (كل REQ يتبع قالب `docs/req-template.md`)

> **الترتيب إلزامي — لا يبدأ REQ-OFF-01 قبل إغلاق 00. ولا يبدأ أي REQ-OFF قبل إنجاز مرحلة 1 (PWA) ودورة الجاهزية (انظر 1.8).**

### REQ-OFF-00 — القرار والأساس (قراءة فقط، بلا كود) — **لا يبدأ قبل موافقة المالك على هذه الوثيقة**
- **الملفات المسموحة:** `docs/backlog.md`, `docs/current-state-map.md`, `docs/known-issues.md`, `docs/SPEC-PLAN-OFFLINE-QUEUE-P2.md` (هذا الملف)
- **AC-01:** توثيق جواب "تكرار الانقطاع" (§4) + اعتماد معاملات 2.3 + قرارات قواعد العمل (§2.7: يومية مغلقة / مخزون سالب / occurredAtLocal) من المالك.
- **AC-02:** تثبيت `git tag pre-offline-queue-p2` على `perm-2026-09-done` + قياس خط الأساس: `tsc --noEmit` + `build` + `test:rules 340/340`.
- **AC-03:** تحديث `backlog.md` (In Progress OFF-00…06) + `current-state-map`.
- **Edge:** جواب ناقص / تعارض D-6 — القرار: P2a بيع فقط.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + `git tag` — **Commit:** `docs: REQ-OFF-00 offline-queue baseline + business decisions`

### REQ-OFF-01 — بنية التخزين والخدمة النقية (Pure)
- **الملفات المسموحة:** `services/offlineQueue.ts` (جديد), `utils/offlineQueueConfig.ts` (جديد), `tests/offlineQueue.test.ts` (جديد), `package.json` (إضافة `idb-keyval` فقط — بلا major bumps)
- **AC-01:** `enqueue(op)` يحفظ في IndexedDB فقط (لا fallback) + `dequeue/markDone/markFailed` تعمل بعد إغلاق التبويب (بشرط PWA أو إعادة فتح بعد رجوع الاتصال — F-6 معدلة).
- **AC-02:** حد 100 — الـ 101 تُرفض بخطأ عربي.
- **AC-03:** `getPendingOps()` ترجع oldest-first ولا ترجع `done`.
- **AC-04:** `clientOpId` مكرر يُرفض فورًا.
- **Edge:** فاضي/سعة/تكرار/IndexedDB غير متاح (تصفح خاص → رفض).
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + `npx vitest run tests/offlineQueue.test.ts` — **Commit:** `feat(offline-queue): REQ-OFF-01 pure storage + idb-keyval`

### REQ-OFF-02 — Idempotency عبر doc id + occurredAtLocal (بلا قواعد ولا فهارس)
- **الملفات المسموحة:** `types.ts` (Invoice.occurredAtLocal?, origin?), `services/api.ts` (قبول clientOpId كـ doc id), `tests/offlineIdempotency.test.ts`
- **AC-01:** `processSale` إن وُجد `clientOpId` تستخدم `doc(db,'invoices',clientOpId)` وإلا تولد id عشوائي (توافق).
- **AC-02:** الـ replay داخل `runTransaction` يقرأ `transaction.get(doc(db,'invoices',clientOpId))` — إن وجد يعتبرها done بلا كتابة (اختبار محاكي + race تبويبين).
- **AC-03:** `types.ts` يضيف `occurredAtLocal?: number` و `origin?: string` اختياريين — لا قواعد ولا فهارس ولا نشر.
- **AC-04:** لا يمس `balance/openingBalance` — Accepted Risk.
- **Edge:** `clientOpId` فارغ/طويل/مكرر — يُعامل كـ validation قبل enqueue.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `npm run test:rules` أخضر + `git diff --stat` — **Commit:** `feat(offline-queue): REQ-OFF-02 doc-id idempotency + occurredAtLocal`

### REQ-OFF-03 — تكامل POS (الحفظ المحلي عند الفشل)
- **الملفات المسموحة:** `pages/POSPage.tsx`, `services/offlineQueue.ts`, `stores/offlineQueueStore.ts` (Zustand جديد)
- **AC-01:** عند فشل `processSale` بسبب شبكة → توليد `clientOpId` مرة واحدة → `enqueue` أولًا → إن نجح `clearCart` + toast "حُفظ محليًا"؛ إن فشل أبقِ السلة.
- **AC-02:** نطاق P2a: بيع فقط — `processReturn`/`addCustomerPayment` مؤجل لـ P2b.
- **AC-03:** `isProcessing` يُحرر بعد الـ enqueue.
- **Edge:** ضغط مزدوج أثناء offline — يُنشئ عنصرًا واحدًا فقط.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + اختبار يدوي بقطع الشبكة — **Commit:** `feat(offline-queue): REQ-OFF-03 POS enqueue + clearCart`

### REQ-OFF-04 — محرك إعادة الإرسال (Replay Engine + Flapping Policy + قواعد الأعمال)
- **الملفات المسموحة:** `services/offlineQueue.ts`, `hooks/useOfflineReplay.ts` (جديد), `utils/offlineQueueConfig.ts`, `pages/SettingsPage.tsx` (منع إغلاق اليومية)
- **AC-01:** عند `online` يبدأ replay خلال ≤3s؛ كل عملية تُعاد بحد أقصى 5 محاولات 5/15/30/60s + jitter — بعدها `failed: needs-manual-retry`.
- **AC-02:** كشف اتصال حقيقي عبر `getDocFromServer(counters/invoices)` بمهلة 3s (لا `getDoc`).
- **AC-03:** أخطاء validation (سعر 50% + كمية + `discount>subtotal/total<0` ) → `failed` بلا إعادة؛ `unavailable/aborted` → إعادة؛ `permission-denied` → `failed` فورًا بلا إعادة (حساب معطّل/قدرة ممنوعة).
- **AC-04:** قواعد الأعمال: (أ) يومية مغلقة → حسب قرار المالك (§2.7 + أثر جرد الصندوق §4.10)، (ب) مخزون غير كافٍ → `failed` مع مسار تعديل المخزون ثم إعادة المحاولة (لا سالب — يخالف `firestore.rules:123,125`)، (ج) `occurredAtLocal` يُحفظ دائمًا (لا عرض في التقارير ضمن P2).
- **AC-05:** ترتيب oldest-first + `syncing` write-ahead + `navigator.locks` إن متاح + تنظيف المستمعين عند unmount/إيقاف poll عند `document.hidden` + منع إغلاق اليومية إن وجد pending.
- **Edge:** flapping كل 2s / انقطاع ساعات / تبويبان متزامنان.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + اختبارات محاكي flapping — **Commit:** `feat(offline-queue): REQ-OFF-04 replay engine + business rules`

### REQ-OFF-05 — الواجهة (Drawer + حالات)
- **الملفات المسموحة:** `components/OfflineQueueDrawer.tsx` (جديد), `pages/POSPage.tsx` (زر العداد), `pages/SettingsPage.tsx` (قسم الحالة), `stores/offlineQueueStore.ts`
- **AC-01:** عدّاد `pending` ظاهر (لا يخفي تبويب التقارير/الأرشيف — D-2)؛ Drawer يعرض `pending/syncing/done/failed` مع سبب الفشل.
- **AC-02:** زر "إعادة المحاولة" يدوي لكل `failed` + "حذف" مع تأكيد.
- **AC-03:** Accessibility: `aria-live` + نصوص عربية سليمة.
- **Edge:** شاشة صغيرة / وضع داكن.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + مراجعة يدوية على موبايل — **Commit:** `feat(offline-queue): REQ-OFF-05 drawer UI`

### REQ-OFF-06 — الإغلاق والمراقبة
- **الملفات المسموحة:** `services/monitoring.ts`, `docs/backlog.md`, `docs/changelog.md`, `docs/current-state-map.md`, `docs/known-issues.md`
- **AC-01:** كل replay ناجح/فاشل يُسجَّل في `clientErrors` مع `source:'offline-queue'`.
- **AC-02:** تحديث `backlog` (Done) + `changelog` + `current-state-map`.
- **AC-03:** `npm run test:rules` أخضر + `build` نظيف + `git diff --stat` يطابق allowed-files.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `npm run test:rules` + Guard Review كامل — لا READY بدون 100% — **Commit:** `docs: REQ-OFF-06 offline-queue hardening + closeout`

---

## 4) أسئلة للمالك قبل الانطلاق (تحتاج جوابًا صريحًا)

1.  **تكرار الانقطاع:** كم مرة ينقطع الإنترنت في المحل تقريبًا (يوميًا/أسبوعيًا/نادرًا)، وكم تستمر عادةً (ثوانٍ/دقائق/ساعات)؟ — **هذا السؤال وحده يحسم جدوى مرحلة 2** (إن كان نادرًا/ثوانٍ فمرحلة 1 تكفي).
2.  **نطاق الطابور:** بيع فقط (P2a) أم مرتجع/دفعات أيضًا؟ **المقترح: بيع فقط ✓**
3.  **حد الطابور:** هل 100 كافية؟ **المقترح: 100 ✓**
4.  **الترقيم المؤقت:** هل تقبل عرض `INV-LOCAL-…` واضح؟ **المقترح: نعم ✓**
5.  **عدد أجهزة الكاشير:** هل لديك أكثر من جهاز يبيع في نفس الوردية؟ (يؤثر على قفل التزامن)
6.  **تأخر الرقم الحقيقي:** هل تقبل إيصالًا مؤقتًا مكتوبًا عليه "مؤقت" حتى المزامنة؟ **المقترح: نعم ✓**
7.  **اليومية أُغلقت قبل المزامنة:** هل يُسجَّل البيع في اليومية المفتوحة الحالية بعلامة "بيع متأخر" (البضاعة خرجت) أم يبقى `failed`؟ **المقترح: (أ) بيع متأخر + منع إغلاق اليومية إن وجد pending**
8.  **المخزون غير كافٍ عند المزامنة:** يبقى `failed: الكمية غير كافية` مع مسار: المالك يعدّل المخزون يدويًا ثم "إعادة المحاولة" — لا مخزون سالب (يخالف `firestore.rules:123,125`).
9.  **وقت الفاتورة:** هل توافق على `occurredAtLocal` (وقت البيع الفعلي) بجانب `createdAt` الخادمي؟ **المقترح: نعم — محفوظ فقط، التقارير خارج نطاق P2**
10. **أثر "البيع المتأخر" على جرد الصندوق:** نقدية الأمس تُدخل درج اليوم فقد يختل الجرد — هل توافق مع محاسبك على (أ) قبل اعتمادها؟

> **لا يبدأ REQ-OFF-00 قبل جواب 1 على الأقل + اعتماد هذه الوثيقة. الأسئلة 2/3/4/6/9 لها اقتراحات معتمدة — يكفي تأكيدها. المرحلة 2 مؤجلة حتى تنتهي مرحلة 1 وتُجمع أرقام الانقطاع.**

---

## 5) توصية الترتيب (من المراجع الحقيقي — معتمدة)

1.  **مرحلة 1 (رفض فوري + قراءة فقط + PWA + إشعار إصدار جديد):** تكلفتها صغيرة، وفيها فائدة إضافية: تسجيل مرات انقطاع الإنترنت ومدتها فعليًا أسبوعين، فتُقرر مرحلة 2 بأرقام لا بتخمين.
2.  **دورة الجاهزية (النسخ والاستعادة والضبط — Backup/Restore/Reset):** قبل أي طابور معقد.
3.  **مرحلة 2 (هذا المستند) فقط إن أثبتت أرقام مرحلة 1 أن الانقطاع متكرر.**

> **رسالة للوكيل:** لا تبدأ REQ-OFF-00. هذه الوثيقة هي المرجع. لا تنفّذ شيئًا قبل موافقة المالك.

---

*نهاية المسودة المعدلة — بانتظار موافقة المالك وجواب السؤال 1.*
