// utils/opKeyRecordDoc.ts — REQ-UI-0: production getRecordDoc adapter for the
// opKeyStore settle lookups. Kept OUT of utils/opKeyStore.ts so the store
// stays firebase-free (unit-testable without the emulator).
// Pages inject this as `getRecordDoc` in store deps.
import { doc, getDoc } from 'firebase/firestore';
import { getDB } from '../services/firebase';
import { FLOW_META } from './opKeyStore';
import type { TxFlow, RecordedInfo } from './opKeyStore';

export async function firebaseRecordDoc(flow: TxFlow, key: string): Promise<RecordedInfo> {
    const snap = await getDoc(doc(getDB(), FLOW_META[flow].collection, key));
    if (!snap.exists()) return { exists: false };
    const d = snap.data() as {
        invoiceNumber?: unknown;
        returnNumber?: unknown;
        amount?: unknown;
    };
    const number =
        typeof d.invoiceNumber === 'string'
            ? d.invoiceNumber
            : typeof d.returnNumber === 'string'
              ? d.returnNumber
              : undefined;
    return {
        exists: true,
        ...(number !== undefined ? { number } : {}),
        ...(typeof d.amount === 'number' ? { amount: d.amount } : {}),
    };
}
