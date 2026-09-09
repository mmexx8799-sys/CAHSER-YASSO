import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Phone } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { Customer, CustomerPayment, Invoice, Return } from '../types';
import { addCustomerPayment } from '../services/api';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { subscribeToCollection, subscribeToDocument } from '../services/dataCache';
import { where, orderBy, Timestamp } from 'firebase/firestore';

type TabId = 'overview' | 'payments' | 'invoices' | 'returns';

const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'payments', label: 'المدفوعات' },
    { id: 'invoices', label: 'الفواتير' },
    { id: 'returns', label: 'المرتجعات' },
];

export default function CustomerAccountPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // Customer document (live) — transferred verbatim from AddPaymentModal subscription #2 (C1-02)
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [liveBalance, setLiveBalance] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);

    // Records — transferred verbatim from AddPaymentModal subscriptions #1, #3, #4 (C1-02)
    const [payments, setPayments] = useState<CustomerPayment[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [returns, setReturns] = useState<Return[]>([]);

    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [amount, setAmount] = useState<number | string>('');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<Invoice | Return | null>(null);

    // handleSubmit — transferred verbatim from AddPaymentModal (api layer untouched)
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!customer) return;
        const numAmount = Number(amount);
        if (numAmount <= 0) {
            toast.error("المبلغ يجب أن يكون أكبر من صفر");
            return;
        }
        setIsSubmitting(true);
        try {
            await addCustomerPayment({ customerId: customer.id, amount: numAmount, notes });
            toast.success("تمت إضافة الدفعة بنجاح");
            setAmount('');
            setNotes('');
        } catch (error) {
            toast.error("فشلت إضافة الدفعة");
        } finally {
            setIsSubmitting(false);
        }
    }, [customer, amount, notes]);

    // --- Live customer document subscription (modal useEffect #2, verbatim) ---
    useEffect(() => {
        let unsubDoc: (() => void) | undefined;
        if (id) {
            unsubDoc = subscribeToDocument<Customer>('customers', id, (data) => {
                if (data) {
                    setCustomer(data);
                    setLiveBalance(data.balance || 0);
                } else {
                    setCustomer(null);
                }
                setIsLoading(false);
            });
        }
        return () => {
            if (unsubDoc) unsubDoc();
        };
    }, [id]);

    // --- Payments subscription (modal useEffect #1, verbatim) ---
    useEffect(() => {
        let unsubscribe: () => void;
        if (id) {
            const constraints = [where('customerId', '==', id)];
            unsubscribe = subscribeToCollection<Omit<CustomerPayment, 'date'> & { date: Timestamp }>('customerPayments', (paymentsData) => {
                const mappedPayments = paymentsData.map(p => ({
                    ...p,
                    date: p.date instanceof Timestamp ? p.date.toMillis() : (p.date || 0)
                })).sort((a, b) => b.date - a.date);
                setPayments(mappedPayments);
            }, constraints);
        }
        return () => {
            if (unsubscribe) unsubscribe();
            setPayments([]);
        };
    }, [id]);

    // --- Invoices + Returns subscriptions (modal useEffect #3, verbatim) ---
    useEffect(() => {
        let unsubInv: () => void; let unsubRet: () => void;
        if (id) {
            const invConstraints = [where('customerId', '==', id), orderBy('createdAt', 'desc')];
            unsubInv = subscribeToCollection<Omit<Invoice, 'createdAt'> & { createdAt: Timestamp }>('invoices', (data) => {
                const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as Invoice)).sort((a, b) => b.createdAt - a.createdAt);
                setInvoices(mapped);
            }, invConstraints);
            const retConstraints = [where('customerId', '==', id), orderBy('createdAt', 'desc')];
            unsubRet = subscribeToCollection<Omit<Return, 'createdAt'> & { createdAt: Timestamp }>('returns', (data) => {
                const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as Return)).sort((a, b) => b.createdAt - a.createdAt);
                setReturns(mapped);
            }, retConstraints);
        }
        return () => { if (unsubInv) unsubInv(); if (unsubRet) unsubRet(); setInvoices([]); setReturns([]); };
    }, [id]);

    const handleBack = useCallback(() => {
        navigate('/customers');
    }, [navigate]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-full pt-10">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!customer) {
        return (
            <div className="p-4 text-center pt-10">
                <p className="text-xl text-gray-700 dark:text-gray-300 mb-4">العميل غير موجود.</p>
                <button onClick={handleBack} className="py-2 px-4 bg-primary-600 text-white rounded-lg">العودة للعملاء</button>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-full pb-[calc(7rem+env(safe-area-inset-bottom))]">
            {/* Header (C1-01): name + phone + live balance */}
            <div className="px-4 pt-4 pb-3 bg-white dark:bg-gray-800 shadow-sm rounded-b-lg">
                <button
                    onClick={handleBack}
                    aria-label="العودة لصفحة العملاء"
                    className="mb-2 flex items-center gap-1 text-sm text-primary-700 dark:text-primary-300 hover:underline"
                >
                    <ArrowRight size={18} />
                    <span>العملاء</span>
                </button>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{customer.name}</h1>
                        {customer.phone && (
                            <p className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                                <Phone size={14} />
                                <span dir="ltr">{customer.phone}</span>
                            </p>
                        )}
                    </div>
                    <div className="text-left shrink-0">
                        <p className="text-xs text-gray-600 dark:text-gray-300">الرصيد الحالي</p>
                        <p className={`text-lg font-bold ${(liveBalance > 0) ? 'text-red-700 dark:text-red-300' : (liveBalance < 0) ? 'text-green-700 dark:text-green-300' : 'text-gray-900 dark:text-gray-100'}`}>
                            {liveBalance.toFixed(2)} ج.م
                        </p>
                    </div>
                </div>
            </div>

            {/* Tabs bar (C2-02): fixed under Header, same proven pattern as Header/BottomNav/form.
                lg+ (REQ-XX follow-up): lg:right-64 stops the bar at the desktop Sidebar edge — same bug class as the payment bar fix, live-measured 256px overlap at 1280px. No lg:top-* needed: Header is visible on all screens (bar anchors at y=64 everywhere). */}
            <div className="fixed top-[calc(4rem+env(safe-area-inset-top))] left-0 right-0 lg:right-64 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm" role="tablist">
                <div className="flex overflow-x-auto scrollbar-none">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 min-w-max whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                                activeTab === tab.id
                                    ? 'border-primary-600 text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20'
                                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-primary-600'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab content — single scroll (main), no nested scroll. pt clears fixed tabs bar (~2.6rem) */}
            <div className="flex-1 px-4 pt-[calc(2.6rem+0.75rem)] pb-4">
                {activeTab === 'overview' && (
                    <div className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-green-700 dark:text-green-300">{payments.length}</p>
                                <p className="text-xs mt-1">مدفوعات</p>
                            </div>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{invoices.length}</p>
                                <p className="text-xs mt-1">فواتير</p>
                            </div>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-red-700 dark:text-red-300">{returns.length}</p>
                                <p className="text-xs mt-1">مرتجعات</p>
                            </div>
                        </div>
                        {customer.address && (
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 mt-2">
                                <p className="text-xs text-gray-600 dark:text-gray-300">العنوان</p>
                                <p className="mt-0.5">{customer.address}</p>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'payments' && (
                    <div className="space-y-2">
                        {payments.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد دفعات سابقة.</p>
                        ) : payments.map(p => (
                            <div key={p.id} className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                <span className="font-bold text-green-700 dark:text-green-300">{p.amount.toFixed(2)} ج.م</span>
                                <span className="text-xs text-gray-600 dark:text-gray-300 text-left" dir="ltr">{new Date(p.date).toLocaleString('ar-EG')}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'invoices' && (
                    <div className="space-y-2">
                        {invoices.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد فواتير.</p>
                        ) : invoices.map(inv => (
                            <button
                                key={inv.id}
                                onClick={() => setSelectedTransaction(inv)}
                                className="w-full text-right p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{inv.invoiceNumber}</span>
                                    <span className="font-bold text-blue-800 dark:text-blue-300">{inv.total.toFixed(2)} ج.م</span>
                                </div>
                                <div className="flex justify-between items-center gap-2 mt-1">
                                    <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(inv.createdAt).toLocaleDateString('ar-EG')} — {inv.paymentMethod}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-300">{inv.items.length} صنف</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
                {activeTab === 'returns' && (
                    <div className="space-y-2">
                        {returns.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد مرتجعات.</p>
                        ) : returns.map(ret => (
                            <button
                                key={ret.id}
                                onClick={() => setSelectedTransaction(ret)}
                                className="w-full text-right p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">مرتجع</span>
                                    <span className="font-bold text-red-800 dark:text-red-300">-{ret.total.toFixed(2)} ج.م</span>
                                </div>
                                <div className="flex justify-between items-center gap-2 mt-1">
                                    <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(ret.createdAt).toLocaleDateString('ar-EG')}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-300">{ret.items.length} صنف</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Add payment form — fixed above BottomNav, same positioning pattern as BottomNav itself (C2-01 fix).
                lg+ (REQ-XX): lg:right-64 stops the bar at the desktop Sidebar edge (App.tsx lg:pr-64 pattern), lg:bottom-0 removes the 4rem BottomNav gap (BottomNav is lg:hidden — live-measured 64px dead gap at 1280px). */}
            <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 left-0 right-0 lg:right-64 z-30 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] px-4 pt-3 pb-3">
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <div className="flex-1 min-w-0">
                        <label htmlFor="paymentAmount" className="sr-only">المبلغ</label>
                        <input
                            id="paymentAmount"
                            type="number"
                            inputMode="decimal"
                            placeholder="مبلغ الدفعة"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                            required
                            min="0.01"
                            step="0.01"
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <label htmlFor="paymentNotes" className="sr-only">ملاحظات (اختياري)</label>
                        <input
                            id="paymentNotes"
                            type="text"
                            placeholder="ملاحظات (اختياري)"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="shrink-0 px-5 py-2.5 bg-primary-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
                    >
                        {isSubmitting ? '...' : 'حفظ'}
                    </button>
                </form>
            </div>

            <InvoiceDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
        </div>
    );
}
