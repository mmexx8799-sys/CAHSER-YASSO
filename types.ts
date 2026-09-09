
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
}

export interface Customer {
  id: string;
  name:string;
  phone?: string;
  address?: string;
  balance: number; // الرصيد الحالي (مدين/دائن)
  createdAt: number;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  amount: number;
  date: number;
  notes?: string;
}

export enum PaymentMethod {
  Cash = 'نقدا',
  Credit = 'آجل',
  VodafoneCash = 'فودافون كاش',
  Instapay = 'انستا باي',
}

// FIX: Add and export UserRole enum to be used for user management.
export enum UserRole {
    Admin = 'admin',
    Cashier = 'cashier',
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
    invoices: Invoice[];
    returns: Return[];
    dailyArchives: DailyArchive[];
    users?: (Omit<User, 'uid'> & { id: string })[];
    appSettings?: AppSettings[];
}
