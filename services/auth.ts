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

export const changePassword = async (newPassword: string) => {
    if (auth.currentUser) {
        return updatePassword(auth.currentUser, newPassword);
    }
    throw new Error("No user is currently signed in.");
};
