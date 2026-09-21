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
            className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white flex items-center gap-2 py-2 px-4 rounded-full shadow-lg border border-gray-700 text-sm font-medium max-w-[90vw]"
            role="status"
            aria-live="polite"
        >
            <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <WifiOff size={14} className="shrink-0 opacity-80" aria-hidden="true" />
            <span>وضع عدم الاتصال</span>
            <span className="opacity-60">·</span>
            <span className="opacity-80 font-normal hidden sm:inline">القراءة فقط</span>
        </div>
    );
};

export default OfflineNotifier;
