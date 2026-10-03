
import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CreditCard, Trash2, ShoppingCart, AlertCircle, Settings, Loader2, ScanBarcode, Camera } from 'lucide-react';
import type { Product, Customer, DailyArchive, Category } from '../types';
import { PaymentMethod } from '../types';
import { getProductsPaginated, processSale, getOpenDailyArchive, getProductByBarcodeCloud, isOfflineGuardError } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import { useDebounce } from '../hooks/useDebounce';
import { findProductByBarcode, buildBarcodeIndex } from '../utils/findProductByBarcode';
import { resolveBarcodeScan, withCloudTimeout } from '../utils/barcodeResolution';
import { BarcodeCameraModal } from '../components/BarcodeCameraModal';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import { usePosCartStore } from '../stores/posCartStore';
import { opKeyStore, settleLabels, FLOW_META } from '../utils/opKeyStore';
import type { DecideInfo, DecideChoice } from '../utils/opKeyStore';
import { firebaseRecordDoc } from '../utils/opKeyRecordDoc';
import { docFingerprint } from '../services/api/opKey';
import { OpKeySettleDialog } from '../components/OpKeySettleDialog';
import type { SettleDialogChoice } from '../components/OpKeySettleDialog';
import { usePermissions } from '../hooks/usePermissions';
import { FloatingCartButton } from '../components/FloatingCartButton';
import { ProductSearch } from '../components/ProductSearch';
import { orderBy } from 'firebase/firestore';
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
        <div className="flex w-full items-start sm:items-center justify-center px-4 py-8 sm:p-6 min-h-[calc(100dvh-14rem)] lg:min-h-[calc(100dvh-10rem)]">
            <section
                aria-labelledby="archive-guard-title"
                className="w-full max-w-md rounded-3xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-8 sm:p-8 shadow-xl text-center"
            >
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-900/30 ring-1 ring-orange-100 dark:ring-orange-800">
                    <AlertCircle size={32} className="text-orange-500 dark:text-orange-300" aria-hidden="true" />
                </div>
                <h2 id="archive-guard-title" className="text-2xl sm:text-[1.7rem] font-extrabold leading-9 text-gray-900 dark:text-gray-100 text-balance">
                    {messages[type].title}
                </h2>
                <p className="mt-3 text-sm sm:text-base leading-7 text-gray-600 dark:text-gray-300 text-pretty">
                    {messages[type].body}
                </p>
                <button
                    onClick={() => navigate('/settings')}
                    className="mt-7 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                >
                    <Settings size={20} aria-hidden="true" />
                    <span>الانتقال إلى الإعدادات</span>
                </button>
            </section>
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
    const { can } = usePermissions();
    const canSell = can("sell");
    const { cart, subtotal, isCartModalOpen, setCartModalOpen, clearCart, updateItem, removeItem, setItemPriceType, recalcCartPrices } = usePosCartStore();
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    // REQ-UI-1-fix: re-entry guard checked FIRST line and set before any
    // await (setIsProcessing stays for display only). Both the original press
    // and the mismatch-notice resend go through runSale.
    const processingRef = useRef<boolean>(false);
    // REQ-UI-1: settle dialog state for the TX3-UI key flow (null = no dialog).
    const [settle, setSettle] = useState<null | {
        title: string; message: string; primaryLabel: string; secondaryLabel: string;
        resolve: (c: SettleDialogChoice) => void;
    }>(null);

    const getCategoryName = useCallback((categoryId: string) => {
        return categories.find(c => c.id === categoryId)?.name || 'غير مصنف';
    }, [categories]);

    const handleClearCart = async () => {
        if (isProcessing) return;
        const confirmed = await confirm({
            title: "تأكيد إفراغ السلة",
            message: "هل أنت متأكد من رغبتك في إفراغ السلة؟"
        });
        if (confirmed) {
            // clearCart() centrally drops the sale key memory (posCartStore).
            clearCart();
            toast.success('تم إفراغ السلة بنجاح!');
        }
    }

    // REQ-UI-1 (TX3-UI sale binding): settle-dialog driver for submitWithOpKey.
    // Maps the custom dialog's named buttons onto decide outcomes.
    const decideSale = (info: DecideInfo): Promise<DecideChoice> => {
        return new Promise<DecideChoice>((resolve) => {
            const labels = info.context === 'restored-same'
                ? settleLabels('sale', 'restored-same')
                : settleLabels('sale', 'changed');
            const recordedBit = info.recorded.number ? ` (برقم ${info.recorded.number})` : '';
            const message = info.context === 'restored-same'
                ? `سُجل بيع بنفس المحتوى مسبقًا${recordedBit}.`
                : `سُجل بيع بمحتوى مختلف مسبقًا${recordedBit}.`;
            setSettle({
                title: 'عملية مسجلة مسبقًا — بيع',
                message,
                primaryLabel: labels.primary,
                secondaryLabel: labels.secondary,
                resolve: (c: SettleDialogChoice) => {
                    setSettle(null);
                    if (c === 'secondary') resolve('proceed-new');
                    else if (c === 'primary') resolve(info.context === 'restored-same' ? 'finish' : 'abort');
                    else resolve('abort');
                },
            });
        });
    };

    const openSaleMismatchNotice = (resend: () => void) => {
        const labels = settleLabels('sale', 'mismatch');
        setSettle({
            title: FLOW_META.sale.mismatchTitle,
            message: FLOW_META.sale.mismatchBody,
            primaryLabel: labels.primary,
            secondaryLabel: labels.secondary,
            resolve: (c: SettleDialogChoice) => {
                setSettle(null);
                if (c === 'secondary') resend();
            },
        });
    };

    // REQ-UI-1-fix: unified sale runner. Called by the original press AND by
    // the mismatch-notice resend button (and any other path) — every send is
    // covered by the same guard + try/catch/finally.
    const runSale = async (paymentMethod: PaymentMethod, customerId: string | undefined, subtotal: number, discount: number, total: number) => {
        if (processingRef.current) return;
        if (!dailyArchive) {
            toast.error("لا يمكن إتمام البيع، لم يتم فتح اليومية.");
            return;
        }
        processingRef.current = true;
        setIsProcessing(true);
        try {
            // REQ-UI-1: identity built from the exact service-arg object
            // (customerId as sent — '' for cash — never normalized here).
            const invoiceData = {
                items: cart,
                subtotal,
                discount,
                total,
                paymentMethod,
                customerId,
                dailyArchiveId: dailyArchive.id
            };
            const identity = {
                fp: docFingerprint(invoiceData, 'customerId'),
                extra: { paymentMethod: paymentMethod as string },
            };
            const attempt = async (): Promise<void> => {
                const result = await opKeyStore.submitWithOpKey(
                    'sale',
                    identity,
                    (key) => processSale(invoiceData, { opKey: key }),
                    { decide: decideSale, getRecordDoc: firebaseRecordDoc },
                );
                if (result.outcome === 'sent' || result.outcome === 'finished-without-send') {
                    clearCart();
                    setIsPaymentModalOpen(false);
                    onSaleComplete();
                    if (result.outcome === 'finished-without-send') {
                        toast.success('تمت عملية البيع بنجاح!');
                    }
                    return;
                }
                if (result.outcome === 'mismatch') {
                    // Cart intentionally kept; the key was already cleared by
                    // the store so the next press mints fresh. Resend goes
                    // through runSale (guard + try/catch), never bare.
                    openSaleMismatchNotice(() => { void runSale(paymentMethod, customerId, subtotal, discount, total); });
                    return;
                }
                // aborted (user) or aborted (lookup-failed): nothing was sent.
                if (result.outcome === 'aborted' && result.reason === 'lookup-failed') {
                    toast.error('تعذر التحقق من العملية المسجلة — تحقق من الاتصال وحاول مجددًا.');
                }
            };
            await attempt();
        } catch (error) {
            if (isOfflineGuardError(error)) {
                toast.error((error as Error).message);
            } else {
                toast.error("حدث خطأ أثناء إتمام البيع.");
            }
            console.error(error);
        } finally {
            processingRef.current = false;
            setIsProcessing(false);
        }
    }

    // Invoice-wide payment method: on change, re-resolve every affected item's price.
    const handlePaymentMethodChange = (paymentMethod: PaymentMethod) => {
        recalcCartPrices(paymentMethod);
    }

    // REQ-UI-1: closing the payment step without success drops the
    // in-session key (the session record stays for the restored path).
    const closePaymentModal = () => {
        if (isProcessing) return;
        opKeyStore.forget('sale');
        setIsPaymentModalOpen(false);
    };

    if (!isCartModalOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-end z-50">
                <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-4 w-full max-w-2xl h-[85vh] flex flex-col transition-colors duration-200">
                    <div className="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-3">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">السلة</h2>
                        <div className='flex items-center gap-4'>
                            <button onClick={handleClearCart} disabled={isProcessing} aria-label="إفراغ السلة" className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex items-center gap-1 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                                <Trash2 size={18} />
                                إفراغ السلة
                            </button>
                            <button onClick={() => !isProcessing && setCartModalOpen(false)} disabled={isProcessing} aria-label="إغلاق السلة" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 disabled:opacity-50"><X size={24} /></button>
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
                                <div key={item.id} className="py-4 border-b dark:border-gray-700 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0 pr-2">
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
                                        <button onClick={() => removeItem(item.id)} aria-label={`حذف ${item.name}`} className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 p-2">
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-1">
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
                                                className="w-16 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-base"
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
                                        <div className="flex items-center gap-1">
                                            <label htmlFor={`price-${item.id}`} className="text-xs">السعر:</label>
                                            <input
                                                id={`price-${item.id}`}
                                                name={`price-${item.id}`}
                                                type="number"
                                                value={item.price}
                                                onChange={(e) => updateItem(item.id, item.buyQuantity, parseFloat(e.target.value) || 0)}
                                                autoComplete="off"
                                                className="w-20 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-base"
                                                step="0.01"
                                            />
                                        </div>
                                        <p className="w-24 text-left font-bold text-base text-gray-900 dark:text-gray-100">{(item.price * item.buyQuantity).toFixed(2)}</p>
                                    </div>
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
                            onClick={() => !isProcessing && setIsPaymentModalOpen(true)}
                            disabled={cart.length === 0 || isProcessing || !canSell}
                            title={!canSell ? 'ليس لديك صلاحية البيع' : undefined}
                            className="w-full py-3 px-4 bg-primary-600 text-white rounded-lg font-bold text-xl shadow-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            {isProcessing ? 'جارٍ التنفيذ...' : !canSell ? 'غير مصرح بالبيع' : 'دفع'}
                        </button>
                    </div>
                </div>
            </div>
            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={closePaymentModal}
                subtotal={subtotal}
                customers={customers}
                onSubmit={runSale}
                onPaymentMethodChange={handlePaymentMethodChange}
                isProcessing={isProcessing}
            />
            {settle && (
                <OpKeySettleDialog
                    title={settle.title}
                    message={settle.message}
                    primaryLabel={settle.primaryLabel}
                    secondaryLabel={settle.secondaryLabel}
                    onResolve={settle.resolve}
                />
            )}
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
    isProcessing?: boolean;
}> = ({ isOpen, onClose, subtotal, customers, onSubmit, onPaymentMethodChange, isProcessing = false }) => {
    const { can } = usePermissions();
    const canSell = can('sell');
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
                    <button onClick={() => !isProcessing && onClose()} disabled={isProcessing} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 disabled:opacity-50"><X size={24} /></button>
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
                    <button onClick={() => !isProcessing && onClose()} disabled={isProcessing} className="flex-1 py-3 px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed">
                        إلغاء
                    </button>
                    <button data-testid="pos-confirm-payment" onClick={handleSubmit} disabled={isProcessing || !canSell} title={!canSell ? 'ليس لديك صلاحية البيع' : undefined} className="flex-1 py-3 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center justify-center space-x-2 font-semibold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed">
                        {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <CreditCard size={20} />}
                        <span>{isProcessing ? 'جارٍ التنفيذ...' : 'تأكيد الدفع'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const { addToCart } = usePosCartStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [dailyArchive, setDailyArchive] = useState<DailyArchive | null>(null);
    const [isArchiveLoading, setIsArchiveLoading] = useState(true);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');

    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    // REQ-BARCODE: مسح بالكاميرا أو قارئ USB (نفس حقل الإدخال)
    const [barcodeInput, setBarcodeInput] = useState('');
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const barcodeInputRef = useRef<HTMLInputElement | null>(null);
    // REQ-A EC-1: مرآة الكاميرا لحظة اكتمال المسح (تُزامَن عبر useEffect)
    const isCameraOpenRef = useRef(false);
    useEffect(() => {
        isCameraOpenRef.current = isCameraOpen;
    }, [isCameraOpen]);

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
        // REQ-UI-1: drop expired TX3-UI key records on POS load (TTL sweep;
        // non-expired records stay for the restored path).
        opKeyStore.sweep();
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
            .catch((err: any) => {
                const code = String(err?.code || '');
                const msg = String(err?.message || '');
                if (code.includes('permission-denied') || msg.includes('permission') || msg.includes('insufficient')) {
                    setIsLoading(false);
                    return;
                }
                toast.error('فشل في تحميل اليومية: ' + err.message);
                setIsLoading(false);
            })
            .finally(() => setIsArchiveLoading(false));

        return () => {
            unsubscribeCustomers();
            unsubscribeCategories();
        };
    }, []);

    const handleAddToCart = useCallback((product: Product): boolean => {
        return addToCart(product);
    }, [addToCart]);

    // REQ-BARCODE: فهرس محلي من المنتجات المحمّلة أصلًا — بحث فوري بلا شبكة.
    const barcodeIndex = useMemo(() => buildBarcodeIndex(products), [products]);

    // REQ-BARCODE-FIX-1 AC-3: حارس إعادة الإرسال أثناء الاستعلام السحابي —
    // ref للمنع المتزامن (الـstate تتأخر دورة render) + state للتعطيل البصري.
    const [isResolvingBarcode, setIsResolvingBarcode] = useState(false);
    const isResolvingBarcodeRef = useRef(false);

    // REQ-A EC-1: انظر isCameraOpenRef (يُزامَن مع isCameraOpen أعلاه) — يُقرأ
    // بعد await فيُحسم الإغلاق اليدوي أثناء fallback معلّق، ويميز مسار
    // الكاميرا عن USB/اليدوي (الأخير كاميرته مغلقة أصلًا فلا auto-open).
    // REQ-BARCODE AC-03 + FIX-1 AC-2: مسار الباركود (يدوي/USB/كاميرا) يستدعي
    // نفس handleAddToCart المستخدمة للمسار اليدوي — لا مسار مزدوج للمنطق.
    // async بسبب الـfallback السحابي عند miss محلي (pagination gap).
    const handleBarcodeScan = useCallback(async (code: string) => {
        const normalized = (code ?? '').trim();
        if (!normalized) return;
        if (isResolvingBarcodeRef.current) return; // AC-3: منع استعلامات متوازية
        isResolvingBarcodeRef.current = true;
        setIsResolvingBarcode(true);
        try {
            const outcome = await resolveBarcodeScan(
                normalized,
                (c) => barcodeIndex.get(c) ?? findProductByBarcode(products, c),
                (c) => withCloudTimeout(getProductByBarcodeCloud(c)),
            );
            if (outcome.status === 'found') {
                // REQ-A AC-1/AC-3: إغلاق الكاميرا + فتح السلة فقط عند إضافة
                // فعلية (added===true). الرفض الداخلي (مخزون) أو إغلاق يدوي
                // أثناء الانتظار (EC-1) يُبقيان الكاميرا كما هي بلا فتح سلة.
                const added = handleAddToCart(outcome.product);
                if (added && isCameraOpenRef.current) {
                    setIsCameraOpen(false);
                    usePosCartStore.getState().setCartModalOpen(true);
                }
                return;
            }
            // AC-4: رسالة شبكة مميزة — لا نفس "غير موجود" المضلّلة
            if (outcome.status === 'cloud-error') {
                toast.error('تعذّر التحقق من الباركود — تحقق من الاتصال');
                return;
            }
            if (outcome.status === 'not-found') {
                toast.error('الباركود غير موجود بالمخزون');
                return;
            }
            if (outcome.reason === 'not-sellable') {
                toast.error(`المنتج "${outcome.product.name}" غير قابل للبيع`);
                return;
            }
            toast.error(`المنتج "${outcome.product.name}" نافد من المخزون`);
        } finally {
            isResolvingBarcodeRef.current = false;
            setIsResolvingBarcode(false);
        }
    }, [barcodeIndex, products, handleAddToCart]);

    const handleBarcodeSubmit = useCallback(() => {
        handleBarcodeScan(barcodeInput);
        setBarcodeInput('');
        // إبقاء التركيز للحفاظ على تدفق قارئ USB المتتالي
        barcodeInputRef.current?.focus();
    }, [barcodeInput, handleBarcodeScan]);

    if (isArchiveLoading) {
        return (
            <div className="flex justify-center items-center h-full relative">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!dailyArchive) {
        return <ArchiveGuard type="sale" />;
    }

    return (
        <div className="p-4 pb-24">
            {/* REQ-BARCODE: حقل مسح الباركود — قارئ USB يكتب هنا كنص + Enter
                (AC-07: بلا كاميرا)، وزر الكاميرا لنفس المسار */}
            <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                    <label htmlFor="pos-barcode" className="sr-only">مسح باركود المنتج</label>
                    <input
                        id="pos-barcode"
                        name="pos-barcode"
                        ref={barcodeInputRef}
                        type="text"
                        dir="ltr"
                        placeholder="امسح الباركود هنا…"
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleBarcodeSubmit();
                            }
                        }}
                        autoComplete="off"
                        disabled={isResolvingBarcode}
                        className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm text-lg text-left font-mono focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
                    />
                    <ScanBarcode className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={22} aria-hidden="true" />
                </div>
                <button
                    onClick={() => setIsCameraOpen(true)}
                    aria-label="مسح بالكاميرا"
                    title="مسح بالكاميرا"
                    disabled={isResolvingBarcode}
                    className="shrink-0 inline-flex items-center gap-2 py-3 px-4 bg-teal-600 text-white rounded-full shadow hover:bg-teal-700 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Camera size={20} aria-hidden="true" />
                    <span className="hidden sm:inline">مسح</span>
                </button>
            </div>

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

            <BarcodeCameraModal
                isOpen={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                onDetected={handleBarcodeScan}
            />
        </div>
    );
}
