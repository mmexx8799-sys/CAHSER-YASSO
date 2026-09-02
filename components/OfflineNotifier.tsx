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
            className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white py-2 px-4 rounded-lg shadow-lg flex items-center space-x-2 space-x-reverse z-[101]"
            role="alert"
            aria-live="assertive"
        >
            <WifiOff size={18} />
            <span className="text-sm font-medium">أنت غير متصل بالإنترنت. قد تكون البيانات غير محدثة.</span>
        </div>
    );
};

export default OfflineNotifier;
