
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Trash2, Undo2, AlertCircle, Settings, Loader2, FileText, Link2 } from 'lucide-react';
import type { Product, DailyArchive, Category, Customer, Invoice, Return } from '../types';
import { PaymentMethod } from '../types';
import { getProductsPaginated, getOpenDailyArchive, processReturn, getCustomersPaginated } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import { useDebounce } from '../hooks/useDebounce';
import { toast } from 'react-hot-toast';
import { orderBy, where, collection, getDocs, query } from 'firebase/firestore';
import type { QueryDocumentSnapshot, QueryConstraint } from 'firebase/firestore';
import { getDB } from '../services/firebase';
import { useConfirmation } from '../components/ConfirmationProvider';
import { useReturnCartStore } from '../stores/returnCartStore';
import { ProductSearch } from '../components/ProductSearch';


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
    originalInvoiceId: string | null;
}> = ({ dailyArchive, categories, originalInvoiceId }) => {
    const { confirm } = useConfirmation();
    const { returnCart, total, isCartModalOpen, setCartModalOpen, clearCart, updateItem, removeItem, setItemPriceType, pricingMethod, setPricingMethod } = useReturnCartStore();
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
            await processReturn(returnCart, dailyArchive.id, selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : undefined, originalInvoiceId || undefined);
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
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">سلة المرتجعات</h2>
                        {originalInvoiceId && <p className="text-xs text-primary-600 dark:text-primary-300 flex items-center gap-1 mt-1"><Link2 size={12}/> مرتبط بفاتورة: {originalInvoiceId.slice(-6)}</p>}
                    </div>
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
                            <div key={item.id} className="py-3 border-b dark:border-gray-700 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex-1 pr-2">
                                        <p className="font-bold text-lg line-clamp-2 text-gray-900 dark:text-gray-100">{item.name}</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">{getCategoryName(item.categoryId)}</p>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 p-2 disabled:opacity-50"
                                        disabled={isProcessing}
                                        aria-label={`حذف ${item.name}`}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="inline-flex rounded-full bg-gray-100 dark:bg-gray-700 p-0.5 text-xs font-semibold">
                                        <button
                                            onClick={() => setItemPriceType(item.id, 'retail')}
                                            disabled={isProcessing}
                                            aria-pressed={item.priceType === 'retail'}
                                            className={`px-2.5 py-0.5 rounded-full transition-colors ${item.priceType === 'retail' ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                                        >
                                            قطاعي
                                        </button>
                                        <button
                                            onClick={() => setItemPriceType(item.id, 'wholesale')}
                                            disabled={isProcessing}
                                            aria-pressed={item.priceType === 'wholesale'}
                                            className={`px-2.5 py-0.5 rounded-full transition-colors ${item.priceType === 'wholesale' ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                                        >
                                            جملة
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => updateItem(item.id, Math.max(1, item.buyQuantity - 1))}
                                            disabled={item.buyQuantity <= 1 || isProcessing}
                                            aria-label={`تقليل كمية ${item.name}`}
                                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            −
                                        </button>
                                        <label htmlFor={`retQty-${item.id}`} className="sr-only">الكمية</label>
                                        <input
                                            id={`retQty-${item.id}`}
                                            name={`retQty-${item.id}`}
                                            type="number"
                                            value={item.buyQuantity}
                                            onChange={(e) => updateItem(item.id, parseInt(e.target.value) || 1)}
                                            className="w-16 p-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center"
                                            min="1"
                                            max={item.quantity}
                                            autoComplete="off"
                                            disabled={isProcessing}
                                        />
                                        <button
                                            onClick={() => updateItem(item.id, Math.min(item.quantity, item.buyQuantity + 1))}
                                            disabled={item.buyQuantity >= item.quantity || isProcessing}
                                            aria-label={`زيادة كمية ${item.name}`}
                                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label htmlFor={`retPrice-${item.id}`} className="text-xs">السعر:</label>
                                        <input
                                            id={`retPrice-${item.id}`}
                                            name={`retPrice-${item.id}`}
                                            type="number"
                                            value={item.price}
                                            onChange={(e) => updateItem(item.id, item.buyQuantity, parseFloat(e.target.value) || 0)}
                                            className="w-20 p-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center"
                                            step="0.01"
                                            min="0"
                                            autoComplete="off"
                                            disabled={isProcessing}
                                        />
                                    </div>
                                    <p className="w-24 text-left font-bold text-sm">{(item.price * item.buyQuantity).toFixed(2)} ج.م</p>
                                </div>
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
                    {/* Explicit pricing basis — cashier decides Cash/Credit; never inferred from the linked customer (REQ-M13-FIX) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">أساس التسعير</label>
                        <div className="inline-flex rounded-full bg-gray-100 dark:bg-gray-700 p-0.5 text-sm font-semibold">
                            <button
                                onClick={() => setPricingMethod(PaymentMethod.Cash)}
                                disabled={isProcessing}
                                aria-pressed={pricingMethod === PaymentMethod.Cash}
                                className={`px-3 py-1 rounded-full transition-colors ${pricingMethod === PaymentMethod.Cash ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                            >
                                نقدي
                            </button>
                            <button
                                onClick={() => setPricingMethod(PaymentMethod.Credit)}
                                disabled={isProcessing}
                                aria-pressed={pricingMethod === PaymentMethod.Credit}
                                className={`px-3 py-1 rounded-full transition-colors ${pricingMethod === PaymentMethod.Credit ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                            >
                                آجل
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold">إجمالي المرتجع</span>
                        <span className="text-2xl font-bold text-red-700 dark:text-red-300">{total.toFixed(2)} ج.م</span>
                    </div>
                    <button
                        data-testid="return-confirm"
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
    const { returnCart, total, addToReturnCart, setCartModalOpen, clearCart } = useReturnCartStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [dailyArchive, setDailyArchive] = useState<DailyArchive | null>(null);
    const [isArchiveLoading, setIsArchiveLoading] = useState(true);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');

    // REQ-P0-1: ربط المرتجع بفاتورة — اختيار العميل والفاتورة
    const [invoiceCustomer, setInvoiceCustomer] = useState<Customer | null>(null);
    const [invoiceCustomerSearch, setInvoiceCustomerSearch] = useState('');
    const [invoiceCustomerResults, setInvoiceCustomerResults] = useState<Customer[]>([]);
    const [isSearchingInvoiceCustomers, setIsSearchingInvoiceCustomers] = useState(false);
    const [invoicesForCustomer, setInvoicesForCustomer] = useState<Invoice[]>([]);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
    const [remainingMap, setRemainingMap] = useState<Map<string, number>>(new Map());
    const debouncedInvoiceCustomerSearch = useDebounce(invoiceCustomerSearch, 300);

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

    // REQ-P0-1: بحث عملاء لقسم ربط الفاتورة
    useEffect(() => {
        if (invoiceCustomer || !debouncedInvoiceCustomerSearch.trim()) {
            setInvoiceCustomerResults([]);
            return;
        }
        setIsSearchingInvoiceCustomers(true);
        getCustomersPaginated(debouncedInvoiceCustomerSearch, null).then(({ customers }) => {
            setInvoiceCustomerResults(customers.slice(0, 8));
            setIsSearchingInvoiceCustomers(false);
        });
    }, [debouncedInvoiceCustomerSearch, invoiceCustomer]);

    // REQ-P0-1: تحميل فواتير العميل المختار
    useEffect(() => {
        if (!invoiceCustomer) {
            setInvoicesForCustomer([]);
            setSelectedInvoice(null);
            return;
        }
        setIsLoadingInvoices(true);
        const db = getDB();
        const q = query(collection(db, 'invoices'), where('customerId', '==', invoiceCustomer.id), orderBy('createdAt', 'desc'));
        getDocs(q).then(snap => {
            const invs = snap.docs.map(d => {
                const data = d.data() as any;
                return { id: d.id, ...data, createdAt: data.createdAt instanceof Object && 'toMillis' in data.createdAt ? (data.createdAt as any).toMillis() : data.createdAt } as Invoice;
            });
            setInvoicesForCustomer(invs);
            setIsLoadingInvoices(false);
        }).catch(() => setIsLoadingInvoices(false));
    }, [invoiceCustomer]);

    // REQ-P0-1: حساب الكمية المتبقية لكل صنف في الفاتورة المختارة (بعد خصم مرتجعات سابقة)
    useEffect(() => {
        if (!selectedInvoice) {
            setRemainingMap(new Map());
            return;
        }
        const db = getDB();
        const q = query(collection(db, 'returns'), where('originalInvoiceId', '==', selectedInvoice.id));
        getDocs(q).then(snap => {
            const map = new Map<string, number>();
            snap.docs.forEach(d => {
                const r = d.data() as Return;
                (r.items || []).forEach(it => {
                    map.set(it.id, (map.get(it.id) || 0) + (it.buyQuantity || 0));
                });
            });
            const remaining = new Map<string, number>();
            (selectedInvoice.items || []).forEach(it => {
                const already = map.get(it.id) || 0;
                remaining.set(it.id, Math.max(0, (it.buyQuantity || 0) - already));
            });
            setRemainingMap(remaining);
        });
    }, [selectedInvoice]);

    // REQ-P0-1: عند اختيار/إلغاء فاتورة — أفرغ السلة إذا كانت تحتوي أصناف غير موجودة في الفاتورة الجديدة
    useEffect(() => {
        if (selectedInvoice && returnCart.length > 0) {
            const hasForeign = returnCart.some(ci => !selectedInvoice.items.some(ii => ii.id === ci.id));
            if (hasForeign) {
                clearCart();
                toast('تم إفراغ السلة لربطها بالفاتورة الجديدة', { icon: 'ℹ️' });
            }
        }
    }, [selectedInvoice]);

    const handleAddToReturnCart = useCallback((product: Product) => {
        // REQ-P0-1: إذا كانت السلة مرتبطة بفاتورة، لا تسمح بإضافة صنف غير موجود في الفاتورة أو بكمية تتجاوز المتبقي
        if (selectedInvoice) {
            const invItem = selectedInvoice.items.find(i => i.id === product.id);
            if (!invItem) {
                toast.error('هذا الصنف غير موجود في الفاتورة المختارة');
                return;
            }
            const remaining = remainingMap.get(product.id) ?? invItem.buyQuantity;
            if (remaining <= 0) {
                toast.error('لا توجد كمية متبقية لهذا الصنف في الفاتورة');
                return;
            }
            const existing = returnCart.find(i => i.id === product.id);
            const cartQty = existing ? existing.buyQuantity : 0;
            if (cartQty + 1 > remaining) {
                toast.error(`الكمية المتبقية لهذا الصنف في الفاتورة هي ${remaining} فقط`);
                return;
            }
        }
        addToReturnCart(product);
    }, [addToReturnCart, selectedInvoice, remainingMap, returnCart]);

    // فلترة فواتير حسب بحث رقم الفاتورة/التاريخ — قبل أي early return لضمان ترتيب Hooks ثابت (يمنع React #310)
    const filteredInvoices = useMemo(() => {
        if (!invoiceSearch.trim()) return invoicesForCustomer;
        const q = invoiceSearch.trim().toLowerCase();
        return invoicesForCustomer.filter(inv =>
            (inv.invoiceNumber || '').toLowerCase().includes(q) ||
            new Date(inv.createdAt).toLocaleDateString('ar-EG').includes(q)
        );
    }, [invoicesForCustomer, invoiceSearch]);

    const isInvoiceFullyReturned = useMemo(() => {
        if (!selectedInvoice) return false;
        return Array.from(remainingMap.values()).every(v => v <= 0);
    }, [selectedInvoice, remainingMap]);

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
            {/* REQ-P0-1: قسم ربط المرتجع بفاتورة أصلية — اختياري، للتوافق مع البيانات القديمة */}
            <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                    <Link2 size={16} className="text-primary-600" />
                    <span>ربط بفاتورة أصلية (اختياري)</span>
                    {selectedInvoice && <span className="text-xs font-normal text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full border border-green-200">{selectedInvoice.invoiceNumber}</span>}
                </div>
                {invoiceCustomer ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-3 py-2">
                            <div>
                                <p className="font-bold text-sm text-gray-900 dark:text-gray-100">{invoiceCustomer.name}</p>
                                <p className="text-xs text-gray-600 dark:text-gray-300">{invoiceCustomer.phone || ''}</p>
                            </div>
                            <button onClick={() => { setInvoiceCustomer(null); setInvoiceCustomerSearch(''); setSelectedInvoice(null); }} className="text-gray-500 hover:text-red-600 p-1" aria-label="إلغاء اختيار العميل"><X size={16}/></button>
                        </div>
                        {isLoadingInvoices ? (
                            <p className="text-xs text-gray-500">جاري تحميل الفواتير...</p>
                        ) : invoicesForCustomer.length === 0 ? (
                            <p className="text-xs text-gray-500">لا توجد فواتير لهذا العميل</p>
                        ) : (
                            <div className="space-y-2">
                                <div className="relative">
                                    <input type="text" placeholder="بحث برقم الفاتورة أو التاريخ..." value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 dark:placeholder-gray-500" />
                                    <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y dark:divide-gray-700">
                                    {filteredInvoices.map(inv => {
                                        const isSelected = selectedInvoice?.id === inv.id;
                                        return (
                                            <button key={inv.id} onClick={() => setSelectedInvoice(inv)} className={`w-full text-right p-2 flex justify-between items-center text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30 border-r-4 border-primary-600' : ''}`}>
                                                <span className="font-mono font-bold">{inv.invoiceNumber}</span>
                                                <span className="text-xs">{new Date(inv.createdAt).toLocaleDateString('ar-EG')} — {inv.total.toFixed(2)} ج.م — {inv.paymentMethod}</span>
                                            </button>
                                        );
                                    })}
                                    {filteredInvoices.length === 0 && <p className="p-2 text-xs text-gray-500">لا نتائج</p>}
                                </div>
                                {selectedInvoice && isInvoiceFullyReturned && (
                                    <p className="text-xs text-red-600 dark:text-red-300">هذه الفاتورة لا يوجد لها كمية متبقية للإرجاع (كل الكمية أُرجعت سابقًا)</p>
                                )}
                                {selectedInvoice && (
                                    <button onClick={() => setSelectedInvoice(null)} className="text-xs text-gray-600 dark:text-gray-300 underline">إلغاء ربط الفاتورة (العودة للكتالوج)</button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="ابحث عن عميل لعرض فواتيره..."
                            value={invoiceCustomerSearch}
                            onChange={e => setInvoiceCustomerSearch(e.target.value)}
                            className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm text-base focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                        />
                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
                        {invoiceCustomerResults.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                                {invoiceCustomerResults.map(c => (
                                    <button key={c.id} onClick={() => { setInvoiceCustomer(c); setInvoiceCustomerSearch(''); setInvoiceCustomerResults([]); }} className="w-full text-right px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex justify-between">
                                        <span className="font-medium">{c.name}</span><span className="text-xs text-gray-500">{c.phone || ''}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {isSearchingInvoiceCustomers && <p className="text-xs text-gray-500 mt-1">جاري البحث...</p>}
                        <p className="text-xs text-gray-500 mt-1">إن لم تختر فاتورة، يمكنك الإرجاع مباشرة من الكتالوج (للتوافق مع البيانات القديمة)</p>
                    </div>
                )}
            </div>

            {selectedInvoice ? (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
                        <FileText size={16} />
                        <span>أصناف الفاتورة {selectedInvoice.invoiceNumber} — اضغط لإضافة للمرتجع</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {(selectedInvoice.items || []).map(item => {
                            const remaining = remainingMap.get(item.id) ?? (item.buyQuantity || 0);
                            const categoryName = categories.find(c => c.id === item.categoryId)?.name || 'غير مصنف';
                            const cartQty = returnCart.find(ci => ci.id === item.id)?.buyQuantity || 0;
                            const disabled = remaining <= 0;
                            return (
                                <div key={item.id} onClick={() => !disabled && handleAddToReturnCart(item as unknown as Product)} className={`group bg-white dark:bg-gray-800 rounded-xl border p-3 flex flex-col ${disabled ? 'opacity-40 cursor-not-allowed border-gray-200' : 'cursor-pointer hover:border-primary-400 hover:shadow-md border-gray-200 dark:border-gray-700'}`}>
                                    <span className="text-xs font-bold bg-primary-600 text-white px-2 py-0.5 rounded self-start">{categoryName}</span>
                                    <p className="font-bold mt-2 line-clamp-2 text-sm">{item.name}</p>
                                    <p className="text-xs text-gray-500 mt-1">الكمية في الفاتورة: {item.buyQuantity} — المتبقي: <span className={remaining===0 ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>{remaining}</span>{cartQty>0 && ` — في السلة: ${cartQty}`}</p>
                                    <p className="text-xs text-gray-500">السعر: {item.price.toFixed(2)} ج.م</p>
                                    {disabled && <p className="text-xs text-red-600 mt-1">مكتمل الإرجاع</p>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <>
                    <ProductSearch
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        selectedCategory={selectedCategory}
                        onCategoryChange={setSelectedCategory}
                        categories={categories}
                    />

                    <ProductGrid
                        products={products}
                        categories={categories}
                        onAddToReturnCart={handleAddToReturnCart}
                        lastProductElementRef={lastProductElementRef}
                        isLoadingMore={isLoadingMore}
                        hasMore={hasMore}
                        isLoading={isLoading}
                    />
                </>
            )}

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

            <ReturnCartModal dailyArchive={dailyArchive} categories={categories} originalInvoiceId={selectedInvoice ? selectedInvoice.id : null} />
        </div>
    );
}
