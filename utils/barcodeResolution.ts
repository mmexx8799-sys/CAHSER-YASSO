// REQ-BARCODE-FIX-1 + REQ-A/REQ-B: منطق مسح الباركود المشترك بين POS والمرتجعات.
// نُقل حرفيًا من pages/POSPage.tsx (T1 — نقل كود، لا منطق جديد) ليُستخدم في
// الصفحتين بلا تكرار. العقد: `code` غير فارغ (المتصل يتجاهل الفارغ قبل الاستدعاء).
// localLookup: البحث المحلي (الفهرس + المصفوفة المحمّلة جزئيًا) —
// cloudLookup: الاستعلام السحابي الاحتياطي عند miss محلي فقط (pagination gap).

import type { Product } from '../types';
import { getScanBlockReason, type ScanBlockReason } from './findProductByBarcode';

export type BarcodeScanOutcome =
    | { status: 'found'; product: Product }
    | { status: 'blocked'; reason: Exclude<ScanBlockReason, 'not-found'>; product: Product }
    | { status: 'not-found' }
    | { status: 'cloud-error' };

// REQ-BARCODE-FIX-3: مهلة الاستعلام السحابي — شبكة متقطعة قد تعلّق getDocs
// إلى أجل غير مسمى فيبقى حارس إعادة الإرسال مرفوعًا للأبد وتُسقط كل المسحات
// التالية بصمت (يُحل فقط بإعادة mount الصفحة). المهلة تحوّل التعليق إلى
// cloud-error صريح مع رسالة اتصال.
export const CLOUD_LOOKUP_TIMEOUT_MS = 8000;

export const withCloudTimeout = (p: Promise<Product | null>): Promise<Product | null> =>
  Promise.race([
    p,
    new Promise<Product | null>((_, reject) =>
      window.setTimeout(() => reject(new Error('barcode-cloud-timeout')), CLOUD_LOOKUP_TIMEOUT_MS),
    ),
  ]);

export const resolveBarcodeScan = async (
    code: string,
    localLookup: (normalized: string) => Product | undefined,
    cloudLookup: (normalized: string) => Promise<Product | null>,
): Promise<BarcodeScanOutcome> => {
    const normalized = (code ?? '').trim();
    const local = localLookup(normalized);
    const localReason = getScanBlockReason(local);
    if (localReason === null) return { status: 'found', product: local! };
    if (localReason !== 'not-found') return { status: 'blocked', reason: localReason, product: local! };
    // miss محلي → خطوة ثانية سحابية قبل الحكم بـ"غير موجود" (FIX-1 AC-2)
    let cloud: Product | null;
    try {
        cloud = await cloudLookup(normalized);
    } catch {
        return { status: 'cloud-error' };
    }
    // AC-5: نفس الحارس على النتيجة السحابية — لا منطق موازٍ
    const cloudReason = getScanBlockReason(cloud ?? undefined);
    if (cloudReason === null) return { status: 'found', product: cloud! };
    if (cloudReason === 'not-found') return { status: 'not-found' };
    return { status: 'blocked', reason: cloudReason, product: cloud! };
};
