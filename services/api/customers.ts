// services/api/customers.ts — REQ-ARCH1-3 (ARCH-1 step 3/9)
// وحدة العملاء/المدفوعات، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). CUSTOMERS_PAGE_SIZE تبقى خاصة بالوحدة.
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
import type { Customer, CustomerPayment } from '../../types';
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

// REQ-SEC1-1 (AUDIT-SEC-1): profile-only customer update. Destructures
// {name, phone, address} EXPLICITLY — balance/openingBalance/createdAt (or
// anything else smuggled in `data`) never reach Firestore, no matter what
// the caller passes. Balance changes happen ONLY via processSale,
// processReturn and addCustomerPayment transactions.
export const updateCustomerProfile = withInFlightGuard(async (id: string, data: any): Promise<void> => {
    await assertOnline();
    const { name, phone, address } = data || {};
    if (!name || !String(name).trim()) {
        throw new Error("اسم العميل مطلوب");
    }
    try {
        await updateDoc(doc(db, 'customers', id), {
            name: String(name).trim(),
            phone: phone ?? '',
            address: address ?? '',
        });
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error updating customer profile: ", e);
        throw new Error("Failed to update customer profile");
    }
});

// Customers API - Paginated
const CUSTOMERS_PAGE_SIZE = 50;
export const getCustomersPaginated = async (
    searchTerm: string | null,
    lastVisible: QueryDocumentSnapshot | null
): Promise<{ customers: Customer[], lastDoc: QueryDocumentSnapshot | null }> => {
    try {
        const constraints: QueryConstraint[] = [];
        const hasSearch = searchTerm && searchTerm.trim() !== '';

        if (hasSearch) {
            const normalizedQuery = searchTerm!.trim();
            constraints.push(where('name', '>=', normalizedQuery));
            constraints.push(where('name', '<=', normalizedQuery + '\uf8ff'));
        }

        constraints.push(orderBy('name'));
        constraints.push(limit(CUSTOMERS_PAGE_SIZE));

        if (lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        const q = query(collection(db, 'customers'), ...constraints);
        const documentSnapshots = await getDocs(q);

        const customers = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
        const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

        return { customers, lastDoc };
    } catch (error) {
        console.error("Error fetching paginated customers: ", error);
        toast.error("حدث خطأ أثناء تحميل العملاء.");
        return { customers: [], lastDoc: null };
    }
};


// Customer creation — persists openingBalance as a separate immutable historical field (REQ-M8).
// balance starts equal to it; only balance moves afterwards, openingBalance never changes.
export const addCustomer = withInFlightGuard(async (customerData: Omit<Customer, 'id' | 'createdAt' | 'openingBalance'>) => {
    await assertOnline();
    try {
        const openingBalance = Number(customerData.balance) || 0;
        // REQ-SEC1-A1 (AUDIT-SEC-1): runtime allowlist — ONLY these six keys
        // reach Firestore. `id` / smuggled `createdAt` / `openingBalance` /
        // any unknown key in `customerData` is dropped here. `?? ''` keeps
        // the form contract (phone/address are always strings, never
        // undefined) byte-identical to the old verbatim spread.
        const docRef = await addDoc(collection(db, 'customers'), {
            name: customerData.name,
            phone: customerData.phone ?? '',
            address: customerData.address ?? '',
            balance: openingBalance,
            openingBalance, // saved explicitly (0 when left empty) — never touched by any later operation
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error adding customer:", e);
        throw new Error("Failed to add customer");
    }
});


// Add payment to customer's balance
export const addCustomerPayment = withInFlightGuard(async (payment: Omit<CustomerPayment, 'id' | 'date'> & { opKey?: string }) => {
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
        const customerRef = doc(db, "customers", payment.customerId);
        // REQ-TX3-PAYMENTS (AUDIT-TX-3): with a stable key the id is
        // deterministic across re-presses; without one it stays random.
        const paymentRef = opKey
            ? doc(db, "customerPayments", opKey)
            : doc(collection(db, "customerPayments"));
        // Payment fingerprint = amount + party (total=amount, no items;
        // `notes` is display-only and stays outside identity).
        const reqFp = docFingerprint({ items: [], total: paymentData.amount, customerId: paymentData.customerId }, 'customerId');

        await runTransactionWithRetry('addCustomerPayment', async (transaction) => {
            const freshCustomerDoc = await transaction.get(customerRef);
            if (!freshCustomerDoc.exists()) {
                throw new Error("Customer not found");
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
                const docFp = docFingerprint({ ...stored, total: stored.amount }, 'customerId');
                if (!fingerprintsEqual(reqFp, docFp)) {
                    throw new OpKeyMismatchError();
                }
                return;
            }
            const currentBalance = freshCustomerDoc.data().balance;
            const newBalance = currentBalance - payment.amount;
            transaction.update(customerRef, { balance: newBalance });
            transaction.set(paymentRef, { ...paymentData, date: serverTimestamp() });
        });

        toast.success('تم تسجيل الدفعة بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        if (error instanceof OpKeyMismatchError) {
            // Shown ONCE with its own Arabic text — never the generic toast.
            toast.error(error.message);
            throw error;
        }
        console.error("Error adding customer payment:", error);
        toast.error("حدث خطأ أثناء تسجيل الدفعة.");
        throw error;
    }
});
