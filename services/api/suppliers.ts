// services/api/suppliers.ts — REQ-ARCH1-4 (ARCH-1 step 4/9)
// وحدة الموردين/المدفوعات، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). SUPPLIERS_PAGE_SIZE تبقى خاصة بالوحدة.
// ملاحظة: سطر getSuppliersPaginated الأول كان على سطر واحد مع الثابتة في
// الأصل (const ... = 50;export const ...) — نُقل كما هو حرفيًا بلا تنسيق.
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    getDocs,
    doc,
    addDoc,
    updateDoc,
    serverTimestamp,
} from "firebase/firestore";
import type { QueryConstraint, QueryDocumentSnapshot } from "firebase/firestore";
import type { Supplier, SupplierPayment } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    runTransactionWithRetry,
    isOfflineGuardError,
} from './core';
import {
    assertValidOpKey,
    docFingerprint,
    fingerprintsEqual,
    OpKeyMismatchError,
} from './opKey';

// REQ-SEC1-2 (AUDIT-SEC-1): profile-only supplier update. Same pattern as
// updateCustomerProfile — {name, phone, address} EXPLICITLY, balance/
// openingBalance (or anything else smuggled in `data`) never reach
// Firestore. Balance changes happen ONLY via processPurchase,
// processSupplierReturn and addSupplierPayment transactions.
export const updateSupplierProfile = withInFlightGuard(async (id: string, data: any): Promise<void> => {
    await assertOnline();
    const { name, phone, address } = data || {};
    if (!name || !String(name).trim()) {
        throw new Error("اسم المورد مطلوب");
    }
    try {
        await updateDoc(doc(db, 'suppliers', id), {
            name: String(name).trim(),
            phone: phone ?? '',
            address: address ?? '',
        });
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error updating supplier profile: ", e);
        throw new Error("Failed to update supplier profile");
    }
});

// Suppliers API - Paginated (mirror of getCustomersPaginated)
const SUPPLIERS_PAGE_SIZE = 50;export const getSuppliersPaginated = async (
    searchTerm: string | null,
    lastVisible: QueryDocumentSnapshot | null
): Promise<{ suppliers: Supplier[], lastDoc: QueryDocumentSnapshot | null }> => {
    try {
        const constraints: QueryConstraint[] = [];
        const hasSearch = searchTerm && searchTerm.trim() !== '';

        if (hasSearch) {
            const normalizedQuery = searchTerm!.trim();
            constraints.push(where('name', '>=', normalizedQuery));
            constraints.push(where('name', '<=', normalizedQuery + '\uf8ff'));
        }

        constraints.push(orderBy('name'));
        constraints.push(limit(SUPPLIERS_PAGE_SIZE));

        if (lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        const q = query(collection(db, 'suppliers'), ...constraints);
        const documentSnapshots = await getDocs(q);

        const suppliers = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
        const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

        return { suppliers, lastDoc };
    } catch (error) {
        console.error("Error fetching paginated suppliers: ", error);
        toast.error("حدث خطأ أثناء تحميل الموردين.");
        return { suppliers: [], lastDoc: null };
    }
};

// Supplier creation — persists openingBalance as a separate immutable historical field (REQ-M8).
// balance starts equal to it; only balance moves afterwards, openingBalance never changes.
export const addSupplier = withInFlightGuard(async (supplierData: Omit<Supplier, 'id' | 'createdAt' | 'openingBalance'>) => {
    await assertOnline();
    try {
        const openingBalance = Number(supplierData.balance) || 0;
        // REQ-SEC1-A1 (AUDIT-SEC-1): runtime allowlist — ONLY these six keys
        // reach Firestore. `id` / smuggled `createdAt` / `openingBalance` /
        // any unknown key in `supplierData` is dropped here. `?? ''` keeps
        // the form contract (phone/address are always strings, never
        // undefined) byte-identical to the old verbatim spread.
        const docRef = await addDoc(collection(db, 'suppliers'), {
            name: supplierData.name,
            phone: supplierData.phone ?? '',
            address: supplierData.address ?? '',
            balance: openingBalance,
            openingBalance, // saved explicitly (0 when left empty) — never touched by any later operation
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error adding supplier:", e);
        throw new Error("Failed to add supplier");
    }
});

// Supplier payment — reduces supplier.balance (we paid, our debt decreased)
export const addSupplierPayment = withInFlightGuard(async (payment: Omit<SupplierPayment, 'id' | 'date'> & { opKey?: string }) => {
    // TX3 key validation FIRST — pure sync check, before the amount check
    // and before assertOnline(). Old callers send no opKey (undefined →
    // random-id path, unchanged).
    assertValidOpKey(payment.opKey);
    // TX3 (AUDIT-TX-3): opKey travels inside the payment object but is NEVER
    // stored — paymentData (without it) is the only thing written.
    const { opKey, ...paymentData } = payment;
    await assertOnline();
    if (!payment.amount || payment.amount <= 0) {
        throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر");
    }
    try {
        const supplierRef = doc(db, "suppliers", payment.supplierId);
        // REQ-TX3-PAYMENTS (AUDIT-TX-3): with a stable key the id is
        // deterministic across re-presses; without one it stays random.
        const paymentRef = opKey
            ? doc(db, "supplierPayments", opKey)
            : doc(collection(db, "supplierPayments"));
        // Payment fingerprint = amount + party (total=amount, no items;
        // `notes` is display-only and stays outside identity).
        const reqFp = docFingerprint({ items: [], total: paymentData.amount, supplierId: paymentData.supplierId }, 'supplierId');

        await runTransactionWithRetry('addSupplierPayment', async (transaction) => {
            const freshSupplierDoc = await transaction.get(supplierRef);
            if (!freshSupplierDoc.exists()) {
                throw new Error("Supplier not found");
            }
            // REQ-TX-1 OPTION A (Q6): idempotency guard — paymentRef is
            // created outside the callback, so a retried attempt whose first
            // commit succeeded server-side (response lost) becomes a no-op
            // instead of deducting the balance a second time.
            const existingPay = await transaction.get(paymentRef);
            if (existingPay.exists()) {
                // TX3 compare directly after the existence guard (read
                // order above unchanged): stored doc vs request. Payment
                // docs store the money value as `amount`, so it is mapped
                // to the fingerprint's `total` slot on the stored side
                // (request side passes total=amount) — same shape both ways.
                const stored = existingPay.data() as any;
                const docFp = docFingerprint({ ...stored, total: stored.amount }, 'supplierId');
                if (!fingerprintsEqual(reqFp, docFp)) {
                    throw new OpKeyMismatchError();
                }
                return;
            }
            const currentBalance = freshSupplierDoc.data().balance;
            const newBalance = currentBalance - payment.amount;
            transaction.update(supplierRef, { balance: newBalance });
            transaction.set(paymentRef, { ...paymentData, date: serverTimestamp() });
        });

        toast.success('تم تسجيل دفعة المورد بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        if (error instanceof OpKeyMismatchError) {
            // Shown ONCE with its own Arabic text — never the generic toast.
            toast.error(error.message);
            throw error;
        }
        console.error("Error adding supplier payment:", error);
        toast.error("حدث خطأ أثناء تسجيل دفعة المورد.");
        throw error;
    }
});
