import React, { useState, createContext, useContext, useCallback, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

// --- Confirmation Modal System ---
interface ConfirmationOptions {
    title: string;
    message: string;
}

interface ConfirmationContextType {
    confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

const ConfirmModal: React.FC<{
    isOpen: boolean;
    options: ConfirmationOptions;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ isOpen, options, onConfirm, onCancel }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[100] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm">
                <div className="flex items-start mb-4">
                    <AlertCircle className="text-red-500 dark:text-red-400 mr-3 mt-1 flex-shrink-0" size={24} />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{options.title}</h2>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">{options.message}</p>
                <div className="flex justify-end space-x-2 space-x-reverse">
                    <button data-testid="confirm-cancel" onClick={onCancel} className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">
                        إلغاء
                    </button>
                    <button data-testid="confirm-accept" onClick={onConfirm} className="py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold">
                        تأكيد
                    </button>
                </div>
            </div>
        </div>
    );
};

export const ConfirmationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [options, setOptions] = useState<ConfirmationOptions | null>(null);
    const [resolve, setResolve] = useState<((value: boolean) => void) | null>(null);

    const confirm = useCallback((options: ConfirmationOptions) => {
        return new Promise<boolean>((resolve) => {
            setOptions(options);
            setResolve(() => resolve);
        });
    }, []);

    const handleConfirm = () => {
        if (resolve) {
            resolve(true);
            setOptions(null);
        }
    };

    const handleCancel = () => {
        if (resolve) {
            resolve(false);
            setOptions(null);
        }
    };

    return (
        <ConfirmationContext.Provider value={{ confirm }}>
            {children}
            {options && <ConfirmModal isOpen={!!options} options={options} onConfirm={handleConfirm} onCancel={handleCancel} />}
        </ConfirmationContext.Provider>
    );
};

export const useConfirmation = () => {
    const context = useContext(ConfirmationContext);
    if (!context) {
        throw new Error('useConfirmation must be used within a ConfirmationProvider');
    }
    return context;
};
