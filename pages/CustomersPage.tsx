
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, DollarSign, X } from 'lucide-react';
import type { Customer, CustomerPayment, Invoice, Return } from '../types';
import { getCustomersPaginated, addDocument, updateDocument, deleteDocument, addCustomerPayment } from '../services/api';
import { subscribeToCollection, subscribeToDocument } from '../services/dataCache';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import { where, orderBy, Timestamp } from 'firebase/firestore';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useDebounce } from '../hooks/useDebounce';

const CustomerFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (customer: Omit<Customer, 'id' | 'createdAt'> | Customer) => void;
  customer?: Customer | null;
}> = ({ isOpen, onClose, onSave, customer }) => {
  const [formData, setFormData] = useState({ name: '', phone: '', address: '', balance: 0 });

  useEffect(() => {
    if (customer) {
      setFormData({ name: customer.name, phone: customer.phone || '', address: customer.address || '', balance: customer.balance });
    } else {
      setFormData({ name: '', phone: '', address: '', balance: 0 });
    }
  }, [customer, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'balance' ? Number(value) : value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast.error("اسم العميل مطلوب");
      return;
    }
    onSave(customer ? { ...customer, ...formData } : formData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">{customer ? 'تعديل عميل' : 'إضافة عميل جديد'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الاسم</label>
            <input id="customerName" type="text" name="name" placeholder="الاسم" value={formData.name} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" required />
          </div>
          <div>
            <label htmlFor="customerPhone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الهاتف</label>
            <input id="customerPhone" type="tel" name="phone" placeholder="الهاتف" value={formData.phone} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" />
          </div>
          <div>
            <label htmlFor="customerAddress" className="block text-sm font-medium text-gray-700 dark:text-gray-300">العنوان</label>
            <input id="customerAddress" type="text" name="address" placeholder="العنوان" value={formData.address} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" />
          </div>
          <div>
            <label htmlFor="customerBalance" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الرصيد الافتتاحي (مديونية)</label>
            <input id="customerBalance" type="number" name="balance" value={formData.balance} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" disabled={!!customer} />
          </div>
          <div className="flex justify-end space-x-2 space-x-reverse">
            <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded">إلغاء</button>
            <button type="submit" className="py-2 px-4 bg-primary-600 text-white rounded">حفظ</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AddPaymentModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
  onPaymentAdded: () => void;
}> = ({ isOpen, onClose, customer, onPaymentAdded }) => {
  const [amount, setAmount] = useState<number | string>('');
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returns, setReturns] = useState<Return[]>([]);
  const [liveBalance, setLiveBalance] = useState<number>(customer.balance || 0);

  useEffect(() => {
    let unsubscribe: () => void;
    if (isOpen && customer) {
      const constraints = [where('customerId', '==', customer.id)];
      unsubscribe = subscribeToCollection<Omit<CustomerPayment, 'date'> & { date: Timestamp }>('customerPayments', (paymentsData) => {
        const mappedPayments = paymentsData.map(p => ({
          ...p,
          date: p.date instanceof Timestamp ? p.date.toMillis() : (p.date || 0)
        })).sort((a, b) => b.date - a.date);
        setPayments(mappedPayments);
      }, constraints);
    }
    return () => {
      if (unsubscribe) unsubscribe();
      setPayments([]);
    }
  }, [isOpen, customer]);

  useEffect(() => {
    let unsubDoc: (() => void) | undefined;
    if (isOpen && customer) {
      setLiveBalance(customer.balance || 0);
      unsubDoc = subscribeToDocument<Customer>('customers', customer.id, (data) => {
        if (data) {
          setLiveBalance(data.balance || 0);
        }
      });
    }
    return () => {
      if (unsubDoc) unsubDoc();
    };
  }, [isOpen, customer]);

  useEffect(() => {
    let unsubInv: () => void; let unsubRet: () => void;
    if (isOpen && customer) {
      const invConstraints = [where('customerId', '==', customer.id), orderBy('createdAt', 'desc')];
      unsubInv = subscribeToCollection<Omit<Invoice,'createdAt'> & { createdAt: Timestamp }>('invoices', (data) => {
        const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as Invoice)).sort((a,b)=>b.createdAt-a.createdAt);
        setInvoices(mapped);
      }, invConstraints);
      const retConstraints = [where('customerId', '==', customer.id), orderBy('createdAt', 'desc')];
      unsubRet = subscribeToCollection<Omit<Return,'createdAt'> & { createdAt: Timestamp }>('returns', (data) => {
        const mapped = data.map(d => ({ ...d, createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : d.createdAt } as Return)).sort((a,b)=>b.createdAt-a.createdAt);
        setReturns(mapped);
      }, retConstraints);
    }
    return () => { if(unsubInv) unsubInv(); if(unsubRet) unsubRet(); setInvoices([]); setReturns([]); };
  }, [isOpen, customer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (numAmount <= 0) {
      toast.error("المبلغ يجب أن يكون أكبر من صفر");
      return;
    }
    try {
      await addCustomerPayment({ customerId: customer.id, amount: numAmount, notes });
      toast.success("تمت إضافة الدفعة بنجاح");
      setAmount('');
      setNotes('');
      onPaymentAdded();
    } catch (error) {
      toast.error("فشلت إضافة الدفعة");
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md flex flex-col h-[75vh]">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">إدارة مدفوعات {customer.name}</h2>
          <button onClick={onClose} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"><X /></button>
        </div>
        <p className='mb-4 text-gray-600 dark:text-gray-300'>الرصيد الحالي: {liveBalance.toFixed(2)} ج.م</p>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4 flex-1 overflow-y-auto space-y-4">
          <div>
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">سجل المدفوعات</h3>
            {payments.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد دفعات سابقة.</p>
            ) : (
              <div className="space-y-2">
                {payments.map(p => (
                  <div key={p.id} className="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
                    <span className="font-bold text-green-700 dark:text-green-300">{p.amount.toFixed(2)} ج.م</span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">{new Date(p.date).toLocaleString('ar-EG')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">الفواتير</h3>
            {invoices.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد فواتير.</p>
            ) : (
              <div className="space-y-2">
                {invoices.map(inv => (
                  <div key={inv.id} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800">
                    <div className="flex justify-between text-sm"><span className="font-bold text-gray-900 dark:text-gray-100">{inv.invoiceNumber}</span><span className="font-bold text-blue-800 dark:text-blue-300">{inv.total.toFixed(2)} ج.م</span></div>
                    <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(inv.createdAt).toLocaleString('ar-EG')} — {inv.paymentMethod}</p>
                    <div className="text-xs text-gray-700 dark:text-gray-200 mt-1 space-y-1">{inv.items.map((it,i)=>(<div key={i} className="flex justify-between"><span>{it.name} ×{it.buyQuantity}</span><span>{(it.price*it.buyQuantity).toFixed(2)}</span></div>))}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">المرتجعات</h3>
            {returns.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-300 text-center py-2 text-sm">لا توجد مرتجعات.</p>
            ) : (
              <div className="space-y-2">
                {returns.map(ret => (
                  <div key={ret.id} className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-800">
                    <div className="flex justify-between text-sm"><span className="font-bold text-gray-900 dark:text-gray-100">مرتجع</span><span className="font-bold text-red-800 dark:text-red-300">-{ret.total.toFixed(2)} ج.م</span></div>
                    <p className="text-xs text-gray-700 dark:text-gray-200">{new Date(ret.createdAt).toLocaleString('ar-EG')}</p>
                    <div className="text-xs text-gray-700 dark:text-gray-200 mt-1 space-y-1">{ret.items.map((it,i)=>(<div key={i} className="flex justify-between"><span>{it.name} ×{it.buyQuantity}</span><span>{(it.price*it.buyQuantity).toFixed(2)}</span></div>))}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">إضافة دفعة جديدة</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="paymentAmount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">المبلغ</label>
              <input id="paymentAmount" type="number" placeholder="المبلغ" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" required min="0.01" step="0.01" />
            </div>
            <div>
              <label htmlFor="paymentNotes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">ملاحظات (اختياري)</label>
              <input id="paymentNotes" type="text" placeholder="ملاحظات (اختياري)" value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" />
            </div>
            <button type="submit" className="w-full py-2 px-4 bg-primary-600 text-white rounded">حفظ الدفعة</button>
          </form>
        </div>
      </div>
    </div>
  );
}

const CustomerCard: React.FC<{
  customer: Customer;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onAddPayment: (customer: Customer) => void;
}> = ({ customer, onEdit, onDelete, onAddPayment }) => {
  const balance = customer.balance || 0;
  const balanceColor = balance > 0 ? 'text-red-700 dark:text-red-300' : balance < 0 ? 'text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100';
  const balanceText = balance > 0 ? 'عليه مديونية' : balance < 0 ? 'له رصيد' : 'رصيد صفري';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-lg">
      <div>
        <h2 className="font-bold text-lg text-gray-800 dark:text-gray-100">{customer.name}</h2>
        {customer.phone && <p className="text-sm text-gray-600 dark:text-gray-300">{customer.phone}</p>}
      </div>
      <div className="border-t border-gray-200 dark:border-gray-700 my-3 pt-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">{balanceText}</p>
        <p className={`font-bold text-xl ${balanceColor}`}>{Math.abs(balance).toFixed(2)} ج.م</p>
      </div>
      <div className="flex justify-end space-x-2 space-x-reverse mt-2">
        <button onClick={() => onAddPayment(customer)} title="إضافة دفعة" aria-label={`إضافة دفعة لـ ${customer.name}`} className="p-2 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-full transition-colors"><DollarSign size={20} /></button>
        <button onClick={() => onEdit(customer)} title="تعديل" aria-label={`تعديل ${customer.name}`} className="p-2 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full transition-colors"><Edit size={20} /></button>
        <button onClick={() => onDelete(customer)} title="حذف" aria-label={`حذف ${customer.name}`} className="p-2 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors"><Trash2 size={20} /></button>      </div>
    </div>
  );
}
const MemoizedCustomerCard = memo(CustomerCard);

const CustomersList = memo(({
  customers,
  onEdit,
  onDelete,
  onAddPayment,
  lastCustomerRef
}: {
  customers: Customer[],
  onEdit: (c: Customer) => void,
  onDelete: (c: Customer) => void,
  onAddPayment: (c: Customer) => void,
  lastCustomerRef?: (node: HTMLDivElement | null) => void
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {customers.map((customer, index) => {
        const card = (
          <MemoizedCustomerCard
            key={customer.id}
            customer={customer}
            onAddPayment={onAddPayment}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
        if (lastCustomerRef && customers.length === index + 1) {
          return <div key={customer.id} ref={lastCustomerRef}>{card}</div>;
        }
        return <div key={customer.id}>{card}</div>;
      })}
    </div>
  );
});

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const { confirm } = useConfirmation();
  const observer = useRef<IntersectionObserver | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const loadCustomers = useCallback(async (isNewSearch = false) => {
    const lastVisible = isNewSearch ? null : lastDocRef.current;
    if (isNewSearch) {
      setIsLoading(true);
      setCustomers([]);
      lastDocRef.current = null;
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }

    const { customers: newCustomers, lastDoc: newLastDoc } = await getCustomersPaginated(
      debouncedSearchQuery || null,
      lastVisible
    );

    setHasMore(newCustomers.length === 50);
    setCustomers(prev => isNewSearch ? newCustomers : [...prev, ...newCustomers]);
    lastDocRef.current = newLastDoc;

    setIsLoading(false);
    setIsLoadingMore(false);
  }, [debouncedSearchQuery]);

  const loadMoreCustomers = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadCustomers(false);
    }
  }, [isLoadingMore, hasMore, loadCustomers]);

  const lastCustomerElementRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading || isLoadingMore) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMoreCustomers();
      }
    });
    if (node) observer.current.observe(node);
  }, [isLoading, isLoadingMore, hasMore, loadMoreCustomers]);

  useEffect(() => {
    loadCustomers(true);
  }, [debouncedSearchQuery]);

  const handleSaveCustomer = useCallback(async (customerData: Omit<Customer, 'id' | 'createdAt'> | Customer) => {
    setIsFormModalOpen(false);
    try {
      if ('id' in customerData) {
        await updateDocument('customers', customerData.id, customerData);
        toast.success('تم تحديث العميل');
        loadCustomers(true);
      } else {
        await addDocument('customers', customerData);
        toast.success('تمت إضافة العميل');
        loadCustomers(true);
      }
    } catch (e) {
      toast.error('فشلت عملية الحفظ');
    }
  }, [loadCustomers]);

  const handleDeleteCustomer = useCallback(async (customer: Customer) => {
    if (customer.balance !== 0) {
      toast.error('لا يمكن حذف العميل إلا إذا كان رصيده صفراً.');
      return;
    }

    const confirmed = await confirm({
      title: "حذف العميل",
      message: `هل أنت متأكد من حذف العميل "${customer.name}"؟`
    });
    if (confirmed) {
      try {
        await deleteDocument('customers', customer.id);
        toast.success('تم حذف العميل');
        loadCustomers(true);
      } catch (e) {
        toast.error('فشل حذف العميل');
      }
    }
  }, [confirm, loadCustomers]);

  const navigate = useNavigate();

  const handleAddPayment = useCallback((customer: Customer) => {
    navigate(`/customers/${customer.id}`);
  }, [navigate]);

  const handleEdit = useCallback((customer: Customer) => {
    setSelectedCustomer(customer);
    setIsFormModalOpen(true);
  }, []);

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">إدارة العملاء</h1>
        <button onClick={() => { setSelectedCustomer(null); setIsFormModalOpen(true); }} className="flex items-center space-x-2 bg-primary-600 text-white py-2 px-4 rounded-lg shadow hover:bg-primary-700">
          <Plus size={20} />
          <span>عميل جديد</span>
        </button>
      </div>
      <div className="mb-4">
        <div className="relative mb-6">
          <input
            id="customerSearch"
            name="customerSearch"
            type="text"
            placeholder="ابحث بالاسم..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg shadow-sm"
          />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center items-center h-full pt-10">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
        </div>
      ) : (
        <>
          <CustomersList
            customers={customers}
            onEdit={handleEdit}
            onDelete={handleDeleteCustomer}
            onAddPayment={handleAddPayment}
            lastCustomerRef={lastCustomerElementRef}
          />
          {isLoadingMore && <div className="text-center p-4 font-semibold text-gray-600 dark:text-gray-300">جاري تحميل المزيد...</div>}
          {!hasMore && customers.length > 0 && <div className="text-center p-4 text-gray-700 dark:text-gray-300 font-semibold">لا يوجد المزيد من العملاء.</div>}
          {!isLoading && customers.length === 0 && <div className="text-center p-10 text-gray-600 dark:text-gray-300">لم يتم العثور على عملاء.</div>}
        </>
      )}
      <CustomerFormModal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} onSave={handleSaveCustomer} customer={selectedCustomer} />
      {selectedCustomer && <AddPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} customer={selectedCustomer} onPaymentAdded={() => loadCustomers(true)} />}
    </div>
  );
}
