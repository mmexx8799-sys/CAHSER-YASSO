// utils/authState.ts — pure decision for AuthContext snapshot (REQ-PERM-3:1,3)
// لا Firebase/ React — تُختبر في node.
export type SnapshotDecision = 'use' | 'wait' | 'signOut';

/**
 * يقرر ماذا يفعل AuthContext عند وصول لقطة users/{uid}.
 * - exists=true → استخدم البيانات فورًا (سواء cache أو server؛ التحديث الحقيقي يأتي لاحقًا من server snapshot)
 * - exists=false + fromCache=true → انتظر (لا تطرد — قد تكون بيانات cache فارغة قبل وصول server)
 * - exists=false + fromCache=false → signOut (الخادم يؤكد عدم وجود الوثيقة)
 */
export function decideSnapshotAction(exists: boolean, fromCache: boolean): SnapshotDecision {
  if (exists) return 'use';
  return fromCache ? 'wait' : 'signOut';
}

/**
 * هل نُظهر unresolved بعد مهلة 8s؟
 * لا تُظهر إذا كان لدينا مستخدم مستقر من cache بالفعل.
 */
export function shouldFlagUnresolved(opts: { hasServerSnapshot: boolean; hasResolvedUser: boolean }): boolean {
  return !opts.hasServerSnapshot && !opts.hasResolvedUser;
}
