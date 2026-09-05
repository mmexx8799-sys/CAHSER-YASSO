
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, UserCog, X, UserX, UserCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useConfirmation } from '../components/ConfirmationProvider';
import { addUser, deleteUser, setUserDisabled } from '../services/api';
import { subscribeToCollection } from '../services/dataCache';
import type { User } from '../types';
import { UserRole } from '../types';
import { orderBy } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';

const UserFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (email: string, password: string, role: UserRole) => Promise<void>;
}> = ({ isOpen, onClose, onSave }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>(UserRole.Cashier);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await onSave(email, password, role);
            onClose();
            setEmail('');
            setPassword('');
            setRole(UserRole.Cashier);
        } catch (e) {
            // Error is already toasted by the API service
        }
        finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">إضافة مستخدم جديد</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <label htmlFor="newUserEmail" className="sr-only">البريد الإلكتروني</label>
                    <input id="newUserEmail" name="email" type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" required autoComplete="email" />
                    <label htmlFor="newUserPassword" className="sr-only">كلمة المرور</label>
                    <input id="newUserPassword" name="password" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" required autoComplete="new-password" />
                    <label htmlFor="newUserRole" className="sr-only">دور المستخدم</label>
                    <select id="newUserRole" name="role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded">
                        <option value={UserRole.Cashier}>كاشير</option>
                        <option value={UserRole.Admin}>مدير</option>
                    </select>
                    <div className="flex justify-end space-x-2 space-x-reverse">
                        <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded" disabled={isLoading}>إلغاء</button>
                        <button type="submit" className="py-2 px-4 bg-primary-600 text-white rounded" disabled={isLoading}>
                            {isLoading ? 'جاري الحفظ...' : 'حفظ'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { confirm } = useConfirmation();

    useEffect(() => {
        let unsub: (() => void) | null = null;
        try {
            const constraints: QueryConstraint[] = [orderBy('email')];
            // The data from subscribeToCollection includes an `id` property, which is the document ID.
            // We need to map this `id` to the `uid` property of our `User` type for consistency.
            unsub = subscribeToCollection<Omit<User, 'uid'>>('users', (usersData) => {
                const mappedUsers: User[] = usersData.map(doc => ({
                    uid: doc.id,
                    email: doc.email,
                    role: doc.role,
                    disabled: doc.disabled,
                }));
                setUsers(mappedUsers);
                setIsLoading(false);
            }, constraints);
        } catch (e) {
            // Firestore teardown race guard: subscription failed mid-lifecycle — show empty state instead of crashing.
            console.warn('Users subscription failed, showing empty list:', e);
            setIsLoading(false);
        }
        return () => {
            if (unsub) {
                try {
                    unsub();
                } catch (e) {
                    // Swallow synchronous teardown errors from Firestore internals.
                    console.warn('Users unsubscribe swallowed an error:', e);
                }
            }
        };
    }, []);

    const handleAddUser = async (email: string, password: string, role: UserRole) => {
        try {
            await addUser(email, password, role);
        } catch (error) {
            // Errors are already toasted in the API service, just log here
            console.error("Failed to add user from component:", error);
        }
    };

    const handleToggleDisabled = async (user: User) => {
        const newDisabledState = !user.disabled;
        const action = newDisabledState ? "تعطيل" : "تفعيل";
        const confirmed = await confirm({
            title: `${action} المستخدم`,
            message: `هل أنت متأكد من ${action} المستخدم "${user.email}"؟\n\nعند التعطيل: لن يتمكن من الوصول للبيانات (تُفرض من قواعد الحماية الخلفية فورًا).`
        });
        if (confirmed) {
            try {
                await setUserDisabled(user.uid, newDisabledState);
            } catch (error) {
                console.error('Failed to toggle user disabled state:', error);
            }
        }
    };

    const handleDeleteUser = async (user: User) => {
        const confirmed = await confirm({
            title: "حذف المستخدم نهائيًا",
            message: `تحذير: سيتم حذف سجل المستخدم "${user.email}" نهائيًا!\n\nلن يمنع هذا الإجراء المستخدم من تسجيل الدخول (يحتاج ترقية الخطة). فقط يُزيل سجل الصلاحيات.`
        });
        if (confirmed) {
            try {
                await deleteUser(user.uid);
            } catch (error) {
                // Error already toasted in API service
                console.error('Failed to delete user from component:', error);
            }
        }
    };

    return (
        <div className="p-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4 text-sm">
                <p className="text-yellow-800 dark:text-yellow-200">
                    <strong>ملاحظة أمنية:</strong> عند تعطيل مستخدم، لن يتمكن من الوصول لأي بيانات جديدة (تُفرض هذه القاعدة فورًا من الخادم). لكن قد تبقى بياناته محملة مسبقًا على أجهزته حتى تحديث الصفحة. للحذف النهائي للصلاحيات يحتاج المشروع ترقية خطة Firebase.
                </p>
            </div>
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
                <button onClick={() => setIsModalOpen(true)} className="flex items-center space-x-2 bg-primary-600 text-white py-2 px-4 rounded-lg shadow hover:bg-primary-700">
                    <Plus size={20} />
                    <span>مستخدم جديد</span>
                </button>
            </div>
            {isLoading ? (
                <div className="text-center p-10">جاري تحميل المستخدمين...</div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {users.map(user => (
                            <div key={user.uid} className={`p-4 flex justify-between items-center ${user.disabled ? 'bg-gray-50 dark:bg-gray-900 opacity-60' : ''}`}>
                                <div>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">{user.email}</p>
                                    <p className={`text-sm font-semibold ${user.role === 'admin' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                                        {user.role === 'admin' ? 'مدير' : 'كاشير'}
                                        {user.disabled && ' - مُعطَّل'}
                                    </p>
                                </div>
                                <div className="flex items-center space-x-2 space-x-reverse">
                                    <button
                                        onClick={() => handleToggleDisabled(user)}
                                        className={`p-2 rounded ${user.disabled ? 'text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-orange-600 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20'}`}
                                        title={user.disabled ? "تفعيل المستخدم" : "تعطيل المستخدم"}
                                        aria-label={user.disabled ? `تفعيل ${user.email}` : `تعطيل ${user.email}`}
                                    >
                                        {user.disabled ? <UserCheck size={18} /> : <UserX size={18} />}
                                    </button>
                                    <button
                                        onClick={() => handleDeleteUser(user)}
                                        className="text-red-700 dark:text-red-300 hover:text-red-800 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                        title="حذف نهائي"
                                        aria-label={`حذف ${user.email} نهائياً`}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <UserFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleAddUser} />
        </div>
    );
}
