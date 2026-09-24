# Backlog — Nour-Elrahman

## Done — OFFLINE-P1 (REQ-OFF1-0…5) — 2026-09-21 → 2026-09-23 — base 1ab34cd (tag pre-offline-p1)
- REQ-OFF1-0: الأساس والجرد (قراءة فقط) — **Done 2026-09-21 (9c264ab)** — tag `pre-offline-p1` على `1ab34cd` — `tsc` نظيف · `eslint` 7 أخطاء PERM · `test:rules` 340/340 · `build` 938 kB — الجرد الخام (ب→هـ) موثق + D-O1…D-O8 موقعة في `known-issues.md`
- REQ-OFF1-1: هيكل PWA (واجهة فقط — لا بيانات) — **Done 2026-09-21 (c3ab8d6 + dc1e813 + e0ef2af — إصلاحات النافبار 2412b7e/f736890)** — `vite-plugin-pwa@1.3.0` — `manifest` عبر `VitePWA.manifest` — `precache 37 فريد (40 إجمالي، 3 أيقونات مكررة x2)` — الفحص البصري للمالك 9+ صفحات ببيانات حقيقية من الكاش المحلي، لا ديناصور
- REQ-OFF1-2: رفض فوري على مستوى الخدمة (22 دالة — D-O8 أ) + `OfflineGuardError` — **Done 2026-09-22 (db50102 + 0599ac1)** — `tsc` نظيف · `test:rules` 340/340 · emulator: 21/21 + Captive 2/2
- REQ-OFF1-3: تنبيه "يوجد إصدار جديد" — **Done 2026-09-22 (94619c8)** — `NewVersionBanner` + `withInFlightGuard` 22 + `registration.update()` كل 5د — بانر غير مُلح وقابل للإغلاق
- REQ-OFF1-4: تسجيل الانقطاعات 14 يومًا — **Done 2026-09-22 (eb8bbe7)** — `offlineLog.ts` (14d window + 3s threshold) + `useOfflineLogger` + `OfflineStats` في الإعدادات — `idb-keyval@6.3.0`
- REQ-OFF1-5: إغلاق وتوثيق — **Done 2026-09-23 (43d9031 + a9ce533)** — `backlog/changelog/current-state-map/known-issues` — **OFFLINE-P1 مكتمل** — إصلاح retry للـping (a9ce533: إعادة محاولة واحدة على offline-timeout) — الخطوة التالية: **P2 مؤجلة حتى 2026-10-06** (المالك يفتح `الإعدادات → حالة الاتصال` أو يصدّر JSON)

## In Progress — RBAC-2026-09 (REQ-RBAC-0…5) — started 2026-09-19 — base e24fe3e
- REQ-RBAC-0: قرارات المالك + خط الأساس + جرد المستخدمين (G0 — هذا الملف) — **Done 2026-09-19 (f179fd1)**
- REQ-RBAC-1: طبقة القواعد — إضافات آمنة (rules-first: roles + isStaff + ledger immutability + archive transitions + owner guard) — **Done code+tests 2026-09-19 (b926b6d) — معتمد فنيًا من المراجع، ⛔ W0 موقوف حتى جرد users الإنتاج (AC-04 فيتو)**
- REQ-RBAC-2: مسار الكتابة — Preflight + fail-fast (restore/reset/addUser) — Pending
- REQ-RBAC-3: الواجهة — صلاحيات موحدة المصدر (utils/permissions.ts) — Pending
- REQ-RBAC-4: ترحيل الأدوار — تعيين المالك `izatadel007@gmail.com` (dry-run افتراضي + rollback) — Pending
- REQ-RBAC-5: التشديد النهائي للمالك + الإغلاق (users + حذف دفتري → owner-only + Live smoke B) — Pending
- **تنبيه صريح:** REQ-P0-2 (قفل `balance` الكامل) **يبقى Declined بقرار المالك (Ahmed 2026-09-16 + تأكيد 2026-09-19)** — هذه الدورة RBAC لا تمسّ `balance`/الكميات/إجماليات اليومية؛ المحاسب فقط هو الممنوع من الكتابة. لا يُعاد فتحه إلا بقرار مالك مكتوب جديد (known-issues BUG-P0-2 + backlog:22).

## In Progress (سابق — مغلق)
- (لا يوجد — backlog النشط فارغ بعد REQ-UI-1b — نُقل إلى RBAC أعلاه)

## Backlog (by priority)
- **OFF1-2 — اختبار vitest لـassertOnline (مفتوح):** `assertOnline()` بلا تغطية آلية — مطلوب refactor يصدّر دالة داخلية بلا `MODE==='test'` bypass (مثل `assertOnlineCore(getDocFromServer, navigator)`) ثم اختبار vitest يمرر mock يحاكي `offline-timeout` و `unavailable` — لا يُنفذ الآن، يُسجل هنا فقط.
- **PERM-2026-09 — تنظيف lint القديم (7 أخطاء اختبارات):** `tests/migrateRoles.test.ts: @ts-nocheck`, `permissionsRules: outcome`, `rbacEscalation/matrix: getDoc/expect`, `restorePreflight: empty block` — تُنظّف خارج الدورة — لا أثر تشغيلي.
- **PERM — رسالة اليومية عند permission-denied:** `POSPage/ReturnsPage: getOpenDailyArchive().catch` تتخطى `permission-denied` حاليًا بفحص نصي واسع — تُحسّن لفحص `hasRealUser/disabled` صريح.
- **PERM — عرض السجل بالبريد بدل UID:** `components/PermissionEditorModal.tsx` يعرض `by/targetUid` كـUID خام — يُستبدل ببريد من `users` cache.
- **PERM — قدرة `product.view`:** فصل عرض المنتجات عن إنشائها — حاليًا `product.create` يخفي التبويب كاملًا — Backlog.
- **PERM — إشعار إصدار جديد:** لا يوجد `New version available` بعد نشر الاستضافة — يحتاج service worker أو فحص نسخة.
- Known Gap (pre-existing, out of RBAC scope — مراجعة R1 2026-09-19): `products.create` بلا حراسة سعر عند الإنشاء — `firestore.rules:62-63` تتحقق `quantity >=0` فقط؛ حراسة BUG-P0-3 (`price`/`retailCashPrice`…) موجودة فقط في `update` (سطر 69-73). أي `isStaff()` يستطيع تحديد سعر تعسفي عند إنشاء منتج جديد ثم لا يستطيع تعديله. ليس انحدار R1 — AC-09 نص "منطق BUG-P0-3 بلا تغيير" — يُسجل هنا للمتابعة لاحقًا، لا يُفتح له REQ الآن.
- سياسة حد أدنى للخصم (50% مؤقت — REQ-P0-3) — Backlog: مراجعة نسبة الـ 50% كسياسة تسعير مستقبلًا (ليست ثغرة)
- TECH-P0-1b — قفل نافذة TOCTOU race في processReturn (دفعة 2026-09-13): الخيار A الحالي يقرأ المرتجعات السابقة عبر getDocs() خارج الـ transaction — الحل المقترح: تخزين returnedQuantities داخل مستند الفاتورة نفسها وتحديثه ذريًا داخل نفس الـ transaction بدل الاعتماد على القراءة الخارجية (يُعاد التقييم عند نمو عدد الكاشيرين المتزامنين)
- رسالة خطأ خاطئة في processReturn (تجميلي — لا يُصلَح الآن): رفض اليومية المقفولة يقول "لا يمكن تسجيل عملية بيع على يومية غير مفتوحة" (services/api.ts:664) — copy-paste من processSale (:518) — الصحيح "عملية إرجاع"
- RESPONSIVE-POLISH — تحسينات جودة لا تغطية مفقودة: مودالات على شاشات صغيرة، فحص تداخل الأشرطة الثابتة (lg:right-64) عبر بقية الصفحات — لا دورة SpecKit منفصلة، تُلتقط لاحقًا إن ظهرت شكوى Manual QA حقيقية
- Void & Reissue — تصحيح الفواتير/المرتجعات المسجلة بالخطأ (تُفتح كدورة SpecKit مستقلة بعد اكتمال دفعة P0 وتجميد الأساس — وليس قبل ذلك): الفواتير المالية لا تُعدَّل بل تُلغى وتُستبدل. النقاط الخمس: (1) مبادئ: السجل ثابت + الرقم الملغى يُستهلك ولا يُعاد + كل تصحيح بسبب ومنفذ ووقت؛ (2) بيانات: status/voidedBy/voidedAt/voidReason/replacedByInvoiceId على invoices وreturns + مجموعة auditLog لا تُحذف؛ (3) منطق: voidInvoice/voidReturn يعكسان المخزون والرصيد وإجماليات اليومية ذريًا + قيود (لا إلغاء فاتورة لها مرتجعات إلا عكسيًا، لا إلغاء مدفوعة جزئيًا دون معالجة الدفعات)؛ (4) صلاحيات: الكاشير نفس اليوم/المفتوحة فقط + الأدمن يطال المقفول مع audit صريح + تشديد rules الـ update على انتقالات status فقط (بند أمني ملازم)؛ (5) واجهة واختبار وإطلاق: زر إلغاء + سبب إجباري + إعادة إصدار + شارة ملغاة + اختبارات Emulator + build بعد كل ملف اختبار + القديم active افتراضيًا + فجوات الترقيم مقبولة وموثقة
- AUDIT-2026-09-15 — مخرجات الـ Full Audit (تُفتح كدورات SpecKit مستقلة بعد إغلاق BUG-P0-15 وتجميد الأساس — لا تُبدأ الآن):
  - AUDIT-ARCH-1: تقسيم services/api.ts (ملف إلهي ~985 سطر) إلى وحدات (products/customers/sales/returns/archives/backup) + طبقة repositories تمنع استيراد firebase/firestore من pages/ مباشرة (الأخطر ReturnsPage:524-544 يتجاوز api.ts)
  - AUDIT-ARCH-2: إخراج toast من طبقة services/stores (double-toast + عدم قابلية الاختبار) + نقل ConfirmationProvider إلى contexts/ + فك coupling returnCartStore→posCartStore عبر utils/pricing.ts
  - AUDIT-SEC-1: إغلاق generic add/update/deleteDocument (أي cashier يستطيع كتابة balance مباشرة — مرتبط بـ BUG-P0-2 Accepted Risk) + توحيد validation (processPurchase/SupplierReturn بلا فحص سعر/كمية)
  - AUDIT-SEC-2: إزالة cleartext:true + allowMixedContent:true من capacitor.config.ts + نقل seed scripts من argv إلى env + إصلاح deleteUser اليتيم (يحذف doc ويترك Auth account)
  - AUDIT-PERF-1: حدود limit للـ listeners غير المقيدة (Reports/Returns/Account pages) + مراجعة backup/deleteCollection غير المحدودة مقابل quota Spark
  - AUDIT-TEST-1: تغطية RBAC (users/appSettings/categories/dailyArchives) + backup/restore + price-floor + AuthContext/offline + إضافة coverage و lint/typecheck scripts
  - AUDIT-TX-1 (اتساق صغير — توثيق أو إصلاح): توحيد runTransactionWithRetry على processReturn/processSupplierReturn/addCustomerPayment/addSupplierPayment — حاليًا فقط processSale/processPurchase يستخدمانها (مبرر محتمل: الأخيران فقط يلمسان counters، لكن القرار غير موثق)

## Deferred / Accepted Risk (Owner Decision)
- REQ-P0-2 — تضييق صلاحيات RBAC على مستوى الحقول — Partially mitigated (Phase 0 live 2026-09-16: تجميد openingBalance + حواجز amount/total — Ref: tests/balanceOpeningFreeze.test.ts) — قفل balance الكامل عبر Functions/Blaze: Declined — Owner Decision (Ahmed, 2026-09-16) — لا يُعاد فتحه إلا بقرار مالك جديد مكتوب.
  السبب: المستخدمون موظفون موثوقون، الاستغلال يتطلب معرفة تقنية متعمدة، والقفل الكامل لـ balance يكسر المسار الطبيعي (processSale/payment/return تصبح DENIED) ويحتاج Blaze/Functions — غير مبرر حاليًا. Ref: docs/known-issues.md (Accepted Risk) + docs/REQ-P0-2-baseline.md
- REQ-P0-6 — ترقيات major مؤجلة — Deferred (2026-09-12، أُعيد التدقيق 2026-09-16): @capacitor/cli 8.5.2, vite 8.3.0, react-router-dom 7.18.3 تحتاج major bump؛ exceljs downgrade مرفوض (load-bearing)؛ @capacitor/assets/sharp لا يوجد fix — Re-audit النهائي: 26 (2 critical, 5 high, 19 moderate) عبر `npm audit --json`، و`npm audit fix --dry-run` يثبت عدم وجود إصلاح non-breaking (undici يتطلب firebase 11 major) — Ref: docs/known-issues.md BUG-P0-6

## Done
- REQ-SEC1-8 — تخفيف BUG-P0-2 (Phase 0 حية ومثبتة) + رفض Phase 1/2 (Functions/Blaze) نهائيًا بقرار مالك (Ahmed, 2026-09-16)
- REQ-UI-1b — تمييز الفاتورة/المرتجع الآجل في الإيصال (امتداد UI-1) (2026-09-12)
- REQ-UI-1 — إعادة تصميم مودال الفاتورة/الإيصال (theme-adaptive) (2026-09-12)
- REQ-P1-2 — تنظيف importmap من index.html (2026-09-12)
- REQ-P0-3 — التحقق السعري الخادمي 50% floor (2026-09-12)
- REQ-P0-6 — إصلاح ثغرات npm audit غير الكاسرة 44→22 (2026-09-12)
- REQ-P0-5 — حارس الإرسال المكرر في البيع (2026-09-12)
- REQ-P0-1b — ترقيم تسلسلي للفواتير (2026-09-12)
- REQ-P0-1 — ربط المرتجع بالفاتورة (2026-09-12)
- REQ-P0-4 — أمان الاستعادة (2026-09-12)
- REQ-M6..M13, P0-8, P0-9, P0-10/11/12
