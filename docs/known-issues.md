# Known Issues — Nour-Elrahman

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

## حوادث مغلقة — دروس منهجية (Closed Incidents — Methodology)

INC-2026-09-12 — فجوة نشر firestore.rules
Incident: قواعد firestore.rules المحدّثة عبر REQ-P0-9 (d5d7d0f — منع البيع على يومية مقفولة) وإضافة `counters` في REQ-P0-1b تم دفعها إلى git فقط دون تنفيذ `firebase deploy --only firestore:rules` على المشروع الحي — مما تسبب في انقطاع كامل لعملية الدفع (403 batchGet) حتى تم اكتشافه يدويًا ونشره في 2026-09-12.
Root Cause: قالب الـ REQ كان يطلب tsc/build/git diff فقط كأدلة — لا يغطي النشر الحي للقواعد، ونجاح البناء المحلي لا يعطي أي معلومات عن ما هو مُطبّق فعليًا في الإنتاج.
Fix: إضافة قاعدة دائمة جديدة لقالب REQ (موثّقة في docs/req-template.md) — أي REQ يلمس firestore.rules يجب أن يحتوي AC إضافي يطلب تشغيل `firebase deploy --only firestore:rules` ولصق مخرجاته كدليل، ولا يُعتبر مكتملًا حتى يتم تأكيد النشر الحي.
Status: Closed — Deployment gap resolved 2026-09-12
