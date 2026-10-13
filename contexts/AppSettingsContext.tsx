
import React, { useState, createContext, useContext, ReactNode, useEffect, useMemo } from 'react';
import { subscribeToDocument } from '../services/dataCache';
import { useAuth } from './AuthContext';
import type { AppSettings } from '../types';

interface AppSettingsContextType {
    appName: string;
}

const AppSettingsContext = createContext<AppSettingsContextType>({ appName: 'نقطة بيع للملابس' });

export const useAppSettings = () => useContext(AppSettingsContext);

/**
 * REQ-REV1-4b: subscribe to app settings only for a signed-in identity.
 * A signed-out (or never-signed-in) shell must hold no listener, so a
 * logout-time cache clear cannot orphan this provider: the effect below
 * resubscribes on every uid transition.
 */
export const shouldSubscribeAppSettings = (
    uid: string | null | undefined,
): boolean => uid !== null && uid !== undefined && uid !== '';

export const AppSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [appName, setAppName] = useState('نقطة بيع للملابس');
    const { currentUser } = useAuth();
    const uid = currentUser?.uid;

    useEffect(() => {
        if (!shouldSubscribeAppSettings(uid)) return;
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
    }, [uid]);

    const value = useMemo(() => ({ appName }), [appName]);

    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
