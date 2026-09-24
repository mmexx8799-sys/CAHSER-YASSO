// REQ-PERM-1 — اختبارات نقية لـ effectiveCan (بلا محاكي)
import { describe, it, expect } from 'vitest';
import {
  can,
  effectiveCan,
  OVERRIDABLE_CAPS,
  NON_OVERRIDABLE_CAPS,
  PERMISSION_MATRIX,
  ALL_ROLES,
  type Capability,
} from '../utils/permissions';
import { UserRole } from '../types';

describe('permissionsOverrides — effectiveCan (REQ-PERM-1)', () => {
  it('المالك محصّن: التجاوزات تُتجاهل ويعود للمصفوفة', () => {
    for (const cap of Object.keys(PERMISSION_MATRIX) as Capability[]) {
      expect(effectiveCan(UserRole.Owner, cap, { grants: ['sell'], denies: ['sell'] })).toBe(can(UserRole.Owner, cap));
      expect(effectiveCan(UserRole.Owner, cap, { grants: [cap], denies: [cap] })).toBe(can(UserRole.Owner, cap));
    }
    // حتى مع قوائم مشوّهة يبقى المالك على المصفوفة (INV-9 بعد فحص المالك)
    expect(effectiveCan(UserRole.Owner, 'sell', { grants: 'sell' as any })).toBe(true);
    expect(effectiveCan(UserRole.Owner, 'sell', { denies: 123 as any })).toBe(true);
  });

  it('المنع يغلب المنح دائمًا', () => {
    expect(effectiveCan(UserRole.Cashier, 'sell', { grants: ['sell'], denies: ['sell'] })).toBe(false);
    expect(effectiveCan(UserRole.Supervisor, 'product.price', { grants: ['product.price'], denies: ['product.price'] })).toBe(false);
    expect(effectiveCan(UserRole.Cashier, 'report.view', { grants: ['report.view'], denies: ['report.view'] })).toBe(false);
  });

  it('منح قدرة غير قابلة للتجاوز يُتجاهل ويعود للمصفوفة', () => {
    for (const cap of NON_OVERRIDABLE_CAPS) {
      for (const role of ALL_ROLES) {
        expect(
          effectiveCan(role, cap, { grants: [cap] }),
          `${role} + grant ${cap}`,
        ).toBe(can(role, cap));
        expect(
          effectiveCan(role, cap, { denies: [cap] }),
          `${role} + deny ${cap}`,
        ).toBe(can(role, cap));
      }
    }
  });

  it('المحاسب: منح طبقة A يُتجاهل، ومنح طبقة B يُقبل، والمنع يُقبل للكل', () => {
    const rulesCaps = Object.entries(OVERRIDABLE_CAPS)
      .filter(([, layer]) => layer === 'rules')
      .map(([cap]) => cap as Capability);
    const uiCaps = Object.entries(OVERRIDABLE_CAPS)
      .filter(([, layer]) => layer === 'ui')
      .map(([cap]) => cap as Capability);
    expect(rulesCaps.length).toBeGreaterThan(0);
    expect(uiCaps.length).toBeGreaterThan(0);
    for (const cap of rulesCaps) {
      expect(effectiveCan(UserRole.Accountant, cap, { grants: [cap] }), `accountant grant rules ${cap}`).toBe(false);
    }
    for (const cap of uiCaps) {
      // المحاسب يملك الطبقة B أصلًا في المصفوفة؛ المنح يبقيها true
      expect(effectiveCan(UserRole.Accountant, cap, { grants: [cap] }), `accountant grant ui ${cap}`).toBe(true);
      // المنع يُقبل للكل بما فيه المحاسب
      expect(effectiveCan(UserRole.Accountant, cap, { denies: [cap] }), `accountant deny ui ${cap}`).toBe(false);
    }
    // منع قدرة كتابة عن كاشير يملكها افتراضيًا
    expect(effectiveCan(UserRole.Cashier, 'sell', { denies: ['sell'] })).toBe(false);
    // منح قدرة كتابة لدور لا يملكها
    expect(effectiveCan(UserRole.Supervisor, 'product.price', { grants: ['product.price'] })).toBe(true);
    expect(effectiveCan(UserRole.Cashier, 'product.price', { grants: ['product.price'] })).toBe(true);
  });

  it('قائمة مشوّهة النوع ⇒ false للقدرات القابلة فقط (INV-9 الدقيق)', () => {
    // قابلة → false
    expect(effectiveCan(UserRole.Cashier, 'sell', { grants: 'sell' as any })).toBe(false);
    expect(effectiveCan(UserRole.Cashier, 'sell', { denies: 'sell' as any })).toBe(false);
    expect(effectiveCan(UserRole.Admin, 'report.view', { grants: 123 as any })).toBe(false);
    // غير قابلة → تعود للمصفوفة كالعادة رغم التشوّه
    expect(effectiveCan(UserRole.Cashier, 'users.manage', { grants: 'x' as any })).toBe(can(UserRole.Cashier, 'users.manage'));
    expect(effectiveCan(UserRole.Owner, 'ledger.delete', { denies: 1 as any })).toBe(can(UserRole.Owner, 'ledger.delete'));
    expect(effectiveCan(UserRole.Admin, 'ledger.delete', { grants: {} as any })).toBe(can(UserRole.Admin, 'ledger.delete'));
  });

  it('غياب الحقلين ⇒ مطابق لـcan لكل (دور × قدرة)', () => {
    for (const role of ALL_ROLES) {
      for (const cap of Object.keys(PERMISSION_MATRIX) as Capability[]) {
        expect(effectiveCan(role, cap), `${role} × ${cap}`).toBe(can(role, cap));
        expect(effectiveCan(role, cap, {}), `${role} × ${cap} {}`).toBe(can(role, cap));
        expect(effectiveCan(role, cap, { grants: [], denies: [] }), `${role} × ${cap} []`).toBe(can(role, cap));
      }
    }
  });

  it('معطَّل ⇒ false دائمًا (حتى المالك وحتى مع منح)', () => {
    for (const cap of Object.keys(PERMISSION_MATRIX) as Capability[]) {
      expect(effectiveCan(UserRole.Owner, cap, undefined, { disabled: true })).toBe(false);
      expect(effectiveCan(UserRole.Cashier, cap, { grants: [cap] }, { disabled: true })).toBe(false);
    }
  });

  it('دور غير صالح ⇒ false', () => {
    expect(effectiveCan(undefined as any, 'sell')).toBe(false);
    expect(effectiveCan('manager' as any, 'sell', { grants: ['sell'] })).toBe(false);
  });

  it('صف archive.view مطابق لـreport.view حرفيًا (D-P4)', () => {
    expect(PERMISSION_MATRIX['archive.view']).toEqual(PERMISSION_MATRIX['report.view']);
  });

  it('OVERRIDABLE_CAPS ثابت بسيط قابل للقراءة من اختبار المواءمة', () => {
    expect(typeof OVERRIDABLE_CAPS).toBe('object');
    // 13 طبقة rules + 4 طبقة ui = 17
    expect(Object.keys(OVERRIDABLE_CAPS)).toHaveLength(17);
    expect(Object.values(OVERRIDABLE_CAPS).filter((v) => v === 'rules')).toHaveLength(13);
    expect(Object.values(OVERRIDABLE_CAPS).filter((v) => v === 'ui')).toHaveLength(4);
    for (const cap of NON_OVERRIDABLE_CAPS) {
      expect(OVERRIDABLE_CAPS).not.toHaveProperty(cap);
    }
  });
});
