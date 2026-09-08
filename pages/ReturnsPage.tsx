
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Trash2, Undo2, AlertCircle, Settings, Loader2 } from 'lucide-react';
import type { Product, CartItem, DailyArchive, Category, Customer } from '../types';
import { getProductsPaginated, getOpenDailyArchive, processReturn, getCustomersPaginated } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import { useDebounce } from '../hooks/useDebounce';
import { toast } from 'react-hot-toast';
import { orderBy } from 'firebase/firestore';
import type { QueryDocumentSnapshot, QueryConstraint } from 'firebase/firestore';
import { useConfirmation } from '../components/ConfirmationProvider';
import { useReturnCartStore } from '../stores/returnCartStore';


const ArchiveGuard: React.FC<{ type: 'sale' | 'return' }> = ({ type }) => {
    const navigate = useNavigate();
    const messages = {
        sale: {
            title: "لم يتم فتح اليومية",
            body: "لا يمكنك إجراء عمليات بيع. يرجى بدء يومية جديدة من صفحة الإعدادات أولاً."
        },
        return: {
            title: "لم يتم فتح اليومية",
            body: "لا يمكنك إجراء عمليات إرجاع. يرجى بدء يومية جديدة من صفحة الإعدادات أولاً."
        }
    }
    return (
        <div className="absolute top-0 bottom-0 left-0 right-0 bg-white dark:bg-gray-900 flex flex-col justify-center items-center text-center p-4 z-50">
            <AlertCircle size={48} className="text-orange-400 mb-4" />
            <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">{messages[type].title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{messages[type].body}</p>
            <button
                onClick={() => navigate('/settings')}
                className="flex items-center space-x-2 bg-primary-600 text-white py-2 px-4 rounded-lg shadow hover:bg-primary-700"
            >
                <Settings size={20} />
                <span>الانتقال إلى الإعدادات</span>
            </button>
        </div>
    );
};

const ProductCard: React.FC<{ product: Product; categoryName: string; onAddToReturnCart: (product: Product) => void }> = ({ product, categoryName, onAddToReturnCart }) => (
    <div
        className={`group bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-3 flex flex-col justify-between cursor-pointer transition-all duration-300 hover:shadow-md hover:border-primary-400 dark:hover:border-primary-500 hover:-translate-y-1 h-full ${product.quantity === 0 ? 'opacity-60 grayscale' : ''}`}
        onClick={() => onAddToReturnCart(product)}
    >
        <div className="w-full mb-2 flex justify-between items-start">
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-primary-600 text-white border border-primary-700 shadow-sm tracking-wide">
                {categoryName}
            </span>
            <span className={`flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full text-xs font-bold border ${product.quantity > 5 ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'}`}>
                {product.quantity}
            </span>
        </div>

        <h2 className="font-bold text-gray-800 dark:text-gray-100 text-base leading-snug mb-3 line-clamp-2 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors min-h-[2.5rem]" title={product.name}>
            {product.name}
        </h2>

        <div className="mt-auto pt-2 border-t border-gray-100 dark:border-gray-700 w-full flex justify-between items-end">
            <span className="text-xs text-gray-600 dark:text-gray-300 font-medium mb-1">السعر</span>
            <p className="text-primary-700 dark:text-primary-300 font-bold text-xl">
                {product.price.toFixed(2)} <span className="text-xs font-normal text-gray-600 dark:text-gray-300">ج.م</span>
            </p>
        </div>
    </div>
);
const MemoizedProductCard = memo(ProductCard);

const ProductGrid = memo(({
    products,
    categories,
    onAddToReturnCart,
    lastProductElementRef,
    isLoadingMore,
    hasMore,
    isLoading
}: {
    products: Product[],
    categories: Category[],
    onAddToReturnCart: (p: Product) => void,
    lastProductElementRef: (node: HTMLDivElement) => void,
    isLoadingMore: boolean,
    hasMore: boolean,
    isLoading: boolean
}) => {
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-full pt-10">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {products.map((product, index) => {
                    const categoryName = categories.find(c => c.id === product.categoryId)?.name || 'غير مصنف';
                    const card = <MemoizedProductCard product={product} categoryName={categoryName} onAddToReturnCart={onAddToReturnCart} />;
                    if (products.length === index + 1) {
                        return <div ref={lastProductElementRef} key={product.id} className="h-full">{card}</div>
                    } else {
                        return <div key={product.id} className="h-full">{card}</div>;
                    }
                })}
            </div>
            {isLoadingMore && <div className="text-center p-4">جاري تحميل المزيد...</div>}
            {!hasMore && products.length > 0 && <div className="text-center p-4 text-gray-700 dark:text-gray-300">لا يوجد المزيد من المنتجات.</div>}
            {!isLoading && products.length === 0 && <div className="text-center p-10 text-gray-700 dark:text-gray-300">لم يتم العثور على منتجات.</div>}
        </>
    );
});

const ReturnCartModal: React.FC<{
    dailyArchive: DailyArchive | null;
    categories: Category[];
}> = ({ dailyArchive, categories }) => {
    const { confirm } = useConfirmation();
    const { returnCart, total, isCartModalOpen, setCartModalOpen, clearCart, updateItem, removeItem } = useReturnCartStore();
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [customerResults, setCustomerResults] = useState<Customer[]>([]);
    const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
    const debouncedCustomerSearch = useDebounce(customerSearch, 300);

    useEffect(() => {
        if (!isCartModalOpen) {
            setSelectedCustomer(null);
            setCustomerSearch('');
            setCustomerResults([]);
        }
    }, [isCartModalOpen]);

    useEffect(() => {
        if (selectedCustomer || !debouncedCustomerSearch.trim()) {
            setCustomerResults([]);
            return;
        }
        setIsSearchingCustomers(true);
        getCustomersPaginated(debouncedCustomerSearch, null).then(({ customers }) => {
            setCustomerResults(customers.slice(0, 8));
            setIsSearchingCustomers(false);
        });
    }, [debouncedCustomerSearch, selectedCustomer]);

    const getCategoryName = useCallback((categoryId: string) => {
        return categories.find(c => c.id === categoryId)?.name || 'غير مصنف';
    }, [categories]);

    const handleClearReturnCart = async () => {
        if (isProcessing) return;
        const confirmed = await confirm({
            title: "تأكيد إفراغ السلة",
            message: "هل أنت متأكد من رغبتك في إفراغ سلة المرتجعات؟"
        });
        if (confirmed) {
            clearCart();
            setSelectedCustomer(null);
            setCustomerSearch('');
            toast.success('تم إفراغ السلة بنجاح!');
        }
    }

    const handleProcessReturn = async () => {
        if (!dailyArchive) {
            toast.error("لا يمكن إتمام الإرجاع، لم يتم فتح اليومية.");
            return;
        }
        if (returnCart.length === 0) {
            toast.error("سلة المرتجعات فارغة.");
            return;
        }
        if (isProcessing) return;

        if (selectedCustomer) {
            const confirmed = await confirm({
                title: "تأكيد إرجاع مرتبط بعميل",
                message: `سيتم خصم ${total.toFixed(2)} ج.م من رصيد ${selectedCustomer.name}. المتابعة؟`
            });
            if (!confirmed) return;
        }

        setIsProcessing(true);
        try {
            await processReturn(returnCart, dailyArchive.id, selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : undefined);
            clearCart();
            setSelectedCustomer(null);
            setCustomerSearch('');
            setCartModalOpen(false);
        } catch (error: any) {
            toast.error(error.message || "حدث خطأ أثناء عملية الإرجاع.");
            console.error(error);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isCartModalOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-end z-50">
            <div className="bg-white dark:bg-gray-800 rounded-t-lg shadow-xl p-4 w-full max-w-lg h-3/4 flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">سلة المرتجعات</h2>
                    <div className='flex items-center gap-4'>
                        <button
                            onClick={handleClearReturnCart}
                            disabled={isProcessing}
                            aria-label="إفراغ السلة"
                            className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex items-center gap-1 text-sm disabled:opacity-50"
                        >
                            <Trash2 size={16} />
                            إفراغ السلة
                        </button>
                        <button onClick={() => !isProcessing && setCartModalOpen(false)} disabled={isProcessing} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"><X /></button>
                    </div>
                </div>
                {returnCart.length === 0 ? (
                    <div className="flex-1 flex flex-col justify-center items-center text-gray-600 dark:text-gray-300">
                        <Undo2 size={48} className="mb-4" />
                        <p>لا يوجد مرتجعات حالياً</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        {returnCart.map(item => (
                            <div key={item.id} className="flex items-center justify-between py-3 border-b gap-2">
                                <div className="flex-1 pr-2">
                                    <p className="font-bold text-lg line-clamp-2 text-gray-900 dark:text-gray-100">{item.name}</p>
                                    <p className="text-sm text-gray-600 dark:text-gray-300">{getCategoryName(item.categoryId)}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <label htmlFor={`retQty-${item.id}`} className="text-xs">الكمية:</label>
                                    <input
                                        id={`retQty-${item.id}`}
                                        name={`retQty-${item.id}`}
                                        type="number"
                                        value={item.buyQuantity}
                                        onChange={(e) => updateItem(item.id, parseInt(e.target.value) || 1)}
                                        className="w-16 p-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center"
                                        min="1"
                                        autoComplete="off"
                                        disabled={isProcessing}
                                    />
                                </div>
                                <p className="w-24 text-left font-bold text-sm">{(item.price * item.buyQuantity).toFixed(2)} ج.م</p>
                                <button
                                    onClick={() => removeItem(item.id)}
                                    className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 p-2 disabled:opacity-50"
                                    disabled={isProcessing}
                                    aria-label={`حذف ${item.name}`}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="p-3 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 mt-auto space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ربط بعميل (اختياري)</label>
                        {selectedCustomer ? (
                            <div className="flex items-center justify-between bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 rounded-lg px-3 py-2">
                                <div>
                                    <p className="font-bold text-gray-900 dark:text-gray-100">{selectedCustomer.name}</p>
                                    <p className="text-xs text-gray-700 dark:text-gray-200">{selectedCustomer.phone || ''} — عليه مديونية: {(selectedCustomer.balance||0).toFixed(2)} ج.م</p>
                                </div>
                                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="text-gray-500 hover:text-red-700 p-1" disabled={isProcessing} aria-label="إلغاء اختيار العميل"><X size={16}/></button>
                            </div>
                        ) : (
                            <div className="relative">
                                <label htmlFor="retCustomerSearch" className="sr-only">ابحث عن عميل</label>
                                <input
                                    id="retCustomerSearch"
                                    name="retCustomerSearch"
                                    type="text"
                                    placeholder="ابحث بالاسم..."
                                    value={customerSearch}
                                    onChange={e => setCustomerSearch(e.target.value)}
                                    className="w-full p-2 pr-8 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                                    autoComplete="off"
                                    disabled={isProcessing}
                                />
                                <Search className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                {customerResults.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                                        {customerResults.map(c => (
                                            <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]); }} className="w-full text-right px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex justify-between">
                                                <span className="font-medium">{c.name}</span>
                                                <span className="text-xs text-gray-600 dark:text-gray-300">{c.phone || ''}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {isSearchingCustomers && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">جاري البحث...</p>}
                            </div>
                        )}
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold">إجمالي المرتجع</span>
                        <span className="text-2xl font-bold text-red-700 dark:text-red-300">{total.toFixed(2)} ج.م</span>
                    </div>
                    <button
                        onClick={handleProcessReturn}
                        disabled={returnCart.length === 0 || !dailyArchive || dailyArchive.status === 'closed' || isProcessing}
                        className="w-full py-3 px-4 bg-red-600 text-white rounded-lg font-bold text-lg shadow-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex justify-center items-center space-x-2 space-x-reverse"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="animate-spin" size={24} />
                                <span>جاري المعالجة...</span>
                            </>
                        ) : (
                            <span>تأكيد الإرجاع</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ReturnsPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const { returnCart, total, addToReturnCart, setCartModalOpen } = useReturnCartStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [dailyArchive, setDailyArchive] = useState<DailyArchive | null>(null);
    const [isArchiveLoading, setIsArchiveLoading] = useState(true);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');

    // Pagination state
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const observer = useRef<IntersectionObserver | null>(null);
    const lastProductElementRef = useCallback((node: HTMLDivElement) => {
        if (isLoading || isLoadingMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadMoreProducts();
            }
        });
        if (node) observer.current.observe(node);
    }, [isLoading, isLoadingMore, hasMore]);

    const loadProducts = async (isNewSearch = false) => {
        if (isNewSearch) {
            setIsLoading(true);
            setProducts([]); // Clear immediately to prevent duplication visuals
            setLastDoc(null);
            setHasMore(true);
        } else {
            setIsLoadingMore(true);
        }

        const filters = {
            searchQuery: debouncedSearchQuery,
            categoryId: selectedCategory || undefined
        };
        const { products: newProducts, lastDoc: newLastDoc } = await getProductsPaginated(filters, isNewSearch ? null : lastDoc);

        setHasMore(newProducts.length > 0);
        setProducts(prev => {
            const combined = isNewSearch ? newProducts : [...prev, ...newProducts];
            // Strictly ensure unique products by ID
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique;
        });
        setLastDoc(newLastDoc);

        setIsLoading(false);
        setIsLoadingMore(false);
    };

    const loadMoreProducts = useCallback(() => {
        if (!isLoadingMore && hasMore) {
            loadProducts(false);
        }
    }, [isLoadingMore, hasMore]);

    useEffect(() => {
        if (!isArchiveLoading && dailyArchive) {
            loadProducts(true);
        }
    }, [debouncedSearchQuery, selectedCategory, dailyArchive, isArchiveLoading]);

    useEffect(() => {
        const constraints: QueryConstraint[] = [orderBy('name')];
        const unsubscribeCategories = subscribeToCollection<Category>('categories', setCategories, constraints);

        setIsArchiveLoading(true);
        getOpenDailyArchive()
            .then(setDailyArchive)
            .catch(err => toast.error('فشل في تحميل اليومية: ' + err.message))
            .finally(() => setIsArchiveLoading(false));

        return () => unsubscribeCategories();
    }, []);

    const handleAddToReturnCart = useCallback((product: Product) => {
        addToReturnCart(product);
    }, [addToReturnCart]);

    if (isArchiveLoading) {
        return (
            <div className="flex justify-center items-center h-full relative">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!dailyArchive) {
        return <div className="relative h-full"><ArchiveGuard type="return" /></div>;
    }

    return (
        <div className="p-4 pb-24">
            <div className="sticky top-0 z-30 py-4 space-y-4 -mx-4 px-4 shadow-sm mb-4 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900">
                <div className="relative">
                    <label htmlFor="retSearch" className="sr-only">ابحث عن منتج</label>
                    <input
                        id="retSearch"
                        name="retSearch"
                        type="text"
                        placeholder="ابحث عن منتج..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                        className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
                    />
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                </div>
                <label htmlFor="retCategory" className="sr-only">التصنيف</label>
                <select
                    id="retCategory"
                    name="retCategory"
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    value={selectedCategory}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
                >
                    <option value="">كل التصنيفات</option>
                    {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                </select>
            </div>

            <div className="mt-16">
                <ProductGrid
                    products={products}
                    categories={categories}
                    onAddToReturnCart={handleAddToReturnCart}
                    lastProductElementRef={lastProductElementRef}
                    isLoadingMore={isLoadingMore}
                    hasMore={hasMore}
                    isLoading={isLoading}
                />
            </div>

            {returnCart.length > 0 && (
                <button
                    onClick={() => setCartModalOpen(true)}
                    className="fixed bottom-20 left-1/2 -translate-x-1/2 w-11/12 max-w-md h-16 bg-red-600 text-white rounded-full shadow-lg flex justify-between items-center px-6 z-40 hover:bg-red-700 transition-transform transform hover:scale-105"
                >
                    <div className="flex items-center space-x-2 space-x-reverse">
                        <Undo2 aria-hidden="true" />
                        <span className="bg-white text-red-700 rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm">{returnCart.length}</span>
                    </div>
                        <span className="font-bold text-lg text-white">سلة المرتجعات</span>
                    <span className="font-extrabold text-lg text-white">{total.toFixed(2)} ج.م</span>
                </button>
            )}

            <ReturnCartModal dailyArchive={dailyArchive} categories={categories} />
        </div>
    );
}
