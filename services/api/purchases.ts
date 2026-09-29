// services/api/purchases.ts — REQ-ARCH1-5 (ARCH-1 step 5/9)
// وحدة المشتريات/مرتجعات الموردين، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). بلا رموز خاصة — الدالتان عامتان.
// ملاحظة: isPurchasePriceDeviated تُستورد من './products' (استيراد دائم،
// لا مؤقت — الزوج مُسند لـproducts في D-A2 نهائيًا).
import {
    doc,
    collection,
    serverTimestamp,
} from "firebase/firestore";
import type { CartItem, PurchaseInvoice, SupplierReturn } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    runTransactionWithRetry,
    isOfflineGuardError,
} from './core';
import { isPurchasePriceDeviated } from './products';

// Purchase invoice — increases product quantities + supplier.balance, records PurchaseInvoice
export const processPurchase = withInFlightGuard(async (purchaseData: {
    items: CartItem[];
    subtotal: number;
    total: number;
    supplierId: string;
    // ملاحظة مقصودة: لا options هنا — التأكيد شأن UI، والتوثيق شأن priceFlagged المحسوب أدناه.
}) => {
    await assertOnline();
    try {
        await runTransactionWithRetry('processPurchase', async (transaction) => {
            const purchaseRef = doc(collection(db, 'purchaseInvoices'));

            // --- PHASE 1: ALL READS FIRST ---
            const supplierRef = doc(db, 'suppliers', purchaseData.supplierId);
            const supplierDoc = await transaction.get(supplierRef);
            if (!supplierDoc.exists()) {
                throw new Error("المورد المحدد غير موجود");
            }
            const supplierName = supplierDoc.data().name;

            const productRefs = purchaseData.items.map(item => doc(db, 'products', item.id));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            // REQ-P0-1b: قراءة عدّاد فواتير الشراء (atomic — نفس الـ transaction)
            const purchaseCounterRef = doc(db, 'counters', 'purchaseInvoices');
            const purchaseCounterDoc = await transaction.get(purchaseCounterRef);
            const lastPurchaseNumber = purchaseCounterDoc.exists() ? (purchaseCounterDoc.data().lastNumber || 0) : 0;
            const newPurchaseNumber = lastPurchaseNumber + 1;
            const purchaseInvoiceNumber = `PUR-${String(newPurchaseNumber).padStart(6, '0')}`;

            // REQ-SEC1-9: تحقق الكمية/السعر/الوجود لأصناف الشراء — نفس أسلوب
            // processSale (قبل أي كتابة، ما زلنا في مرحلة القراءات).
            purchaseData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (!productDoc.exists()) {
                    throw new Error(`منتج غير موجود: ${item.name || item.id}`);
                }
                if (typeof item.buyQuantity !== 'number' || !Number.isFinite(item.buyQuantity) || item.buyQuantity <= 0) {
                    throw new Error(`كمية الشراء غير صالحة للصنف ${item.name || item.id}`);
                }
                if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
                    throw new Error(`سعر الشراء غير صالح للصنف ${item.name || item.id}`);
                }
            });

            if (typeof purchaseData.subtotal !== 'number' || purchaseData.subtotal < 0) {
                throw new Error("الإجمالي الفرعي لفاتورة الشراء لا يمكن أن يكون سالبًا");
            }
            if (typeof purchaseData.total !== 'number' || purchaseData.total < 0) {
                throw new Error("إجمالي فاتورة الشراء لا يمكن أن يكون سالبًا");
            }

            // --- PHASE 2: ALL WRITES ---
            const currentBalance = supplierDoc.data().balance || 0;
            transaction.update(supplierRef, { balance: currentBalance + purchaseData.total });

            // تحديث العدّاد ذريًا مع باقي الكتابات
            if (purchaseCounterDoc.exists()) {
                transaction.update(purchaseCounterRef, { lastNumber: newPurchaseNumber });
            } else {
                transaction.set(purchaseCounterRef, { lastNumber: newPurchaseNumber });
            }

            // PURCHASE-PRICE-REF: مصدر الحقيقة — من القراءات الطازجة داخل نفس الـtransaction.
            const priceFlagged = purchaseData.items.some((item, idx) =>
                isPurchasePriceDeviated(
                    productDocs[idx].exists() ? (productDocs[idx].data() as any).lastPurchasePrice : undefined,
                    item.price,
                )
            );

            const newPurchase: Omit<PurchaseInvoice, 'id'> = {
                invoiceNumber: purchaseInvoiceNumber,
                items: purchaseData.items,
                subtotal: purchaseData.subtotal,
                total: purchaseData.total,
                supplierId: purchaseData.supplierId,
                supplierName,
                priceFlagged,
                createdAt: serverTimestamp() as unknown as number,
            };
            transaction.set(purchaseRef, newPurchase);

            purchaseData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    const newQuantity = currentQuantity + item.buyQuantity;
                    // ذري مع الفاتورة: المخزون + تحديث المرجع لسعر الشراء الحالي.
                    transaction.update(productRefs[idx], { quantity: newQuantity, lastPurchasePrice: item.price });
                }
            });
        });
        toast.success('تم تسجيل فاتورة الشراء بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error processing purchase:", error);
        toast.error(error.message || 'حدث خطأ أثناء تسجيل فاتورة الشراء.');
        throw error;
    }
});

// Supplier return — decreases product quantities + supplier.balance, records SupplierReturn
export const processSupplierReturn = withInFlightGuard(async (items: CartItem[], supplierId: string) => {
    await assertOnline();
    try {
        await runTransactionWithRetry('processSupplierReturn', async (transaction) => {
            const returnRef = doc(collection(db, 'supplierReturns'));

            const totalReturnAmount = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0);

            // --- PHASE 1: ALL READS FIRST ---
            const supplierRef = doc(db, 'suppliers', supplierId);
            const supplierDoc = await transaction.get(supplierRef);
            if (!supplierDoc.exists()) {
                throw new Error("المورد المحدد غير موجود");
            }
            const supplierName = supplierDoc.data().name;

            const productRefs = items.map(item => doc(db, 'products', item.id));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            // REQ-DOCNUM-1: قراءة عدّاد مرتجعات المورد (atomic — نفس الـ transaction، ما زلنا في مرحلة القراءات)
            const counterRef = doc(db, 'counters', 'supplierReturns');
            const counterDoc = await transaction.get(counterRef);
            const lastNumber = counterDoc.exists() ? (counterDoc.data().lastNumber || 0) : 0;
            const newNumber = lastNumber + 1;
            const generatedReturnNumber = `SRET-${String(newNumber).padStart(6, '0')}`;

            // REQ-SEC1-9: تحقق الكمية/السعر/الوجود/المخزون لأصناف مرتجع المورد
            // — قبل أي كتابة (نفس أسلوب processSale/processPurchase).
            items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (!productDoc.exists()) {
                    throw new Error(`منتج غير موجود: ${item.name || item.id}`);
                }
                if (typeof item.buyQuantity !== 'number' || !Number.isFinite(item.buyQuantity) || item.buyQuantity <= 0) {
                    throw new Error(`كمية المرتجع غير صالحة للصنف ${item.name || item.id}`);
                }
                if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
                    throw new Error(`سعر المرتجع غير صالح للصنف ${item.name || item.id}`);
                }
                const currentQuantity = productDoc.data().quantity || 0;
                if (currentQuantity < item.buyQuantity) {
                    throw new Error(`الكمية المتاحة غير كافية لإرجاعها للمورد للصنف ${item.name || item.id}`);
                }
            });

            // --- PHASE 2: ALL WRITES ---
            // REQ-DOCNUM-1: تحديث عدّاد مرتجعات المورد ذريًا مع باقي الكتابات (commit واحد)
            if (counterDoc.exists()) {
                transaction.update(counterRef, { lastNumber: newNumber });
            } else {
                transaction.set(counterRef, { lastNumber: newNumber });
            }

            const currentBalance = supplierDoc.data().balance || 0;
            transaction.update(supplierRef, { balance: currentBalance - totalReturnAmount });

            const newReturn: Omit<SupplierReturn, 'id'> = {
                items,
                total: totalReturnAmount,
                returnNumber: generatedReturnNumber,
                supplierId,
                supplierName,
                createdAt: serverTimestamp() as unknown as number,
            };
            transaction.set(returnRef, newReturn);

            items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    const newQuantity = currentQuantity - item.buyQuantity;
                    transaction.update(productRefs[idx], { quantity: newQuantity });
                }
            });
        });
        toast.success('تم تسجيل مرتجع المورد بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error processing supplier return:", error);
        toast.error(error.message || 'حدث خطأ أثناء تسجيل مرتجع المورد.');
        throw error;
    }
});
