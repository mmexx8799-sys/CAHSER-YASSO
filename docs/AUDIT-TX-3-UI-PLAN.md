# TX3-UI — خطة التنفيذ (وثيقة فقط، بلا كود)

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
type Verdict =
  | { kind: 'fresh' }                          // بلا سجل → مفتاح جديد
  | { kind: 'reuse'; key: string }             // سجل بنفس الهوية → نفس المفتاح
  | { kind: 'needs-decision'; key: string; recorded?: { number?: string; amount?: number } };
    // سجل بهوية مختلفة: getDoc(oldKey) موجود → إشعار + خياران؛ غائب → تدوير صامت (داخلي)
```

- **مفتاح التخزين:** `tx-opkey:<flow>` — سجل واحد لكل عملية/مسار.
- **السجل:** `{key, fingerprint(identity كاملة JSON), createdAt}` — TTL **20 دقيقة**.
- **التوليد:** `crypto.randomUUID()` (يطابق `UUID_V4_RE` في `opKey.ts:10`).
- **الحمل في الذاكرة:** `Map<TxFlow, {key, identity}>` داخل الوحدة + مرآة `sessionStorage`
  (تُكتب معًا، تُقرأ الذاكرة أولًا).
- **دوال:** `prepare(flow, identity, deps) → Verdict` · `rotate(flow) → key` (تدوير صامت:
  حذف القديم + توليد + تخزين) · `clear(flow)` (عند النجاح فقط) · `sweep(now?)` (حذف
  منتهي TTL فقط) · `peek(flow)` (للتشخيص/الاختبار).
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

النمط الموحد في كل معالج إرسال (بعد تحققات الصفحة الحالية، قبل استدعاء الخدمة):

1. ابنِ كائن وسائط الخدمة كما اليوم تمامًا → اشتق الهوية → `prepare(flow, identity)`.
2. `fresh` → استدعِ الخدمة بالمفتاح الجديد. `reuse` → استدعِ بنفس المفتاح.
   `needs-decision` → افتح إشعار الحسم (§5)؛ تأكيد = `rotate()` + استدعاء (عملية جديدة)؛
   إلغاء = إجهاض (كل شيء يبقى).
3. نجاح الخدمة → `store.clear(flow)` + مسح السلة/النموذج الحالي **كما هو اليوم** (الجدول §0).
4. `catch`: إذا `(e as any)?.code === OP_KEY_MISMATCH_CODE` (يُستورد من `services/api/opKey:6`) →
   **لا مسح سلة/نموذج/مفتاح إطلاقًا** + اكتم الصفحة العام + افتح إشعار عدم التطابق (§5)؛
   غيره → المسار الحالي كما هو.
5. reload/restored: أول إرسال بعد reload بسجل موجود وذاكرة فارغة يمر بنفس `prepare`
   (مقارنة بصمة السلة المعاد بناؤها بسجل الجلسة) — بلا كود خاص.

مواضع الإرسال الستة (§0): `POSPage.tsx:173`، `SupplierAccountPage.tsx:888`،
`SupplierAccountPage.tsx:1127`، `ReturnsPage.tsx:210`، `CustomerAccountPage.tsx:59`،
`SupplierAccountPage.tsx:65`. الدفعتان تُدخلان `opKey` داخل كائن الدفعة؛ الباقي `opts` أخيرًا
(المرتجع: السادس بعد `undefined` للخامس).

## 5) إشعار الحسم والخياران + نصوص عدم التطابق لكل مسار

- **الأداة:** `useConfirmation().confirm({title, message})` العام (أزرار ثابتة تأكيد/إلغاء —
  يُشفَّر المعنى في النص، بلا مكون جديد):
  - العنوان: `عملية مسجلة مسبقًا — <اسم المسار>`؛ المتن: ما سُجل (الرقم من `getRecordDoc`
    عند توفره: فاتورة/RET/SRET/PUR-…، أو المبلغ للدفعات) + **"تأكيد = متابعة كعملية
    جديدة برقم مستقل، إلغاء = مراجعة العملية المسجلة"**.
  - إشعار عدم التطابق (من `catch` الخدمة) بنفس الأزرار والمعنى؛ السلة/النموذج لا يُمسّان أبدًا هنا.
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

- **وحدة المخزن** (`tests/opKeyStore.test.ts` — vitest بيئة `node` الحالية، بلا DOM):
  توليد/إعادة-استخدام/تدوير/مسح؛ سجل واحد لكل مسار؛ TTL (ساعة مزيفة: قبل/بعد 20 دقيقة)؛
  `needs-decision` مقابل `rotate` الصامت حسب `getRecordDoc`؛ سجل فاسد؛ verdicts
  in-session مقابل restored (ذاكرة فارغة + سجل جلسة). + **اختبار تعاقد**: هوية مبنية
  من تجهيزات `tx3*` تطابق بصمة الخدمة (`fingerprintsEqual` على الجانبين).
- **تكامل ضمن الإعداد الحالي:** مغطى خدميًا (`tx3*`: 68 اختبارًا). ربط الصفحات **لا يمكن**
  اختباره آليًا اليوم (vitest `environment: 'node'`، بلا Testing Library/jsdom في
  الاعتماد المباشر، وsingletons تحتاج محاكيًا) — يُتحقق **يدويًا** بقائمة per-screen:
  نجاح يمسح المفتاح+السلة؛ فشل غامض + إعادة ضغط = no-op؛ تعديل السلة = إشعار + الخياران؛
  عدم تطابق = بلا مسح؛ reload + إعادة بناء = مسار restored؛ TTL.
- **المخاطر:** (1) انحراف هوية الواجهة عن مقارنة الخدمة → يُخفَّف ببناء الهوية من كائن
  الوسائط نفسه وإعادة استخدام `opKey.ts` (صيغة واحدة)؛ (2) toast مزدوج عند عدم التطابق →
  فرع `code` يكتم عام الصفحة (toast الخدمة الوحيد + الإشعار)؛ (3) سجل فاسد/امتلاء →
  try/catch ومعاملة كغائب؛ (4) تبويبان معًا — حارس الخدمة مصدر الحقيقة (مفتاح مشترك
  + بصمة = عملية واحدة)؛ النقر المزدوج بنفس التبويب محمي أصلًا بـ`withInFlightGuard`؛
  (5) مودالا الشراء/المرتجع المخصصان يبقيان كما هما (الإشعار عبر `confirm` العام للتوحيد)؛
  (6) انحراف `''` مقابل `null` لعميل النقدي → القاعدة: الهوية من القيمة المُرسلة فعلًا.
- **ترتيب REQs (واحد + commit واحد لكل):** REQ-UI-0 المخزن + جدول النسخ + اختبارات الوحدة؛
  REQ-UI-1 شاشة البيع؛ REQ-UI-2 فاتورة الشراء؛ REQ-UI-3 مرتجع المورد؛ REQ-UI-4 المرتجعات؛
  REQ-UI-5 الدفعتان معًا؛ كل REQ: ربط + QA يدوي + سطرا backlog/changelog. TX3-UI يُغلق
  بتقرير عدّادات + `test:rules` كاملة.

## 7) قرارات مطلوبة من المالك قبل التنفيذ

1. معنى زرّي الإشعار كما في §5 (تأكيد = عملية جديدة، إلغاء = مراجعة) — أم مودال مخصص
   بأزرار مسماة؟ (التوصية: `confirm` العام، صفر مكونات جديدة.)
2. إبقاء نص الخدمة "فاتورة" مقابل برمجته لكل مسار (يكسر 6 ملفات اختبار ويتطلب تحديثها)؟
   (التوصية: إبقاء + نسخ الصفحات.)
3. هل تُزال الـdouble-toast الحالية للدفعات (صفحة + خدمة) ضمن UI-5 أم تُترك؟ (التوصية:
   تُترك — خارج نطاق TX3.)
