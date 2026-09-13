# Backlog — Nour-Elrahman

## In Progress
- (لا يوجد — backlog النشط فارغ بعد REQ-UI-1b)

## Backlog (by priority)
- سياسة حد أدنى للخصم (50% مؤقت — REQ-P0-3) — Backlog: مراجعة نسبة الـ 50% كسياسة تسعير مستقبلًا (ليست ثغرة)
- TECH-P0-1b — قفل نافذة TOCTOU race في processReturn (دفعة 2026-09-13): الخيار A الحالي يقرأ المرتجعات السابقة عبر getDocs() خارج الـ transaction — الحل المقترح: تخزين returnedQuantities داخل مستند الفاتورة نفسها وتحديثه ذريًا داخل نفس الـ transaction بدل الاعتماد على القراءة الخارجية (يُعاد التقييم عند نمو عدد الكاشيرين المتزامنين)
- رسالة خطأ خاطئة في processReturn (تجميلي — لا يُصلَح الآن): رفض اليومية المقفولة يقول "لا يمكن تسجيل عملية بيع على يومية غير مفتوحة" (services/api.ts:664) — copy-paste من processSale (:518) — الصحيح "عملية إرجاع"

## Deferred / Accepted Risk (Owner Decision)
- REQ-P0-2 — تضييق صلاحيات RBAC على مستوى الحقول — Accepted Risk (2026-09-12)
  السبب: المستخدمون موظفون موثوقون، الاستغلال يتطلب معرفة تقنية متعمدة، والإصلاح يكسر المسار الطبيعي (processSale/payment/return تصبح DENIED) ويحتاج Blaze/Functions — غير مبرر حاليًا. Ref: docs/known-issues.md (Accepted Risk) + docs/REQ-P0-2-baseline.md
- REQ-P0-6 — ترقيات major مؤجلة — Deferred (2026-09-12): @capacitor/cli 8.5.2, vite 8.3.0, react-router-dom 7.18.3 تحتاج major bump؛ exceljs downgrade مرفوض (load-bearing)؛ @capacitor/assets/sharp لا يوجد fix — Ref: docs/known-issues.md BUG-P0-6

## Done
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
