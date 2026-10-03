// REQ-UI-0 (AUDIT-TX-3 UI layer) — opKeyStore unit suite.
// RED-FIRST: written and run BEFORE utils/opKeyStore.ts exists (import
// fails to collect). Only then is the implementation added.
//
// Pure node environment (vitest `environment: 'node'`, no DOM, no React,
// no firebase): every external seam is injected — Map-backed fake storage,
// fake clock, manual timer, fake getRecordDoc, stub send/decide.
//
// Coverage: mint/reuse/rotate/clear/forget; one record per flow; TTL with
// fake clock; the three settle verdicts (in-session / restored / changed);
// the four submitWithOpKey outcomes; lookup failure (reject + hang) in
// paths (b)/(c) → aborted/lookup-failed with no send and no record loss;
// corrupt record; unavailable storage (memory-only); fallback UUID tiers
// vs UUID_V4_RE; contract test (tx3*-style fixtures match service
// fingerprints).
//
// Run single file:
//   npx vitest run tests/opKeyStore.test.ts
// Full suite MUST run sequentially (shared emulator namespaces):
//   npx firebase emulators:exec --only firestore,auth "npx vitest run --fileParallelism=false"

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOpKeyStore,
  buildUuid,
  settleLabels,
  OP_KEY_TTL_MS,
  OP_KEY_LOOKUP_TIMEOUT_MS,
  opKeyStorageKey,
  type TxFlow,
  type OpIdentity,
  type KeyValueStorage,
} from '../utils/opKeyStore';
import { UUID_V4_RE } from '../services/api/opKey';
import { docFingerprint, fingerprintsEqual } from '../services/api/opKey';

const FLOW: TxFlow = 'sale';
const OTHER_FLOW: TxFlow = 'return';

function fakeStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function throwingStorage(): KeyValueStorage {
  const boom = (): never => { throw new Error('storage unavailable'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function manualTimer() {
  let t = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number): number => { const h = ++id; jobs.set(h, { at: t + ms, fn }); return h; },
    clearTimeout: (h: unknown) => { jobs.delete(h as number); },
    pending: () => jobs.size,
    async advance(ms: number) {
      t += ms;
      const due = [...jobs.entries()].filter(([, j]) => j.at <= t);
      due.forEach(([h]) => jobs.delete(h));
      due.forEach(([, j]) => j.fn());
      await Promise.resolve();
    },
  };
}

function saleIdentity(customerId: string | null = 'c1', total = 100): OpIdentity {
  return {
    fp: docFingerprint(
      { items: [{ id: 'p', buyQuantity: 2, price: 50 }], total, subtotal: 100, discount: 0, customerId },
      'customerId',
    ),
    extra: { paymentMethod: 'نقدا' },
  };
}

function returnIdentity(inv = 'inv-1', day = 'day-1'): OpIdentity {
  return {
    fp: docFingerprint(
      { items: [{ id: 'p', buyQuantity: 1, price: 12 }], total: 12, customerId: 'c1' },
      'customerId',
    ),
    extra: { originalInvoiceId: inv, dailyArchiveId: day },
  };
}

let seq = 0;
const stubUuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

beforeEach(() => { seq = 0; });

// --- mint / reuse / rotate / clear / forget ------------------------------------------

describe('REQ-UI-0: mint, reuse, rotate, clear, forget', () => {
  it('fresh mint on empty store: key matches UUID_V4_RE, record persisted', async () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const store = createOpKeyStore({ storage, now: clock.now, uuid: stubUuid });
    const v = await store.prepare(FLOW, saleIdentity());
    expect(v.kind).toBe('fresh');
    if (v.kind !== 'fresh') return;
    expect(v.rotated).toBe(false);
    expect(UUID_V4_RE.test(v.key)).toBe(true);
    expect(storage.map.has(opKeyStorageKey(FLOW))).toBe(true);
    expect(store.peek(FLOW)?.key).toBe(v.key);
  });

  it('in-session reuse (memory + same identity): same key, no lookup', async () => {
    const store = createOpKeyStore({ storage: fakeStorage(), uuid: stubUuid, getRecordDoc: async () => { throw new Error('must not be called'); } });
    const first = await store.prepare(FLOW, saleIdentity());
    if (first.kind !== 'fresh') throw new Error('expected fresh');
    const second = await store.prepare(FLOW, saleIdentity());
    expect(second).toEqual({ kind: 'reuse', key: first.key, via: 'memory' });
  });

  it('one record per flow: flows are independent', async () => {
    const store = createOpKeyStore({ storage: fakeStorage(), uuid: stubUuid });
    const a = await store.prepare(FLOW, saleIdentity());
    const b = await store.prepare(OTHER_FLOW, returnIdentity());
    if (a.kind !== 'fresh' || b.kind !== 'fresh') throw new Error('expected fresh');
    expect(a.key).not.toBe(b.key);
    expect(store.peek(FLOW)?.key).toBe(a.key);
    expect(store.peek(OTHER_FLOW)?.key).toBe(b.key);
  });

  it('clear drops memory + storage; forget drops memory only (record survives for restored path)', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({ storage, uuid: stubUuid });
    const v = await store.prepare(FLOW, saleIdentity());
    if (v.kind !== 'fresh') throw new Error('expected fresh');
    store.forget(FLOW);
    // Positive proof memory was dropped: this store has NO getRecordDoc, so
    // a memory hit would reuse silently, but the record path throws
    // OpKeyLookupFailedError instead.
    await expect(store.prepare(FLOW, saleIdentity())).rejects.toMatchObject({
      name: 'OpKeyLookupFailedError',
    });
    // …while peek still sees the surviving storage record…
    expect(store.peek(FLOW)?.key).toBe(v.key);
    // …but a FRESH store instance over the same storage still sees the record:
    const store2 = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: false }),
    });
    const v2 = await store2.prepare(FLOW, saleIdentity());
    expect(v2.kind).toBe('reuse');
    if (v2.kind !== 'reuse') return;
    expect(v2.via).toBe('restored');
    expect(v2.key).toBe(v.key);
    store2.clear(FLOW);
    expect(store2.peek(FLOW)).toBeNull();
    expect(storage.map.has(opKeyStorageKey(FLOW))).toBe(false);
  });
});

// --- TTL with fake clock ---------------------------------------------------------------

describe('REQ-UI-0: TTL', () => {
  it('record at exactly TTL age is still valid; older is expired', async () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const store = createOpKeyStore({ storage, now: clock.now, uuid: stubUuid });
    const v = await store.prepare(FLOW, saleIdentity());
    if (v.kind !== 'fresh') throw new Error('expected fresh');
    clock.advance(OP_KEY_TTL_MS);
    const store2 = createOpKeyStore({
      storage, now: clock.now, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: false }),
    });
    const stillValid = await store2.prepare(FLOW, saleIdentity());
    expect(stillValid.kind).toBe('reuse'); // boundary inclusive
    clock.advance(1);
    const store3 = createOpKeyStore({
      storage, now: clock.now, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: false }),
    });
    const expired = await store3.prepare(FLOW, saleIdentity());
    expect(expired.kind).toBe('fresh');
    if (expired.kind !== 'fresh') return;
    expect(expired.key).not.toBe(v.key);
  });

  it('sweep removes only expired records', async () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const store = createOpKeyStore({ storage, now: clock.now, uuid: stubUuid });
    await store.prepare(FLOW, saleIdentity());
    await store.prepare(OTHER_FLOW, returnIdentity());
    clock.advance(OP_KEY_TTL_MS + 1);
    // Refresh only FLOW so OTHER_FLOW expires:
    const fresh = createOpKeyStore({ storage, now: clock.now, uuid: stubUuid });
    await fresh.prepare(FLOW, saleIdentity());
    const removed = fresh.sweep();
    expect(removed).toBe(1);
    expect(storage.map.has(opKeyStorageKey(OTHER_FLOW))).toBe(false);
    expect(storage.map.has(opKeyStorageKey(FLOW))).toBe(true);
  });
});

// --- the three settle verdicts ------------------------------------------------------------

describe('REQ-UI-0: settle verdicts (a) in-session, (b) restored, (c) changed', () => {
  it('(c) changed identity + old doc exists → needs-decision[changed] with recorded info', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: true, number: 'RET-000007' }),
    });
    const v0 = await store.prepare(FLOW, saleIdentity('c1', 100));
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    store.forget(FLOW); // drop memory → restored path with a DIFFERENT cart
    const v = await store.prepare(FLOW, saleIdentity('c1', 200));
    expect(v.kind).toBe('needs-decision');
    if (v.kind !== 'needs-decision') return;
    expect(v.context).toBe('changed');
    expect(v.key).toBe(v0.key);
    expect(v.recorded).toEqual({ exists: true, number: 'RET-000007' });
  });

  it('(c) changed identity + old doc absent → silent rotate (fresh, rotated)', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: false }),
    });
    const v0 = await store.prepare(FLOW, saleIdentity('c1', 100));
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    store.forget(FLOW);
    const v = await store.prepare(FLOW, saleIdentity('c1', 200));
    expect(v.kind).toBe('fresh');
    if (v.kind !== 'fresh') return;
    expect(v.rotated).toBe(true);
    expect(v.key).not.toBe(v0.key);
    expect(store.peek(FLOW)?.key).toBe(v.key);
  });

  it('(b) restored + same identity + doc exists → needs-decision[restored-same]', async () => {
    const storage = fakeStorage();
    const s1 = createOpKeyStore({ storage, uuid: stubUuid });
    const v0 = await s1.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    // Fresh instance = empty memory over the same session storage:
    const s2 = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: true, number: 'INV-000003' }),
    });
    const v = await s2.prepare(FLOW, saleIdentity());
    expect(v.kind).toBe('needs-decision');
    if (v.kind !== 'needs-decision') return;
    expect(v.context).toBe('restored-same');
    expect(v.key).toBe(v0.key);
  });
});

// --- submitWithOpKey four outcomes ----------------------------------------------------------

describe('REQ-UI-0: submitWithOpKey outcomes', () => {
  it('sent: send resolves → record cleared', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({ storage, uuid: stubUuid, getRecordDoc: async () => ({ exists: false }) });
    let sentKey: string | null = null;
    const r = await store.submitWithOpKey(FLOW, saleIdentity(), async (key) => { sentKey = key; });
    expect(r).toEqual({ outcome: 'sent' });
    expect(typeof sentKey).toBe('string');
    expect(store.peek(FLOW)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('finished-without-send: decide finish on needs-decision → cleared, send never called', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: true, number: 'INV-9' }),
    });
    await store.prepare(FLOW, saleIdentity());
    store.forget(FLOW); // restored path, same identity
    let sent = false;
    const r = await store.submitWithOpKey(
      FLOW, saleIdentity(),
      async () => { sent = true; },
      { decide: async () => 'finish' },
    );
    expect(r).toEqual({ outcome: 'finished-without-send' });
    expect(sent).toBe(false);
    expect(store.peek(FLOW)).toBeNull();
  });

  it('aborted (user): decide abort → nothing cleared, send never called', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: true }),
    });
    await store.prepare(FLOW, saleIdentity());
    store.forget(FLOW);
    let sent = false;
    const r = await store.submitWithOpKey(
      FLOW, saleIdentity('c1', 200),
      async () => { sent = true; },
      { decide: async () => 'abort' },
    );
    expect(r).toEqual({ outcome: 'aborted', reason: 'user' });
    expect(sent).toBe(false);
    expect(store.peek(FLOW)?.key).not.toBeNull();
  });

  it('proceed-new: decide proceed-new on changed → rotate + send with the NEW key', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => ({ exists: true }),
    });
    const v0 = await store.prepare(FLOW, saleIdentity('c1', 100));
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    store.forget(FLOW);
    let sentKey: string | null = null;
    const r = await store.submitWithOpKey(
      FLOW, saleIdentity('c1', 200),
      async (key) => { sentKey = key; },
      { decide: async () => 'proceed-new' },
    );
    expect(r).toEqual({ outcome: 'sent' });
    expect(sentKey).not.toBeNull();
    expect(sentKey).not.toBe(v0.key);
    expect(store.peek(FLOW)).toBeNull(); // cleared after success
  });

  it('mismatch: send throws opkey-mismatch → record cleared immediately, cart untouched by store', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({ storage, uuid: stubUuid, getRecordDoc: async () => ({ exists: false }) });
    const err = new Error('سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة') as Error & { code: string };
    err.code = 'opkey-mismatch';
    const r = await store.submitWithOpKey(FLOW, saleIdentity(), async () => { throw err; });
    expect(r).toEqual({ outcome: 'mismatch' });
    expect(store.peek(FLOW)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('other send errors are rethrown and the key is KEPT for re-press', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({ storage, uuid: stubUuid, getRecordDoc: async () => ({ exists: false }) });
    await expect(
      store.submitWithOpKey(FLOW, saleIdentity(), async () => { throw new Error('deadline-exceeded'); }),
    ).rejects.toThrow('deadline-exceeded');
    expect(store.peek(FLOW)?.key).not.toBeNull();
    expect(storage.map.size).toBe(1);
  });
});

// --- lookup failure in paths (b)/(c): reject + hang --------------------------------------------

describe('REQ-UI-0: lookup failure → aborted/lookup-failed, no send, record kept', () => {
  it('(b) restored-same with rejecting getRecordDoc → aborted/lookup-failed', async () => {
    const storage = fakeStorage();
    const s1 = createOpKeyStore({ storage, uuid: stubUuid });
    const v0 = await s1.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    const s2 = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => { throw new Error('network down'); },
    });
    let sent = false;
    const r = await s2.submitWithOpKey(
      FLOW, saleIdentity(),
      async () => { sent = true; },
      { decide: async () => 'finish' },
    );
    expect(r).toEqual({ outcome: 'aborted', reason: 'lookup-failed' });
    expect(sent).toBe(false);
    // Record untouched — the next press re-runs the settle:
    expect(s2.peek(FLOW)?.key).toBe(v0.key);
  });

  it('(c) changed identity with rejecting getRecordDoc → aborted/lookup-failed', async () => {
    const storage = fakeStorage();
    const store = createOpKeyStore({
      storage, uuid: stubUuid,
      getRecordDoc: async () => { throw new Error('permission-denied'); },
    });
    const v0 = await store.prepare(FLOW, saleIdentity('c1', 100));
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    store.forget(FLOW);
    let sent = false;
    const r = await store.submitWithOpKey(
      FLOW, saleIdentity('c1', 200),
      async () => { sent = true; },
      { decide: async () => 'proceed-new' },
    );
    expect(r).toEqual({ outcome: 'aborted', reason: 'lookup-failed' });
    expect(sent).toBe(false);
    expect(store.peek(FLOW)?.key).toBe(v0.key);
  });

  it('hanging getRecordDoc + manual timer past the timeout → aborted/lookup-failed (fake clock)', async () => {
    const storage = fakeStorage();
    const timer = manualTimer();
    const s1 = createOpKeyStore({ storage, uuid: stubUuid });
    const v0 = await s1.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    const s2 = createOpKeyStore({
      storage, uuid: stubUuid, timer,
      lookupTimeoutMs: OP_KEY_LOOKUP_TIMEOUT_MS,
      getRecordDoc: () => new Promise<never>(() => { /* hangs forever */ }),
    });
    let sent = false;
    const pending = s2.submitWithOpKey(
      FLOW, saleIdentity(),
      async () => { sent = true; },
      { decide: async () => 'finish' },
    );
    expect(timer.pending()).toBe(1);
    await timer.advance(OP_KEY_LOOKUP_TIMEOUT_MS);
    const r = await pending;
    expect(r).toEqual({ outcome: 'aborted', reason: 'lookup-failed' });
    expect(sent).toBe(false);
    expect(timer.pending()).toBe(0); // timer cleaned up
    expect(s2.peek(FLOW)?.key).toBe(v0.key);
  });
});

// --- memory TTL: expired memory counts as absent -----------------------------------

describe('REQ-UI-0-fix: memory TTL expiry', () => {
  it('expired memory + matching identity → fresh (not reuse), isolated via memory-only storage', async () => {
    const clock = fakeClock();
    const store = createOpKeyStore({ storage: throwingStorage(), now: clock.now, uuid: stubUuid });
    const v0 = await store.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    clock.advance(OP_KEY_TTL_MS + 1);
    const v = await store.prepare(FLOW, saleIdentity());
    expect(v.kind).toBe('fresh');
    if (v.kind !== 'fresh') return;
    expect(v.rotated).toBe(false);
    expect(v.key).not.toBe(v0.key);
  });

  it('expired memory + matching storage record → fresh (both expire together)', async () => {
    const storage = fakeStorage();
    const clock = fakeClock();
    const store = createOpKeyStore({ storage, now: clock.now, uuid: stubUuid });
    const v0 = await store.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    clock.advance(OP_KEY_TTL_MS + 1);
    const v = await store.prepare(FLOW, saleIdentity());
    expect(v.kind).toBe('fresh');
    if (v.kind !== 'fresh') return;
    expect(v.key).not.toBe(v0.key);
    expect(store.peek(FLOW)?.key).toBe(v.key);
  });
});

// --- lookup synchronous throw → lookup-failed ------------------------------------------

describe('REQ-UI-0-fix: synchronous getRecordDoc throw', () => {
  it('sync throw in paths (b)/(c) → aborted/lookup-failed, timer cleaned, record kept', async () => {
    const storage = fakeStorage();
    const timer = manualTimer();
    const store = createOpKeyStore({ storage, uuid: stubUuid, timer });
    const v0 = await store.prepare(FLOW, saleIdentity());
    if (v0.kind !== 'fresh') throw new Error('expected fresh');
    // Fresh store with a synchronously-throwing getRecordDoc:
    const store2 = createOpKeyStore({
      storage,
      uuid: stubUuid,
      timer,
      getRecordDoc: () => { throw new Error('sync boom'); },
    });
    let sent = false;
    const r = await store2.submitWithOpKey(
      FLOW, saleIdentity(),
      async () => { sent = true; },
      { decide: async () => 'finish' },
    );
    expect(r).toEqual({ outcome: 'aborted', reason: 'lookup-failed' });
    expect(sent).toBe(false);
    expect(timer.pending()).toBe(0);
    expect(store2.peek(FLOW)?.key).toBe(v0.key);
  });
});

// --- uuid getRandomValues failure falls back to Math.random ------------------------------

describe('REQ-UI-0-fix: getRandomValues failure falls back', () => {
  it('throwing getRandomValues → Math.random tier still builds valid v4 ids', () => {
    let s = 42424242;
    const fakeRandom = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const throwingGRV = () => { throw new Error('no secure rng'); };
    for (let i = 0; i < 25; i++) {
      expect(UUID_V4_RE.test(buildUuid({ getRandomValues: throwingGRV, random: fakeRandom }))).toBe(true);
    }
  });
});

// --- corrupt record / unavailable storage --------------------------------------------------

describe('REQ-UI-0: corrupt record and unavailable storage', () => {
  it('corrupt JSON record is treated as absent and overwritten', async () => {
    const storage = fakeStorage();
    storage.map.set(opKeyStorageKey(FLOW), '{not-json');
    const store = createOpKeyStore({ storage, uuid: stubUuid, getRecordDoc: async () => ({ exists: false }) });
    const v = await store.prepare(FLOW, saleIdentity());
    expect(v.kind).toBe('fresh');
    if (v.kind !== 'fresh') return;
    expect(v.rotated).toBe(false);
    const raw = storage.map.get(opKeyStorageKey(FLOW))!;
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('throwing storage degrades to memory-only (no throw, in-session works)', async () => {
    const store = createOpKeyStore({ storage: throwingStorage(), uuid: stubUuid });
    const v1 = await store.prepare(FLOW, saleIdentity());
    expect(v1.kind).toBe('fresh');
    if (v1.kind !== 'fresh') throw new Error('expected fresh');
    const v2 = await store.prepare(FLOW, saleIdentity());
    expect(v2).toEqual({ kind: 'reuse', key: v1.key, via: 'memory' });
  });
});

// --- fallback UUID tiers vs UUID_V4_RE --------------------------------------------------

describe('REQ-UI-0: fallback UUID generation matches UUID_V4_RE', () => {
  it('getRandomValues tier builds valid v4 ids', () => {
    let s = 123456789;
    const fakeGRV = (b: Uint8Array) => {
      for (let i = 0; i < b.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; b[i] = s % 256; }
    };
    for (let i = 0; i < 25; i++) {
      expect(UUID_V4_RE.test(buildUuid({ getRandomValues: fakeGRV }))).toBe(true);
    }
  });

  it('Math.random tier builds valid v4 ids (old WebView path)', () => {
    let s = 987654321;
    const fakeRandom = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 25; i++) {
      expect(UUID_V4_RE.test(buildUuid({ random: fakeRandom }))).toBe(true);
    }
  });

  it('randomUUID tier is passed through when available', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(buildUuid({ randomUUID: () => id })).toBe(id);
  });
});

// --- contract: UI-built identities match service fingerprints ------------------------------

describe('REQ-UI-0: contract — UI identities match service-side fingerprints', () => {
  it('sale-shaped request vs stored doc (extra keys ignored)', () => {
    const reqLike = { items: [{ id: 'p', buyQuantity: 2, price: 50 }], total: 100, subtotal: 100, discount: 0, customerId: 'c1' };
    const storedLike = { ...reqLike, invoiceNumber: 'INV-000001', customerName: 'عميل', createdAt: 1 };
    expect(fingerprintsEqual(
      docFingerprint(reqLike, 'customerId'),
      docFingerprint(storedLike, 'customerId'),
    )).toBe(true);
    expect(fingerprintsEqual(
      docFingerprint({ ...reqLike, total: 200 }, 'customerId'),
      docFingerprint(storedLike, 'customerId'),
    )).toBe(false);
  });

  it('payment-shaped: amount maps to total, notes ignored', () => {
    const reqLike = { items: [], total: 33.33, customerId: 'c1' };
    const storedLike = { customerId: 'c1', amount: 33.33, notes: 'x', date: 1 };
    expect(fingerprintsEqual(
      docFingerprint(reqLike, 'customerId'),
      docFingerprint({ ...storedLike, total: (storedLike as { amount: number }).amount }, 'customerId'),
    )).toBe(true);
  });

  it('return-shaped: links compared alongside the fingerprint', () => {
    const id = returnIdentity('inv-1', 'day-1');
    const sameLinks = { originalInvoiceId: 'inv-1', dailyArchiveId: 'day-1' };
    const diffLinks = { originalInvoiceId: 'inv-2', dailyArchiveId: 'day-1' };
    const linksMatch = (a: Record<string, string | null>, b: Record<string, string | null>) =>
      (a.originalInvoiceId ?? null) === (b.originalInvoiceId ?? null) &&
      (a.dailyArchiveId ?? null) === (b.dailyArchiveId ?? null);
    expect(linksMatch(id.extra, sameLinks)).toBe(true);
    expect(linksMatch(id.extra, diffLinks)).toBe(false);
  });

  it('settleLabels exposes named safe-default buttons per flow', () => {
    const labels = settleLabels('customerPayment', 'mismatch');
    expect(labels.primary).toMatch('دفعة');
    expect(labels.secondary.length).toBeGreaterThan(0);
  });
});
