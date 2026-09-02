import { create } from 'zustand';
import type { CartItem, Product } from '../types';
import { toast } from 'react-hot-toast';

interface PosCartState {
  cart: CartItem[];
  subtotal: number;
  isCartModalOpen: boolean;
  addToCart: (product: Product) => void;
  updateItem: (itemId: string, newQuantity: number, newPrice: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setCartModalOpen: (isOpen: boolean) => void;
}

const calculateSubtotal = (cart: CartItem[]) => {
  return cart.reduce((total, item) => total + item.price * item.buyQuantity, 0);
};

export const usePosCartStore = create<PosCartState>((set) => ({
  cart: [],
  subtotal: 0,
  isCartModalOpen: false,
  setCartModalOpen: (isOpen) => set({ isCartModalOpen: isOpen }),
  
  addToCart: (product) => set((state) => {
    const existingItem = state.cart.find(item => item.id === product.id);
    let newCart: CartItem[];
    if (existingItem) {
      if (existingItem.buyQuantity < product.quantity) {
        newCart = state.cart.map(item =>
          item.id === product.id ? { ...item, buyQuantity: item.buyQuantity + 1 } : item
        );
      } else {
        toast.error('لا يمكن إضافة كمية أكبر من المتاح بالمخزون');
        return state;
      }
    } else {
      newCart = [...state.cart, { ...product, buyQuantity: 1 }];
    }
    return {
      cart: newCart,
      subtotal: calculateSubtotal(newCart),
    };
  }),

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

  clearCart: () => set(() => {
    return {
      cart: [],
      subtotal: 0,
      isCartModalOpen: false,
    };
  }),
}));