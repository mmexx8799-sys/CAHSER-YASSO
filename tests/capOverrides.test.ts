// tests/capOverrides.test.ts — pure logic for REQ-PERM-4 (node)
import { describe, it, expect } from 'vitest';
import { UserRole } from '../types';
import { statesToLists, CAP_LABELS_AR } from '../utils/capOverrides';
import { OVERRIDABLE_CAPS } from '../utils/permissions';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

describe('statesToLists — cleaning no-effect', () => {
  it('grant for cap role already has → excluded', () => {
    const { grants, denies } = statesToLists(UserRole.Cashier, { sell: 'grant' } as any);
    expect(grants).toEqual([]);
    expect(denies).toEqual([]);
  });
  it('deny for cap role does not have → excluded', () => {
    const { grants, denies } = statesToLists(UserRole.Cashier, { 'product.price': 'deny' } as any);
    expect(denies).toEqual([]);
    expect(grants).toEqual([]);
  });
  it('grant effective and deny effective are kept', () => {
    const { grants, denies } = statesToLists(UserRole.Cashier, { 'product.price': 'grant', sell: 'deny' } as any);
    expect(grants).toEqual(['product.price']);
    expect(denies).toEqual(['sell']);
  });
  it('accountant grant rules excluded, deny ui kept', () => {
    const { grants, denies } = statesToLists(UserRole.Accountant, { sell: 'grant', 'report.view': 'deny' } as any);
    expect(grants).not.toContain('sell');
    expect(denies).toContain('report.view');
    // grant ui where already has is no-effect → excluded
    const { grants: g2 } = statesToLists(UserRole.Accountant, { 'report.view': 'grant' } as any);
    expect(g2).toEqual([]);
  });
  it('non-overridable never appears', () => {
    const { grants, denies } = statesToLists(UserRole.Cashier, { 'users.manage': 'grant', 'ledger.delete': 'deny' } as any);
    expect(grants).toEqual([]);
    expect(denies).toEqual([]);
  });
  it('no conflict: grants/denies disjoint and sorted', () => {
    const { grants, denies } = statesToLists(UserRole.Cashier, { 'product.price': 'grant', sell: 'deny', 'customer.write': 'grant' } as any);
    expect(grants).toEqual([...grants].sort());
    expect(denies).toEqual([...denies].sort());
    const inter = grants.filter(c => denies.includes(c));
    expect(inter).toEqual([]);
  });
  it('accountant grant dashboard.view (ui) is kept', () => {
    const { grants } = statesToLists(UserRole.Accountant, { 'dashboard.view': 'grant' } as any);
    expect(grants).toContain('dashboard.view');
  });
  it('Arabic labels exist for all overridable', () => {
    for (const cap of Object.keys(OVERRIDABLE_CAPS)) {
      expect(CAP_LABELS_AR[cap], `label for ${cap}`).toBeTruthy();
    }
  });
});

describe('permissionAudit outside backup', () => {
  it('permissionAudit not in BUSINESS_DATA_COLLECTIONS', () => {
    const apiText = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../services/api.ts'), 'utf8');
    const m = apiText.match(/const BUSINESS_DATA_COLLECTIONS = \[([\s\S]*?)\] as const/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('permissionAudit');
  });
  it('firestore.indexes.json contains permissionAudit composite', () => {
    const idx = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../firestore.indexes.json'), 'utf8'));
    const found = (idx.indexes as any[]).some(i => i.collectionGroup === 'permissionAudit' && i.fields.some((f:any)=>f.fieldPath==='targetUid') && i.fields.some((f:any)=>f.fieldPath==='at'));
    expect(found).toBe(true);
  });
});
