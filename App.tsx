
import React, { Suspense, useMemo, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, Package, Users, BarChart2, Settings, Archive, Undo2, LogOut, Moon, Sun } from 'lucide-react';
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
import { UserRole } from './types';

// Lazy load pages
const POSPage = React.lazy(() => import('./pages/POSPage'));
const ProductsPage = React.lazy(() => import('./pages/ProductsPage'));
const CustomersPage = React.lazy(() => import('./pages/CustomersPage'));
const CustomerAccountPage = React.lazy(() => import('./pages/CustomerAccountPage'));
const ReportsPage = React.lazy(() => import('./pages/ReportsPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const ArchivePage = React.lazy(() => import('./pages/ArchivePage'));
const ReturnsPage = React.lazy(() => import('./pages/ReturnsPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const UsersPage = React.lazy(() => import('./pages/UsersPage'));

const NavItem: React.FC<{ to: string; icon: React.ElementType; label: string }> = React.memo(({ to, icon: Icon, label }) => (
    <NavLink
        to={to}
        className={({ isActive }) =>
            `flex flex-col items-center justify-center space-y-1 w-full text-xs transition-colors duration-200 ${isActive ? 'text-primary-600 font-bold' : 'text-gray-500 hover:text-primary-500'
            }`
        }
    >
        <Icon className="w-6 h-6" />
        <span>{label}</span>
    </NavLink>
));

const Header = React.memo(() => {
    const { currentUser } = useAuth();
    const { appName } = useAppSettings();
    const { theme, toggleTheme } = useTheme();

    const handleSignOut = async () => {
        await signOut();
        toast.success("تم تسجيل الخروج بنجاح.");
    };

    return (
        <header className="fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 shadow-md z-50 px-4 pt-[env(safe-area-inset-top)] transition-colors duration-200">
            <div className="h-16 flex items-center justify-between">
                <h1 className="text-xl font-bold text-primary-700 dark:text-primary-300">{appName}</h1>
                <div className="flex items-center space-x-2 space-x-reverse text-sm">
                    <button onClick={toggleTheme} aria-label="تبديل الوضع الليلي" className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                    <span className="text-gray-700 dark:text-gray-200 hidden sm:block truncate max-w-xs">{currentUser?.email}</span>
                    <button onClick={handleSignOut} aria-label="تسجيل الخروج" className="flex items-center space-x-1 text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <LogOut size={18} />
                        <span className="font-semibold">خروج</span>
                    </button>
                </div>
            </div>
        </header>
    );
});

const BottomNav = React.memo(() => {
    const { currentUser } = useAuth();
    const isAdmin = currentUser?.role === UserRole.Admin && currentUser?.disabled !== true;
    const navItems = useMemo(() => {
        const items = [
            { to: "/", icon: ShoppingCart, label: "نقطة البيع" },
            { to: "/customers", icon: Users, label: "العملاء" },
            { to: "/returns", icon: Undo2, label: "المرتجعات" },
            { to: "/products", icon: Package, label: "المنتجات" },
            { to: "/reports", icon: BarChart2, label: "التقارير" },
            { to: "/archive", icon: Archive, label: "الأرشيف" },
        ];
        if (isAdmin) {
            items.push({ to: "/settings", icon: Settings, label: "الإعدادات" });
            items.push({ to: "/users", icon: Users, label: "المستخدمين" });
        }
        return items;
    }, [isAdmin]);

    // CHANGED: Added pb-[env(safe-area-inset-bottom)] for modern phones
    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-40 pb-[env(safe-area-inset-bottom)] transition-colors duration-200">
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

const PageLoader: React.FC = () => (
    <div className="flex justify-center items-center h-full bg-gray-100 min-h-[50vh]">
        <div className="critical-loader"></div>
    </div>
);

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!currentUser || currentUser.role !== UserRole.Admin || currentUser.disabled === true) {
            toast.error("ليس لديك صلاحية الوصول لهذه الصفحة.");
            navigate("/", { replace: true });
        }
    }, [currentUser, navigate, location.pathname]);

    if (!currentUser || currentUser.role !== UserRole.Admin || currentUser.disabled === true) {
        return null;
    }
    return <>{children}</>;
};

const AppLayout = React.memo(() => {
    return (
        <div className="flex flex-col h-screen font-sans bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200">
            <Header />
            {/* CHANGED: Padding Top accounts for 4rem header + safe area */}
            <main className="flex-1 overflow-y-auto pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]">
                <Suspense fallback={<PageLoader />}>
                    <Outlet />
                </Suspense>
            </main>
            <BottomNav />
        </div>
    );
});

const AndroidBackHandler = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isCartModalOpen: isPosCartOpen, setCartModalOpen: setPosCartOpen } = usePosCartStore();
    const { isCartModalOpen: isReturnCartOpen, setCartModalOpen: setReturnCartOpen } = useReturnCartStore();

    useEffect(() => {
        const handleBackButton = async (event: any) => {
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

const AppRoutes: React.FC = () => {
    const { currentUser, isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex justify-center items-center h-screen bg-gray-100"><PageLoader /></div>;
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

    if (currentUser.disabled === true) {
        signOut();
        toast.error("تم تعطيل حسابك. يرجى التواصل مع المدير.");
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
                    <Route path="/" element={<POSPage />} />
                    <Route path="/customers" element={<CustomersPage />} />
                    <Route path="/customers/:id" element={<CustomerAccountPage />} />
                    <Route path="/returns" element={<ReturnsPage />} />
                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/archive" element={<ArchivePage />} />
                    <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
                    <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
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
