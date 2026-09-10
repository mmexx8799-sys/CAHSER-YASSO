import { create } from 'zustand';
import { toast } from 'react-hot-toast';
import type { CartItem, Product, PriceType } from '../types';
import { PaymentMethod } from '../types';
import { resolvePrice } from './posCartStore';

// ─────────────────────────────────────────────────────────────────────────────
// REQ-M13-FIX: client-side defense layer ONLY (quantity/price sanity caps).
// NOT a security fix: processReturn() still trusts item.price/item.buyQuantity
// from the client — server-side validation inside the transaction is P0-1c,
// and linking the true returnable quantity to the original invoice is P0-1.
// The temporary caps below (current stock / 2x highest defined price) are
// expected to be tightened or replaced once P0-1 lands.
// ─────────────────────────────────────────────────────────────────────────────

interface ReturnCartState {
  returnCart: CartItem[];
  total: number;
  isCartModalOpen: boolean;
  pricingMethod: PaymentMethod;
  addToReturnCart: (product: Product) => void;
  updateItem: (itemId: string, newQuantity: number, newPrice?: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setCartModalOpen: (isOpen: boolean) => void;
  setItemPriceType: (itemId: string, priceType: PriceType) => void;
  setPricingMethod: (method: PaymentMethod) => void;
}

const calculateTotal = (cart: CartItem[]) => {
  return cart.reduce((total, item) => total + item.price * item.buyQuantity, 0);
};

// TEMPORARY manual-price ceiling (REQ-M13-FIX): never accept more than 2x the
// highest of the product's four defined prices (legacy `price` included as
// fallback for products missing the four fields). Final decision (admin-only
// field or audit reason) is a separate later item.
const priceCeiling = (item: CartItem): number => {
  return 2 * Math.max(
    item.retailCashPrice ?? 0,
    item.retailCreditPrice ?? 0,
    item.wholesaleCashPrice ?? 0,
    item.wholesaleCreditPrice ?? 0,
    item.price ?? 0,
  );
};

export const useReturnCartStore = create<ReturnCartState>((set) => ({
  returnCart: [],
  total: 0,
  isCartModalOpen: false,
  pricingMethod: PaymentMethod.Cash, // explicit Cash/Credit toggle drives pricing — never inferred from the linked customer
  setCartModalOpen: (isOpen) => set({ isCartModalOpen: isOpen }),

  addToReturnCart: (product) => set((state) => {
    const existingItem = state.returnCart.find(item => item.id === product.id);
    let newCart: CartItem[];
    if (existingItem) {
      // TEMPORARY cap: current stock (will be replaced by invoice-linked
      // returnable quantity in P0-1).
      if (existingItem.buyQuantity >= product.quantity) {
        toast.error('لا يمكن إضافة كمية أكبر من المتاح بالمخزون');
        return state;
      }
      newCart = state.returnCart.map(item =>
        item.id === product.id ? { ...item, buyQuantity: item.buyQuantity + 1 } : item
      );
    } else {
      newCart = [...state.returnCart, { ...product, buyQuantity: 1, priceType: 'retail' as const, price: resolvePrice(product, 'retail', state.pricingMethod) }];
    }
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  updateItem: (itemId, newQuantity, newPrice) => set((state) => {
    const item = state.returnCart.find(i => i.id === itemId);
    if (!item) return state;

    // TEMPORARY cap: quantity can't exceed current stock (POS-parity clamp +
    // toast). Replaced by invoice-linked cap in P0-1.
    if (newQuantity > item.quantity) {
      toast.error('الكمية المطلوبة أكبر من المخزون المتاح.');
      newQuantity = item.quantity;
    }
    if (newQuantity < 1) newQuantity = 1;

    let price = newPrice != null ? newPrice : item.price;
    if (price < 0) price = 0;
    const ceiling = priceCeiling(item);
    if (price > ceiling) {
      toast.error('السعر يتجاوز الحد المسموح (ضعف أعلى سعر معرف للمنتج).');
      price = ceiling;
    }

    const newCart = state.returnCart.map(i =>
      i.id === itemId ? { ...i, buyQuantity: newQuantity, price } : i
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

  // Per-item retail/wholesale resolution uses the explicit pricingMethod
  // (Cash/Credit) chosen in the UI — never inferred from the linked customer.
  setItemPriceType: (itemId, priceType) => set((state) => {
    const item = state.returnCart.find(i => i.id === itemId);
    if (!item) return state;
    const newPrice = resolvePrice(item, priceType, state.pricingMethod);
    const newCart = state.returnCart.map(i =>
      i.id === itemId ? { ...i, priceType, price: newPrice } : i
    );
    return {
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  // Invoice-wide pricing basis — mirrors POS recalcCartPrices: re-resolve every
  // item's price from its own priceType under the new method.
  setPricingMethod: (method) => set((state) => {
    if (state.pricingMethod === method) return state;
    const newCart = state.returnCart.map(i => ({
      ...i,
      price: resolvePrice(i, i.priceType, method),
    }));
    return {
      pricingMethod: method,
      returnCart: newCart,
      total: calculateTotal(newCart),
    };
  }),

  clearCart: () => set(() => {
    return {
      returnCart: [],
      total: 0,
      isCartModalOpen: false,
      pricingMethod: PaymentMethod.Cash, // reset so a fresh cart never inherits stale Credit pricing
    };
  }),
}));
