
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    deleteField,
    doc,
    query,
    where,
    orderBy,
    writeBatch,
    getDoc,
    getDocFromServer,
    Timestamp,
    serverTimestamp,
    setDoc,
    getDocs,
    limit,
    startAfter,
    runTransaction
} from "firebase/firestore";
import type { QueryConstraint, QueryDocumentSnapshot } from "firebase/firestore";
import { getDB, firebaseConfig } from './firebase';
import { initializeApp, deleteApp } from "firebase/app";
import type { Product, Customer, Invoice, CustomerPayment, DailyArchive, CartItem, Return, BackupData, AppSettings, Supplier, SupplierPayment, PurchaseInvoice, SupplierReturn } from '../types';
import { UserRole } from '../types';
import { toast } from 'react-hot-toast';
import {
    createUserWithEmailAndPassword,
    getAuth
} from "firebase/auth";
import { can } from '../utils/permissions';
import { withInFlightGuard } from './inflight';
import { reportError } from './monitoring';

// REQ-ARCH1-0 (ARCH-1 step 0/9): النواة انتقلت حرفيًا إلى services/api/core.ts.
// استيراد محلي لكل ما تبقى من الكود يستخدمه + إعادة تصدير الأسماء العامة الخمسة
// فقط صراحةً (لا export * على core حتى لا تتسرب db/assertCan/runTransactionWithRetry).
import {
    db,
    assertOnline,
    assertCan,
    runTransactionWithRetry,
    getDefinedPrices,
    isPriceAccepted,
    isOfflineGuardError,
} from './api/core';
import type { TxRetryInfo } from './api/core';
export { OfflineGuardError, isOfflineGuardError, assertOnlineCore, deleteDocument } from './api/core';
export type { OnlineDeps, TxRetryInfo } from './api/core';
// REQ-ARCH1-1: وحدة المستخدمين. (deleteDocument انتقلت إلى core.ts بقرار مالك —
// كانت مُسندة خطأً لـproducts وهي مشتركة بين 3 صفحات + deleteUser — وتُعاد صراحةً
// أعلاه لأنها ضمن الـ41 اسمًا العامة.)
export * from './api/users';
// REQ-ARCH1-2: وحدة المنتجات (الدوال الخاصة الأربع تبقى غير مُصدَّرة — لا تسرب).
export * from './api/products';
// REQ-ARCH1-3: وحدة العملاء (CUSTOMERS_PAGE_SIZE تبقى غير مُصدَّرة — لا تسرب).
export * from './api/customers';
// REQ-ARCH1-4: وحدة الموردين (SUPPLIERS_PAGE_SIZE تبقى غير مُصدَّرة — لا تسرب).
export * from './api/suppliers';
// REQ-ARCH1-5: وحدة المشتريات (بلا رموز خاصة — الدالتان عامتان).
export * from './api/purchases';


// (نُقلت إلى services/api/core.ts — REQ-ARCH1-0)

// (نُقلت إلى services/api/users.ts — REQ-ARCH1-1)


// -----------------------

// (نُقلت إلى services/api/products.ts — REQ-ARCH1-2 — تبقى خاصة بالوحدة)

// (نُقلت إلى services/api/users.ts — REQ-ARCH1-1 — تبقى خاصة بالوحدة)

// (نُقلت إلى services/api/customers.ts — REQ-ARCH1-3)

// (نُقلت إلى services/api/suppliers.ts — REQ-ARCH1-4)

// (نُقلت إلى services/api/products.ts — REQ-ARCH1-2)

// (نُقلت إلى services/api/core.ts — REQ-ARCH1-1 بقرار مالك)


// (نُقلت إلى services/api/products.ts — REQ-ARCH1-2)


// (نُقلت إلى services/api/customers.ts — REQ-ARCH1-3)


// (نُقلت إلى services/api/suppliers.ts — REQ-ARCH1-4)

// (نُقلت إلى services/api/products.ts — REQ-ARCH1-2)

// (نُقلت إلى services/api/purchases.ts — REQ-ARCH1-5)

// (نُقلت إلى services/api/purchases.ts — REQ-ARCH1-5)


// (نُقلت إلى services/api/core.ts — REQ-ARCH1-0)

// Invoices API
export const processSale = withInFlightGuard(async (invoiceData: Omit<Invoice, 'id' | 'createdAt' | 'invoiceNumber' | 'customerName'>) => {
    await assertOnline();
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
        if (isOfflineGuardError(error)) throw error;
        console.error("Error processing sale:", error);
        if (error.message.includes('quantity') || error.message.includes('الكمية')) {
            toast.error(error.message);
        } else {
            toast.error('حدث خطأ أثناء عملية البيع.');
        }
        throw error;
    }
});

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
export const processReturn = withInFlightGuard(async (items: CartItem[], dailyArchiveId: string, customer?: { id: string; name: string }, originalInvoiceId?: string, __testOnRetry?: (info: TxRetryInfo) => void) => {
    await assertOnline();
    // تطبيع originalInvoiceId: undefined للتوافق العكسي ولفاتورة نقدية بدون ربط
    const linkedInvoiceId = originalInvoiceId && originalInvoiceId.trim() ? originalInvoiceId.trim() : undefined;

    // BUG-P0-1 (خيار A): قراءة المرتجعات السابقة لنفس الفاتورة قبل بدء الـ transaction
    // — transaction.get() لا يدعم Query في firebase v10 (يقبل DocumentReference فقط).
    // Accepted Risk (قرار مالك 2026-09-13): نافذة سباق نظرية ضيقة بين هذه القراءة
    // وبدء الـ transaction مع عدد كاشيرين محدود — البديل الذري الكامل (TECH-P0-1b)
    // مسجّل في backlog. فشل القراءة يرفض العملية كاملة قبل أي كتابة (BR-2).
    const priorMap = new Map<string, number>();
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
        // E-5: 7 = 1 + 6 إعادات — نطاق محدود على هذا المسار فقط، الافتراضي (4) يبقى للباقي.
        await runTransactionWithRetry('processReturn', async (transaction) => {
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

            // TECH-P0-1b: خريطة التراكم الذري — تُبنى في كتلة الفحص أدناه وتُكتب
            // في PHASE 2. داخل closure المحاولة فيُعاد بناؤها من الصفر مع كل
            // إعادة تشغيل بعد ABORTED — لا تراكم قديم أبدًا.
            let pendingRQ: Record<string, number> | null = null;

            // REQ-DOCNUM-1: قراءة عدّاد المرتجعات (atomic — نفس الـ transaction، ما زلنا في مرحلة القراءات)
            const counterRef = doc(db, 'counters', 'returns');
            const counterDoc = await transaction.get(counterRef);
            const lastNumber = counterDoc.exists() ? (counterDoc.data().lastNumber || 0) : 0;
            const newNumber = lastNumber + 1;
            const generatedReturnNumber = `RET-${String(newNumber).padStart(6, '0')}`;

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
                // TECH-P0-1b: max(الأرضية القديمة priorMap، الحقل الذري) — الموروث
                // بلا حقل يُغطّيه priorMap، والجديد يُغطّيه الحقل.
                pendingRQ = {};
                for (const item of items) {
                    const invItem = (invoiceData.items || []).find((i: CartItem) => i.id === item.id);
                    if (!invItem) {
                        throw new Error(`الصنف ${item.name || item.id} غير موجود في الفاتورة الأصلية`);
                    }
                    const alreadyReturned = Math.max(
                        priorMap.get(item.id) || 0,
                        ((invoiceData.returnedQuantities || {})[item.id]) || 0,
                    );
                    const remaining = (invItem.buyQuantity || 0) - alreadyReturned;
                    if (remaining <= 0) {
                        throw new Error(`الصنف ${item.name} لا يوجد له كمية متبقية للإرجاع في الفاتورة الأصلية`);
                    }
                    if (item.buyQuantity > remaining) {
                        throw new Error(`كمية الإرجاع للصنف ${item.name} (${item.buyQuantity}) تتجاوز المتبقي (${remaining}) في الفاتورة الأصلية`);
                    }
                    pendingRQ[item.id] = alreadyReturned + item.buyQuantity;
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
            // REQ-DOCNUM-1: تحديث عدّاد المرتجعات ذريًا مع باقي الكتابات (commit واحد)
            if (counterDoc.exists()) {
                transaction.update(counterRef, { lastNumber: newNumber });
            } else {
                transaction.set(counterRef, { lastNumber: newNumber });
            }

            const newReturn: Omit<Return, 'id'> = {
                items,
                total: totalReturnAmount,
                returnNumber: generatedReturnNumber,
                createdAt: serverTimestamp() as unknown as number,
                dailyArchiveId,
                ...(customer && { customerId: customer.id, customerName: customer.name }),
                ...(linkedInvoiceId && { originalInvoiceId: linkedInvoiceId }),
            };
            transaction.set(returnRef, newReturn);
            // TECH-P0-1b: كتابة الحقل الذري — التضارب على مستند الفاتورة هو ما
            // يُسلسل الفحص: الخاسر يُجهَض فيعيد الـSDK (ثم الغلاف) التشغيل بقراءة
            // حقل طازجة فيُقبل/يُرفض بشكل صحيح — الرفض plain Error بلا .code
            // فلا إعادة محاولة له (نمط E-4).
            if (linkedInvoiceId && pendingRQ) {
                transaction.update(doc(db, 'invoices', linkedInvoiceId), { returnedQuantities: pendingRQ });
            }

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
        }, 7, __testOnRetry);
        toast.success('تمت عملية الإرجاع بنجاح!');
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error processing return:", error);
        if ((error as any)?._txExhausted === true) {
            // E-5-MON: تسجيل الاستنفاد في clientErrors — fire-and-forget بلا await
            // (فشله لا يغيّر الخطأ ولا الـtoast ولا زمن الرمي). الشكل يلتزم حارس
            // القواعد الحالي (message/source فقط من المفاتيح الستة — بلا مفاتيح جديدة).
            try {
                const errAny = error as any;
                reportError(
                    new Error(`[TX_EXHAUSTED] label=processReturn code=${String(errAny?.code || 'unknown')} attempts=${Number(errAny?._txAttempts || 7)} invoice=${linkedInvoiceId || 'none'} ts=${Date.now()}`),
                    { source: 'processReturn' },
                );
            } catch { /* التسجيل لا يتدخل إطلاقًا */ }
            // BUG-P0-14c: تنافس العدّاد يظهر كـpermission-denied — لا يجوز تضليل
            // كاشير مُعطَّل/ناقص الصلاحيات برسالة "زحمة".
            const code = String((error as any)?.code || '');
            if (code === 'aborted' || code === 'unavailable') {
                toast.error('تعذر الإتمام بسبب زحمة متزامنة على نفس الفاتورة — حاول مجددًا.');
            } else if (code === 'permission-denied') {
                toast.error('تعذر الإتمام — حاول مجددًا، وإن تكرر راجع صلاحياتك.');
            } else {
                toast.error(error.message || 'حدث خطأ أثناء عملية الإرجاع.');
            }
        } else {
            toast.error(error.message || 'حدث خطأ أثناء عملية الإرجاع.');
        }
        throw error;
    }
});


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

export const startNewDailyArchive = withInFlightGuard(async (): Promise<DailyArchive> => {
    await assertOnline();
    // E-4 (REQ-ARCHIVE-1): فحص "يومية مفتوحة" يبقى query خارجيًا إجباريًا —
    // transaction.get() في firebase v10 يقبل DocumentReference فقط (نفس قيد BUG-P0-1
    // الموثق عند processReturn)، فإدخال الـquery داخل الـtransaction سيعيد نفس الفشل.
    // السلامة محفوظة رغم ذلك: المعرّف مشتق من التاريخ، فأي pre-check قديم (stale)
    // يؤدي لمحاولة كتابة نفس today-doc، والفحص الذري داخل الـtransaction يرفضها.
    const openArchive = await getOpenDailyArchive();
    if (openArchive) {
        throw new Error(`لا يمكن بدء يومية جديدة. اليومية ${openArchive.id} ما زالت مفتوحة.`);
    }

    const today = new Date().toISOString().split('T')[0];
    const archiveRef = doc(db, 'dailyArchives', today);

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
    // FIX: spread-override keeps the client-side number for the return value
    // while Firestore gets serverTimestamp() — no unused-var destructure.
    const newArchiveForFirestore = {
        ...newArchiveForClient,
        startTime: serverTimestamp(),
    };

    // E-4: الجزء الحرج (فحص + إنشاء مستند نفس اليوم) داخل transaction واحدة —
    // نداءان متزامنان لنفس today-doc: واحد ينجح والآخر يرى exists() فيُرفض،
    // فلا كتابة فوق كتابة أبدًا. runTransactionWithRetry آمن هنا: خطأ العمل
    // العربي plain Error بلا .code فلا يُعاد إطلاقًا (يُرفض من أول مرة)،
    // والغلاف يحمي فقط من أخطاء SDK العابرة (aborted/unavailable/permission-denied).
    return await runTransactionWithRetry('startNewDailyArchive', async (transaction) => {
        // --- PHASE 1: READ (مرجع مباشر — متوافق مع قيود v10) ---
        const docSnap = await transaction.get(archiveRef);
        if (docSnap.exists()) {
            throw new Error(`يومية ${today} موجودة ومغلقة بالفعل. لا يمكن إعادة فتحها.`);
        }

        // --- PHASE 2: WRITE ---
        transaction.set(archiveRef, newArchiveForFirestore);
        return { id: today, ...newArchiveForClient };
    });
});

export const closeDailyArchive = withInFlightGuard(async (id: string) => {
    await assertOnline();
    const archiveRef = doc(db, 'dailyArchives', id);
    await updateDoc(archiveRef, {
        status: 'closed',
        endTime: serverTimestamp(),
    });
});


// --- Data Management API ---

// Define collections strictly related to business transactions and data.
// Excluding 'users' and 'appSettings' to prevent session loss or configuration reset during bulk operations.
// BUG-P0-15: 'counters' is included — it was previously excluded, so any
// restore wiped invoices but left counters at their live values (or a
// factoryReset wiped counters while invoices were restored with existing
// numbers) → duplicate invoiceNumbers after restore. Counters are tiny
// (4 fixed docs: invoices, purchaseInvoices, returns, supplierReturns) so backup cost is negligible.
// RBAC-2026-09 R2 AC-03: ترتيب حذف fail-fast — المجموعات التي ستصبح owner-only في R5 أولًا، بحيث أي رفض قواعدي يقع في أول دفعة
const BUSINESS_DATA_COLLECTIONS = [
    'dailyArchives',
    'invoices',
    'returns',
    'customerPayments',
    'supplierPayments',
    'purchaseInvoices',
    'supplierReturns',
    'counters',
    'customers',
    'suppliers',
    'products',
    'categories'
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


export const backupData = withInFlightGuard(async (): Promise<BackupData & { schemaVersion: number; appVersion: string; createdAt: string }> => {
    await assertOnline();
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
});

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


export const factoryReset = withInFlightGuard(async () => {
    await assertOnline();
    await assertCan('data.reset');
    // Only reset business data
    for (const collectionName of BUSINESS_DATA_COLLECTIONS) {
        await deleteCollection(collectionName);
    }
});

export const restoreData = withInFlightGuard(async (backupData: any) => {
    await assertOnline();
    // Validate BEFORE any destructive operation
    validateBackupStructure(backupData);
    await assertCan('data.restore');

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
    // REQ-DOCNUM-1: maxNumbered معممة على اسم الحقل (invoiceNumber vs returnNumber).
    const maxNumbered = (items: any[] | undefined, prefix: string, field = 'invoiceNumber'): number => {
        let max = 0;
        for (const item of items || []) {
            const raw = item?.[field];
            const match = typeof raw === 'string' ? raw.match(new RegExp(`^${prefix}-(\\d+)$`)) : null;
            if (match) max = Math.max(max, parseInt(match[1], 10));
        }
        return max;
    };
    if (backupData.schemaVersion === 1) {
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

    // REQ-DOCNUM-1: توفيق عدادَي المرتجعات بلا شرط schemaVersion — دائمًا max(live, derived).
    // السبب: نسخة v2 أُخذت بعد إدخال returnNumber لكن قبل وجود مستندَي counters/returns
    // ستُستعاد بمجموعة counters ناقصة، فأول مرتجع بعدها سيبدأ من RET-000001 رغم وجود
    // مرتجعات مُستعادة أعلى. المبدأ نفسه: لا يتراجع العداد للخلف أبدًا.
    {
        const liveCountersSnap = await getDocs(collection(db, 'counters'));
        const live = new Map(liveCountersSnap.docs.map(d => [d.id, (d.data() as any)?.lastNumber || 0]));
        const targets: Record<string, number> = {
            returns: Math.max(live.get('returns') || 0, maxNumbered(backupData.returns, 'RET', 'returnNumber')),
            supplierReturns: Math.max(live.get('supplierReturns') || 0, maxNumbered(backupData.supplierReturns, 'SRET', 'returnNumber')),
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
});
