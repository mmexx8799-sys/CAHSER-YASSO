// REQ-RBAC-3 AC-07 — permissionsParity (نقي، بلا محاكي)
// كل مسار وكل عنصر ملاحة مرتبط بقدرة موجودة في جدول utils/permissions.ts — لا قدرة يتيمة
import { describe, it, expect } from 'vitest';
import { PERMISSION_MATRIX, can, OVERRIDABLE_CAPS, NON_OVERRIDABLE_CAPS, effectiveCan } from '../utils/permissions';
import { UserRole } from '../types';

describe('permissionsParity — single source (BR-07)', () => {
  it('كل قدرة في المصفوفة لها على الأقل دور واحد يملكها ولا يتيمة', () => {
    for (const [cap, row] of Object.entries(PERMISSION_MATRIX)) {
      const owners = Object.entries(row).filter(([, v]) => v).map(([k]) => k);
      // كل قدرة يجب أن يملكها على الأقل دور واحد (وإلا فهي يتيمة)
      expect(owners.length, `capability ${cap} has no owner`).toBeGreaterThan(0);
      // كل مفتاح دور في الصف يجب أن يكون من UserRole
      for (const role of Object.keys(row)) {
        expect(Object.values(UserRole)).toContain(role);
      }
    }
  });

  it('المحاسب بلا كتابة (SR-07): كل قدرات الكتابة false للمحاسب', () => {
    const writeCaps = ['sell','return','customer.payment','supplier.ops','customer.write','supplier.write','product.create','product.price','product.delete','category.write','settings.write','archive.open','archive.close','ledger.delete','data.restore','data.reset','users.manage'] as const;
    for (const cap of writeCaps) {
      expect(can(UserRole.Accountant, cap as any), `accountant should not have ${cap}`).toBe(false);
    }
  });

  it('مسارات الملاحة تغطي القدرات المتوقعة', () => {
    // Mapping المتوقع في App.tsx (useNavItems + RequireCapability) — يجب أن يكون موجودًا في المصفوفة
    const expectedNavCaps = ['report.view', 'archive.view', 'dashboard.view', 'settings.write', 'users.manage'];
    for (const cap of expectedNavCaps) {
      expect(PERMISSION_MATRIX).toHaveProperty(cap);
    }
  });

  it('REQ-PERM-1: صف archive.view مطابق لـreport.view حرفيًا', () => {
    expect(PERMISSION_MATRIX['archive.view']).toEqual(PERMISSION_MATRIX['report.view']);
  });

  it('REQ-PERM-1: OVERRIDABLE_CAPS/NON_OVERRIDABLE_CAPS متسقة مع المصفوفة', () => {
    for (const cap of Object.keys(OVERRIDABLE_CAPS)) {
      expect(PERMISSION_MATRIX).toHaveProperty(cap);
    }
    for (const cap of NON_OVERRIDABLE_CAPS) {
      expect(PERMISSION_MATRIX).toHaveProperty(cap);
      expect(OVERRIDABLE_CAPS).not.toHaveProperty(cap);
    }
    // غياب التجاوزات ⇒ effectiveCan يطابق can لكل (دور × قدرة)
    const allRoles = [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant];
    for (const role of allRoles) {
      for (const cap of Object.keys(PERMISSION_MATRIX) as (keyof typeof PERMISSION_MATRIX)[]) {
        expect(effectiveCan(role, cap as any)).toBe(can(role, cap as any));
      }
    }
  });

  it('لا role === حرفي خارج permissions.ts/types.ts (grep check is done in CI, here sanity on can() API)', () => {
    // يتأكد أن can() تتعامل مع كل الأدوار الخمسة بلا استثناء
    const allRoles = [UserRole.Owner, UserRole.Admin, UserRole.Supervisor, UserRole.Cashier, UserRole.Accountant];
    for (const role of allRoles) {
      expect(typeof can(role, 'sell')).toBe('boolean');
    }
    expect(can(undefined as any, 'sell')).toBe(false);
    expect(can('manager' as any, 'sell')).toBe(false);
  });
});
