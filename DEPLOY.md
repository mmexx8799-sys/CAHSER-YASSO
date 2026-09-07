# دليل النشر (Deploy Runbook)

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
