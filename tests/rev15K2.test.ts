// REV1-5 K2 — deferred-unsubscribe logout teardown + K3-variant epoch guard.
//
// RED-FIRST on UNFIXED code: `clearSubscriptionCache` calls raw
// `entry.unsubscribe()` synchronously, so T1 (sync-0) and the sync-empty
// half of T2 fail, and T6 finds direct calls. T3 passes already (guards are
// unchanged — regression lock). T5 passes already (collection entry
// identity — regression lock under the deferred path). T4 (document epoch)
// is added with the 5b commit. T7 needs the Firestore emulator; without one
// it reports SKIPPED via ctx.skip() with the reason on stdout — never a
// silent pass, nothing faked. T2b pins the boundary of the ordering
// guarantee across modeled auth-delivery modes (see its comments). T2c
// measures the REAL auth-emulator order over 5 logout cycles (recorded,
// not pinned — timing-dependent by construction).
//
// Mock pattern follows tests/rev14CacheClear.test.ts: `onSnapshot` mocked
// at the boundary (records `unsub` events + per-listener handles), with a
// `useReal` delegation flag so T7 can open REAL listeners on the emulator
// through the same `subscribeToCollection` code path. `firebase/auth`
// signOut is mocked with a switchable `authDelivery` mode (macrotask via
// setTimeout(0) by default; microtask; sync); each mode models a
// HYPOTHETICAL auth-state-loss delivery after signOut() — none is a
// verified claim about the real SDK's timing (see REPORT). The real
// `signOut()` from services/auth is exercised for the ordering proofs.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { where } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import net from 'node:net';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const mockCtl = vi.hoisted(() => ({
  listeners: new Map<number, { unsubscribe: () => void }>(),
  created: [] as unknown[],
  nextId: 0,
  order: [] as string[],
  useReal: false,
  authDelivery: 'macrotask' as 'macrotask' | 'microtask' | 'sync',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const realSnap = (actual as Record<string, unknown>).onSnapshot as (
    ...a: any[]
  ) => unknown;
  return {
    ...actual,
    onSnapshot: vi.fn((...args: any[]) => {
      if (mockCtl.useReal) {
        return realSnap(...args);
      }
      const id = ++mockCtl.nextId;
      const unsubscribe = vi.fn(() => {
        mockCtl.order.push('unsub');
        mockCtl.listeners.delete(id);
      });
      mockCtl.listeners.set(id, { unsubscribe });
      mockCtl.created.push(unsubscribe);
      return unsubscribe;
    }),
  };
});

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signOut: vi.fn(async () => {
      // Delivery-mode switch for the ordering proofs (T2/T2b). Each mode
      // models a HYPOTHETICAL auth-state-loss delivery after signOut() is
      // invoked — none is a verified claim about the real SDK's timing:
      // - 'macrotask' (default, T2): notification via setTimeout(0).
      // - 'microtask' (T2b-i): queued after invocation, so FIFO still puts
      //   the already-queued unsubs first.
      // - 'sync' (T2b-ii): runs inside the call before any microtask
      //   drains — unsub-before-auth is NOT guaranteed (observed below).
      const mode = mockCtl.authDelivery;
      if (mode === 'sync') {
        mockCtl.order.push('auth-lost');
        return;
      }
      if (mode === 'microtask') {
        await Promise.resolve();
      } else {
        await new Promise((r) => setTimeout(r, 0));
      }
      mockCtl.order.push('auth-lost');
    }),
  };
});

const { subscribeToCollection, subscribeToDocument, clearSubscriptionCache } =
  await import('../services/dataCache');
const { signOut } = await import('../services/auth');
const authMocked = await import('firebase/auth');
const firebaseSignOutMock = vi.mocked(authMocked.signOut);

function listenerCount(): number {
  return mockCtl.listeners.size;
}

function unsubCount(): number {
  return mockCtl.order.filter((m) => m === 'unsub').length;
}

function callsOf(u: unknown): number {
  return (u as { mock: { calls: unknown[][] } }).mock.calls.length;
}

async function flush(): Promise<void> {
  // Drains queueMicrotask-scheduled unsubscribes (K2 path): awaiting even
  // one macrotask guarantees every currently-queued microtask has run.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function tcpReachable(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolveTcp) => {
    const s = net.connect(port, host, () => {
      s.destroy();
      resolveTcp(true);
    });
    s.on('error', () => resolveTcp(false));
    s.setTimeout(ms, () => {
      s.destroy();
      resolveTcp(false);
    });
  });
}

beforeEach(async () => {
  // Drain teardown microtasks queued by the PREVIOUS test's last release
  // or clear (deferred path): without this, a stale 'unsub' lands in the
  // next test's order log and exact-count assertions lie.
  await flush();
  mockCtl.listeners.clear();
  mockCtl.created = [];
  mockCtl.nextId = 0;
  mockCtl.order = [];
  mockCtl.useReal = false;
  mockCtl.authDelivery = 'macrotask';
  vi.clearAllMocks();
});

afterEach(() => {
  // Harness hygiene mirroring a real logout. Runs after the test's own
  // assertions, so it cannot mask them.
  mockCtl.useReal = false;
  try {
    clearSubscriptionCache();
  } catch {
    // RED phase: export missing — nothing to wipe.
  }
});

describe('REV1-5 T1 — clearSubscriptionCache defers SDK unsubscribes', () => {
  it('raw SDK unsubscribe mocks: 0 calls synchronously, exactly once each after flush', async () => {
    subscribeToCollection('k2-t1', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('k2-t1', 'doc1', () => {});
    expect(listenerCount()).toBe(2);
    clearSubscriptionCache();
    // K2: teardown is scheduled, not synchronous.
    expect(unsubCount()).toBe(0);
    expect(listenerCount()).toBe(2);
    await flush();
    expect(unsubCount()).toBe(2);
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-5 T2 — ordering: scheduled unsubs precede auth-state loss', () => {
  it("all 'unsub' events precede 'auth-lost' via real signOut()", async () => {
    subscribeToCollection('k2-t2', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('k2-t2', 'doc1', () => {});
    const p = signOut();
    // Deferred, not sync: nothing has run before the first await.
    expect(mockCtl.order).toEqual([]);
    await p;
    await flush();
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expect(mockCtl.order).toEqual(['unsub', 'unsub', 'auth-lost']);
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-5 T2b — auth-delivery modes: what is (and is not) guaranteed', () => {
  it("(i) microtask-delivered 'auth-lost' still follows both unsubs", async () => {
    // Guarantee under test: clear() queues both unsub microtasks BEFORE
    // firebaseSignOut is invoked, so any notification the mock queues
    // at-or-after invocation (microtask here, macrotask in T2) runs after
    // them by FIFO. Holds for the MOCK's delivery; real-SDK delivery
    // timing was not verified (see REPORT).
    mockCtl.authDelivery = 'microtask';
    subscribeToCollection('k2-t2b-micro', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('k2-t2b-micro', 'doc1', () => {});
    const p = signOut();
    expect(mockCtl.order).toEqual([]);
    await p;
    await flush();
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expect(mockCtl.order).toEqual(['unsub', 'unsub', 'auth-lost']);
    expect(listenerCount()).toBe(0);
  });

  it("(ii) synchronously-delivered 'auth-lost' does NOT follow the unsubs — observed order pinned", async () => {
    // Boundary of the guarantee: a notification delivered SYNCHRONOUSLY
    // inside the signOut call (before any microtask drains) necessarily
    // precedes the queued unsubs — nothing about K2 can change that. This
    // mode models the signOut CALL (like the rev14 mock), not a verified
    // SDK behavior. The observed order below is the report, not a weakened
    // assertion: see REPORT.
    mockCtl.authDelivery = 'sync';
    subscribeToCollection('k2-t2b-sync', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('k2-t2b-sync', 'doc1', () => {});
    const p = signOut();
    expect(mockCtl.order).toEqual(['auth-lost']);
    await p;
    await flush();
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expect(mockCtl.order).toEqual(['auth-lost', 'unsub', 'unsub']);
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-5 T2c — real auth-emulator order measurement (recorded, not pinned)', () => {
  // Answers T2b-ii's open question against the REAL auth SDK on the
  // emulator: when signOut() runs clear-then-real-signOut (same order as
  // services/auth.ts), in what order do the queued SDK unsubs vs the real
  // onAuthStateChanged(null) callback actually run? Firestore listeners
  // stay MOCKED (no reads needed); only Auth is real. The order is the
  // MEASUREMENT — completion is asserted, order is logged + reported in
  // REPORT (timing-dependent by construction, never pinned as a guarantee).
  const EMAIL = 'k2-t2c@test.local';
  const PW = 'secret123';
  const ROUNDS = 5;

  async function waitFor(cond: () => boolean, ms: number, label: string): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`T2c timeout waiting for ${label}`);
      await sleep(50);
    }
  }

  it(
    'measures real-SDK order: auth-null callback vs executed unsubs over 5 logout cycles',
    { timeout: 120000 },
    async (ctx) => {
      if (
        !(await tcpReachable('127.0.0.1', 8080, 2000)) ||
        !(await tcpReachable('127.0.0.1', 9099, 2000))
      ) {
        console.log('T2c SKIPPED: emulator (8080/9099) unreachable (plain run?)');
        ctx.skip();
        return;
      }
      const { getAuthInstance } = await import('../services/firebase');
      const realAuth =
        await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
      const fbAuth = getAuthInstance();
      try {
        await fbAuth.signOut();
      } catch {
        /* not signed in */
      }
      try {
        await realAuth.createUserWithEmailAndPassword(fbAuth, EMAIL, PW);
      } catch (e: unknown) {
        if (String((e as { code?: string })?.code ?? e).indexOf('email-already-in-use') < 0) throw e;
      }
      // Real auth-state listener: records sign-in (auth-user) and sign-out
      // (auth-null) callbacks, tagged by round. Auth-null tags go to the
      // SHARED mockCtl.order log too, so each round's slice shows the TRUE
      // interleave of executed unsubs vs the real callback. Delivery timing
      // is the measured quantity — the test WAITS for each event (poll,
      // 10s cap) instead of assuming any latency.
      const seen: string[] = [];
      const orders: string[][] = [];
      const nullLatMs: number[] = [];
      let round = -1;
      const stop = realAuth.onAuthStateChanged(fbAuth, (u) => {
        const tag = `r${round}:${u === null ? 'auth-null' : 'auth-user'}`;
        seen.push(tag);
        if (u === null) mockCtl.order.push(tag);
      });
      try {
        for (let i = 0; i < ROUNDS; i++) {
          round = i;
          await realAuth.signInWithEmailAndPassword(fbAuth, EMAIL, PW);
          await waitFor(() => seen.includes(`r${i}:auth-user`), 10000, `r${i}:auth-user`);
          subscribeToCollection('k2-t2c', () => {}, [where('x', '==', 1)]);
          subscribeToDocument('k2-t2c', 'doc1', () => {});
          const mark = mockCtl.order.length;
          // Same order as services/auth signOut (clear first), but with the
          // REAL firebase signOut so the REAL auth callback fires. (The
          // services/auth signOut itself can't be used here: this file mocks
          // firebase/auth signOut for T2/T2b.)
          clearSubscriptionCache();
          await realAuth.signOut(fbAuth);
          const tSignedOut = Date.now();
          await waitFor(() => seen.includes(`r${i}:auth-null`), 10000, `r${i}:auth-null`);
          nullLatMs.push(Date.now() - tSignedOut);
          await flush();
          orders.push(mockCtl.order.slice(mark));
          expect(listenerCount()).toBe(0);
        }
      } finally {
        stop();
        try {
          await fbAuth.signOut();
        } catch {
          /* hygiene only */
        }
      }
      console.log('T2c observed orders: ' + orders.map((o) => '[' + o.join(',') + ']').join(' '));
      console.log('T2c auth-null latency after signOut resolved (ms): [' + nullLatMs.join(',') + ']');
      // Completion only: every round tore down both listeners AND delivered
      // the null callback. ORDER IS NOT PINNED — it is the measurement
      // reported in REPORT (timing-dependent by construction).
      expect(orders).toHaveLength(ROUNDS);
      orders.forEach((o, i) => {
        expect([...o].sort()).toEqual([`r${i}:auth-null`, 'unsub', 'unsub'].sort());
      });
    },
  );
});

describe('REV1-5 T3 — double clear schedules nothing extra', () => {
  it('second call schedules zero additional unsubscribes', async () => {
    subscribeToCollection('k2-dbl', () => {}, [where('x', '==', 1)]);
    subscribeToDocument('k2-dbl', 'doc1', () => {});
    clearSubscriptionCache();
    await flush();
    expect(unsubCount()).toBe(2);
    clearSubscriptionCache();
    await flush();
    expect(unsubCount()).toBe(2);
    expect(listenerCount()).toBe(0);
  });
});

describe('REV1-5 T4 — document epoch guard (5b)', () => {
  it('A -> clear -> B (same key) -> release A keeps B; release B unsubs exactly once', async () => {
    const releaseA = subscribeToDocument('k2-epoch', 'doc1', () => {});
    clearSubscriptionCache();
    await flush();
    // The clear scheduled A's own unsubscribe exactly once.
    expect(callsOf(mockCtl.created[0])).toBe(1);
    const releaseB = subscribeToDocument('k2-epoch', 'doc1', () => {});
    releaseA(); // pre-clear subscriber: must never touch post-clear state.
    await flush();
    expect(callsOf(mockCtl.created[1])).toBe(0);
    releaseB();
    await flush();
    expect(callsOf(mockCtl.created[1])).toBe(1);
  });
});

describe('REV1-5 T5 — collection stale-release regression (entry identity)', () => {
  it('clear -> resubscribe (same query) -> release stale A keeps B; release B unsubs once', async () => {
    const releaseA = subscribeToCollection('k2-stale', () => {}, [
      where('x', '==', 1),
    ]);
    clearSubscriptionCache();
    await flush();
    expect(unsubCount()).toBe(1);
    expect(callsOf(mockCtl.created[0])).toBe(1);
    const releaseB = subscribeToCollection('k2-stale', () => {}, [
      where('x', '==', 1),
    ]);
    releaseA(); // stale closure over the dead entry: must be a no-op.
    await flush();
    expect(callsOf(mockCtl.created[1])).toBe(0);
    expect(unsubCount()).toBe(1);
    releaseB();
    await flush();
    expect(callsOf(mockCtl.created[1])).toBe(1);
    expect(unsubCount()).toBe(2);
  });
});

describe('REV1-5 T6 — static wiring proofs (source text, whitespace-tolerant)', () => {
  function clearSlice(): string {
    const src = readFileSync(resolve(__dirname, '../services/dataCache.ts'), 'utf8');
    const start = src.indexOf('export const clearSubscriptionCache');
    const end = src.indexOf('export const didAuthIdentityChange');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('clearSubscriptionCache references safeUnsubscribe', () => {
    expect(clearSlice()).toMatch(/safeUnsubscribe\s*\(\s*entry\.unsubscribe\s*\)/);
  });

  it('clearSubscriptionCache contains no direct entry.unsubscribe()', () => {
    const stripped = clearSlice().replace(
      /safeUnsubscribe\s*\(\s*entry\.unsubscribe\s*\)/g,
      '',
    );
    expect(stripped).not.toMatch(/\.unsubscribe\s*\(\s*\)/);
  });
});

describe('REV1-5 T7 — best-effort real-SDK reproduction (emulator)', () => {
  // Eight collections a signed-in cashier can READ (all
  // `allow read: if isActiveUser()`). Seeded rules-disabled (the tx2Sale
  // pattern); listened through the app singleton (authenticated).
  const COLLS = [
    'products',
    'categories',
    'customers',
    'suppliers',
    'invoices',
    'returns',
    'customerPayments',
    'supplierPayments',
  ];
  const N = 300;
  const EMAIL = 'k2-t7@test.local';
  const PW = 'secret123';
  let testEnv: RulesTestEnvironment | undefined;

  afterAll(async () => {
    try {
      await testEnv?.cleanup();
    } catch {
      /* best-effort hygiene only */
    }
    testEnv = undefined;
  });

  it(
    'no INTERNAL ASSERTION across 8 live listeners x clear delays 0/1/5/20/50ms',
    { timeout: 180000 },
    async (ctx) => {
      const failures: string[] = [];
      const notes: string[] = [];
      const onRej = (e: unknown): void => {
        failures.push(
          'unhandledRejection: ' + String((e as Error)?.message ?? e),
        );
      };
      const onExc = (e: unknown): void => {
        failures.push(
          'uncaughtException: ' + String((e as Error)?.message ?? e),
        );
      };
      process.on('unhandledRejection', onRej);
      process.on('uncaughtException', onExc);
      const errSpy = vi
        .spyOn(console, 'error')
        .mockImplementation((...a: unknown[]) => {
          const s = a.map((x) => String(x)).join(' ');
          if (/INTERNAL ASSERTION/.test(s)) failures.push('console.error: ' + s);
          else notes.push('console.error(other): ' + s.slice(0, 200));
        });
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...a: unknown[]) => {
          const s = a.map((x) => String(x)).join(' ');
          // A swallowed SDK unsubscribe error is the K2 failure signal
          // itself (safeUnsubscribe logs exactly this) — it must fail T7,
          // not sit in notes.
          if (/Firestore unsubscribe swallowed/.test(s)) {
            failures.push('console.warn(swallowed-unsub): ' + s.slice(0, 300));
          } else {
            notes.push('console.warn: ' + s.slice(0, 200));
          }
        });
      const done = (msg: string): void => {
        notes.push(msg);
        console.log('T7: ' + notes.join(' | '));
      };
      try {
        // No emulator on 8080 (plain `vitest run`) => report SKIPPED with
        // the reason on stdout — never a silent pass. No Firebase call is
        // made before this probe. (ctx.skip() takes no reason argument in
        // the installed vitest 2.1.9 — verified against @vitest/runner
        // types + runtime — so the reason is logged, then skip() throws.)
        if (!(await tcpReachable('127.0.0.1', 8080, 2000))) {
          console.log('T7: ' + notes.join(' | ') + ' | T7 SKIPPED: no emulator on 127.0.0.1:8080 (plain run?)');
          ctx.skip();
          return;
        }
        const { getDB, getAuthInstance } = await import('../services/firebase');
        const realFs =
          await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
        const realAuth =
          await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
        try {
          testEnv = await initializeTestEnvironment({
            projectId: 'casher-yasoo',
            firestore: {
              rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
            },
          });
        } catch (e) {
          console.log('T7: ' + notes.join(' | ') + ' | T7 SKIPPED: initializeTestEnvironment failed (' + String((e as Error)?.message ?? e) + ')');
          ctx.skip();
          return;
        }
        // Sign in as cashier (tx2Sale pattern) so reads are allowed.
        const fbAuth = getAuthInstance();
        try {
          await fbAuth.signOut();
        } catch {
          /* not signed in */
        }
        try {
          await realAuth.createUserWithEmailAndPassword(fbAuth, EMAIL, PW);
        } catch (e: unknown) {
          if (String((e as { code?: string })?.code ?? e).indexOf('email-already-in-use') < 0) throw e;
        }
        await realAuth.signInWithEmailAndPassword(fbAuth, EMAIL, PW);
        const uid = fbAuth.currentUser!.uid;
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await realFs.setDoc(realFs.doc(ctx.firestore(), 'users', uid), {
            email: EMAIL,
            role: 'cashier',
          });
        });
        notes.push('signed in as cashier ' + uid);

        // Seed 8 collections x N docs, rules-disabled, in ONE context.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const cdb = ctx.firestore();
          let b = realFs.writeBatch(cdb);
          let pending = 0;
          let batches = 0;
          const commit = async (): Promise<void> => {
            await b.commit();
            batches++;
            b = realFs.writeBatch(cdb);
            pending = 0;
          };
          for (const c of COLLS) {
            for (let i = 0; i < N; i++) {
              b.set(realFs.doc(cdb, c, 'k2seed' + String(i).padStart(4, '0')), { v: i });
              if (++pending >= 400) await commit();
            }
          }
          if (pending > 0) await commit();
          notes.push(`seeded 8x${N} docs in ${batches} batches`);
        });

        // Open 8 REAL listeners through the app code path (the onSnapshot
        // mock delegates to the real SDK while useReal is set), then tear
        // down at increasing delays. The initial 300-doc snapshots are
        // still in flight at the small delays — that IS the race window.
        mockCtl.useReal = true;
        const db = getDB();
        // Sanity: the app client can actually read (else the test below
        // would be vacuous — fail loudly instead of passing empty).
        const probe = await realFs.getDoc(realFs.doc(db, 'products', 'k2seed0000'));
        expect(probe.exists()).toBe(true);
        for (const delay of [0, 1, 5, 20, 50]) {
          const rels = COLLS.map((c) => subscribeToCollection(c, () => {}, []));
          await sleep(delay);
          clearSubscriptionCache();
          await sleep(150);
          await flush();
          for (const r of rels) r(); // stale releases: must be no-ops.
          await sleep(50);
          await flush();
          notes.push(`delay ${delay}ms: torn down, no error signal`);
        }
        mockCtl.useReal = false;
        try {
          await fbAuth.signOut();
        } catch {
          /* hygiene only */
        }

        done('live run complete');
        expect(failures).toEqual([]);
      } finally {
        mockCtl.useReal = false;
        process.removeListener('unhandledRejection', onRej);
        process.removeListener('uncaughtException', onExc);
        errSpy.mockRestore();
        warnSpy.mockRestore();
      }
    },
  );
});
