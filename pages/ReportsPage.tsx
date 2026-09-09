import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { FileText, Undo2 } from 'lucide-react';
import { subscribeToCollection } from '../services/dataCache';
import type { DailyArchive, Invoice, Return } from '../types';
import { PaymentMethod } from '../types';
import { Timestamp, orderBy, where } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';

const FinancialSummary: React.FC<{ archive: DailyArchive | null }> = ({ archive }) => {
    if (!archive) return null;

    const hasNewReturnFields = (archive as any).totalReturnsCash !== undefined || (archive as any).totalReturnsOnAccount !== undefined;
    const summaryItems = [
        { label: 'إجمالي المبيعات', value: archive.totalSales || 0, color: 'text-green-700 dark:text-green-300' },
        { label: 'إجمالي المرتجعات', value: archive.totalReturns || 0, color: 'text-red-700 dark:text-red-300' },
        { label: 'مرتجعات على حساب العملاء', value: (archive as any).totalReturnsOnAccount || 0, color: 'text-orange-700 dark:text-orange-300' },
        { label: 'صافي النقدية بالدرج', value: (archive.totalCash || 0) - (hasNewReturnFields ? ((archive as any).totalReturnsCash || 0) : (archive.totalReturns || 0)), color: 'text-blue-700 dark:text-blue-300' },
        { label: 'إجمالي الآجل', value: archive.totalCredit || 0, color: 'text-orange-700 dark:text-orange-300' },
        { label: 'إجمالي فودافون كاش', value: archive.totalVodafoneCash || 0, color: 'text-purple-700 dark:text-purple-300' },
        { label: 'إجمالي انستا باي', value: archive.totalInstapay || 0, color: 'text-teal-700 dark:text-teal-300' },
    ];


    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
            <h2 className="font-bold text-lg mb-4 text-gray-900 dark:text-gray-100">ملخص يوم {archive.id}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-center">
                {summaryItems.map(item => (
                    <div key={item.label}>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{item.label}</p>
                        <p className={`text-xl font-bold ${item.color}`}>{item.value.toFixed(2)} ج.م</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function ReportsPage() {
    const [archives, setArchives] = useState<DailyArchive[]>([]);
    const [selectedArchiveId, setSelectedArchiveId] = useState<string>('');
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [returns, setReturns] = useState<Return[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTransaction, setSelectedTransaction] = useState<Invoice | Return | null>(null);

    const location = useLocation();

    useEffect(() => {
        const constraints: QueryConstraint[] = [orderBy('startTime', 'desc')];
        const unsubscribe = subscribeToCollection<Omit<DailyArchive, 'startTime' | 'endTime'> & { startTime: Timestamp, endTime?: Timestamp }>('dailyArchives', (archivesData) => {
            const mappedArchives = archivesData.map(a => ({
                ...a,
                startTime: a.startTime instanceof Timestamp ? a.startTime.toMillis() : Date.now(),
                endTime: a.endTime instanceof Timestamp ? a.endTime.toMillis() : a.endTime,
            }));
            setArchives(mappedArchives);

            const preselectedDate = location.state?.selectedDate;

            if (preselectedDate && mappedArchives.some(a => a.id === preselectedDate)) {
                setSelectedArchiveId(preselectedDate);
            } else if (mappedArchives.length > 0 && !selectedArchiveId) {
                setSelectedArchiveId(mappedArchives[0].id);
            }
            setIsLoading(false);
        }, constraints);
        return () => unsubscribe();
    }, [location.state]);

    useEffect(() => {
        if (!selectedArchiveId) return;

        // FIX: Handle cases where createdAt might be null (pending writes) or not a Timestamp
        const mapper = <T extends { createdAt: any }>(data: T[]) => {
            return data.map(item => {
                let createdAtMillis = Date.now();
                if (item.createdAt && typeof item.createdAt.toMillis === 'function') {
                    createdAtMillis = item.createdAt.toMillis();
                } else if (typeof item.createdAt === 'number') {
                    createdAtMillis = item.createdAt;
                }
                return {
                    ...item,
                    createdAt: createdAtMillis,
                };
            }).sort((a, b) => b.createdAt - a.createdAt);
        };

        const invoiceConstraints: QueryConstraint[] = [where('dailyArchiveId', '==', selectedArchiveId)];
        const unsubscribeInvoices = subscribeToCollection<Omit<Invoice, 'createdAt'> & { createdAt: Timestamp }>('invoices', (data) => setInvoices(mapper(data)), invoiceConstraints);

        const returnConstraints: QueryConstraint[] = [where('dailyArchiveId', '==', selectedArchiveId)];
        const unsubscribeReturns = subscribeToCollection<Omit<Return, 'createdAt'> & { createdAt: Timestamp }>('returns', (data) => setReturns(mapper(data)), returnConstraints);

        return () => {
            unsubscribeInvoices();
            unsubscribeReturns();
        };
    }, [selectedArchiveId]);

    const selectedArchive = useMemo(() => archives.find(a => a.id === selectedArchiveId), [archives, selectedArchiveId]);

    const groupedInvoices = useMemo(() => {
        return invoices.reduce((acc, invoice) => {
            const method = invoice.paymentMethod;
            if (!acc[method]) {
                acc[method] = [];
            }
            acc[method].push(invoice);
            return acc;
        }, {} as Record<PaymentMethod, Invoice[]>);
    }, [invoices]);

    if (isLoading) {
        return <div className="p-4 text-center">جاري تحميل التقارير...</div>;
    }

    if (archives.length === 0) {
        return <div className="p-4 text-center">لا توجد بيانات لعرضها.</div>;
    }

    const TransactionList: React.FC<{ title: string; items: (Invoice | Return)[]; isReturn?: boolean }> = ({ title, items, isReturn = false }) => {
        if (items.length === 0) return null;
        return (
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
                <h2 className={`font-bold mb-2 ${isReturn ? 'text-red-700 dark:text-red-300' : 'text-gray-800 dark:text-gray-100'}`}>{title}</h2>
                <div className="space-y-2">
                    {items.map(item => (
                        <button key={item.id} onClick={() => setSelectedTransaction(item)} className="w-full text-right p-2 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                            <div className="flex items-center space-x-3 space-x-reverse">
                                {isReturn ? <Undo2 className="text-red-500" size={18} aria-hidden="true" /> : <FileText className="text-blue-500" size={18} aria-hidden="true" />}
                                <div>
                                    <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">#{item.id.slice(0, 6).toUpperCase()}</span>
                                    {'customerName' in item && <span className="text-xs text-gray-600 dark:text-gray-300 block">العميل: {item.customerName}</span>}
                                </div>
                            </div>
                            <span className={`font-bold ${isReturn ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                                {isReturn ? '-' : ''}{(item.total || 0).toFixed(2)} ج.م
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-6">
            <h1 className="text-2xl sm:text-3xl font-bold mb-4">التقارير التفصيلية</h1>
            <div className="mb-4">
                <label htmlFor="archiveSelect" className="sr-only">اختر اليومية</label>
                <select
                    id="archiveSelect"
                    name="archiveSelect"
                    value={selectedArchiveId}
                    onChange={(e) => setSelectedArchiveId(e.target.value)}
                    className="w-full lg:max-w-md p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg shadow-sm"
                >
                    {archives.map(a => <option key={a.id} value={a.id}>يومية {a.id} ({a.status === 'closed' ? 'مغلقة' : 'مفتوحة'})</option>)}
                </select>
            </div>

            <FinancialSummary archive={selectedArchive || null} />

            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-4">
                {Object.entries(groupedInvoices).map(([method, invoiceList]) => (
                    <TransactionList key={method} title={`فواتير البيع (${method})`} items={invoiceList} />
                ))}

                <TransactionList title="المرتجعات" items={returns} isReturn />
            </div>

            <InvoiceDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
        </div>
    );
}
