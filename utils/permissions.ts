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
  | 'report.view'         // التقارير/الأرشيف
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
  // R1: لا تشديد إلى owner بعد — يبقى isAdmin()؛ R5 ينقل إلى owner فقط (BR-09)
  'ledger.delete':     { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'data.restore':      { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  'data.reset':        { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  // UI فقط — لا فرض بالقواعد
  'backup.export':     { [UserRole.Owner]: true,  [UserRole.Admin]: false, [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false }, // D-3 موافقة: الأدمن غير المالك يفقد التصدير (يُطبق في R3/R5؛ هنا القيمة النهائية)
  'users.manage':      { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false }, // R1: admin يستطيع؛ R5: owner فقط
  'dashboard.view':    { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: false, [UserRole.Cashier]: false, [UserRole.Accountant]: false },
  // D-2 (أ): الكاشير يرى التقارير/الأرشيف
  'report.view':       { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: true },
  'statement.export':  { [UserRole.Owner]: true,  [UserRole.Admin]: true,  [UserRole.Supervisor]: true,  [UserRole.Cashier]: true,  [UserRole.Accountant]: true },
};

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
