// REQ-BARCODE: مصدر الحقيقة الوحيد للبحث بالباركود — دالة نقية.
// تأخذ مصفوفة المنتجات المحمّلة أصلًا (نفس مصدر POS) كوسيط.
// ممنوع أي استيراد Firestore هنا (قرار معماري — انظر PLAN).

import type { Product } from '../types';

/**
 * بحث عن منتج بباركوده داخل المصفوفة المحمّلة.
 * - يتجاهل الفراغات الزائدة (trim)
 * - يطابق بدقة (case-sensitive بعد الـtrim — الباركودات المولّدة أحرف كبيرة)
 * - يُرجع undefined لباركود فارغ أو غير موجود (لا throw — المتصل يُظهر Toast)
 */
export const findProductByBarcode = (
  products: Product[],
  code: string,
): Product | undefined => {
  const normalized = (code ?? '').trim();
  if (!normalized) return undefined;
  return products.find((p) => p.barcode !== undefined && p.barcode !== '' && p.barcode === normalized);
};

/** بناء فهرس محلي Map<barcode, Product> من المصفوفة المحمّلة (بحث فوري بلا شبكة). */
export const buildBarcodeIndex = (products: Product[]): Map<string, Product> => {
  const index = new Map<string, Product>();
  for (const p of products) {
    if (p.barcode && !index.has(p.barcode)) {
      index.set(p.barcode, p);
    }
  }
  return index;
};

export type ScanBlockReason = 'not-found' | 'not-sellable' | 'out-of-stock';

/**
 * حارس إضافة المنتج الممسوح للسلة (AC-05/AC-06) — نفس الدالة التي يستخدمها
 * POSPage، فيُختبر نفس المنطق حرفيًا لا نسخة موازية.
 * - `sellable` حقل مستقبلي غير موجود في Product حاليًا → فحص عبر cast
 *   للتوافق الأمامي (لا يُحجب شيء اليوم بهذا السبب).
 */
export const getScanBlockReason = (
  product: Product | undefined,
): ScanBlockReason | null => {
  if (!product) return 'not-found';
  if ((product as Product & { sellable?: boolean }).sellable === false) return 'not-sellable';
  if (product.quantity <= 0) return 'out-of-stock';
  return null;
};
