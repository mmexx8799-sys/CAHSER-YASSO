// REQ-BARCODE: مودال مسح الباركود بالكاميرا.
// يستهلك useBarcodeScanner ويُرجع النتيجة لـPOSPage عبر callback واحد (onDetected).

import React, { useState } from 'react';
import { X, Camera, RotateCcw, CheckCircle } from 'lucide-react';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

interface BarcodeCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

export const BarcodeCameraModal: React.FC<BarcodeCameraModalProps> = ({
  isOpen,
  onClose,
  onDetected,
}) => {
  const [lastCode, setLastCode] = useState<string | null>(null);

  const { videoRef, error, isScanning, retry } = useBarcodeScanner({
    active: isOpen,
    onDetected: (code) => {
      setLastCode(code);
      onDetected(code);
    },
  });

  if (!isOpen) return null;

  const errorMessage =
    error === 'permission'
      ? 'تم رفض صلاحية الكاميرا. اسمح بالوصول من إعدادات المتصفح ثم حاول مرة أخرى.'
      : error === 'nodriver'
        ? 'لا توجد كاميرا متاحة على هذا الجهاز. استخدم قارئ USB أو الإدخال اليدوي.'
        : error === 'generic'
          ? 'تعذّر تشغيل الكاميرا. حاول مرة أخرى.'
          : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Camera size={22} />
            مسح باركود
          </h2>
          <button
            onClick={onClose}
            aria-label="إغلاق المسح"
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        {errorMessage ? (
          <div className="text-center py-8 space-y-4">
            <p className="text-lg text-red-700 dark:text-red-300 font-semibold">{errorMessage}</p>
            <button
              onClick={retry}
              className="inline-flex items-center gap-2 py-2 px-5 bg-primary-600 text-white rounded-md font-semibold text-lg hover:bg-primary-700"
            >
              <RotateCcw size={18} />
              حاول مرة أخرى
            </button>
          </div>
        ) : (
          <>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
                aria-label="معاينة الكاميرا لمسح الباركود"
              />
              {!isScanning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
                </div>
              )}
              {/* إطار التوجيه */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-1/3 border-2 border-dashed border-green-400 rounded-lg opacity-80"></div>
              </div>
            </div>
            {lastCode && (
              <p className="mt-3 flex items-center gap-2 text-base text-green-700 dark:text-green-300 font-semibold">
                <CheckCircle size={18} />
                آخر مسح: <span dir="ltr">{lastCode}</span>
              </p>
            )}
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              وجّه الكاميرا نحو باركود المنتج — يُضاف للسلة تلقائيًا.
            </p>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md font-semibold text-lg hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          تم
        </button>
      </div>
    </div>
  );
};
