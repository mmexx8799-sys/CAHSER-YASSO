// REQ-BARCODE-BULK-A4 / T1: مودال طباعة باركودات شامل — كامل الكتالوج Real-time.
// منفصل تمامًا عن شبكة ProductsPage ومسار Checkbox القديم (T7: لا Regression).
// البيانات: subscribeToCollection<Product>('products', cb, [orderBy('name')]) — نفس helper dataCache.
// التحديد: Set<id> يبقى ثابتًا عبر تغيير البحث/الفلتر (الفلتر للعرض فقط).

import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Printer } from 'lucide-react';
import { orderBy } from 'firebase/firestore';
import type { Product, Category } from '../types';
import { subscribeToCollection } from '../services/dataCache';
import { BarcodeLabelSheet } from './BarcodeLabelSheet';

interface BulkBarcodePrintModalProps {
  categories: Category[];
  onClose: () => void;
}

export const BulkBarcodePrintModal: React.FC<BulkBarcodePrintModalProps> = ({ categories, onClose }) => {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // REQ-BARCODE-BULK-A4 / T3: عدد النسخ لكل منتج — افتراضي 1 عند أول تحديد
  const [copiesById, setCopiesById] = useState<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // REQ-BARCODE-BULK-A4 / T5: معاينة ورقة الطباعة المبنية من copiesById
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // REQ-BARCODE-BULK-A4 / T6: dialog تأكيد عتبة الأداء
  const [isPerfConfirmOpen, setIsPerfConfirmOpen] = useState(false);

  /** حد أقصى منطقي لكل منتج لمنع خطأ إدخال يهدد الأداء (T6). */
  const MAX_COPIES_PER_PRODUCT = 200;
  /**
   * T6: عتبة تحذير تحفظية — قابلة للتعديل بعد قياس فعلي على جهاز متوسط
   * (خصوصًا Capacitor Android WebView). فوقها يظهر Dialog تأكيد قبل فتح الورقة.
   */
  const PERF_WARN_THRESHOLD = 300;

  // T1: اشتراك كامل الكتالوج Real-time + cleanup
  useEffect(() => {
    const unsubscribe = subscribeToCollection<Product>('products', setAllProducts, [orderBy('name')]);
    return () => unsubscribe();
  }, []);

  const categoryNameOf = (categoryId: string): string =>
    categories.find((c) => c.id === categoryId)?.name || 'غير معروف';

  // T1: بحث نصي (اسم/كود/باركود) + فلتر تصنيف — عرض فقط، لا يمس التحديد
  const visibleProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (categoryFilter && p.categoryId !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }, [allProducts, searchQuery, categoryFilter]);

  const toggleSelect = (id: string) => {
    const isSelected = selectedIds.has(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // T3: دورة حياة copiesById تابعة لـ selectedIds — افتراضي 1 / حذف عند الإلغاء
    setCopiesById((prev) => {
      const next = new Map(prev);
      if (isSelected) next.delete(id);
      else if (!next.has(id)) next.set(id, 1);
      return next;
    });
  };

  // REQ-BARCODE-BULK-A4 / T2: تحديد جماعي — إضافي فقط على selectedIds، لا يمسح سابقًا
  // T3: أي id جديد يدخل التحديد يأخذ افتراضي 1 فقط لو مالهوش قيمة مخصصة بالفعل
  const selectVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of visibleProducts) next.add(p.id);
      return next;
    });
    setCopiesById((prev) => {
      const next = new Map(prev);
      for (const p of visibleProducts) {
        if (!next.has(p.id)) next.set(p.id, 1);
      }
      return next;
    });
  };

  const selectAllCatalog = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of allProducts) next.add(p.id);
      return next;
    });
    setCopiesById((prev) => {
      const next = new Map(prev);
      for (const p of allProducts) {
        if (!next.has(p.id)) next.set(p.id, 1);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setCopiesById(new Map());
  };

  // T3: تعديل فردي — clamp صحيح بين 1 و MAX، لا يمس باقي المنتجات
  const setCopies = (id: string, raw: number) => {
    const clamped = Math.min(MAX_COPIES_PER_PRODUCT, Math.max(1, Math.floor(raw) || 1));
    setCopiesById((prev) => {
      const next = new Map(prev);
      next.set(id, clamped);
      return next;
    });
  };

  // T3: "= كمية المخزون للكل" — يطبق Math.max(1, quantity) مع سقف الحماية
  const applyStockQuantities = () => {
    const byId = new Map(allProducts.map((p) => [p.id, p] as const));
    setCopiesById((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const prod = byId.get(id);
        const qty = prod ? Math.max(1, Math.floor(prod.quantity) || 1) : 1;
        next.set(id, Math.min(MAX_COPIES_PER_PRODUCT, qty));
      }
      return next;
    });
  };

  const excludedCount = useMemo(
    () => [...selectedIds].filter((id) => {
      const p = allProducts.find((prod) => prod.id === id);
      return !p || !p.barcode || p.barcode.trim() === '';
    }).length,
    [selectedIds, allProducts],
  );

  // T3: إجمالي الملصقات = مجموع نسخ المحدد (للعرض في العداد)
  const totalLabels = useMemo(
    () => [...selectedIds].reduce((sum, id) => sum + (copiesById.get(id) ?? 1), 0),
    [selectedIds, copiesById],
  );

  // REQ-BARCODE-BULK-A4 / T5: كل منتج محدد يتكرر بعدد نسخه — يُمرر لـ BarcodeLabelSheet
  // الذي يستبعد بلا باركود بمنطقه الحالي (لا تكرار لمنطق الاستبعاد هنا).
  const expandedProducts = useMemo(() => {
    const byId = new Map(allProducts.map((p) => [p.id, p] as const));
    return [...selectedIds].flatMap((id) => {
      const prod = byId.get(id);
      if (!prod) return [];
      const copies = copiesById.get(id) ?? 1;
      return Array.from({ length: copies }, () => prod);
    });
  }, [selectedIds, copiesById, allProducts]);

  // T6: طلب المتابعة — يعترض فوق العتبة بـ Dialog تأكيد، وتحته يفتح مباشرة
  const handleContinueRequest = () => {
    if (totalLabels > PERF_WARN_THRESHOLD) setIsPerfConfirmOpen(true);
    else setIsPreviewOpen(true);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">طباعة باركودات المنتجات</h2>
          <button onClick={onClose} aria-label="إغلاق شاشة طباعة الباركودات" className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
            <X size={24} />
          </button>
        </div>

        <p className="mb-4 font-semibold text-gray-700 dark:text-gray-300">
          محدد: {selectedIds.size} من إجمالي {allProducts.length} • إجمالي الملصقات: {totalLabels}
          {excludedCount > 0 && <span className="text-orange-600 dark:text-orange-300"> (مستبعد بلا باركود: {excludedCount})</span>}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <label htmlFor="bulkBarcodeSearch" className="sr-only">بحث في الكتالوج</label>
            <input
              id="bulkBarcodeSearch"
              name="bulkBarcodeSearch"
              type="text"
              placeholder="ابحث بالاسم أو الكود أو الباركود..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-lg"
            />
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} aria-hidden="true" />
          </div>
          <label htmlFor="bulkBarcodeCategory" className="sr-only">فلترة بالتصنيف</label>
          <select
            id="bulkBarcodeCategory"
            name="bulkBarcodeCategory"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-lg min-w-[180px]"
          >
            <option value="">كل التصنيفات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        {/* T2: أزرار التحديد الجماعي */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={selectVisible}
            disabled={visibleProducts.length === 0}
            className="py-1.5 px-4 bg-teal-600 text-white rounded-md font-semibold hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            تحديد الكل الظاهر ({visibleProducts.length})
          </button>
          <button
            type="button"
            onClick={selectAllCatalog}
            disabled={allProducts.length === 0}
            className="py-1.5 px-4 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            تحديد كل الكتالوج ({allProducts.length})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selectedIds.size === 0}
            className="py-1.5 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            إلغاء التحديد
          </button>
          {/* T3: اختصار كمية المخزون للكل المحدد */}
          <button
            type="button"
            onClick={applyStockQuantities}
            disabled={selectedIds.size === 0}
            title="تعيين عدد النسخ = كمية المخزون الحالية لكل منتج محدد"
            className="py-1.5 px-4 bg-purple-600 text-white rounded-md font-semibold hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            = كمية المخزون للكل
          </button>
        </div>

        <div className="flex-1 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
          {visibleProducts.length === 0 ? (
            <p className="text-center text-gray-600 dark:text-gray-300 p-8 text-lg">لا توجد منتجات مطابقة.</p>
          ) : (
            visibleProducts.map((p) => {
              const isSelected = selectedIds.has(p.id);
              return (
              <div key={p.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(p.id)}
                  aria-label={`تحديد ${p.name} للطباعة`}
                  className="h-5 w-5 shrink-0 accent-primary-600"
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                  <span className="block text-sm text-gray-600 dark:text-gray-300">
                    الكود: {p.code} • {categoryNameOf(p.categoryId)}
                    {p.barcode ? <span dir="ltr" className="font-mono"> • {p.barcode}</span> : <span className="text-orange-600 dark:text-orange-300"> • بلا باركود (سيُستبعد)</span>}
                  </span>
                </span>
                {/* T3: حقل النسخ يظهر فقط للصف المحدد — تعديل فردي لا يمس الباقي */}
                {isSelected && (
                  <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <label htmlFor={`copies-${p.id}`} className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">نسخ:</label>
                    <input
                      id={`copies-${p.id}`}
                      name={`copies-${p.id}`}
                      type="number"
                      min={1}
                      max={MAX_COPIES_PER_PRODUCT}
                      value={copiesById.get(p.id) ?? 1}
                      onChange={(e) => setCopies(p.id, Number(e.target.value))}
                      aria-label={`عدد نسخ ${p.name}`}
                      className="w-20 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-center font-bold"
                    />
                  </span>
                )}
              </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold text-lg"
          >
            إغلاق
          </button>
          {/* T5: تفعيل المتابعة — يعرض ورقة الطباعة بعدد النسخ الفعلي */}
          {/* T6: فوق العتبة يعترض بـ Dialog تأكيد أولًا */}
          <button
            onClick={handleContinueRequest}
            disabled={selectedIds.size === 0}
            className="inline-flex items-center gap-2 py-2 px-5 bg-primary-600 text-white rounded-md font-semibold text-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Printer size={20} aria-hidden="true" />
            متابعة ({totalLabels})
          </button>
        </div>
      </div>
      {/* T6: Dialog تأكيد عتبة الأداء */}
      {isPerfConfirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">تأكيد طباعة عدد كبير</h3>
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
              أنت على وشك طباعة {totalLabels} ملصق، قد يستغرق الرسم والطباعة وقتًا. هل تريد المتابعة؟
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsPerfConfirmOpen(false)}
                className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold text-lg"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  setIsPerfConfirmOpen(false);
                  setIsPreviewOpen(true);
                }}
                className="py-2 px-5 bg-primary-600 text-white rounded-md font-semibold text-lg hover:bg-primary-700"
              >
                متابعة ({totalLabels})
              </button>
            </div>
          </div>
        </div>
      )}
      {/* T5: ورقة الطباعة الفعلية — نفس BarcodeLabelSheet الحالي بتخطيط A4 الجديد */}
      {isPreviewOpen && (
        <BarcodeLabelSheet products={expandedProducts} onClose={() => setIsPreviewOpen(false)} />
      )}
    </div>
  );
};
