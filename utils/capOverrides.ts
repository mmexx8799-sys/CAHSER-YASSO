// utils/capOverrides.ts — pure logic for REQ-PERM-4 (node only)
import { UserRole } from '../types';
import { can, OVERRIDABLE_CAPS, NON_OVERRIDABLE_CAPS, type Capability } from './permissions';

export const CAP_LABELS_AR: Record<string, string> = {
  'sell': 'المبيعات',
  'return': 'المرتجعات',
  'customer.payment': 'مدفوعات العملاء',
  'supplier.ops': 'عمليات الموردين',
  'customer.write': 'إدارة العملاء',
  'supplier.write': 'إدارة الموردين',
  'product.create': 'إنشاء منتج',
  'product.price': 'تعديل السعر',
  'product.delete': 'حذف منتج',
  'category.write': 'إدارة التصنيفات',
  'settings.write': 'الإعدادات',
  'archive.open': 'فتح اليومية',
  'archive.close': 'إغلاق اليومية',
  'report.view': 'عرض التقارير',
  'archive.view': 'عرض الأرشيف',
  'dashboard.view': 'لوحة التحكم',
  'statement.export': 'تصدير كشف الحساب',
};

export type CapState = 'default' | 'grant' | 'deny';
export type CapStates = Record<string, CapState>;

/**
 * تحويل حالات المودال إلى قوائم grants/denies مع تنظيف عديم الأثر.
 * - تستبعد منح لقدرة يملكها الدور أصلًا (لا أثر)
 * - تستبعد منع لقدرة لا يملكها الدور أصلًا (لا أثر)
 * - تستبعد منح كتابة للمحاسب (طبقة rules لا تُمنح)
 * - تستبعد قدرات غير قابلة للتجاوز
 * - تضمن عدم التعارض (الحالة لكل قدرة واحدة فقط)
 */
export function statesToLists(role: string | undefined, states: CapStates): { grants: string[]; denies: string[] } {
  const grants: string[] = [];
  const denies: string[] = [];
  for (const [cap, state] of Object.entries(states)) {
    if (state === 'default') continue;
    if (!(cap in OVERRIDABLE_CAPS)) continue;
    if ((NON_OVERRIDABLE_CAPS as string[]).includes(cap)) continue;
    const base = can(role as any, cap as Capability);
    if (state === 'grant') {
      if (base) continue; // already has → no effect
      if (role === UserRole.Accountant && (OVERRIDABLE_CAPS as any)[cap] === 'rules') continue; // accountant can't grant writes
      grants.push(cap);
    } else if (state === 'deny') {
      if (!base) continue; // already denied → no effect
      denies.push(cap);
    }
  }
  grants.sort();
  denies.sort();
  return { grants, denies };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function listsToStates(grants: string[] | undefined, denies: string[] | undefined, _role: string | undefined): CapStates {
  const out: CapStates = {};
  for (const cap of Object.keys(OVERRIDABLE_CAPS)) {
    if (grants?.includes(cap)) out[cap] = 'grant';
    else if (denies?.includes(cap)) out[cap] = 'deny';
    else out[cap] = 'default';
  }
  return out;
}
