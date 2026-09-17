// REQ-A AC-3 + REQ-B: نتيجتا addToCart/addToReturnCart (نجاح/رفض داخلي).
// وحدات خالصة (vitest، بلا Emulator): الـstores فقط، بلا DOM.
import { describe, it, expect, beforeEach } from 'vitest';
import { usePosCartStore } from '../stores/posCartStore';
import { useReturnCartStore } from '../stores/returnCartStore';
import type { Product } from '../types';

const mkProduct = (id: string, quantity: number): Product => ({
  id,
  code: `C-${id}`,
  name: `منتج ${id}`,
  price: 10,
  quantity,
  categoryId: 'cat-1',
  createdAt: Date.now(),
  searchableIndex: [],
});

beforeEach(() => {
  usePosCartStore.getState().clearCart();
  useReturnCartStore.getState().clearCart();
});

describe('REQ-A AC-3: usePosCartStore.addToCart تُرجع boolean', () => {
  it('إضافة صنف جديد → true والصنف في السلة', () => {
    const added = usePosCartStore.getState().addToCart(mkProduct('a', 5));
    expect(added).toBe(true);
    expect(usePosCartStore.getState().cart).toHaveLength(1);
  });

  it('إضافة تحت السقف → true مع زيادة الكمية', () => {
    const s = usePosCartStore.getState();
    expect(s.addToCart(mkProduct('a', 5))).toBe(true);
    expect(usePosCartStore.getState().addToCart(mkProduct('a', 5))).toBe(true);
    expect(usePosCartStore.getState().cart[0].buyQuantity).toBe(2);
  });

  it('الوصول للسقف (buyQuantity >= quantity) → false بلا زيادة', () => {
    const s = usePosCartStore.getState();
    expect(s.addToCart(mkProduct('a', 1))).toBe(true);
    expect(usePosCartStore.getState().addToCart(mkProduct('a', 1))).toBe(false);
    expect(usePosCartStore.getState().cart[0].buyQuantity).toBe(1);
    expect(usePosCartStore.getState().cart).toHaveLength(1);
  });
});

describe('REQ-B: useReturnCartStore.addToReturnCart تُرجع boolean', () => {
  it('إضافة صنف جديد → true', () => {
    const added = useReturnCartStore.getState().addToReturnCart(mkProduct('r', 3));
    expect(added).toBe(true);
    expect(useReturnCartStore.getState().returnCart).toHaveLength(1);
  });

  it('تجاوز سقف المخزون المؤقت → false بلا زيادة', () => {
    const s = useReturnCartStore.getState();
    expect(s.addToReturnCart(mkProduct('r', 1))).toBe(true);
    expect(useReturnCartStore.getState().addToReturnCart(mkProduct('r', 1))).toBe(false);
    expect(useReturnCartStore.getState().returnCart[0].buyQuantity).toBe(1);
  });
});
