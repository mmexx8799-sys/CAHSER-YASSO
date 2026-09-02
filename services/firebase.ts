
import { initializeApp, FirebaseApp } from "firebase/app";
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  Firestore 
} from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";
import { getPerformance, FirebasePerformance } from "firebase/performance";

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
let performance: FirebasePerformance;

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
  performance = getPerformance(app);

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

/**
 * Gets the singleton Firebase Performance instance.
 * @returns {FirebasePerformance} The Firebase Performance instance.
 */
export const getPerformanceInstance = (): FirebasePerformance => {
    return performance;
}
