// components/OpKeySettleDialog.tsx — REQ-UI-0 (AUDIT-TX-3 UI layer): small
// custom settle dialog with NAMED buttons. The safe action (finish without
// writing / review) is the default: primary-styled + autofocused, Enter
// confirms it, Esc/X dismisses to the safe outcome. Resolves exactly once.
//
// NOTE: not covered by automated tests (vitest runs `environment: 'node'`
// with no DOM) — verified by manual QA per REQ-UI-1..5.
import React, { useEffect, useRef } from 'react';

export type SettleDialogChoice = 'primary' | 'secondary' | 'dismissed';

export interface OpKeySettleDialogProps {
    title: string;
    message: string;
    primaryLabel: string;
    secondaryLabel: string;
    onResolve: (choice: SettleDialogChoice) => void;
}

export const OpKeySettleDialog: React.FC<OpKeySettleDialogProps> = ({
    title,
    message,
    primaryLabel,
    secondaryLabel,
    onResolve,
}) => {
    const primaryRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        primaryRef.current?.focus();
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onResolve('dismissed');
            else if (e.key === 'Enter') onResolve('primary');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onResolve]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[200] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm">
                <div className="flex items-start justify-between mb-4">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
                    <button
                        data-testid="opkey-settle-close"
                        aria-label="إغلاق"
                        onClick={() => onResolve('dismissed')}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-bold text-xl leading-none"
                    >
                        ×
                    </button>
                </div>
                <p className="text-gray-600 dark:text-gray-300 mb-6 text-lg">{message}</p>
                <div className="flex justify-end space-x-2 space-x-reverse">
                    <button
                        data-testid="opkey-settle-secondary"
                        onClick={() => onResolve('secondary')}
                        className="py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold"
                    >
                        {secondaryLabel}
                    </button>
                    <button
                        ref={primaryRef}
                        data-testid="opkey-settle-primary"
                        onClick={() => onResolve('primary')}
                        className="py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 font-semibold"
                    >
                        {primaryLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
