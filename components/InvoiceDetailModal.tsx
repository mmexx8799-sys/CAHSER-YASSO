
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-4 text-gray-800 dark:text-gray-100 font-mono text-sm">
                <div className="relative text-center mb-4">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">كاشير ياسو للملابس</h2>
                    <p>{new Date(transaction.createdAt).toLocaleDateString('ar-EG')}</p>
                    <p>{new Date(transaction.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p>
                    <button onClick={onClose} aria-label="إغلاق" className="absolute top-0 right-0 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="border-t border-dashed border-gray-400 my-2"></div>

                {/* Header */}
                <div className="flex font-bold">
                    <p className="flex-auto text-right">الصنف</p>
                    <p className="w-8 text-center">ك</p>
                    <p className="w-12 text-center">سعر</p>
                    <p className="w-16 text-left">إجمالي</p>
                </div>

                <div className="border-t border-dashed border-gray-400 my-1"></div>

                <div className="space-y-1">
                    {transaction.items.map((item, index) => (
                        <div key={index} className="flex">
                            <div className="flex-auto text-right">
                                <p>{item.name}</p>
                                <p className="text-xs text-gray-600">{item.code}</p>
                            </div>
                            <p className="w-8 text-center">{item.buyQuantity}</p>
                            <p className="w-12 text-center">{(item.price || 0).toFixed(2)}</p>
                            <p className="w-16 text-left font-semibold">{((item.buyQuantity || 0) * (item.price || 0)).toFixed(2)}</p>
                        </div>
                    ))}
                </div>

                <div className="border-t border-dashed border-gray-400 my-2"></div>

                <div className="space-y-1 mt-2">
                    {!isReturn && (
                        <>
                            <div className="flex justify-between">
                                <span>الإجمالي الفرعي:</span>
                                <span>{(invoice.subtotal || 0).toFixed(2)} ج.م</span>
                            </div>
                            {(invoice.discount || 0) > 0 && (
                                <div className="flex justify-between">
                                    <span>الخصم:</span>
                                    <span className="text-red-700 dark:text-red-300">- {(invoice.discount || 0).toFixed(2)} ج.م</span>
                                </div>
                            )}
                        </>
                    )}
                    <div className="flex justify-between font-bold text-base border-t border-gray-300 pt-1">
                        <span>الإجمالي:</span>
                        <span>{(transaction.total || 0).toFixed(2)} ج.م</span>
                    </div>
                    {!isReturn && (
                        <>
                            <div className="border-t border-dashed border-gray-400 my-2"></div>
                            <div className="flex justify-between text-xs">
                                <span>طريقة الدفع:</span>
                                <span>{invoice.paymentMethod}</span>
                            </div>
                            {invoice.customerName && (
                                <div className="flex justify-between text-xs">
                                    <span>العميل:</span>
                                    <span>{invoice.customerName}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="text-center mt-4 text-xs text-gray-600 dark:text-gray-300">
                    <p>شكراً لزيارتكم</p>
                </div>
            </div>
        </div>
    );
};
