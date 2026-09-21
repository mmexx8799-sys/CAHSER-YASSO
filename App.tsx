import React, { Suspense, useMemo, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, Package, Users, BarChart2, Settings, Archive, Undo2, LogOut, Moon, Sun, Truck, LayoutDashboard } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { App as CapacitorApp } from '@capacitor/app';

import { signOut } from './services/auth';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineNotifier from './components/OfflineNotifier';
import { ConfirmationProvider } from './components/ConfirmationProvider';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppSettingsProvider, useAppSettings } from './contexts/AppSettingsContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { usePosCartStore } from './stores/posCartStore';
import { useReturnCartStore } from './stores/returnCartStore';
import { usePermissions } from './hooks/usePermissions';
import type { Capability } from './utils/permissions';
import { buildNavItems, resolveLanding } from './utils/nav';

// Lazy load pages
const POSPage = React.lazy(() => import('./pages/POSPage'));
const ProductsPage = React.lazy(() => import('./pages/ProductsPage'));
const CustomersPage = React.lazy(() => import('./pages/CustomersPage'));
const CustomerAccountPage = React.lazy(() => import('./pages/CustomerAccountPage'));
const SuppliersPage = React.lazy(() => import('./pages/SuppliersPage'));
const SupplierAccountPage = React.lazy(() => import('./pages/SupplierAccountPage'));
const ReportsPage = React.lazy(() => import('./pages/ReportsPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const ArchivePage = React.lazy(() => import('./pages/ArchivePage'));
const ReturnsPage = React.lazy(() => import('./pages/ReturnsPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const UsersPage = React.lazy(() => import('./pages/UsersPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));

const Header = React.memo(() => {
    const { currentUser } = useAuth();
    const { appName } = useAppSettings();
    const { theme, toggleTheme } = useTheme();

    const handleSignOut = async () => {
        await signOut();
        toast.success("تم تسجيل الخروج بنجاح.");
    };

    return (
        <header className="fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 shadow-md z-50 px-4 pt-[env(safe-area-inset-top)] border-b border-gray-100 dark:border-gray-700 transition-colors duration-200">
            <div className="h-16 flex items-center justify-between gap-3 max-w-screen-2xl mx-auto">
                <h1 className="flex-1 min-w-0 text-lg sm:text-xl font-bold text-primary-700 dark:text-primary-300 truncate leading-tight">{appName}</h1>
                <div className="flex shrink-0 items-center gap-1 sm:gap-2 text-sm">
                    <button onClick={toggleTheme} aria-label="تبديل الوضع الليلي" className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                    <span className="text-gray-700 dark:text-gray-200 hidden md:block truncate max-w-[12rem] lg:max-w-xs" dir="ltr">{currentUser?.email}</span>
                    <button onClick={handleSignOut} aria-label="تسجيل الخروج" className="flex shrink-0 items-center gap-1.5 text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <LogOut size={18} />
                        <span className="font-semibold">خروج</span>
                    </button>
                </div>
            </div>
        </header>
    );
});

// Shared nav items source — consumed by BOTH BottomNav (mobile) and Sidebar (lg+). No data duplication.
const useNavItems = () => {
    const { currentUser } = useAuth();
    return useMemo(() => {
        return buildNavItems((currentUser as any)?.role as any, { grants: (currentUser as any)?.capGrants, denies: (currentUser as any)?.capDenies } as any, { disabled: currentUser?.disabled === true }).map(it => {
            const iconMap: any = { '/': ShoppingCart, '/customers': Users, '/suppliers': Truck, '/returns': Undo2, '/products': Package, '/reports': BarChart2, '/archive': Archive, '/dashboard': LayoutDashboard, '/settings': Settings, '/users': Users };
            return { to: it.to, icon: iconMap[it.to], label: it.label };
        });
    }, [currentUser]);
};

const BottomNav = React.memo(() => {
    const navItems = useNavItems();

    return (
        <nav className="fixed bottom-0 left-0 right-0 lg:hidden bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-40 pb-[env(safe-area-inset-bottom)] transition-colors duration-200">
            <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
                {navItems.map(item => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center space-y-1 w-full transition-colors duration-200 ${isActive ? 'text-primary-600 dark:text-primary-300 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-primary-500 dark:hover:text-primary-300'
                            }`
                        }
                    >
                        <item.icon className="w-7 h-7" strokeWidth={2} />
                        <span className="text-[10px] font-medium">{item.label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
});

const Sidebar = React.memo(() => {
    const navItems = useNavItems();
    return (
        <nav aria-label="التنقل الرئيسي" className="hidden lg:flex fixed top-[calc(4rem+env(safe-area-inset-top))] bottom-0 right-0 w-64 flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-lg z-40 overflow-y-auto transition-colors duration-200">
            <div className="flex flex-col gap-1 p-3">
                {navItems.map(item => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 ${isActive
                                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300 font-bold'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-primary-500 dark:hover:text-primary-300'
                            }`
                        }
                    >
                        <item.icon className="w-6 h-6 shrink-0" strokeWidth={2} />
                        <span className="font-medium">{item.label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
});

const PageLoader: React.FC = () => (
    <div className="flex justify-center items-center h-full bg-gray-100 min-h-[50vh]">
        <div className="critical-loader"></div>
    </div>
);

const RequireCapability: React.FC<{ capability: Capability; children: React.ReactNode }> = ({ capability, children }) => {
    const { can: canCap, role } = usePermissions() as any;
    const { currentUser } = useAuth() as any;
    const navigate = useNavigate();
    const location = useLocation();
    useEffect(() => {
        if (!canCap(capability)) {
            const landing = resolveLanding(role, { grants: (currentUser as any)?.capGrants, denies: (currentUser as any)?.capDenies } as any, { disabled: currentUser?.disabled === true });
            if (location.pathname !== landing) {
                const silent = location.pathname === '/' || location.pathname === '/returns';
                if (!silent) toast.error("ليس لديك صلاحية الوصول لهذه الصفحة.", { id: 'no-permission' });
                navigate(landing, { replace: true });
            }
        }
    }, [canCap, capability, navigate, location.pathname, role, currentUser]);
    if (!canCap(capability)) return null;
    return <>{children}</>;
};

const AppLayout = React.memo(() => {
    return (
        <div className="flex flex-col h-screen font-sans bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200">
            <Header />
            <main className="flex-1 overflow-y-auto pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-6 lg:pr-64">
                <div className="max-w-screen-2xl w-full mx-auto">
                <Suspense fallback={<PageLoader />}>
                    <Outlet />
                </Suspense>
                </div>
            </main>
            <BottomNav />
            <Sidebar />
        </div>
    );
});

const AndroidBackHandler = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isCartModalOpen: isPosCartOpen, setCartModalOpen: setPosCartOpen } = usePosCartStore();
    const { isCartModalOpen: isReturnCartOpen, setCartModalOpen: setReturnCartOpen } = useReturnCartStore();

    useEffect(() => {
        const handleBackButton = async () => {
            if (isPosCartOpen) {
                setPosCartOpen(false);
                return;
            }
            if (isReturnCartOpen) {
                setReturnCartOpen(false);
                return;
            }
            if (location.pathname === '/' || location.pathname === '/login') {
                CapacitorApp.exitApp();
            } else {
                navigate(-1);
            }
        };
        const listener = CapacitorApp.addListener('backButton', handleBackButton);
        return () => {
            listener.then(handler => handler.remove());
        };
    }, [navigate, location, isPosCartOpen, setPosCartOpen, isReturnCartOpen, setReturnCartOpen]);

    return null;
};

const LandingRedirect: React.FC = () => {
    const { role } = usePermissions() as any;
    const { currentUser } = useAuth() as any;
    const to = resolveLanding(role, { grants: (currentUser as any)?.capGrants, denies: (currentUser as any)?.capDenies } as any, { disabled: currentUser?.disabled === true });
    return <Navigate to={to} replace />;
};

const AppRoutes: React.FC = () => {
    const { currentUser, isLoading, isUnresolved, retry } = useAuth() as any;

    const disabledToastShownForUid = useRef<string | null>(null);
    useEffect(() => {
        if (currentUser?.disabled === true && disabledToastShownForUid.current !== currentUser.uid) {
            disabledToastShownForUid.current = currentUser.uid;
            signOut();
            toast.error("تم تعطيل حسابك. يرجى التواصل مع المدير.");
        }
    }, [currentUser]);

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen bg-gray-100"><PageLoader /></div>;
    }

    if (isUnresolved) {
        return <div className="flex flex-col justify-center items-center h-screen bg-gray-100 p-8 text-center"><p className="text-lg">تعذّر تحميل الصلاحيات — أعد المحاولة</p><button onClick={retry} className="mt-4 px-4 py-2 bg-primary-600 text-white rounded">أعد المحاولة</button></div>;
    }

    if (!currentUser) {
        return (
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </Suspense>
        );
    }

    if (currentUser?.disabled === true) {
        return (
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </Suspense>
        );
    }

    return (
        <>
            <AndroidBackHandler />
            <Routes>
                <Route element={<AppLayout />}>
                    <Route path="/" element={<RequireCapability capability="sell"><POSPage /></RequireCapability>} />
                    <Route path="/customers" element={<CustomersPage />} />
                    <Route path="/customers/:id" element={<CustomerAccountPage />} />
                    <Route path="/suppliers" element={<SuppliersPage />} />
                    <Route path="/suppliers/:id" element={<SupplierAccountPage />} />
                    <Route path="/returns" element={<RequireCapability capability="return"><ReturnsPage /></RequireCapability>} />
                    <Route path="/dashboard" element={<RequireCapability capability="dashboard.view"><DashboardPage /></RequireCapability>} />
                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/reports" element={<RequireCapability capability="report.view"><ReportsPage /></RequireCapability>} />
                    <Route path="/archive" element={<RequireCapability capability="archive.view"><ArchivePage /></RequireCapability>} />
                    <Route path="/settings" element={<RequireCapability capability="settings.write"><SettingsPage /></RequireCapability>} />
                    <Route path="/users" element={<RequireCapability capability="users.manage"><UsersPage /></RequireCapability>} />
                </Route>
                <Route path="*" element={<LandingRedirect />} />
            </Routes>
        </>
    );
};

export default function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <AppSettingsProvider>
                    <ThemeProvider>
                        <ConfirmationProvider>
                            <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                                <Toaster
                                    position="top-center"
                                    reverseOrder={false}
                                    toastOptions={{
                                        className: 'font-sans text-lg',
                                        duration: 3000,
                                    }}
                                />
                                <AppRoutes />
                                <OfflineNotifier />
                            </HashRouter>
                        </ConfirmationProvider>
                    </ThemeProvider>
                </AppSettingsProvider>
            </AuthProvider>
        </ErrorBoundary>
    );
}
