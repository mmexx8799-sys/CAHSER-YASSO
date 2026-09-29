// services/api/backup.ts — REQ-ARCH1-9 (ARCH-1 step 9/9)
// وحدة النسخ الاحتياطي/الاستعادة/التصفير، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). الثوابت والدوال المساعدة تبقى خاصة بالوحدة.
import {
    collection,
    doc,
    getDocs,
    writeBatch,
    Timestamp,
} from "firebase/firestore";
import type { BackupData } from '../../types';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    assertCan,
} from './core';

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
