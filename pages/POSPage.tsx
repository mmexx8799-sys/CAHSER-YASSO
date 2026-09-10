
import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CreditCard, Trash2, ShoppingCart, AlertCircle, Settings } from 'lucide-react';
import type { Product, CartItem, Customer, DailyArchive, Category } from '../types';
import { PaymentMethod } from '../types';
import { getProductsPaginated, processSale, getOpenDailyArchive } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import { useDebounce } from '../hooks/useDebounce';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import { usePosCartStore } from '../stores/posCartStore';
import { FloatingCartButton } from '../components/FloatingCartButton';
import { ProductSearch } from '../components/ProductSearch';
import { orderBy, where } from 'firebase/firestore';
import type { QueryDocumentSnapshot, QueryConstraint } from 'firebase/firestore';

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
            <AlertCircle size={64} className="text-orange-400 mb-4" />
            <h2 className="text-3xl font-bold mb-2 text-gray-900 dark:text-gray-100">{messages[type].title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-8 text-lg">{messages[type].body}</p>
            <button
                onClick={() => navigate('/settings')}
                className="flex items-center space-x-2 bg-primary-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-primary-700 text-lg font-semibold"
            >
                <Settings size={20} />
                <span>الانتقال إلى الإعدادات</span>
            </button>
        </div>
    );
};


const ProductCard: React.FC<{ product: Product; categoryName: string; onAddToCart: (product: Product) => void }> = ({ product, categoryName, onAddToCart }) => (
    <div
        className={`group bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-3 flex flex-col justify-between cursor-pointer transition-all duration-300 hover:shadow-md hover:border-primary-400 dark:hover:border-primary-500 hover:-translate-y-1 h-full ${product.quantity === 0 ? 'opacity-60 grayscale' : ''}`}
        onClick={() => product.quantity > 0 && onAddToCart(product)}
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
    onAddToCart,
    lastProductElementRef,
    isLoadingMore,
    hasMore,
    isLoading
}: {
    products: Product[],
    categories: Category[],
    onAddToCart: (p: Product) => void,
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
                    const card = <MemoizedProductCard product={product} onAddToCart={onAddToCart} categoryName={categoryName} />;
                    if (products.length === index + 1) {
                        return <div ref={lastProductElementRef} key={product.id} className="h-full">{card}</div>
                    } else {
                        return <div key={product.id} className="h-full">{card}</div>;
                    }
                })}
            </div>
            {isLoadingMore && <div className="text-center p-4 font-semibold">جاري تحميل المزيد...</div>}
            {!hasMore && products.length > 0 && <div className="text-center p-4 text-gray-700 dark:text-gray-300 font-semibold">لا يوجد المزيد من المنتجات.</div>}
            {!isLoading && products.length === 0 && <div className="text-center p-16 text-gray-700 dark:text-gray-300"><p className="text-xl">لم يتم العثور على منتجات.</p></div>}
        </>
    );
});


const CartModal: React.FC<{
    customers: Customer[];
    dailyArchive: DailyArchive | null;
    categories: Category[];
    onSaleComplete: () => void;
}> = ({ customers, dailyArchive, categories, onSaleComplete }) => {
    const { confirm } = useConfirmation();
    const { cart, subtotal, isCartModalOpen, setCartModalOpen, clearCart, updateItem, removeItem, setItemPriceType, recalcCartPrices } = usePosCartStore();
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    const getCategoryName = useCallback((categoryId: string) => {
        return categories.find(c => c.id === categoryId)?.name || 'غير مصنف';
    }, [categories]);

    const handleClearCart = async () => {
        const confirmed = await confirm({
            title: "تأكيد إفراغ السلة",
            message: "هل أنت متأكد من رغبتك في إفراغ السلة؟"
        });
        if (confirmed) {
            clearCart();
            toast.success('تم إفراغ السلة بنجاح!');
        }
    }

    const handleProcessSale = async (paymentMethod: PaymentMethod, customerId: string | undefined, subtotal: number, discount: number, total: number) => {
        if (!dailyArchive) {
            toast.error("لا يمكن إتمام البيع، لم يتم فتح اليومية.");
            return;
        }
        setIsPaymentModalOpen(false);
        try {
            await processSale({
                items: cart,
                subtotal,
                discount,
                total,
                paymentMethod,
                customerId,
                dailyArchiveId: dailyArchive.id
            });
            clearCart();
            onSaleComplete();
        } catch (error) {
            toast.error("حدث خطأ أثناء إتمام البيع.");
            console.error(error);
        }
    }

    // Invoice-wide payment method: on change, re-resolve every affected item's price.
    const handlePaymentMethodChange = (paymentMethod: PaymentMethod) => {
        recalcCartPrices(paymentMethod);
    }

    if (!isCartModalOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-end z-50">
                <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-4 w-full max-w-2xl h-[85vh] flex flex-col transition-colors duration-200">
                    <div className="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-3">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">السلة</h2>
                        <div className='flex items-center gap-4'>
                            <button onClick={handleClearCart} aria-label="إفراغ السلة" className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex items-center gap-1 text-base font-semibold">
                                <Trash2 size={18} />
                                إفراغ السلة
                            </button>
                            <button onClick={() => setCartModalOpen(false)} aria-label="إغلاق السلة" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"><X size={24} /></button>
                        </div>
                    </div>
                    {cart.length === 0 ? (
                        <div className="flex-1 flex flex-col justify-center items-center text-gray-600 dark:text-gray-300">
                            <ShoppingCart size={64} className="mb-4" />
                            <p className="text-xl">السلة فارغة</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto -mx-4 px-4">
                            {cart.map(item => (
                                <div key={item.id} className="grid grid-cols-6 items-center py-4 border-b dark:border-gray-700 gap-2">
                                    <div className="col-span-2 pr-2">
                                        <p className="font-bold text-lg line-clamp-2 text-gray-900 dark:text-gray-100">{item.name}</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">{getCategoryName(item.categoryId)}</p>
                                        <div className="mt-1 inline-flex rounded-full bg-gray-100 dark:bg-gray-700 p-0.5 text-xs font-semibold">
                                            <button
                                                onClick={() => setItemPriceType(item.id, 'retail', PaymentMethod.Cash)}
                                                aria-pressed={item.priceType === 'retail'}
                                                className={`px-2.5 py-0.5 rounded-full transition-colors ${item.priceType === 'retail' ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                                            >
                                                قطاعي
                                            </button>
                                            <button
                                                onClick={() => setItemPriceType(item.id, 'wholesale', PaymentMethod.Cash)}
                                                aria-pressed={item.priceType === 'wholesale'}
                                                className={`px-2.5 py-0.5 rounded-full transition-colors ${item.priceType === 'wholesale' ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                                            >
                                                جملة
                                            </button>
                                        </div>
                                    </div>
                                    <div className="col-span-1 flex items-center justify-center gap-1">
                                        <button
                                            onClick={() => updateItem(item.id, Math.max(1, item.buyQuantity - 1), item.price)}
                                            disabled={item.buyQuantity <= 1}
                                            aria-label={`تقليل كمية ${item.name}`}
                                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            −
                                        </button>
                                        <label htmlFor={`qty-${item.id}`} className="sr-only">الكمية</label>
                                        <input
                                            id={`qty-${item.id}`}
                                            name={`qty-${item.id}`}
                                            type="number"
                                            value={item.buyQuantity}
                                            onChange={(e) => updateItem(item.id, parseInt(e.target.value) || 1, item.price)}
                                            autoComplete="off"
                                            className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-base"
                                            min="1"
                                            max={item.quantity}
                                        />
                                        <button
                                            onClick={() => updateItem(item.id, Math.min(item.quantity, item.buyQuantity + 1), item.price)}
                                            disabled={item.buyQuantity >= item.quantity}
                                            aria-label={`زيادة كمية ${item.name}`}
                                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <div className="col-span-1 flex items-center">
                                        <label htmlFor={`price-${item.id}`} className="sr-only">السعر</label>
                                        <input
                                            id={`price-${item.id}`}
                                            name={`price-${item.id}`}
                                            type="number"
                                            value={item.price}
                                            onChange={(e) => updateItem(item.id, item.buyQuantity, parseFloat(e.target.value) || 0)}
                                            autoComplete="off"
                                            className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-base"
                                            step="0.01"
                                        />
                                    </div>
                                    <p className="col-span-1 text-center font-bold text-base text-gray-900 dark:text-gray-100">{(item.price * item.buyQuantity).toFixed(2)}</p>
                                    <button onClick={() => removeItem(item.id)} aria-label={`حذف ${item.name}`} className="col-span-1 text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 justify-self-end p-2">
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t dark:border-gray-700 mt-auto -mx-4">
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-xl font-semibold text-gray-900 dark:text-gray-100">الإجمالي</span>
                            <span className="text-3xl font-bold text-primary-600 dark:text-primary-300">{subtotal.toFixed(2)} ج.م</span>
                        </div>
                        <button
                            onClick={() => setIsPaymentModalOpen(true)}
                            disabled={cart.length === 0}
                            className="w-full py-3 px-4 bg-primary-600 text-white rounded-lg font-bold text-xl shadow-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            دفع
                        </button>
                    </div>
                </div>
            </div>
            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                subtotal={subtotal}
                customers={customers}
                onSubmit={handleProcessSale}
                onPaymentMethodChange={handlePaymentMethodChange}
            />
        </>
    )
}

const PaymentModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    subtotal: number;
    customers: Customer[];
    onSubmit: (paymentMethod: PaymentMethod, customerId: string | undefined, subtotal: number, discount: number, total: number) => void;
    onPaymentMethodChange?: (paymentMethod: PaymentMethod) => void;
}> = ({ isOpen, onClose, subtotal, customers, onSubmit, onPaymentMethodChange }) => {
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.Cash);
    const [selectedCustomer, setSelectedCustomer] = useState<string>('');
    const [discount, setDiscount] = useState(0);

    const total = useMemo(() => subtotal - discount, [subtotal, discount]);

    useEffect(() => {
        if (isOpen) {
            setDiscount(0);
            setSelectedCustomer('');
            setPaymentMethod(PaymentMethod.Cash);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (paymentMethod === PaymentMethod.Credit && !selectedCustomer) {
            toast.error("يرجى اختيار عميل للبيع الآجل");
            return;
        }
        if (discount > subtotal) {
            toast.error("الخصم لا يمكن أن يكون أكبر من الإجمالي");
            return;
        }
        onSubmit(paymentMethod, selectedCustomer, subtotal, discount, total);
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm transition-colors duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">إتمام البيع</h2>
                    <button onClick={onClose} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"><X size={24} /></button>
                </div>
                <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-lg text-gray-600 dark:text-gray-300">
                        <span>الإجمالي الفرعي</span>
                        <span>{subtotal.toFixed(2)} ج.م</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <label htmlFor="discount" className="text-lg text-gray-600 dark:text-gray-300">خصم</label>
                            <input
                            id="discount"
                            name="discount"
                            type="number"
                            value={discount}
                            onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                            autoComplete="off"
                            className="w-2/5 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-left direction-ltr text-lg"
                        />
                    </div>
                    <div className="flex justify-between text-3xl font-extrabold text-primary-600 dark:text-primary-300 border-t dark:border-gray-700 pt-3 mt-3">
                        <span>المبلغ النهائي</span>
                        <span>{total.toFixed(2)}</span>
                    </div>
                </div>
                <div className="space-y-4">
                    <label htmlFor="paymentMethod" className="block text-base font-medium text-gray-700 dark:text-gray-300">طريقة الدفع</label>
                    <select
                        id="paymentMethod"
                        name="paymentMethod"
                        value={paymentMethod}
                        onChange={(e) => {
                            const next = e.target.value as PaymentMethod;
                            setPaymentMethod(next);
                            onPaymentMethodChange?.(next);
                        }}
                        className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
                    >
                        {Object.values(PaymentMethod).map(method => <option key={method} value={method}>{method}</option>)}
                    </select>

                    {paymentMethod === PaymentMethod.Credit && (
                        <div>
                            <label htmlFor="selectedCustomer" className="block text-base font-medium text-gray-700 dark:text-gray-300">اختيار العميل</label>
                            <select
                                id="selectedCustomer"
                                name="selectedCustomer"
                                value={selectedCustomer}
                                onChange={(e) => setSelectedCustomer(e.target.value)}
                                className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
                            >
                                <option value="">-- اختر عميل --</option>
                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    )}
                </div>
                <div className="mt-8 flex space-x-2 space-x-reverse">
                    <button onClick={onClose} className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold text-lg">
                        إلغاء
                    </button>
                    <button onClick={handleSubmit} className="flex-1 py-3 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center justify-center space-x-2 font-semibold text-lg">
                        <CreditCard size={20} />
                        <span>تأكيد الدفع</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const { addToCart, setCartModalOpen } = usePosCartStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [dailyArchive, setDailyArchive] = useState<DailyArchive | null>(null);
    const [isArchiveLoading, setIsArchiveLoading] = useState(true);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');

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
            setProducts([]);
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
            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
            return unique;
        });
        setLastDoc(newLastDoc);

        setIsLoading(false);
        setIsLoadingMore(false);
    };

    const loadMoreProducts = () => {
        if (!isLoadingMore && hasMore) {
            loadProducts(false);
        }
    };

    useEffect(() => {
        const resetAndLoad = () => {
            if (dailyArchive) {
                loadProducts(true);
            }
        };
        resetAndLoad();
    }, [debouncedSearchQuery, selectedCategory, dailyArchive]);

    useEffect(() => {
        const customerConstraints: QueryConstraint[] = [orderBy('name')];
        const unsubscribeCustomers = subscribeToCollection<Customer>('customers', setCustomers, customerConstraints);

        const categoriesConstraints: QueryConstraint[] = [orderBy('name')];
        const unsubscribeCategories = subscribeToCollection<Category>('categories', setCategories, categoriesConstraints);

        setIsArchiveLoading(true);
        getOpenDailyArchive()
            .then(archive => {
                setDailyArchive(archive);
                if (!archive) {
                    setIsLoading(false);
                }
            })
            .catch(err => {
                toast.error('فشل في تحميل اليومية: ' + err.message);
                setIsLoading(false);
            })
            .finally(() => setIsArchiveLoading(false));

        return () => {
            unsubscribeCustomers();
            unsubscribeCategories();
        };
    }, []);

    const handleAddToCart = useCallback((product: Product) => {
        addToCart(product);
    }, [addToCart]);

    if (isArchiveLoading) {
        return (
            <div className="flex justify-center items-center h-full relative">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!dailyArchive) {
        return <div className="relative h-full"><ArchiveGuard type="sale" /></div>;
    }

    return (
        <div className="p-4 pb-24">
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
                onAddToCart={handleAddToCart}
                lastProductElementRef={lastProductElementRef}
                isLoadingMore={isLoadingMore}
                hasMore={hasMore}
                isLoading={isLoading}
            />

            <FloatingCartButton />

            <CartModal
                customers={customers}
                dailyArchive={dailyArchive}
                categories={categories}
                onSaleComplete={() => loadProducts(true)}
            />
        </div>
    );
}
