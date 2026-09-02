
import React, { useState, createContext, useContext, ReactNode, useEffect, useMemo } from 'react';
import { subscribeToDocument } from '../services/dataCache';
import type { AppSettings } from '../types';

interface AppSettingsContextType {
    appName: string;
}

const AppSettingsContext = createContext<AppSettingsContextType>({ appName: 'نقطة بيع للملابس' });

export const useAppSettings = () => useContext(AppSettingsContext);

export const AppSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [appName, setAppName] = useState('نقطة بيع للملابس');

    useEffect(() => {
        const unsubscribe = subscribeToDocument<AppSettings>('appSettings', 'main', (settings) => {
            const newAppName = settings?.appName || 'نقطة بيع للملابس';
            setAppName(newAppName);
            document.title = newAppName;
        });
        return () => unsubscribe();
    }, []);

    const value = useMemo(() => ({ appName }), [appName]);

    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
