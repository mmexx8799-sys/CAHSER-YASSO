import { describe, it, expect } from 'vitest';
import { resolveEmptyState } from '../utils/dashboardAggregation';

// REQ-UX-DASH-1 (أ): empty-state message selector — pure, no aggregation touched.
// - open-only  → open-day hint (NEW)
// - closed     → null (full page renders; unchanged)
// - nothing    → legacy message (unchanged, byte-identical)

describe('dashboard empty state (REQ-UX-DASH-1 a)', () => {
  it('open-only → open-day hint', () => {
    expect(resolveEmptyState(false, true)).toEqual({
      title: 'لا توجد بيانات كافية بعد',
      hint: 'اليومية الحالية لسه مفتوحة. اقفلها من الأرشيف لتظهر الإحصائيات.',
    });
  });

  it('closed → null (full page renders, unchanged)', () => {
    expect(resolveEmptyState(true, false)).toBeNull();
    expect(resolveEmptyState(true, true)).toBeNull();
  });

  it('nothing → legacy message unchanged', () => {
    expect(resolveEmptyState(false, false)).toEqual({
      title: 'لا توجد بيانات كافية بعد',
      hint: 'لم يتم إغلاق أي يومية حتى الآن',
    });
  });
});
