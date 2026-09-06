import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Phone } from 'lucide-react';
import type { Customer, CustomerPayment, Invoice, Return } from '../types';
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
        <div className="p-4 pb-24">
            {/* Header (C1-01): name + phone + live balance */}
            <div className="mb-4">
                <button
                    onClick={handleBack}
                    aria-label="العودة لصفحة العملاء"
                    className="mb-3 flex items-center gap-1 text-sm text-primary-700 dark:text-primary-300 hover:underline"
                >
                    <ArrowRight size={18} />
                    <span>العملاء</span>
                </button>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
                    <div className="flex flex-col gap-2">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{customer.name}</h1>
                        {customer.phone && (
                            <p className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                                <Phone size={14} />
                                <span dir="ltr">{customer.phone}</span>
                            </p>
                        )}
                        <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            الرصيد الحالي: <span className={(liveBalance > 0) ? 'text-red-700 dark:text-red-300' : (liveBalance < 0) ? 'text-green-700 dark:text-green-300' : ''}>{liveBalance.toFixed(2)} ج.م</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Tabs bar (C1-03): raw data, no final styling yet */}
            <div className="mb-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto" role="tablist">
                <div className="flex gap-1">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`whitespace-nowrap px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                                activeTab === tab.id
                                    ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-primary-600'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab panels (C1-03): raw data only */}
            <div>
                {activeTab === 'overview' && (
                    <div className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
                        <p>عدد المدفوعات: {payments.length}</p>
                        <p>عدد الفواتير: {invoices.length}</p>
                        <p>عدد المرتجعات: {returns.length}</p>
                        <p>{customer.address ? `العنوان: ${customer.address}` : 'لا يوجد عنوان مسجل'}</p>
                    </div>
                )}
                {activeTab === 'payments' && (
                    <div className="space-y-2">
                        {payments.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد دفعات سابقة.</p>
                        ) : payments.map(p => (
                            <div key={p.id} className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
                                <span className="font-bold text-green-700 dark:text-green-300">{p.amount.toFixed(2)} ج.م</span>
                                <span className="text-xs text-gray-600 dark:text-gray-300">{new Date(p.date).toLocaleString('ar-EG')}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'invoices' && (
                    <div className="space-y-2">
                        {invoices.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد فواتير.</p>
                        ) : invoices.map(inv => (
                            <div key={inv.id} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800">
                                <div className="flex justify-between text-sm">
                                    <span className="font-bold text-gray-900 dark:text-gray-100">{inv.invoiceNumber}</span>
                                    <span className="font-bold text-blue-800 dark:text-blue-300">{inv.total.toFixed(2)} ج.م</span>
                                </div>
                                <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(inv.createdAt).toLocaleString('ar-EG')} — {inv.paymentMethod}</p>
                                <div className="text-xs text-gray-700 dark:text-gray-200 mt-1 space-y-1">
                                    {inv.items.map((it, i) => (
                                        <div key={i} className="flex justify-between">
                                            <span>{it.name} ×{it.buyQuantity}</span>
                                            <span>{(it.price * it.buyQuantity).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'returns' && (
                    <div className="space-y-2">
                        {returns.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد مرتجعات.</p>
                        ) : returns.map(ret => (
                            <div key={ret.id} className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-800">
                                <div className="flex justify-between text-sm">
                                    <span className="font-bold text-gray-900 dark:text-gray-100">مرتجع</span>
                                    <span className="font-bold text-red-800 dark:text-red-300">-{ret.total.toFixed(2)} ج.م</span>
                                </div>
                                <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(ret.createdAt).toLocaleString('ar-EG')}</p>
                                <div className="text-xs text-gray-700 dark:text-gray-200 mt-1 space-y-1">
                                    {ret.items.map((it, i) => (
                                        <div key={i} className="flex justify-between">
                                            <span>{it.name} ×{it.buyQuantity}</span>
                                            <span>{(it.price * it.buyQuantity).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
