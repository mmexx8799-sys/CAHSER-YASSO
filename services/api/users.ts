// services/api/users.ts — REQ-ARCH1-1 (ARCH-1 step 1/9)
// وحدة المستخدمين/RBAC والإعدادات، منقولة حرفيًا من services/api.ts
// (نقل بنيوي، صفر تغيير منطقي). updateDocument تبقى خاصة بالوحدة
// (غير مُصدَّرة) — مستخدمها الوحيد setUserDisabled داخل نفس الملف.
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    doc,
    setDoc,
    getDoc,
    deleteField,
    serverTimestamp,
    writeBatch,
    updateDoc,
} from "firebase/firestore";
import {
    getAuth,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { firebaseConfig } from '../firebase';
import { UserRole } from '../../types';
import type { AppSettings } from '../../types';
import { toast } from 'react-hot-toast';
import { withInFlightGuard } from '../inflight';
import {
    db,
    assertOnline,
    assertCan,
    isOfflineGuardError,
    deleteDocument,
} from './core';

// --- App Settings API ---
const APP_SETTINGS_ID = 'main';

export const updateAppSettings = withInFlightGuard(async (settings: Partial<AppSettings>) => {
    await assertOnline();
    try {
        const docRef = doc(db, 'appSettings', APP_SETTINGS_ID);
        await setDoc(docRef, settings, { merge: true });
        toast.success('تم تحديث إعدادات التطبيق.');
    } catch (error) {
        if (isOfflineGuardError(error)) throw error;
        console.error("Error updating app settings:", error);
        toast.error('فشل تحديث الإعدادات.');
    }
});

// --- User Management ---
export const checkIfUsersExist = async (): Promise<boolean> => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, limit(1));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
};

// FIX: Implement addUser to create a new user account and associated user document in firestore.
export const addUser = withInFlightGuard(async (email: string, password: string, role: UserRole): Promise<void> => {
    await assertOnline();
    // RBAC-2026-09 R2 AC-04: تحقق أن role ضمن UserRole قبل الإنشاء
    if (!Object.values(UserRole).includes(role)) {
        throw new Error("دور المستخدم غير صالح");
    }
    // S-1: fail-fast على قدرة المتصل قبل إنشاء أي حساب Auth — users.manage حصري
    // للمالك منذ R5. الترتيب مقصود: فحص الدور أولًا (اختبار restorePreflight
    // 'addUser rejects invalid role' يعتمد عليه)، ثم القدرة. بدون هذا السطر كان
    // غير المالك ينشئ حساب Auth يتيمًا (createUserWithEmailAndPassword ينجح) ثم
    // يُرفض setDoc بقواعد Firestore — حساب بلا وثيقة دور.
    await assertCan('users.manage');
    // A secondary app is used to create a user without signing out the current admin user.
    const tempApp = initializeApp(firebaseConfig, `secondary-auth-${Date.now()}`);
    const tempAuth = getAuth(tempApp);

    try {
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            role: role,
            disabled: false,
        });
        toast.success("تم إضافة المستخدم بنجاح");
    } catch (error: any) {
        if (isOfflineGuardError(error)) throw error;
        let message = "فشل في إضافة المستخدم.";
        if (error.code === 'auth/email-already-in-use') {
            message = 'هذا البريد الإلكتروني مستخدم بالفعل.';
        } else if (error.code === 'auth/weak-password') {
            message = 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل.';
        }
        toast.error(message);
        throw error;
    } finally {
        await deleteApp(tempApp);
    }
});

// FIX: Implement deleteUser to remove a user's role document from firestore.
// AUDIT-SEC-2 (يتيم الحذف — موثق، بلا كود جديد عمدًا): يحذف users/{uid} فقط؛
// حساب Auth يبقى حيًا (قيد Firebase client SDK — لا يقدر يحذف حساب مستخدم آخر).
// اليتيم محروم فعليًا من كل شيء (لا وثيقة → assertCan والقواعد ترفض)، لكن إعادة
// إضافة نفس البريد تصطدم بـemail-already-in-use. الإتمام اليدوي عبر
// scripts/deleteAuthUser.mjs (Admin SDK + تأكيد تفاعلي). مقترح مستقبلي (UX فقط):
// تحذير واجهة بعد الحذف يوجّه لتشغيل السكريبت — مسجل في backlog.
export const deleteUser = async (uid: string) => {
    try {
        await deleteDocument('users', uid);
        toast.success("تم حذف دور المستخدم بنجاح.");
    } catch (error) {
        if (isOfflineGuardError(error)) throw error;
        toast.error("فشل حذف دور المستخدم.");
        throw error;
    }
};

export const setUserDisabled = async (uid: string, disabled: boolean) => {
    try {
        await updateDocument('users', uid, { disabled });
        toast.success(disabled ? "تم تعطيل المستخدم بنجاح." : "تم تفعيل المستخدم بنجاح.");
    } catch (error) {
        if (isOfflineGuardError(error)) throw error;
        toast.error("فشل تحديث حالة المستخدم.");
        throw error;
    }
};

export const setUserCapOverrides = withInFlightGuard(async (targetUid: string, overrides: { grants: string[]; denies: string[] }) => {
    await assertOnline();
    const auth = getAuth();
    const byUid = auth.currentUser?.uid;
    if (!byUid) throw new Error("يجب تسجيل الدخول أولاً");
    const userRef = doc(db, 'users', targetUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error("المستخدم غير موجود");
    const beforeData = snap.data() as any;
    const before = { grants: beforeData.capGrants || [], denies: beforeData.capDenies || [] };
    const after = { grants: overrides.grants || [], denies: overrides.denies || [] };
    const batch = writeBatch(db);
    const update: any = {};
    if (after.grants.length === 0) update.capGrants = deleteField();
    else update.capGrants = after.grants;
    if (after.denies.length === 0) update.capDenies = deleteField();
    else update.capDenies = after.denies;
    update.permsUpdatedBy = byUid;
    update.permsUpdatedAt = serverTimestamp();
    batch.update(userRef, update);
    const auditRef = doc(collection(db, 'permissionAudit'));
    batch.set(auditRef, {
        by: byUid,
        at: serverTimestamp(),
        targetUid,
        before,
        after,
    });
    try {
        await batch.commit();
        toast.success("تم تحديث الصلاحيات بنجاح");
    } catch (e: any) {
        if (isOfflineGuardError(e)) throw e;
        toast.error(e?.message || "فشل تحديث الصلاحيات");
        throw e;
    }
});

export const getPermissionAudit = async (targetUid: string, limitCount = 5) => {
    const q = query(collection(db, 'permissionAudit'), where('targetUid', '==', targetUid), orderBy('at', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
};

// Generic function to update a document — REQ-SEC1-6 (AUDIT-SEC-1):
// NO LONGER EXPORTED. Internal use only (setUserDisabled below). Pages must
// use updateCustomerProfile / updateSupplierProfile / saveProduct instead,
// so no caller can smuggle arbitrary fields (e.g. balance) into a write.
const updateDocument = withInFlightGuard(async (collectionPath: string, id: string, data: any) => {
    await assertOnline();
    try {
        const docRef = doc(db, collectionPath, id);
        await updateDoc(docRef, data);
    } catch (e) {
        if (isOfflineGuardError(e)) throw e;
        console.error("Error updating document: ", e);
        throw new Error("Failed to update document");
    }
});
