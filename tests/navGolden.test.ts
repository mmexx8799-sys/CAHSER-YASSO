// tests/navGolden.test.ts — Golden قبل/بعد لإعادة الهيكلة (REQ-PERM-3:5) — node only
import { describe, it, expect } from 'vitest';
import { UserRole } from '../types';
import { buildNavItems, resolveLanding, ROUTE_CAPS } from '../utils/nav';
import { effectiveCan } from '../utils/permissions';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// المخرج الحالي قبل التعديل سُجل هنا كـ Golden — أي انحراف غير مقصود يفشل.
// بلا تجاوزات: الأصل App.tsx 73-107 (القديم: بلا دور => كل شيء). الجديد: بلا دور => 3 أساسية (customers/suppliers/products) — / و/returns محروسان.
// disabled => []
describe('navGolden — buildNavItems (no overrides)', () => {
  const cases: Array<[string|null, string[]]> = [
    [UserRole.Owner, ['/','/customers','/suppliers','/returns','/products','/reports','/archive','/dashboard','/settings','/users']],
    [UserRole.Admin, ['/','/customers','/suppliers','/returns','/products','/reports','/archive','/dashboard','/settings']],
    [UserRole.Supervisor, ['/','/customers','/suppliers','/returns','/products','/reports','/archive']],
    [UserRole.Cashier, ['/','/customers','/suppliers','/returns','/products','/reports','/archive']],
    [UserRole.Accountant, ['/customers','/suppliers','/reports','/archive']],
    [null, ['/customers','/suppliers','/products']],
    [undefined as any, ['/customers','/suppliers','/products']],
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
  it('عقد ROUTE_CAPS: resolveLanding يعيد مسارًا مسموحًا يجتاز حارسه', () => {
    const roles: any[] = [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant, null];
    const variantOverrides: any[] = [null, { denies: ['sell'] }, { denies: ['return'] }, { grants: ['product.price'] }, { denies: ['report.view','archive.view'] }];
    for (const r of roles) for (const o of variantOverrides) {
      const landing = resolveLanding(r, o, { disabled: false });
      expect(landing).toBeTruthy();
      const cap = (ROUTE_CAPS as any)[landing];
      if (cap) {
        expect(effectiveCan(r, cap, o, { disabled: false }), `landing \${landing} blocked for \${r} \${JSON.stringify(o)}`).toBe(true);
      } else {
        // customers/suppliers always
        expect(['/customers','/suppliers']).toContain(landing);
      }
    }
    expect(resolveLanding(null, null, { disabled: false })).toBe('/customers');
    expect(resolveLanding(undefined as any, null, { disabled: false })).toBe('/customers');
  });
  it('فصل archive.view عن report.view', () => {
    expect(buildNavItems(UserRole.Cashier, { denies: ['report.view'] } as any).map(i=>i.to)).toEqual(['/','/customers','/suppliers','/returns','/products','/archive']);
    expect(buildNavItems(UserRole.Cashier, { denies: ['archive.view'] } as any).map(i=>i.to)).toEqual(['/','/customers','/suppliers','/returns','/products','/reports']);
  });
  it('ROUTE_CAPS مصدر واحد: App.tsx المحروس يطابق الجدول بالضبط', () => {
    const appText = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');
    const pairs: Array<[string,string]> = [];
    // App.tsx guarded routes are written as <Route path="X" element={<RequireCapability capability="Y">
    const reGuard = /<Route path="([^"]+)" element=\{<RequireCapability capability="([^"]+)">/g;
    let m: RegExpExecArray | null;
    while ((m = reGuard.exec(appText)) !== null) pairs.push([m[1], m[2]]);
    const map = new Map(pairs);
    expect(map).toEqual(new Map(Object.entries(ROUTE_CAPS)));
  });
});
