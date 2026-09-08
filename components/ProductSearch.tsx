import React, { memo } from 'react';
import { Search } from 'lucide-react';
import type { Category } from '../types';

interface ProductSearchProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    selectedCategory: string;
    onCategoryChange: (categoryId: string) => void;
    categories: Category[];
}

export const ProductSearch: React.FC<ProductSearchProps> = memo(({
    searchQuery,
    onSearchChange,
    selectedCategory,
    onCategoryChange,
    categories
}) => {
    return (
        <div className="sticky top-0 z-40 py-4 space-y-4 -mx-4 px-4 shadow-sm mb-4 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
            <div className="relative">
                <label htmlFor="posSearch" className="sr-only">ابحث عن منتج</label>
                <input
                    id="posSearch"
                    name="posSearch"
                    type="text"
                    placeholder="ابحث عن منتج بالاسم أو الكود..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    autoComplete="off"
                    className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                />
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
            </div>
            <label htmlFor="posCategory" className="sr-only">التصنيف</label>
            <select
                id="posCategory"
                name="posCategory"
                onChange={(e) => onCategoryChange(e.target.value)}
                value={selectedCategory}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
                <option value="">كل التصنيفات</option>
                {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
            </select>
        </div>
    );
});
