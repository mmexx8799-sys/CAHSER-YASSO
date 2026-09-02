import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { usePosCartStore } from '../stores/posCartStore';

export const FloatingCartButton: React.FC = () => {
    const { cart, subtotal, setCartModalOpen } = usePosCartStore();

    if (cart.length === 0) return null;

    return (
        <button
            onClick={() => setCartModalOpen(true)}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 w-11/12 max-w-md h-16 bg-primary-600 dark:bg-primary-700 text-white rounded-full shadow-lg flex justify-between items-center px-6 z-40 hover:bg-primary-700 dark:hover:bg-primary-600 transition-transform transform hover:scale-105"
        >
            <div className="flex items-center space-x-2 space-x-reverse">
                <ShoppingCart />
                <span className="bg-white text-primary-600 dark:text-primary-700 rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">{cart.length}</span>
            </div>
            <span className="font-bold text-lg">عرض السلة</span>
            <span className="font-extrabold text-xl">{subtotal.toFixed(2)} ج.م</span>
        </button>
    );
};
