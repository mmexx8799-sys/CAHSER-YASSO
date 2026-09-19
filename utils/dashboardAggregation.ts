import type { DailyArchive, Invoice, Return } from '../types';
import { calculateNetCash } from './archiveCalculations';

export type RangePreset = 'today' | '7d' | '30d' | 'month';

export interface RangeBounds {
  start: number;
  end: number;
  prevStart: number;
  prevEnd: number;
  days: number;
}

export interface RangeSummary {
  totalSales: number;
  totalReturns: number;
  netCash: number;
  workingDays: number;
  totalCash: number;
  totalCredit: number;
  totalVodafoneCash: number;
  totalInstapay: number;
}

export interface ComparisonResult {
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
  current: number;
  previous: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  code: string;
  quantity: number;
  total: number;
}

// Returns start/end for current range and immediately-previous range of same length
export function getRangeBounds(preset: RangePreset, now = Date.now()): RangeBounds {
  const d = new Date(now);
  // Normalize to local midnight for day boundaries
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;

  if (preset === 'today') {
    const days = 1;
    const start = startOfToday;
    const end = endOfToday;
    const prevStart = start - days * 86400000;
    const prevEnd = start - 1;
    return { start, end, prevStart, prevEnd, days };
  }
  if (preset === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const end = endOfToday;
    const days = Math.round((end - start + 1) / 86400000) || 1;
    const prevEnd = start - 1;
    const prevStart = prevEnd - (days - 1) * 86400000;
    return { start, end, prevStart, prevEnd, days };
  }
  // 7d / 30d — includes today
  const days = preset === '7d' ? 7 : 30;
  const start = startOfToday - (days - 1) * 86400000;
  const end = endOfToday;
  const prevEnd = start - 1;
  const prevStart = prevEnd - (days - 1) * 86400000;
  return { start, end, prevStart, prevEnd, days };
}

export function filterArchivesByRange(archives: DailyArchive[], startMs: number, endMs: number): DailyArchive[] {
  return archives.filter((a) => {
    const t = a.startTime;
    return t >= startMs && t <= endMs;
  });
}

export function aggregateRange(archives: DailyArchive[]): RangeSummary {
  let totalSales = 0;
  let totalReturns = 0;
  let totalCash = 0;
  let totalCredit = 0;
  let totalVodafoneCash = 0;
  let totalInstapay = 0;
  let netCash = 0;
  let workingDays = 0;
  for (const a of archives) {
    totalSales += a.totalSales || 0;
    totalReturns += a.totalReturns || 0;
    totalCash += a.totalCash || 0;
    totalCredit += a.totalCredit || 0;
    totalVodafoneCash += a.totalVodafoneCash || 0;
    totalInstapay += a.totalInstapay || 0;
    netCash += calculateNetCash(a as any);
    if (a.status === 'closed') workingDays += 1;
  }
  return { totalSales, totalReturns, netCash, workingDays, totalCash, totalCredit, totalVodafoneCash, totalInstapay };
}

export function compareRanges(current: RangeSummary, previous: RangeSummary): ComparisonResult {
  const cur = current.totalSales || 0;
  const prev = previous.totalSales || 0;
  if (prev === 0) {
    if (cur === 0) return { pct: null, direction: 'flat', current: cur, previous: prev };
    return { pct: null, direction: 'up', current: cur, previous: prev };
  }
  const pct = ((cur - prev) / prev) * 100;
  const direction: ComparisonResult['direction'] = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct, direction, current: cur, previous: prev };
}

export function topSellingDays(archives: DailyArchive[], limit = 5): DailyArchive[] {
  return [...archives]
    .filter((a) => (a.totalSales || 0) > 0)
    .sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0))
    .slice(0, limit);
}

export function topSellingProducts(invoices: Invoice[], returns: Return[], limit = 10): TopProduct[] {
  const map = new Map<string, TopProduct>();

  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const id = (item as any).id;
      if (!id) continue;
      const qty = (item as any).buyQuantity || 0;
      const price = (item as any).price || 0;
      const name = (item as any).name || 'غير معروف';
      const code = (item as any).code || '';
      const entry = map.get(id);
      if (entry) {
        entry.quantity += qty;
        entry.total += qty * price;
        // keep first name/code
      } else {
        map.set(id, { productId: id, name, code, quantity: qty, total: qty * price });
      }
    }
  }

  for (const ret of returns) {
    for (const item of ret.items || []) {
      const id = (item as any).id;
      if (!id) continue;
      const qty = (item as any).buyQuantity || 0;
      const price = (item as any).price || 0;
      const entry = map.get(id);
      if (entry) {
        entry.quantity -= qty;
        entry.total -= qty * price;
      } else {
        // returned product never sold in period — still show negative if needed
        const name = (item as any).name || 'غير معروف';
        const code = (item as any).code || '';
        map.set(id, { productId: id, name, code, quantity: -qty, total: -qty * price });
      }
    }
  }

  const arr = [...map.values()].filter((p) => p.quantity !== 0);
  arr.sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return a.name.localeCompare(b.name, 'ar');
  });
  return arr.slice(0, limit);
}
