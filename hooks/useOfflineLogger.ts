// OFFLINE-P1 REQ-OFF1-4 — تسجيل الانقطاعات حدثي فقط (لا setInterval)
import { useEffect } from 'react';
import { logOfflineEnd, logOfflineStart } from '../services/offlineLog';

export function useOfflineLogger(): void {
  useEffect(() => {
    // إن كان أوفلاين عند التحميل، سجّل start
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      logOfflineStart().catch(() => {});
    }
    const onOffline = () => {
      logOfflineStart().catch(() => {});
    };
    const onOnline = () => {
      logOfflineEnd().catch(() => {});
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const onVis = () => {
      if (document.visibilityState === 'hidden') return;
      if (!navigator.onLine) logOfflineStart().catch(() => {});
      else logOfflineEnd().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}
