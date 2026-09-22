
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Phone, ShoppingCart, Undo2, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { Supplier, SupplierPayment, PurchaseInvoice, SupplierReturn, Product, Category } from '../types';
import { addSupplierPayment, processPurchase, processSupplierReturn, isOfflineGuardError } from '../services/api';
import { subscribeToCollection, subscribeToDocument } from '../services/dataCache';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { where, orderBy, Timestamp } from 'firebase/firestore';
import { usePermissions } from '../hooks/usePermissions';
import ExcelJS from 'exceljs';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type TabId = 'overview' | 'statement' | 'payments' | 'purchases' | 'returns';

const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'statement', label: 'كشف الحساب' },
    { id: 'payments', label: 'المدفوعات' },
    { id: 'purchases', label: 'فواتير الشراء' },
    { id: 'returns', label: 'المرتجعات' },
];

export default function SupplierAccountPage() {
    const { can } = usePermissions();
    const canExport = can('statement.export');
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // Supplier document (live) — same pattern as customer account
    const [supplier, setSupplier] = useState<Supplier | null>(null);
    const [liveBalance, setLiveBalance] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);

    // Records
    const [payments, setPayments] = useState<SupplierPayment[]>([]);
    const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
    const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);

    // New purchase modal
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    // New supplier return modal
    const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);

    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [amount, setAmount] = useState<number | string>('');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<PurchaseInvoice | SupplierReturn | null>(null);

    // Payment form — mirror of customer
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supplier) return;
        const numAmount = Number(amount);
        if (numAmount <= 0) {
            toast.error("المبلغ يجب أن يكون أكبر من صفر");
            return;
        }
        setIsSubmitting(true);
        try {
            await addSupplierPayment({ supplierId: supplier.id, amount: numAmount, notes });
            toast.success("تمت إضافة الدفعة بنجاح");
            setAmount('');
            setNotes('');
        } catch (e) {
            if (isOfflineGuardError(e)) {
                toast.error((e as Error).message);
            } else {
                toast.error("فشلت إضافة الدفعة");
            }
        } finally {
            setIsSubmitting(false);
        }
    }, [supplier, amount, notes]);

    // --- Live supplier document subscription ---
    useEffect(() => {
        let unsubDoc: (() => void) | undefined;
        if (id) {
            unsubDoc = subscribeToDocument<Supplier>('suppliers', id, (data) => {
                if (data) {
                    setSupplier(data);
                    setLiveBalance(data.balance || 0);
                } else {
                    setSupplier(null);
                }
                setIsLoading(false);
            });
        }
        return () => {
            if (unsubDoc) unsubDoc();
        };
    }, [id]);

    // --- Payments subscription ---
    useEffect(() => {
        let unsubscribe: () => void;
        if (id) {
            const constraints = [where('supplierId', '==', id)];
            unsubscribe = subscribeToCollection<Omit<SupplierPayment, 'date'> & { date: Timestamp }>('supplierPayments', (paymentsData) => {
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

    // --- Purchases + Supplier returns subscriptions ---
    useEffect(() => {
        let unsubPur: () => void; let unsubRet: () => void;
        if (id) {
            const purConstraints = [where('supplierId', '==', id), orderBy('createdAt', 'desc')];
            unsubPur = subscribeToCollection<Omit<PurchaseInvoice, 'createdAt'> & { createdAt: Timestamp }>('purchaseInvoices', (data) => {
                const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as PurchaseInvoice)).sort((a, b) => b.createdAt - a.createdAt);
                setPurchases(mapped);
            }, purConstraints);
            const retConstraints = [where('supplierId', '==', id), orderBy('createdAt', 'desc')];
            unsubRet = subscribeToCollection<Omit<SupplierReturn, 'createdAt'> & { createdAt: Timestamp }>('supplierReturns', (data) => {
                const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as SupplierReturn)).sort((a, b) => b.createdAt - a.createdAt);
                setSupplierReturns(mapped);
            }, retConstraints);
        }
        return () => { if (unsubPur) unsubPur(); if (unsubRet) unsubRet(); setPurchases([]); setSupplierReturns([]); };
    }, [id]);

    const handleBack = useCallback(() => {
        navigate('/suppliers');
    }, [navigate]);

    const handleOpenPurchaseModal = useCallback(() => {
        setIsPurchaseModalOpen(true);
    }, []);

    // --- كشف الحساب (REQ-M9): client-side merge of already-loaded records, no new subscriptions ---
    const [statementFrom, setStatementFrom] = useState('');
    const [statementTo, setStatementTo] = useState('');

    interface StatementRow {
        id: string;
        effectiveDate: number; // unified ordering field: `date` for payments, `createdAt` for purchases/returns — merge-time only
        type: string;
        description: string;
        debit: number; // عليه — يزيد المديونية (فاتورة شراء)
        credit: number; // له — يقلل المديونية (دفعة / مرتجع مورد)
        balanceAfter: number; // الرصيد بعد الحركة
    }

    const statementRows: StatementRow[] = useMemo(() => {
        if (!supplier) return [];
        const rows: StatementRow[] = [
            { id: 'opening', effectiveDate: 0, type: 'رصيد افتتاحي', description: 'الرصيد الافتتاحي', debit: 0, credit: 0, balanceAfter: supplier.openingBalance ?? 0 },
        ];
        purchases.forEach(pur => rows.push({
            id: `pur-${pur.id}`,
            effectiveDate: pur.createdAt,
            type: 'فاتورة شراء',
            description: pur.invoiceNumber || 'فاتورة',
            debit: pur.total,
            credit: 0,
            balanceAfter: 0,
        }));
        supplierReturns.forEach(ret => rows.push({
            id: `ret-${ret.id}`,
            effectiveDate: ret.createdAt,
            type: 'مرتجع مورد',
            description: 'مرتجع',
            debit: 0,
            credit: ret.total,
            balanceAfter: 0,
        }));
        payments.forEach(p => rows.push({
            id: `pay-${p.id}`,
            effectiveDate: p.date,
            type: 'دفعة',
            description: p.notes || 'دفعة',
            debit: 0,
            credit: p.amount,
            balanceAfter: 0,
        }));
        rows.sort((a, b) => a.effectiveDate - b.effectiveDate);
        let balance = supplier.openingBalance ?? 0;
        rows.forEach(row => {
            balance += row.debit - row.credit;
            row.balanceAfter = balance;
        });
        return rows;
    }, [supplier, purchases, supplierReturns, payments]);

    const finalStatementBalance = statementRows.length > 0
        ? statementRows[statementRows.length - 1].balanceAfter
        : (supplier?.openingBalance ?? 0);

    // Self-check (REQ-M9 #3): last row must equal liveBalance, else warn visually
    const statementMismatch = statementRows.length > 0
        && Math.abs(finalStatementBalance - liveBalance) > 0.005;

    const filteredStatementRows = useMemo(() => {
        if (!statementFrom && !statementTo) return statementRows;
        const fromTime = statementFrom ? new Date(statementFrom).setHours(0, 0, 0, 0) : -Infinity;
        const toTime = statementTo ? new Date(statementTo).setHours(23, 59, 59, 999) : Infinity;
        return statementRows.filter(row =>
            row.id === 'opening' ? true : (row.effectiveDate >= fromTime && row.effectiveDate <= toTime)
        );
    }, [statementRows, statementFrom, statementTo]);

    // REQ-M9 #4: "لا توجد بيانات" empty state when no actual movements (opening row alone doesn't count)
    const hasVisibleMovements = filteredStatementRows.some(row => row.id !== 'opening');

    // REQ-M9-fix2 #2: badge styling per movement type — same colors as the page's existing tabs
    // (purchases = blue like فواتير الشراء tab, returns = red like المرتجعات tab, payments = green like المدفوعات tab, opening = gray)
    const typeBadgeClass = (type: string) => type === 'فاتورة شراء'
        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800'
        : type === 'مرتجع مورد'
            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-800'
            : type === 'دفعة'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-100 dark:border-green-800'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600';

    // REQ-M9-fix2 #3: display line for البيان — purchase/return reference number, or payment notes
    const rowSubtitle = (row: StatementRow): string | null => {
        if (row.id.startsWith('pur-') || row.id.startsWith('ret-')) {
            const ref = row.description;
            return ref === 'فاتورة' || ref === 'مرتجع' ? null : ref; // fall back when no reference number exists
        }
        return null; // payments already show notes in the main line
    };

    // REQ-M9-fix2 #6: desktop table rows + mobile card rows share this render data
    const statementViewRows = filteredStatementRows;

    const exportStatementCsv = useCallback(() => {
        if (!supplier) return;
        const rows = filteredStatementRows;
        const fmt = (n: number) => n.toFixed(2); // fixed 2 decimals, no thousands separators, no currency symbol
        const fmtDate = (t: number) => {
            const d = new Date(t);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`; // YYYY-MM-DD — sorts correctly as text in Excel
        };
        const escapeCsv = (cell: string) => {
            // standard CSV escaping: wrap in quotes if the value contains comma, quote, or newline; double inner quotes
            if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
            return cell;
        };
        const openingRow = rows.find(row => row.id === 'opening');
        const openingBalance = openingRow ? openingRow.balanceAfter : (supplier.openingBalance ?? 0);
        const today = new Date().toISOString().slice(0, 10);
        const periodLabel = statementFrom || statementTo
            ? `الفترة: ${statementFrom || 'البداية'} إلى ${statementTo || 'الآن'}`
            : 'كل الحركات';
        const csvRows = rows.map(row => [
            row.effectiveDate ? fmtDate(row.effectiveDate) : '',
            row.type,
            row.description,
            row.debit ? fmt(row.debit) : '', // empty cell, not "0.00"/"—", so Excel SUM stays correct
            row.credit ? fmt(row.credit) : '',
            fmt(row.balanceAfter),
        ]);
        const csv = [
            [`${supplier.name} - كشف حساب`],
            [`تاريخ التصدير: ${today}`, periodLabel],
            [],
            ['التاريخ', 'نوع الحركة', 'البيان', 'عليه', 'له', 'الرصيد'],
            ...csvRows,
            [],
            ['الرصيد الافتتاحي', fmt(openingBalance)],
            ['الرصيد النهائي', fmt(liveBalance)],
        ].map(r => r.map(escapeCsv).join(',')).join('\r\n');
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel renders Arabic correctly
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `كشف-حساب-${supplier.name}-${today}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [supplier, filteredStatementRows, statementFrom, statementTo, liveBalance]);

    // REQ-M10: production-formatted .xlsx export (borders/colors/bold) — web download + Android native share
    const exportStatementExcel = useCallback(async () => {
        if (!supplier) return;
        try {
            const rows = filteredStatementRows;
            const fmtDate = (t: number) => {
                const d = new Date(t);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const today = fmtDate(Date.now());
            const fileName = `كشف-حساب-${supplier.name}-${today}.xlsx`;

            const wb = new ExcelJS.Workbook();
            const sheet = wb.addWorksheet('كشف الحساب', {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }], // RTL + freeze title&header rows
            });
            sheet.columns = [
                { header: 'التاريخ', key: 'date', width: 14 },
                { header: 'نوع الحركة', key: 'type', width: 16 },
                { header: 'البيان', key: 'desc', width: 22 },
                { header: 'عليه', key: 'debit', width: 14 },
                { header: 'له', key: 'credit', width: 14 },
                { header: 'الرصيد', key: 'balance', width: 14 },
            ];

            // Title row (merged across all 6 columns), bold size 14
            sheet.spliceRows(1, 0, []); // insert empty row 1 — header auto-added by addWorksheet becomes row 2
            sheet.mergeCells('A1:F1');
            const titleCell = sheet.getCell('A1');
            titleCell.value = `${supplier.name} - كشف حساب - ${today}`;
            titleCell.font = { bold: true, size: 14 };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            // Header row: dark fill, white bold, centered, thin borders
            const headerRow = sheet.getRow(2);
            headerRow.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                    left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                    bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                    right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                };
            });
            headerRow.commit();

            // Data rows
            const numFmt = '#,##0.00';
            const dataBorderStyle: Partial<ExcelJS.Borders> = {
                top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            };
            rows.forEach((row, idx) => {
                const isOpening = row.id === 'opening';
                const xlsxRow = sheet.addRow({
                    date: row.effectiveDate ? fmtDate(row.effectiveDate) : '',
                    type: row.type,
                    desc: row.description,
                    debit: row.debit || null, // null keeps the cell empty — SUM-safe, unlike 0
                    credit: row.credit || null,
                    balance: row.balanceAfter,
                });
                const zebra = !isOpening && idx % 2 === 1; // light-gray zebra on even data rows
                xlsxRow.eachCell(cell => {
                    cell.border = dataBorderStyle;
                    if (isOpening) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                        cell.font = { bold: true };
                    } else if (zebra) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
                    }
                });
                // numeric columns: real numbers + colored fonts (عليه=red, له=green per screen convention)
                if (row.debit) {
                    xlsxRow.getCell('debit').numFmt = numFmt;
                    xlsxRow.getCell('debit').font = { bold: true, color: { argb: 'FFB91C1C' } };
                }
                if (row.credit) {
                    xlsxRow.getCell('credit').numFmt = numFmt;
                    xlsxRow.getCell('credit').font = { bold: true, color: { argb: 'FF15803D' } };
                }
                xlsxRow.getCell('balance').numFmt = numFmt;
                if (isOpening) xlsxRow.getCell('balance').font = { bold: true };
            });

            // Footer: الرصيد النهائي with thick top separator, bold 12, red/green by sign
            const footerRow = sheet.addRow({ desc: 'الرصيد النهائي', balance: liveBalance });
            sheet.mergeCells(`B${footerRow.number}:E${footerRow.number}`);
            const footerLabel = sheet.getCell(`B${footerRow.number}`);
            footerLabel.value = 'الرصيد النهائي';
            footerLabel.font = { bold: true, size: 12 };
            footerLabel.alignment = { horizontal: 'center', vertical: 'middle' };
            footerRow.eachCell(cell => {
                cell.border = {
                    ...dataBorderStyle,
                    top: { style: 'thick', color: { argb: 'FF1E293B' } },
                } as Partial<ExcelJS.Borders>;
            });
            const footerBalance = footerRow.getCell('balance');
            footerBalance.numFmt = numFmt;
            footerBalance.font = {
                bold: true, size: 12,
                color: { argb: liveBalance >= 0 ? 'FFB91C1C' : 'FF15803D' }, // same red/green convention as live balance
            };
            footerBalance.alignment = { horizontal: 'center', vertical: 'middle' };
            footerRow.commit();

            const buffer = await wb.xlsx.writeBuffer();

            if (Capacitor.isNativePlatform()) {
                // Android APK: cache file + native share sheet
                let binary = '';
                const bytes = new Uint8Array(buffer as ArrayBuffer);
                const chunk = 0x8000; // 32k chunks — avoids call-stack limits in WebView btoa
                for (let i = 0; i < bytes.length; i += chunk) {
                    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
                }
                const base64 = btoa(binary);
                const result = await Filesystem.writeFile({
                    path: fileName,
                    data: base64,
                    directory: Directory.Cache,
                });
                await Share.share({
                    title: fileName,
                    url: result.uri,
                    dialogTitle: 'مشاركة كشف الحساب',
                });
            } else {
                // Web: same <a download> approach as CSV
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('Excel export failed:', error);
            toast.error('فشل تصدير ملف Excel');
        }
    }, [supplier, filteredStatementRows, liveBalance]);

    const handlePurchaseComplete = useCallback(() => {
        setIsPurchaseModalOpen(false);
    }, []);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-full pt-10">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!supplier) {
        return (
            <div className="p-4 text-center pt-10">
                <p className="text-xl text-gray-700 dark:text-gray-300 mb-4">المورد غير موجود.</p>
                <button onClick={handleBack} className="py-2 px-4 bg-primary-600 text-white rounded-lg">العودة للموردين</button>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-full pb-[calc(7rem+env(safe-area-inset-bottom))]">
            {/* Header: name + phone + live balance */}
            <div className="px-4 pt-4 pb-3 bg-white dark:bg-gray-800 shadow-sm rounded-b-lg">
                <button
                    onClick={handleBack}
                    aria-label="العودة لصفحة الموردين"
                    className="mb-2 flex items-center gap-1 text-sm text-primary-700 dark:text-primary-300 hover:underline"
                >
                    <ArrowRight size={18} />
                    <span>الموردين</span>
                </button>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{supplier.name}</h1>
                        {supplier.phone && (
                            <p className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                                <Phone size={14} />
                                <span dir="ltr">{supplier.phone}</span>
                            </p>
                        )}
                    </div>
                    <div className="text-left shrink-0">
                        <p className="text-xs text-gray-600 dark:text-gray-300">{liveBalance > 0 ? 'له مديونية علينا (دائن)' : liveBalance < 0 ? 'له رصيد (مدين)' : 'رصيد صفري'}</p>
                        <p className={`text-lg font-bold ${(liveBalance > 0) ? 'text-red-700 dark:text-red-300' : (liveBalance < 0) ? 'text-green-700 dark:text-green-300' : 'text-gray-900 dark:text-gray-100'}`}>
                            {Math.abs(liveBalance).toFixed(2)} ج.م
                        </p>
                    </div>
                </div>
                {can('supplier.ops') && (
                <button
                    onClick={handleOpenPurchaseModal}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-600 text-white rounded-lg font-semibold text-sm hover:bg-primary-700"
                >
                    <ShoppingCart size={18} />
                    <span>فاتورة شراء جديدة</span>
                </button>
                )}
            </div>

            {/* Tabs bar — same fixed positioning pattern as customer account */}
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

            {/* Tab content */}
            <div className="flex-1 px-4 pt-[calc(2.6rem+0.75rem)] pb-4">
                {activeTab === 'overview' && (
                    <div className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-green-700 dark:text-green-300">{payments.length}</p>
                                <p className="text-xs mt-1">مدفوعات</p>
                            </div>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{purchases.length}</p>
                                <p className="text-xs mt-1">فواتير شراء</p>
                            </div>
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-center">
                                <p className="text-xl font-bold text-red-700 dark:text-red-300">{supplierReturns.length}</p>
                                <p className="text-xs mt-1">مرتجعات</p>
                            </div>
                        </div>
                        {(supplier.openingBalance ?? 0) !== 0 && (
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 mt-2">
                                <p className="text-xs text-gray-600 dark:text-gray-300">الرصيد الافتتاحي</p>
                                <p className="mt-0.5 font-bold">{(supplier.openingBalance ?? 0).toFixed(2)} ج.م</p>
                            </div>
                        )}
                        {supplier.address && (
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 mt-2">
                                <p className="text-xs text-gray-600 dark:text-gray-300">العنوان</p>
                                <p className="mt-0.5">{supplier.address}</p>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'statement' && (
                    <div className="space-y-3">
                        {statementMismatch && (
                            <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-sm text-yellow-800 dark:text-yellow-300">
                                تنبيه: آخر رصيد في كشف الحساب ({finalStatementBalance.toFixed(2)} ج.م) لا يطابق الرصيد الحالي الظاهر أعلى الصفحة ({liveBalance.toFixed(2)} ج.م) — قد تكون هناك حركة ناقصة أو معدّلة يدويًا.
                            </div>
                        )}
                        <div className="flex flex-wrap items-end gap-2">
                            <div>
                                <label htmlFor="statementFrom" className="block text-xs text-gray-600 dark:text-gray-300 mb-1">من تاريخ</label>
                                <input
                                    id="statementFrom"
                                    type="date"
                                    value={statementFrom}
                                    onChange={e => setStatementFrom(e.target.value)}
                                    className="p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                                />
                            </div>
                            <div>
                                <label htmlFor="statementTo" className="block text-xs text-gray-600 dark:text-gray-300 mb-1">إلى تاريخ</label>
                                <input
                                    id="statementTo"
                                    type="date"
                                    value={statementTo}
                                    onChange={e => setStatementTo(e.target.value)}
                                    className="p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                                />
                            </div>
                            <button
                                onClick={exportStatementCsv}
                                disabled={!hasVisibleMovements || !canExport}
                                title={!canExport ? 'ليس لديك صلاحية تصدير الكشف' : undefined}
                                className="flex items-center gap-1.5 py-2 px-4 bg-primary-600 text-white rounded-lg font-semibold text-sm hover:bg-primary-700 disabled:opacity-50"
                            >
                                <Download size={16} />
                                <span>تصدير CSV</span>
                            </button>
                            <button
                                onClick={exportStatementExcel}
                                disabled={!hasVisibleMovements || !canExport}
                                title={!canExport ? 'ليس لديك صلاحية تصدير الكشف' : undefined}
                                className="flex items-center gap-1.5 py-2 px-4 bg-green-700 text-white rounded-lg font-semibold text-sm hover:bg-green-800 disabled:opacity-50"
                            >
                                <FileSpreadsheet size={16} />
                                <span>تصدير Excel</span>
                            </button>
                        </div>
                        {filteredStatementRows.length === 0 || !hasVisibleMovements ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد بيانات.</p>
                        ) : (
                            <>
                                {/* Desktop/tablet table (md+) — REQ-M9-fix2 #1-5, #7 */}
                                <div className="hidden md:block bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-base">
                                            <thead>
                                                <tr className="text-sm text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-600">
                                                    <th className="p-3 text-left font-semibold">التاريخ</th>
                                                    <th className="p-3 text-right font-semibold">نوع الحركة</th>
                                                    <th className="p-3 text-right font-semibold">البيان</th>
                                                    <th className="p-3 text-left font-semibold">عليه</th>
                                                    <th className="p-3 text-left font-semibold">له</th>
                                                    <th className="p-3 text-left font-semibold">الرصيد</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                                {statementViewRows.map((row, idx) => (
                                                    <tr key={row.id} className={`text-gray-800 dark:text-gray-200 ${row.id === 'opening' ? 'bg-gray-200 dark:bg-gray-600' : idx % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}>
                                                        <td className="p-3 whitespace-nowrap font-medium text-sm" dir="ltr">{row.effectiveDate ? new Date(row.effectiveDate).toLocaleDateString('ar-EG') : '—'}</td>
                                                        <td className="p-3 whitespace-nowrap">
                                                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(row.type)}`}>{row.type}</span>
                                                        </td>
                                                        <td className="p-3 min-w-24">
                                                            {row.id === 'opening' ? row.description
                                                                : row.id.startsWith('pay-')
                                                                    ? (row.description !== 'دفعة' ? row.description : '—')
                                                                    : <span className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{rowSubtitle(row) ?? '—'}</span>}
                                                        </td>
                                                        <td className="p-3 whitespace-nowrap text-left font-bold text-red-700 dark:text-red-300" dir="ltr">{row.debit ? row.debit.toFixed(2) : '—'}</td>
                                                        <td className="p-3 whitespace-nowrap text-left font-bold text-green-700 dark:text-green-300" dir="ltr">{row.credit ? row.credit.toFixed(2) : '—'}</td>
                                                        <td className="p-3 whitespace-nowrap text-left font-bold" dir="ltr">{row.balanceAfter.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Mobile cards (<md) — REQ-M9-fix2 #6, same card style as purchases/returns tabs */}
                                <div className="md:hidden space-y-2">
                                    {statementViewRows.map(row => (
                                        <div key={row.id} className={`p-3 rounded-lg border ${row.id === 'opening' ? 'bg-gray-200 dark:bg-gray-600 border-gray-300 dark:border-gray-500' : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
                                            <div className="flex justify-between items-center gap-2">
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(row.type)}`}>{row.type}</span>
                                                <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap" dir="ltr">{row.effectiveDate ? new Date(row.effectiveDate).toLocaleDateString('ar-EG') : '—'}</span>
                                            </div>
                                            {(row.id === 'opening' || (row.id.startsWith('pay-') && row.description !== 'دفعة') || rowSubtitle(row)) && (
                                                <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                                                    {row.id === 'opening' ? row.description : row.id.startsWith('pay-') ? row.description : rowSubtitle(row)}
                                                </p>
                                            )}
                                            <div className="flex gap-3 items-center mt-2">
                                                {row.debit ? (
                                                    <span className="font-bold text-red-700 dark:text-red-300">عليه: {row.debit.toFixed(2)} ج.م</span>
                                                ) : row.credit ? (
                                                    <span className="font-bold text-green-700 dark:text-green-300">له: {row.credit.toFixed(2)} ج.م</span>
                                                ) : (
                                                    <span />
                                                )}
                                            </div>
                                            <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 flex justify-between items-center text-sm">
                                                <span className="text-gray-600 dark:text-gray-300">الرصيد</span>
                                                <span className="font-bold" dir="ltr">{row.balanceAfter.toFixed(2)} ج.م</span>
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </>
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
                {activeTab === 'purchases' && (
                    <div className="space-y-2">
                        {purchases.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد فواتير شراء.</p>
                        ) : purchases.map(pur => (
                            <button
                                key={pur.id}
                                onClick={() => setSelectedTransaction(pur)}
                                className="w-full text-right p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{pur.invoiceNumber}</span>
                                    <span className="font-bold text-blue-800 dark:text-blue-300">{pur.total.toFixed(2)} ج.م</span>
                                </div>
                                <div className="flex justify-between items-center gap-2 mt-1">
                                    <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(pur.createdAt).toLocaleDateString('ar-EG')}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-300">{pur.items.length} صنف</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
                {activeTab === 'returns' && (
                    <div className="space-y-2">
                        {can('supplier.ops') && (
                        <button
                            onClick={() => setIsReturnModalOpen(true)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700"
                        >
                            <Undo2 size={18} />
                            <span>مرتجع مورد جديد</span>
                        </button>
                        )}
                        {supplierReturns.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-300 text-center py-6 text-sm">لا توجد مرتجعات.</p>
                        ) : supplierReturns.map(ret => (
                            <button
                                key={ret.id}
                                onClick={() => setSelectedTransaction(ret)}
                                className="w-full text-right p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">مرتجع مورد</span>
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

            {/* Add payment form — fixed above BottomNav, same positioning as customer account */}
            {can('supplier.ops') && (
            <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 left-0 right-0 lg:right-64 z-30 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] px-4 pt-3 pb-3">
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <div className="flex-1 min-w-0">
                        <label htmlFor="supplierPaymentAmount" className="sr-only">المبلغ</label>
                        <input
                            id="supplierPaymentAmount"
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
                        <label htmlFor="supplierPaymentNotes" className="sr-only">ملاحظات (اختياري)</label>
                        <input
                            id="supplierPaymentNotes"
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
            )}

            <PurchaseModal
                isOpen={isPurchaseModalOpen}
                onClose={() => setIsPurchaseModalOpen(false)}
                supplier={supplier}
                onComplete={handlePurchaseComplete}
            />
            <SupplierReturnModal
                isOpen={isReturnModalOpen}
                onClose={() => setIsReturnModalOpen(false)}
                supplier={supplier}
                onComplete={() => setIsReturnModalOpen(false)}
            />
            <InvoiceDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
        </div>
    );
}

// --- New purchase entry modal: simplified mirror of POS (supplier + catalog items w/ qty & purchase price) ---
const PurchaseModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    supplier: Supplier;
    onComplete: () => void;
}> = ({ isOpen, onClose, supplier, onComplete }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [items, setItems] = useState<Array<{ product: Product; buyQuantity: number; price: number }>>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmationOpen, setConfirmationOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const productsConstraints = [orderBy('name')];
        const unsubProducts = subscribeToCollection<Product>('products', setProducts, productsConstraints);
        const categoriesConstraints = [orderBy('name')];
        const unsubCategories = subscribeToCollection<Category>('categories', setCategories, categoriesConstraints);
        return () => {
            unsubProducts();
            unsubCategories();
        };
    }, [isOpen]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setItems([]);
            setSearchQuery('');
            setSelectedCategory('');
            setConfirmationOpen(false);
        }
    }, [isOpen]);

    const filteredProducts = products.filter(p => {
        const matchesCategory = !selectedCategory || p.categoryId === selectedCategory;
        const q = searchQuery.trim();
        const matchesSearch = !q || p.name.includes(q) || p.code.includes(q);
        return matchesCategory && matchesSearch;
    });

    const addItem = (product: Product) => {
        setItems(prev => {
            const existing = prev.find(i => i.product.id === product.id);
            if (existing) {
                return prev.map(i => i.product.id === product.id ? { ...i, buyQuantity: i.buyQuantity + 1 } : i);
            }
            return [...prev, { product, buyQuantity: 1, price: product.price }];
        });
    };

    const updateItem = (productId: string, buyQuantity: number, price: number) => {
        setItems(prev => prev.map(i =>
            i.product.id === productId
                ? { ...i, buyQuantity: Math.max(1, buyQuantity), price: Math.max(0, price) }
                : i
        ));
    };

    const removeItem = (productId: string) => {
        setItems(prev => prev.filter(i => i.product.id !== productId));
    };

    const subtotal = items.reduce((sum, i) => sum + i.price * i.buyQuantity, 0);

    const handleConfirmPurchase = async () => {
        if (items.length === 0) return;
        setIsSubmitting(true);
        try {
            await processPurchase({
                items: items.map(i => ({
                    ...i.product,
                    buyQuantity: i.buyQuantity,
                    priceType: 'retail' as const,
                    price: i.price, // purchase price as actually entered
                })),
                subtotal,
                total: subtotal,
                supplierId: supplier.id,
            });
            onComplete();
        } catch (error) {
            if (isOfflineGuardError(error)) {
                toast.error((error as Error).message);
            } else {
                console.error(error);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-end z-50">
                <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-4 w-full max-w-2xl h-[85vh] flex flex-col">
                    <div className="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-3">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">فاتورة شراء — {supplier.name}</h2>
                        <button onClick={onClose} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">✕</button>
                    </div>

                    {/* Item search + category filter */}
                    <div className="space-y-2 mb-3">
                        <label htmlFor="purchaseSearch" className="sr-only">ابحث عن منتج</label>
                        <input
                            id="purchaseSearch"
                            type="text"
                            placeholder="ابحث بالاسم أو الكود..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        />
                        <label htmlFor="purchaseCategory" className="sr-only">التصنيف</label>
                        <select
                            id="purchaseCategory"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        >
                            <option value="">كل التصنيفات</option>
                            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                    </div>

                    {/* Catalog quick-add (filtered) */}
                    <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-2">
                        {filteredProducts.map(p => (
                            <button
                                key={p.id}
                                onClick={() => addItem(p)}
                                className="w-full text-right p-2 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm"
                            >
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name} <span className="text-xs text-gray-500">({p.code})</span></span>
                                <span className="text-xs text-gray-600 dark:text-gray-300">المخزون: {p.quantity}</span>
                            </button>
                        ))}
                        {filteredProducts.length === 0 && (
                            <p className="text-center text-gray-600 dark:text-gray-300 text-sm py-6">لم يتم العثور على منتجات.</p>
                        )}
                    </div>

                    {/* Selected purchase items */}
                    {items.length > 0 && (
                        <div className="mt-3 border-t dark:border-gray-700 pt-3 max-h-48 overflow-y-auto space-y-2">
                            {items.map(i => (
                                <div key={i.product.id} className="flex items-center gap-2">
                                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{i.product.name}</span>
                                    <label htmlFor={`pqty-${i.product.id}`} className="sr-only">الكمية</label>
                                    <input
                                        id={`pqty-${i.product.id}`}
                                        type="number"
                                        value={i.buyQuantity}
                                        onChange={(e) => updateItem(i.product.id, parseInt(e.target.value) || 1, i.price)}
                                        className="w-16 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-sm"
                                        min="1"
                                    />
                                    <label htmlFor={`pprice-${i.product.id}`} className="sr-only">سعر الشراء</label>
                                    <input
                                        id={`pprice-${i.product.id}`}
                                        type="number"
                                        value={i.price}
                                        onChange={(e) => updateItem(i.product.id, i.buyQuantity, parseFloat(e.target.value) || 0)}
                                        className="w-20 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-sm"
                                        step="0.01"
                                        min="0"
                                    />
                                    <button
                                        onClick={() => removeItem(i.product.id)}
                                        aria-label={`حذف ${i.product.name}`}
                                        className="text-red-700 dark:text-red-300 hover:text-red-800 p-1.5 text-sm font-bold"
                                    >
                                        حذف
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t dark:border-gray-700 mt-auto -mx-4">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">الإجمالي</span>
                            <span className="text-2xl font-bold text-primary-600 dark:text-primary-300">{subtotal.toFixed(2)} ج.م</span>
                        </div>
                        <button
                            onClick={() => setConfirmationOpen(true)}
                            disabled={items.length === 0}
                            className="w-full py-3 px-4 bg-primary-600 text-white rounded-lg font-bold text-lg shadow-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            تسجيل فاتورة الشراء
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirm purchase */}
            {confirmationOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm">
                        <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-gray-100">تأكيد فاتورة الشراء</h3>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                            إجمالي الفاتورة <span className="font-bold">{subtotal.toFixed(2)} ج.م</span> هيتضاف على مديونية المورد "{supplier.name}" وكميات المخزون هتتحدث. متأكد؟
                        </p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setConfirmationOpen(false)} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded">إلغاء</button>
                            <button
                                onClick={handleConfirmPurchase}
                                disabled={isSubmitting}
                                className="py-2 px-4 bg-primary-600 text-white rounded font-semibold disabled:opacity-50"
                            >
                                {isSubmitting ? '...' : 'تأكيد'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// --- New supplier return modal: direct mirror of PurchaseModal, reversed effects.
// Calls existing processSupplierReturn(items, supplierId) — decreases stock + supplier balance. ---
const SupplierReturnModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    supplier: Supplier;
    onComplete: () => void;
}> = ({ isOpen, onClose, supplier, onComplete }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [items, setItems] = useState<Array<{ product: Product; buyQuantity: number; price: number }>>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmationOpen, setConfirmationOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const productsConstraints = [orderBy('name')];
        const unsubProducts = subscribeToCollection<Product>('products', setProducts, productsConstraints);
        const categoriesConstraints = [orderBy('name')];
        const unsubCategories = subscribeToCollection<Category>('categories', setCategories, categoriesConstraints);
        return () => {
            unsubProducts();
            unsubCategories();
        };
    }, [isOpen]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setItems([]);
            setSearchQuery('');
            setSelectedCategory('');
            setConfirmationOpen(false);
        }
    }, [isOpen]);

    const filteredProducts = products.filter(p => {
        const matchesCategory = !selectedCategory || p.categoryId === selectedCategory;
        const q = searchQuery.trim();
        const matchesSearch = !q || p.name.includes(q) || p.code.includes(q);
        return matchesCategory && matchesSearch;
    });

    const addItem = (product: Product) => {
        setItems(prev => {
            const existing = prev.find(i => i.product.id === product.id);
            if (existing) {
                return prev.map(i => i.product.id === product.id ? { ...i, buyQuantity: i.buyQuantity + 1 } : i);
            }
            return [...prev, { product, buyQuantity: 1, price: product.price }];
        });
    };

    const updateItem = (productId: string, buyQuantity: number, price: number) => {
        setItems(prev => prev.map(i =>
            i.product.id === productId
                ? { ...i, buyQuantity: Math.max(1, buyQuantity), price: Math.max(0, price) }
                : i
        ));
    };

    const removeItem = (productId: string) => {
        setItems(prev => prev.filter(i => i.product.id !== productId));
    };

    const total = items.reduce((sum, i) => sum + i.price * i.buyQuantity, 0);

    const handleConfirmReturn = async () => {
        if (items.length === 0) return;
        setIsSubmitting(true);
        try {
            await processSupplierReturn(
                items.map(i => ({
                    ...i.product,
                    buyQuantity: i.buyQuantity,
                    priceType: 'retail' as const,
                    price: i.price, // return value per unit as actually entered (defaults to recorded price, manually editable)
                })),
                supplier.id
            );
            onComplete();
        } catch (error) {
            if (isOfflineGuardError(error)) {
                toast.error((error as Error).message);
            } else {
                console.error(error);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-end z-50">
                <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-4 w-full max-w-2xl h-[85vh] flex flex-col">
                    <div className="flex justify-between items-center mb-4 border-b dark:border-gray-700 pb-3">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">مرتجع مورد — {supplier.name}</h2>
                        <button onClick={onClose} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">✕</button>
                    </div>

                    {/* Item search + category filter */}
                    <div className="space-y-2 mb-3">
                        <label htmlFor="supplierReturnSearch" className="sr-only">ابحث عن منتج</label>
                        <input
                            id="supplierReturnSearch"
                            type="text"
                            placeholder="ابحث بالاسم أو الكود..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        />
                        <label htmlFor="supplierReturnCategory" className="sr-only">التصنيف</label>
                        <select
                            id="supplierReturnCategory"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        >
                            <option value="">كل التصنيفات</option>
                            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                    </div>

                    {/* Catalog quick-add (filtered) */}
                    <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-2">
                        {filteredProducts.map(p => (
                            <button
                                key={p.id}
                                onClick={() => addItem(p)}
                                className="w-full text-right p-2 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm"
                            >
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name} <span className="text-xs text-gray-500">({p.code})</span></span>
                                <span className="text-xs text-gray-600 dark:text-gray-300">المخزون: {p.quantity}</span>
                            </button>
                        ))}
                        {filteredProducts.length === 0 && (
                            <p className="text-center text-gray-600 dark:text-gray-300 text-sm py-6">لم يتم العثور على منتجات.</p>
                        )}
                    </div>

                    {/* Selected return items */}
                    {items.length > 0 && (
                        <div className="mt-3 border-t dark:border-gray-700 pt-3 max-h-48 overflow-y-auto space-y-2">
                            {items.map(i => (
                                <div key={i.product.id} className="flex items-center gap-2">
                                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{i.product.name}</span>
                                    <label htmlFor={`srqty-${i.product.id}`} className="sr-only">الكمية</label>
                                    <input
                                        id={`srqty-${i.product.id}`}
                                        type="number"
                                        value={i.buyQuantity}
                                        onChange={(e) => updateItem(i.product.id, parseInt(e.target.value) || 1, i.price)}
                                        className="w-16 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-sm"
                                        min="1"
                                    />
                                    <label htmlFor={`srprice-${i.product.id}`} className="sr-only">سعر الوحدة</label>
                                    <input
                                        id={`srprice-${i.product.id}`}
                                        type="number"
                                        value={i.price}
                                        onChange={(e) => updateItem(i.product.id, i.buyQuantity, parseFloat(e.target.value) || 0)}
                                        className="w-20 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded text-center text-sm"
                                        step="0.01"
                                        min="0"
                                    />
                                    <button
                                        onClick={() => removeItem(i.product.id)}
                                        aria-label={`حذف ${i.product.name}`}
                                        className="text-red-700 dark:text-red-300 hover:text-red-800 p-1.5 text-sm font-bold"
                                    >
                                        حذف
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t dark:border-gray-700 mt-auto -mx-4">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">الإجمالي</span>
                            <span className="text-2xl font-bold text-red-600 dark:text-red-300">{total.toFixed(2)} ج.م</span>
                        </div>
                        <button
                            onClick={() => setConfirmationOpen(true)}
                            disabled={items.length === 0}
                            className="w-full py-3 px-4 bg-red-600 text-white rounded-lg font-bold text-lg shadow-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            تسجيل مرتجع المورد
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirm supplier return — direction made explicit to avoid confusion with purchase */}
            {confirmationOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm">
                        <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-gray-100">تأكيد مرتجع المورد</h3>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                            هيقلل مديونيتك للمورد "{supplier.name}" بـ <span className="font-bold">{total.toFixed(2)} ج.م</span>،
                            وهيقلل كمية المخزون للأصناف دي. متأكد؟
                        </p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setConfirmationOpen(false)} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded">إلغاء</button>
                            <button
                                onClick={handleConfirmReturn}
                                disabled={isSubmitting}
                                className="py-2 px-4 bg-red-600 text-white rounded font-semibold disabled:opacity-50"
                            >
                                {isSubmitting ? '...' : 'تأكيد'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
