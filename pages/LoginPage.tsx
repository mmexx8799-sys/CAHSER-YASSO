
import React, { useState, useEffect } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { signIn, createAccount, sendPasswordReset } from '../services/auth';
import { checkIfUsersExist } from '../services/api';
import { toast } from 'react-hot-toast';
import { useAppSettings } from '../contexts/AppSettingsContext';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isCreateMode, setIsCreateMode] = useState(false);
    const { appName } = useAppSettings();

    const [usersExist, setUsersExist] = useState<boolean | null>(null);
    const showCreateAccountButton = usersExist === false;

    useEffect(() => {
        const checkUsers = async () => {
            try {
                const exists = await checkIfUsersExist();
                setUsersExist(exists);
                if (!exists) {
                    setIsCreateMode(true);
                }
            } catch (error) {
                console.error("Failed to check users existence", error);
                setUsersExist(true);
            }
        };
        checkUsers();
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await signIn(email, password);
            // The AuthProvider will handle navigation
        } catch (error: any) {
            let message = "فشل تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.";
            if (error.code === 'auth/invalid-credential') {
                message = "البريد الإلكتروني أو كلمة المرور غير صحيحة."
            } else if (error.code === 'auth/user-not-found') {
                message = "هذا المستخدم غير موجود."
            } else if (error.code === 'auth/wrong-password') {
                message = "كلمة المرور غير صحيحة."
            } else if (error.code === 'auth/too-many-requests') {
                message = "تم حظر الوصول مؤقتاً بسبب تكرار المحاولات الفاشلة. يرجى المحاولة لاحقاً."
            }
            toast.error(message);
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) {
            toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
            return;
        }
        if (password !== confirmPassword) {
            toast.error("كلمتا المرور غير متطابقتين.");
            return;
        }
        setIsLoading(true);
        try {
            await createAccount(email, password);
            toast.success("تم إنشاء الحساب بنجاح وتم تسجيل الدخول.");
            // The AuthProvider will handle navigation
        } catch (error: any) {
            let message = "فشل في إنشاء الحساب.";
            if (error.code === 'auth/email-already-in-use') {
                message = 'هذا البريد الإلكتروني مستخدم بالفعل.';
            } else if (error.code === 'auth/weak-password') {
                message = 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 أحرف على الأقل.';
            }
            toast.error(message);
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordReset = async () => {
        if (!email) {
            toast.error("يرجى إدخال بريدك الإلكتروني أولاً.");
            return;
        }
        try {
            await sendPasswordReset(email);
            toast.success("تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.");
        } catch (error) {
            toast.error("فشل في إرسال البريد الإلكتروني.");
            console.error(error);
        }
    };

    return (
        <main className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4 sm:p-6 lg:p-8 transition-colors duration-200">
            <div className="w-full max-w-sm sm:max-w-md p-6 sm:p-8 lg:p-10 space-y-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg transition-colors duration-200">
                <div className="text-center">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100">{appName}</h1>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        {isCreateMode ? "إنشاء حساب جديد" : "تسجيل الدخول"}
                    </p>
                </div>

                <form data-testid="login-form" className="space-y-5 sm:space-y-6" onSubmit={isCreateMode ? handleCreateAccount : handleLogin}>
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">البريد الإلكتروني</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2 mt-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md"
                            placeholder="name@example.com"
                            autoComplete="email"
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">كلمة المرور</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 mt-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md"
                            placeholder="********"
                            autoComplete={isCreateMode ? "new-password" : "current-password"}
                        />
                    </div>
                    {isCreateMode && (
                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300">تأكيد كلمة المرور</label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-3 py-2 mt-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md"
                                placeholder="********"
                                autoComplete="new-password"
                            />
                        </div>
                    )}
                    <div>
                        <button data-testid="login-submit" type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 border rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                            {isLoading ? 'جاري التنفيذ...' : (
                                isCreateMode ? <><UserPlus className="mr-2" size={20} /> إنشاء حساب</> : <><LogIn className="mr-2" size={20} /> تسجيل الدخول</>
                            )}
                        </button>
                    </div>
                </form>

                {!isCreateMode && (
                    <div className="text-sm text-center">
                        <button onClick={handlePasswordReset} className="font-medium text-primary-600 hover:text-primary-500">
                            هل نسيت كلمة المرور؟
                        </button>
                    </div>
                )}

                {showCreateAccountButton && !isCreateMode && (
                    <div className="text-sm text-center text-gray-600 dark:text-gray-300">
                        <button onClick={() => setIsCreateMode(true)} className="font-medium text-primary-600 dark:text-primary-300 hover:text-primary-500">
                            إنشاء حساب جديد
                        </button>
                    </div>
                )}

                {isCreateMode && (
                    <div className="text-sm text-center text-gray-600 dark:text-gray-300">
                        <button onClick={() => setIsCreateMode(false)} className="font-medium text-primary-600 dark:text-primary-300 hover:text-primary-500">
                            العودة لتسجيل الدخول
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
