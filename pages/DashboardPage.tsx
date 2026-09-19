import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, PackageX } from 'lucide-react';
import { subscribeToCollection } from '../services/dataCache';
import type { Product, Category } from '../types';
import { computeStockAlerts, summarizeStockAlerts, groupStockAlertsByCategory } from '../utils/stockAlerts';
import { orderBy } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';

export default function DashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    const unsub = subscribeToCollection<Product>('products', setProducts);
    return () => unsub();
  }, []);

  useEffect(() => {
    const constraints: QueryConstraint[] = [orderBy('name')];
    const unsub = subscribeToCollection<Category>('categories', setCategories, constraints);
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

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-900 dark:text-gray-100">لوحة التحكّم</h1>

      {/* المؤشر البارز + قيمة المخزون المهدد — جنب بطاقات المبيعات */}
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

      {/* فلترة حسب التصنيف */}
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

      {/* Empty State */}
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
