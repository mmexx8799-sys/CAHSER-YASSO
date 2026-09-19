import type { Product } from '../types';

export const DEFAULT_MIN_QUANTITY = 5;

export type StockAlertStatus = 'out' | 'low';

export interface StockAlert {
  product: Product;
  status: StockAlertStatus;
  min: number;
  ratio: number;
  valueAtRisk: number;
}

export function computeStockAlerts(products: Product[]): StockAlert[] {
  return products
    .filter((p) => p.quantity === 0 || (p.quantity > 0 && p.quantity <= (p.minQuantity ?? DEFAULT_MIN_QUANTITY)))
    .map((p) => {
      const min = p.minQuantity ?? DEFAULT_MIN_QUANTITY;
      const ratio = p.quantity === 0 ? -1 : p.quantity / Math.max(min, 1);
      const status: StockAlertStatus = p.quantity === 0 ? 'out' : 'low';
      const valueAtRisk = p.quantity * p.price;
      return { product: p, status, min, ratio, valueAtRisk };
    })
    .sort((a, b) => a.ratio - b.ratio);
}

export function summarizeStockAlerts(alerts: StockAlert[]): {
  outCount: number;
  lowCount: number;
  totalValueAtRisk: number;
} {
  let outCount = 0;
  let lowCount = 0;
  let totalValueAtRisk = 0;
  for (const a of alerts) {
    if (a.status === 'out') outCount++;
    else lowCount++;
    totalValueAtRisk += a.valueAtRisk;
  }
  return { outCount, lowCount, totalValueAtRisk };
}

export function groupStockAlertsByCategory(alerts: StockAlert[]): Map<string, StockAlert[]> {
  const map = new Map<string, StockAlert[]>();
  for (const a of alerts) {
    const key = a.product.categoryId;
    const arr = map.get(key);
    if (arr) arr.push(a);
    else map.set(key, [a]);
  }
  return map;
}
