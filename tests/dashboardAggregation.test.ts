import { describe, it, expect } from 'vitest';
import type { DailyArchive, Invoice, Return } from '../types';
import {
  getRangeBounds,
  filterArchivesByRange,
  aggregateRange,
  compareRanges,
  topSellingDays,
  topSellingProducts,
} from '../utils/dashboardAggregation';

const mkArchive = (overrides: Partial<DailyArchive> & { id: string; startTime: number }): DailyArchive => ({
  status: 'closed',
  totalSales: 0,
  totalReturns: 0,
  totalCash: 0,
  totalCredit: 0,
  totalVodafoneCash: 0,
  totalInstapay: 0,
  totalReturnsCash: 0,
  totalReturnsOnAccount: 0,
  ...overrides,
});

const mkInvoice = (id: string, items: any[], createdAt: number): Invoice =>
  ({
    id,
    invoiceNumber: `INV-${id}`,
    items,
    subtotal: 0,
    discount: 0,
    total: 0,
    paymentMethod: 'نقدا' as any,
    createdAt,
    dailyArchiveId: '2026-01-01',
  }) as Invoice;

const mkReturn = (id: string, items: any[], createdAt: number): Return =>
  ({
    id,
    items,
    total: 0,
    createdAt,
    dailyArchiveId: '2026-01-01',
  }) as Return;

describe('dashboardAggregation', () => {
  it('AC-01: empty archives → zero summary and flat comparison', () => {
    const s = aggregateRange([]);
    expect(s.totalSales).toBe(0);
    expect(s.workingDays).toBe(0);
    expect(s.netCash).toBe(0);
    const cmp = compareRanges(s, s);
    expect(cmp.pct).toBeNull();
    expect(cmp.direction).toBe('flat');
    expect(topSellingDays([], 5)).toEqual([]);
    expect(topSellingProducts([], [], 5)).toEqual([]);
  });

  it('aggregateRange sums and counts working days (closed only)', () => {
    const a1 = mkArchive({ id: '2026-01-01', startTime: 1000, totalSales: 100, totalReturns: 10, totalCash: 80, status: 'closed' });
    const a2 = mkArchive({ id: '2026-01-02', startTime: 2000, totalSales: 50, totalReturns: 0, totalCash: 50, status: 'open' });
    const s = aggregateRange([a1, a2]);
    expect(s.totalSales).toBe(150);
    expect(s.totalReturns).toBe(10);
    expect(s.workingDays).toBe(1);
  });

  it('netCash uses calculateNetCash (cash returns only)', () => {
    const a = mkArchive({
      id: 'd1',
      startTime: 1000,
      totalCash: 1000,
      totalReturns: 200,
      totalReturnsCash: 50,
      totalReturnsOnAccount: 150,
      status: 'closed',
    });
    const s = aggregateRange([a]);
    expect(s.netCash).toBe(950); // 1000 - 50
  });

  it('filterArchivesByRange', () => {
    const a1 = mkArchive({ id: 'd1', startTime: 1000 });
    const a2 = mkArchive({ id: 'd2', startTime: 2000 });
    const a3 = mkArchive({ id: 'd3', startTime: 3000 });
    expect(filterArchivesByRange([a1, a2, a3], 1500, 2500).map((a) => a.id)).toEqual(['d2']);
  });

  it('compareRanges pct and direction', () => {
    const cur = aggregateRange([mkArchive({ id: 'c', startTime: 1, totalSales: 150, status: 'closed' })]);
    const prev = aggregateRange([mkArchive({ id: 'p', startTime: 1, totalSales: 100, status: 'closed' })]);
    const cmp = compareRanges(cur, prev);
    expect(cmp.pct).toBeCloseTo(50);
    expect(cmp.direction).toBe('up');
    const cmpDown = compareRanges(prev, cur);
    expect(cmpDown.direction).toBe('down');
    const cmpFlat = compareRanges(prev, prev);
    expect(cmpFlat.pct).toBe(0);
    expect(cmpFlat.direction).toBe('flat');
  });

  it('compareRanges previous 0 → pct null', () => {
    const cur = aggregateRange([mkArchive({ id: 'c', startTime: 1, totalSales: 100, status: 'closed' })]);
    const prev = aggregateRange([]);
    const cmp = compareRanges(cur, prev);
    expect(cmp.pct).toBeNull();
    expect(cmp.direction).toBe('up');
  });

  it('topSellingDays: sorts desc, excludes zero, top 5', () => {
    const archives = [
      mkArchive({ id: 'd1', startTime: 1000, totalSales: 0 }),
      mkArchive({ id: 'd2', startTime: 2000, totalSales: 300 }),
      mkArchive({ id: 'd3', startTime: 3000, totalSales: 100 }),
      mkArchive({ id: 'd4', startTime: 4000, totalSales: 200 }),
    ];
    const top = topSellingDays(archives, 5);
    expect(top.map((a) => a.id)).toEqual(['d2', 'd4', 'd3']);
    expect(top.find((a) => a.id === 'd1')).toBeUndefined();
  });

  it('getRangeBounds days and previous length same', () => {
    const now = new Date(2026, 0, 15, 12).getTime();
    const b7 = getRangeBounds('7d', now);
    expect(b7.days).toBe(7);
    expect(b7.end - b7.start).toBe(7 * 86400000 - 1);
    expect(b7.start - b7.prevStart).toBe(6 * 86400000 + 1);
    const b30 = getRangeBounds('30d', now);
    expect(b30.days).toBe(30);
    const bToday = getRangeBounds('today', now);
    expect(bToday.days).toBe(1);
  });

  it('AC-03: topSellingProducts aggregates same product across invoices', () => {
    const inv1 = mkInvoice('1', [{ id: 'p1', name: 'منتج A', code: 'A', buyQuantity: 2, price: 10 }], 1000);
    const inv2 = mkInvoice('2', [{ id: 'p1', name: 'منتج A', code: 'A', buyQuantity: 3, price: 10 }], 2000);
    const top = topSellingProducts([inv1, inv2], [], 5);
    expect(top.length).toBe(1);
    expect(top[0].quantity).toBe(5);
    expect(top[0].total).toBe(50);
  });

  it('AC-04: return deducts from net quantity', () => {
    const inv = mkInvoice('1', [{ id: 'p1', name: 'منتج A', code: 'A', buyQuantity: 5, price: 10 }], 1000);
    const ret = mkReturn('r1', [{ id: 'p1', name: 'منتج A', code: 'A', buyQuantity: 2, price: 10 }], 1500);
    const top = topSellingProducts([inv], [ret], 5);
    expect(top[0].quantity).toBe(3);
    expect(top[0].total).toBe(30);
  });

  it('deleted product still shows denormalized name', () => {
    const inv = mkInvoice('1', [{ id: 'pX', name: 'قديم محذوف', code: 'OLD', buyQuantity: 1, price: 5 }], 1000);
    const top = topSellingProducts([inv], [], 5);
    expect(top[0].name).toBe('قديم محذوف');
  });

  it('tie in quantity sorted by name', () => {
    const inv1 = mkInvoice('1', [{ id: 'p1', name: 'ب', code: 'B', buyQuantity: 2, price: 10 }], 1000);
    const inv2 = mkInvoice('2', [{ id: 'p2', name: 'ا', code: 'A', buyQuantity: 2, price: 10 }], 1000);
    const top = topSellingProducts([inv1, inv2], [], 5);
    expect(top[0].name).toBe('ا');
    expect(top[1].name).toBe('ب');
  });
});
