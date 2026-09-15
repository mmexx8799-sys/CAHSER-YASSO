
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    where,
    orderBy,
    writeBatch,
    getDoc,
    Timestamp,
    serverTimestamp,
    setDoc,
    onSnapshot,
    getDocs,
    limit,
    startAfter,
    runTransaction
} from "firebase/firestore";
import type { QueryConstraint, QueryDocumentSnapshot } from "firebase/firestore";
import { getDB, firebaseConfig } from './firebase';
import { initializeApp, deleteApp } from "firebase/app";
import type { Product, Customer, Invoice, CustomerPayment, DailyArchive, Category, CartItem, Return, BackupData, User, AppSettings, UserRole, Supplier, SupplierPayment, PurchaseInvoice, SupplierReturn } from '../types';
import { toast } from 'react-hot-toast';
import {
    createUserWithEmailAndPassword,
    getAuth
} from "firebase/auth";


const db = getDB();

// --- App Settings API ---
const APP_SETTINGS_ID = 'main';

export const updateAppSettings = async (settings: Partial<AppSettings>) => {
    try {
        const docRef = doc(db, 'appSettings', APP_SETTINGS_ID);
        await setDoc(docRef, settings, { merge: true });
        toast.success('تم تحديث إعدادات التطبيق.');
    } catch (error) {
        console.error("Error updating app settings:", error);
        toast.error('فشل تحديث الإعدادات.');
    }
};

// --- User Management ---
export const checkIfUsersExist = async (): Promise<boolean> => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, limit(1));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
};

// FIX: Implement addUser to create a new user account and associated user document in firestore.
export const addUser = async (email: string, password: string, role: UserRole): Promise<void> => {
    // A secondary app is used to create a user without signing out the current admin user.
    const tempApp = initializeApp(firebaseConfig, `secondary-auth-${Date.now()}`);
    const tempAuth = getAuth(tempApp);

    try {
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            role: role,
            disabled: false,
        });
        toast.success("تم إضافة المستخدم بنجاح");
    } catch (error: any) {
        let message = "فشل في إضافة المستخدم.";
        if (error.code === 'auth/email-already-in-use') {
            message = 'هذا البريد الإلكتروني مستخدم بالفعل.';
        } else if (error.code === 'auth/weak-password') {
            message = 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل.';
        }
        toast.error(message);
        throw error;
    } finally {
        await deleteApp(tempApp);
    }
};

// FIX: Implement deleteUser to remove a user's role document from firestore.
export const deleteUser = async (uid: string) => {
    try {
        await deleteDocument('users', uid);
        toast.success("تم حذف دور المستخدم بنجاح.");
    } catch (error) {
        toast.error("فشل حذف دور المستخدم.");
        throw error;
    }
};

export const setUserDisabled = async (uid: string, disabled: boolean) => {
    try {
        await updateDocument('users', uid, { disabled });
        toast.success(disabled ? "تم تعطيل المستخدم بنجاح." : "تم تفعيل المستخدم بنجاح.");
    } catch (error) {
        toast.error("فشل تحديث حالة المستخدم.");
        throw error;
    }
};


// -----------------------

const normalizeArabic = (str: string): string => {
    if (!str) return '';
    return str
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .toLowerCase();
};

// Moved from ProductsPage.tsx (REQ-SEC1-3) to sit next to normalizeArabic:
// builds the prefix tokens for searchableIndex. Single source from now on.
const generatePrefixes = (word: string): string[] => {
    const prefixes: string[] = [];
    for (let i = 2; i <= word.length; i++) {
        prefixes.push(word.slice(0, i));
    }
    return prefixes;
};

const buildSearchableIndex = (name: string, code: string): string[] => {
    const nameTokens = normalizeArabic(name).split(' ').filter(Boolean);
    const codeToken = normalizeArabic(code);
    return [...new Set([
        ...nameTokens.flatMap(t => generatePrefixes(t)),
        ...generatePrefixes(codeToken)
    ])];
};

// Generic function to add a document
export const addDocument = async <T,>(collectionPath: string, data: Omit<T, 'id' | 'createdAt'>): Promise<string> => {
    try {
        const docRef = await addDoc(collection(db, collectionPath), {
            ...data,
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e) {
        console.error("Error adding document: ", e);
        throw new Error("Failed to add document");
    }
};

// Generic function to update a document
export const updateDocument = async (collectionPath: string, id: string, data: any) => {
    try {
        const docRef = doc(db, collectionPath, id);
        await updateDoc(docRef, data);
    } catch (e) {
        console.error("Error updating document: ", e);
        throw new Error("Failed to update document");
    }
};

// REQ-SEC1-1 (AUDIT-SEC-1): profile-only customer update. Destructures
// {name, phone, address} EXPLICITLY — balance/openingBalance/createdAt (or
// anything else smuggled in `data`) never reach Firestore, no matter what
// the caller passes. Balance changes happen ONLY via processSale,
// processReturn and addCustomerPayment transactions.
export const updateCustomerProfile = async (id: string, data: any): Promise<void> => {
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
        console.error("Error updating customer profile: ", e);
        throw new Error("Failed to update customer profile");
    }
};

// REQ-SEC1-2 (AUDIT-SEC-1): profile-only supplier update. Same pattern as
// updateCustomerProfile — {name, phone, address} EXPLICITLY, balance/
// openingBalance (or anything else smuggled in `data`) never reach
// Firestore. Balance changes happen ONLY via processPurchase,
// processSupplierReturn and addSupplierPayment transactions.
export const updateSupplierProfile = async (id: string, data: any): Promise<void> => {
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
        console.error("Error updating supplier profile: ", e);
        throw new Error("Failed to update supplier profile");
    }
};

// REQ-SEC1-3 (AUDIT-SEC-1): validated product upsert with a CLOSED
// whitelist. Only known Product fields are destructured — id, createdAt,
// searchableIndex-from-caller, CartItem extras (buyQuantity/priceType) or
// anything else smuggled in `productData` never reach Firestore.
// searchableIndex is always rebuilt here (single source); createdAt is
// serverTimestamp() on create and preserved on update.
export const saveProduct = async (
    productData: Omit<Product, 'id' | 'createdAt' | 'searchableIndex'> | Product
): Promise<string | void> => {
    const data: any = productData || {};
    const {
        code, name, categoryId, quantity, minQuantity,
        price, retailCashPrice, retailCreditPrice,
        wholesaleCashPrice, wholesaleCreditPrice,
    } = data;

    const text = (v: any, field: string): string => {
        if (v === undefined || v === null || !String(v).trim()) {
            throw new Error(`حقل المنتج مطلوب: ${field}`);
        }
        return String(v).trim();
    };
    const num = (v: any, field: string, required: boolean): number | undefined => {
        if (v === undefined || v === null || v === '') {
            if (required) throw new Error(`حقل المنتج مطلوب: ${field}`);
            return undefined;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
            throw new Error(`قيمة غير صالحة لحقل المنتج: ${field}`);
        }
        return n;
    };

    const clean: any = {
        code: text(code, 'الكود'),
        name: text(name, 'الاسم'),
        categoryId: text(categoryId, 'التصنيف'),
        quantity: num(quantity, 'الكمية', true),
        price: num(price, 'السعر', true),
    };
    const minQ = num(minQuantity, 'الحد الأدنى للمخزون', false);
    if (minQ !== undefined) clean.minQuantity = minQ;
    const priceFields: Record<string, any> = {
        retailCashPrice, retailCreditPrice, wholesaleCashPrice, wholesaleCreditPrice,
    };
    for (const [field, value] of Object.entries(priceFields)) {
        const n = num(value, field, false);
        if (n !== undefined) clean[field] = n;
    }
    clean.searchableIndex = buildSearchableIndex(clean.name, clean.code);

    try {
        if ('id' in data && data.id) {
            await updateDoc(doc(db, 'products', data.id), clean);
            return;
        }
        const docRef = await addDoc(collection(db, 'products'), {
            ...clean,
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e: any) {
        // Re-throw our own validation errors untouched (clear Arabic text);
        // only wrap unexpected Firestore failures.
        if (e?.message && /حقل المنتج|المنتج مطلوب/.test(e.message)) throw e;
        console.error("Error saving product: ", e);
        throw new Error("Failed to save product");
    }
};

// Generic function to delete a document
export const deleteDocument = async (collectionPath: string, id: string) => {
    try {
        await deleteDoc(doc(db, collectionPath, id));
    } catch (e) {
        console.error("Error deleting document: ", e);
        throw new Error("Failed to delete document");
    }
};


// Products API - Paginated
const PRODUCTS_PAGE_SIZE = 30;
export const getProductsPaginated = async (
    filters: { searchQuery?: string; categoryId?: string },
    lastVisible: QueryDocumentSnapshot | null
): Promise<{ products: Product[], lastDoc: QueryDocumentSnapshot | null }> => {
    try {
        const constraints: QueryConstraint[] = [];
        const hasSearch = filters.searchQuery && filters.searchQuery.trim() !== '';
        const hasCategory = !!filters.categoryId;

        if (hasSearch) {
            const normalizedQuery = normalizeArabic(filters.searchQuery!);
            constraints.push(where('searchableIndex', 'array-contains', normalizedQuery));
        }

        if (hasCategory) {
            constraints.push(where('categoryId', '==', filters.categoryId));
        }

        constraints.push(orderBy('name'));
        constraints.push(limit(PRODUCTS_PAGE_SIZE));

        if (lastVisible) {
            constraints.push(startAfter(lastVisible));
        }

        const q = query(collection(db, 'products'), ...constraints);
        const documentSnapshots = await getDocs(q);

        const products = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));

        const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

        return { products, lastDoc };
    } catch (error) {
        console.error("Error fetching paginated products: ", error);
        toast.error("حدث خطأ أثناء تحميل المنتجات.");
        return { products: [], lastDoc: null };
    }
};


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
export const addCustomer = async (customerData: Omit<Customer, 'id' | 'createdAt' | 'openingBalance'>) => {
    try {
        const openingBalance = Number(customerData.balance) || 0;
        const docRef = await addDoc(collection(db, 'customers'), {
            ...customerData,
            balance: openingBalance,
            openingBalance, // saved explicitly (0 when left empty) — never touched by any later operation
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e) {
        console.error("Error adding customer:", e);
        throw new Error("Failed to add customer");
    }
};


// Add payment to customer's balance
export const addCustomerPayment = async (payment: Omit<CustomerPayment, 'id' | 'date'>) => {
    if (!payment.amount || payment.amount <= 0) {
        throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر");
    }
    try {
        const customerRef = doc(db, "customers", payment.customerId);
        const paymentRef = doc(collection(db, "customerPayments"));

        await runTransaction(db, async (transaction) => {
            const freshCustomerDoc = await transaction.get(customerRef);
            if (!freshCustomerDoc.exists()) {
                throw new Error("Customer not found");
            }
            const currentBalance = freshCustomerDoc.data().balance;
            const newBalance = currentBalance - payment.amount;
            transaction.update(customerRef, { balance: newBalance });
            transaction.set(paymentRef, { ...payment, date: serverTimestamp() });
        });

        toast.success('تم تسجيل الدفعة بنجاح!');
    } catch (error: any) {
        console.error("Error adding customer payment:", error);
        toast.error("حدث خطأ أثناء تسجيل الدفعة.");
        throw error;
    }
};


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
export const addSupplier = async (supplierData: Omit<Supplier, 'id' | 'createdAt' | 'openingBalance'>) => {
    try {
        const openingBalance = Number(supplierData.balance) || 0;
        const docRef = await addDoc(collection(db, 'suppliers'), {
            ...supplierData,
            balance: openingBalance,
            openingBalance, // saved explicitly (0 when left empty) — never touched by any later operation
            createdAt: serverTimestamp(),
        });
        return docRef.id;
    } catch (e) {
        console.error("Error adding supplier:", e);
        throw new Error("Failed to add supplier");
    }
};

// Supplier payment — reduces supplier.balance (we paid, our debt decreased)
export const addSupplierPayment = async (payment: Omit<SupplierPayment, 'id' | 'date'>) => {
    if (!payment.amount || payment.amount <= 0) {
        throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر");
    }
    try {
        const supplierRef = doc(db, "suppliers", payment.supplierId);
        const paymentRef = doc(collection(db, "supplierPayments"));

        await runTransaction(db, async (transaction) => {
            const freshSupplierDoc = await transaction.get(supplierRef);
            if (!freshSupplierDoc.exists()) {
                throw new Error("Supplier not found");
            }
            const currentBalance = freshSupplierDoc.data().balance;
            const newBalance = currentBalance - payment.amount;
            transaction.update(supplierRef, { balance: newBalance });
            transaction.set(paymentRef, { ...payment, date: serverTimestamp() });
        });

        toast.success('تم تسجيل دفعة المورد بنجاح!');
    } catch (error: any) {
        console.error("Error adding supplier payment:", error);
        toast.error("حدث خطأ أثناء تسجيل دفعة المورد.");
        throw error;
    }
};

// Purchase invoice — increases product quantities + supplier.balance, records PurchaseInvoice
export const processPurchase = async (purchaseData: {
    items: CartItem[];
    subtotal: number;
    total: number;
    supplierId: string;
}) => {
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

            // --- PHASE 2: ALL WRITES ---
            const currentBalance = supplierDoc.data().balance || 0;
            transaction.update(supplierRef, { balance: currentBalance + purchaseData.total });

            // تحديث العدّاد ذريًا مع باقي الكتابات
            if (purchaseCounterDoc.exists()) {
                transaction.update(purchaseCounterRef, { lastNumber: newPurchaseNumber });
            } else {
                transaction.set(purchaseCounterRef, { lastNumber: newPurchaseNumber });
            }

            const newPurchase: Omit<PurchaseInvoice, 'id'> = {
                invoiceNumber: purchaseInvoiceNumber,
                items: purchaseData.items,
                subtotal: purchaseData.subtotal,
                total: purchaseData.total,
                supplierId: purchaseData.supplierId,
                supplierName,
                createdAt: serverTimestamp() as unknown as number,
            };
            transaction.set(purchaseRef, newPurchase);

            purchaseData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    const newQuantity = currentQuantity + item.buyQuantity;
                    transaction.update(productRefs[idx], { quantity: newQuantity });
                }
            });
        });
        toast.success('تم تسجيل فاتورة الشراء بنجاح!');
    } catch (error: any) {
        console.error("Error processing purchase:", error);
        toast.error(error.message || 'حدث خطأ أثناء تسجيل فاتورة الشراء.');
        throw error;
    }
};

// Supplier return — decreases product quantities + supplier.balance, records SupplierReturn
export const processSupplierReturn = async (items: CartItem[], supplierId: string) => {
    try {
        await runTransaction(db, async (transaction) => {
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

            // --- PHASE 2: ALL WRITES ---
            const currentBalance = supplierDoc.data().balance || 0;
            transaction.update(supplierRef, { balance: currentBalance - totalReturnAmount });

            const newReturn: Omit<SupplierReturn, 'id'> = {
                items,
                total: totalReturnAmount,
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
        console.error("Error processing supplier return:", error);
        toast.error(error.message || 'حدث خطأ أثناء تسجيل مرتجع المورد.');
        throw error;
    }
};


// REQ-P0-3 — helper: الأسعار المعرّفة للمنتج والحد الأدنى للتحقق
function getDefinedPrices(productData: any): number[] {
    const prices: number[] = [];
    if (typeof productData.price === 'number') prices.push(productData.price);
    if (typeof productData.retailCashPrice === 'number') prices.push(productData.retailCashPrice);
    if (typeof productData.retailCreditPrice === 'number') prices.push(productData.retailCreditPrice);
    if (typeof productData.wholesaleCashPrice === 'number') prices.push(productData.wholesaleCashPrice);
    if (typeof productData.wholesaleCreditPrice === 'number') prices.push(productData.wholesaleCreditPrice);
    return prices.filter(v => typeof v === 'number' && !Number.isNaN(v));
}
function isPriceAccepted(submittedPrice: number, productData: any): boolean {
    const defined = getDefinedPrices(productData);
    if (defined.length === 0) return true; // لا يوجد سعر مرجعي — لا يمكن التحقق
    if (defined.includes(submittedPrice)) return true; // (a) مطابق لأحد الأسعار
    const minPrice = Math.min(...defined);
    if (minPrice <= 0) return true;
    return submittedPrice >= 0.5 * minPrice; // (b) ≥ 50% من أقل سعر
}

// BUG-P0-14c: bounded application-level retry around runTransaction.
// The Firestore SDK retries automatically ONLY on retryable codes
// (ABORTED/UNAVAILABLE). When a rule compares resource.data (the counters
// +1 check), the loser of a commit race fails rule evaluation with
// PERMISSION_DENIED — which the SDK never retries, so the sale/purchase
// would be lost permanently. Re-running the whole transaction gets fresh
// reads, so genuine timing contention resolves; genuine denials (disabled
// user, real RBAC rejection) fail every attempt and still surface — only
// ~1s later. Business validation errors (plain Errors without .code,
// thrown before any commit) are never retried.
const RETRYABLE_TX_CODES = ['permission-denied', 'aborted', 'unavailable'];
const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runTransactionWithRetry<T>(label: string, attemptFn: (transaction: any) => Promise<T>, maxAttempts = 4): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await runTransaction(db, attemptFn as any);
        } catch (error: any) {
            lastError = error;
            const retryable = RETRYABLE_TX_CODES.includes(String(error?.code || ''));
            if (!retryable || attempt === maxAttempts) throw error;
            // Jittered backoff 100–400ms to break herd collisions.
            await sleepMs(100 + Math.floor(Math.random() * 300));
        }
    }
    throw lastError;
}

// Invoices API
export const processSale = async (invoiceData: Omit<Invoice, 'id' | 'createdAt' | 'invoiceNumber' | 'customerName'>) => {
    try {
        await runTransactionWithRetry('processSale', async (transaction) => {
            const invoiceRef = doc(collection(db, 'invoices'));

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
        console.error("Error processing sale:", error);
        if (error.message.includes('quantity') || error.message.includes('الكمية')) {
            toast.error(error.message);
        } else {
            toast.error('حدث خطأ أثناء عملية البيع.');
        }
        throw error;
    }
};

// Returns API — REQ-P0-1: يدعم ربط المرتجع بفاتورة أصلية مع فحص الكمية المتبقية
// BUG-P0-1 ROOT CAUSE (للمراجع المستقل — يُحذف هذا السطر مع merge التعليقات):
// النسخة السابقة استدعت (transaction as any).get(returnsQuery) داخل runTransaction،
// وtransaction.get() في firebase v10.14.1 يقبل DocumentReference فقط — تحقق ذلك
// مباشرة في node_modules/@firebase/firestore/dist/index.cjs.js:
// get() → __PRIVATE_validateReference() → lookup([t._key])، وQuery لا يملك _key
// فيصل undefined إلى toName() ويرمي TypeError قبل أي اتصال بالشبكة.
// TEST-REG-P0-1 (tests/processReturn.test.ts) أثبت الانهيار هذا قبل الإصلاح.
// الإصلاح (خيار A، قرار مالك المنتج 2026-09-13): نقل قراءة المرتجعات السابقة
// إلى getDocs() عادية قبل بدء runTransaction — Atomicity خيار B مؤجل كـ TECH-P0-1b.
export const processReturn = async (items: CartItem[], dailyArchiveId: string, customer?: { id: string; name: string }, originalInvoiceId?: string) => {
    // تطبيع originalInvoiceId: undefined للتوافق العكسي ولفاتورة نقدية بدون ربط
    const linkedInvoiceId = originalInvoiceId && originalInvoiceId.trim() ? originalInvoiceId.trim() : undefined;

    // BUG-P0-1 (خيار A): قراءة المرتجعات السابقة لنفس الفاتورة قبل بدء الـ transaction
    // — transaction.get() لا يدعم Query في firebase v10 (يقبل DocumentReference فقط).
    // Accepted Risk (قرار مالك 2026-09-13): نافذة سباق نظرية ضيقة بين هذه القراءة
    // وبدء الـ transaction مع عدد كاشيرين محدود — البديل الذري الكامل (TECH-P0-1b)
    // مسجّل في backlog. فشل القراءة يرفض العملية كاملة قبل أي كتابة (BR-2).
    let priorMap = new Map<string, number>();
    if (linkedInvoiceId) {
        const returnsQuery = query(collection(db, 'returns'), where('originalInvoiceId', '==', linkedInvoiceId));
        const priorReturnsSnap = await getDocs(returnsQuery);
        priorReturnsSnap.docs.forEach((d) => {
            const r = d.data() as Return;
            (r.items || []).forEach((it: CartItem) => {
                priorMap.set(it.id, (priorMap.get(it.id) || 0) + (it.buyQuantity || 0));
            });
        });
    }

    try {
        await runTransaction(db, async (transaction) => {
            const returnRef = doc(collection(db, 'returns'));
            const totalReturnAmount = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0);

            // --- PHASE 1: ALL READS FIRST (Firestore transaction requirement) ---
            const archiveRef = doc(db, 'dailyArchives', dailyArchiveId);
            const archiveDoc = await transaction.get(archiveRef);
            if (!archiveDoc.exists() || archiveDoc.data().status !== 'open') {
                throw new Error("لا يمكن تسجيل عملية بيع على يومية غير مفتوحة");
            }

            const productRefs = items.map(item => doc(db, 'products', item.id));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            let customerDoc: any = null;
            let customerRef: any = null;
            if (customer) {
                customerRef = doc(db, 'customers', customer.id);
                customerDoc = await transaction.get(customerRef);
                if (!customerDoc.exists()) {
                    throw new Error("العميل المحدد لم يعد موجودًا");
                }
            }

            // --- REQ-P0-1: فحص الفاتورة الأصلية والكمية المتبقية (إن وجد ربط) ---
            if (linkedInvoiceId) {
                const invoiceRef = doc(db, 'invoices', linkedInvoiceId);
                const invoiceDoc = await transaction.get(invoiceRef);
                if (!invoiceDoc.exists()) {
                    throw new Error("الفاتورة الأصلية غير موجودة");
                }
                const invoiceData = invoiceDoc.data() as Invoice;
                // لو المرتجع مرتبط بعميل والفاتورة آجلة لعميل آخر → رفض
                if (customer && invoiceData.customerId && invoiceData.customerId !== customer.id) {
                    throw new Error("الفاتورة الأصلية لا تخص نفس العميل");
                }
                // حساب الكميات المرتجعة سابقًا لنفس الفاتورة — محسوب قبل الـ transaction (BUG-P0-1 خيار A)
                // فحص فوري للكمية المتبقية لكل صنف (BR-1: لا يتجاوز المجموع الكمية الأصلية)
                for (const item of items) {
                    const invItem = (invoiceData.items || []).find((i: CartItem) => i.id === item.id);
                    if (!invItem) {
                        throw new Error(`الصنف ${item.name || item.id} غير موجود في الفاتورة الأصلية`);
                    }
                    const alreadyReturned = priorMap.get(item.id) || 0;
                    const remaining = (invItem.buyQuantity || 0) - alreadyReturned;
                    if (remaining <= 0) {
                        throw new Error(`الصنف ${item.name} لا يوجد له كمية متبقية للإرجاع في الفاتورة الأصلية`);
                    }
                    if (item.buyQuantity > remaining) {
                        throw new Error(`كمية الإرجاع للصنف ${item.name} (${item.buyQuantity}) تتجاوز المتبقي (${remaining}) في الفاتورة الأصلية`);
                    }
                }
            }

            // REQ-P0-3: تحقق السعر للمرتجع — نفس قاعدة 50% (السعر مُرسل من العميل بشكل مستقل)
            items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (!productDoc.exists()) return;
                const productData = productDoc.data();
                if (!isPriceAccepted(item.price, productData)) {
                    const defined = getDefinedPrices(productData);
                    const minPrice = defined.length ? Math.min(...defined) : 0;
                    throw new Error(`سعر الصنف ${item.name || item.id} في المرتجع غير مقبول (المرسل: ${item.price}، المسموح: أحد [${defined.join(', ')}] أو ≥ ${(0.5 * minPrice).toFixed(2)})`);
                }
            });

            // --- PHASE 2: ALL WRITES ---
            const newReturn: Omit<Return, 'id'> = {
                items,
                total: totalReturnAmount,
                createdAt: serverTimestamp() as unknown as number,
                dailyArchiveId,
                ...(customer && { customerId: customer.id, customerName: customer.name }),
                ...(linkedInvoiceId && { originalInvoiceId: linkedInvoiceId }),
            };
            transaction.set(returnRef, newReturn);

            items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    const newQuantity = currentQuantity + item.buyQuantity;
                    transaction.update(productRefs[idx], { quantity: newQuantity });
                }
            });

            if (customer && customerRef && customerDoc) {
                const currentBalance = customerDoc.data().balance || 0;
                transaction.update(customerRef, { balance: currentBalance - totalReturnAmount });
            }

            const currentReturns = archiveDoc.data().totalReturns || 0;
            const updates: any = { totalReturns: currentReturns + totalReturnAmount };
            if (customer) {
                updates.totalReturnsOnAccount = (archiveDoc.data().totalReturnsOnAccount || 0) + totalReturnAmount;
            } else {
                updates.totalReturnsCash = (archiveDoc.data().totalReturnsCash || 0) + totalReturnAmount;
            }
            transaction.update(archiveRef, updates);
        });
        toast.success('تمت عملية الإرجاع بنجاح!');
    } catch (error: any) {
        console.error("Error processing return:", error);
        toast.error(error.message || 'حدث خطأ أثناء عملية الإرجاع.');
        throw error;
    }
};


// Daily Archive API
export const getOpenDailyArchive = async (): Promise<DailyArchive | null> => {
    const q = query(collection(db, 'dailyArchives'), where('status', '==', 'open'), limit(1));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        return null;
    }

    const docSnap = querySnapshot.docs[0];
    const data = docSnap.data();
    const startTime = data.startTime instanceof Timestamp ? data.startTime.toMillis() : Date.now();
    return { id: docSnap.id, ...data, startTime } as DailyArchive;
};

export const startNewDailyArchive = async (): Promise<DailyArchive> => {
    const openArchive = await getOpenDailyArchive();
    if (openArchive) {
        throw new Error(`لا يمكن بدء يومية جديدة. اليومية ${openArchive.id} ما زالت مفتوحة.`);
    }

    const today = new Date().toISOString().split('T')[0];
    const archiveRef = doc(db, 'dailyArchives', today);
    const docSnap = await getDoc(archiveRef);

    if (docSnap.exists()) {
        throw new Error(`يومية ${today} موجودة ومغلقة بالفعل. لا يمكن إعادة فتحها.`);
    }

    const newArchiveForClient: Omit<DailyArchive, 'id' | 'endTime'> = {
        startTime: Date.now(),
        status: 'open',
        totalSales: 0,
        totalReturns: 0,
        totalCash: 0,
        totalCredit: 0,
        totalVodafoneCash: 0,
        totalInstapay: 0,
        totalReturnsCash: 0,
        totalReturnsOnAccount: 0,
    };
    // FIX: Destructure to avoid type conflict between client-side number and Firestore FieldValue
    const { startTime, ...rest } = newArchiveForClient;
    const newArchiveForFirestore = {
        ...rest,
        startTime: serverTimestamp(),
    };

    await setDoc(archiveRef, newArchiveForFirestore);
    return { id: today, ...newArchiveForClient };
};

export const closeDailyArchive = async (id: string) => {
    const archiveRef = doc(db, 'dailyArchives', id);
    await updateDoc(archiveRef, {
        status: 'closed',
        endTime: serverTimestamp(),
    });
};


// --- Data Management API ---

// Define collections strictly related to business transactions and data.
// Excluding 'users' and 'appSettings' to prevent session loss or configuration reset during bulk operations.
// BUG-P0-15: 'counters' is included — it was previously excluded, so any
// restore wiped invoices but left counters at their live values (or a
// factoryReset wiped counters while invoices were restored with existing
// numbers) → duplicate invoiceNumbers after restore. Counters are tiny
// (2 fixed docs: invoices, purchaseInvoices) so backup cost is negligible.
const BUSINESS_DATA_COLLECTIONS = [
    'categories',
    'customers',
    'products',
    'dailyArchives',
    'invoices',
    'returns',
    'customerPayments',
    'suppliers',
    'supplierPayments',
    'purchaseInvoices',
    'supplierReturns',
    'counters'
] as const;

// Collections present in schema v1 backups (pre-BUG-P0-15, no 'counters').
const V1_BUSINESS_DATA_COLLECTIONS = [
    'categories',
    'customers',
    'products',
    'dailyArchives',
    'invoices',
    'returns',
    'customerPayments',
    'suppliers',
    'supplierPayments',
    'purchaseInvoices',
    'supplierReturns'
] as const;

export const BACKUP_SCHEMA_VERSION = 2;
export const APP_VERSION = '1.0.0';

function validateBackupStructure(data: any): void {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('ملف النسخة الاحتياطية غير صالح: يجب أن يكون كائن JSON صالح');
    }
    if (data.schemaVersion === undefined || data.schemaVersion === null) {
        throw new Error('ملف النسخة الاحتياطية غير صالح: حقل schemaVersion ناقص — النسخة قديمة جدًا أو غير متوافقة');
    }
    if (data.schemaVersion !== BACKUP_SCHEMA_VERSION && data.schemaVersion !== 1) {
        throw new Error(`إصدار النسخة الاحتياطية غير متوافق: المتوقع ${BACKUP_SCHEMA_VERSION}، الموجود ${data.schemaVersion}`);
    }
    // BUG-P0-15: v1 backups have no 'counters' field — validate against the
    // v1 collection list so old backups remain restorable (counters are then
    // left untouched, see restoreData). v2 backups must include counters.
    const expectedCollections = data.schemaVersion === 1 ? V1_BUSINESS_DATA_COLLECTIONS : BUSINESS_DATA_COLLECTIONS;
    for (const collectionName of expectedCollections) {
        const value = data[collectionName];
        if (value === undefined || value === null) {
            throw new Error(`حقل النسخ الاحتياطي ناقص: ${collectionName} — يجب أن يكون مصفوفة`);
        }
        if (!Array.isArray(value)) {
            throw new Error(`حقل النسخ الاحتياطي نوعه غير صحيح: ${collectionName} — يجب أن يكون مصفوفة (array)، النوع الحالي: ${typeof value}`);
        }
    }
}

const convertTimestampsToMillis = (data: any): any => {
    for (const key in data) {
        if (data[key] instanceof Timestamp) {
            data[key] = data[key].toMillis();
        }
    }
    return data;
}

const convertMillisToTimestamps = (data: any): any => {
    const dateFields = ['createdAt', 'date', 'startTime', 'endTime'];
    for (const key in data) {
        if (dateFields.includes(key) && typeof data[key] === 'number') {
            data[key] = Timestamp.fromMillis(data[key]);
        }
    }
    return data;
}


export const backupData = async (): Promise<BackupData & { schemaVersion: number; appVersion: string; createdAt: string }> => {
    const backup: any = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        appVersion: APP_VERSION,
        createdAt: new Date().toISOString(),
    };

    // Only backup business data
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        const querySnapshot = await getDocs(collection(db, collectionName));
        backup[collectionName] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return { id: doc.id, ...convertTimestampsToMillis(data) };
        });
    }
    return backup as BackupData & { schemaVersion: number; appVersion: string; createdAt: string };
};

const deleteCollection = async (collectionPath: string) => {
    const querySnapshot = await getDocs(collection(db, collectionPath));
    if (querySnapshot.empty) return;

    const CHUNK_SIZE = 450;
    const docs = querySnapshot.docs;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    }
};


export const factoryReset = async () => {
    // Only reset business data
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        await deleteCollection(collectionName);
    }
};

export const restoreData = async (backupData: any) => {
    // Validate BEFORE any destructive operation
    validateBackupStructure(backupData);

    // BUG-P0-15: delete only collections present in the backup. A v1 backup
    // has no 'counters' field, so live counters are not wiped here — they
    // are reconciled in step 3 below (max(live, derived from restored
    // invoices)). A v2 backup includes counters, so they are wiped +
    // restored atomically-per-batch like everything else.
    // NOTE: this intentionally duplicates factoryReset's loop instead of
    // calling it, so factoryReset (full wipe incl. counters) keeps its
    // fresh-start semantics for the standalone button.
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        if (backupData[collectionName] !== undefined) {
            await deleteCollection(collectionName);
        }
    }

    // 2. Restore business data from backup
    const CHUNK_SIZE = 450;
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        const dataToRestore = backupData[collectionName];
        if (dataToRestore && dataToRestore.length > 0) {
            for (let i = 0; i < dataToRestore.length; i += CHUNK_SIZE) {
                const chunk = dataToRestore.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                chunk.forEach((item: any) => {
                    const { id, ...data } = item;
                    const dataWithTimestamps = convertMillisToTimestamps(data);
                    const docRef = doc(db, collectionName, id);
                    batch.set(docRef, dataWithTimestamps);
                });
                await batch.commit();
            }
        }
    }

    // 3. BUG-P0-15: v1 backups carry no counters — derive them from the
    // highest restored invoice/purchase numbers so the next sale can never
    // reuse an existing number. Without this, restoring a v1 backup whose
    // invoices exceed the live counter (e.g. live=10, backup up to
    // INV-000050) would produce INV-000011 next — a real duplicate.
    // Never move a counter backwards: final = max(live, derived).
    if (backupData.schemaVersion === 1) {
        const maxNumbered = (items: any[] | undefined, prefix: string): number => {
            let max = 0;
            for (const item of items || []) {
                const raw = item?.invoiceNumber;
                const match = typeof raw === 'string' ? raw.match(new RegExp(`^${prefix}-(\\d+)$`)) : null;
                if (match) max = Math.max(max, parseInt(match[1], 10));
            }
            return max;
        };
        const liveCountersSnap = await getDocs(collection(db, 'counters'));
        const live = new Map(liveCountersSnap.docs.map(d => [d.id, (d.data() as any)?.lastNumber || 0]));
        const targets: Record<string, number> = {
            invoices: Math.max(live.get('invoices') || 0, maxNumbered(backupData.invoices, 'INV')),
            purchaseInvoices: Math.max(live.get('purchaseInvoices') || 0, maxNumbered(backupData.purchaseInvoices, 'PUR')),
        };
        const counterBatch = writeBatch(db);
        let hasCounterWrites = false;
        for (const [counterId, lastNumber] of Object.entries(targets)) {
            if (lastNumber > 0 && lastNumber !== (live.get(counterId) || 0)) {
                counterBatch.set(doc(db, 'counters', counterId), { lastNumber });
                hasCounterWrites = true;
            }
        }
        if (hasCounterWrites) await counterBatch.commit();
    }
};
