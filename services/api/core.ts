// services/api/core.ts — REQ-ARCH1-0 (ARCH-1 step 0/9)
// النواة المشتركة المنقولة حرفيًا من services/api.ts (نقل بنيوي، صفر تغيير منطقي).
// visibility-only: db وassertOnline وassertCan وrunTransactionWithRetry وgetDefinedPrices
// وisPriceAccepted أصبحت مُصدَّرة (كانت غير مُصدَّرة) للاستخدام الداخلي بين الوحدات فقط —
// لا يُعاد تصديرها عبر barrel services/api.ts. RETRYABLE_TX_CODES وsleepMs تبقيان خاصتين
// بالوحدة (لا يستخدمهما أحد خارج runTransactionWithRetry).
import {
    doc,
    getDoc,
    getDocFromServer,
    runTransaction,
    deleteDoc
} from "firebase/firestore";
import { getDB } from '../firebase';
import {
    getAuth
} from "firebase/auth";
import { can } from '../../utils/permissions';
import { withInFlightGuard } from '../inflight';


export const db = getDB();

// RBAC-2026-09 R2: Preflight — يتحقق من القدرة قبل أي حذف (AC-01) — يرمي خطأ عربي واضح قبل أول حذف
export async function assertCan(capability: Parameters<typeof can>[1]): Promise<void> {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("يجب تسجيل الدخول أولاً");
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) throw new Error("حساب المستخدم غير موجود");
  const role = (snap.data() as any).role;
  if (!can(role, capability)) {
    throw new Error("ليس لديك صلاحية لتنفيذ هذه العملية");
  }
}

// OFFLINE-P1 D-O8: علامة مميزة لخطأ الحارس — الواجهة تعرض message مباشرة
// لهذا النوع فقط، وأي خطأ آخر يبقى بالسلوك الحالي (لا تسريب لتفاصيل تقنية).
export class OfflineGuardError extends Error {
  readonly code = 'offline-guard';
  constructor(message: string) {
    super(message);
    this.name = 'OfflineGuardError';
  }
}
export const isOfflineGuardError = (e: any): boolean =>
  !!e && (e instanceof OfflineGuardError || e?.code === 'offline-guard' || e?.name === 'OfflineGuardError');

// OFFLINE-P1 D-O8 (أ): رفض فوري على مستوى الخدمة — أول سطر في كل دالة كتابة قبل أي await/Firestore
export interface OnlineDeps {
    /** بديل navigator.onLine — دالة تُستدعى طازجة عند كل فحص (3 نقاط قراءة)، لا قيمة مخزنة */
    isOnline: () => boolean;
    /** بديل getDocFromServer(counters/invoices) — قد ينجح أو يرفض أو يُعلَّق */
    ping: () => Promise<unknown>;
    /** بديل setTimeout — الإنتاج: مؤقت حقيقي؛ الاختبار: مؤقت فوري */
    delay: (ms: number) => Promise<unknown>;
    /** مهلة الـping — default 2000 (القيمة الحالية حرفيًا) */
    timeoutMs?: number;
}

// OFF1-2: نواة الحارس القابلة للاختبار — نفس منطق assertOnline حرفيًا مع حقن
// التبعيات. كل قراءة لـisOnline() نداء دالة حقيقي في لحظتها (الفحص الأولي +
// شرطا الرفض في مساري الـcatch) — لا تخزين في متغير. ملاحظة موثقة لا إصلاح:
// الـtimer الخاسر للسباق يرفض لاحقًا بلا handler — نفس السلوك الحالي حرفيًا.
export async function assertOnlineCore(deps: OnlineDeps): Promise<void> {
    const timeoutMs = deps.timeoutMs ?? 2000;
    // مؤقت جديد طازج مع كل سباق (لا يُعاد استخدام مؤقت محلول — السباق الثاني
    // يحتاج مهلة كاملة خاصة به).
    const timeoutRacer = () => deps.delay(timeoutMs).then(() => {
        throw new Error('offline-timeout');
    });
    if (!deps.isOnline()) {
        throw new OfflineGuardError("أنت غير متصل بالإنترنت — لا يمكن إتمام العملية أوفلاين");
    }
    // preflight خفيف (ج): getDocFromServer بمهلة 2s — يكشف Captive Portal حيث navigator.onLine true كاذب
    // عند فشل ping الأول بـ offline-timeout فقط، أعد محاولة واحدة إضافية بنفس المهلة قبل الرفض
    try {
        await Promise.race([deps.ping(), timeoutRacer()]);
    } catch (e: any) {
        if (String(e?.message || '').includes('offline-timeout')) {
            try {
                await Promise.race([deps.ping(), timeoutRacer()]);
            } catch (e2: any) {
                const m2 = String(e2?.message || '').toLowerCase();
                const c2 = String(e2?.code || '').toLowerCase();
                if (m2.includes('offline-timeout') || c2.includes('unavailable') || c2.includes('network') || m2.includes('network') || m2.includes('offline') || !deps.isOnline()) {
                    throw new OfflineGuardError("لا يوجد اتصال بالإنترنت — تحقق من الشبكة");
                }
                // permission-denied / not-found etc — treat as online, don't block
            }
            return;
        }
        // أخطاء الشبكة الحقيقية (unavailable/network-request-failed) — تعامل كأوفلاين وترفض من أول مرة
        const code = String(e?.code || '').toLowerCase();
        const msg = String(e?.message || '').toLowerCase();
        if (code.includes('unavailable') || code.includes('network') || msg.includes('network') || msg.includes('offline') || !deps.isOnline()) {
            throw new OfflineGuardError("أنت غير متصل بالإنترنت — لا يمكن إتمام العملية أوفلاين");
        }
        // أخطاء أخرى (مثل permission-denied / not-found) تعني الاتصال موجود — لا تمنع الكتابة
    }
}

export async function assertOnline(): Promise<void> {
    // تجاوز الحارس في بيئة الاختبار (vitest / emulator) — الاختبارات لا تختبر الأوفلاين هنا
    const viteEnv = (import.meta as any).env || {};
    if (viteEnv.MODE === 'test' || viteEnv.VITEST || (typeof process !== 'undefined' && (process as any).env?.VITEST)) return;
    if (typeof navigator === 'undefined') return;
    await assertOnlineCore({
        isOnline: () => navigator.onLine,
        ping: () => getDocFromServer(doc(db, 'counters', 'invoices')),
        delay: (ms) => new Promise((res) => setTimeout(res, ms)),
    });
}


// REQ-P0-3 — helper: الأسعار المعرّفة للمنتج والحد الأدنى للتحقق
export function getDefinedPrices(productData: any): number[] {
    const prices: number[] = [];
    if (typeof productData.price === 'number') prices.push(productData.price);
    if (typeof productData.retailCashPrice === 'number') prices.push(productData.retailCashPrice);
    if (typeof productData.retailCreditPrice === 'number') prices.push(productData.retailCreditPrice);
    if (typeof productData.wholesaleCashPrice === 'number') prices.push(productData.wholesaleCashPrice);
    if (typeof productData.wholesaleCreditPrice === 'number') prices.push(productData.wholesaleCreditPrice);
    return prices.filter(v => typeof v === 'number' && !Number.isNaN(v));
}
export function isPriceAccepted(submittedPrice: number, productData: any): boolean {
    const defined = getDefinedPrices(productData);
    if (defined.length === 0) return true; // لا يوجد سعر مرجعي — لا يمكن التحقق
    if (defined.includes(submittedPrice)) return true; // (a) مطابق لأحد الأسعار
    const minPrice = Math.min(...defined);
    if (minPrice <= 0) return true;
    return submittedPrice >= 0.5 * minPrice; // (b) ≥ 50% من أقل سعر
}

// BUG-P0-14c: bounded application-level retry around runTransaction.
// The Firestore SDK retries automatically ONLY on retryable codes
// (ABORTED/UNAVAILABLE). When a rule compares resource.data (the counters
// +1 check), the loser of a commit race fails rule evaluation with
// PERMISSION_DENIED — which the SDK never retries, so the sale/purchase
// would be lost permanently. Re-running the whole transaction gets fresh
// reads, so genuine timing contention resolves; genuine denials (disabled
// user, real RBAC rejection) fail every attempt and still surface — only
// ~1s later. Business validation errors (plain Errors without .code,
// thrown before any commit) are never retried.
const RETRYABLE_TX_CODES = ['permission-denied', 'aborted', 'unavailable'];
const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// E-5 load-test instrumentation (نمط OFF1-2/OnlineDeps): اختياري دائم، صفر أثر إنتاجي عند undefined.
export type TxRetryInfo = { label: string; attempt: number; code: string; nextDelayMs: number };

export async function runTransactionWithRetry<T>(label: string, attemptFn: (transaction: any) => Promise<T>, maxAttempts = 4, onRetry?: (info: TxRetryInfo) => void): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await runTransaction(db, attemptFn as any);
        } catch (error: any) {
            lastError = error;
            const retryable = RETRYABLE_TX_CODES.includes(String(error?.code || ''));
            if (!retryable) throw error;
            if (attempt === maxAttempts) {
                // استنفاد retryable فقط يُوسم — أخطاء البيزنس (بلا .code) تخرج من الفرع أعلاه بلا وسم أبدًا.
                (error as any)._txExhausted = true;
                (error as any)._txAttempts = maxAttempts;
                (error as any)._txLabel = label;
                throw error;
            }
            // E-5: backoff أسّي مكبوت يكسر القطيع: min(150 * 2^(attempt-1), 1200) + [0,150)ms
            // attempt=1 → ~150, 2 → ~300, 3 → ~600, 4+ → ~1200 (+jitter) — أسوأ حالة لـ7 محاولات ≈ 4-5s.
            const nextDelayMs = Math.min(150 * 2 ** (attempt - 1), 1200) + Math.floor(Math.random() * 150);
            if (onRetry) { try { onRetry({ label, attempt, code: String(error?.code || ''), nextDelayMs }); } catch { /* قياس فقط — لا يتدخل */ } }
            await sleepMs(nextDelayMs);
        }
    }
    throw lastError;
}

// Generic function to delete a document
export const deleteDocument = withInFlightGuard(async (collectionPath: string, id: string) => {
    await assertOnline();
    try {
        await deleteDoc(doc(db, collectionPath, id));
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error deleting document: ", e);
        throw new Error("Failed to delete document");
    }
});
