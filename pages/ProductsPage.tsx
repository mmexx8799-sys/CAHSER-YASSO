
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Plus, Edit, Trash2, Search, X, FolderCog } from 'lucide-react';
import type { Product, Category } from '../types';
import { getProductsPaginated, addDocument, saveProduct, deleteDocument } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import { useDebounce } from '../hooks/useDebounce';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import { orderBy } from 'firebase/firestore';
import type { QueryDocumentSnapshot, QueryConstraint } from 'firebase/firestore';


const CategoryManagerModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
}> = ({ isOpen, onClose, categories }) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const { confirm } = useConfirmation();

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error("اسم التصنيف لا يمكن أن يكون فارغًا");
      return;
    }
    try {
      await addDocument('categories', { name: newCategoryName });
      toast.success("تمت إضافة التصنيف");
      setNewCategoryName('');
    } catch (e) {
      toast.error("فشلت إضافة التصنيف");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const confirmed = await confirm({
      title: "حذف التصنيف",
      message: "هل أنت متأكد من حذف هذا التصنيف؟"
    });
    if (confirmed) {
      try {
        await deleteDocument('categories', id);
        toast.success("تم حذف التصنيف");
      } catch (e) {
        toast.error("فشل حذف التصنيف");
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">إدارة التصنيفات</h2>
          <button onClick={onClose} aria-label="إغلاق" className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"><X size={24} /></button>
        </div>
        <div className="flex space-x-2 space-x-reverse mb-4">
          <label htmlFor="newCategoryName" className="sr-only">اسم التصنيف</label>
          <input
            id="newCategoryName"
            name="newCategoryName"
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="اسم التصنيف الجديد"
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg"
          />
          <button onClick={handleAddCategory} className="py-2 px-4 bg-primary-600 text-white rounded-md font-semibold text-lg">إضافة</button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {categories.length > 0 ? categories.map(cat => (
            <div key={cat.id} className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
              <span className="text-lg text-gray-900 dark:text-gray-100">{cat.name}</span>
              <button onClick={() => handleDeleteCategory(cat.id)} aria-label={`حذف تصنيف ${cat.name}`} className="text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300">
                <Trash2 size={20} />
              </button>
            </div>
          )) : <p className="text-center text-gray-600 dark:text-gray-300 p-4">لا توجد تصنيفات.</p>}
        </div>
      </div>
    </div>
  );
};

const ProductFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id' | 'createdAt' | 'searchableIndex'> | Product) => void;
  product?: Product | null;
  categories: Category[];
}> = ({ isOpen, onClose, onSave, product, categories }) => {
  const initialFormState = {
    code: '',
    name: '',
    price: 0,
    retailCashPrice: 0,
    retailCreditPrice: 0,
    wholesaleCashPrice: 0,
    wholesaleCreditPrice: 0,
    quantity: 0,
    minQuantity: 5,
    categoryId: '',
  };

  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setFormData({
          code: product.code,
          name: product.name,
          price: product.price,
          retailCashPrice: product.retailCashPrice ?? product.price,
          retailCreditPrice: product.retailCreditPrice ?? product.price,
          wholesaleCashPrice: product.wholesaleCashPrice ?? product.price,
          wholesaleCreditPrice: product.wholesaleCreditPrice ?? product.price,
          quantity: product.quantity,
          minQuantity: product.minQuantity ?? 5,
          categoryId: product.categoryId,
        });
      } else {
        setFormData({ ...initialFormState, categoryId: categories[0]?.id || '' });
      }
    }
  }, [product, isOpen, categories]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: ['price', 'quantity', 'minQuantity', 'retailCashPrice', 'retailCreditPrice', 'wholesaleCashPrice', 'wholesaleCreditPrice'].includes(name) ? Number(value) : value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) {
      toast.error("الاسم والكود مطلوبان");
      return;
    }
    if (!formData.categoryId) {
      toast.error("يرجى اختيار تصنيف");
      return;
    }
    const dataWithPrice = { ...formData, price: formData.retailCashPrice };
    onSave(product ? { ...product, ...dataWithPrice } : dataWithPrice);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">{product ? 'تعديل منتج' : 'إضافة منتج جديد'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="prodName" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">اسم المنتج</label>
            <input id="prodName" name="name" type="text" value={formData.name} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" required />
          </div>
          <div>
            <label htmlFor="prodCode" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">كود المنتج</label>
            <input id="prodCode" name="code" type="text" value={formData.code} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" required />
          </div>
          <div>
            <label htmlFor="prodCategory" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">التصنيف</label>
            <select id="prodCategory" name="categoryId" value={formData.categoryId} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" required>
              <option value="">-- اختر تصنيف --</option>
              {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="prodQuantity" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">الكمية</label>
            <input id="prodQuantity" name="quantity" type="number" value={formData.quantity} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" />
          </div>
          <div>
            <label htmlFor="prodMinQuantity" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">الحد الأدنى للمخزون</label>
            <input id="prodMinQuantity" name="minQuantity" type="number" value={formData.minQuantity} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" />
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-base font-bold mb-3 text-gray-900 dark:text-gray-100">الأسعار</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="prodRetailCashPrice" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">قطاعي — نقدي</label>
                <input id="prodRetailCashPrice" name="retailCashPrice" type="number" value={formData.retailCashPrice} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" step="0.01" />
              </div>
              <div>
                <label htmlFor="prodRetailCreditPrice" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">قطاعي — آجل</label>
                <input id="prodRetailCreditPrice" name="retailCreditPrice" type="number" value={formData.retailCreditPrice} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" step="0.01" />
              </div>
              <div>
                <label htmlFor="prodWholesaleCashPrice" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">جملة — نقدي</label>
                <input id="prodWholesaleCashPrice" name="wholesaleCashPrice" type="number" value={formData.wholesaleCashPrice} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" step="0.01" />
              </div>
              <div>
                <label htmlFor="prodWholesaleCreditPrice" className="block text-base font-medium mb-1 text-gray-700 dark:text-gray-300">جملة — آجل</label>
                <input id="prodWholesaleCreditPrice" name="wholesaleCreditPrice" type="number" value={formData.wholesaleCreditPrice} onChange={handleChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md text-lg" min="0" step="0.01" />
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-2 space-x-reverse pt-4">
            <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold text-lg">إلغاء</button>
            <button type="submit" className="py-2 px-4 bg-primary-600 text-white rounded-md font-semibold text-lg">حفظ</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ProductCard: React.FC<{
  product: Product;
  categoryName: string;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
}> = ({ product, categoryName, onEdit, onDelete }) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-lg">
    <div>
      <div className="flex justify-between items-start mb-2">
        <h2 className="font-bold text-gray-800 dark:text-gray-100 text-xl">{product.name}</h2>
        <span className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300 font-semibold px-2 py-1 rounded-full">{categoryName}</span>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">الكود: {product.code}</p>
    </div>
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
      <div className="flex justify-between text-base">
        <span className="text-gray-600 dark:text-gray-300">السعر:</span>
        <span className="font-bold text-green-700 dark:text-green-300">{product.price.toFixed(2)} ج.م</span>
      </div>
      <div className="flex justify-between text-base">
        <span className="text-gray-600 dark:text-gray-300">الرصيد:</span>
        <span className={`font-bold text-lg ${product.quantity > 5 ? 'text-gray-800 dark:text-gray-100' : 'text-red-700 dark:text-red-300'}`}>{product.quantity}</span>
      </div>
    </div>
    <div className="flex justify-end space-x-2 space-x-reverse mt-4">
      <button onClick={() => onEdit(product)} aria-label={`تعديل ${product.name}`} className="p-2 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full transition-colors">
        <Edit size={22} aria-hidden="true" />
      </button>
      <button onClick={() => onDelete(product.id)} aria-label={`حذف ${product.name}`} className="p-2 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors">
        <Trash2 size={22} aria-hidden="true" />
      </button>
    </div>
  </div>
);
const MemoizedProductCard = memo(ProductCard);


export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const { confirm } = useConfirmation();
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const observer = useRef<IntersectionObserver | null>(null);

  const loadProducts = useCallback(async (isNewSearch = false) => {
    const lastVisible = isNewSearch ? null : lastDoc;
    if (isNewSearch) {
      setIsLoading(true);
      setProducts([]);
      setLastDoc(null);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }

    const filters = {
      searchQuery: debouncedSearchQuery,
      categoryId: selectedCategory || undefined
    };
    const { products: newProducts, lastDoc: newLastDoc } = await getProductsPaginated(filters, lastVisible);

    setHasMore(newProducts.length > 0);
    setProducts(prev => isNewSearch ? newProducts : [...prev, ...newProducts]);
    setLastDoc(newLastDoc);

    setIsLoading(false);
    setIsLoadingMore(false);
  }, [debouncedSearchQuery, selectedCategory, lastDoc]);

  const loadMoreProducts = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadProducts(false);
    }
  }, [isLoadingMore, hasMore, loadProducts]);

  const lastProductElementRef = useCallback((node: HTMLDivElement) => {
    if (isLoading || isLoadingMore) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMoreProducts();
      }
    });
    if (node) observer.current.observe(node);
  }, [isLoading, isLoadingMore, hasMore, loadMoreProducts]);

  useEffect(() => {
    loadProducts(true);
  }, [debouncedSearchQuery, selectedCategory]);

  useEffect(() => {
    const constraints: QueryConstraint[] = [orderBy('name')];
    const unsubscribeCategories = subscribeToCollection<Category>('categories', setCategories, constraints);
    return () => unsubscribeCategories();
  }, []);

  const handleSaveProduct = useCallback(async (productData: Omit<Product, 'id' | 'createdAt' | 'searchableIndex'> | Product) => {
    setIsModalOpen(false);
    try {
      await saveProduct(productData);
      toast.success('id' in productData ? 'تم تحديث المنتج بنجاح' : 'تمت إضافة المنتج بنجاح');
      loadProducts(true);
    } catch (error) {
      toast.error('فشلت عملية الحفظ');
    }
  }, [loadProducts]);

  const handleDeleteProduct = useCallback(async (id: string) => {
    const confirmed = await confirm({
      title: "حذف المنتج",
      message: "هل أنت متأكد من حذف هذا المنتج؟"
    });
    if (confirmed) {
      try {
        await deleteDocument('products', id);
        toast.success('تم حذف المنتج');
        loadProducts(true);
      } catch (error) {
        toast.error('فشل حذف المنتج');
      }
    }
  }, [confirm, loadProducts]);

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    setIsModalOpen(true);
  }, []);

  const getCategoryName = useCallback((categoryId: string) => {
    return categories.find(c => c.id === categoryId)?.name || 'غير معروف';
  }, [categories]);

  return (
    <div className="p-4 pb-24">
      {/* Sticky Header with Search and Filters */}
      <div className="sticky top-0 z-40 py-4 space-y-4 -mx-4 px-4 shadow-sm mb-6 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">إدارة المنتجات</h1>
          <div className="flex space-x-2 space-x-reverse">
            <button onClick={() => { setEditingProduct(null); setIsModalOpen(true); }} aria-label="منتج جديد" className="flex items-center space-x-2 space-x-reverse bg-primary-600 text-white py-2 px-4 rounded-lg shadow hover:bg-primary-700">
              <Plus size={20} aria-hidden="true" />
              <span className="hidden sm:inline">منتج جديد</span>
            </button>
            <button onClick={() => setIsCategoryModalOpen(true)} aria-label="إدارة التصنيفات" className="flex items-center space-x-2 space-x-reverse bg-gray-600 dark:bg-gray-700 text-white py-2 px-4 rounded-lg shadow hover:bg-gray-700 dark:hover:bg-gray-600">
              <FolderCog size={20} aria-hidden="true" />
              <span className="hidden sm:inline">إدارة التصنيفات</span>
            </button>
          </div>
        </div>
        <div className="relative">
          <label htmlFor="productSearch" className="sr-only">ابحث عن منتج</label>
          <input
            id="productSearch"
            name="productSearch"
            type="text"
            placeholder="ابحث بالاسم أو الكود..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            className="w-full p-3 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
          />
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={22} aria-hidden="true" />
        </div>
        <label htmlFor="productCategoryFilter" className="sr-only">فلترة بالتصنيف</label>
        <select
          id="productCategoryFilter"
          name="productCategoryFilter"
          onChange={(e) => setSelectedCategory(e.target.value)}
          value={selectedCategory}
          className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-full shadow-sm text-lg focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">كل التصنيفات</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      {/* Product Grid Section with proper spacing */}
      <div className="mt-8">
        {isLoading ? (
          <div className="flex justify-center items-center h-full pt-10">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {products.map((product, index) => {
                const card = (
                  <MemoizedProductCard
                    key={product.id}
                    product={product}
                    categoryName={getCategoryName(product.categoryId)}
                    onEdit={handleEdit}
                    onDelete={handleDeleteProduct}
                  />
                );
                if (products.length === index + 1) {
                  return <div ref={lastProductElementRef} key={product.id}>{card}</div>
                }
                return card;
              })}
            </div>
            {isLoadingMore && <div className="text-center p-4 font-semibold">جاري تحميل المزيد...</div>}
            {!hasMore && products.length > 0 && <div className="text-center p-4 text-gray-700 dark:text-gray-300 font-semibold">لا يوجد المزيد من المنتجات.</div>}
            {!isLoading && products.length === 0 && <div className="text-center p-10 text-gray-700 dark:text-gray-300">لم يتم العثور على منتجات.</div>}
          </>
        )}
      </div>

      <ProductFormModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingProduct(null); }} onSave={handleSaveProduct} product={editingProduct} categories={categories} />
      <CategoryManagerModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} categories={categories} />
    </div>
  );
}
