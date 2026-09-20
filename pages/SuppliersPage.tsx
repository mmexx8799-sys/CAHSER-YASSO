
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, DollarSign } from 'lucide-react';
import type { Supplier } from '../types';
import { getSuppliersPaginated, updateSupplierProfile, deleteDocument, addSupplier } from '../services/api';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useDebounce } from '../hooks/useDebounce';
import { usePermissions } from '../hooks/usePermissions';

const SupplierFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (supplier: Omit<Supplier, 'id' | 'createdAt'> | Supplier) => void;
  supplier?: Supplier | null;
}> = ({ isOpen, onClose, onSave, supplier }) => {
  const [formData, setFormData] = useState({ name: '', phone: '', address: '', balance: 0 });

  useEffect(() => {
    if (supplier) {
      setFormData({ name: supplier.name, phone: supplier.phone || '', address: supplier.address || '', balance: supplier.balance });
    } else {
      setFormData({ name: '', phone: '', address: '', balance: 0 });
    }
  }, [supplier, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'balance' ? Number(value) : value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast.error("اسم المورد مطلوب");
      return;
    }
    onSave(supplier ? { ...supplier, ...formData } : formData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">{supplier ? 'تعديل مورد' : 'إضافة مورد جديد'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="supplierName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الاسم</label>
            <input id="supplierName" type="text" name="name" placeholder="الاسم" value={formData.name} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" required />
          </div>
          <div>
            <label htmlFor="supplierPhone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الهاتف</label>
            <input id="supplierPhone" type="tel" name="phone" placeholder="الهاتف" value={formData.phone} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" />
          </div>
          <div>
            <label htmlFor="supplierAddress" className="block text-sm font-medium text-gray-700 dark:text-gray-300">العنوان</label>
            <input id="supplierAddress" type="text" name="address" placeholder="العنوان" value={formData.address} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" />
          </div>
          <div>
            <label htmlFor="supplierBalance" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الرصيد الافتتاحي (مديونية له)</label>
            <input id="supplierBalance" type="number" name="balance" value={formData.balance} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" disabled={!!supplier} />
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


const SupplierCard: React.FC<{
  supplier: Supplier;
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
  onAddPayment: (supplier: Supplier) => void;
}> = ({ supplier, onEdit, onDelete, onAddPayment }) => {
  const { can } = usePermissions();
  const balance = supplier.balance || 0;
  const balanceColor = balance > 0 ? 'text-red-700 dark:text-red-300' : balance < 0 ? 'text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-gray-100';
  const balanceText = balance > 0 ? 'له مديونية علينا (دائن)' : balance < 0 ? 'له رصيد (مدين)' : 'رصيد صفري';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-lg">
      <div>
        <h2 className="font-bold text-lg text-gray-800 dark:text-gray-100">{supplier.name}</h2>
        {supplier.phone && <p className="text-sm text-gray-600 dark:text-gray-300">{supplier.phone}</p>}
      </div>
      <div className="border-t border-gray-200 dark:border-gray-700 my-3 pt-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">{balanceText}</p>
        <p className={`font-bold text-xl ${balanceColor}`}>{Math.abs(balance).toFixed(2)} ج.م</p>
      </div>
      <div className="flex justify-end space-x-2 space-x-reverse mt-2">
        {can('supplier.ops') && <button onClick={() => onAddPayment(supplier)} title="إضافة دفعة" aria-label={`إضافة دفعة لـ ${supplier.name}`} className="p-2 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-full transition-colors"><DollarSign size={20} /></button>}
        {can('supplier.write') && <button onClick={() => onEdit(supplier)} title="تعديل" aria-label={`تعديل ${supplier.name}`} className="p-2 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full transition-colors"><Edit size={20} /></button>}
        {can('supplier.write') && <button onClick={() => onDelete(supplier)} title="حذف" aria-label={`حذف ${supplier.name}`} className="p-2 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors"><Trash2 size={20} /></button>}
      </div>
    </div>
  );
}
const MemoizedSupplierCard = memo(SupplierCard);

const SuppliersList = memo(({
  suppliers,
  onEdit,
  onDelete,
  onAddPayment,
  lastSupplierRef
}: {
  suppliers: Supplier[],
  onEdit: (s: Supplier) => void,
  onDelete: (s: Supplier) => void,
  onAddPayment: (s: Supplier) => void,
  lastSupplierRef?: (node: HTMLDivElement | null) => void
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {suppliers.map((supplier, index) => {
        const card = (
          <MemoizedSupplierCard
            key={supplier.id}
            supplier={supplier}
            onAddPayment={onAddPayment}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
        if (lastSupplierRef && suppliers.length === index + 1) {
          return <div key={supplier.id} ref={lastSupplierRef}>{card}</div>;
        }
        return <div key={supplier.id}>{card}</div>;
      })}
    </div>
  );
});

export default function SuppliersPage() {
  const { can } = usePermissions();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const { confirm } = useConfirmation();
  const observer = useRef<IntersectionObserver | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const loadSuppliers = useCallback(async (isNewSearch = false) => {
    const lastVisible = isNewSearch ? null : lastDocRef.current;
    if (isNewSearch) {
      setIsLoading(true);
      setSuppliers([]);
      lastDocRef.current = null;
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }

    const { suppliers: newSuppliers, lastDoc: newLastDoc } = await getSuppliersPaginated(
      debouncedSearchQuery || null,
      lastVisible
    );

    setHasMore(newSuppliers.length === 50);
    setSuppliers(prev => isNewSearch ? newSuppliers : [...prev, ...newSuppliers]);
    lastDocRef.current = newLastDoc;

    setIsLoading(false);
    setIsLoadingMore(false);
  }, [debouncedSearchQuery]);

  const loadMoreSuppliers = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadSuppliers(false);
    }
  }, [isLoadingMore, hasMore, loadSuppliers]);

  const lastSupplierElementRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading || isLoadingMore) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMoreSuppliers();
      }
    });
    if (node) observer.current.observe(node);
  }, [isLoading, isLoadingMore, hasMore, loadMoreSuppliers]);

  useEffect(() => {
    loadSuppliers(true);
  }, [debouncedSearchQuery]);

  const handleSaveSupplier = useCallback(async (supplierData: Omit<Supplier, 'id' | 'createdAt'> | Supplier) => {
    setIsFormModalOpen(false);
    try {
      if ('id' in supplierData) {
        await updateSupplierProfile(supplierData.id, supplierData);
        toast.success('تم تحديث المورد');
        loadSuppliers(true);
      } else {
        await addSupplier(supplierData);
        toast.success('تمت إضافة المورد');
        loadSuppliers(true);
      }
    } catch {
      toast.error('فشلت عملية الحفظ');
    }
  }, [loadSuppliers]);

  const handleDeleteSupplier = useCallback(async (supplier: Supplier) => {
    if (supplier.balance !== 0) {
      toast.error('لا يمكن حذف المورد إلا إذا كان رصيده صفراً.');
      return;
    }

    const confirmed = await confirm({
      title: "حذف المورد",
      message: `هل أنت متأكد من حذف المورد "${supplier.name}"؟`
    });
    if (confirmed) {
      try {
        await deleteDocument('suppliers', supplier.id);
        toast.success('تم حذف المورد');
        loadSuppliers(true);
      } catch {
        toast.error('فشل حذف المورد');
      }
    }
  }, [confirm, loadSuppliers]);

  const navigate = useNavigate();

  const handleAddPayment = useCallback((supplier: Supplier) => {
    navigate(`/suppliers/${supplier.id}`);
  }, [navigate]);

  const handleEdit = useCallback((supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setIsFormModalOpen(true);
  }, []);

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">إدارة الموردين</h1>
        {can('supplier.write') && (
        <button onClick={() => { setSelectedSupplier(null); setIsFormModalOpen(true); }} className="flex items-center space-x-2 bg-primary-600 text-white py-2 px-4 rounded-lg shadow hover:bg-primary-700">
          <Plus size={20} />
          <span>مورد جديد</span>
        </button>
        )}
      </div>
      <div className="mb-4">
        <div className="relative mb-6">
          <input
            id="supplierSearch"
            name="supplierSearch"
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
          <SuppliersList
            suppliers={suppliers}
            onEdit={handleEdit}
            onDelete={handleDeleteSupplier}
            onAddPayment={handleAddPayment}
            lastSupplierRef={lastSupplierElementRef}
          />
          {isLoadingMore && <div className="text-center p-4 font-semibold text-gray-600 dark:text-gray-300">جاري تحميل المزيد...</div>}
          {!hasMore && suppliers.length > 0 && <div className="text-center p-4 text-gray-700 dark:text-gray-300 font-semibold">لا يوجد المزيد من الموردين.</div>}
          {!isLoading && suppliers.length === 0 && <div className="text-center p-10 text-gray-600 dark:text-gray-300">لم يتم العثور على موردين.</div>}
        </>
      )}
      <SupplierFormModal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} onSave={handleSaveSupplier} supplier={selectedSupplier} />
    </div>
  );
}
