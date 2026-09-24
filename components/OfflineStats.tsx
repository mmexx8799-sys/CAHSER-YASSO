import React, { useEffect, useState } from 'react';
import { getOfflineStats, getOfflineLog, clearOfflineLog, OfflineStats } from '../services/offlineLog';

const OfflineStatsCard: React.FC = () => {
  const [stats, setStats] = useState<OfflineStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const s = await getOfflineStats();
      setStats(s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleExport = async () => {
    const log = await getOfflineLog();
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offline-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (!confirm('هل أنت متأكد من مسح سجل الانقطاعات؟')) return;
    await clearOfflineLog();
    await load();
  };

  if (loading) {
    return <div className="text-sm text-gray-500">جاري تحميل الإحصائيات...</div>;
  }
  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">حالة الاتصال — آخر 14 يومًا</h3>
        <button onClick={load} className="text-sm text-primary-600 hover:underline">
          تحديث
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="text-gray-500 dark:text-gray-400">عدد الانقطاعات</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.count}</div>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="text-gray-500 dark:text-gray-400">متوسط المدة</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.avgMs ? `${(stats.avgMs / 1000).toFixed(1)}s` : '—'}</div>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="text-gray-500 dark:text-gray-400">أقصى مدة</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.maxMs ? `${(stats.maxMs / 1000).toFixed(1)}s` : '—'}</div>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div className="text-gray-500 dark:text-gray-400">إجمالي المدة</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.totalMs ? `${(stats.totalMs / 1000).toFixed(1)}s` : '—'}</div>
        </div>
      </div>
      {Object.keys(stats.byDay).length > 0 && (
        <div className="text-sm">
          <div className="font-semibold mb-1 text-gray-700 dark:text-gray-300">حسب اليوم:</div>
          <ul className="space-y-1">
            {Object.entries(stats.byDay)
              .sort(([a], [b]) => (a < b ? 1 : -1))
              .slice(0, 7)
              .map(([day, c]) => (
                <li key={day} className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{day}</span>
                  <span>{c}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={handleExport} className="flex-1 py-2 px-3 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">
          تصدير السجل (JSON)
        </button>
        <button onClick={handleClear} className="py-2 px-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-sm">
          مسح
        </button>
      </div>
      <p className="text-xs text-gray-400">يُسجل تلقائيًا عند كل انقطاع/عودة — للقرار بعد 14 يومًا (count ≥ 5 أو avg ≥ 2min → P2 مجدية).</p>
    </div>
  );
};

export default OfflineStatsCard;
