
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
        let unsub: (() => void) | null = null;
        try {
            unsub = subscribeToDocument<AppSettings>('appSettings', 'main', (settings) => {
                const newAppName = settings?.appName || 'نقطة بيع للملابس';
                setAppName(newAppName);
                document.title = newAppName;
            });
        } catch (e) {
            // Firestore teardown race guard: subscription failed mid-lifecycle — retry on next tick.
            console.warn('AppSettings subscription failed, will be retried on remount:', e);
        }
        return () => {
            if (unsub) {
                try {
                    unsub();
                } catch (e) {
                    // Swallow synchronous teardown errors from Firestore internals.
                    console.warn('AppSettings unsubscribe swallowed an error:', e);
                }
            }
        };
    }, []);

    const value = useMemo(() => ({ appName }), [appName]);

    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
