# Backlog — Nour-Elrahman

## In Progress
- REQ-P1-2 — تنظيف importmap الإنتاج ← التالي

## Backlog (by priority)
- (لا يوجد — P1-2 هو الأخير في السلسلة الحالية)

## Deferred / Accepted Risk (Owner Decision)
- REQ-P0-2 — تضييق صلاحيات RBAC على مستوى الحقول — Accepted Risk (2026-09-12)
  السبب: المستخدمون موظفون موثوقون، الاستغلال يتطلب معرفة تقنية متعمدة، والإصلاح يكسر المسار الطبيعي (processSale/payment/return تصبح DENIED) ويحتاج Blaze/Functions — غير مبرر حاليًا. Ref: docs/known-issues.md (Accepted Risk) + docs/REQ-P0-2-baseline.md
- REQ-P0-6 — ترقيات major مؤجلة — Deferred (2026-09-12): @capacitor/cli 8.5.2, vite 8.3.0, react-router-dom 7.18.3 تحتاج major bump؛ exceljs downgrade مرفوض (load-bearing)؛ @capacitor/assets/sharp لا يوجد fix — Ref: docs/known-issues.md BUG-P0-6

## Done
- REQ-P0-6 — إصلاح ثغرات npm audit غير الكاسرة 44→22 (2026-09-12)
- REQ-P0-5 — حارس الإرسال المكرر في البيع (2026-09-12)
- REQ-P0-1b — ترقيم تسلسلي للفواتير (2026-09-12)
- REQ-P0-1 — ربط المرتجع بالفاتورة (2026-09-12)
- REQ-P0-4 — أمان الاستعادة (2026-09-12)
- REQ-M6..M13, P0-8, P0-9, P0-10/11/12
