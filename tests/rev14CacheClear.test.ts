// REV1-4 T4.2 — logout cache clear (ordering-safe).
//
// RED-FIRST on UNFIXED code: `clearSubscriptionCache` and
// `didAuthIdentityChange` do not exist (TypeError on call), and the dead
// entry keeps sharing. `onSnapshot` is mocked at the boundary (rev1Cache
// pattern); `firebase/auth` signOut is mocked for the ordering proof.
// No emulator needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { where } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const mockCtl = vi.hoisted(() => ({
  listeners: new Map<number, { unsubscribe: () => void }>(),
  nextId: 0,
  order: [] as string[],
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    onSnapshot: vi.fn(() => {
      const id = ++mockCtl.nextId;
      const unsubscribe = vi.fn(() => {
        mockCtl.order.push('unsub');
        mockCtl.listeners.delete(id);
      });
      mockCtl.listeners.set(id, { unsubscribe });
      return unsubscribe;
    }),
  };
});

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signOut: vi.fn(async () => {
      mockCtl.order.push('auth');
    }),
  };
});

const { subscribeToCollection, subscribeToDocument, clearSubscriptionCache, didAuthIdentityChange } =
  await import('../services/dataCache');
const { signOut } = await import('../services/auth');
const { shouldSubscribeAppSettings } = await import('../contexts/AppSettingsContext');
const authMocked = await import('firebase/auth');
const firebaseSignOutMock = vi.mocked(authMocked.signOut);

function listenerCount(): number {
  return mockCtl.listeners.size;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  // Drain teardown microtasks queued by the PREVIOUS test's last release
  // (safeUnsubscribe defers the real call): without this, a stale 'unsub'
  // lands in the next test's order log and exact-count assertions lie.
  await flush();
  mockCtl.listeners.clear();
  mockCtl.nextId = 0;
  mockCtl.order = [];
  vi.clearAllMocks();
});

afterEach(() => {
  // Harness hygiene mirroring a real logout: the fix deliberately KEEPS
  // dead entries (F6 behavior), so without this every test would observe
  // previous tests' entries in exact-count assertions. Runs after the
  // test's own assertions, so it cannot mask them. The try/catch keeps
  // the RED phase pure (missing export ⇒ failures come from bodies only).
  try {
    clearSubscriptionCache();
  } catch {
    // RED phase: export missing — nothing to wipe.
  }
});

describe('REV1-4 T4.2 — clearSubscriptionCache', () => {
  it('invokes every stored unsubscribe exactly once (collection + document)', async () => {
    const unsubA = subscribeToCollection('test-clear', () => {}, [where('x', '==', 1)]);
    const unsubB = subscribeToDocument('test-clear', 'doc1', () => {});
    expect(listenerCount()).toBe(2);
    clearSubscriptionCache();
    // REV1-5 (K2): teardown is scheduled via safeUnsubscribe, not
    // synchronous — nothing has fired yet at this point.
    expect(mockCtl.order.filter((m) => m === 'unsub').length).toBe(0);
    await flush();
    expect(mockCtl.order).toEqual(['unsub', 'unsub']);
    expect(listenerCount()).toBe(0);
    unsubA();
    unsubB();
  });

  it('resubscribing the same query after a clear creates a FRESH listener', async () => {
    const unsubA = subscribeToCollection('test-resub', () => {}, [where('x', '==', 1)]);
    expect(listenerCount()).toBe(1);
    clearSubscriptionCache();
    await flush(); // REV1-5 (K2): scheduled teardown completes here.
    expect(listenerCount()).toBe(0);
    const unsubB = subscribeToCollection('test-resub', () => {}, [where('x', '==', 1)]);
    expect(listenerCount()).toBe(1);
    unsubA();
    unsubB();
  });

  it('AC-4b.6: stale closure after a clear never re-fires the SDK unsubscribe (total exactly 1)', async () => {
    const unsubA = subscribeToCollection('test-stale', () => {}, [where('x', '==', 1)]);
    expect(listenerCount()).toBe(1);
    clearSubscriptionCache();
    // REV1-5 (K2): 0 synchronously; exactly 1 after the scheduled run.
    expect(mockCtl.order.filter((m) => m === 'unsub').length).toBe(0);
    await flush();
    const unsubsAfterClear = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(unsubsAfterClear).toBe(1);
    unsubA();
    const unsubsTotal = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(unsubsTotal).toBe(1);
    expect(listenerCount()).toBe(0);
  });

  it('signOut() tears the cache down strictly BEFORE the auth call', async () => {
    subscribeToCollection('test-order', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('test-order', 'doc1', () => {});
    const p = signOut();
    // REV1-5 (K2): the clear CALL still precedes firebaseSignOut (auth.ts
    // order, proven by the static wiring test below), but the SDK
    // unsubscribes are scheduled, not synchronous. This mock pushes 'auth'
    // synchronously at CALL time — it models the call, not the macrotask
    // auth-state notification — so 'auth' leads here; the real notification
    // ordering (every unsub before auth-lost) is proven in rev15K2 T2 with
    // macrotask delivery.
    expect(mockCtl.order).toEqual(['auth']);
    await p;
    await flush();
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expect(mockCtl.order).toEqual(['auth', 'unsub', 'unsub']);
    expect(listenerCount()).toBe(0);
  });

  it('double-clear is a safe no-op', async () => {
    const unsubA = subscribeToCollection('test-noop', () => {}, [where('x', '==', 1)]);
    clearSubscriptionCache();
    clearSubscriptionCache();
    await flush(); // REV1-5 (K2): scheduled teardown completes here.
    expect(mockCtl.order.filter((m) => m === 'unsub').length).toBe(1);
    expect(listenerCount()).toBe(0);
    unsubA();
  });

  it('clear-empty is a safe no-op', () => {
    clearSubscriptionCache();
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-4 T4.2 — released entries are not unsubscribed again by a later clear', () => {
  it('collection: subscribe → release → flush → clear ⇒ SDK unsubscribes total exactly 1', async () => {
    const unsubA = subscribeToCollection('test-rel', () => {}, [where('x', '==', 1)]);
    unsubA();
    await flush();
    const before = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(before).toBe(1);
    clearSubscriptionCache();
    const total = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(total).toBe(1);
    expect(listenerCount()).toBe(0);
  });

  it('document: subscribe → release → flush → clear ⇒ SDK unsubscribes total exactly 1', async () => {
    const unsubD = subscribeToDocument('test-reldoc', 'doc1', () => {});
    unsubD();
    await flush();
    const before = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(before).toBe(1);
    clearSubscriptionCache();
    const total = mockCtl.order.filter((m) => m === 'unsub').length;
    expect(total).toBe(1);
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-4 T4.2 — shouldSubscribeAppSettings truth table', () => {
  it.each([
    ['null stays unsubscribed', null, false],
    ['undefined stays unsubscribed', undefined, false],
    ['empty string stays unsubscribed', '', false],
    ['uid subscribes', 'u1', true],
  ] as Array<[string, string | null | undefined, boolean]>)('%s', (_label, uid, expected) => {
    expect(shouldSubscribeAppSettings(uid)).toBe(expected);
  });
});

describe('REV1-4 K1 — static wiring proofs (source text, whitespace-tolerant)', () => {
  function srcOf(rel: string): string {
    return readFileSync(resolve(__dirname, rel), 'utf8');
  }

  function orderedWithin(src: string, startMarker: string, tokens: RegExp[]): boolean {
    const start = src.indexOf(startMarker);
    if (start < 0) return false;
    let pos = start;
    for (const t of tokens) {
      const slice = src.slice(pos);
      const m = t.exec(slice);
      if (!m || m.index === undefined) return false;
      pos += m.index + m[0].length;
    }
    return true;
  }

  it('AuthContext watcher: predicate → clear → ref update, all before gen += 1', () => {
    const src = srcOf('../contexts/AuthContext.tsx');
    expect(
      orderedWithin(src, 'onAuthStateChangedListener((user', [
        /if\s*\(\s*didAuthIdentityChange\s*\(\s*lastUidRef\.current\s*,\s*nextUid\s*\)\s*\)\s*\{\s*clearSubscriptionCache\s*\(\s*\)\s*;?\s*\}/,
        /lastUidRef\.current\s*=\s*nextUid/,
        /gen\s*\+=\s*1/,
      ]),
    ).toBe(true);
  });

  it('auth.ts signOut: clearSubscriptionCache() strictly before firebaseSignOut(', () => {
    const src = srcOf('../services/auth.ts');
    expect(
      orderedWithin(src, 'export const signOut', [
        /clearSubscriptionCache\s*\(\s*\)/,
        /firebaseSignOut\s*\(/,
      ]),
    ).toBe(true);
  });

  it('AppSettingsContext: uid-guarded effect calling subscribeToDocument with [uid] deps', () => {
    const src = srcOf('../contexts/AppSettingsContext.tsx');
    expect(
      orderedWithin(src, 'useEffect(', [
        /shouldSubscribeAppSettings\s*\(\s*uid\s*\)/,
        /subscribeToDocument/,
        /\[uid\]/,
      ]),
    ).toBe(true);
  });
});

describe('REV1-4 T4.2 — didAuthIdentityChange truth table', () => {
  it.each([
    ['null → null stays silent', null, null, false],
    ['null → uid clears', null, 'u1', true],
    ['uid → null clears', 'u1', null, true],
    ['uid → same stays silent', 'u1', 'u1', false],
    ['uidA → uidB clears', 'u1', 'u2', true],
  ] as Array<[string, string | null, string | null, boolean]>)('%s', (
    _label,
    prev,
    next,
    expected,
  ) => {
    expect(didAuthIdentityChange(prev, next)).toBe(expected);
  });
});
