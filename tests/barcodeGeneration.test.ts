// REQ-BARCODE — وحدات خالصة (vitest، بلا Emulator):
// طول ثابت 14، تفرّد محلي، سلوك maxAttempts عند تصادم مُجبر.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateBarcodeCandidate,
  generateUniqueBarcode,
  generateUniqueBarcodeSync,
  isValidBarcodeFormat,
  BARCODE_LENGTH,
} from '../utils/generateBarcode';

afterEach(() => {
  vi.restoreAllMocks();
});

const mkProduct = (barcode?: string, overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  code: 'C1',
  name: 'منتج',
  price: 10,
  quantity: 5,
  categoryId: 'cat',
  createdAt: 1,
  searchableIndex: [],
  ...(barcode !== undefined ? { barcode } : {}),
  ...overrides,
});

describe('REQ-BARCODE: توليد الباركود', () => {
  it('المرشح دائمًا 14 حرفًا بالبادئة MKT', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateBarcodeCandidate();
      expect(c).toHaveLength(BARCODE_LENGTH);
      expect(c.startsWith('MKT')).toBe(true);
      expect(isValidBarcodeFormat(c)).toBe(true);
    }
  });

  it('تفرّد عبر 1000 توليد متتالٍ محليًا', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = generateUniqueBarcodeSync(seen);
      expect(seen.has(c)).toBe(false);
      seen.add(c);
      expect(c).toHaveLength(BARCODE_LENGTH);
    }
    expect(seen.size).toBe(1000);
  });

  it('maxAttempts: تصادم مُجبر (مرشح ثابت) → خطأ صريح لا باركود مكرر صامت', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const forced = generateBarcodeCandidate();
    const existing = new Set([forced]);
    await expect(generateUniqueBarcode(existing, undefined, 5)).rejects.toThrow();
    expect(() => generateUniqueBarcodeSync(existing, 5)).toThrow();
  });

  it('الفحص السحابي يُستدعى ويُحترم: موجود سحابيًا → تصادم', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // المرشح ثابت والفحص السحابي يدّعي الوجود دائمًا → يجب أن يفشل بعد المحاولات
    await expect(generateUniqueBarcode(new Set(), async () => true, 3)).rejects.toThrow();
  });

  it('الفحص السحابي السالب يمرّر المرشح فورًا', async () => {
    const code = await generateUniqueBarcode(new Set(), async () => false, 3);
    expect(code).toHaveLength(BARCODE_LENGTH);
  });

  it('AC-01: منتج بلا باركود — mkProduct يعمل بلا حقل barcode (اختياري)', () => {
    const p = mkProduct();
    expect('barcode' in p).toBe(false);
  });
});
