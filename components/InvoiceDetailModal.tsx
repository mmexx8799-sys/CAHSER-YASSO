import React from 'react';
import { X } from 'lucide-react';
import type { Invoice, Return, PurchaseInvoice, SupplierReturn } from '../types';

export const InvoiceDetailModal: React.FC<{
    transaction: Invoice | Return | PurchaseInvoice | SupplierReturn | null;
    onClose: () => void;
}> = ({ transaction, onClose }) => {
    if (!transaction) return null;

    const isReturn = 'invoiceNumber' in transaction === false;
    const invoice = transaction as Invoice;
    const purchaseInvoice = transaction as PurchaseInvoice;
    const supplierReturn = transaction as SupplierReturn;
    const partyName = (invoice as any).customerName || (invoice as any).supplierName;
    const partyLabel = (invoice as any).supplierName ? 'المورد:' : 'العميل:';

    // REQ-UI-1 + UI-1b: derive badge from existing fields (no schema change) — يميّز الآجل
    const getBadge = (): { label: string; isCredit: boolean } => {
        const hasInvoiceNumber = 'invoiceNumber' in transaction && !!(transaction as any).invoiceNumber;
        const hasSupplierName = 'supplierName' in transaction && !!(transaction as any).supplierName;
        const paymentMethod = (transaction as any).paymentMethod as string | undefined;
        const customerId = (transaction as any).customerId as string | undefined;
        const originalInvoiceId = (transaction as any).originalInvoiceId as string | undefined;
        if (hasInvoiceNumber && hasSupplierName) return { label: 'إيصال شراء', isCredit: false };
        if (hasInvoiceNumber && !hasSupplierName) {
            const isCredit = paymentMethod === 'آجل';
            return { label: isCredit ? 'إيصال بيع آجل' : 'إيصال بيع', isCredit };
        }
        if (!hasInvoiceNumber && hasSupplierName) return { label: 'إيصال مرتجع مورد', isCredit: false };
        // Return: آجل إذا مرتبط بعميل (customerId أو originalInvoiceId) — دون قراءة إضافية
        const isCreditReturn = !!(customerId || originalInvoiceId);
        return { label: isCreditReturn ? 'إيصال مرتجع آجل' : 'إيصال مرتجع', isCredit: isCreditReturn };
    };
    const badge = getBadge();
    const isReturnTx = isReturn; // for totals coloring

    // Document number chip — monospace only here (legitimate use for reference code)
    const docNumber: string | null = (() => {
        if ('invoiceNumber' in transaction && (transaction as any).invoiceNumber) return (transaction as any).invoiceNumber as string;
        // returns / supplierReturns: use id (shortened for display but full in chip title)
        return (transaction as any).id || null;
    })();

    const gridCols = 'grid-cols-[1fr_2rem_3.5rem_4rem]';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-receipt-paper dark:bg-receipt-paper-dark text-gray-900 dark:text-gray-100 rounded-xl shadow-xl w-full max-w-sm p-4 text-sm max-h-[90vh] overflow-y-auto border border-receipt-hair dark:border-receipt-hair-dark">
                {/* Header: badge + close */}
                <div className="relative flex items-start justify-between gap-2 mb-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${badge.isCredit ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' : 'bg-receipt-accent/10 text-receipt-accent border-receipt-accent/20 dark:bg-receipt-accent-dark/20 dark:text-receipt-accent-dark dark:border-receipt-accent-dark/30'}`}>
                        {badge.label}
                    </span>
                    <button onClick={onClose} aria-label="إغلاق" className="text-receipt-muted dark:text-receipt-muted-dark hover:text-gray-900 dark:hover:text-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="text-center mb-3">
                    <h2 className="text-lg font-bold">نور الرحمن للملابس</h2>
                    <p className="text-xs text-receipt-muted dark:text-receipt-muted-dark">{new Date(transaction.createdAt).toLocaleDateString('ar-EG')} — {new Date(transaction.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p>
                    {docNumber && (
                        <div className="mt-2 flex justify-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-receipt-hair dark:border-receipt-hair-dark text-gray-700 dark:text-gray-300 tracking-wide" title={docNumber}>
                                رقم المستند: {docNumber}
                            </span>
                        </div>
                    )}
                </div>

                <div className="border-t border-dashed border-receipt-hair dark:border-receipt-hair-dark my-2"></div>

                {/* Header row — same grid as item rows */}
                <div className={`grid ${gridCols} gap-2 font-bold text-xs text-receipt-muted dark:text-receipt-muted-dark`}>
                    <p className="text-right">الصنف</p>
                    <p className="text-center tabular-nums">ك</p>
                    <p className="text-center tabular-nums">سعر</p>
                    <p className="text-left tabular-nums">إجمالي</p>
                </div>

                <div className="border-t border-dashed border-receipt-hair dark:border-receipt-hair-dark my-2"></div>

                <div className="space-y-2">
                    {transaction.items.map((item, index) => (
                        <div key={index} className={`grid ${gridCols} gap-2 items-start py-1`}>
                            <div className="text-right min-w-0">
                                <p className="break-words leading-snug">{item.name}</p>
                                <p className="text-xs text-receipt-muted dark:text-receipt-muted-dark">{item.code}</p>
                            </div>
                            <p className="text-center tabular-nums">{item.buyQuantity}</p>
                            <p className="text-center tabular-nums">{(item.price || 0).toFixed(2)}</p>
                            <p className="text-left font-semibold tabular-nums">{((item.buyQuantity || 0) * (item.price || 0)).toFixed(2)}</p>
                        </div>
                    ))}
                </div>

                <div className="border-t border-dashed border-receipt-hair dark:border-receipt-hair-dark my-2"></div>

                <div className="space-y-1 mt-2">
                    {!isReturn && (
                        <>
                            <div className="flex justify-between text-sm">
                                <span className="text-receipt-muted dark:text-receipt-muted-dark">الإجمالي الفرعي:</span>
                                <span className="tabular-nums">{(invoice.subtotal || 0).toFixed(2)} ج.م</span>
                            </div>
                            {(invoice.discount || 0) > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-receipt-muted dark:text-receipt-muted-dark">الخصم:</span>
                                    <span className="tabular-nums text-red-600 dark:text-red-400">- {(invoice.discount || 0).toFixed(2)} ج.م</span>
                                </div>
                            )}
                        </>
                    )}
                    <div className={`flex justify-between font-bold text-base border-t pt-2 ${isReturnTx ? 'border-red-200 dark:border-red-900/50' : 'border-receipt-hair dark:border-receipt-hair-dark'}`}>
                        <span>الإجمالي:</span>
                        <span className={`tabular-nums ${isReturnTx ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>{(transaction.total || 0).toFixed(2)} ج.م</span>
                    </div>
                    {!isReturn && (
                        <>
                            <div className="border-t border-dashed border-receipt-hair dark:border-receipt-hair-dark my-2"></div>
                            {invoice.paymentMethod && (
                                <div className="flex justify-between text-xs">
                                    <span className="text-receipt-muted dark:text-receipt-muted-dark">طريقة الدفع:</span>
                                    <span>{invoice.paymentMethod}</span>
                                </div>
                            )}
                            {partyName && (
                                <div className="flex justify-between text-xs">
                                    <span className="text-receipt-muted dark:text-receipt-muted-dark">{partyLabel}</span>
                                    <span>{partyName}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="text-center mt-4 text-xs text-receipt-muted dark:text-receipt-muted-dark">
                    <p>شكراً لزيارتكم</p>
                </div>
            </div>
        </div>
    );
};
