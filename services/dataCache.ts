
import { 
  collection, 
  onSnapshot, 
  query,
  doc
} from "firebase/firestore";
import type { QueryConstraint, DocumentData } from 'firebase/firestore';
import { getDB } from './firebase';

interface CacheEntry<T> {
  data: T;
  unsubscribe: () => void;
}

const db = getDB();
const cache = new Map<string, CacheEntry<any>>();
const activeSubscriptions = new Map<string, number>();

// A simple key generator for queries.
const generateCacheKey = (path: string, constraints: QueryConstraint[]): string => {
    try {
        const constraintString = constraints.map(c => JSON.stringify((c as any)._toFieldFilter ? (c as any)._toFieldFilter() : c.type)).join(';');
        return `${path}::${constraintString}`;
    } catch {
        return `${path}::${constraints.length}`;
    }
};

type Unsubscribe = () => void;

/**
 * Delays the actual Firestore unsubscribe call to a microtask, so it never
 * races with an in-flight remote event being processed by the SyncEngine
 * (workaround for SDK 10.14.1 "INTERNAL ASSERTION FAILED: Unexpected state"
 * thrown when teardown happens mid-watch-processing).
 */
const safeUnsubscribe = (unsub: () => void) => {
    queueMicrotask(() => {
        try {
            unsub();
        } catch (e) {
            // Swallow post-teardown SDK assertion errors — listener is gone anyway.
            console.warn('Firestore unsubscribe swallowed an internal error:', e);
        }
    });
};

/**
 * Subscribes to a Firestore collection with caching and automatic listener management.
 * @param path The collection path.
 * @param callback The function to call with the data.
 * @param constraints Firestore query constraints.
 * @returns An unsubscribe function.
 */
export const subscribeToCollection = <T extends DocumentData>(
    path: string, 
    callback: (data: (T & { id: string })[]) => void,
    constraints: QueryConstraint[] = []
): Unsubscribe => {
    const cacheKey = generateCacheKey(path, constraints);
    
    const currentSubCount = activeSubscriptions.get(cacheKey) || 0;
    activeSubscriptions.set(cacheKey, currentSubCount + 1);

    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry) {
        // Return cached data immediately to improve perceived performance
        callback(cachedEntry.data);
    }

    if (currentSubCount === 0) {
        // This is the first subscriber for this query, so create a new listener.
        const q = query(collection(db, path), ...constraints);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as (T & { id: string })));
            
            const newEntry: CacheEntry<(T & { id: string })[]> = { data, unsubscribe };
            cache.set(cacheKey, newEntry);
            
            callback(data);
        }, (error) => {
            console.error(`Error listening to ${path}: `, error);
        });
        
        const entry = cache.get(cacheKey) || { data: [], unsubscribe };
        entry.unsubscribe = unsubscribe;
        cache.set(cacheKey, entry);
    }

    return () => {
        const count = activeSubscriptions.get(cacheKey);
        if (count && count > 1) {
            activeSubscriptions.set(cacheKey, count - 1);
        } else {
            const entry = cache.get(cacheKey);
            if (entry && entry.unsubscribe) {
                safeUnsubscribe(entry.unsubscribe);
            }
            activeSubscriptions.delete(cacheKey);
        }
    };
};

/**
 * Subscribes to a single Firestore document with caching.
 * @param path The collection path.
 * @param docId The document ID.
 * @param callback The function to call with the data.
 * @returns An unsubscribe function.
 */
export const subscribeToDocument = <T extends DocumentData>(
    path: string,
    docId: string,
    callback: (data: (T & { id: string }) | null) => void
): Unsubscribe => {
    const cacheKey = `${path}/${docId}`;
    
    const currentSubCount = activeSubscriptions.get(cacheKey) || 0;
    activeSubscriptions.set(cacheKey, currentSubCount + 1);

    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry) {
        callback(cachedEntry.data);
    }

    if (currentSubCount === 0) {
        const docRef = doc(db, path, docId);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            let data: (T & { id: string }) | null = null;
            if (docSnap.exists()) {
                data = { id: docSnap.id, ...docSnap.data() } as (T & { id: string });
            }
            cache.set(cacheKey, { data, unsubscribe });
            callback(data);
        }, (error) => {
            console.error(`Error listening to document ${cacheKey}:`, error);
        });

        const entry = cache.get(cacheKey) || { data: null, unsubscribe };
        entry.unsubscribe = unsubscribe;
        cache.set(cacheKey, entry);
    }

    return () => {
        const count = activeSubscriptions.get(cacheKey);
        if (count && count > 1) {
            activeSubscriptions.set(cacheKey, count - 1);
        } else {
            const entry = cache.get(cacheKey);
            if (entry && entry.unsubscribe) {
                safeUnsubscribe(entry.unsubscribe);
            }
            activeSubscriptions.delete(cacheKey);
        }
    };
};
