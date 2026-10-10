// utils/money.ts — REV1-2 (AUDIT-REV1): single home for money helpers.
// round2 is re-exported from services/api/opKey (one source, no second copy).
export { round2 } from '../services/api/opKey';

// Settled iff the absolute value is strictly below half a cent.
// Non-finite input settles (nothing collectible to display as debt).
export const isSettled = (b: unknown): boolean => Math.abs(Number(b) || 0) < 0.005;
