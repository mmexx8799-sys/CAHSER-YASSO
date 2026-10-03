# TX3-UI — خطة التنفيذ v2 (وثيقة فقط، بلا كود)

- **v2 — تعديلات قبل أي كود** (قرارات المالك: (1) نافذة مخصصة بأزرار مسماة والإجراء
  الآمن افتراضي؛ (2) إبقاء نص الخدمة + نسخ الصفحات؛ (3) ترك التوست المزدوج):
  (أ) حسم الحالات الثلاث in-session/restored/changed (§2)؛ (ب) `clear(flow)` فوري عند
  عدم التطابق (§4-4)؛ (ج) نافذة مخصصة بأزرار مسماة والإجراء الآمن افتراضي (§5)؛
  (د) دالة `submitWithOpKey` النقية (§2/§6)؛ (هـ) مولد UUID احتياطي (§2)؛
  (و) `forget(flow)` وسلوك غياب التخزين (§2).

- **الحالة:** خطة على فرع `docs/audit-tx-3-ui-plan` مبنية على `origin/master = 7dccf91`
  (دمج طبقة API لـ AUDIT-TX-3 — PR #16). هذه الوثيقة وحدها هي ناتج هذه الخطوة؛
  **لم يُمس أي ملف كود** (يُتحقق بـ `git diff --stat` قبل الـcommit: ملف واحد فقط).
- **المرجع التصميمي:** `docs/AUDIT-TX-3-DESIGN.md` (§ الحسم v4.1 + ملاحظات التنفيذ لكل خطوة).
- **القاعدة الملزمة من طبقة API:** `opts.opKey` اختياري في كل `process*` والدفعتين؛
  بلا مفتاح يبقى السلوك القديم بايت-مطابق (مسار عشوائي). أي ربط UI خاطئ يعود
  تلقائيًا للسلوك الحالي — لا انكسار صامت.

## 0) جرد نقاط الاستدعاء الفعلية (pages/* فقط — لا شيء في components/stores)

| # | الدالة | الملف:السطر | المعالج | الوسائط الحالية | عند النجاح (المسح) | عند الفشل |
|---|---|---|---|---|---|---|
| 1 | `processSale` | `pages/POSPage.tsx:173` (`CartModal.handleProcessSale` `:165-195`) | `{items: cart, subtotal, discount, total, paymentMethod, customerId ('' للنقدي), dailyArchiveId}` | `clearCart()` (`stores/posCartStore.ts:134-140`) `:182` + إغلاق الدفع `:183` + `onSaleComplete()` `:184` — بلا toast صفحة (الخدمة فقط) | catch `:185-192`: offline→رسالته، وإلا toast عام صفحة. السلة **تبقى** |
| 2 | `processPurchase` | `pages/SupplierAccountPage.tsx:888` (`PurchaseModal.handleConfirmPurchase` `:884-909`) | `{items (price قابل للتحرير), subtotal, total=subtotal, supplierId}` | `onComplete()` `:899` → إغلاق المودال فقط؛ مسح `items` عند الإغلاق (`useEffect [isOpen]` `:833-840`) — بلا toast صفحة | صامت جزئيًا: offline→toast، وإلا `console.error` فقط (إشارة الخدمة هي المرئية). العناصر **تبقى** |
| 3 | `processSupplierReturn` | `pages/SupplierAccountPage.tsx:1127` (`SupplierReturnModal.handleConfirmReturn` `:1123-1146`) | `(items, supplier.id)` | `onComplete()` `:1136` → إغلاق فقط؛ نفس نمط المسح عند الإغلاق (`:1083-1090`) — بلا toast صفحة | نفس النمط الصامت. العناصر **تبقى** |
| 4 | `processReturn` | `pages/ReturnsPage.tsx:210` (`ReturnCartModal.handleProcessReturn` `:189-225`) | `(returnCart, dailyArchive.id, customer? {id,name}, originalInvoiceId \|\| undefined)` | `clearCart()` (`stores/returnCartStore.ts:153-160`) `:211` + تصفير العميل/البحث `:212-213` + إغلاق `:214` — بلا toast صفحة | catch `:215-224` + toast عام صفحة. السلة **تبقى** |
| 5 | `addCustomerPayment` | `pages/CustomerAccountPage.tsx:59` (`handleSubmit` `:49-72`) | `{customerId, amount: Number(amount), notes}` | toast صفحة `:60` + toast خدمة (مزدوج اليوم)؛ `setAmount('')` `:61` + `setNotes('')` `:62` | catch `:63-68` + toast عام صفحة. النموذج **يبقى** |
| 6 | `addSupplierPayment` | `pages/SupplierAccountPage.tsx:65` (`handleSubmit` `:55-78`) | `{supplierId, amount, notes}` | مرآة العميل (`:66-68`، مزدوج) | مرآة العميل. النموذج **يبقى** |

- أزرار الإرسال: "تأكيد الدفع" (`POSPage.tsx:435-438`)، "تأكيد الإرجاع" (`ReturnsPage.tsx:410-424`)،
  "حفظ" (الدفعتان: `CustomerAccountPage.tsx:755-761`، `SupplierAccountPage.tsx:777-783`)،
  مودالا الشراء/مرتجع المورد بخطوتين (تأكيد مخصص `:1005/:1039-1045` و`:1242/:1263-1269`).
- `confirm()` قبل الإرسال موجود فقط في `ReturnsPage.tsx:201-204` (مرتجع مرتبط بعميل)؛
  المزود `ConfirmationProvider` عام (`App.tsx:292-304`) — كل الصفحات تستطيع `useConfirmation()`.
- نجاح الخدمات داخلي دائمًا: `sales.ts:163`، `purchases.ts:150/272`، `returns.ts:244`،
  `customers.ts:177`، `suppliers.ts:176`. فروع `OpKeyMismatchError` تُظهر رسالتها مرة واحدة:
  `sales.ts:166-170`، `purchases.ts:153-157/275-279`، `returns.ts:247-251`،
  `customers.ts:180-184`، `suppliers.ts:179-183`.

## 1) حالة السلة/المخزن (محققة — تؤثر على سيناريو الحسم)

**لا شيء يبقى بعد إعادة التحميل.** `stores/` ملفان فقط (`posCartStore.ts`، `returnCartStore.ts`)
بـ`create()` عادي بلا `persist`؛ مودالا الشراء/مرتجع المورد `useState([])`؛ نماذج الدفع
`useState('')`. `sessionStorage` صفر استخدام في الكود؛ `localStorage` مفتاح `theme` فقط
(`contexts/ThemeContext.tsx:14,25`).

**الأثر:** بعد reload السلة فارغة دائمًا، لكن سجل `sessionStorage` (tab-scoped، يبقى بعد
reload نفس التبويب) يبقى — وهذا هو أساس مسار restored: سجل موجود + ذاكرة فارغة + سلة
أُعيد بناؤها → تُقارن بصمة السلة المعاد بناؤها ببصمة السجل عند الإرسال التالي (§4).
المسح عند التحميل (sweep) يقتصر على انتهاء TTL — لا يُحذف سجل لمجرد فراغ السلة.

## 2) تصميم `utils/opKeyStore.ts` (وحدة نقية، بلا React)

```ts
// أنواع مقترحة (قابلة للاختبار بلا متصفح):
type TxFlow = 'sale' | 'purchase' | 'supplierReturn' | 'return' | 'customerPayment' | 'supplierPayment';
interface OpIdentity { fp: OpFingerprint; extra: Record<string, string | null>; }
  // extra حسب المسار: sale {paymentMethod} · return {originalInvoiceId, dailyArchiveId} · الباقي {}
interface OpRecord { key: string; identity: OpIdentity; createdAt: number; }
interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; }
interface RecordedInfo { exists: boolean; number?: string; amount?: number; }
// الحسم — ثلاث حالات محسومة (لا غموض):
type Verdict =
  | { kind: 'reuse'; key: string; via: 'memory' | 'restored' };
    // (a) مفتاح في الذاكرة + هوية متطابقة → reuse بلا أي حسم؛
    // (b) سجل جلسة فقط + هوية متطابقة + getDoc غائب → reuse (يُتبنَّى في الذاكرة)
  | { kind: 'fresh'; key: string; rotated: boolean };
    // بلا سجل → مفتاح جديد؛ (c) مع getDoc(القديم) غائب → تدوير صامت (rotated=true، يُكتب فوق القديم)
  | { kind: 'needs-decision'; key: string; context: 'restored-same' | 'changed'; recorded: RecordedInfo };
    // (b) سجل جلسة فقط + هوية متطابقة + getDoc موجود → نافذة خيارين؛
    // (c) هوية مختلفة + getDoc(القديم) موجود → إشعار + خياران
// الغلاف النقي — الصفحات تبني الهوية فقط وتستدعيه:
type SubmitResult =
  | { outcome: 'sent' }                    // أُرسل ونجح (شامل no-op) — المفتاح مُسح
  | { outcome: 'finished-without-send' }    // نفس العملية مسجلة — أُنهي بلا إرسال — المفتاح مُسح
  | { outcome: 'aborted' }                  // المستخدم ألغى — كل شيء بقي كما هو
  | { outcome: 'mismatch' };                // عدم تطابق من الخدمة — المفتاح مُسح فورًا، السلة/النموذج بقيت
async function submitWithOpKey(
  flow: TxFlow,
  identity: OpIdentity,
  send: (key: string) => Promise<void>,   // الصفحة تستدعي الخدمة؛ تنجح عند النجاح (شامل no-op) وترمي عند الخطأ
  deps: {
    decide: (info: { context: 'restored-same' | 'changed'; recorded: RecordedInfo; flow: TxFlow }) => Promise<'finish' | 'proceed-new' | 'abort'>;
    uuid?: () => string; now?: () => number; storage?: KeyValueStorage;
    getRecordDoc?: (flow: TxFlow, key: string) => Promise<RecordedInfo>;
  },
): Promise<SubmitResult>;   // أخطاء send غير عدم-التطابق تُعاد رميها (المفتاح يبقى لإعادة الضغط)
```

- **مفتاح التخزين:** `tx-opkey:<flow>` — سجل واحد لكل عملية/مسار.
- **السجل:** `{key, fingerprint(identity كاملة JSON), createdAt}` — TTL **20 دقيقة**.
- **التوليد (احتياطي متدرج — `randomUUID` غير متاح في WebView القديم):**
  `crypto.randomUUID?.()` → `crypto.getRandomValues` (بناء v4 يدويًا) →
  `Math.random` (بناء v4 يدويًا). تُحقن الدالة (`uuid?`) للاختبار؛ اختبار يثبت
  مطابقة كل مسار احتياطي لـ `UUID_V4_RE` (يُصدَّر من `opKey.ts` في REQ-UI-0 — إضافة
  جمعية بلا تغيير سلوك).
- **الحمل في الذاكرة:** `Map<TxFlow, {key, identity}>` داخل الوحدة + مرآة `sessionStorage`
  (تُكتب معًا، تُقرأ الذاكرة أولًا).
- **إسقاط الذاكرة صراحة — `forget(flow)`** (يسقط الذاكرة فقط، سجل الجلسة يبقى لمسار
  restored): (أ) إفراغ السلة يدويًا (`clearCart` وأخواتها) ومسح النماذج عند الإغلاق؛
  (ب) داخليًا عبر `clear()`؛ (ج) داخليًا عبر `rotate()` (يستبدل القديم بالجديد)؛
  (د) انحراف البصمة بلا سجل حي: `prepare` يرى ذاكرة≠هوية ولا سجل صالحًا → مسار `fresh`
  (نسيان ضمني + توليد). تُحفظ الذاكرة عمدًا عند تعديل السلة بعد فشل غامض — كشف
  الانحراف (الحالة c) يتطلب الهوية القديمة.
- **غياب التخزين:** كل عمليات `sessionStorage` داخل try/catch + حارس
  `typeof sessionStorage === 'undefined'` → وضع "ذاكرة فقط" (in-session يعمل، ومسار
  restored غير متاح بعد reload — يُوثَّق لا يُعالج).
- **دوال:** `prepare(flow, identity, deps) → Verdict` (تُنفذ الحالات الثلاث أعلاه) ·
  `submitWithOpKey(...)` (الغلاف: حسم + مسح عند النجاح + `clear` فوري عند عدم التطابق +
  إعادة رمي غيره) · `rotate(flow) → key` · `clear(flow)` (ذاكرة + جلسة، عند النجاح
  وعند عدم التطابق) · `forget(flow)` (ذاكرة فقط) · `sweep(now?)` (منتهي TTL فقط) ·
  `peek(flow)` (للتشخيص/الاختبار).
- **قاعدة الإخفاق (ملزمة):** فشل `getRecordDoc` (رفض أو مهلة ~5 ثوانٍ) في مساري
  (b)/(c) → `{aborted, reason:'lookup-failed'}` بلا إرسال وبلا مسح للسجل — يُعاد
  الحسم تلقائيًا عند الضغط التالي.
- **الحقن (Injectable seams) للاختبار بلا متصفح:** `storage: KeyValueStorage`
  (الإنتاج: مغلف `sessionStorage`؛ الاختبار: `Map`-backed fake)، `now: () => number`
  (ساعة مزيفة)،   `getRecordDoc: (flow, key) => Promise<{exists, number?, amount?}>`
  (الإنتاج: `getDoc` من `services/firebase`؛ الاختبار: fake). الوحدة نفسها **بلا
  React وبلا firebase** — جدول `FLOW_META` (المجموعة + الأسماء، §5) يُضمَّن
  كبيانات.
- **الصيغة واحدة:** الوحدة تستورد `buildFingerprint`/`docFingerprint`/`fingerprintsEqual`
  من `services/api/opKey` (وحدة نقية موثقة بلا firebase) — لا صيغة مكررة. بناة الهوية
  (§3) يبنون كائن وسائط الخدمة أولًا ثم يشتقون الهوية منه (مصدر واحد).
- **فساد السجل:** `JSON.parse` داخل try/catch → يُعامل كغائب + يُكتب فوقه عند الإرسال التالي.

## 3) بناة الهوية لكل مسار (من كائن وسائط الخدمة نفسه)

| المسار | `fp` (عبر `docFingerprint`) | `extra` | ملاحظة |
|---|---|---|---|
| sale | pairs + total + subtotal + discount + party=`customerId ?? null` (مع `''` للنقدي كما يُرسل) | `{paymentMethod}` (تُقارن الخدمة به منفصلًا `sales.ts:55`) | الهوية من كائن `{items,subtotal,total,...}` قبل الاستدعاء |
| purchase | pairs + total + subtotal + discount + party=`supplierId` | `{}` | من كائن الفاتورة نفسه |
| supplierReturn | pairs + total=نفس `reduce` الخدمة + party=`supplierId` | `{}` | الواجهة تُعيد نفس `reduce` الخام للهوية فقط (الخدمة مصدر الحقيقة) |
| return | pairs + total=نفس `reduce` + party=`customer?.id` | `{originalInvoiceId: linked بعد trim/undefined, dailyArchiveId}` | `linkedInvoiceId` المطبَّع لا الخام |
| customerPayment | `{items: [], total: amount, customerId}` | `{}` | `notes` خارج الهوية (موثق) |
| supplierPayment | `{items: [], total: amount, supplierId}` | `{}` | `notes` خارج الهوية (موثق) |

المقارنة: `fingerprintsEqual(a.fp, b.fp)` + مساواة كل `extra` (null-normalized).

## 4) الربط بكل شاشة (أين يُولَّد/يُبنى/يُمسح + الإشعار + متى لا تُفرَّغ السلة)

النمط الموحد في كل معالج إرسال (بعد تحققات الصفحة الحالية): الصفحة تبني كائن وسائط
الخدمة كما اليوم → تشتق الهوية → تستدعي `submitWithOpKey(flow, identity, send, deps)`
حيث `send = (key) => <استدعاء الخدمة بالمفتاح>` و`decide` تفتح نافذة §5 المخصصة:

1. `prepare` داخلي: (a) ذاكرة + هوية متطابقة → إرسال بنفس المفتاح بلا حسم؛ بلا سجل →
   توليد وإرسال؛ (b)/(c) كما في §2 (getDoc أولًا ثم `needs-decision` أو تدوير صامت).
2. `needs-decision` → `decide()`: `finish` = إنهاء بلا إرسال (`clear` + نتيجة
   `finished-without-send` → الصفحة تُجري تنظيف النجاح المعتاد + toast نجاح صفحي
   بنص الخدمة نفسه)؛ `proceed-new` = `rotate()` + إرسال (عملية جديدة)؛ `abort` =
   نتيجة `aborted` (كل شيء يبقى).
3. نجاح `send` (شامل no-op) → `clear(flow)` + نتيجة `sent` → الصفحة تمسح السلة/النموذج
   **كما هو اليوم** (الجدول §0).
4. `catch` من الخدمة بـ`(e as any)?.code === OP_KEY_MISMATCH_CODE`
   (يُستورد من `services/api/opKey:6`): `submitWithOpKey` تُنفذ `clear(flow)` **فورًا**
   (ذاكرة + جلسة — المفتاح كان مقيدًا بعملية أخرى، فيُولَّد جديد عند الإرسال التالي)
   وتُرجع `mismatch`؛ الصفحة **لا تمس السلة/النموذج إطلاقًا** + تكتم toastها العام +
   تفتح إشعار عدم التطابق (§5). أخطاء `send` الأخرى تُعاد رميها (المفتاح والسلة يبقيان
   لإعادة الضغط — لا تغيير على المسار الحالي).
5. reload/restored: **له كود خاص داخل `prepare`/`submitWithOpKey` لا في الصفحة** —
   ذاكرة فارغة + سجل جلسة صالح: هوية متطابقة → `getRecordDoc` (موجود =
   `needs-decision[restored-same]`، غائب = `reuse` مع تبنٍّ في الذاكرة)؛ هوية مختلفة →
   كالحالة (c). الصفحة تمرر الهوية فقط ولا تفرّع.

مواضع الإرسال الستة (§0): `POSPage.tsx:173`، `SupplierAccountPage.tsx:888`،
`SupplierAccountPage.tsx:1127`، `ReturnsPage.tsx:210`، `CustomerAccountPage.tsx:59`،
`SupplierAccountPage.tsx:65`. الدفعتان تُدخلان `opKey` داخل كائن الدفعة؛ الباقي `opts` أخيرًا
(المرتجع: السادس بعد `undefined` للخامس).

## 5) إشعار الحسم والخياران + نصوص عدم التطابق لكل مسار

- **الأداة (قرار المالك 1): مكوّن مخصص صغير** `components/OpKeySettleDialog.tsx`
  (props: `title/message/primaryLabel/secondaryLabel` → `Promise<'primary'|'secondary'|'dismissed'>`
  حيث Esc/X = `dismissed`؛ z-index فوق مودالات الشراء/المرتجع المخصصة — يُتحقق أثناء QA):
  **الإجراء الآمن (إنهاء بلا كتابة / مراجعة) هو الافتراضي** — زر primary مميز + autofocus
  + Enter، وEsc = الآمن. `decide()` الصفحات تفتحه وتترجم النتيجة: `restored-same`:
  primary→`finish`، secondary→`proceed-new`، dismissed→`abort`؛ `changed`: primary→`abort`
  (مراجعة وإبقاء)، secondary→`proceed-new`، dismissed→`abort`؛ إشعار `mismatch`:
  primary/dismissed→إغلاق (مراجعة)، secondary→إعادة إرسال فورية بمفتاح جديد.
- **نص كل زر لكل مسار وحالة** (`<noun>` = فاتورة بيع / فاتورة شراء / مرتجع مورد /
  مرتجع / دفعة عميل / دفعة مورد):
  - `restored-same` (مسجل بنفس الهوية): primary «إنهاء — <noun> مسجّلة» (بلا إرسال)؛
    secondary «عملية جديدة».
  - `changed` (هوية مختلفة والقديم موجود): primary «مراجعة (إبقاء السلة)»؛
    secondary «عملية جديدة برقم مستقل».
  - `mismatch` (من الخدمة): primary «مراجعة آخر <noun>» (إغلاق بلا مسح)؛
    secondary «إعادة الإرسال كعملية جديدة» (تدوير + إرسال فوري).
  - العنوان دائمًا: `عملية مسجلة مسبقًا — <اسم المسار>`؛ المتن يذكر المسجَّل (الرقم من
    `getRecordDoc` عند توفره، أو المبلغ للدفعات).
- **إشعار عدم التطابق** يفتح من نتيجة `mismatch` (لا من `catch` مباشرة)؛ السلة/النموذج
  لا يُمسّان أبدًا هنا (المفتاح وحده مُسح).
- **النصوص المقترحة** (جدول `FLOW_META`: المجموعة + الاسم + نص عدم التطابق):
  - sale: «هذا البيع مسجّل مسبقًا بنفس المحتوى — راجع آخر فاتورة»
  - purchase: «فاتورة الشراء هذه مسجّلة مسبقًا — راجع آخر فاتورة شراء»
  - supplierReturn: «مرتجع المورد هذا مسجّل مسبقًا — راجع آخر مرتجع»
  - return: «هذا المرتجع مسجّل مسبقًا — راجع آخر مرتجع»
  - customerPayment: «هذه الدفعة مسجّلة مسبقًا — راجع آخر دفعة عميل»
  - supplierPayment: «هذه الدفعة مسجّلة مسبقًا — راجع آخر دفعة مورد»
- **أين يُعدَّل للدفعات بلا كسر الاختبارات:** في **الصفحة فقط**
  (`CustomerAccountPage.tsx:63-68` / `SupplierAccountPage.tsx:69-74`: فرع `code` يعرض
  نص المسار ويكتم العام). نص الخدمة (`opKey.ts:28`، يذكر "فاتورة") **لا يُمس** —
  اختبارات API الستة تثبّت `error.message` ونص الـtoast (`MISMATCH_MSG`) وعدد المناداة (1)،
  ولا توجد أي اختبارات صفحات قد تتأثر. toast الخدمة يبقى الإشارة العابرة؛ الإشعار هو
  المرجع بالنص الصحيح. (بديل مؤجل: برمجة نص الخدمة لكل مسار — يكسر تأكيدات 6 ملفات
  اختبار ويتطلب تحديثها؛ يُقترح فقط إذا طلب المالك توحيدًا كاملًا.)

## 6) خطة الاختبارات والمخاطر وترتيب REQs

- **وحدة المخزن + الغلاف** (`tests/opKeyStore.test.ts` — vitest بيئة `node` الحالية،
  بلا DOM؛ fakes للـstorage والساعة و`getRecordDoc` و`uuid` و`send` و`decide`):
  توليد/إعادة-استخدام (`via: memory/restored`)/تدوير صامت (`rotated`)/`clear`/`forget`/
  مسح؛ سجل واحد لكل مسار؛ TTL (قبل/بعد 20 دقيقة)؛ سجل فاسد؛ غياب التخزين (ذاكرة فقط)؛
  مولد UUID: `randomUUID` + `getRandomValues` + `Math.random` — الثلاثة تطابق
  `UUID_V4_RE` (المصدَّر من `opKey.ts`)؛ مصفوفة `submitWithOpKey`: `fresh→sent` +
  مسح، `reuse→sent`، `needs-decision→finish/proceed-new/abort` (بلا إرسال/بتدوير/
  بلا تغيير)، `send` ترمي mismatch → `clear` فوري + `{mismatch}`، `send` ترمي غيره →
  إعادة رمي والمفتاح باقٍ؛ إخفاق البحث (رفض/تعليق بساعة مزيفة) → `{aborted,
  lookup-failed}` بلا إرسال وبلا مسح للسجل. + **اختبار تعاقد**: هوية مبنية
  من تجهيزات `tx3*` تطابق بصمة الخدمة (`fingerprintsEqual` على الجانبين).
- **المكوّن المخصص** (`OpKeySettleDialog`) لا يُختبر آليًا (بلا DOM) — QA يدوي: الأزرار
  المسماة لكل حالة، الافتراضي الآمن (Enter/Esc)، الظهور فوق مودالات الشراء/المرتجع.
- **تكامل ضمن الإعداد الحالي:** مغطى خدميًا (`tx3*`: 68 اختبارًا). ربط الصفحات **لا يمكن**
  اختباره آليًا اليوم (vitest `environment: 'node'`، بلا Testing Library/jsdom في
  الاعتماد المباشر، وsingletons تحتاج محاكيًا) — يُتحقق **يدويًا** بقائمة per-screen:
  نجاح يمسح المفتاح+السلة؛ فشل غامض + إعادة ضغط = no-op؛ تعديل السلة = إشعار + الخياران؛
  عدم تطابق = بلا مسح؛ reload + إعادة بناء = مسار restored؛ TTL.
- **المخاطر:** (1) انحراف هوية الواجهة عن مقارنة الخدمة → يُخفَّف ببناء الهوية من كائن
  الوسائط نفسه وإعادة استخدام `opKey.ts` (صيغة واحدة)؛ (2) toast مزدوج عند عدم التطابق →
  فرع `code` يكتم عام الصفحة (toast الخدمة الوحيد + الإشعار)؛ والمفتاح يُمسح فورًا
  فيُبنى جديد عند الإرسال التالي (لا إعادة استخدام لمفتاح مقيد بعملية أخرى)؛
  (3) سجل فاسد/امتلاء → try/catch ومعاملة كغائب؛ (4) تبويبان معًا — حارس الخدمة مصدر الحقيقة (مفتاح مشترك
  + بصمة = عملية واحدة)؛ النقر المزدوج بنفس التبويب محمي أصلًا بـ`withInFlightGuard`؛
  (5) المكوّن المخصص صغير ومعزول (لا يمس المودالات القائمة)؛ يُتحقق من z-index فوق
  مودالي الشراء/المرتجع أثناء QA؛
  (6) انحراف `''` مقابل `null` لعميل النقدي → القاعدة: الهوية من القيمة المُرسلة فعلًا.
- **ترتيب REQs (واحد + commit واحد لكل):** REQ-UI-0 المخزن (`opKeyStore.ts`:
  الأنواع + `prepare` + `submitWithOpKey` + مولد UUID الاحتياطي + `FLOW_META`/النسخ)
  + المكوّن (`OpKeySettleDialog.tsx`) + تصدير `UUID_V4_RE` من `opKey.ts` (جمعي) +
  اختبارات الوحدة؛ REQ-UI-1 شاشة البيع؛ REQ-UI-2 فاتورة الشراء؛ REQ-UI-3 مرتجع المورد؛
  REQ-UI-4 المرتجعات؛ REQ-UI-5 الدفعتان معًا؛ كل REQ: ربط + QA يدوي + سطرا
  backlog/changelog. TX3-UI يُغلق بتقرير عدّادات + `test:rules` كاملة.

## 7) قرارات المالك (محسومة في v2 — للتوثيق)

1. نافذة مخصصة بأزرار مسماة (لا `confirm` العام) + الإجراء الآمن افتراضيًا — §5.
2. إبقاء نص الخدمة "فاتورة" + نسخ الصفحات (§5) — لا يُفتح بديل البرمجة إلا بقرار جديد.
3. ترك التوست المزدوج الحالي للدفعات — خارج نطاق TX3.
