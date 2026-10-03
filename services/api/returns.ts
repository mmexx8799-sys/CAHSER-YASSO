// services/api/returns.ts — REQ-ARCH1-7 (ARCH-1 step 7/9)
// وحدة المرتجعات (processReturn — فيها منطق E-5/TECH-P0-1b الحساس)، منقولة
// حرفيًا من services/api.ts (نقل بنيوي، صفر تغيير منطقي). بلا رموز خاصة.
import {
    query,
    where,
    getDocs,
    doc,
    collection,
    serverTimestamp,
} from "firebase/firestore";
import type { CartItem, Return, Invoice } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import { reportError } from '../monitoring';
import {
    db,
    assertOnline,
    runTransactionWithRetry,
    getDefinedPrices,
    isPriceAccepted,
    isOfflineGuardError,
} from './core';
import type { TxRetryInfo } from './core';
import {
    docFingerprint,
    fingerprintsEqual,
    assertValidOpKey,
    OpKeyMismatchError,
} from './opKey';

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
export const processReturn = withInFlightGuard(async (items: CartItem[], dailyArchiveId: string, customer?: { id: string; name: string }, originalInvoiceId?: string, __testOnRetry?: (info: TxRetryInfo) => void, opts?: { opKey?: string }) => {
    // TX3 key validation FIRST — pure sync check, before assertOnline() and
    // before the pre-transaction getDocs(returnsQuery) below. Old callers
    // send nothing (undefined → random-id path, unchanged).
    assertValidOpKey(opts?.opKey);
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
        // REQ-TX2-RETURN (AUDIT-TX-2): returnRef hoisted outside the
        // callback so every attempt of one call addresses the SAME doc.
        // REQ-TX3-RETURN (AUDIT-TX-3): with a stable key the id is
        // deterministic across re-presses; without one it stays random.
        const opKey = opts?.opKey;
        const returnRef = opKey
            ? doc(db, 'returns', opKey)
            : doc(collection(db, 'returns'));
        // THE stored-total formula, hoisted VERBATIM from the write path
        // below (was `items.reduce(...)` inside the callback): raw float
        // sum, NO rounding. One value feeds BOTH the request fingerprint
        // and the write — identical expression on identical inputs yields
        // identical doubles, so a legitimate re-press can NEVER
        // false-mismatch (worse than a duplicate). round2 inside
        // buildFingerprint absorbs float repr dust at compare time.
        const totalReturnAmount = items.reduce((sum, item) => sum + item.price * item.buyQuantity, 0);
        // Fingerprint uses the NORMALIZED linkedInvoiceId (trimmed,
        // '' → undefined — same value the write path stores), never the raw
        // param; party = customer?.id ?? null.
        const reqFp = docFingerprint({ items, total: totalReturnAmount, customerId: customer?.id }, 'customerId');

        // E-5: 7 = 1 + 6 إعادات — نطاق محدود على هذا المسار فقط، الافتراضي (4) يبقى للباقي.
        await runTransactionWithRetry('processReturn', async (transaction) => {
            // Idempotency guard (READ phase, before every other read): a
            // retried attempt whose first commit succeeded server-side
            // (response lost) finds its own doc and returns with NO writes.
            // The remaining-quantity check below stays unchanged.
            const existingRet = await transaction.get(returnRef);
            if (existingRet.exists()) {
                // TX3 compare (still READ phase, before the counter read so a
                // mismatch never consumes a number): fingerprint (pairs +
                // total + customerId) PLUS the link fields, each
                // null-normalized on BOTH sides.
                const stored = existingRet.data() as any;
                const docFp = docFingerprint(stored, 'customerId');
                const linksMatch =
                    (stored.originalInvoiceId ?? null) === (linkedInvoiceId ?? null) &&
                    (stored.dailyArchiveId ?? null) === (dailyArchiveId ?? null);
                if (!fingerprintsEqual(reqFp, docFp) || !linksMatch) {
                    throw new OpKeyMismatchError();
                }
                return;
            }

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
        if (error instanceof OpKeyMismatchError) {
            // Shown ONCE with its own Arabic text — never the generic toast.
            toast.error(error.message);
            throw error;
        }
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
