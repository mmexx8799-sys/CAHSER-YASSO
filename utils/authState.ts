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

export type AuthPhase = 'wait' | 'ready' | 'unresolved' | 'signOut';

/**
 * جدول حالات أول تحميل (يُستخدم في الـtimeout 8s):
 * - إن وصلت لقطة server (fromCache=false) → ready/signOut حسب exists
 * - إن بقيت فقط لقطات cache لـ8s → unresolved
 * - إن حدث error قبل أي لقطة server → unresolved
 */
export function decideInitialPhase(opts: {
  hasServerSnapshot: boolean;
  lastExists: boolean | null;
  lastFromCache: boolean | null;
  hasError: boolean;
}): AuthPhase {
  if (opts.hasServerSnapshot) {
    // server snapshot is authoritative
    return opts.lastExists ? 'ready' : 'signOut';
  }
  if (opts.hasError) return 'unresolved';
  return 'wait';
}
