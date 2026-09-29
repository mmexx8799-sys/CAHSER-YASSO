// services/api/archives.ts — REQ-ARCH1-8 (ARCH-1 step 8/9)
// وحدة اليوميات (الأرشفة اليومية — فيها منطق E-4 الحساس)، منقولة حرفيًا
// من services/api.ts (نقل بنيوي، صفر تغيير منطقي). بلا رموز خاصة.
import {
    query,
    collection,
    where,
    limit,
    getDocs,
    doc,
    serverTimestamp,
    updateDoc,
    Timestamp,
} from "firebase/firestore";
import type { DailyArchive } from '../../types';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    runTransactionWithRetry,
} from './core';

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
