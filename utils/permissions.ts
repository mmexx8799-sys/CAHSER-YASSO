// utils/permissions.ts — مصدر واحد للصلاحيات (§1.4 + BR-07)
// نقي: لا React ولا Firebase — تشتق منه الواجهة وتُختبر ضده القواعد (R1/AC-10)
// القرارات G0: D-2 (أ) كما اليوم، D-3 موافقة (لكن R1 لا يشدد users/delete إلى owner بعد)، D-4 الآن، D-6 يبقى، D-7 لاحقًا
// ملاحظة R1: ledger.delete و users.manage و data.restore/reset ما زالت isAdmin() (owner+admin) — التشديد إلى owner فقط في R5 (BR-09)

import { UserRole } from '../types';

export type Capability =
  | 'sell'                // invoices create
  | 'return'              // returns create
  | 'customer.payment'    // customerPayments create
  | 'supplier.ops'        // purchaseInvoices / supplierReturns / supplierPayments create
  | 'customer.write'      // customers create/update (except openingBalance)
  | 'supplier.write'      // suppliers create/update (except openingBalance)
  | 'product.create'      // products create
  | 'product.price'       // تعديل حقول الأسعار
  | 'product.delete'      // products delete
  | 'category.write'      // categories write
  | 'settings.write'      // appSettings write
  | 'archive.open'        // dailyArchives create
  | 'archive.close'       // dailyArchives close / تعديل مقفولة
  | 'ledger.delete'       // حذف invoices/returns/payments/archives/counters
  | 'data.restore'        // restoreData
  | 'data.reset'          // factoryReset
  | 'backup.export'       // تصدير النسخة
  | 'users.manage'        // users create/update/delete
  | 'dashboard.view'      // لوحة التحكم
  | 'report.view'         // التقارير
  | 'archive.view'        // الأرشيف (D-P4: منفصلة عن report.view بنفس المصفوفة الافتراضية)
  | 'statement.export';   // تصدير كشف الحساب

// المصفوفة القانونية §1.4 — القيم boolean لكل دور
// الفرض: Rules أو UI (المحاسب بلا كتابة إطلاقًا)
const MATRIX: Record<Capability, Record<UserRole, boolean>> = {
  // كتابة عمليات — Rules
  'sell':              { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  'return':            { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  'customer.payment':  { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  // D-6 = يبقى: الكاشير يملك عمليات الموردين
  'supplier.ops':      { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  'customer.write':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  'supplier.write':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  // D-2 = (أ) كما اليوم: الكاشير ينشئ منتجًا (isStaff) — لو كان (ب) لأصبح Admin فقط
  'product.create':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: false },
  'product.price':     { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'product.delete':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'category.write':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'settings.write':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'archive.open':      { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'archive.close':     { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  // R5 (BR-09/D-3): ledger.delete و users.manage حصريًا للمالك — القواعد والواجهة معًا
  'ledger.delete':     { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'data.restore':      { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'data.reset':        { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  // UI فقط — لا فرض بالقواعد
  'backup.export':     { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false }, // D-3 موافقة: الأدمن غير المالك يفقد التصدير (يُطبق في R3/R5؛ هنا القيمة النهائية)
  'users.manage':      { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false }, // R5: owner فقط
  'dashboard.view':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  // D-2 (أ): الكاشير يرى التقارير/الأرشيف
  'report.view':       { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: true },
  // D-P4: صف archive.view مطابق لـreport.view حرفيًا (يُثبَت باختبار)
  'archive.view':      { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: true },
  'statement.export':  { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: true },
};

// PERM-2026-09 REQ-PERM-1: القدرات القابلة للتجاوز مع طبقتها (مُصدَّرة كثابت بسيط لاختبار المواءمة في REQ-PERM-2)
export const OVERRIDABLE_CAPS: Record<string, 'rules' | 'ui'> = {
  'sell': 'rules',
  'return': 'rules',
  'customer.payment': 'rules',
  'supplier.ops': 'rules',
  'product.create': 'rules',
  'product.price': 'rules',
  'product.delete': 'rules',
  'category.write': 'rules',
  'settings.write': 'rules',
  'archive.open': 'rules',
  'archive.close': 'rules',
  'customer.write': 'rules',
  'supplier.write': 'rules',
  'report.view': 'ui',
  'archive.view': 'ui',
  'dashboard.view': 'ui',
  'statement.export': 'ui',
};

// غير قابلة للتجاوز إطلاقًا: منحها/منعها يُتجاهل ويعود للمصفوفة
export const NON_OVERRIDABLE_CAPS: Capability[] = [
  'users.manage',
  'data.restore',
  'data.reset',
  'ledger.delete',
  'backup.export',
];

export interface CapOverrides {
  grants?: unknown;
  denies?: unknown;
}

// PERM-2026-09 REQ-PERM-1: القدرة الفعلية وفق SPEC 1.2 + INV-9 الدقيق:
// 1) معطّل أو دور غير صالح → false
// 2) مالك → المصفوفة (التجاوزات تُتجاهل)
// 3) قدرة غير قابلة للتجاوز → المصفوفة
// 4) قوائم مشوّهة النوع (غير array عند وجودها) → false للقدرات القابلة فقط
// 5) منع → false (يغلب المنح)
// 6) منح → true إلا كتابة المحاسب (طبقة rules تُتجاهل)
// 7) غير ذلك → المصفوفة
export function effectiveCan(
  role: string | undefined | null,
  capability: Capability,
  overrides?: CapOverrides | null,
  opts?: { disabled?: boolean },
): boolean {
  if (opts?.disabled === true) return false;
  if (!role || !(Object.values(UserRole) as string[]).includes(role)) return false;
  const row = MATRIX[capability];
  if (!row) return false;
  const base = row[role as UserRole] ?? false;
  // 2) المالك محصّن
  if (role === UserRole.Owner) return base;
  // 3) غير القابلة للتجاوز تعود للمصفوفة
  if (!(capability in OVERRIDABLE_CAPS)) return base;
  // 4) INV-9: تشوّه النوع → false للقابلة فقط (وصلنا هنا لأنها قابلة وغير مالك)
  const grants = overrides?.grants;
  const denies = overrides?.denies;
  if ((grants !== undefined && !Array.isArray(grants)) || (denies !== undefined && !Array.isArray(denies))) {
    return false;
  }
  const grantList: string[] = Array.isArray(grants) ? (grants as string[]) : [];
  const denyList: string[] = Array.isArray(denies) ? (denies as string[]) : [];
  // 5) المنع يغلب
  if (denyList.includes(capability)) return false;
  // 6) المنح (المحاسب: طبقة rules تُتجاهل، طبقة ui تُقبل)
  if (grantList.includes(capability)) {
    if (role === UserRole.Accountant && OVERRIDABLE_CAPS[capability] === 'rules') {
      return base;
    }
    return true;
  }
  // 7) الافتراضي
  return base;
}

// جميع الأدوار المغلقة — BR-01
export const ALL_ROLES: UserRole[] = [
  UserRole.Owner,
  UserRole.Admin,
  UserRole.Supervisor,
  UserRole.Cashier,
  UserRole.Accountant,
];

export function can(role: string | undefined | null, capability: Capability): boolean {
  if (!role || !(Object.values(UserRole) as string[]).includes(role)) return false;
  const row = MATRIX[capability];
  if (!row) return false;
  return row[role as UserRole] ?? false;
}

// هل الدور من طاقم الكتابة (isStaff) — يطابق hasRole(['owner','admin','supervisor','cashier']) في القواعد
export function isStaffRole(role: string | undefined | null): boolean {
  return role === UserRole.Owner || role === UserRole.Admin || role === UserRole.Supervisor || role === UserRole.Cashier;
}
export function isAdminRole(role: string | undefined | null): boolean {
  return role === UserRole.Owner || role === UserRole.Admin;
}
export function isOwnerRole(role: string | undefined | null): boolean {
  return role === UserRole.Owner;
}

// تصدير المصفوفة للاختبارات المولدة (R1/AC-10)
export const PERMISSION_MATRIX = MATRIX;
