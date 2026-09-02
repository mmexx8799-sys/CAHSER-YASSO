import { create } from 'zustand';
import type { CartItem, Product } from '../types';

interface ReturnCartState {
  returnCart: CartItem[];
  total: number;
  isCartModalOpen: boolean;
  addToReturnCart: (product: Product) => void;
  updateItem: (itemId: string, newQuantity: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setCartModalOpen: (isOpen: boolean) => void;
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
        newCart = [...state.returnCart, { ...product, buyQuantity: 1 }];
    }
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  updateItem: (itemId, newQuantity) => set((state) => {
    if (newQuantity < 1) newQuantity = 1;
    const newCart = state.returnCart.map(item =>
      item.id === itemId ? { ...item, buyQuantity: newQuantity } : item
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

  clearCart: () => set(() => {
    return {
      returnCart: [],
      total: 0,
      isCartModalOpen: false,
    };
  }),
}));