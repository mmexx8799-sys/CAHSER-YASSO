
export interface AppSettings {
  appName: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  price: number;
  retailCashPrice?: number;
  retailCreditPrice?: number;
  wholesaleCashPrice?: number;
  wholesaleCreditPrice?: number;
  quantity: number;
  minQuantity?: number; // الحد الأدنى للمخزون (افتراضي 5 لو غير محدد)
  categoryId: string;
  createdAt: number;
  searchableIndex: string[];
  barcode?: string; // REQ-BARCODE: باركود داخلي اختياري (MKT…) منفصل عن code — لا Migration للبيانات القديمة
}

export interface Customer {
  id: string;
  name:string;
  phone?: string;
  address?: string;
  balance: number; // الرصيد الحالي (مدين/دائن)
  openingBalance?: number; // الرصيد الافتتاحي التاريخي — ثابت لا تتغير معه العمليات (REQ-M8)
  createdAt: number;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  amount: number;
  date: number;
  notes?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  balance: number; // موجب = احنا مديونين له
  openingBalance?: number; // الرصيد الافتتاحي التاريخي — ثابت لا تتغير معه العمليات (REQ-M8)
  createdAt: number;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number;
  date: number;
  notes?: string;
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  items: CartItem[]; // نفس شكل CartItem: price هنا = سعر الشراء
  subtotal: number;
  total: number;
  supplierId: string;
  supplierName?: string;
  createdAt: number;
}

export interface SupplierReturn {
  id: string;
  items: CartItem[];
  total: number;
  supplierId: string;
  supplierName?: string;
  createdAt: number;
}

export enum PaymentMethod {
  Cash = 'نقدا',
  Credit = 'آجل',
  VodafoneCash = 'فودافون كاش',
  Instapay = 'انستا باي',
}

// RBAC-2026-09 R1: five fixed roles (owner ⊇ admin ⊇ supervisor ⊇ cashier; accountant read-only)
// G0 decisions: D-1 owner izatadel007@gmail.com, D-2 (أ) product.create = isStaff, D-4 الآن (supervisor+accountant قواعد+واجهة بلا حسابات)
export enum UserRole {
    Owner = 'owner',
    Admin = 'admin',
    Supervisor = 'supervisor',
    Cashier = 'cashier',
    Accountant = 'accountant',
}

export interface User {
    uid: string;
    email: string;
    // FIX: Add optional role property to support user roles.
    role?: UserRole;
    // FIX: Add optional disabled property to allow soft deletion without Auth.
    disabled?: boolean;
}

export type PriceType = 'retail' | 'wholesale';

export interface CartItem extends Product {
  buyQuantity: number;
  priceType: PriceType;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  customerId?: string; // للعملاء الآجل
  customerName?: string; // Denormalized for faster report display
  createdAt: number;
  dailyArchiveId: string;
}

export interface Return {
    id: string;
    items: CartItem[];
    total: number;
    createdAt: number; // serverTimestamp
    dailyArchiveId: string;
    customerId?: string;
    customerName?: string;
    originalInvoiceId?: string; // REQ-P0-1: ربط المرتجع بفاتورة البيع الأصلية (اختياري للتوافق مع البيانات القديمة)
}


export interface DailyArchive {
  id: string; // YYYY-MM-DD
  startTime: number;
  endTime?: number;
  status: 'open' | 'closed';
  totalSales: number;
  totalReturns: number;
  totalCash: number;
  totalCredit: number;
  totalVodafoneCash: number;
  totalInstapay: number;
  totalReturnsCash: number;
  totalReturnsOnAccount: number;
}

export interface BackupData {
    products: Product[];
    categories: Category[];
    customers: Customer[];
    customerPayments: CustomerPayment[];
    suppliers?: Supplier[];
    supplierPayments?: SupplierPayment[];
    purchaseInvoices?: PurchaseInvoice[];
    supplierReturns?: SupplierReturn[];
    invoices: Invoice[];
    returns: Return[];
    dailyArchives: DailyArchive[];
    // BUG-P0-15: counters backup (schema v2). Optional so v1 backups still type-check.
    counters?: { id: string; lastNumber: number }[];
    users?: (Omit<User, 'uid'> & { id: string })[];
    appSettings?: AppSettings[];
}
