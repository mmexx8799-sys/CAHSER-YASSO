import { describe, it, expect } from 'vitest';
import type { Product } from '../types';
import { computeStockAlerts, summarizeStockAlerts, groupStockAlertsByCategory, DEFAULT_MIN_QUANTITY } from '../utils/stockAlerts';

const mk = (overrides: Partial<Product> & { id: string }): Product => ({
  code: `C-${overrides.id}`,
  name: `P-${overrides.id}`,
  price: 10,
  quantity: 0,
  categoryId: 'cat-1',
  createdAt: Date.now(),
  searchableIndex: [],
  ...overrides,
} as Product);

// Helper: replicate original inline logic from ReportsPage.tsx for AC-07 parity check
function computeStockAlertsLegacy(products: Product[]): Product[] {
  const DEFAULT = 5;
  return [...products]
    .filter((p) => p.quantity === 0 || (p.quantity > 0 && p.quantity <= (p.minQuantity ?? DEFAULT)))
    .sort((a, b) => {
      const minA = a.minQuantity ?? DEFAULT;
      const minB = b.minQuantity ?? DEFAULT;
      const ratioA = a.quantity === 0 ? -1 : a.quantity / Math.max(minA, 1);
      const ratioB = b.quantity === 0 ? -1 : b.quantity / Math.max(minB, 1);
      return ratioA - ratioB;
    });
}

describe('utils/stockAlerts — REQ-DASHBOARD-StockAlerts', () => {
  it('AC-07 parity: DEFAULT_MIN_QUANTITY matches ReportsPage original (5)', () => {
    expect(DEFAULT_MIN_QUANTITY).toBe(5);
  });

  it('computeStockAlerts([]) → []', () => {
    expect(computeStockAlerts([])).toEqual([]);
  });

  it('filters out: quantity above threshold (normal products excluded)', () => {
    const products = [
      mk({ id: 'a', quantity: 10, minQuantity: 5, price: 10 }), // normal — excluded
      mk({ id: 'b', quantity: 6, minQuantity: 5, price: 10 }),  // above min — excluded
      mk({ id: 'c', quantity: 5, minQuantity: 5, price: 10 }),  // at threshold — included (low)
    ];
    const alerts = computeStockAlerts(products);
    expect(alerts.map((a) => a.product.id)).toEqual(['c']);
    expect(alerts[0].status).toBe('low');
  });

  it('out vs low classification', () => {
    const products = [
      mk({ id: 'out', quantity: 0, minQuantity: 5 }),
      mk({ id: 'low', quantity: 3, minQuantity: 5 }),
    ];
    const alerts = computeStockAlerts(products);
    expect(alerts.find((a) => a.product.id === 'out')!.status).toBe('out');
    expect(alerts.find((a) => a.product.id === 'low')!.status).toBe('low');
  });

  it('sorting: out (-1) first, then lowest ratio first', () => {
    const products = [
      mk({ id: 'low2', quantity: 2, minQuantity: 5 }), // ratio 0.4
      mk({ id: 'out', quantity: 0, minQuantity: 10 }),  // ratio -1
      mk({ id: 'low1', quantity: 1, minQuantity: 5 }), // ratio 0.2 — should be before low2
      mk({ id: 'out2', quantity: 0, minQuantity: 5 }), // ratio -1 — tie with out (stable order)
      mk({ id: 'normal', quantity: 100, minQuantity: 5 }), // excluded
    ];
    const alerts = computeStockAlerts(products);
    const ids = alerts.map((a) => a.product.id);
    // Both out (-1) before any low; low1 (0.2) before low2 (0.4)
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining(['out', 'out2']));
    expect(ids[2]).toBe('low1');
    expect(ids[3]).toBe('low2');
    expect(ids).not.toContain('normal');
  });

  it('minQuantity undefined defaults to 5', () => {
    const p = mk({ id: 'x', quantity: 5, price: 10 }); // minQuantity undefined → 5, so low
    delete (p as any).minQuantity;
    const alerts = computeStockAlerts([p]);
    expect(alerts.length).toBe(1);
    expect(alerts[0].min).toBe(5);
    expect(alerts[0].ratio).toBe(1); // 5/5

    const p2 = mk({ id: 'y', quantity: 6, price: 10 });
    delete (p2 as any).minQuantity;
    expect(computeStockAlerts([p2]).length).toBe(0); // 6 > 5 → excluded
  });

  it('minQuantity 0: Math.max(min,1) guards division by zero; quantity>0 && 1<=0 false so excluded unless 0', () => {
    // minQuantity=0, quantity=1 → filter: 1 <= 0 ? false → excluded
    const p = mk({ id: 'a', quantity: 1, minQuantity: 0 });
    expect(computeStockAlerts([p]).length).toBe(0);
    // quantity 0 still included (out) even with min 0
    const p2 = mk({ id: 'b', quantity: 0, minQuantity: 0 });
    const alerts = computeStockAlerts([p2]);
    expect(alerts.length).toBe(1);
    expect(alerts[0].ratio).toBe(-1);
  });

  it('valueAtRisk = quantity * price', () => {
    const p = mk({ id: 'a', quantity: 0, price: 12.5, minQuantity: 5 });
    const alerts = computeStockAlerts([p]);
    expect(alerts[0].valueAtRisk).toBe(0); // 0 * 12.5
    const p2 = mk({ id: 'b', quantity: 3, price: 20, minQuantity: 5 });
    expect(computeStockAlerts([p2])[0].valueAtRisk).toBe(60);
  });

  it('AC-07 strict parity: same products produce identical ordered IDs as legacy inline logic', () => {
    const products: Product[] = [
      mk({ id: 'p1', quantity: 0, minQuantity: 3, price: 10, categoryId: 'c1' }),
      mk({ id: 'p2', quantity: 2, minQuantity: 10, price: 5, categoryId: 'c1' }),
      mk({ id: 'p3', quantity: 5, price: 7, categoryId: 'c2' }), // min undefined →5, ratio 1
      mk({ id: 'p4', quantity: 1, minQuantity: 2, price: 100, categoryId: 'c2' }), // ratio 0.5
      mk({ id: 'p5', quantity: 0, price: 3, categoryId: 'c1' }), // out, min default 5
      mk({ id: 'p6', quantity: 20, minQuantity: 5, price: 1 }), // normal — excluded
      mk({ id: 'p7', quantity: 4, minQuantity: 8, price: 2 }), // ratio 0.5 — tie with p4
    ];
    const legacy = computeStockAlertsLegacy(products).map((p) => p.id);
    const next = computeStockAlerts(products).map((a) => a.product.id);
    expect(next).toEqual(legacy);
  });

  it('AC-10: summarizeStockAlerts counts + totalValueAtRisk', () => {
    const products = [
      mk({ id: 'o1', quantity: 0, price: 10, minQuantity: 5 }), // out, var 0
      mk({ id: 'o2', quantity: 0, price: 20, minQuantity: 5 }), // out, var 0
      mk({ id: 'l1', quantity: 2, price: 15, minQuantity: 5 }), // low, var 30
      mk({ id: 'l2', quantity: 3, price: 7, minQuantity: 5 }),  // low, var 21
      mk({ id: 'ok', quantity: 10, price: 100, minQuantity: 5 }), // excluded
    ];
    const alerts = computeStockAlerts(products);
    const summary = summarizeStockAlerts(alerts);
    expect(summary.totalValueAtRisk).toBe(0 + 0 + 30 + 21); // 51
    expect(summary.outCount).toBe(2);
    expect(summary.lowCount).toBe(2);
  });

  it('AC-10 manual: totalValueAtRisk equals sum(quantity*price) over alerts only', () => {
    const alerts = computeStockAlerts([
      mk({ id: 'a', quantity: 0, price: 100, minQuantity: 5 }),
      mk({ id: 'b', quantity: 1, price: 50, minQuantity: 5 }),
    ]);
    // a: 0*100=0, b:1*50=50 → total 50
    expect(summarizeStockAlerts(alerts).totalValueAtRisk).toBe(50);
  });

  it('groupStockAlertsByCategory groups by categoryId', () => {
    const alerts = computeStockAlerts([
      mk({ id: 'a', quantity: 0, categoryId: 'cat-1' }),
      mk({ id: 'b', quantity: 1, categoryId: 'cat-2', minQuantity: 5 }),
      mk({ id: 'c', quantity: 0, categoryId: 'cat-1' }),
    ]);
    const grouped = groupStockAlertsByCategory(alerts);
    expect(grouped.get('cat-1')!.map((a) => a.product.id).sort()).toEqual(['a', 'c']);
    expect(grouped.get('cat-2')!.map((a) => a.product.id)).toEqual(['b']);
  });

  it('groupStockAlertsByCategory([]) → empty Map', () => {
    expect(groupStockAlertsByCategory([]).size).toBe(0);
  });

  it('summarizeStockAlerts([]) → zeros', () => {
    expect(summarizeStockAlerts([])).toEqual({ outCount: 0, lowCount: 0, totalValueAtRisk: 0 });
  });
});
