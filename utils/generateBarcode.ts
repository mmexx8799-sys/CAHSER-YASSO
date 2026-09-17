// REQ-BARCODE: توليد باركود داخلي فريد بصيغة ثابتة:
// `MKT` + base36(time,6) + base36(random,5) = 14 حرفًا ثابتًا.
// الباركود داخلي (لا يمثل منتجًا تجاريًا معروفًا — لا GS1).

export const BARCODE_PREFIX = 'MKT';
export const BARCODE_LENGTH = 14;
export const BARCODE_MAX_ATTEMPTS = 100;

const toBase36Padded = (num: number, len: number): string => {
  // base36 بأحرف كبيرة، مقصوص/مكمل بالأصفار من اليسار لطول ثابت
  const raw = Math.abs(Math.floor(num)).toString(36).toUpperCase().replace(/[^0-9A-Z]/g, '0');
  if (raw.length >= len) return raw.slice(-len);
  return raw.padStart(len, '0');
};

/** توليد مرشح واحد (قد يتصادم — use generateUniqueBarcode للتفرّد). */
export const generateBarcodeCandidate = (): string => {
  const timePart = toBase36Padded(Date.now() % (36 ** 6), 6);
  const randPart = toBase36Padded(Math.floor(Math.random() * (36 ** 5)), 5);
  return `${BARCODE_PREFIX}${timePart}${randPart}`;
};

/**
 * توليد باركود فريد: فحص محلي فوري أولًا (Set من نفس الـcache)،
 * ثم فحص سحابي فقط عند التصادم المحلي (نادر جدًا — يوفّر قراءات).
 * @param existingBarcodes باركودات المنتجات المحمّلة حاليًا
 * @param checkCloudExists فحص وجود سحابي — تُستدعى فقط عند الحاجة (اختياري)
 * @throws Error صريح بعد maxAttempts بدل باركود مكرر صامت
 */
export const generateUniqueBarcode = async (
  existingBarcodes: Set<string>,
  checkCloudExists?: (code: string) => Promise<boolean>,
  maxAttempts: number = BARCODE_MAX_ATTEMPTS,
): Promise<string> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = generateBarcodeCandidate();
    if (existingBarcodes.has(candidate)) continue;
    if (checkCloudExists) {
      const existsCloud = await checkCloudExists(candidate);
      if (existsCloud) continue;
    }
    return candidate;
  }
  throw new Error('تعذّر توليد باركود فريد بعد 100 محاولة — حاول مرة أخرى');
};

/** نسخة متزامنة خالصة للاختبارات والمسارات بلا سحابة. */
export const generateUniqueBarcodeSync = (
  existingBarcodes: Set<string>,
  maxAttempts: number = BARCODE_MAX_ATTEMPTS,
): string => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = generateBarcodeCandidate();
    if (!existingBarcodes.has(candidate)) return candidate;
  }
  throw new Error('تعذّر توليد باركود فريد بعد 100 محاولة — حاول مرة أخرى');
};

export const isValidBarcodeFormat = (code: string): boolean =>
  typeof code === 'string' &&
  code.length === BARCODE_LENGTH &&
  code.startsWith(BARCODE_PREFIX);
