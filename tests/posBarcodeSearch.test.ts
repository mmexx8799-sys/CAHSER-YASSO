// REQ-BARCODE — بحث الباركود في POS + حارس الإضافة + منع التكرار.
// وحدات خالصة (vitest، بلا Emulator): نفس الدوال التي يستخدمها POSPage
// حرفيًا (findProductByBarcode / getScanBlockReason / BarcodeDeduper) —
// لا نسخة موازية للمنطق. E2E بالكاميرا الحقيقية مؤجّل (mock getUserMedia
// معقد — موثّق في ملخص REQ) ويُعوَّض باختبار يدوي: توليد → طباعة → مسح.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  findProductByBarcode,
  buildBarcodeIndex,
  getScanBlockReason,
} from '../utils/findProductByBarcode';
import { BarcodeDeduper } from '../hooks/useBarcodeScanner';
import { resolveZxingWasmUrl, LOCAL_ZXING_WASM_URL } from '../hooks/useBarcodeScanner';
import type { Product } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

const mkProduct = (id: string, barcode?: string, quantity = 10, extra: Record<string, unknown> = {}): Product => ({
  id,
  code: `C-${id}`,
  name: `منتج ${id}`,
  price: 25,
  quantity,
  categoryId: 'cat-1',
  createdAt: Date.now(),
  searchableIndex: [],
  ...(barcode !== undefined ? { barcode } : {}),
  ...extra,
} as Product);

const catalog: Product[] = [
  mkProduct('a', 'MKTABC123DEFGH'),
  mkProduct('b', 'MKTXYZ987QWERT'),
  mkProduct('c'), // بلا باركود
  mkProduct('d', 'MKTOUT000STOCK', 0), // نافد
  mkProduct('e', 'MKTNOSALE00001', 5, { sellable: false }), // غير قابل للبيع (حقل مستقبلي)
];

describe('REQ-BARCODE: findProductByBarcode', () => {
  it('يطابق باركود صحيح', () => {
    expect(findProductByBarcode(catalog, 'MKTABC123DEFGH')?.id).toBe('a');
  });

  it('undefined لباركود غير موجود (لا Silent fail — المتصل يُظهر Toast)', () => {
    expect(findProductByBarcode(catalog, 'MKTNOTEXIST000')).toBeUndefined();
  });

  it('يتجاهل الفراغات الزائدة (trim) — مهم لقارئ USB', () => {
    expect(findProductByBarcode(catalog, '  MKTXYZ987QWERT\n')?.id).toBe('b');
  });

  it('سلسلة فارغة → undefined بلا throw', () => {
    expect(findProductByBarcode(catalog, '')).toBeUndefined();
    expect(findProductByBarcode(catalog, '   ')).toBeUndefined();
  });

  it('الفهرس المحلي يبني Map صحيحة ويستبعد من بلا باركود', () => {
    const index = buildBarcodeIndex(catalog);
    expect(index.get('MKTABC123DEFGH')?.id).toBe('a');
    // 4 باركودات فقط (c بلا باركود مستبعد)
    expect(index.size).toBe(4);
  });
});

describe('REQ-BARCODE: حارس الإضافة getScanBlockReason (نفس منطق POS)', () => {
  it('منتج نشط وله كمية → يُضاف (null = لا حظر)', () => {
    expect(getScanBlockReason(findProductByBarcode(catalog, 'MKTABC123DEFGH'))).toBeNull();
  });

  it('باركود غير موجود → not-found (تنبيه "غير موجود")', () => {
    expect(getScanBlockReason(findProductByBarcode(catalog, 'MKTNOPE0000000'))).toBe('not-found');
  });

  it('منتج sellable=false → not-sellable (لا إضافة + تنبيه)', () => {
    expect(getScanBlockReason(findProductByBarcode(catalog, 'MKTNOSALE00001'))).toBe('not-sellable');
  });

  it('منتج نافد quantity<=0 → out-of-stock (يُمسح بنجاح لكن لا يُضاف)', () => {
    expect(getScanBlockReason(findProductByBarcode(catalog, 'MKTOUT000STOCK'))).toBe('out-of-stock');
  });
});

describe('REQ-BARCODE AC-04: حارس منع التكرار BarcodeDeduper', () => {
  it('مسح متكرر سريع لنفس الباركود قبل الخروج من الإطار → إصدار واحد فقط', () => {
    const d = new BarcodeDeduper(1500, 1000);
    const t0 = 1_000_000;
    expect(d.shouldEmit('MKTABC123DEFGH', t0)).toBe(true);
    // رصد متواصل كل 100ms لمدة 5 ثوانٍ — كلها محجوبة
    for (let t = t0 + 100; t <= t0 + 5000; t += 100) {
      expect(d.shouldEmit('MKTABC123DEFGH', t)).toBe(false);
    }
  });

  it('باركود مختلف يُصدر فورًا حتى داخل الـcooldown', () => {
    const d = new BarcodeDeduper(1500, 1000);
    const t0 = 1_000_000;
    expect(d.shouldEmit('MKTABC123DEFGH', t0)).toBe(true);
    expect(d.shouldEmit('MKTXYZ987QWERT', t0 + 200)).toBe(true);
  });

  it('خروج من الإطار (غياب ≥ leave) ثم عودة → إصدار جديد', () => {
    const d = new BarcodeDeduper(1500, 1000);
    const t0 = 1_000_000;
    expect(d.shouldEmit('MKTABC123DEFGH', t0)).toBe(true);
    expect(d.shouldEmit('MKTABC123DEFGH', t0 + 200)).toBe(false);
    d.noteAbsence(t0 + 200 + 1000); // غاب عن الإطار
    expect(d.shouldEmit('MKTABC123DEFGH', t0 + 2000)).toBe(true);
  });

  it('غياب قصير (< leave) لا يعيد التفعيل', () => {
    const d = new BarcodeDeduper(1500, 1000);
    const t0 = 1_000_000;
    expect(d.shouldEmit('MKTABC123DEFGH', t0)).toBe(true);
    d.noteAbsence(t0 + 500); // غياب 500ms فقط منذ آخر رؤية
    expect(d.shouldEmit('MKTABC123DEFGH', t0 + 600)).toBe(false);
  });

  it('تكامل: مسح نشط واحد عبر الفهرس + الحارس + المكرر = إضافة واحدة', () => {
    const index = buildBarcodeIndex(catalog);
    const d = new BarcodeDeduper();
    const cart: string[] = [];
    const scan = (code: string, now: number) => {
      if (!d.shouldEmit(code, now)) return;
      const p = index.get(code.trim());
      if (getScanBlockReason(p) !== null) return;
      cart.push(p!.id);
    };
    const t0 = Date.now();
    scan('MKTABC123DEFGH', t0);
    scan('MKTABC123DEFGH', t0 + 100);
    scan('MKTABC123DEFGH', t0 + 200);
    scan('MKTNOPE0000000', t0 + 300); // غير موجود
    scan('MKTOUT000STOCK', t0 + 400); // نافد
    expect(cart).toEqual(['a']);
  });
});

describe('REQ-BARCODE-FIX-2 (2026-09-18): محرك المسح محلي لا CDN', () => {
  it('ملف الـwasm يُحل للمسار المحلي — لا jsdelivr إطلاقًا', () => {
    expect(resolveZxingWasmUrl('zxing_reader.wasm')).toBe(LOCAL_ZXING_WASM_URL);
    expect(resolveZxingWasmUrl('zxing_reader.wasm')).not.toContain('jsdelivr');
    expect(resolveZxingWasmUrl('zxing_reader.wasm')).not.toContain('http');
  });

  it('المسارات غير-wasm تُترك كما هي (سلوك emscripten الافتراضي)', () => {
    expect(resolveZxingWasmUrl('something.data')).toBe('something.data');
  });
});

