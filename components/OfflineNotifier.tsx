import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

const OfflineNotifier: React.FC = () => {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOffline = () => setIsOffline(true);
        const handleOnline = () => setIsOffline(false);

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    if (!isOffline) {
        return null;
    }

    return (
        <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-bold shadow-sm border border-amber-600 shrink-0"
            role="status"
            aria-live="polite"
            title="وضع عدم الاتصال — القراءة فقط"
        >
            <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <WifiOff size={12} className="shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">عدم اتصال</span>
            <span className="sm:hidden">أوفلاين</span>
        </div>
    );
};

export default OfflineNotifier;
