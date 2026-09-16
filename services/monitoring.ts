// 2.2-free — تتبع أخطاء مجاني 100%: سجل Firestore داخلي (clientErrors)
// بلا أي خدمة خارجية ولا فيزا ولا مفاتيح.
//
// كيف ترى الأخطاء؟ Firebase Console → Firestore → مجموعة clientErrors
// (القراءة للأدمن فقط حسب القواعد). كل تقرير: message + stack + source +
// url + uid + createdAt.
//
// حماية الحصة (Spark مجاني): حد أقصى 10 تقارير / 10 دقائق لكل جلسة —
// عطل متكرر (حلقة) يُسجَّل محليًا فقط بعد الحد ولا يلتهم الكوتا.
// الإرسال fire-and-forget ولا يرمي إطلاقًا (أي فشل = سجل محلي فقط،
// ولا يعيد الإبلاغ عن نفسه حتى لا تحدث حلقة لا نهائية).
//
// ترقية اختيارية لاحقًا (Sentry): أبقينا setErrorReporter — ثبّت
// @sentry/react واستدعِها في index.tsx كما هو موثق في DEPLOY.md.

import { addDoc, collection } from 'firebase/firestore';
import { getAuthInstance, getDB } from './firebase';

export interface ErrorContext {
  /** اسم المكوّن أو الصفحة التي وقع فيها الخطأ */
  source?: string;
  /** معلومات إضافية اختيارية (بلا كلمات مرور أو مفاتيح إطلاقًا) */
  extra?: Record<string, string>;
}

type Reporter = (error: unknown, context?: ErrorContext) => void;

let reporter: Reporter | null = null;

/** تُستدعى مرة واحدة عند تفعيل Sentry (اختياري) — قبلها no-op. */
export function setErrorReporter(r: Reporter): void {
  reporter = r;
}

// --- Firestore reporter (نشط دائمًا) ---------------------------------------

const MAX_REPORTS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
let windowStart = Date.now();
let sentInWindow = 0;
let isSending = false;

function throttleAllows(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_REPORTS_PER_WINDOW) return false;
  sentInWindow++;
  return true;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function sendToFirestore(error: unknown, context?: ErrorContext): void {
  if (isSending || !throttleAllows()) return;
  isSending = true;
  try {
    const err = error instanceof Error ? error : null;
    const payload = {
      message: truncate(toMessage(error), 1000) || 'Unknown error',
      stack: truncate(err?.stack, 2000),
      source: truncate(context?.source, 100),
      url: truncate(typeof window !== 'undefined' ? window.location.href : undefined, 500),
      createdAt: Date.now(),
      uid: getAuthInstance()?.currentUser?.uid,
    };
    // إسقاط الحقول غير المعرّفة حتى يجتاز حارس الشكل في القواعد.
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );
    void addDoc(collection(getDB(), 'clientErrors'), clean).catch(() => {
      // فشل الإرسال (انقطاع/صلاحيات) — السجل المحلي أدناه يكفي.
    });
  } catch {
    // getDB قبل التهيئة أو أي عطل متزامن — تجاهل تام.
  } finally {
    isSending = false;
  }
}

/**
 * المسار الوحيد للإبلاغ عن الأخطاء — يستخدمه ErrorBoundary ومعالجات
 * window في index.tsx. السجل المحلي + Firestore يعملان دائمًا.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  if (reporter) {
    try {
      reporter(error, context);
    } catch {
      // المُبلِّغ نفسه فشل — المسارات أدناه تكفي.
    }
  }
  sendToFirestore(error, context);
  if (context?.source) {
    console.error(`[monitoring:${context.source}]`, error);
  } else {
    console.error('[monitoring]', error);
  }
}
