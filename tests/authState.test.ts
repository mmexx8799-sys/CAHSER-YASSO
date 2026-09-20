// tests/authState.test.ts — جدول حالات نقية (REQ-PERM-3:3) node only
import { describe, it, expect } from 'vitest';
import { decideSnapshotAction, shouldFlagUnresolved } from '../utils/authState';

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
  it('تسلسل خطأ → إعادة محاولة → خطأ/مهلة ⇒ unresolved (المستخدم المؤقت لا يُحتسب)', () => {
    // أول خطأ قبل أي لقطة حقيقية: hasRealUser=false → unresolved
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: false })).toBe(true);
    // بعد إنشاء مستخدم مؤقت بلا دور (من فرع الخطأ) لا يصبح hasRealUser=true، فإعادة المحاولة الثانية التي تفشل/تنتهي مهلتها تبقى unresolved
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: false })).toBe(true);
    // لو كان لدينا لقطة cache حقيقية، فلا unresolved
    expect(shouldFlagUnresolved({ hasServerSnapshot: false, hasResolvedUser: true })).toBe(false);
  });
});
