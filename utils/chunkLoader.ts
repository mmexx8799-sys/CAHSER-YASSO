// REQ-UX-CHUNK-RETRY: chunk load retry + session-scoped reload guard.
// Fails closed: retry in-session, one guarded page reload, then ErrorBoundary fallback.
// sessionStorage scope = tab session — a fresh tab is never blocked by an old guard.

import { lazy } from 'react';
import type { ComponentType } from 'react';

export const CHUNK_RETRY_GUARD_KEY = 'chunk-reload-guard';

export const MAX_CHUNK_RETRIES = 2;

export interface ChunkLoaderDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload?: () => void;
  delay?: (ms: number) => Promise<void>;
}

const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Loading CSS chunk',
  'dynamically imported module',
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof (err as Error).message !== 'string') return false;
  if ((err as Error).name === 'ChunkLoadError') return true;
  const msg = (err as Error).message;
  return CHUNK_ERROR_PATTERNS.some(p => msg.includes(p));
}

function defaultDeps(): ChunkLoaderDeps {
  const g = globalThis as { sessionStorage?: Storage; location?: { reload?: () => void } };
  return {
    storage: g.sessionStorage,
    reload: () => { g.location?.reload?.(); },
    delay: (ms: number) => new Promise(res => setTimeout(res, ms)),
  };
}

export function hasChunkReloadGuard(deps?: ChunkLoaderDeps): boolean {
  const { storage } = { ...defaultDeps(), ...deps };
  return !!storage && storage.getItem(CHUNK_RETRY_GUARD_KEY) != null;
}

export function setChunkReloadGuard(key: string, deps?: ChunkLoaderDeps): void {
  const { storage } = { ...defaultDeps(), ...deps };
  if (!storage) return;
  storage.setItem(CHUNK_RETRY_GUARD_KEY, key);
}

export function clearChunkReloadGuard(deps?: ChunkLoaderDeps): void {
  const { storage } = { ...defaultDeps(), ...deps };
  if (!storage) return;
  storage.removeItem(CHUNK_RETRY_GUARD_KEY);
}

export async function importChunk<T>(
  key: string,
  factory: () => Promise<T>,
  deps?: ChunkLoaderDeps,
): Promise<T> {
  const d = { ...defaultDeps(), ...deps };
  try {
    return await factory();
  } catch (first) {
    let last = first;
    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      await d.delay?.(attempt * 300);
      try {
        return await factory();
      } catch (err) {
        last = err;
      }
    }
    // In-session retries exhausted. One guarded reload per session: the guard
    // prevents an infinite reload loop if the failure is permanent.
    if (d.storage && storageRead(d.storage) == null) {
      d.storage.setItem(CHUNK_RETRY_GUARD_KEY, key);
      d.reload?.();
    }
    throw last;
  }
}

function storageRead(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(CHUNK_RETRY_GUARD_KEY);
  } catch {
    return CHUNK_RETRY_GUARD_KEY; // unreadable storage = behave as guarded (no reload)
  }
}

export function lazyChunk(
  key: string,
  factory: () => Promise<{ default: ComponentType<unknown> }>,
  deps?: ChunkLoaderDeps,
): { $$typeof: symbol; _payload: unknown; _init: unknown } & ComponentType<unknown> {
  return lazy(() => importChunk(key, factory, deps)) as never;
}
