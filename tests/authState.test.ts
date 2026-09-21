// tests/authState.test.ts — جدول حالات نقية (REQ-PERM-3:3) node only
import { describe, it, expect } from 'vitest';
import { decideSnapshotAction, shouldFlagUnresolved, decideErrorAction } from '../utils/authState';

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

describe('shouldFlagUnresolved', () => {
  it('no server + no resolved user => true', () => expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: false })).toBe(true));
  it('no server + has resolved user (cache) => false', () => expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: true })).toBe(false));
  it('has server => false regardless', () => expect(shouldFlagUnresolved({ hasServerSnapshot: true, hasResolvedUser: false })).toBe(false));
  it('has server + has user => false', () => expect(shouldFlagUnresolved({ hasServerSnapshot: true, hasResolvedUser: true })).toBe(false));
  it('decideErrorAction: hasRealUser=false ⇒ tempUnresolved، true ⇒ keep', () => {
    expect(decideErrorAction({ hasRealUser: false })).toBe('tempUnresolved');
    expect(decideErrorAction({ hasRealUser: true })).toBe('keep');
  });
  it('تسلسل حقيقي: خطأ → إعادة محاولة → خطأ ⇒ unresolved (المؤقت لا يُحتسب كحقيقي)', () => {
    let hasRealUser = false;
    // أول خطأ: لا مستخدم حقيقي → tempUnresolved
    expect(decideErrorAction({ hasRealUser })).toBe('tempUnresolved');
    // بعد الخطأ يُنشأ مستخدم مؤقت لكن hasRealUser يبقى false
    expect(hasRealUser).toBe(false);
    // إعادة محاولة: hasServerSnapshot=false, hasResolvedUser=false → unresolved
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: hasRealUser })).toBe(true);
    // خطأ ثانٍ بعد إعادة المحاولة: ما زال لا حقيقي → tempUnresolved مرة أخرى
    expect(decideErrorAction({ hasRealUser })).toBe('tempUnresolved');
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: hasRealUser })).toBe(true);
    // لو وصلت لقطة حقيقية، يصبح hasRealUser=true ولا unresolved بعدها
    hasRealUser = true;
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: hasRealUser })).toBe(false);
    expect(decideErrorAction({ hasRealUser })).toBe('keep');
  });
});
