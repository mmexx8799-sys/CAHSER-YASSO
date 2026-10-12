
import { 
  collection, 
  onSnapshot, 
  query,
  queryEqual,
  doc
} from "firebase/firestore";
import type { Query, QueryConstraint, DocumentData } from 'firebase/firestore';
import { getDB } from './firebase';

interface CacheEntry<T> {
  data: T;
  unsubscribe: () => void;
}

const db = getDB();
const cache = new Map<string, CacheEntry<any>>();
const activeSubscriptions = new Map<string, number>();

// Per-path lists of built-query entries. Sharing is decided ONLY by the
// public queryEqual comparator on the built queries — never by inspecting
// constraint internals, and never by reordering constraints.
interface CollectionEntry {
    callbacks: Set<(data: (DocumentData & { id: string })[]) => void>;
    data: (DocumentData & { id: string })[];
    builtQuery: Query;
    listening: boolean;
    unsubscribe: () => void;
}

const collectionEntries = new Map<string, CollectionEntry[]>();

// REQ-REV1-5b (K3-variant): logout epoch. Bumped on every
// `clearSubscriptionCache`; document release closures captured before the
// bump refuse to touch post-clear counts/entries (they address entries by
// key, not by instance — unlike the collection path).
let cacheEpoch = 0;

// Equivalence is true only if the public comparator says so.
// Indeterminable equivalence (throw) never shares.
const queriesMatch = (a: Query, b: Query): boolean => {
    try {
        return queryEqual(a, b);
    } catch {
        return false;
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
 * REQ-REV1-4b: tear the whole subscription cache down.
 * REQ-REV1-5a (K2): every stored unsubscribe is SCHEDULED exactly once via
 * `safeUnsubscribe` (microtask — the SDK 10.14.1 INTERNAL ASSERTION
 * workaround) instead of firing synchronously; each live entry is still
 * guarded (`entry.listening` / ref-counted key) so a second clear schedules
 * nothing. Everything else stays synchronous and unchanged: entries are
 * marked dead (`listening = false` + `callbacks.clear()`) on the spot so a
 * still-mounted component's stale closure can never re-fire an SDK
 * unsubscribe, then all three maps are emptied. Ordering invariant
 * (AC-5a.4): microtask FIFO runs every scheduled unsubscribe BEFORE any
 * auth-state-change notification that the auth SDK can deliver after
 * `firebaseSignOut` (a macrotask).
 * REQ-REV1-5b: bumps `cacheEpoch` first, orphaning pre-clear document
 * release closures (they return early instead of touching post-clear
 * state).
 */
export const clearSubscriptionCache = (): void => {
    cacheEpoch += 1;
    for (const entries of collectionEntries.values()) {
        for (const entry of entries) {
            // Only live entries: an already-released entry fired its SDK
            // unsubscribe through the normal release path — scheduling
            // again would double-teardown.
            if (entry.listening) {
                safeUnsubscribe(entry.unsubscribe);
            }
            entry.listening = false;
            entry.callbacks.clear();
        }
    }
    for (const [key, entry] of cache) {
        // Same rule for documents: only keys still ref-counted are live
        // (a released document drops its key from activeSubscriptions
        // while its entry object lingers for F6 immediate-data behavior).
        if (activeSubscriptions.has(key)) {
            safeUnsubscribe(entry.unsubscribe);
        }
    }
    collectionEntries.clear();
    cache.clear();
    activeSubscriptions.clear();
};

/**
 * REQ-REV1-4b: pure auth-transition predicate for the logout watcher.
 * True on logout (uid → null), account switch and other-tab /
 * session-expiry transitions (uidA → uidB); silent on null → null.
 */
export const didAuthIdentityChange = (
    prevUid: string | null,
    nextUid: string | null,
 ): boolean => prevUid !== nextUid;

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
    // Build first: a throwing construction fails closed for this caller
    // alone — no entry is stored and no ref-count leaks.
    const built = query(collection(db, path), ...constraints);

    let list = collectionEntries.get(path);
    if (!list) {
        list = [];
        collectionEntries.set(path, list);
    }

    const wrapped = (d: (DocumentData & { id: string })[]): void => {
        callback(d as (T & { id: string })[]);
    };

    // Share only with a semantically equal built query (public comparator).
    // Indeterminable equivalence never shares: it falls through to a
    // private entry below.
    let entry: CollectionEntry | undefined;
    for (const candidate of list) {
        if (queriesMatch(candidate.builtQuery, built)) {
            entry = candidate;
            break;
        }
    }

    let isNew = false;
    if (!entry) {
        entry = {
            builtQuery: built,
            callbacks: new Set(),
            data: [],
            listening: false,
            unsubscribe: () => {},
        };
        list.push(entry);
        isNew = true;
    }
    const target = entry;

    target.callbacks.add(wrapped);
    if (!isNew) {
        // Immediate cached data for joiners (possibly not yet loaded).
        wrapped(target.data);
    }
    if (!target.listening) {
        const unsubscribe = onSnapshot(built, (snapshot) => {
            const data = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as (T & { id: string })));
            target.data = data;
            for (const cb of target.callbacks) {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`Error notifying subscriber of ${path}: `, err);
                }
            }
        }, (error) => {
            console.error(`Error listening to ${path}: `, error);
        });
        target.unsubscribe = unsubscribe;
        target.listening = true;
    }

    return () => {
        target.callbacks.delete(wrapped);
        if (target.callbacks.size === 0 && target.listening) {
            target.listening = false;
            safeUnsubscribe(target.unsubscribe);
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
    // REQ-REV1-5b: pin the logout epoch. A release from before a clear
    // must never touch post-clear counts or entries (same-key resubscribe
    // would otherwise be unsubscribed through this stale closure).
    const myEpoch = cacheEpoch;

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
        if (myEpoch !== cacheEpoch) {
            // Pre-clear subscriber: the clear already scheduled this
            // generation's unsubscribe and wiped the counts — hands off.
            return;
        }
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
