// REQ-RBAC-3 AC-07 — permissionsParity (نقي، بلا محاكي)
// كل مسار وكل عنصر ملاحة مرتبط بقدرة موجودة في جدول utils/permissions.ts — لا قدرة يتيمة
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
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

describe('permissionsRulesAlignment — TS ↔ firestore.rules (REQ-PERM-2)', () => {
  const rulesText = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../firestore.rules'), 'utf8');
  it('overridableCaps() في القواعد تطابق OVERRIDABLE_CAPS حرفيًا كمجموعة', () => {
    const m = rulesText.match(/function overridableCaps\(\)\s*\{\s*return\s*\[([\s\S]*?)\];/);
    expect(m, 'overridableCaps() found in rules').not.toBeNull();
    const inRules = new Set((m![1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)));
    expect(inRules).toEqual(new Set(Object.keys(OVERRIDABLE_CAPS)));
  });
  it("كل hasCap('<cap>', [...]) يطابق قائمة أدوار المصفوفة", () => {
    const re = /hasCap\('([^']+)',\s*\[([^\]]*)\]\)/g;
    const found = new Map<string, Set<string>>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(rulesText)) !== null) {
      const roles = new Set((m[2].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)));
      if (found.has(m[1])) {
        // نفس القدرة قد تظهر في create وupdate — القوائم يجب أن تتطابق
        expect(roles, `consistent roles for ${m[1]}`).toEqual(found.get(m[1]));
      } else {
        found.set(m[1], roles);
      }
    }
    // كل قدرة طبقة A تظهر مرة على الأقل
    const layerA = Object.entries(OVERRIDABLE_CAPS).filter(([, l]) => l === 'rules').map(([c]) => c);
    for (const cap of layerA) {
      expect(found.has(cap), `hasCap present for ${cap}`).toBe(true);
    }
    // قدرات الطبقة B لا تظهر أبدًا في hasCap (واجهة فقط)
    for (const cap of Object.entries(OVERRIDABLE_CAPS).filter(([, l]) => l === 'ui').map(([c]) => c)) {
      expect(found.has(cap), `UI-only ${cap} absent from hasCap`).toBe(false);
    }
    // مطابقة الأدوار مع المصفوفة
    for (const [cap, roles] of found) {
      const expected = new Set(
        (Object.entries((PERMISSION_MATRIX as any)[cap]) as [string, boolean][]).filter(([, v]) => v).map(([r]) => r),
      );
      expect(roles, `roles for ${cap}`).toEqual(expected);
    }
  });
});
