// REV1-1 (AUDIT-REV1) — dataCache key collision + fan-out.
// RED-FIRST: written and run against UNCHANGED services/dataCache.ts.
//
// Two bugs:
//   1. Key collision: generateCacheKey falls back to c.type (`_toFieldFilter`
//      does not exist in the installed SDK) → every `where` degrades to
//      `"where"`, every `orderBy` to `"orderBy"` → different queries, same key.
//   2. Fan-out: onSnapshot callback only invokes the FIRST subscriber's
//      callback. Later subscribers (same key) get cached data but never live
//      updates; after the first unsubscribes the listener keeps invoking the
//      stale callback.
//
// Boundary: real `query`/`where`/`orderBy`/`limit`/`startAfter`/`collection`
// from the SDK; `onSnapshot` mocked; `query` wrapped to throw ONLY on a
// marked probe constraint (rest delegates to the real SDK) for AC-1.4.
//
// NOTE: subscribeToCollection stores `{ data: [] }` right after the first
// subscribe, so a later subscriber is immediately called once with `[]`.
// Tests therefore assert LAST-call CONTENT (or filtered content), never bare
// call counts.
//
// Run single:
//   npx vitest run tests/rev1Cache.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { where, orderBy, limit, startAfter } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type Snapshot = { docs: SnapshotDoc[] };
type SnapshotCallback = (snapshot: Snapshot) => void;
type ErrorCallback = (error: Error) => void;

interface Listener {
  callback: SnapshotCallback;
  errorCallback?: ErrorCallback;
  unsubscribe: () => void;
}

const mockCtl = vi.hoisted(() => {
  const THROW_MARKER = '__rev1MarkedThrow__';
  const listeners = new Map<number, Listener>();
  const isMarked = (c: unknown): c is Record<string, unknown> =>
    typeof c === 'object' && c !== null && THROW_MARKER in c;
  return { THROW_MARKER, listeners, isMarked, nextId: 0, queryEqualThrows: false };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    onSnapshot: vi.fn((q: unknown, callback: SnapshotCallback, errorCallback?: ErrorCallback) => {
      const id = ++mockCtl.nextId;
      const unsubscribe = vi.fn(() => { mockCtl.listeners.delete(id); });
      mockCtl.listeners.set(id, { callback, errorCallback, unsubscribe });
      return unsubscribe;
    }),
    query: ((...args: Parameters<typeof actual.query>): ReturnType<typeof actual.query> => {
      if (args.slice(1).some(mockCtl.isMarked)) {
        throw new Error('REV1-1 fail-closed probe: marked constraint');
      }
      return actual.query(...args);
    }) as typeof actual.query,
    queryEqual: ((...args: Parameters<typeof actual.queryEqual>): ReturnType<typeof actual.queryEqual> => {
      if (mockCtl.queryEqualThrows) {
        throw new Error('REV1-1 fail-closed probe: queryEqual throws');
      }
      return actual.queryEqual(...args);
    }) as typeof actual.queryEqual,
  };
});

const { subscribeToCollection } = await import('../services/dataCache');

function getListenerCount(): number {
  return mockCtl.listeners.size;
}

function triggerSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>): void {
  const snapshot: Snapshot = { docs: docs.map(d => ({ id: d.id, data: () => d.data })) };
  for (const listener of mockCtl.listeners.values()) {
    listener.callback(snapshot);
  }
}

function triggerSnapshotFor(index: number, docs: Array<{ id: string; data: Record<string, unknown> }>): void {
  const id = Array.from(mockCtl.listeners.keys())[index];
  const listener = id === undefined ? undefined : mockCtl.listeners.get(id);
  if (listener) {
    const snapshot: Snapshot = { docs: docs.map(d => ({ id: d.id, data: () => d.data })) };
    listener.callback(snapshot);
  }
}

function triggerError(error: Error): void {
  for (const listener of mockCtl.listeners.values()) {
    listener.errorCallback?.(error);
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function lastCall(calls: unknown[][]): unknown {
  return calls.length > 0 ? calls[calls.length - 1] : null;
}

function liveCalls(calls: unknown[][]): unknown[][] {
  return calls.filter((c) => !(Array.isArray(c) && c.length === 0));
}

function markedConstraint(tag: string): QueryConstraint {
  return { type: 'where', [mockCtl.THROW_MARKER]: tag } as unknown as QueryConstraint;
}

let pendingUnsubs: Array<() => void> = [];

function track(unsub: () => void): () => void {
  pendingUnsubs.push(unsub);
  return unsub;
}

beforeEach(() => {
  mockCtl.listeners.clear();
  mockCtl.nextId = 0;
  mockCtl.queryEqualThrows = false;
  pendingUnsubs = [];
});

afterEach(async () => {
  for (const unsub of pendingUnsubs) {
    unsub();
  }
  pendingUnsubs = [];
  await flush();
});

describe('REV1-1 — dataCache key collision + fan-out', () => {
  it.each([
    ['where x==1 vs x==2', [where('x', '==', 1)], [where('x', '==', 2)]],
    ['where x==1 vs y==1', [where('x', '==', 1)], [where('y', '==', 1)]],
    ['where x==1 vs x!=1', [where('x', '==', 1)], [where('x', '!=', 1)]],
    ['orderBy n asc vs desc', [orderBy('n', 'asc')], [orderBy('n', 'desc')]],
    ['startAfter 5 vs 10', [orderBy('n'), startAfter(5)], [orderBy('n'), startAfter(10)]],
  ] as Array<[string, QueryConstraint[], QueryConstraint[]]>)('AC-1.1: %s should NOT share a listener', (_label, constraintsA, constraintsB) => {
    const slug = _label.replace(/[^a-zA-Z0-9]+/g, '-');
    const path = `test-ac11-${slug}`;
    const unsubA = track(subscribeToCollection(path, () => {}, constraintsA));
    const unsubB = track(subscribeToCollection(path, () => {}, constraintsB));
    expect(getListenerCount()).toBe(2);
    unsubA();
    unsubB();
  });

  it('R3: collision — B never receives A data; separate listeners', () => {
    const callsA: unknown[][] = [];
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-r3', (d) => { callsA.push(d); }, [orderBy('name')]));
    const unsubB = track(subscribeToCollection('test-r3', (d) => { callsB.push(d); }, [orderBy('age')]));
    // Targeted delivery: A's payload goes to listener 0 (A's) only.
    triggerSnapshotFor(0, [{ id: 'A1', data: { name: 'a-one' } }]);
    expect(lastCall(callsA)).toEqual([{ id: 'A1', name: 'a-one' }]);
    // B's callback (ignoring the initial cached []) never sees A's payload.
    expect(liveCalls(callsB)).toEqual([]);
    // Collision: one shared listener instead of two.
    expect(getListenerCount()).toBe(2);
    // Late subscriber with a THIRD different constraint must not get A's payload.
    const callsC: unknown[][] = [];
    const unsubC = track(subscribeToCollection('test-r3', (d) => { callsC.push(d); }, [orderBy('salary')]));
    expect(callsC).toEqual([]);
    unsubA();
    unsubB();
    unsubC();
  });

  it('AC-1.2: equal where constraints share one listener', () => {
    const unsubA = track(subscribeToCollection('test-ac12a', () => {}, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac12a', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  it('AC-1.2: equal orderBy constraints share one listener', () => {
    const unsubA = track(subscribeToCollection('test-ac12b', () => {}, [orderBy('n', 'asc')]));
    const unsubB = track(subscribeToCollection('test-ac12b', () => {}, [orderBy('n', 'asc')]));
    expect(getListenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  it('AC-1.2: equal limit constraints share one listener', () => {
    const unsubA = track(subscribeToCollection('test-ac12c', () => {}, [limit(5)]));
    const unsubB = track(subscribeToCollection('test-ac12c', () => {}, [limit(5)]));
    expect(getListenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  it('AC-1.2: empty constraints share one listener', () => {
    const unsubA = track(subscribeToCollection('test-ac12d', () => {}, []));
    const unsubB = track(subscribeToCollection('test-ac12d', () => {}, []));
    expect(getListenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  // The SDK stores where-filters and orderBys in separate canonical slots,
  // so both arrays build the same Query and the real queryEqual returns
  // true: sharing one listener is correct here.
  it('AC-1.2: [where, orderBy] and [orderBy, where] are semantically equal ⇒ share', () => {
    const unsubA = track(subscribeToCollection('test-ac12e', () => {}, [where('x', '==', 1), orderBy('n')]));
    const unsubB = track(subscribeToCollection('test-ac12e', () => {}, [orderBy('n'), where('x', '==', 1)]));
    expect(getListenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  it('AC-1.2: [orderBy a, orderBy b] vs [orderBy b, orderBy a] do NOT share (orderBy order matters)', () => {
    const unsubA = track(subscribeToCollection('test-ac12h', () => {}, [orderBy('a'), orderBy('b')]));
    const unsubB = track(subscribeToCollection('test-ac12h', () => {}, [orderBy('b'), orderBy('a')]));
    expect(getListenerCount()).toBe(2);
    unsubA();
    unsubB();
  });

  it('AC-1.2: same constraints on different path do NOT share', () => {
    const unsubA = track(subscribeToCollection('test-ac12f-path1', () => {}, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac12f-path2', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(2);
    unsubA();
    unsubB();
  });

  it('AC-1.2: same-type wheres in different order do NOT share (no reordering)', () => {
    const unsubA = track(subscribeToCollection('test-ac12g', () => {}, [where('a', '==', 1), where('b', '==', 2)]));
    const unsubB = track(subscribeToCollection('test-ac12g', () => {}, [where('b', '==', 2), where('a', '==', 1)]));
    expect(getListenerCount()).toBe(2);
    unsubA();
    unsubB();
  });

  it('AC-1.6: shared B receives two consecutive live updates (last-call content)', () => {
    const callsA: unknown[][] = [];
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-ac16', (d) => { callsA.push(d); }, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac16', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(lastCall(callsA)).toEqual([{ id: '1', x: 1 }]);
    expect(lastCall(callsB)).toEqual([{ id: '1', x: 1 }]);
    triggerSnapshot([{ id: '2', data: { x: 1 } }]);
    expect(lastCall(callsA)).toEqual([{ id: '2', x: 1 }]);
    expect(lastCall(callsB)).toEqual([{ id: '2', x: 1 }]);
    unsubA();
    unsubB();
  });

  it('AC-1.6: A+B+C all receive the live update content', () => {
    const callsA: unknown[][] = [];
    const callsB: unknown[][] = [];
    const callsC: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-ac16b', (d) => { callsA.push(d); }, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac16b', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    const unsubC = track(subscribeToCollection('test-ac16b', (d) => { callsC.push(d); }, [where('x', '==', 1)]));
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(lastCall(callsA)).toEqual([{ id: '1', x: 1 }]);
    expect(lastCall(callsB)).toEqual([{ id: '1', x: 1 }]);
    expect(lastCall(callsC)).toEqual([{ id: '1', x: 1 }]);
    unsubA();
    unsubB();
    unsubC();
  });

  it('AC-1.6: shared B receives live update (fan-out)', () => {
    let latestA: unknown = null;
    let latestB: unknown = null;
    const unsubA = track(subscribeToCollection('test-ac13', (d) => { latestA = d; }, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac13', (d) => { latestB = d; }, [where('x', '==', 1)]));
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(latestA).toEqual([{ id: '1', x: 1 }]);
    expect(latestB).toEqual([{ id: '1', x: 1 }]);
    unsubA();
    unsubB();
  });

  it('AC-1.7: A leaves, B stays and receives updates; A gets nothing new', async () => {
    const callsA: unknown[][] = [];
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-ac17', (d) => { callsA.push(d); }, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac17', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(lastCall(callsA)).toEqual([{ id: '1', x: 1 }]);
    unsubA();
    triggerSnapshot([{ id: '2', data: { x: 1 } }]);
    // B (still subscribed) receives the second update.
    expect(lastCall(callsB)).toEqual([{ id: '2', x: 1 }]);
    // A (unsubscribed) receives nothing new: exactly its one snapshot call.
    expect(callsA.length).toBe(1);
    expect(getListenerCount()).toBe(1);
    unsubB();
    await flush();
    expect(getListenerCount()).toBe(0);
  });

  it('AC-1.7b: double-unsubscribe is idempotent; B keeps receiving', async () => {
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-ac17b', () => {}, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac17b', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    unsubA();
    unsubA();
    await flush();
    expect(getListenerCount()).toBe(1);
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(lastCall(callsB)).toEqual([{ id: '1', x: 1 }]);
    unsubB();
    await flush();
    expect(getListenerCount()).toBe(0);
  });

  it('AC-1.6b: a throwing subscriber callback does not starve the rest', () => {
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-throwcb', () => { throw new Error('boom'); }, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-throwcb', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    try {
      triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    } catch {
      // A threw; with per-callback isolation B still gets the update.
    }
    expect(lastCall(callsB)).toEqual([{ id: '1', x: 1 }]);
    unsubA();
    unsubB();
  });

  it('AC-1.5: B subscribing later receives cached data immediately', () => {
    const callsA: unknown[][] = [];
    const callsB: unknown[][] = [];
    const unsubA = track(subscribeToCollection('test-ac15', (d) => { callsA.push(d); }, [where('x', '==', 1)]));
    triggerSnapshot([{ id: '1', data: { x: 1 } }]);
    expect(lastCall(callsA)).toEqual([{ id: '1', x: 1 }]);
    const unsubB = track(subscribeToCollection('test-ac15', (d) => { callsB.push(d); }, [where('x', '==', 1)]));
    expect(lastCall(callsB)).toEqual([{ id: '1', x: 1 }]);
    unsubA();
    unsubB();
  });

  it('AC-1.4: throwing query construction fails closed — no sharing', () => {
    // A: construction throws → propagates (GREEN both before/after fix).
    expect(() => subscribeToCollection('test-ac14', () => {}, [markedConstraint('A')])).toThrow(
      'REV1-1 fail-closed probe: marked constraint',
    );
    // B: different marked constraint, same fallback key. Fail-closed means B
    // is treated independently (its own construction attempt throws) rather
    // than being swallowed into A's leaked ref-count.
    expect(() => subscribeToCollection('test-ac14', () => {}, [markedConstraint('B')])).toThrow(
      'REV1-1 fail-closed probe: marked constraint',
    );
    expect(getListenerCount()).toBe(0);
  });

  it('AC-1.4b: queryEqual throws ⇒ no sharing (private entries)', () => {
    mockCtl.queryEqualThrows = true;
    const unsubA = track(subscribeToCollection('test-ac14b', () => {}, [where('x', '==', 1)]));
    const unsubB = track(subscribeToCollection('test-ac14b', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(2);
    unsubA();
    unsubB();
  });

  it('AC-1.3: dataCache.ts has no private SDK member reliance', () => {
    const src = readFileSync(resolve('services/dataCache.ts'), 'utf8');
    expect(src).not.toContain('_toFieldFilter');
  });

  it('onSnapshot error callback: listener stable', async () => {
    const unsub = track(subscribeToCollection('test-err', () => {}, [where('x', '==', 1)]));
    triggerError(new Error('test error'));
    expect(getListenerCount()).toBe(1);
    unsub();
    await flush();
    expect(getListenerCount()).toBe(0);
  });

  it('teardown on last release', async () => {
    const unsub = track(subscribeToCollection('test-teardown', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(1);
    unsub();
    await flush();
    expect(getListenerCount()).toBe(0);
  });

  it('churn: rapid subscribe/unsubscribe refcounting', async () => {
    const unsubA = track(subscribeToCollection('test-churn', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(1);
    unsubA();
    await flush();
    expect(getListenerCount()).toBe(0);
    const unsubB = track(subscribeToCollection('test-churn', () => {}, [where('x', '==', 1)]));
    const unsubC = track(subscribeToCollection('test-churn', () => {}, [where('x', '==', 1)]));
    expect(getListenerCount()).toBe(1);
    unsubB();
    expect(getListenerCount()).toBe(1);
    unsubC();
    await flush();
    expect(getListenerCount()).toBe(0);
  });
});
