
import React, { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeToCollection } from '../services/dataCache';
import type { DailyArchive } from '../types';
import { ArrowLeft } from 'lucide-react';
import { Timestamp, orderBy } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';

const ArchiveCard: React.FC<{ archive: DailyArchive; onViewDetails: (id: string) => void; }> = ({ archive, onViewDetails }) => {
  const totalSales = archive.totalSales || 0;
  const totalReturns = archive.totalReturns || 0;
  const netCashInDrawer = (archive.totalCash || 0) - totalReturns;
  const isOpen = archive.status === 'open';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border-l-4 ${isOpen ? 'border-green-500' : 'border-red-500'}`}>
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-gray-800 dark:text-gray-100">{archive.id}</h2>
          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isOpen ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'}`}>
            {isOpen ? 'مفتوح' : 'مغلق'}
          </span>
        </div>

        <div className="text-center my-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">صافي النقدية بالدرج</p>
          <p className="text-3xl font-extrabold text-blue-700 dark:text-blue-300 my-1">{netCashInDrawer.toFixed(2)} ج.م</p>
        </div>

        <div className="flex justify-around text-center text-sm border-t border-gray-200 dark:border-gray-700 pt-3">
          <div>
            <p className="text-gray-600 dark:text-gray-300">إجمالي المبيعات</p>
            <p className="font-bold text-green-700 dark:text-green-300">{totalSales.toFixed(2)} ج.م</p>
          </div>
          <div>
            <p className="text-gray-600 dark:text-gray-300">إجمالي المرتجعات</p>
            <p className="font-bold text-red-700 dark:text-red-300">{totalReturns.toFixed(2)} ج.م</p>
          </div>
        </div>

        <button
          onClick={() => onViewDetails(archive.id)}
          className="mt-4 w-full flex items-center justify-center space-x-2 space-x-reverse py-2 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          <span>عرض التفاصيل</span>
          <ArrowLeft size={16} />
        </button>
      </div>
    </div>
  );
};
const MemoizedArchiveCard = memo(ArchiveCard);

export default function ArchivePage() {
  const [archives, setArchives] = useState<DailyArchive[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setIsLoading(true);
    const constraints: QueryConstraint[] = [orderBy('startTime', 'desc')];
    const unsubscribe = subscribeToCollection<Omit<DailyArchive, 'startTime' | 'endTime'> & { startTime: Timestamp, endTime?: Timestamp }>('dailyArchives', (archivesData) => {
      const mappedData = archivesData.map(a => ({
        ...a,
        startTime: a.startTime instanceof Timestamp ? a.startTime.toMillis() : Date.now(),
        endTime: a.endTime instanceof Timestamp ? a.endTime.toMillis() : a.endTime
      }));
      setArchives(mappedData);
      setIsLoading(false);
    }, constraints);

    return () => unsubscribe();
  }, []);

  const handleViewDetails = useCallback((archiveId: string) => {
    navigate('/reports', { state: { selectedDate: archiveId } });
  }, [navigate]);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4">الأرشيف اليومي</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-full pt-10">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
          </div>
        ) : archives.length === 0 ? (
          <p className="text-center text-gray-600 dark:text-gray-300 mt-8">لا يوجد أرشيف لعرضه.</p>
        ) : (
          archives.map(archive => (
            <MemoizedArchiveCard key={archive.id} archive={archive} onViewDetails={handleViewDetails} />
          ))
        )}
      </div>
    </div>
  );
}
