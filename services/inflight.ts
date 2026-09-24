// OFFLINE-P1 D-O9 (3): حارس "كتابة جارية" — يمنع reload التحديث أثناء عملية كتابة.
//
// التصميم: withInFlightGuard يغلّف كل export كتابة من الـ22 في services/api.ts
// من بره (enter عند النداء، leave في finally عند انتهاء الدالة كاملة — نجاح أو
// فشل). لا فجوات: الغطاء يشمل retries/batches الداخلية بلا تخمين توقيت، ولا
// debounce. الاستدعاءات المتداخلة (deleteUser→deleteDocument) متوازنة (أزواج).
import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function enterWrite(): void {
  count += 1;
  emit();
}

export function leaveWrite(): void {
  count = Math.max(0, count - 1);
  emit();
}

/** true أثناء أي عملية كتابة جارية — يستخدمه بانر التحديث لتعطيل الزر. */
export function useAnyWriteInFlight(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => count > 0,
  );
}

/** يغلّف دالة كتابة كاملة — الجسم الداخلي لا يُمس. */
export function withInFlightGuard<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  const wrapped = async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    enterWrite();
    try {
      return await fn(...args);
    } finally {
      leaveWrite();
    }
  };
  return wrapped as T;
}
