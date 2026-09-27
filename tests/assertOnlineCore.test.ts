// OFF1-2 — assertOnlineCore unit tests (pure, deterministic, fast).
//
// Covers the six branches of the offline guard WITHOUT network, timers, or
// emulator: deps are scripted (isOnline boolean/sequence, ping
// resolve/reject/hang, immediate delay). The production wrapper assertOnline()
// keeps its MODE==='test' bypass untouched — zero impact on the 361 existing
// service tests — while 100% of the branching logic lives in the core tested
// here.
//
// Run single file:
//   npx firebase emulators:exec --only firestore,auth "npx vitest run tests/assertOnlineCore.test.ts"
// (no emulator actually needed — pure unit; runs inside the standard suite.)

import { describe, it, expect, vi } from 'vitest';

// tests/setup.ts already mocks react-hot-toast before this import.
const { assertOnlineCore } = await import('../services/api');

const MSG_A = /أنت غير متصل بالإنترنت/;
const MSG_B = /تحقق من الشبكة/;

// Immediate delay: timeouts win instantly, tests never wait real seconds.
const immediateDelay = async (_ms: number) => {};
// Never-settling ping: simulates a hung network (Captive Portal blackhole).
const hang = (): Promise<unknown> => new Promise(() => {});
const failWith = (err: any): Promise<unknown> => Promise.reject(err);

describe('OFF1-2 — assertOnlineCore branches', () => {
  it('hard-offline rejects immediately with msg A and never pings (fail-fast order)', async () => {
    const ping = vi.fn(async () => {});
    await expect(
      assertOnlineCore({ isOnline: () => false, ping, delay: immediateDelay }),
    ).rejects.toThrow(MSG_A);
    expect(ping).not.toHaveBeenCalled();
  });

  it('online + ping success resolves; online + permission-denied-shaped rejection resolves as online', async () => {
    await expect(
      assertOnlineCore({ isOnline: () => true, ping: async () => {}, delay: immediateDelay }),
    ).resolves.toBeUndefined();
    await expect(
      assertOnlineCore({
        isOnline: () => true,
        ping: () => failWith({ code: 'permission-denied', message: 'denied' }),
        delay: immediateDelay,
      }),
    ).resolves.toBeUndefined();
  });

  it('first ping hangs, retry succeeds → resolves and ping runs twice', async () => {
    const ping = vi
      .fn()
      .mockImplementationOnce(hang)
      .mockImplementationOnce(async () => {});
    await expect(
      assertOnlineCore({ isOnline: () => true, ping, delay: immediateDelay }),
    ).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('double hang (timeout twice) → rejects with msg B and ping runs twice', async () => {
    const ping = vi.fn(hang);
    await expect(
      assertOnlineCore({ isOnline: () => true, ping, delay: immediateDelay }),
    ).rejects.toThrow(MSG_B);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('real network error on first try → rejects with msg A immediately, ping runs once (no retry)', async () => {
    const ping = vi.fn(() => failWith({ code: 'unavailable', message: 'unavailable' }));
    await expect(
      assertOnlineCore({ isOnline: () => true, ping, delay: immediateDelay }),
    ).rejects.toThrow(MSG_A);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('isOnline re-read live: weird-error + now-offline rejects B; weird-error + still-online resolves', async () => {
    // Online at entry, offline at catch-time: the re-check (!isOnline()) flips
    // a pass into a msg-B rejection — proves fresh reads, not a stored value.
    const isOnline = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const ping = vi
      .fn()
      .mockImplementationOnce(hang)
      .mockImplementationOnce(() => failWith({ code: 'weird-x', message: 'weird-x' }));
    await expect(
      assertOnlineCore({ isOnline, ping, delay: immediateDelay }),
    ).rejects.toThrow(MSG_B);
    expect(isOnline.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Same errors but still online → treated as online, resolves.
    await expect(
      assertOnlineCore({
        isOnline: () => true,
        ping: () => failWith({ code: 'weird-x', message: 'weird-x' }),
        delay: immediateDelay,
      }),
    ).resolves.toBeUndefined();
  });
});
