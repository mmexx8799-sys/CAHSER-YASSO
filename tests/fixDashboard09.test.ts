import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product } from '../types';
import { computeStockAlerts, summarizeStockAlerts } from '../utils/stockAlerts';

// --- Dashboard filtered totalValueAtRisk (Bug 2) ---
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

describe('FIX-REQ-DASHBOARD-09 Bug2: filtered totalValueAtRisk', () => {
  it('filtered summary differs from total when category filter active', () => {
    const products: Product[] = [
      mk({ id: 'a', quantity: 0, price: 100, categoryId: 'cat-1', minQuantity: 5 }), // out var 0
      mk({ id: 'b', quantity: 2, price: 50, categoryId: 'cat-1', minQuantity: 5 }),  // var 100
      mk({ id: 'c', quantity: 3, price: 20, categoryId: 'cat-2', minQuantity: 5 }),  // var 60
    ];
    const alerts = computeStockAlerts(products);
    const total = summarizeStockAlerts(alerts);
    expect(total.totalValueAtRisk).toBe(160); // 0+100+60

    const filtered = alerts.filter((a) => a.product.categoryId === 'cat-1');
    const filteredSummary = summarizeStockAlerts(filtered);
    expect(filteredSummary.totalValueAtRisk).toBe(100); // only cat-1
    expect(filteredSummary.totalValueAtRisk).not.toBe(total.totalValueAtRisk);
  });

  it('empty filter yields 0', () => {
    const filteredSummary = summarizeStockAlerts([]);
    expect(filteredSummary.totalValueAtRisk).toBe(0);
  });
});

// --- getProductById (Bug 1) — mocked Firestore ---
describe('FIX-REQ-DASHBOARD-09 Bug1: getProductById direct fetch', () => {
  beforeEach(() => vi.resetModules());

  it('returns product for existing id', async () => {
    const fakeProduct = { name: 'Test', price: 10, quantity: 1 };
    const mockSnap = { exists: () => true, id: 'prod-123', data: () => fakeProduct };
    vi.doMock('firebase/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
      return { ...actual, getDoc: vi.fn().mockResolvedValue(mockSnap), doc: vi.fn().mockReturnValue({}) };
    });
    // need to mock firebase config getDB as well
    vi.doMock('../services/firebase', () => ({
      getDB: () => ({}),
      firebaseConfig: {},
    }));
    const { getProductById } = await import('../services/api');
    const p = await getProductById('prod-123');
    expect(p).not.toBeNull();
    expect(p!.id).toBe('prod-123');
    expect(p!.name).toBe('Test');
  });

  it('returns null for missing/deleted id', async () => {
    vi.resetModules();
    const mockSnap = { exists: () => false, id: 'missing', data: () => null };
    vi.doMock('firebase/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
      return { ...actual, getDoc: vi.fn().mockResolvedValue(mockSnap), doc: vi.fn().mockReturnValue({}) };
    });
    vi.doMock('../services/firebase', () => ({
      getDB: () => ({}),
      firebaseConfig: {},
    }));
    const { getProductById: get2 } = await import('../services/api');
    const p = await get2('missing-id');
    expect(p).toBeNull();
  });

  it('returns null for empty id without calling getDoc', async () => {
    vi.resetModules();
    const getDocMock = vi.fn();
    vi.doMock('firebase/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
      return { ...actual, getDoc: getDocMock, doc: vi.fn().mockReturnValue({}) };
    });
    vi.doMock('../services/firebase', () => ({
      getDB: () => ({}),
      firebaseConfig: {},
    }));
    const { getProductById: get3 } = await import('../services/api');
    const p = await get3('   ');
    expect(p).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});
