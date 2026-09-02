
import React, { useState, createContext, useContext, ReactNode, useEffect, useMemo } from 'react';
import { onAuthStateChangedListener, signOut } from '../services/auth';
import type { User as AppUser } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getDB } from '../services/firebase';

interface AuthContextType {
    currentUser: AppUser | null;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({ currentUser: null, isLoading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChangedListener(async (user: FirebaseUser | null) => {
            if (user) {
                // Verify the user document exists in Firestore.
                const userDocRef = doc(getDB(), 'users', user.uid);
                try {
                    const userDoc = await getDoc(userDocRef);
                    if (userDoc.exists()) {
                        const data = userDoc.data();
                        setCurrentUser({
                            uid: user.uid,
                            email: user.email!,
                            role: data.role,
                            disabled: data.disabled
                        });
                    } else {
                        await signOut();
                        setCurrentUser(null);
                    }
                } catch (e) {
                    console.error("Auth Check Error", e);
                    // Fallback or handle offline
                    setCurrentUser({ uid: user.uid, email: user.email! });
                }
            } else {
                setCurrentUser(null);
            }
            setIsLoading(false);
        });
        return unsubscribe;
    }, []);

    // Memoize value to prevent unnecessary context updates.
    // Dependencies are explicitly listed to ensure stability.
    const value = useMemo(() => ({ currentUser, isLoading }), [currentUser, isLoading]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
