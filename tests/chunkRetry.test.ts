// REQ-UX-CHUNK-RETRY — retry + session reload guard (utils/chunkLoader.ts)
// Run: npx vitest run tests/chunkRetry.test.ts

import { describe, it, expect } from 'vitest';
import {
  importChunk,
  isChunkLoadError,
  hasChunkReloadGuard,
  setChunkReloadGuard,
  clearChunkReloadGuard,
  CHUNK_RETRY_GUARD_KEY,
  MAX_CHUNK_RETRIES,
} from '../utils/chunkLoader';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    _map: m,
  };
}

function failingFactory() {
  return Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/POSPage-abc123.js'));
}

describe('REQ-UX-CHUNK-RETRY: retry succeeds after transient failures', () => {
  it('fails twice then succeeds: resolves without reload and without guard', async () => {
    const storage = fakeStorage();
    const reloads: number[] = [];
    let attempts = 0;
    const delays: number[] = [];
    const mod = await importChunk(
      'POSPage',
      () => {
        attempts++;
        return attempts <= 2 ? failingFactory() : Promise.resolve({ default: () => null });
      },
      { storage, reload: () => reloads.push(1), delay: (ms) => { delays.push(ms); return Promise.resolve(); } },
    );
    expect(mod.default).toBeDefined();
    expect(attempts).toBe(3); // 1 initial + 2 retries
    expect(reloads).toHaveLength(0);
    expect(hasChunkReloadGuard({ storage })).toBe(false);
    expect(delays).toEqual([300, 600]);
  });
});

describe('REQ-UX-CHUNK-RETRY: permanent failure — one guarded reload, then fail closed', () => {
  it('permanent failure: reloads once, sets guard, throws; second attempt throws without reload', async () => {
    const storage = fakeStorage();
    let reloads = 0;
    const deps = { storage, reload: () => { reloads++; }, delay: () => Promise.resolve() };

    await expect(importChunk('POSPage', failingFactory, deps)).rejects.toThrow(/dynamically imported module/);
    expect(reloads).toBe(1);
    expect(storage.getItem(CHUNK_RETRY_GUARD_KEY)).toBe('POSPage');

    // after the reload the new page instance fails again — guard blocks a second reload
    await expect(importChunk('POSPage', failingFactory, deps)).rejects.toThrow();
    expect(reloads).toBe(1);
    expect(storage.getItem(CHUNK_RETRY_GUARD_KEY)).toBe('POSPage');
    expect(MAX_CHUNK_RETRIES).toBe(2);
  });
});

describe('REQ-UX-CHUNK-RETRY: refresh button path (ErrorBoundary)', () => {
  it('clearChunkReloadGuard removes the guard so the next reload may retry once more', async () => {
    const storage = fakeStorage();
    const deps = { storage, reload: () => {}, delay: () => Promise.resolve() };
    setChunkReloadGuard('POSPage', deps);
    expect(hasChunkReloadGuard(deps)).toBe(true);
    clearChunkReloadGuard(deps);
    expect(hasChunkReloadGuard(deps)).toBe(false);
  });
});

describe('REQ-UX-CHUNK-RETRY: isChunkLoadError detection', () => {
  it('recognizes chunk load errors and rejects unrelated errors', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
