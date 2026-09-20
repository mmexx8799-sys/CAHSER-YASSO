// tests/navGolden.test.ts — Golden قبل/بعد لإعادة الهيكلة (REQ-PERM-3:5) — node only
import { describe, it, expect } from 'vitest';
import { UserRole } from '../types';
import { buildNavItems, resolveLanding } from '../utils/nav';

// المخرج الحالي قبل التعديل سُجل هنا كـ Golden — أي انحراف غير مقصود يفشل.
// بلا تجاوزات: الأصل App.tsx 73-107 (القديم: بلا دور => كل شيء). الجديد: بلا دور => 5 أساسية.
// disabled => []
describe('navGolden — buildNavItems (no overrides)', () => {
  const cases: Array<[string|null, string[]]> = [
    [UserRole.Owner, ['/','/customers','/suppliers','/returns','/products','/reports','/archive','/dashboard','/settings','/users']],
    [UserRole.Admin, ['/','/customers','/suppliers','/returns','/products','/reports','/archive','/dashboard','/settings']],
    [UserRole.Supervisor, ['/','/customers','/suppliers','/returns','/products','/reports','/archive']],
    [UserRole.Cashier, ['/','/customers','/suppliers','/returns','/products','/reports','/archive']],
    [UserRole.Accountant, ['/customers','/suppliers','/reports','/archive']],
    [null, ['/','/customers','/suppliers','/returns','/products']],
    [undefined as any, ['/','/customers','/suppliers','/returns','/products']],
  ];
  for (const [role, expected] of cases) {
    it(`role=${role ?? 'null'} => ${expected.join(',')}`, () => {
      const got = buildNavItems(role as any, null, { disabled: false }).map(i=>i.to);
      expect(got).toEqual(expected);
    });
  }
  it('disabled => [] (كل الأدوار)', () => {
    for (const r of [UserRole.Owner, UserRole.Cashier, null]) {
      expect(buildNavItems(r as any, null, { disabled: true })).toEqual([]);
    }
  });
  it('resolveLanding never returns forbidden path', () => {
    for (const r of [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant, null]) {
      const landing = resolveLanding(r as any, null, { disabled: false });
      const nav = buildNavItems(r as any, null, { disabled: false }).map(i=>i.to);
      if (nav.length) expect(nav).toContain(landing);
    }
    // ممنوع من كل شيء: accountant + deny reports/archive => يبقى customers
    expect(resolveLanding(UserRole.Accountant, { denies: ['report.view','archive.view'] } as any, { disabled: false })).toBe('/customers');
  });
  it('فصل archive.view عن report.view', () => {
    expect(buildNavItems(UserRole.Cashier, { denies: ['report.view'] } as any).map(i=>i.to)).toEqual(['/','/customers','/suppliers','/returns','/products','/archive']);
    expect(buildNavItems(UserRole.Cashier, { denies: ['archive.view'] } as any).map(i=>i.to)).toEqual(['/','/customers','/suppliers','/returns','/products','/reports']);
  });
});
