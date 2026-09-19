# Backlog — Nour-Elrahman

## In Progress — RBAC-2026-09 (REQ-RBAC-0…5) — started 2026-09-19 — base e24fe3e
- REQ-RBAC-0: قرارات المالك + خط الأساس + جرد المستخدمين (G0 — هذا الملف) — **In Progress**
- REQ-RBAC-1: طبقة القواعد — إضافات آمنة (rules-first: roles + isStaff + ledger immutability + archive transitions + owner guard) — Pending (⛔ STOP حتى توقيع G0)
- REQ-RBAC-2: مسار الكتابة — Preflight + fail-fast (restore/reset/addUser) — Pending
- REQ-RBAC-3: الواجهة — صلاحيات موحدة المصدر (utils/permissions.ts) — Pending
- REQ-RBAC-4: ترحيل الأدوار — تعيين المالك `izatadel007@gmail.com` (dry-run افتراضي + rollback) — Pending
- REQ-RBAC-5: التشديد النهائي للمالك + الإغلاق (users + حذف دفتري → owner-only + Live smoke B) — Pending
- **تنبيه صريح:** REQ-P0-2 (قفل `balance` الكامل) **يبقى Declined بقرار المالك (Ahmed 2026-09-16 + تأكيد 2026-09-19)** — هذه الدورة RBAC لا تمسّ `balance`/الكميات/إجماليات اليومية؛ المحاسب فقط هو الممنوع من الكتابة. لا يُعاد فتحه إلا بقرار مالك مكتوب جديد (known-issues BUG-P0-2 + backlog:22).

## In Progress (سابق — مغلق)
- (لا يوجد — backlog النشط فارغ بعد REQ-UI-1b — نُقل إلى RBAC أعلاه)

## Backlog (by priority)
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
