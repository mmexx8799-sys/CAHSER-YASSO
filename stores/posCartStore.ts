import { create } from 'zustand';
import type { CartItem, Product, PriceType } from '../types';
import { PaymentMethod } from '../types';
import { toast } from 'react-hot-toast';

interface PosCartState {
  cart: CartItem[];
  subtotal: number;
  isCartModalOpen: boolean;
  addToCart: (product: Product, priceType?: PriceType) => boolean;
  updateItem: (itemId: string, newQuantity: number, newPrice: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setCartModalOpen: (isOpen: boolean) => void;
  setItemPriceType: (itemId: string, priceType: PriceType, paymentMethod: PaymentMethod) => void;
  recalcCartPrices: (paymentMethod: PaymentMethod) => void;
}

// Fallback: any product missing the 4 price fields uses its legacy `price` for all of them.
export const resolvePrice = (product: Product, priceType: PriceType, paymentMethod: PaymentMethod): number => {
  const retail = priceType === 'retail';
  if (retail) {
    return (paymentMethod === PaymentMethod.Credit && product.retailCreditPrice != null)
      ? product.retailCreditPrice
      : (paymentMethod !== PaymentMethod.Credit && product.retailCashPrice != null)
        ? product.retailCashPrice
        : product.price;
  }
  return (paymentMethod === PaymentMethod.Credit && product.wholesaleCreditPrice != null)
    ? product.wholesaleCreditPrice
    : (paymentMethod !== PaymentMethod.Credit && product.wholesaleCashPrice != null)
      ? product.wholesaleCashPrice
      : product.price;
};

const calculateSubtotal = (cart: CartItem[]) => {
  return cart.reduce((total, item) => total + item.price * item.buyQuantity, 0);
};

export const usePosCartStore = create<PosCartState>((set) => ({
  cart: [],
  subtotal: 0,
  isCartModalOpen: false,
  setCartModalOpen: (isOpen) => set({ isCartModalOpen: isOpen }),

  // REQ-A (AUTOCART): تُرجع boolean نجاح/فشل الإضافة الفعلية — عبر متغير
  // مُلتقَط (closure) يُحدَّث داخل updater المتزامن (بلا get() وبلا تفرّع
  // خارجي). الرفض الداخلي (تجاوز المخزون) يُرجع false ليمنع auto-open.
  addToCart: (product, priceType = 'retail') => {
    let added = false;
    set((state) => {
    const existingItem = state.cart.find(item => item.id === product.id);
    let newCart: CartItem[];
    if (existingItem) {
      if (existingItem.buyQuantity < product.quantity) {
        newCart = state.cart.map(item =>
          item.id === product.id ? { ...item, buyQuantity: item.buyQuantity + 1 } : item
        );
        added = true;
        if (existingItem.priceType === 'retail' && existingItem.buyQuantity + 1 >= 12) {
          // Suggestion only — no automatic switch.
          toast('الكمية في السلة ≥ 12 — يمكن التحويل لسعر الجملة من السلة', { icon: '💡' });
        }
      } else {
        toast.error('لا يمكن إضافة كمية أكبر من المتاح بالمخزون');
        return state;
      }
    } else {
      newCart = [...state.cart, { ...product, buyQuantity: 1, priceType, price: resolvePrice(product, priceType, PaymentMethod.Cash) }];
      added = true;
    }
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
    });
    return added;
  },

  updateItem: (itemId, newQuantity, newPrice) => set((state) => {
    const itemToUpdate = state.cart.find(item => item.id === itemId);
    if (!itemToUpdate) return state;

    if (newQuantity > itemToUpdate.quantity) {
      toast.error("الكمية المطلوبة أكبر من المخزون المتاح.");
      newQuantity = itemToUpdate.quantity;
    }
    if (newQuantity < 1) newQuantity = 1;
    if (newPrice < 0) newPrice = 0;

    const newCart = state.cart.map(item =>
      item.id === itemId ? { ...item, buyQuantity: newQuantity, price: newPrice } : item
    );
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
  }),

  removeItem: (itemId) => set((state) => {
    const newCart = state.cart.filter(item => item.id !== itemId);
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
  }),

  // Recalculate ONLY this item's price from its own priceType + current payment method.
  setItemPriceType: (itemId, priceType, paymentMethod) => set((state) => {
    const item = state.cart.find(i => i.id === itemId);
    if (!item) return state;
    const newPrice = resolvePrice(item, priceType, paymentMethod);
    const newCart = state.cart.map(i =>
      i.id === itemId ? { ...i, priceType, price: newPrice } : i
    );
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
  }),

  // Payment method is invoice-wide; when it changes, re-resolve prices of affected items.
  recalcCartPrices: (paymentMethod) => set((state) => {
    const newCart = state.cart.map(item => ({
      ...item,
      price: resolvePrice(item, item.priceType, paymentMethod),
    }));
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
  }),

  clearCart: () => set(() => {
    return {
      cart: [],
      subtotal: 0,
      isCartModalOpen: false,
    };
  }),
}));
