# Backlog — Nour-Elrahman

## In Progress
- REQ-P0-1b — ترقيم تسلسلي للفواتير ← التالي

## Backlog (by priority)
- REQ-P0-5 — حارس الإرسال المكرر في البيع (in-flight guard)
- REQ-P0-5 — حارس الإرسال المكرر في البيع (in-flight guard)
- REQ-P0-6 — إصلاح ثغرات التبعيات (npm audit)
- REQ-P1-2 — تنظيف importmap الإنتاج

## Deferred / Accepted Risk (Owner Decision)
- REQ-P0-2 — تضييق صلاحيات RBAC على مستوى الحقول — Accepted Risk (2026-09-12)
  السبب: المستخدمون موظفون موثوقون، الاستغلال يتطلب معرفة تقنية متعمدة، والإصلاح يكسر المسار الطبيعي (processSale/payment/return تصبح DENIED) ويحتاج Blaze/Functions — غير مبرر حاليًا. Ref: docs/known-issues.md (Accepted Risk) + docs/REQ-P0-2-baseline.md

## Done
- REQ-P0-1 — ربط المرتجع بالفاتورة (2026-09-12)
- REQ-P0-4 — أمان الاستعادة (2026-09-12)
- REQ-M6..M13, P0-8, P0-9, P0-10/11/12
