// tests/authState.test.ts — جدول حالات نقية (REQ-PERM-3:3) node only
import { describe, it, expect } from 'vitest';
import { decideSnapshotAction, decideInitialPhase } from '../utils/authState';

describe('decideSnapshotAction', () => {
  const table: Array<[boolean, boolean, string]> = [
    [true, true, 'use'],
    [true, false, 'use'],
    [false, true, 'wait'],
    [false, false, 'signOut'],
  ];
  for (const [exists, fromCache, expected] of table) {
    it(`exists=${exists} fromCache=${fromCache} => ${expected}`, () => {
      expect(decideSnapshotAction(exists, fromCache)).toBe(expected);
    });
  }
});

describe('decideInitialPhase', () => {
  it('server exists => ready', () => expect(decideInitialPhase({ hasServerSnapshot: true, lastExists: true, lastFromCache: false, hasError: false })).toBe('ready'));
  it('server missing => signOut', () => expect(decideInitialPhase({ hasServerSnapshot: true, lastExists: false, lastFromCache: false, hasError: false })).toBe('signOut'));
  it('only cache + no server yet => wait', () => expect(decideInitialPhase({ hasServerSnapshot: false, lastExists: true, lastFromCache: true, hasError: false })).toBe('wait'));
  it('error before server => unresolved', () => expect(decideInitialPhase({ hasServerSnapshot: false, lastExists: null, lastFromCache: null, hasError: true })).toBe('unresolved'));
});
