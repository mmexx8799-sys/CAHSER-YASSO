// REQ-BARCODE: معاينة وطباعة ملصقات باركود المنتج (ملصق شيلف — ليس إيصال بيع).
// الرسم بـ jsbarcode (CODE128 SVG) بعرض فيزيائي ثابت ~208px مهما كان طول القيمة.
// الملصق دائمًا بخلفية بيضاء صريحة حتى في الوضع الداكن (ضرورة فنية للمسح).

import React, { useEffect, useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import * as JsBarcodeNS from 'jsbarcode';
import type { Product } from '../types';

/** عرض العمود الفيزيائي الثابت للملصق (px). */
export const LABEL_WIDTH_PX = 208;

/**
 * حساب عرض الوحدة (bar module) لضمان عرض فيزيائي ثابت:
 * modules = start(11) + len*11 + checksum(11) + stop(13).
 */
export const barcodeModuleWidth = (value: string, targetPx: number = LABEL_WIDTH_PX): number => {
  const modules = 11 + value.length * 11 + 11 + 13;
  return targetPx / modules;
};

const renderBarcode = (el: SVGSVGElement, value: string): void => {
  const fn: any = (JsBarcodeNS as any).default ?? (JsBarcodeNS as any);
  fn(el, value, {
    format: 'CODE128',
    width: barcodeModuleWidth(value),
    height: 56,
    displayValue: false,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  });
};

const BarcodeSvg: React.FC<{ value: string }> = ({ value }) => {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      try {
        renderBarcode(ref.current, value);
      } catch {
        /* قيمة غير قابلة للرسم — يُعرض النص فقط */
      }
    }
  }, [value]);
  return <svg ref={ref} aria-label={`باركود ${value}`} />;
};

const LabelCard: React.FC<{ product: Product }> = ({ product }) => (
  <div
    className="barcode-label bg-white text-black border border-gray-400 rounded p-2 flex flex-col items-center gap-1"
    style={{ width: LABEL_WIDTH_PX }}
  >
    <p className="font-bold text-sm text-center leading-tight line-clamp-2 w-full">{product.name}</p>
    {product.barcode && <BarcodeSvg value={product.barcode} />}
    <p dir="ltr" className="text-xs font-mono tracking-widest">{product.barcode}</p>
    <p className="text-sm font-bold">{product.price.toFixed(2)} ج.م</p>
  </div>
);

interface BarcodeLabelSheetProps {
  products: Product[];
  onClose: () => void;
}

export const BarcodeLabelSheet: React.FC<BarcodeLabelSheetProps> = ({ products, onClose }) => {
  const printable = useMemo(() => products.filter((p) => p.barcode && p.barcode.trim() !== ''), [products]);
  const excludedCount = products.length - printable.length;

  // REQ-BARCODE-BULK-A4 / T6: رندر تدريجي (chunked) — دفعات 60 ملصق لكل إطار
  // عبر requestAnimationFrame (يسقط لـ setTimeout في WebView القديم)، لتفادي تجميد
  // الواجهة عند رسم مئات الـ SVG دفعة واحدة. زرار الطباعة معطّل حتى اكتمال كل الدفعات
  // حتى لا تُطبع ورقة ناقصة لو ضغط المستخدم مبكرًا.
  const CHUNK_INITIAL = 60;
  const CHUNK_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(CHUNK_INITIAL, printable.length));

  useEffect(() => {
    setVisibleCount(Math.min(CHUNK_INITIAL, printable.length));
  }, [printable.length]);

  useEffect(() => {
    if (visibleCount >= printable.length) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      setVisibleCount((prev) => Math.min(printable.length, prev + CHUNK_SIZE));
    };
    if (typeof requestAnimationFrame !== 'undefined') {
      raf = requestAnimationFrame(() => {
        advance();
      });
    } else {
      timer = setTimeout(advance, 0);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [visibleCount, printable.length]);

  const visible = useMemo(() => printable.slice(0, visibleCount), [printable, visibleCount]);
  const isComplete = visibleCount >= printable.length;

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* نافذة المعاينة (تُخفى عند الطباعة) */}
      <div className="barcode-print-no fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              معاينة ملصقات الباركود ({printable.length})
            </h2>
            <button onClick={onClose} aria-label="إغلاق المعاينة" className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
              <X size={24} />
            </button>
          </div>

          {excludedCount > 0 && (
            <p className="mb-4 p-3 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded-md font-semibold">
              تنبيه: تم استبعاد {excludedCount} منتج بلا باركود من الورقة المطبوعة.
            </p>
          )}

          {!isComplete && printable.length > 0 && (
            <p className="mb-4 p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-md font-semibold">
              جاري تجهيز الملصقات {visibleCount} من {printable.length}...
            </p>
          )}

          {printable.length === 0 ? (
            <p className="text-center text-gray-600 dark:text-gray-300 p-8 text-lg">
              لا توجد منتجات بباركود للطباعة.
            </p>
          ) : (
            <div className="flex flex-wrap gap-4 justify-center bg-gray-100 dark:bg-gray-900 p-4 rounded-lg">
              {/* T5-fix: مفاتيح فريدة تدعم تكرار نفس المنتج بعدد نسخه (REQ-BARCODE-BULK-A4) */}
              {/* T6: عرض تدريجي — visible فقط، والمفاتيح مطابقة للأندكس الأصلي (slice من 0) */}
              {visible.map((p, idx) => (
                <LabelCard key={`${p.id}-${idx}`} product={p} />
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold text-lg"
            >
              إغلاق
            </button>
            <button
              onClick={handlePrint}
              disabled={printable.length === 0 || !isComplete}
              title={!isComplete ? 'انتظر اكتمال تجهيز كل الملصقات قبل الطباعة' : undefined}
              className="inline-flex items-center gap-2 py-2 px-5 bg-primary-600 text-white rounded-md font-semibold text-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Printer size={20} />
              طباعة ({printable.length})
            </button>
          </div>
        </div>
      </div>

      {/* ورقة الطباعة المعزولة — تُعرض فقط في @media print */}
      {createPortal(
        <div className="barcode-print-sheet" aria-hidden="true">
          {/* T5-fix: نفس المفاتيح الفريدة لورقة الطباعة الفعلية */}
          {/* T6: نفس الـ visible التدريجي — الطباعة معطّلة حتى اكتماله فلا ورقة ناقصة */}
          {visible.map((p, idx) => (
            <LabelCard key={`${p.id}-${idx}`} product={p} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};
