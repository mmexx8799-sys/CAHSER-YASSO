# دليل النشر (Deploy Runbook)

## بيئة Staging (مشروع منفصل — 2.1)

القاعدة: Staging مشروع Firebase **منفصل تمامًا** عن `casher-yasoo`
الإنتاجي — نفس الكود والقواعد، بيانات وهمية فقط.

الاسم المحجوز في `.firebaserc` هو `casher-yasoo-staging`
(أي أمر `firebase use staging` يفشل حتى تُنشأ البيئة أدناه — هذا مقصود).

### الإنشاء (مرة واحدة، من Firebase Console — بلا فيزا على Spark)

1. Console → Add project → اسم `casher-yasoo-staging` → بدون Analytics.
2. Authentication → Sign-in method → فعّل Email/Password.
3. Firestore → Create database (نفس المنطقة إن أمكن) + فعّل Indexes كما في الإنتاج.
4. Hosting → Get started (موقع staging الخاص).
5. أنشئ مستخدم admin تجريبيًا (Authentication → Add user).
6. محليًا:
```bash
firebase use staging
firebase deploy --only firestore:rules,firestore:indexes --project staging
```
7. بيانات وهمية فقط (لن تلمس الإنتاج أبدًا — المشروع مختلف):
```bash
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node scripts/seedTestProducts.mjs
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node scripts/seedCustomers.mjs
```
8. النشر التجريبي:
```bash
npm run build && firebase deploy --only hosting --project staging
```

### معيار القبول (2.1)

نشر تجريبي ناجح على رابط الـ staging + بيانات وهمية ظاهرة +
`firebase use default` ما زال يشير للإنتاج (`casher-yasoo`).

## تتبع الأخطاء (2.2-free — مجاني 100%، يعمل الآن)

الوضع الحالي (نشط في الكود): أي عطل في التطبيق يُرسَل تلقائيًا إلى
مجموعة `clientErrors` في نفس مشروع Firestore — بلا أي خدمة خارجية
ولا فيزا ولا مفاتيح. الكتابة لأي مستخدم نشط بشكل صارم، والقراءة/الحذف
للأدمن فقط (`firestore.rules` + `tests/clientErrorsRules.test.ts` 3/3).

لرؤية الأعطال: Firebase Console → Firestore → `clientErrors`
(message + stack + source + url + uid + createdAt).
حماية الحصة: 10 تقارير / 10 دقائق لكل جلسة كحد أقصى
(`services/monitoring.ts`) — عطل متكرر لا يلتهم كوتا Spark.

> **مهم بعد أي تعديل في `firestore.rules`:** القاعدة الجديدة لمجموعة
> `clientErrors` لن تعمل على الإنتاج حتى تنشرها:
> `firebase deploy --only firestore:rules` (راجع حادثة INC-2026-09-12
> في `docs/known-issues.md` — النشر الحي إلزامي).
>
> ترقية اختيارية لاحقًا (Sentry، خطة Developer مجانية): ثبّت
> `@sentry/react` واستدعِ `setErrorReporter` في `index.tsx` —
> `services/monitoring.ts` أبقى نقطة التكامل جاهزة.

التسلسل الإلزامي أدناه ليس اختياريًا — نشر كود التطبيق قبل جهوزية فهارس Firestore
يعرّض شاشة POS لخطأ صريح (`FAILED_PRECONDITION: missing index`) بدل القائمة العادية.

## التسلسل الإلزامي

### 1) نشر فهارس Firestore أولًا

```bash
firebase deploy --only firestore:indexes
```

بناء الفهارس المركّبة يستغرق من ثوانٍ إلى دقائق حسب حجم البيانات — ليس فوريًا
مثل الـhosting. **انتظر اكتماله ولا تنتقل للخطوة التالية قبل التأكد.**

> **ملاحظة:** لو سألك الـCLI *"would you like to delete these indexes?"* عن
> فهارس موجودة في الـconsole غير موجودة في `firestore.indexes.json` —
> راجع القائمة قبل الموافقة. لو ظهر فيها فهرس `products%20` المشوّه وافق
> على حذفه (فهرس زائد بلا أي استخدام في الكود).

### 2) التأكد أن الفهارس "Enabled"

```bash
firebase firestore:indexes
```

الحالة يجب أن تكون **Enabled** وليست **Building**.
(يمكن أيضًا التأكيد من Console → Firestore → Indexes.)

### 3) نشر التطبيق — فقط بعد التأكيد

```bash
npm run build && firebase deploy --only hosting
```

## التحقق بعد النشر

اختبار إغلاق باج فلترة التصنيف (commit `bddf430`):

1. افتح POS واختر تصنيفًا يضم منتجات **خارج أول 30 نتيجة أبجديًا**.
2. قبل الإصلاح: كانت تظهر "لا يوجد منتجات" رغم وجودها في صفحات لاحقة.
3. بعد الإصلاح: يجب أن تظهر النتائج فورًا.

تأكيد إضافي: `git rev-parse HEAD` = `bddf430` (أو أحدث) + ظهور 3 فهارس
لـ`products` في ناتج `firebase firestore:indexes`.

## Troubleshooting: فشل الـCLI بخطأ EPERM على Windows

### العرض

أي أمر `firebase ...` يفشل فور الإقلاع بالخطأ:

```
Error: EPERM: operation not permitted, open 'C:\Users\<user>\.config\configstore\firebase-tools.json'
```

### السبب الجذري (مشخّص في 2026-09-07)

ACL تالف على المجلد `C:\Users\<user>\.config\configstore` — حتى `dir` يدخل
ويجده فارغًا، لكن `icacls` و`rd` يرفضان الوصول ("Access is denied" حتى على
قراءة الـsecurity descriptor نفسه). النتيجة: Node يرسم EPERM بدل ENOENT
على قراءة ملف غير موجود أصلًا.

تحذير: محاولة تشغيل الـCLI بمتغير `XDG_CONFIG_HOME` غير موسّع تنشئ مجلدًا
حرفيًا باسم `%XDG_CONFIG_HOME%` داخل مجلد العمل الحالي — لو وجدته في
الـrepo فهو مخلّف بلا فائدة ويُحذف بأمان.

### الإصلاح

```powershell
# 1) جرّب login بشِل عادي أولًا — لو نجح لا حاجة للباقي
firebase login

# 2) لو ظهر EPERM من PowerShell مرفوع (Run as Administrator):
takeown /f "C:\Users\<user>\.config\configstore" /r /d y
rd /s /q "C:\Users\<user>\.config\configstore"
firebase login

# 3) بديل بلا صلاحيات إدارية: توجيه config الـCLI لمسار آخر:
set XDG_CONFIG_HOME=%TEMP%\fb-cli-config
firebase login
```

الحل البديل (الأخير): login من جهاز أو بيئة أخرى (WSL مثلًا) ثم تشغيل
النشر منها.

> النطاق الآمن للتنظيف هو `configstore` تحديدًا — لا تحذف `.config` كله؛
> أدوات أخرى (opencode وrefact وغيرها) تشارك نفس المجلد الأب.

## RBAC-2026-09 — ترحيل المالك R4 (Runbook)

> ⚠️ لا يُشغَّل `--apply` ضد الإنتاج إلا بإذن صريح بعد مخرجات المحاكي الأربعة
> (dry-run / apply+read-back / idempotent / rollback) — المرجع REQ-RBAC-4.

```bash
# 1) تجربة على المحاكي أولًا (تلقائية ضمن npm run test:rules — tests/migrateRoles.test.ts)
npm run test:rules

# 2) Dry-run ضد الإنتاج (صفر كتابة — يعرض الخطة فقط)
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\sa.json"
node scripts/migrateRoles.mjs --owner izatadel007@gmail.com
# المتوقع: candidate ... admin->owner, writes: 1, DRY-RUN — لا كتابة

# 3) التنفيذ الفعلي (بعد الإذن فقط) — يتطلب تأكيد المشروع صراحةً
node scripts/migrateRoles.mjs --owner izatadel007@gmail.com --apply --project casher-yasoo
# يحفظ users-backup-<timestamp>.json محليًا قبل الكتابة، ثم يعرض read-back: role=owner

# 4) التحقق: دخول فعلي بحساب izatadel007 وفتح /users (صلاحيات owner)

# 5) التراجع (إن لزم) — قبل أي تراجع في القواعد/الواجهة (EC-09):
node scripts/migrateRoles.mjs --rollback users-backup-<timestamp>.json --apply --project casher-yasoo
```

- بيانات الاعتماد من `GOOGLE_APPLICATION_CREDENTIALS` فقط — ممنوع أي `--key-file` (AUDIT-SEC-2).
- السكربت لا يمس Firebase Auth إطلاقًا — يغيّر حقل `role` فقط.
- الترتيب الإلزامي للتراجع الكامل (§2.5): **أولًا** rollback الترحيل أعلاه **ثم** أي تراجع قواعد/واجهة.

## Break-glass — قفل المالك خارج النظام (EC-08)

1. Firebase Console → Authentication: إعادة تعيين كلمة المرور لحساب `izatadel007@gmail.com` (أو إنشاء حساب بديل مؤقت).
2. Firebase Console → Firestore → `users/{uid}`: تعديل `role` إلى `owner` و`disabled` إلى `false` — الـ Console يتجاوز القواعد.
3. التحقق بالدخول الفعلي وفتح `/users`.
4. نسخة `users-backup-*.json` من R4 محفوظة خارج الجهاز للطوارئ.
