# SPEC / PLAN / TASKS — المرحلة 1: الجاهزية للأوفلاين (PWA + رفض فوري + قياس)

> **الحالة:** مسودة للمراجعة الخبيرة — لا يبدأ التنفيذ قبل اعتمادها وتوقيع D-O1…D-O7.
> **السياق:** بعد PERM-2026-09 (340 اختبار، rules/indexes/hosting live). الموقع حاليًا **لا يفتح أوفلاين** (صفحة الديناصور) — `docs/SPEC-PLAN-OFFLINE-QUEUE-P2.md` علّق F-6 وجعل P1 شرطًا سابقًا. P1 تكلفتها صغيرة ومطلوبة في الحالتين (سواء كان الانقطاع نادرًا أو متكررًا)، وفائدتها الثانية: تسجيل الانقطاعات أسبوعين بأرقام لتقرير جدوى P2.
> **تاريخ المسودة:** 2026-09-21 — الكاتب: Muse Spark — بانتظار المراجع الخبير والمالك.

---

## 1) SPEC

### 1.1 المشكلة الحالية (Evidence — قابلة للفحص)
- **لا PWA:** `vite.config.ts` بلا `vite-plugin-pwa`، لا `public/manifest.json`، لا `service-worker` — `dist/` هو `index.html` مجردة. قطع الشبكة من DevTools → صفحة الديناصور (لا يفتح). `E:\Nour-Elrahman\docs` (الصورة المرفقة) تؤكد غياب أي ملف P1.
- **رفض غير فوري:** `services/api.ts:825 processSale` تُنفذ `runTransaction` مباشرة — عند أوفلاين تفشل بعد مهلة 10-20s (لا فحص `navigator.onLine` ولا `getDocFromServer`). `pages/POSPage.tsx:165 handleProcessSale` يعرض `toast.error` عامًا بلا تمييز "أوفلاين".
- **لا وضع قراءة فقط:** `OfflineNotifier.tsx:5` إشعار فقط — لا يُعطّل أزرار البيع/الإرجاع/الدفع، ولا يمنع فتح يومية جديدة أوفلاين.
- **لا تنبيه إصدار جديد:** بعد `firebase deploy --only hosting` لا يوجد `serviceWorker.update` ولا `onNeedRefresh` — المستخدم يبقى على نسخة قديمة حتى تحديث يدوي.
- **لا قياس:** لا تسجيل لمرات/مدة الانقطاع — قرار P2 يُبنى على تخمين.

### 1.2 الأهداف (Goals)
1.  **فتح الموقع أوفلاين:** حتى بلا إنترنت يفتح `https://casher-yasoo.web.app` ويعرض الواجهة (قراءة فقط) — لا ديناصور.
2.  **رفض فوري:** أي ضغط "تأكيد بيع/إرجاع/دفع" أوفلاين يُرفض خلال ≤1s برسالة عربية واضحة، بلا انتظار مهلة الشبكة.
3.  **قراءة فقط أوفلاين:** كل أزرار الكتابة معطّلة + بانر ثابت "وضع قراءة فقط — لا إنترنت" — القراءة (منتجات/عملاء/تقارير من الكاش) تبقى.
4.  **تنبيه إصدار جديد:** عند نشر hosting جديد يظهر "يوجد إصدار جديد — تحديث" ويُحدّث بضغطة.
5.  **قياس الانقطاعات أسبوعين:** كل `offline→online` يُسجّل (بداية/نهاية/مدة/uid) محليًا + في `clientErrors`، وتقرير أسبوعي يحدد جدوى P2 بالأرقام.

### 1.3 غير أهداف (Non-Goals)
- طابور/إعادة إرسال تلقائية — هذا P2 (مؤجل حتى تتوفر أرقام P1).
- مزامنة بيانات أوفلاين للكتابة — أوفلاين = قراءة فقط.
- تخزين ردود Firestore أوفلاين — **ممنوع** (أمان — انظر 1.6).

### 1.4 المستخدمون والسيناريوهات
- **كاشير:** انقطع الإنترنت أثناء البيع → يرى بانر "قراءة فقط" + زر "تأكيد الدفع" معطّل مع tooltip "لا إنترنت — لا يمكن البيع الآن" → لا يضيع وقت انتظار مهلة.
- **مالك:** نشر إعدادات جديدة → الكاشير يرى "إصدار جديد — تحديث" → يضغط فيُحدّث دون مسح الكاش يدويًا.
- **مدقق:** بعد أسبوعين يفتح تقرير الانقطاعات (عدد المرات/متوسط المدة/أوقات الذروة) ليقرر P2.

### 1.5 القرارات المطلوبة قبل الانطلاق (D-O1…D-O7 — توقيع المالك)
| # | القرار | الخيارات | الافتراضي (إن لم يُوقع) | الأثر |
|---|---|---|---|---|
| D-O1 | هل PWA يُسجَّل تلقائيًا عند الدخول أم بضغطة "تثبيت"؟ | (أ) تلقائي — (ب) يدوي | **(أ) تلقائي** | (أ) يضمن فتح أوفلاين دون تدريب |
| D-O2 | سلوك زر البيع أوفلاين | (أ) معطّل + tooltip — (ب) يظهر confirm ثم يرفض | **(أ) معطّل** | (أ) أوضح وأسرع |
| D-O3 | بانر القراءة فقط | (أ) ثابت أعلى الصفحة — (ب) toast مؤقت | **(أ) ثابت** | (أ) لا يُفقد |
| D-O4 | تنبيه الإصدار الجديد | (أ) بانر + زر "تحديث الآن" — (ب) تحديث صامت | **(أ) بانر** | (أ) يمنع نسخة قديمة |
| D-O5 | تسجيل الانقطاعات | (أ) محلي + `clientErrors` — (ب) محلي فقط | **(أ) محلي + clientErrors** | (أ) يُرى من Console حتى لو الجهاز مُسح |
| D-O6 | مدة القياس قبل تقرير P2 | (أ) 14 يومًا — (ب) 7 أيام | **(أ) 14 يومًا** | (أ) عينة أدق |
| D-O7 | تحديث PWA للـ APK (Capacitor) | (أ) يشمل الأندرويد — (ب) ويب فقط الآن | **(ب) ويب فقط الآن** | (ب) أقل مخاطرة إطلاق |

### 1.6 القيود الصلبة (Constraints)
- **أمان PWA:** يُخزَّن **ملفات الواجهة فقط** (`index.html`, `assets/*.js/css`, `icons`) عبر `precache` — **لا يُخزَّن أي رد من Firestore/Auth** (لا `api` ولا `firestore.googleapis.com` في الكاش). السبب: تسريب بيانات عملاء/أرصدة في كاش دائم.
- لا `firestore.rules` ولا `firestore.indexes.json` في P1 — لا نشر قواعد.
- لا `balance/openingBalance` يُمس — Accepted Risk يبقى.
- `persistentLocalCache` في `services/firebase.ts:34` يبقى كما هو (قراءات Firestore في الذاكرة) — PWA لا يستبدله.

### 1.7 المتطلبات الوظيفية
| # | الوصف | AC مختصر |
|---|---|---|
| F1-1 | فتح الموقع أوفلاين (PWA) | قطع الشبكة → تحديث الصفحة → الواجهة تفتح (لا ديناصور) + `manifest.json` + `service-worker.js` |
| F1-2 | رفض فوري للكتابة أوفلاين | `navigator.onLine===false` أو `getDocFromServer` بمهلة 2s تفشل → `throw` برسالة "لا إنترنت — لا يمكن إتمام العملية" خلال ≤1s (لا انتظار 10s) |
| F1-3 | وضع قراءة فقط | كل أزرار `sell/return/payment/supplier.ops/category.write/...` معطّلة أوفلاين + `aria-disabled` + بانر ثابت |
| F1-4 | تنبيه إصدار جديد | بعد نشر hosting جديد → بانر "يوجد إصدار جديد — تحديث" → ضغطة تستدعي `updateServiceWorker(true)` وتُعيد التحميل |
| F1-5 | تسجيل الانقطاعات | كل `offline` يُسجّل `start`, كل `online` يُسجّل `end+durationMs` في IndexedDB (key: `offlineLog`) + `clientErrors{source:'offline-p1', start, end, durationMs, uid}` — تقرير: count/avg/max في `SettingsPage` |

### 1.8 المتطلبات غير الوظيفية
- **الأداء:** PWA precache ≤ 2MB (الـ build الحالي 938 kB + icons) — لا يؤخر أول تحميل.
- **الأمان:** لا كاش لشبكة Firestore — يُفحص بـ DevTools → Application → Cache Storage (يجب ألا تظهر `firestore.googleapis.com`).
- **الاختبار:** اختبار يدوي بقطع الشبكة + `npm run build` + `npx tsc --noEmit`.

---

## 2) PLAN

### 2.1 القرار المعماري
| الخيار | الوصف | الحكم |
|---|---|---|
| **A — vite-plugin-pwa (Workbox) + NetworkOnly لـ Firestore (موصى به)** | `VitePWA({ registerType:'prompt', workbox:{ globPatterns:['**/*.{js,css,html,svg,png,woff2}'], navigateFallback:'index.html', runtimeCaching:[] } })` — لا `runtimeCaching` لـ `firestore.googleapis.com` إطلاقًا | ✅ أبسط، لا كاش بيانات، تحديث بضغطة |
| B — يدوي `service-worker.js` | كتابة SW يدويًا | ❌ أكثر أخطاء، لا حاجة |
| C — Capacitor offline فقط | إصلاح الأندرويد فقط | ❌ لا يحل الويب |

**الاختيار: A** — مع `registerType:'prompt'` لتنبيه الإصدار الجديد (F1-4).

### 2.2 تدفق البيانات
```
[App.tsx] ── registerSW() ── service-worker.js (precache: index.html + assets/*)
  └─ offline: navigateFallback → index.html (تفتح الواجهة)

[OfflineNotifier.tsx / hooks/useOffline.ts (جديد)]
  - listens: window 'online'/'offline' + periodic getDocFromServer(doc(db,'counters','invoices')) بمهلة 2s (كشف Captive Portal)
  - state: isOffline boolean + offlineStartMs
  - على offline: startMs = Date.now(), show banner, disable writes, log {start}
  - على online: duration = Date.now()-startMs, log {end,durationMs} → IndexedDB + clientErrors, hide banner

[pages/POSPage.tsx, ReturnsPage.tsx, ...]
  - const { isOffline } = useOffline()
  - زر "تأكيد الدفع": disabled={isOffline || !can('sell')} + title="لا إنترنت — لا يمكن البيع الآن"
  - handleProcessSale: if (isOffline) throw fast "لا إنترنت" (لا تستدعي runTransaction أصلًا) — وإلا preflight getDocFromServer بمهلة 2s قبل runTransaction

[components/NewVersionBanner.tsx (جديد)]
  - const { needRefresh, updateServiceWorker } = useRegisterSW()
  - if needRefresh → banner "يوجد إصدار جديد — تحديث" → updateServiceWorker(true)

[services/offlineLog.ts (جديد) — IndexedDB via idb-keyval]
  - logOfflineStart(), logOfflineEnd(durationMs), getOfflineStats() → {count, totalMs, avgMs, maxMs, last7Days[]}
  - SettingsPage: قسم "حالة الاتصال" يعرض الإحصائيات + زر "تصدير السجل"
```

### 2.3 الواجهة (UX)
- **بانر قراءة فقط:** `OfflineBanner` ثابت أعلى `App.tsx` (تحت الهيدر) — `role="status" aria-live="polite"` — نص: "وضع قراءة فقط — لا إنترنت".
- **أزرار معطّلة:** `POSPage` زر "دفع" + `ReturnsPage` زر "تأكيد الإرجاع" + `Supplier` دفعات/مشتريات — كلها `disabled` أوفلاين مع `title` عربي.
- **بانر إصدار جديد:** `NewVersionBanner` ثابت أسفل الصفحة — لا يختفي إلا بضغطة "تحديث".

### 2.4 المخاطر والتخفيف
| الخطر | التخفيف |
|---|---|
| PWA يكسر التحديث (cache قديم) | `registerType:'prompt'` + `cleanupOutdatedCaches:true` — لا `autoUpdate` صامت |
| كاش Firestore بالخطأ | لا `runtimeCaching` لـ `*.googleapis.com` — يُفحص يدويًا في AC |
| isOffline كاذب (navigator.onLine true لكن لا إنترنت) | `getDocFromServer` بمهلة 2s كـ ping قبل كل كتابة |
| OfflineNotifier يستهلك بطارية | poll متقطع فقط قبل الكتابة، لا `setInterval` دائم |
| IndexedDB غير متاح (تصفح خاص) | السجل يُحفظ في `clientErrors` فقط — لا يمنع البيع (P1 لا يمنع القراءة) |

### 2.5 القياس واتخاذ قرار P2
- بعد 14 يومًا (D-O6): `getOfflineStats()` → تقرير: `count, avgDuration, maxDuration, peakHours` — إن كان `count ≥ 5` أو `avg ≥ 2min` → P2 مجدية، وإلا تُؤجل.

---

## 3) TASKS

> **الترتيب إلزامي — لا يبدأ REQ-OFF1-1 قبل REQ-OFF1-0، ولا يبدأ أي REQ-OFF1-1… قبل توقيع D-O1…D-O7.**

### REQ-OFF1-0 — الأساس والجرد (قراءة فقط — لا كود) — **هذا الـ REQ الحالي**
- **الملفات المسموحة:** `docs/backlog.md`, `docs/current-state-map.md`, `docs/known-issues.md`, `docs/SPEC-PLAN-OFFLINE-P1.md` (هذا الملف)
- **AC-01:** توثيق قرارات D-O1…D-O7 موقعة من المالك في `docs/known-issues.md` (قسم جديد "P1-Owner-Decisions").
- **AC-02:** تثبيت `git tag pre-offline-p1` على HEAD الحالي + قياس خط الأساس الحرفي:
  - `npm run typecheck` (`npx tsc --noEmit`) — مخرجات خام
  - `npx eslint . --quiet` — 7 أخطاء معروفة (لا كود)
  - `npm run test:rules` (`firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"`) — 340/340
  - `npm run build` — 938 kB
- **AC-03:** الجرد الخام (أ→هـ) في تقرير REQ-OFF1-0:
  - (أ) `git status --short` + `git log --oneline -5` + `git tag --list`
  - (ب) `vite.config.ts` + `index.html` + `public/` — إثبات غياب PWA
  - (ج) `services/firebase.ts` (`persistentLocalCache`) + `components/OfflineNotifier.tsx` — إثبات إشعار فقط
  - (د) `pages/POSPage.tsx:handleProcessSale` + `services/api.ts:processSale` — إثبات لا رفض فوري
  - (هـ) `firestore.rules` + `firestore.indexes.json` — إثبات لا تغيير مطلوب في P1
- **Edge:** جواب ناقص / تعارض D-O7 (ويب/أندرويد) — القرار: (ب) ويب فقط الآن.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + `git tag` — **Commit:** `docs: REQ-OFF1-0 offline-p1 baseline + D-O1..D-O7`

### REQ-OFF1-1 — هيكل PWA (واجهة فقط — لا بيانات)
- **الملفات المسموحة:** `package.json` (إضافة `vite-plugin-pwa` فقط — بلا major bumps), `vite.config.ts` (إعداد `VitePWA`), `index.html` (manifest link إن لزم), `public/manifest.json` (جديد), `public/icons/*` (إن لزم), `src/pwa.d.ts` (types)
- **AC-01:** `vite.config.ts` يحتوي `VitePWA({ registerType:'prompt', includeAssets:['**/*'], workbox:{ globPatterns:['**/*.{js,css,html,svg,png,woff2}'], navigateFallback:'index.html', cleanupOutdatedCaches:true, runtimeCaching:[] } })` — لا `runtimeCaching` لـ `firestore.googleapis.com`.
- **AC-02:** `public/manifest.json` موجود (`name:"Nour Elrahman", short_name:"Casher", display:"standalone", background_color:"#fff"`).
- **AC-03:** `npm run build` ينتج `dist/manifest.webmanifest` + `dist/sw.js` + `dist/workbox-*.js` — `dist/index.html` يحتوي تسجيل SW.
- **AC-04:** قطع الشبكة → تحديث الصفحة → الواجهة تفتح (لا ديناصور) — فحص يدوي في DevTools → Application → Cache Storage لا يحتوي `firestore.googleapis.com`.
- **Edge:** build بلا PWA / manifest مفقود / icons ناقصة.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + فحص يدوي أوفلاين — **Commit:** `feat(offline-p1): REQ-OFF1-1 PWA scaffold (UI only, no data cache)`

### REQ-OFF1-2 — رفض فوري + وضع قراءة فقط
- **الملفات المسموحة:** `hooks/useOffline.ts` (جديد), `components/OfflineBanner.tsx` (جديد), `App.tsx` (تركيب البانر), `pages/POSPage.tsx`, `pages/ReturnsPage.tsx`, `pages/SuppliersPage.tsx`, `pages/CustomerAccountPage.tsx` (تعطيل أزرار الكتابة), `services/api.ts` (preflight سريع قبل transaction)
- **AC-01:** `hooks/useOffline.ts` يصدّر `isOffline` من `navigator.onLine` + `getDocFromServer` ping بمهلة 2s قبل كل كتابة — `window:online/offline` + `visibilitychange`.
- **AC-02:** `App.tsx` يعرض `OfflineBanner` ثابت عند `isOffline` — `role="status"`.
- **AC-03:** كل أزرار `sell/return/customer.payment/supplier.ops` معطّلة عند `isOffline` مع `disabled + title` عربي — `can(...)` يبقى كما هو (لا يُتجاوز).
- **AC-04:** `handleProcessSale/handleProcessReturn` إن كان `isOffline` ترمي فورًا "لا إنترنت — لا يمكن إتمام العملية" بلا استدعاء `runTransaction` (≤1s).
- **Edge:** isOffline كاذب / ضغط مزدوج أوفلاين / محاسب معطّل.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + اختبار يدوي بقطع الشبكة (DevTools → Offline) — **Commit:** `feat(offline-p1): REQ-OFF1-2 immediate reject + read-only`

### REQ-OFF1-3 — تنبيه "يوجد إصدار جديد"
- **الملفات المسموحة:** `components/NewVersionBanner.tsx` (جديد), `App.tsx` (تركيب البانر), `vite.config.ts` (لا تغيير إن كان REQ-OFF1-1 ثبت `registerType:'prompt'`)
- **AC-01:** `NewVersionBanner` يستخدم `useRegisterSW({ onNeedRefresh() })` من `virtual:pwa-register/react` — عند `needRefresh===true` يظهر بانر "يوجد إصدار جديد — تحديث".
- **AC-02:** ضغطة "تحديث" تستدعي `updateServiceWorker(true)` وتُعيد التحميل — النسخة الجديدة تظهر.
- **AC-03:** لا تحديث صامت — المستخدم هو من يقرر.
- **Edge:** نشر متكرر / المستخدم تجاهل البانر.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + اختبار: `npm run build && firebase deploy --only hosting` ثم فتح الصفحة — البانر يظهر — **Commit:** `feat(offline-p1): REQ-OFF1-3 new version banner`

### REQ-OFF1-4 — تسجيل الانقطاعات (14 يومًا)
- **الملفات المسموحة:** `services/offlineLog.ts` (جديد), `hooks/useOffline.ts` (تسجيل), `services/monitoring.ts` (كتابة `clientErrors` إن وجدت), `pages/SettingsPage.tsx` (عرض الإحصائيات), `components/OfflineStats.tsx` (جديد)
- **AC-01:** `services/offlineLog.ts` يستخدم `idb-keyval` (IndexedDB) — `logOfflineStart(uid)` عند `offline`, `logOfflineEnd(uid)` عند `online` يحسب `durationMs` ويكتب `clientErrors{source:'offline-p1', start, end, durationMs, uid}` (إن كان `navigator.onLine` وكتب ناجحًا، وإلا محلي فقط).
- **AC-02:** `getOfflineStats()` ترجع `{count, totalMs, avgMs, maxMs, byDay: Record<string,number>}` — تُعرض في `SettingsPage` قسم "حالة الاتصال" + زر "تصدير السجل (JSON)".
- **AC-03:** لا `setInterval` دائم — التسجيل حدثي فقط (`online/offline`).
- **AC-04:** IndexedDB غير متاح → لا يمنع البيع (قراءة فقط تبقى) — يُسجّل في `clientErrors` فقط.
- **Edge:** offline طويل ساعات / flapping كل ثوانٍ / إغلاق التبويب أثناء offline.
- **تحقق:** `npx tsc --noEmit` + `npm run build` + `git diff --stat` + اختبار يدوي: قطع الشبكة 10s → إعادة → `offlineLog` يحتوي سجلًا — **Commit:** `feat(offline-p1): REQ-OFF1-4 offline telemetry 14d`

### REQ-OFF1-5 — إغلاق وتوثيق
- **الملفات المسموحة:** `docs/backlog.md`, `docs/changelog.md`, `docs/current-state-map.md`, `docs/known-issues.md`
- **AC-01:** تحديث `backlog.md` (Done OFF1-0…4) + `changelog.md` + `current-state-map.md` (عدد الاختبارات + PWA live).
- **AC-02:** `known-issues.md` قسم "P1 — Offline Readiness" يوثق القرارات D-O1…D-O7 + إحصائيات أولية بعد 14 يومًا.
- **AC-03:** `npm run test:rules` 340/340 + `npm run build` نظيف + `git diff --stat` يطابق allowed-files.
- **تحقق:** Guard Review كامل (أ/ب/ج) — لا READY بدون 100% — **Commit:** `docs: REQ-OFF1-5 offline-p1 closeout`

---

## 4) أسئلة للمالك (توقيع D-O1…D-O7)

> لا يبدأ REQ-OFF1-1 قبل توقيعك على الجدول §1.5 — الافتراضي يُطبق إن لم توقع خلال 48 ساعة.

---

## 5) توصية الترتيب

1.  **P1 (هذا المستند) — الآن.**
2.  **دورة الجاهزية (Backup/Restore/Reset) — بعد P1.**
3.  **P2 (الطابور) — فقط إن أثبت تقرير P1 (§2.5) أن الانقطاع متكرر (count ≥ 5 أو avg ≥ 2min في 14 يومًا).**

> **رسالة للوكيل:** لا تبدأ REQ-OFF1-1 قبل توقيع D-O1…D-O7 وإغلاق REQ-OFF1-0. P2 مؤجلة حتى أرقام P1.

---

*نهاية المسودة — بانتظار المراجعة الخبيرة وتوقيع المالك.*
