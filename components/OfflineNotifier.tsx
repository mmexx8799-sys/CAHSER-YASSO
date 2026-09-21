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
            className="fixed top-16 inset-x-0 z-40 bg-amber-500 text-white flex items-center justify-center gap-2 py-1.5 px-4 text-sm font-medium shadow-sm border-b border-amber-600"
            role="status"
            aria-live="polite"
        >
            <WifiOff size={16} className="shrink-0" aria-hidden="true" />
            <span>وضع عدم الاتصال — القراءة فقط</span>
            <span className="hidden sm:inline opacity-90 font-normal">— البيانات قد تكون غير محدثة</span>
        </div>
    );
};

export default OfflineNotifier;
