// Vitest setup: connect the app's singletons (services/firebase.ts) to the
// local emulators. initializeFirestore() (used by the app) never reads
// FIRESTORE_EMULATOR_HOST on its own — only getFirestore() does — so we must
// connect explicitly, exactly like connectAuthEmulator for Auth.

// Mock the browser-only toast before any app import.
import { vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { getDB, getAuthInstance } = await import('../services/firebase');
const { connectFirestoreEmulator } = await import('firebase/firestore');
const { connectAuthEmulator } = await import('firebase/auth');

// Idempotent guards: connect*Emulator throws if called twice.
try {
  connectFirestoreEmulator(getDB(), '127.0.0.1', 8080);
} catch { /* already connected */ }
try {
  connectAuthEmulator(getAuthInstance(), 'http://127.0.0.1:9099');
} catch { /* already connected */ }
