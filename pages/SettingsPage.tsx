
import React, { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sunrise, Sunset, AlertTriangle, KeyRound, Upload, Download, Save, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getOpenDailyArchive, closeDailyArchive, startNewDailyArchive, backupData, restoreData, factoryReset, updateAppSettings } from '../services/api';
import { changePassword } from '../services/auth';
import type { DailyArchive, BackupData } from '../types';
import { useConfirmation } from '../components/ConfirmationProvider';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { usePosCartStore } from '../stores/posCartStore';
import { useReturnCartStore } from '../stores/returnCartStore';

// --- Sub Components for Performance Isolation ---

const DailyOpsSection = memo(({
    dailyArchive,
    isLoading,
    onStartDay,
    onEndDay
}: {
    dailyArchive: DailyArchive | null;
    isLoading: boolean;
    onStartDay: () => void;
    onEndDay: () => void;
}) => {
    if (isLoading) {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                <h2 className="font-bold text-xl mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 text-gray-900 dark:text-gray-100">عمليات اليومية</h2>
                <p className="text-center text-gray-600 dark:text-gray-300">جاري تحميل حالة اليومية...</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
            <h2 className="font-bold text-xl mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 text-gray-900 dark:text-gray-100">عمليات اليومية</h2>
            {dailyArchive ? (
                <div className="space-y-2">
                    <p className="text-base text-gray-600 dark:text-gray-300">
                        الحالة الحالية:
                        <span data-testid="archive-status" className="font-bold text-green-700 dark:text-green-300">
                            {` يومية ${dailyArchive.id} مفتوحة`}
                        </span>
                    </p>
                    <div className="flex pt-2">
                        <button data-testid="archive-close" onClick={onEndDay} className="flex items-center space-x-2 bg-red-700 text-white py-2 px-4 rounded-lg shadow hover:bg-red-800 transition-colors">
                            <Sunset size={20} />
                            <span className="font-semibold">إغلاق اليومية</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-base text-gray-600 dark:text-gray-300">
                        الحالة الحالية:
                        <span data-testid="archive-status" className="font-bold text-gray-700 dark:text-gray-200">
                            جميع اليوميات مغلقة
                        </span>
                    </p>
                    <div className="flex pt-2">
                        <button data-testid="archive-start" onClick={onStartDay} className="flex items-center space-x-2 bg-green-700 text-white py-2 px-4 rounded-lg shadow hover:bg-green-800 transition-colors">
                            <Sunrise size={20} />
                            <span className="font-semibold">بدء يومية جديدة</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

const AppSettingsSection = memo(({ initialAppName }: { initialAppName: string }) => {
    const [currentAppName, setCurrentAppName] = useState(initialAppName);

    // Sync with initial prop if it changes from context
    useEffect(() => {
        setCurrentAppName(initialAppName);
    }, [initialAppName]);

    const handleSave = async () => {
        if (currentAppName.trim() === '') {
            toast.error('اسم التطبيق لا يمكن أن يكون فارغاً.');
            return;
        }
        await updateAppSettings({ appName: currentAppName });
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
            <h2 className="font-bold text-xl mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 text-gray-900 dark:text-gray-100">إعدادات التطبيق</h2>
            <div className="space-y-2">
                <label htmlFor="appName" className="block text-base font-medium text-gray-700 dark:text-gray-300">اسم التطبيق</label>
                <div className="flex space-x-2 space-x-reverse">
                    <input
                        id="appName"
                        name="appName"
                        type="text"
                        value={currentAppName}
                        onChange={(e) => setCurrentAppName(e.target.value)}
                        className="flex-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm"
                    />
                    <button
                        onClick={handleSave}
                        className="py-2 px-4 bg-primary-600 text-white rounded-md shadow hover:bg-primary-700 flex items-center space-x-2"
                    >
                        <Save size={18} />
                        <span>حفظ</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

const SecuritySection = memo(() => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentPassword) {
            toast.error("يرجى إدخال كلمة المرور الحالية أولًا.");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.");
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error("كلمتا المرور غير متطابقتين.");
            return;
        }

        setIsLoading(true);
        try {
            await changePassword(currentPassword, newPassword);
            toast.success("تم تغيير كلمة المرور بنجاح.");
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (error: any) {
            toast.error(error?.message || "فشل تغيير كلمة المرور. قد تحتاج إلى تسجيل الخروج والدخول مرة أخرى.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
            <h2 className="font-bold text-xl mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 text-gray-900 dark:text-gray-100">تغيير كلمة المرور</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                    <label htmlFor="currentPassword" className="block text-base font-medium text-gray-700 dark:text-gray-300">كلمة المرور الحالية</label>
                    <input id="currentPassword" name="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md" required autoComplete="current-password" />
                </div>
                <div>
                    <label htmlFor="newPassword" className="block text-base font-medium text-gray-700 dark:text-gray-300">كلمة المرور الجديدة</label>
                    <input id="newPassword" name="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md" required autoComplete="new-password" />
                </div>
                <div>
                    <label htmlFor="confirmPassword" className="block text-base font-medium text-gray-700 dark:text-gray-300">تأكيد كلمة المرور الجديدة</label>
                    <input id="confirmPassword" name="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md" required autoComplete="new-password" />
                </div>
                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="py-2 px-4 bg-primary-600 text-white rounded-md shadow hover:bg-primary-700 flex items-center space-x-2 disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                        <span>تحديث كلمة المرور</span>
                    </button>
                </div>
            </form>
        </div>
    );
});

const DataManagementSection = memo(({
    onBackup,
    onRestore,
    onFactoryReset,
    isBusy
}: {
    onBackup: () => void;
    onRestore: () => void;
    onFactoryReset: () => void;
    isBusy: boolean;
}) => {
    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
            <h2 className="font-bold text-xl mb-4 border-b border-gray-200 dark:border-gray-700 pb-2 text-gray-900 dark:text-gray-100">إدارة البيانات</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <button
                    data-testid="backup-create"
                    onClick={onBackup}
                    disabled={isBusy}
                    className="bg-blue-100 text-blue-800 p-4 rounded-lg flex flex-col items-center justify-center space-y-2 hover:bg-blue-200 disabled:opacity-50 transition-colors"
                >
                    {isBusy ? <Loader2 size={28} className="animate-spin text-blue-800" /> : <Download size={28} />}
                    <span className="font-semibold text-lg">نسخ احتياطي</span>
                </button>
                <button
                    data-testid="restore-trigger"
                    onClick={onRestore}
                    disabled={isBusy}
                    className="bg-green-100 text-green-800 p-4 rounded-lg flex flex-col items-center justify-center space-y-2 hover:bg-green-200 disabled:opacity-50 transition-colors"
                >
                    {isBusy ? <Loader2 size={28} className="animate-spin text-green-800" /> : <Upload size={28} />}
                    <span className="font-semibold text-lg">استعادة البيانات</span>
                </button>
            </div>
            <div className="mt-6 border-t pt-4">
                <button
                    data-testid="factory-reset"
                    onClick={onFactoryReset}
                    disabled={isBusy}
                    className="w-full flex items-center justify-center space-x-2 bg-red-100 text-red-800 py-3 px-4 rounded-lg shadow-sm hover:bg-red-200 disabled:opacity-50 transition-colors"
                >
                    {isBusy ? <Loader2 size={20} className="animate-spin text-red-800" /> : <AlertTriangle size={20} />}
                    <span className="font-semibold text-base">ضبط مصنع للبيانات</span>
                </button>
            </div>
        </div>
    );
});

// --- Main Settings Page ---

export default function SettingsPage() {
    const [dailyArchive, setDailyArchive] = useState<DailyArchive | null>(null);
    const [isDailyOpsLoading, setIsDailyOpsLoading] = useState(true);
    const [isDataBusy, setIsDataBusy] = useState(false);

    const { confirm } = useConfirmation();
    const { appName } = useAppSettings();
    const navigate = useNavigate();

    const clearPosCart = usePosCartStore(state => state.clearCart);
    const clearReturnCart = useReturnCartStore(state => state.clearCart);

    // Fetch archive only once
    useEffect(() => {
        const fetchOpenArchive = async () => {
            setIsDailyOpsLoading(true);
            try {
                const archive = await getOpenDailyArchive();
                setDailyArchive(archive);
            } catch {
                toast.error("فشل في التحقق من حالة اليومية.");
            } finally {
                setIsDailyOpsLoading(false);
            }
        };
        fetchOpenArchive();
    }, []);

    const handleStartDay = useCallback(async () => {
        try {
            const archive = await startNewDailyArchive();
            setDailyArchive(archive);
            toast.success(`تم فتح يومية ${archive.id} بنجاح.`);
        } catch (error) {
            toast.error((error as Error).message);
        }
    }, []);

    const handleEndDay = useCallback(async () => {
        if (dailyArchive) {
            const confirmed = await confirm({
                title: "إغلاق اليومية",
                message: "هل أنت متأكد من رغبتك في إغلاق اليومية؟ لا يمكن التراجع عن هذا الإجراء."
            });
            if (confirmed) {
                try {
                    await closeDailyArchive(dailyArchive.id);
                    setDailyArchive(null);
                    toast.success('تم إغلاق اليومية بنجاح.');
                } catch {
                    toast.error('فشل في إغلاق اليومية.');
                }
            }
        }
    }, [dailyArchive, confirm]);

    const handleBackup = useCallback(async () => {
        const confirmed = await confirm({
            title: "إنشاء نسخة احتياطية",
            message: "سيقرأ هذا كل بيانات المحل دفعة واحدة ويستهلك حصة قراءة من خطة Firebase المجانية. لا تكرر العملية أكثر من مرة إلى مرتين يوميًا."
        });
        if (!confirmed) return;

        setIsDataBusy(true);
        toast.loading('جاري إنشاء نسخة احتياطية...');
        try {
            const data = await backupData();
            const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
                JSON.stringify(data, null, 2)
            )}`;
            const link = document.createElement("a");
            const today = new Date().toISOString().split('T')[0];
            link.href = jsonString;
            link.download = `casher-yasoo-backup-${today}.json`;
            link.click();
            toast.dismiss();
            toast.success('تم تنزيل النسخة الاحتياطية بنجاح!');
        } catch (error) {
            toast.dismiss();
            toast.error('فشل إنشاء النسخة الاحتياطية.');
            console.error(error);
        } finally {
            setIsDataBusy(false);
        }
    }, [confirm]);

    const handleRestore = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const confirmed = await confirm({
                title: "تأكيد الاستعادة",
                message: "تحذير! سيؤدي هذا إلى حذف جميع البيانات الحالية (ما عدا المستخدمين) واستبدالها بالبيانات من الملف. هل أنت متأكد؟"
            });

            if (confirmed) {
                setIsDataBusy(true);
                toast.loading('جاري استعادة البيانات...');
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const backupData = JSON.parse(event.target?.result as string) as BackupData;
                        await restoreData(backupData);

                        clearPosCart();
                        clearReturnCart();

                        toast.dismiss();
                        toast.success('تمت استعادة البيانات بنجاح!');
                        navigate('/');
                    } catch (error) {
                        toast.dismiss();
                        toast.error('فشل في استعادة البيانات. الملف غير صالح.');
                        console.error(error);
                    } finally {
                        setIsDataBusy(false);
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }, [confirm, clearPosCart, clearReturnCart, navigate]);

    const handleFactoryReset = useCallback(async () => {
        const confirmed = await confirm({
            title: "تأكيد ضبط المصنع",
            message: "تحذير! سيؤدي هذا إلى حذف جميع بيانات المعاملات (الفواتير، المنتجات، الخ) بشكل نهائي وإعادة ترقيم الفواتير من 1، ولكن سيتم الحفاظ على حساب المستخدم. هل أنت متأكد؟"
        });
        if (confirmed) {
            setIsDataBusy(true);
            toast.loading('جاري حذف جميع البيانات...');
            try {
                await factoryReset();
                clearPosCart();
                clearReturnCart();
                toast.dismiss();
                toast.success('تم حذف جميع البيانات بنجاح.');
                navigate('/');
            } catch (error) {
                toast.dismiss();
                toast.error('فشل ضبط المصنع.');
                console.error(error);
            } finally {
                setIsDataBusy(false);
            }
        }
    }, [confirm, clearPosCart, clearReturnCart, navigate]);

    return (
        <div className="p-4 lg:p-6 space-y-8">
            <h1 className="text-2xl sm:text-3xl font-bold">الإعدادات</h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 lg:space-y-0 space-y-8">
                <div className="space-y-8">
                    <DailyOpsSection
                        dailyArchive={dailyArchive}
                        isLoading={isDailyOpsLoading}
                        onStartDay={handleStartDay}
                        onEndDay={handleEndDay}
                    />
                    <SecuritySection />
                </div>
                <div className="space-y-8">
                    <AppSettingsSection initialAppName={appName} />
                    <DataManagementSection
                        onBackup={handleBackup}
                        onRestore={handleRestore}
                        onFactoryReset={handleFactoryReset}
                        isBusy={isDataBusy}
                    />
                </div>
            </div>
        </div>
    );
}
