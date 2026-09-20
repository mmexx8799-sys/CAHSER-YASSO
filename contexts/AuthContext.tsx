import React, { useState, createContext, useContext, ReactNode, useEffect, useMemo, useRef, useCallback } from 'react';
import { onAuthStateChangedListener, signOut } from '../services/auth';
import type { User as AppUser } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDB } from '../services/firebase';
import { decideSnapshotAction, shouldFlagUnresolved } from '../utils/authState';

interface AuthContextType {
    currentUser: AppUser | null;
    isLoading: boolean;
    isUnresolved: boolean;
    retry: () => void;
}

const AuthContext = createContext<AuthContextType>({ currentUser: null, isLoading: true, isUnresolved: false, retry: () => {} });

export const useAuth = () => useContext(AuthContext);

function equalUser(a: AppUser | null, b: AppUser | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUnresolved, setIsUnresolved] = useState(false);
    const lastUserRef = useRef<AppUser | null>(null);
    const hasRealUserRef = useRef(false);

    const [retryTick, setRetryTick] = useState(0);
    const retry = useCallback(() => setRetryTick(x => x + 1), []);

    useEffect(() => {
        let innerUnsub: (() => void) | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let gen = 0;
        let hasServerSnapshot = false;

        const authUnsub = onAuthStateChangedListener((user: FirebaseUser | null) => {
            gen += 1;
            const myGen = gen;
            if (innerUnsub) { try { innerUnsub(); } catch { /* ignore */ } innerUnsub = null; }
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            hasServerSnapshot = false;

            if (!user) {
                setCurrentUser(null);
                lastUserRef.current = null;
                hasRealUserRef.current = false;
                setIsLoading(false);
                setIsUnresolved(false);
                return;
            }

            hasRealUserRef.current = false;
            setIsLoading(true);
            setIsUnresolved(false);
            const userDocRef = doc(getDB(), 'users', user.uid);
            timeoutId = setTimeout(() => {
                if (myGen !== gen) return;
                if (shouldFlagUnresolved({ hasServerSnapshot, hasResolvedUser: hasRealUserRef.current })) {
                    setIsUnresolved(true);
                    setIsLoading(false);
                }
            }, 8000);

            innerUnsub = (onSnapshot as any)(userDocRef, { includeMetadataChanges: true }, (snap: any) => {
                if (myGen !== gen) return;
                const fromCache = snap.metadata?.fromCache === true;
                if (!fromCache) hasServerSnapshot = true;
                if (timeoutId && hasServerSnapshot) { clearTimeout(timeoutId); timeoutId = null; }

                const action = decideSnapshotAction(snap.exists(), fromCache);
                if (action === 'wait') return;
                if (action === 'signOut') {
                    if (!fromCache) {
                        signOut().catch(()=>{ /* ignore signOut race */ });
                        const next: AppUser | null = null;
                        hasRealUserRef.current = false;
                        if (!equalUser(lastUserRef.current, next)) { lastUserRef.current = next; setCurrentUser(next); }
                        setIsLoading(false);
                        setIsUnresolved(false);
                    }
                    return;
                }
                const data = snap.data() as any;
                const next: AppUser = {
                    uid: user.uid,
                    email: user.email!,
                    role: data.role,
                    disabled: data.disabled,
                    capGrants: data.capGrants,
                    capDenies: data.capDenies,
                };
                hasRealUserRef.current = true;
                if (!equalUser(lastUserRef.current, next)) {
                    lastUserRef.current = next;
                    setCurrentUser(next);
                }
                setIsLoading(false);
                setIsUnresolved(false);
            }, (e: any) => {
                if (myGen !== gen) return;
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                console.error("Auth Check Error", e);
                if (lastUserRef.current) {
                    setIsLoading(false);
                } else {
                    setCurrentUser({ uid: user.uid, email: user.email! });
                    lastUserRef.current = { uid: user.uid, email: user.email! };
                    setIsUnresolved(true);
                    setIsLoading(false);
                }
            });
        });

        return () => {
            if (innerUnsub) try { innerUnsub(); } catch { /* ignore */ }
            try { authUnsub(); } catch { /* ignore */ }
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [retryTick]);

    const value = useMemo(() => ({ currentUser, isLoading, isUnresolved, retry }), [currentUser, isLoading, isUnresolved, retry]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
