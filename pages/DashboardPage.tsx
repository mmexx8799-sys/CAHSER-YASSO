import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, PackageX } from 'lucide-react';
import { subscribeToCollection } from '../services/dataCache';
import type { Product, Category, DailyArchive, Invoice, Return } from '../types';
import { computeStockAlerts, summarizeStockAlerts, groupStockAlertsByCategory } from '../utils/stockAlerts';
import {
  getRangeBounds,
  filterArchivesByRange,
  aggregateRange,
  compareRanges,
  topSellingDays,
  topSellingProducts,
  type RangePreset,
} from '../utils/dashboardAggregation';
import { orderBy, limit, where, query, collection, getDocs, Timestamp } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { getDB } from '../services/firebase';

const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'اليوم',
  '7d': 'آخر 7 أيام',
  '30d': 'آخر 30 يومًا',
  month: 'هذا الشهر',
};

export default function DashboardPage() {
  // Stock alerts state
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Analytics state
  const [archives, setArchives] = useState<DailyArchive[]>([]);
  const [range, setRange] = useState<RangePreset>('7d');
  const [isArchivesLoading, setIsArchivesLoading] = useState(true);

  // Lazy top products
  const [topProducts, setTopProducts] = useState<ReturnType<typeof topSellingProducts> | null>(null);
  const [topProductsLoading, setTopProductsLoading] = useState(false);
  const [topProductsError, setTopProductsError] = useState<string | null>(null);
  const [topProductsRequested, setTopProductsRequested] = useState(false);

  useEffect(() => {
    const unsub = subscribeToCollection<Product>('products', setProducts);
    return () => unsub();
  }, []);

  useEffect(() => {
    const constraints: QueryConstraint[] = [orderBy('name')];
    const unsub = subscribeToCollection<Category>('categories', setCategories, constraints);
    return () => unsub();
  }, []);

  // DailyArchives — limit 31 per SPEC (first use of limit() in project)
  useEffect(() => {
    const constraints: QueryConstraint[] = [orderBy('startTime', 'desc'), limit(31)];
    const unsub = subscribeToCollection<
      Omit<DailyArchive, 'startTime' | 'endTime'> & { startTime: Timestamp; endTime?: Timestamp }
    >(
      'dailyArchives',
      (data) => {
        const mapped: DailyArchive[] = data.map((a) => ({
          ...a,
          startTime: a.startTime instanceof Timestamp ? a.startTime.toMillis() : (a.startTime as unknown as number),
          endTime: a.endTime instanceof Timestamp ? a.endTime.toMillis() : (a.endTime as unknown as number | undefined),
        }));
        setArchives(mapped);
        setIsArchivesLoading(false);
      },
      constraints,
    );
    return () => unsub();
  }, []);

  const alerts = useMemo(() => computeStockAlerts(products), [products]);
  const summary = useMemo(() => summarizeStockAlerts(alerts), [alerts]);
  const grouped = useMemo(() => groupStockAlertsByCategory(alerts), [alerts]);
  const filteredAlerts = useMemo(() => {
    if (!selectedCategory) return alerts;
    return grouped.get(selectedCategory) ?? [];
  }, [alerts, grouped, selectedCategory]);
  const filteredSummary = useMemo(() => summarizeStockAlerts(filteredAlerts), [filteredAlerts]);
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'غير معروف';

  // Range calculations — derived from already-loaded archives (no extra loading per button per AC-02)
  const bounds = useMemo(() => getRangeBounds(range), [range]);
  const currentArchives = useMemo(() => filterArchivesByRange(archives, bounds.start, bounds.end), [archives, bounds]);
  const previousArchives = useMemo(
    () => filterArchivesByRange(archives, bounds.prevStart, bounds.prevEnd),
    [archives, bounds],
  );
  const currentSummary = useMemo(() => aggregateRange(currentArchives), [currentArchives]);
  const previousSummary = useMemo(() => aggregateRange(previousArchives), [previousArchives]);
  const comparison = useMemo(() => compareRanges(currentSummary, previousSummary), [currentSummary, previousSummary]);
  const topDays = useMemo(() => topSellingDays(currentArchives, 5), [currentArchives]);

  const hasClosedArchive = useMemo(() => archives.some((a) => a.status === 'closed'), [archives]);

  // Lazy load top products — only when user requests
  const handleLoadTopProducts = async () => {
    setTopProductsRequested(true);
    setTopProductsLoading(true);
    setTopProductsError(null);
    try {
      const db = getDB();
      // AC-06: warn if too many invoices
      const startTs = Timestamp.fromMillis(bounds.start);
      const endTs = Timestamp.fromMillis(bounds.end);
      const invQ = query(
        collection(db, 'invoices'),
        where('createdAt', '>=', startTs),
        where('createdAt', '<=', endTs),
      );
      const retQ = query(
        collection(db, 'returns'),
        where('createdAt', '>=', startTs),
        where('createdAt', '<=', endTs),
      );
      const [invSnap, retSnap] = await Promise.all([getDocs(invQ), getDocs(retQ)]);

      if (invSnap.size > 2000) {
        // show note but still process
        setTopProductsError('قد يستغرق التحميل وقتًا أطول — عدد الفواتير كبير (>2000)');
      }

      const invoices: Invoice[] = invSnap.docs.map((d) => {
        const data = d.data() as any;
        let createdAt = Date.now();
        if (data.createdAt instanceof Timestamp) createdAt = data.createdAt.toMillis();
        else if (typeof data.createdAt === 'number') createdAt = data.createdAt;
        return { id: d.id, ...data, createdAt } as Invoice;
      });
      const returns: Return[] = retSnap.docs.map((d) => {
        const data = d.data() as any;
        let createdAt = Date.now();
        if (data.createdAt instanceof Timestamp) createdAt = data.createdAt.toMillis();
        else if (typeof data.createdAt === 'number') createdAt = data.createdAt;
        return { id: d.id, ...data, createdAt } as Return;
      });

      const ranked = topSellingProducts(invoices, returns, 10);
      setTopProducts(ranked);
    } catch (e: any) {
      setTopProductsError(e?.message || 'فشل تحميل أكثر المنتجات مبيعًا');
    } finally {
      setTopProductsLoading(false);
    }
  };

  // Reset lazy state when range changes
  useEffect(() => {
    setTopProducts(null);
    setTopProductsError(null);
    setTopProductsRequested(false);
  }, [range]);

  if (isArchivesLoading) {
    return (
      <div className="p-4 lg:p-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">لوحة التحكّم</h1>
        <p className="text-center text-gray-600 dark:text-gray-300">جاري تحميل البيانات...</p>
      </div>
    );
  }

  // AC-01 empty state
  if (!hasClosedArchive) {
    return (
      <div className="p-4 lg:p-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-900 dark:text-gray-100">لوحة التحكّم</h1>
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">لا توجد بيانات كافية بعد</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">لم يتم إغلاق أي يومية حتى الآن</p>
        </div>
        {/* Stock alerts still shown below even when no closed archive */}
        {alerts.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center mt-4">
            <p className="text-lg font-semibold text-green-700 dark:text-green-300">✅ كل المخزون فوق الحد الأدنى</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-900 dark:text-gray-100">لوحة التحكّم</h1>

      {/* Range selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(RANGE_LABELS) as RangePreset[]).map((preset) => (
          <button
            key={preset}
            onClick={() => setRange(preset)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              range === preset
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {RANGE_LABELS[preset]}
          </button>
        ))}
      </div>

      {/* Summary cards — production: فصل تام للنقدي عن التحويلات */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-green-500">
          <p className="text-sm text-gray-600 dark:text-gray-300">إجمالي المبيعات</p>
          <p className="text-xl font-bold text-green-700 dark:text-green-300">{currentSummary.totalSales.toFixed(2)} ج.م</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-red-500">
          <p className="text-sm text-gray-600 dark:text-gray-300">إجمالي المرتجعات</p>
          <p className="text-xl font-bold text-red-700 dark:text-red-300">{currentSummary.totalReturns.toFixed(2)} ج.م</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-emerald-600">
          <p className="text-sm text-gray-600 dark:text-gray-300">إجمالي النقدي</p>
          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{currentSummary.totalCash.toFixed(2)} ج.م</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">قبل خصم مرتجع الكاش</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-blue-600">
          <p className="text-sm text-gray-600 dark:text-gray-300">صافي النقدية بالدرج</p>
          <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{currentSummary.netCash.toFixed(2)} ج.م</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">نقدي فقط − مرتجع نقدي (بدون فودافون/انستا)</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-purple-600">
          <p className="text-sm text-gray-600 dark:text-gray-300">فودافون كاش</p>
          <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{currentSummary.totalVodafoneCash.toFixed(2)} ج.م</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">تحويلات منفصلة</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-teal-600">
          <p className="text-sm text-gray-600 dark:text-gray-300">انستا باي</p>
          <p className="text-xl font-bold text-teal-700 dark:text-teal-300">{currentSummary.totalInstapay.toFixed(2)} ج.م</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">تحويلات منفصلة</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow text-center border-t-4 border-gray-400">
          <p className="text-sm text-gray-600 dark:text-gray-300">أيام العمل</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{currentSummary.workingDays}</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">أرشيف مغلق</p>
        </div>
      </div>

      {/* Comparison */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المقارنة مع المدى السابق</p>
        {comparison.pct === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {comparison.direction === 'flat' ? 'لا توجد بيانات للمقارنة' : `المبيعات السابقة 0 — الحالية ${comparison.current.toFixed(2)} ج.م`}
          </p>
        ) : (
          <p className={`text-lg font-bold ${comparison.direction === 'up' ? 'text-green-600' : comparison.direction === 'down' ? 'text-red-600' : 'text-gray-600'}`}>
            {comparison.pct > 0 ? '+' : ''}
            {comparison.pct.toFixed(1)}% {comparison.direction === 'up' ? '↑' : comparison.direction === 'down' ? '↓' : '—'}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400 mr-2">
              ({previousSummary.totalSales.toFixed(2)} → {currentSummary.totalSales.toFixed(2)} ج.م)
            </span>
          </p>
        )}
      </div>

      {/* Top selling days */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
        <h2 className="font-bold text-lg mb-3 text-gray-900 dark:text-gray-100">أكثر أيام العمل مبيعًا (أعلى 5)</h2>
        {topDays.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">لا توجد أيام بمبيعات ضمن المدى</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">
                  <th className="py-2 px-2">اليوم</th>
                  <th className="py-2 px-2">المبيعات</th>
                  <th className="py-2 px-2">المرتجعات</th>
                </tr>
              </thead>
              <tbody>
                {topDays.map((a) => (
                  <tr key={a.id} className="border-b dark:border-gray-700">
                    <td className="py-2 px-2 font-medium">{a.id}</td>
                    <td className="py-2 px-2 text-green-700 dark:text-green-300">{(a.totalSales || 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-red-700 dark:text-red-300">{(a.totalReturns || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top selling products — lazy */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
        <h2 className="font-bold text-lg mb-3 text-gray-900 dark:text-gray-100">أكثر المنتجات مبيعًا</h2>
        {!topProductsRequested ? (
          <button
            onClick={handleLoadTopProducts}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700"
          >
            عرض أكثر المنتجات مبيعًا
          </button>
        ) : topProductsLoading ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">جاري تحميل الفواتير...</p>
        ) : topProductsError && topProducts && topProducts.length > 2000 ? (
          <p className="text-sm text-amber-600">{topProductsError}</p>
        ) : topProductsError && !topProducts ? (
          <p className="text-sm text-red-600">{topProductsError}</p>
        ) : topProducts && topProducts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">لا توجد مبيعات لمنتجات ضمن المدى</p>
        ) : topProducts ? (
          <>
            {topProductsError && <p className="text-xs text-amber-600 mb-2">{topProductsError}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">
                    <th className="py-2 px-2">المنتج</th>
                    <th className="py-2 px-2">الكمية الصافية</th>
                    <th className="py-2 px-2">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.productId} className="border-b dark:border-gray-700">
                      <td className="py-2 px-2 font-medium truncate max-w-[200px]" title={p.name}>
                        {p.name} <span className="text-xs text-gray-500">({p.code})</span>
                      </td>
                      <td className="py-2 px-2">{p.quantity}</td>
                      <td className="py-2 px-2">{p.total.toFixed(2)} ج.م</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {/* Stock alerts section — preserved from REQ-DASHBOARD-StockAlerts supplement */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">تنبيهات المخزون</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {summary.outCount} صنف نافد • {summary.lowCount} صنف تحت الحد الأدنى
          </p>
          {selectedCategory && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              (التصنيف: {categoryName(selectedCategory)} — {filteredSummary.outCount} نافد • {filteredSummary.lowCount} تحت الحد)
            </p>
          )}
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-amber-200 dark:border-amber-800">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">قيمة المخزون المهدّد ماليًا</p>
          <p className="text-xl font-bold text-amber-700 dark:text-amber-300">
            {(selectedCategory ? filteredSummary.totalValueAtRisk : summary.totalValueAtRisk).toFixed(2)} ج.م
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {selectedCategory ? `للتصنيف: ${categoryName(selectedCategory)}` : 'مجموع (الكمية × السعر) للأصناف في التنبيهات فقط'}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="dashboardCategoryFilter" className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
            فلترة حسب التصنيف
          </label>
          <select
            id="dashboardCategoryFilter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg"
          >
            <option value="">كل التصنيفات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center">
          <p className="text-lg font-semibold text-green-700 dark:text-green-300">✅ كل المخزون فوق الحد الأدنى</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">لا توجد أصناف نافدة أو تحت الحد حاليًا</p>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center">
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">لا توجد تنبيهات في هذا التصنيف</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">جرّب اختيار تصنيف آخر أو عرض كل التصنيفات</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <h2 className="font-bold text-lg mb-3 text-gray-900 dark:text-gray-100">تنبيهات المخزون</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredAlerts.map(({ product, status, min }) => {
              const out = status === 'out';
              return (
                <Link
                  key={product.id}
                  to={`/products?focus=${encodeURIComponent(product.id)}`}
                  className={`p-3 rounded-lg border text-center block hover:shadow-md transition-shadow ${
                    out
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                  }`}
                >
                  <div className={`flex justify-center mb-1 ${out ? 'text-red-700 dark:text-red-300' : 'text-orange-700 dark:text-orange-300'}`}>
                    {out ? <PackageX size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate" title={product.name}>
                    {product.name}
                  </p>
                  <p className={`text-xs mt-1 font-semibold ${out ? 'text-red-700 dark:text-red-300' : 'text-orange-700 dark:text-orange-300'}`}>
                    {out ? 'نافد' : `متبقي ${product.quantity} (الحد ${min})`}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">{categoryName(product.categoryId)}</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
