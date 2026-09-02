<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1L7zw00qToWtS4amwy9RdM8LpWATyy28j

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## حدود الخطة المجانية (Firebase Spark)

التطبيق يعمل على خطة Firebase المجانية (Spark) بحدود يومية:
- ~50,000 قراءة يوميًا
- ~20,000 كتابة يوميًا
- 1 GB تخزين

### كيف تراقب استهلاكك؟
- افتح [Firebase Console](https://console.firebase.google.com/) لمشروعك
- اذهب إلى **Usage** (الاستخدام) من القائمة الجانبية
- راجع الرسوم البيانية اليومية للقراءات/الكتابات

### متى يجب التفكير بترقية الخطة (Blaze)؟
- أكثر من 3 أجهزة كاشير تعمل باستمرار (يزيد عدد القراءات)
- أكثر من 300 عميل مسجّل مع تتبع رصيد نشط
- استخدام مكثف لتقارير/نسخ احتياطية يومية
- تحتاج Cloud Functions (إرسال إيميلات، تعطيل حسابات من السيرفر، إلخ)
