
import { initializeApp, FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  Firestore
} from "firebase/firestore";
import { getAuth, connectAuthEmulator, Auth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyDkP4sNYxHkVffXADVdunXU0iDxlXAWuDE",
  authDomain: "casher-yasoo.firebaseapp.com",
  databaseURL: "https://casher-yasoo-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "casher-yasoo",
  storageBucket: "casher-yasoo.firebasestorage.app",
  messagingSenderId: "285707912161",
  appId: "1:285707912161:web:fcda41b3d68bc8dbc7c8a0"
};

// --- Singleton Firebase Instance ---
// This pattern ensures that Firebase is initialized only once.

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;

try {
  app = initializeApp(firebaseConfig);
  
  // Use modern Firestore initialization with Persistent Local Cache
  // This replaces the older enableIndexedDbPersistence and handles tab synchronization better
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });

  auth = getAuth(app);

  // E2E-ONLY (Stage-3 3.1): wire the running app to the local emulators when
  // explicitly opted in via VITE_USE_EMULATORS=1 (dev/E2E only — never set in
  // production builds). Without this flag the app always talks to production.
  // Playwright run: VITE_USE_EMULATORS=1 vite + firebase emulators:start.
  // NOTE: direct import.meta.env access (no intermediate variable) so Vite
  // statically replaces it and tree-shakes the emulator branch out of
  // production builds entirely. Types via vite-env.d.ts (vite/client).
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === '1') {
    try {
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    } catch { /* already connected (HMR) — fine */ }
    try {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099');
    } catch { /* already connected (HMR) — fine */ }
  }

} catch (error) {
    console.error("Firebase initialization failed:", error);
}


/**
 * Gets the singleton Firestore database instance.
 * @returns {Firestore} The Firestore instance.
 */
export const getDB = (): Firestore => {
  return db;
};

/**
 * Gets the singleton Firebase Auth instance.
 * @returns {Auth} The Firebase Auth instance.
 */
export const getAuthInstance = (): Auth => {
    return auth;
}
