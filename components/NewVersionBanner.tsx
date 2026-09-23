import React, { useEffect, useState } from 'react';
// NOTE: 'virtual:pwa-register/react' يوفّره vite-plugin-pwa وقت البناء —
// الأنواع عبر src/pwa.d.ts (/// <reference types="vite-plugin-pwa/client" />).
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAnyWriteInFlight } from '../services/inflight';

// OFFLINE-P1 D-O9: بانر تحديث النسخة — تذكير غير مُلح وقابل للإغلاق.
// - الاكتشاف عبر useRegisterSW (نفس آلية SW) + registration.update() دوري كل
//   5 دقائق كـbackstop للتبويب المفتوح (المتصفح يفحص عند التنقل فقط افتراضيًا).
// - لا reload تلقائي إطلاقًا — فقط بضغطة صريحة على "تحديث الآن".
// - الزر معطّل أثناء أي كتابة جارية (isAnyWriteInFlight) أو أوفلاين.
const UPDATE_CHECK_MS = 5 * 60 * 1000;

const NewVersionBanner: React.FC = () => {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            if (!r) return;
            const timer = setInterval(() => {
                r.update().catch(() => {
                    // فشل الفحص الدوري (أوفلاين غالبًا) — يُعاد تلقائيًا لاحقًا
                });
            }, UPDATE_CHECK_MS);
            // تنظيف عند إلغاء تحميل الوحدة (HMR) — لا setInterval دائم بلا مالك
            if (typeof window !== 'undefined') {
                window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
            }
        },
    });
    const busy = useAnyWriteInFlight();
    const [isOffline, setIsOffline] = useState(
        typeof navigator !== 'undefined' ? !navigator.onLine : false,
    );

    useEffect(() => {
        const on = () => setIsOffline(false);
        const off = () => setIsOffline(true);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);

    if (!needRefresh) return null;

    const blocked = busy || isOffline;
    const hint = isOffline
        ? 'لا يمكن التحديث أوفلاين — عُد للاتصال أولًا'
        : busy
            ? 'في انتظار انتهاء العملية الحالية'
            : undefined;

    return (
        <div
            className="fixed bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white flex items-center gap-3 py-2.5 px-4 rounded-full shadow-lg border border-gray-700 text-sm font-medium max-w-[92vw]"
            role="status"
            aria-live="polite"
        >
            <RefreshCw size={16} className="shrink-0 text-teal-300" aria-hidden="true" />
            <span className="whitespace-nowrap">يوجد إصدار جديد</span>
            <button
                onClick={() => updateServiceWorker(true)}
                disabled={blocked}
                title={hint}
                aria-label="تحديث الآن"
                className="shrink-0 px-3 py-1 rounded-full bg-teal-600 hover:bg-teal-500 font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
                تحديث الآن
            </button>
            <button
                onClick={() => setNeedRefresh(false)}
                aria-label="إغلاق التنبيه"
                className="shrink-0 p-1 rounded-full hover:bg-gray-700 text-gray-300 transition-colors"
            >
                <X size={16} />
            </button>
        </div>
    );
};

export default NewVersionBanner;
