// BUG-P0-4 — single source of truth for "net cash in drawer".
//
// BR-1 (decided in the original SPEC): net cash = collected cash MINUS
// cash returns only. On-account (customer) returns never leave the drawer,
// so they must not reduce this number.
//
// Both ArchivePage and ReportsPage must import this function instead of
// computing locally — that drift is exactly what BUG-P0-4 fixes.
//
// Old archives (stored before totalReturnsCash/totalReturnsOnAccount
// existed) carry no cash-split fields at all: fall back to totalReturns
// as a whole so they keep rendering instead of crashing.

import type { DailyArchive } from '../types';

export function calculateNetCash(
  archive: Pick<DailyArchive, 'totalCash' | 'totalReturns'> & {
    totalReturnsCash?: number;
    totalReturnsOnAccount?: number;
  }
): number {
  // Double condition (deliberate — see BUG-P0-4 review): an archive carrying
  // totalReturnsOnAccount but no totalReturnsCash is NOT an old archive —
  // it means every return was on-account, so cash returns are zero (not a
  // fallback to totalReturns, which would wrongly subtract on-account money
  // from the drawer). Only when BOTH split fields are absent do we fall back.
  const hasNewReturnFields = archive.totalReturnsCash !== undefined || archive.totalReturnsOnAccount !== undefined;
  const cashReturns = hasNewReturnFields ? (archive.totalReturnsCash || 0) : (archive.totalReturns || 0);
  return (archive.totalCash || 0) - cashReturns;
}
