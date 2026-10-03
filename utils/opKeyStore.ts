// utils/opKeyStore.ts — REQ-UI-0 (AUDIT-TX-3 UI layer): stable operation-key
// store + submit wrapper. Pure module: NO React, NO firebase imports, safe
// to unit-test without a browser or the emulator (every external seam is
// injected: storage, clock, uuid, timer, getRecordDoc).
//
// Contract (see docs/AUDIT-TX-3-UI-PLAN.md v2):
// - one record per flow at `tx-opkey:<flow>`: {key, identity, createdAt};
// - TTL 20 minutes; sweep removes expired records only;
// - verdicts: (a) in-session key + matching identity → reuse, no settle;
//   (b) session record only + matching identity → getDoc first (exists →
//   needs-decision[restored-same], absent → reuse + adopt); (c) different
//   identity → getDoc(old key) first (exists → needs-decision[changed],
//   absent → silent rotate);
// - lookup failure (reject OR ~5s timeout) in (b)/(c) → aborted/lookup-failed,
//   NO send, NO record clearing (settle re-runs on the next press);
// - key memory drops via forget() (manual cart empty), clear() (success +
//   mismatch), rotate() (replace), or implicitly on drift-without-record.
import {
    fingerprintsEqual,
    OP_KEY_MISMATCH_CODE,
} from '../services/api/opKey';
import type { OpFingerprint } from '../services/api/opKey';

export type TxFlow =
    | 'sale'
    | 'purchase'
    | 'supplierReturn'
    | 'return'
    | 'customerPayment'
    | 'supplierPayment';

export const TX_FLOWS: TxFlow[] = [
    'sale',
    'purchase',
    'supplierReturn',
    'return',
    'customerPayment',
    'supplierPayment',
];

export interface OpIdentity {
    fp: OpFingerprint;
    extra: Record<string, string | null>;
}

export interface OpRecord {
    key: string;
    identity: OpIdentity;
    createdAt: number;
}

export interface KeyValueStorage {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
}

export interface RecordedInfo {
    exists: boolean;
    number?: string;
    amount?: number;
}

export interface FlowMeta {
    collection: string;
    noun: string;
    mismatchTitle: string;
    mismatchBody: string;
}

export const FLOW_META: Record<TxFlow, FlowMeta> = {
    sale: {
        collection: 'invoices',
        noun: 'فاتورة بيع',
        mismatchTitle: 'عملية مسجلة مسبقًا — بيع',
        mismatchBody: 'هذا البيع مسجّل مسبقًا بنفس المحتوى — راجع آخر فاتورة',
    },
    purchase: {
        collection: 'purchaseInvoices',
        noun: 'فاتورة شراء',
        mismatchTitle: 'عملية مسجلة مسبقًا — شراء',
        mismatchBody: 'فاتورة الشراء هذه مسجّلة مسبقًا — راجع آخر فاتورة شراء',
    },
    supplierReturn: {
        collection: 'supplierReturns',
        noun: 'مرتجع مورد',
        mismatchTitle: 'عملية مسجلة مسبقًا — مرتجع مورد',
        mismatchBody: 'مرتجع المورد هذا مسجّل مسبقًا — راجع آخر مرتجع',
    },
    return: {
        collection: 'returns',
        noun: 'مرتجع',
        mismatchTitle: 'عملية مسجلة مسبقًا — مرتجع',
        mismatchBody: 'هذا المرتجع مسجّل مسبقًا — راجع آخر مرتجع',
    },
    customerPayment: {
        collection: 'customerPayments',
        noun: 'دفعة عميل',
        mismatchTitle: 'عملية مسجلة مسبقًا — دفعة عميل',
        mismatchBody: 'هذه الدفعة مسجّلة مسبقًا — راجع آخر دفعة عميل',
    },
    supplierPayment: {
        collection: 'supplierPayments',
        noun: 'دفعة مورد',
        mismatchTitle: 'عملية مسجلة مسبقًا — دفعة مورد',
        mismatchBody: 'هذه الدفعة مسجّلة مسبقًا — راجع آخر دفعة مورد',
    },
};

export type SettleState = 'restored-same' | 'changed' | 'mismatch';

export function settleLabels(flow: TxFlow, state: SettleState): { primary: string; secondary: string } {
    const noun = FLOW_META[flow].noun;
    if (state === 'restored-same') {
        return { primary: `إنهاء — ${noun} مسجّلة`, secondary: 'عملية جديدة' };
    }
    if (state === 'changed') {
        return { primary: 'مراجعة (إبقاء السلة)', secondary: 'عملية جديدة برقم مستقل' };
    }
    return { primary: `مراجعة آخر ${noun}`, secondary: 'إعادة الإرسال كعملية جديدة' };
}

export const OP_KEY_TTL_MS = 20 * 60 * 1000;
export const OP_KEY_LOOKUP_TIMEOUT_MS = 5000;

export const opKeyStorageKey = (flow: TxFlow): string => `tx-opkey:${flow}`;

// Internal signal: a record lookup failed (reject OR timeout). prepare()
// throws it; submitWithOpKey converts it to aborted/lookup-failed.
export class OpKeyLookupFailedError extends Error {
    constructor(flow: TxFlow) {
        super(`opkey record lookup failed for flow=${flow}`);
        this.name = 'OpKeyLookupFailedError';
    }
}

export type Verdict =
    | { kind: 'reuse'; key: string; via: 'memory' | 'restored' }
    | { kind: 'fresh'; key: string; rotated: boolean }
    | { kind: 'needs-decision'; key: string; context: 'restored-same' | 'changed'; recorded: RecordedInfo };

export type SubmitResult =
    | { outcome: 'sent' }
    | { outcome: 'finished-without-send' }
    | { outcome: 'aborted'; reason: 'user' | 'lookup-failed' }
    | { outcome: 'mismatch' };

export type DecideChoice = 'finish' | 'proceed-new' | 'abort';

export interface DecideInfo {
    context: 'restored-same' | 'changed';
    recorded: RecordedInfo;
    flow: TxFlow;
}

// UUID tiers for buildUuid (each optional; first available wins).
export interface UuidTiers {
    randomUUID?: () => string;
    getRandomValues?: (b: Uint8Array) => void;
    random?: () => number;
}

function toUuidString(b: Uint8Array): string {
    const h = (i: number) => b[i].toString(16).padStart(2, '0');
    // Version (b[6]) and variant (b[8]) bits are masked by the caller.
    return (
        `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-` +
        `${h(6)}${h(7)}-${h(8)}${h(9)}-` +
        `${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
    );
}

// Tiered UUID-v4 mint: randomUUID → getRandomValues → Math.random
// (randomUUID is unavailable in old WebViews).
export function buildUuid(tiers: UuidTiers = {}): string {
    if (tiers.randomUUID) {
        try {
            return tiers.randomUUID();
        } catch {
            // fall through to the next tier
        }
    }
    if (tiers.getRandomValues) {
        try {
            const b = new Uint8Array(16);
            tiers.getRandomValues(b);
            b[6] = (b[6] & 0x0f) | 0x40; // version 4
            b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
            return toUuidString(b);
        } catch {
            // fall through to Math.random
        }
    }
    const rand = tiers.random ?? Math.random;
    const b = new Uint8Array(16);
    for (let i = 0; i < 16; i++) b[i] = Math.floor(rand() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return toUuidString(b);
}

export function defaultUuid(): string {
    const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    return buildUuid({
        randomUUID: c?.randomUUID?.bind(c),
        getRandomValues: c?.getRandomValues?.bind(c),
        random: Math.random,
    });
}

export interface Timer {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
}

const defaultTimer: Timer = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

function sessionStorageAdapter(): KeyValueStorage | null {
    try {
        if (typeof globalThis === 'undefined') return null;
        const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
        if (typeof ss === 'undefined' || ss === null) return null;
        return {
            getItem: (k) => {
                try {
                    return ss.getItem(k);
                } catch {
                    return null;
                }
            },
            setItem: (k, v) => {
                try {
                    ss.setItem(k, v);
                } catch {
                    // quota/denied → memory-only mode
                }
            },
            removeItem: (k) => {
                try {
                    ss.removeItem(k);
                } catch {
                    // ignore
                }
            },
        };
    } catch {
        return null;
    }
}

export interface OpKeyStoreDeps {
    storage?: KeyValueStorage | null;
    now?: () => number;
    uuid?: () => string;
    getRecordDoc?: (flow: TxFlow, key: string) => Promise<RecordedInfo>;
    lookupTimeoutMs?: number;
    timer?: Timer;
}

export interface SubmitDeps {
    decide: (info: DecideInfo) => Promise<DecideChoice>;
}

function identitiesEqual(a: OpIdentity, b: OpIdentity): boolean {
    if (!fingerprintsEqual(a.fp, b.fp)) return false;
    const keys = new Set([...Object.keys(a.extra ?? {}), ...Object.keys(b.extra ?? {})]);
    for (const k of keys) {
        if ((a.extra?.[k] ?? null) !== (b.extra?.[k] ?? null)) return false;
    }
    return true;
}

export function createOpKeyStore(deps: OpKeyStoreDeps = {}) {
    // Memory entries carry createdAt like storage records: an expired
    // (>TTL) memory entry counts as ABSENT in prepare/peek (never reuse).
    const memory = new Map<TxFlow, { key: string; identity: OpIdentity; createdAt: number }>();
    const now = deps.now ?? Date.now;
    const uuid = deps.uuid ?? defaultUuid;
    const timer = deps.timer ?? defaultTimer;
    const lookupTimeoutMs = deps.lookupTimeoutMs ?? OP_KEY_LOOKUP_TIMEOUT_MS;
    const getRecordDoc =
        deps.getRecordDoc ??
        (() => Promise.reject(new Error('getRecordDoc not provided')));
    const storage: KeyValueStorage | null =
        deps.storage === undefined ? sessionStorageAdapter() : deps.storage;

    function safeGet(flow: TxFlow): string | null {
        if (!storage) return null;
        try {
            return storage.getItem(opKeyStorageKey(flow));
        } catch {
            return null;
        }
    }

    function safeSet(flow: TxFlow, raw: string): void {
        if (!storage) return;
        try {
            storage.setItem(opKeyStorageKey(flow), raw);
        } catch {
            // memory-only mode
        }
    }

    function safeRemove(flow: TxFlow): void {
        if (!storage) return;
        try {
            storage.removeItem(opKeyStorageKey(flow));
        } catch {
            // ignore
        }
    }

    function readRecord(flow: TxFlow, at?: number): OpRecord | null {
        const raw = safeGet(flow);
        if (raw == null) return null;
        let rec: OpRecord;
        try {
            rec = JSON.parse(raw) as OpRecord;
        } catch {
            safeRemove(flow);
            return null;
        }
        if (
            !rec ||
            typeof rec.key !== 'string' ||
            !rec.identity ||
            !Array.isArray((rec.identity as OpIdentity).fp?.pairs) ||
            typeof rec.createdAt !== 'number'
        ) {
            safeRemove(flow);
            return null;
        }
        if ((at ?? now()) - rec.createdAt > OP_KEY_TTL_MS) {
            safeRemove(flow);
            return null;
        }
        return rec;
    }

    function writeRecord(flow: TxFlow, key: string, identity: OpIdentity): void {
        const at = now();
        memory.set(flow, { key, identity, createdAt: at });
        try {
            safeSet(flow, JSON.stringify({ key, identity, createdAt: at } satisfies OpRecord));
        } catch {
            // memory-only mode
        }
    }

    function lookup(flow: TxFlow, key: string): Promise<RecordedInfo> {
        return new Promise<RecordedInfo>((resolve, reject) => {
            let done = false;
            const t = timer.setTimeout(() => {
                if (done) return;
                done = true;
                reject(new OpKeyLookupFailedError(flow));
            }, lookupTimeoutMs);
            // Deferred via Promise.resolve().then so a SYNCHRONOUS throw
            // inside getRecordDoc also lands here → OpKeyLookupFailedError
            // with the timer cleaned (never a raw leak).
            Promise.resolve()
                .then(() => getRecordDoc(flow, key))
                .then(
                    (info) => {
                        if (done) return;
                        done = true;
                        timer.clearTimeout(t);
                        resolve(info);
                    },
                    () => {
                        if (done) return;
                        done = true;
                        timer.clearTimeout(t);
                        reject(new OpKeyLookupFailedError(flow));
                    },
                );
        });
    }

    function memoryHit(flow: TxFlow, identity: OpIdentity, at?: number): { key: string } | null {
        const mem = memory.get(flow);
        if (!mem) return null;
        if ((at ?? now()) - mem.createdAt > OP_KEY_TTL_MS) {
            memory.delete(flow);
            return null;
        }
        return identitiesEqual(mem.identity, identity) ? { key: mem.key } : null;
    }

    async function prepare(flow: TxFlow, identity: OpIdentity): Promise<Verdict> {
        const hit = memoryHit(flow, identity);
        if (hit) {
            return { kind: 'reuse', key: hit.key, via: 'memory' };
        }
        const rec = readRecord(flow);
        if (!rec) {
            const key = uuid();
            writeRecord(flow, key, identity);
            return { kind: 'fresh', key, rotated: false };
        }
        if (identitiesEqual(rec.identity, identity)) {
            const info = await lookup(flow, rec.key);
            if (info.exists) {
                return { kind: 'needs-decision', key: rec.key, context: 'restored-same', recorded: info };
            }
            memory.set(flow, { key: rec.key, identity: rec.identity, createdAt: now() });
            return { kind: 'reuse', key: rec.key, via: 'restored' };
        }
        const info = await lookup(flow, rec.key);
        if (info.exists) {
            return { kind: 'needs-decision', key: rec.key, context: 'changed', recorded: info };
        }
        const key = uuid();
        writeRecord(flow, key, identity);
        return { kind: 'fresh', key, rotated: true };
    }

    function rotate(flow: TxFlow, identity: OpIdentity): string {
        const key = uuid();
        writeRecord(flow, key, identity);
        return key;
    }

    function clear(flow: TxFlow): void {
        memory.delete(flow);
        safeRemove(flow);
    }

    function forget(flow: TxFlow): void {
        memory.delete(flow);
    }

    function sweep(at?: number): number {
        let removed = 0;
        for (const flow of TX_FLOWS) {
            const had = safeGet(flow) != null;
            readRecord(flow, at);
            if (had && safeGet(flow) == null) removed++;
        }
        return removed;
    }

    function peek(flow: TxFlow): { key: string; identity: OpIdentity } | null {
        const mem = memory.get(flow);
        if (mem) {
            // Expired memory counts as absent (same rule as prepare).
            if (now() - mem.createdAt > OP_KEY_TTL_MS) {
                memory.delete(flow);
            } else {
                return { key: mem.key, identity: mem.identity };
            }
        }
        const rec = readRecord(flow);
        return rec ? { key: rec.key, identity: rec.identity } : null;
    }

    async function submitWithOpKey(
        flow: TxFlow,
        identity: OpIdentity,
        send: (key: string) => Promise<void>,
        opts?: SubmitDeps,
    ): Promise<SubmitResult> {
        let verdict: Verdict;
        try {
            verdict = await prepare(flow, identity);
        } catch (e) {
            // Lookup failure (reject OR timeout) in paths (b)/(c): abort with
            // lookup-failed — NO send, NO record clearing (settle re-runs on
            // the next press).
            if (e instanceof OpKeyLookupFailedError) {
                return { outcome: 'aborted', reason: 'lookup-failed' };
            }
            throw e;
        }
        const run = async (key: string): Promise<SubmitResult> => {
            try {
                await send(key);
            } catch (e) {
                if ((e as { code?: unknown })?.code === OP_KEY_MISMATCH_CODE) {
                    // The key is bound to a DIFFERENT op — drop it at once so
                    // the next press mints fresh. Cart/form untouched (page).
                    clear(flow);
                    return { outcome: 'mismatch' };
                }
                throw e;
            }
            clear(flow);
            return { outcome: 'sent' };
        };
        if (verdict.kind === 'reuse' || verdict.kind === 'fresh') {
            return run(verdict.key);
        }
        if (!opts?.decide) {
            throw new Error('decide is required for needs-decision');
        }
        const choice = await opts.decide({
            context: verdict.context,
            recorded: verdict.recorded,
            flow,
        });
        if (choice === 'abort') return { outcome: 'aborted', reason: 'user' };
        if (choice === 'finish') {
            clear(flow);
            return { outcome: 'finished-without-send' };
        }
        return run(rotate(flow, identity));
    }

    return {
        prepare,
        submitWithOpKey,
        rotate,
        clear,
        forget,
        sweep,
        peek,
    };
}

// Default singleton for app use (memory-only until sessionStorage exists).
export const opKeyStore = createOpKeyStore();
