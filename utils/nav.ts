// utils/nav.ts — pure navigation builders (REQ-PERM-3:4,5) — لا React/Firebase
import { UserRole } from '../types';
import { effectiveCan, type Capability } from './permissions';

export interface NavItem { to: string; label: string; }

const NAV_ORDER: Array<{ to: string; label: string; cap?: Capability; always?: boolean }> = [
  { to: '/', label: 'نقطة البيع', cap: 'sell' },
  { to: '/customers', label: 'العملاء', always: true },
  { to: '/suppliers', label: 'الموردين', always: true },
  { to: '/returns', label: 'المرتجعات', cap: 'return' },
  { to: '/products', label: 'المنتجات', cap: 'product.create' },
  { to: '/reports', label: 'التقارير', cap: 'report.view' },
  { to: '/archive', label: 'الأرشيف', cap: 'archive.view' },
  { to: '/dashboard', label: 'لوحة التحكم', cap: 'dashboard.view' },
  { to: '/settings', label: 'الإعدادات', cap: 'settings.write' },
  { to: '/users', label: 'المستخدمين', cap: 'users.manage' },
];

// Single source for route guards — App.tsx must use this (only guarded routes)
export const ROUTE_CAPS: Record<string, Capability> = {
  '/': 'sell',
  '/returns': 'return',
  '/reports': 'report.view',
  '/archive': 'archive.view',
  '/dashboard': 'dashboard.view',
  '/settings': 'settings.write',
  '/users': 'users.manage',
};

export interface Overrides { grants?: unknown; denies?: unknown; }

export function buildNavItems(
  role: string | null | undefined,
  overrides?: Overrides | null,
  opts?: { disabled?: boolean },
): NavItem[] {
  const disabled = opts?.disabled === true;
  if (disabled) return [];
  const hasValidRole = !!role && (Object.values(UserRole) as string[]).includes(role as string);
  if (!hasValidRole) {
    return [
      { to: '/customers', label: 'العملاء' },
      { to: '/suppliers', label: 'الموردين' },
      { to: '/products', label: 'المنتجات' },
    ];
  }
  const out: NavItem[] = [];
  for (const e of NAV_ORDER) {
    if (e.always) { out.push({ to: e.to, label: e.label }); continue; }
    if (e.cap && effectiveCan(role, e.cap as Capability, overrides as any, { disabled })) {
      out.push({ to: e.to, label: e.label });
    }
  }
  return out;
}

/**
 * أول مسار مسموح — لا تعيد أبدًا مسارًا ممنوعًا.
 * بلا دور → /customers (حتى لو كانت / في قائمة الملاحة، فهي محروسة بـsell)
 */
export function resolveLanding(
  role: string | null | undefined,
  overrides?: Overrides | null,
  opts?: { disabled?: boolean },
): string {
  const hasValidRole = !!role && (Object.values(UserRole) as string[]).includes(role as string);
  if (!hasValidRole) return '/customers';
  const items = buildNavItems(role, overrides, opts);
  if (items.length === 0) return '/customers';
  // تأكد أن الأول ليس محجوبًا (للحسابات المحظورة)
  for (const it of items) {
    const cap = ROUTE_CAPS[it.to];
    if (!cap) return it.to;
    if (effectiveCan(role, cap, overrides as any, opts)) return it.to;
  }
  return '/customers';
}
