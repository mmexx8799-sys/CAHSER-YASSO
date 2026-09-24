// OFFLINE-P1 REQ-OFF1-4 — تسجيل الانقطاعات 14 يومًا (D-O5/D-O6 — محلي + clientErrors)
// لا setInterval دائم — حدثي فقط (online/offline) — idb-keyval (IndexedDB)

import { get, set } from 'idb-keyval';
import { reportError } from './monitoring';
import { getAuthInstance } from './firebase';

const STORE_KEY = 'offline-p1-log';
const MAX_ENTRIES = 200;
const WINDOW_14D_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 3000; // رفة <3s تُسجل خام لكن لا تُحسب ولا تُبعت

export interface OfflineEntry {
  start: number; // Date.now() عند offline
  end?: number; // Date.now() عند online
  durationMs?: number;
  uid?: string;
}

async function load(): Promise<OfflineEntry[]> {
  try {
    const v = await get(STORE_KEY);
    return Array.isArray(v) ? (v as OfflineEntry[]) : [];
  } catch {
    return [];
  }
}

async function save(entries: OfflineEntry[]): Promise<void> {
  try {
    const trimmed = entries.slice(-MAX_ENTRIES);
    await set(STORE_KEY, trimmed);
  } catch {
    // IndexedDB غير متاح (تصفح خاص) — لا يمنع البيع، يُسجل في clientErrors فقط
  }
}

export async function logOfflineStart(): Promise<void> {
  const entries = await load();
  const last = entries[entries.length - 1];
  // لا تسجل start جديد إن كان الأخير مفتوحًا بالفعل (flapping)
  if (last && last.end === undefined) return;
  const entry: OfflineEntry = {
    start: Date.now(),
    uid: getAuthInstance()?.currentUser?.uid,
  };
  entries.push(entry);
  await save(entries);
}

export async function logOfflineEnd(): Promise<void> {
  const entries = await load();
  const last = entries[entries.length - 1];
  if (!last || last.end !== undefined) return;
  last.end = Date.now();
  last.durationMs = last.end - last.start;
  last.uid = last.uid || getAuthInstance()?.currentUser?.uid;
  await save(entries);
  // رفة <3s تُسجل خام في IndexedDB فقط — لا تُبعت ولا تُحسب (تقلل ضجيج clientErrors)
  if (last.durationMs !== undefined && last.durationMs < MIN_DURATION_MS) return;
  // سجل في clientErrors أيضًا (D-O5: محلي + سحابي) — fire-and-forget
  try {
    reportError(new Error(`offline ${last.durationMs}ms`), {
      source: 'offline-p1',
      extra: {
        start: String(last.start),
        end: String(last.end),
        durationMs: String(last.durationMs),
      },
    });
  } catch {
    // لا حلقة
  }
}

export interface OfflineStats {
  count: number; // عدد الانقطاعات المكتملة (لها duration)
  totalMs: number;
  avgMs: number;
  maxMs: number;
  byDay: Record<string, number>; // YYYY-MM-DD → count
}

export async function getOfflineStats(): Promise<OfflineStats> {
  const entries = await load();
  const now = Date.now();
  const windowStart = now - WINDOW_14D_MS;
  // فلترة 14 يوم + إهمال الرفات <3s (تُحسب فقط الانقطاعات الحقيقية)
  const done = entries.filter(
    (e) => typeof e.durationMs === 'number' && typeof e.end === 'number' && e.start >= windowStart && (e.durationMs as number) >= MIN_DURATION_MS,
  );
  const count = done.length;
  const totalMs = done.reduce((s, e) => s + (e.durationMs || 0), 0);
  const avgMs = count ? Math.round(totalMs / count) : 0;
  const maxMs = done.reduce((m, e) => Math.max(m, e.durationMs || 0), 0);
  const byDay: Record<string, number> = {};
  for (const e of done) {
    const day = new Date(e.start).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  return { count, totalMs, avgMs, maxMs, byDay };
}

/** نفس الإحصائيات لكن لنافذة 14 يوم صراحةً — للتوافق مع الخطة */
export async function getOfflineStatsLast14Days(): Promise<OfflineStats> {
  return getOfflineStats();
}

export async function getOfflineLog(): Promise<OfflineEntry[]> {
  return load();
}

export async function clearOfflineLog(): Promise<void> {
  await save([]);
}
