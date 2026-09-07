
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
import type { Product, Customer, Invoice, CustomerPayment, DailyArchive, Category, CartItem, Return, BackupData, User, AppSettings, UserRole } from '../types';
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


// Add payment to customer's balance
export const addCustomerPayment = async (payment: Omit<CustomerPayment, 'id' | 'date'>) => {
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


// Invoices API
export const processSale = async (invoiceData: Omit<Invoice, 'id' | 'createdAt' | 'invoiceNumber' | 'customerName'>) => {
    try {
        await runTransaction(db, async (transaction) => {
            const invoiceRef = doc(collection(db, 'invoices'));

            // --- PHASE 1: ALL READS FIRST (Firestore transaction requirement) ---
            const customerRef = (invoiceData.paymentMethod === 'آجل' && invoiceData.customerId)
                ? doc(db, 'customers', invoiceData.customerId)
                : null;
            const customerDoc = customerRef ? await transaction.get(customerRef) : null;

            const archiveRef = doc(db, 'dailyArchives', invoiceData.dailyArchiveId);
            const archiveDoc = await transaction.get(archiveRef);

            const productRefs = invoiceData.items.map(item => doc(db, 'products', item.id));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            // --- VALIDATION (still before any writes) ---
            invoiceData.items.forEach((item, idx) => {
                const productDoc = productDocs[idx];
                if (productDoc.exists()) {
                    const currentQuantity = productDoc.data().quantity || 0;
                    if (currentQuantity < item.buyQuantity) {
                        throw new Error(`الكمية غير كافية للمنتج ${item.id}`);
                    }
                }
            });

            // --- PHASE 2: ALL WRITES ---
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
                invoiceNumber: `INV-${Date.now()}`,
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

// Returns API
export const processReturn = async (items: CartItem[], dailyArchiveId: string, customer?: { id: string; name: string }) => {
    try {
        await runTransaction(db, async (transaction) => {
            const returnRef = doc(collection(db, 'returns'));
            const totalReturnAmount = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0);

            // --- PHASE 1: ALL READS FIRST (Firestore transaction requirement) ---
            const archiveRef = doc(db, 'dailyArchives', dailyArchiveId);
            const archiveDoc = await transaction.get(archiveRef);
            if (!archiveDoc.exists()) {
                throw new Error("لم يتم العثور على اليومية المفتوحة.");
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

            // --- PHASE 2: ALL WRITES ---
            const newReturn: Omit<Return, 'id'> = {
                items,
                total: totalReturnAmount,
                createdAt: serverTimestamp() as unknown as number,
                dailyArchiveId,
                ...(customer && { customerId: customer.id, customerName: customer.name }),
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
const BUSINESS_DATA_COLLECTIONS = [
    'categories',
    'customers',
    'products',
    'dailyArchives',
    'invoices',
    'returns',
    'customerPayments'
];

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


export const backupData = async (): Promise<BackupData> => {
    const backup: Partial<BackupData> = {};

    // Only backup business data
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        const querySnapshot = await getDocs(collection(db, collectionName));
        // @ts-ignore
        backup[collectionName] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return { id: doc.id, ...convertTimestampsToMillis(data) };
        });
    }
    return backup as BackupData;
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

export const restoreData = async (backupData: BackupData) => {
    // 1. Clean existing business data
    await factoryReset();

    // 2. Restore business data from backup
    const CHUNK_SIZE = 450;
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        // @ts-ignore
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
};
