import { create } from 'zustand';
import type { CartItem, Product, PriceType } from '../types';
import { PaymentMethod } from '../types';
import { resolvePrice } from './posCartStore';

interface ReturnCartState {
  returnCart: CartItem[];
  total: number;
  isCartModalOpen: boolean;
  addToReturnCart: (product: Product) => void;
  updateItem: (itemId: string, newQuantity: number, newPrice?: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setCartModalOpen: (isOpen: boolean) => void;
  setItemPriceType: (itemId: string, priceType: PriceType) => void;
}

const calculateTotal = (cart: CartItem[]) => {
  return cart.reduce((total, item) => total + item.price * item.buyQuantity, 0);
};

export const useReturnCartStore = create<ReturnCartState>((set) => ({
  returnCart: [],
  total: 0,
  isCartModalOpen: false,
  setCartModalOpen: (isOpen) => set({ isCartModalOpen: isOpen }),

  addToReturnCart: (product) => set((state) => {
    const existingItem = state.returnCart.find(item => item.id === product.id);
    let newCart: CartItem[];
    if (existingItem) {
        newCart = state.returnCart.map(item =>
          item.id === product.id ? { ...item, buyQuantity: item.buyQuantity + 1 } : item
        );
    } else {
        newCart = [...state.returnCart, { ...product, buyQuantity: 1, priceType: 'retail' as const, price: resolvePrice(product, 'retail', PaymentMethod.Cash) }];
    }
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  updateItem: (itemId, newQuantity, newPrice) => set((state) => {
    if (newQuantity < 1) newQuantity = 1;
    let price = newPrice;
    if (price == null) {
      const item = state.returnCart.find(i => i.id === itemId);
      price = item ? item.price : 0;
    }
    if (price < 0) price = 0;
    const newCart = state.returnCart.map(item =>
      item.id === itemId ? { ...item, buyQuantity: newQuantity, price } : item
    );
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  removeItem: (itemId) => set((state) => {
    const newCart = state.returnCart.filter(item => item.id !== itemId);
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  // Same per-item retail/wholesale logic as POS — refunds resolve from the same product price fields.
  setItemPriceType: (itemId, priceType) => set((state) => {
    const item = state.returnCart.find(i => i.id === itemId);
    if (!item) return state;
    const newPrice = resolvePrice(item, priceType, PaymentMethod.Cash);
    const newCart = state.returnCart.map(i =>
      i.id === itemId ? { ...i, priceType, price: newPrice } : i
    );
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  clearCart: () => set(() => {
    return {
      returnCart: [],
      total: 0,
      isCartModalOpen: false,
    };
  }),
}));
