# REQ-P0-2 — تقرير التنفيذ — 2026-09-12

## الخطوة 0 — Baseline (قبل التعديل)
القواعد الحالية `firestore.rules:46` و `:66`:
`allow read, create, update: if isActiveUser();`
→ أي كاشير يستطيع تحديث balance (ثغرة P0-2).

العمليات الثلاث (services/api.ts:519, :271, :613):
- processSale (آجل) → PASS
- addCustomerPayment → PASS
- processReturn مع عميل → PASS

## الخطوة 1 — التعديل المطبّق
```
match /customers/{docId} {
  allow read, create: if isActiveUser();
  allow update: if isAdmin() || (isActiveUser()
                   && !('balance' in diff) && !('openingBalance' in diff));
}
```
(نفسه لـ suppliers — مطابق لصياغة users/dailyArchives)

## الخطوة 2 — إعادة اختبار Baseline (فشل حرج)
كمستخدم عادي (cashier, isAdmin=false):
- processSale → DENIED (affectedKeys=["balance"])
- addCustomerPayment → DENIED
- processReturn → DENIED
- processPurchase / addSupplierPayment (suppliers.balance) → DENIED

**السبب:** Firestore Rules تقيّم كل document write بشكل منفصل — لا تعرف أن update الـ balance جاء داخل transaction شرعي مع إنشاء invoice. أي قاعدة تمنع الكاشير من لمس balance ستمنع الـ transaction نفسه.

**الخطوة 3 — لم تُنفّذ** (مشروطة بنجاح الخطوة 2).

## الإجراء المتخذ (حسب التعليمات)
- تم إرجاع الملف فورًا: `git checkout -- firestore.rules` — لا تغيير باقٍ في القواعد.
- backlog.md حُدّث إلى BLOCKED.

## الخلاصة والتوصية
الحل المقترح ضمن حدود Spark غير قابل للتطبيق بدون كسر العمليات الشرعية.
البدائل الواقعية:
1. الإبقاء على الوضع الحالي مؤقتًا وتوثيق الخطر (P0-2 يبقى Open مع تحذير).
2. الانتقال لـ Cloud Functions / Custom Claims + server-side validation (يتطلب ترقية من Spark).
3. أو استخدام حل وسط: ترك balance قابلًا للكتابة لكن إضافة Firestore Rules تتحقق من أن القيمة الجديدة = القديمة ± مبلغ موجود في نفس الـ transaction — غير ممكن بقواعد Firestore وحدها (لا تستطيع قراءة invoice الجديد في نفس القاعدة).

REQ-P0-2 — **BLOCKED / REVERTED** — بانتظار قرارك قبل أي محاولة ثانية.

