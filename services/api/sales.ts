// services/api/sales.ts — REQ-ARCH1-6 (ARCH-1 step 6/9)
// وحدة المبيعات (processSale)، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). بلا رموز خاصة — الدالة عامة.
import {
    doc,
    collection,
    serverTimestamp,
} from "firebase/firestore";
import type { Invoice, DailyArchive } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    runTransactionWithRetry,
    getDefinedPrices,
    isPriceAccepted,
    isOfflineGuardError,
} from './core';
import {
    assertValidOpKey,
    docFingerprint,
    fingerprintsEqual,
    OpKeyMismatchError,
} from './opKey';

// Invoices API
export const processSale = withInFlightGuard(async (invoiceData: Omit<Invoice, 'id' | 'createdAt' | 'invoiceNumber' | 'customerName'>, opts?: { opKey?: string }) => {
    // TX3 key validation FIRST — pure sync check, before any Firestore contact
    // (assertOnline's preflight ping included). Old callers send nothing.
    assertValidOpKey(opts?.opKey);
    await assertOnline();
    try {
        // REQ-TX2-SALE (AUDIT-TX-2): invoiceRef hoisted outside the callback
        // so every attempt of one call addresses the SAME doc.
        // REQ-TX3-SALE (AUDIT-TX-3): with a stable key the id is deterministic
        // across re-presses; without one it stays random per call (unchanged).
        const opKey = opts?.opKey;
        const invoiceRef = opKey
            ? doc(db, 'invoices', opKey)
            : doc(collection(db, 'invoices'));
        const reqFp = docFingerprint(invoiceData, 'customerId');

        await runTransactionWithRetry('processSale', async (transaction) => {
            // Idempotency guard (READ phase): a retried attempt whose first
            // commit succeeded server-side (response lost) finds its own doc
            // and returns with NO writes — same value shape as the return below.
            const existingInv = await transaction.get(invoiceRef);
            if (existingInv.exists()) {
                // TX3 compare (still READ phase, before the counter read so a
                // mismatch never consumes a number): stored doc vs request.
                const stored = existingInv.data() as any;
                const docFp = docFingerprint(stored, 'customerId');
                if (!fingerprintsEqual(reqFp, docFp) || (stored.paymentMethod ?? null) !== (invoiceData.paymentMethod ?? null)) {
                    throw new OpKeyMismatchError();
                }
                return invoiceRef.id;
            }

            // --- PHASE 1: ALL READS FIRST (Firestore transaction requirement) ---
            const customerRef = (invoiceData.paymentMethod === 'آجل' && invoiceData.customerId)
                ? doc(db, 'customers', invoiceData.customerId)
                : null;
            const customerDoc = customerRef ? await transaction.get(customerRef) : null;

            const archiveRef = doc(db, 'dailyArchives', invoiceData.dailyArchiveId);
            const archiveDoc = await transaction.get(archiveRef);
            if (!archiveDoc.exists() || archiveDoc.data().status !== 'open') {
                throw new Error("لا يمكن تسجيل عملية بيع على يومية غير مفتوحة");
            }

            const productRefs = invoiceData.items.map(item => doc(db, 'products', item.id));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            // REQ-P0-1b: قراءة عدّاد الفواتير (atomic — نفس الـ transaction، ما زلنا في مرحلة القراءات)
            const counterRef = doc(db, 'counters', 'invoices');
            const counterDoc = await transaction.get(counterRef);
            const lastNumber = counterDoc.exists() ? (counterDoc.data().lastNumber || 0) : 0;
            const newNumber = lastNumber + 1;
            const generatedInvoiceNumber = `INV-${String(newNumber).padStart(6, '0')}`;

            // --- VALIDATION (still before any writes) ---
            invoiceData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (!productDoc.exists()) {
                    throw new Error(`منتج غير موجود: ${item.name || item.id}`);
                }
                const currentQuantity = productDoc.data().quantity || 0;
                if (currentQuantity < item.buyQuantity) {
                    throw new Error(`الكمية غير كافية للمنتج ${item.id}`);
                }
            });

            // REQ-P0-3: تحقق السعر المرسل مقابل الأسعار المعرّفة — يرفض التلاعب قبل أي كتابة (نفس مرحلة القراءات)
            invoiceData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (!productDoc.exists()) return;
                const productData = productDoc.data();
                if (!isPriceAccepted(item.price, productData)) {
                    const defined = getDefinedPrices(productData);
                    const minPrice = defined.length ? Math.min(...defined) : 0;
                    throw new Error(`سعر الصنف ${item.name || item.id} غير مقبول (المرسل: ${item.price}، المسموح: أحد [${defined.join(', ')}] أو ≥ ${(0.5 * minPrice).toFixed(2)} — 50% من أقل سعر)`);
                }
            });

            if (invoiceData.subtotal < 0) {
                throw new Error("الإجمالي الفرعي لا يمكن أن يكون سالبًا");
            }
            if ((invoiceData.discount || 0) > (invoiceData.subtotal || 0)) {
                throw new Error("الخصم لا يمكن أن يكون أكبر من الإجمالي الفرعي");
            }
            if (invoiceData.total < 0) {
                throw new Error("المبلغ النهائي لا يمكن أن يكون سالبًا");
            }

            // --- PHASE 2: ALL WRITES ---
            // تحديث العدّاد ذريًا مع باقي الكتابات (commit واحد)
            if (counterDoc.exists()) {
                transaction.update(counterRef, { lastNumber: newNumber });
            } else {
                transaction.set(counterRef, { lastNumber: newNumber });
            }

            let customerName: string | undefined = undefined;
            if (customerRef && customerDoc && customerDoc.exists()) {
                const customerData = customerDoc.data();
                customerName = customerData.name;
                const currentBalance = customerData.balance;
                transaction.update(customerRef, { balance: currentBalance + invoiceData.total });
            }

            const newInvoice = {
                ...invoiceData,
                ...(customerName && { customerName }),
                invoiceNumber: generatedInvoiceNumber,
                createdAt: serverTimestamp()
            };
            transaction.set(invoiceRef, newInvoice);

            if (archiveDoc.exists()) {
                const data = archiveDoc.data();
                const updates: Partial<DailyArchive> = { totalSales: (data.totalSales || 0) + invoiceData.total };
                switch (invoiceData.paymentMethod) {
                    case 'نقدا': updates.totalCash = (data.totalCash || 0) + invoiceData.total; break;
                    case 'آجل': updates.totalCredit = (data.totalCredit || 0) + invoiceData.total; break;
                    case 'فودافون كاش': updates.totalVodafoneCash = (data.totalVodafoneCash || 0) + invoiceData.total; break;
                    case 'انستا باي': updates.totalInstapay = (data.totalInstapay || 0) + invoiceData.total; break;
                }
                transaction.update(archiveRef, updates);
            }

            invoiceData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    const newQuantity = currentQuantity - item.buyQuantity;
                    transaction.update(productRefs[idx], { quantity: newQuantity });
                }
            });

            return invoiceRef.id;
        });
        toast.success('تمت عملية البيع بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        if (error instanceof OpKeyMismatchError) {
            // Shown ONCE with its own Arabic text — never the generic toast.
            toast.error(error.message);
            throw error;
        }
        console.error("Error processing sale:", error);
        if (error.message.includes('quantity') || error.message.includes('الكمية')) {
            toast.error(error.message);
        } else {
            toast.error('حدث خطأ أثناء عملية البيع.');
        }
        throw error;
    }
});
