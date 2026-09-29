// services/api.ts — ARCH-1 DONE (step 9/9): barrel خالص. المنطق كله في
// services/api/ (core/users/products/customers/suppliers/purchases/sales/returns/archives/backup). لا منطق هنا إطلاقًا.
export { OfflineGuardError, isOfflineGuardError, assertOnlineCore, deleteDocument } from './api/core';
export type { OnlineDeps, TxRetryInfo } from './api/core';
export * from './api/users';
export * from './api/products';
export * from './api/customers';
export * from './api/suppliers';
export * from './api/purchases';
export * from './api/archives';
export * from './api/returns';
export * from './api/sales';
export * from './api/backup';
