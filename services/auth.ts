import {
    getAuth,
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User as FirebaseUser,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "firebase/auth";
import { doc, setDoc } from 'firebase/firestore';
import { getAuthInstance, getDB } from "./firebase";

const auth = getAuthInstance();
const db = getDB();

export const signIn = (email: string, password: string) => {
    return signInWithEmailAndPassword(auth, email, password);
};

export const signOut = () => {
    return firebaseSignOut(auth);
};

export const onAuthStateChangedListener = (callback: (user: FirebaseUser | null) => void) => {
    return onAuthStateChanged(auth, callback);
};

export const createAccount = async (email: string, password: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    // Create a document in the 'users' collection
    await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
    });
    return userCredential;
};

export const sendPasswordReset = (email: string) => {
    return sendPasswordResetEmail(auth, email);
};

// BUG-P0-6: require the current password and re-authenticate before any
// change. Never log passwords (current or new) on any path — including
// error messages.
export const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!auth.currentUser || !auth.currentUser.email) {
        throw new Error("لا يوجد مستخدم مسجَّل دخول");
    }
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
    try {
        await reauthenticateWithCredential(auth.currentUser, credential);
    } catch (error: any) {
        const code = String(error?.code || '');
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            throw new Error("كلمة السر الحالية غير صحيحة");
        }
        if (code === 'auth/requires-recent-login') {
            throw new Error("يرجى تسجيل الخروج والدخول مجددًا قبل هذه العملية");
        }
        throw error;
    }
    return updatePassword(auth.currentUser, newPassword);
};
