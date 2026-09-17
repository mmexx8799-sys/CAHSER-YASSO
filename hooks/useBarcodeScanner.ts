// REQ-BARCODE: ماسح الباركود بالكاميرا.
// getUserMedia + requestVideoFrameCallback + detector.detect + حارسا cooldown/leave.
// المحرك محلي (zxing wasm من public/) — لا طلب شبكي بعد أول تحميل (AC-10).
//
// درس 2026-09-18 (عطل "فيديو حي بلا رصد"): نسخ الـwasm إلى public/ وحده لا
// يكفي — barcode-detector يجلب الـwasm افتراضيًا من jsDelivr CDN (موثق في
// zxing-wasm/share.d.ts)، وهذا الجلب محجوب على الإنتاج بواسطة CSP
// (connect-src بلا jsdelivr) ويخرق AC-10 أصلًا. الإصلاح: prepareZXingModule
// يوجّه locateFile للملف المحلي قبل أول detect().

import { useEffect, useRef, useState, useCallback } from 'react';

/** مسار محرك المسح المحلي (public/zxing_reader.wasm يُقدَّم من جذر الموقع). */
export const LOCAL_ZXING_WASM_URL = '/zxing_reader.wasm';

/**
 * دالة locateFile للمحرك — خالصة وقابلة للاختبار: ملف الـwasm يُحل محليًا،
 * وأي مسار آخر يُترك كما هو (سلوك emscripten الافتراضي).
 */
export const resolveZxingWasmUrl = (path: string): string =>
  path.endsWith('.wasm') ? LOCAL_ZXING_WASM_URL : path;

// مطابقة المشروع المرجعي العامل (G:\Marketappfinal — نفس barcode-detector@3.2.2):
// تهيئة مرة واحدة عبر prepareZXingModule قبل أول detect(). idempotent.
let zxingWasmConfigured = false;

const configureLocalZXingWasm = (
  prepareZXingModule: (options: { overrides: { locateFile: (path: string) => string } }) => unknown,
): void => {
  if (zxingWasmConfigured) return;
  zxingWasmConfigured = true;
  prepareZXingModule({ overrides: { locateFile: resolveZxingWasmUrl } });
};

// مطابقة المرجع: نفس قائمة الصيغ حرفيًا (بلا qr_code).
const SCAN_FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * حارس منع التكرار (AC-04): نفس الباركود في نفس الإطار لا يُمرَّر أكثر من
 * مرة إلا بعد خروجه من مجال الكاميرا (leave) + انقضاء cooldown.
 * دالة خالصة قابلة للاختبار بمعزل عن الكاميرا.
 */
export class BarcodeDeduper {
  private lastCode: string | null = null;
  private lastEmitAt = 0;
  private lastSeenAt = 0;

  constructor(
    private readonly cooldownMs: number = 1500,
    private readonly leaveMs: number = 1000,
  ) {}

  /** يُرجع true إذا كان يجب تمرير هذا الرصد للمتصل. */
  shouldEmit(code: string, now: number = Date.now()): boolean {
    const normalized = (code ?? '').trim();
    if (!normalized) return false;
    if (normalized !== this.lastCode) {
      this.lastCode = normalized;
      this.lastEmitAt = now;
      this.lastSeenAt = now;
      return true;
    }
    // نفس الكود ما زال في الإطار
    this.lastSeenAt = now;
    if (now - this.lastEmitAt < this.cooldownMs) return false;
    // انقضى الـcooldown لكن الكود لم يغادر الإطار → كبح مستمر.
    // leave يُقاس بغياب الرصد لا بوجوده: لذلك لا نُصدر هنا إطلاقًا
    // طالما الرصد متواصل لنفس الكود.
    return false;
  }

  /** يُستدعى عند غياب أي رصد لإتاحة إصدار جديد عند عودة نفس الكود. */
  noteAbsence(now: number = Date.now()): void {
    if (this.lastCode !== null && now - this.lastSeenAt >= this.leaveMs) {
      this.lastCode = null;
      this.lastEmitAt = 0;
    }
  }

  reset(): void {
    this.lastCode = null;
    this.lastEmitAt = 0;
    this.lastSeenAt = 0;
  }
}

export type ScannerError = 'permission' | 'nodriver' | 'engine' | 'generic' | null;

interface UseBarcodeScannerOptions {
  /** فعّال فقط عندما يكون المودال مفتوحًا. */
  active: boolean;
  onDetected: (code: string) => void;
  cooldownMs?: number;
  leaveMs?: number;
}

export const useBarcodeScanner = ({
  active,
  onDetected,
  cooldownMs = 1500,
  leaveMs = 1000,
}: UseBarcodeScannerOptions) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<ScannerError>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);
  // مثيل واحد ثابت طوال حياة المودال (لا قراءة refs أثناء الـrender)
  const [deduper] = useState(() => new BarcodeDeduper(cooldownMs, leaveMs));

  const retry = useCallback(() => {
    setError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let rvcbHandle: number | null = null;
    let scanning = false;
    // عدّاد إخفاقات detect() المتتالية: المحرك الميت (wasm لم يُحمَّل) يرمي
    // في كل إطار — بعد العتبة نُظهر خطأ 'engine' بدل فيديو صامت (درس 2026-09-18).
    // النتائج الفارغة [] طبيعية (لا باركود في الإطار) ولا تُحتسب.
    let detectErrorStreak = 0;
    let engineErrorShown = false;
    const DETECT_ERROR_THRESHOLD = 15;
    const videoEl = videoRef.current;
    deduper.reset();

    const loop = async (detector: { detect: (img: any) => Promise<any[]> }) => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        scheduleNext(detector);
        return;
      }
      if (scanning) {
        scheduleNext(detector);
        return;
      }
      scanning = true;
      try {
        const results = await detector.detect(video as any);
        if (cancelled) return;
        detectErrorStreak = 0;
        if (results && results.length > 0) {
          const code = String((results[0] as any).rawValue ?? '').trim();
          if (code && deduper.shouldEmit(code)) {
            onDetectedRef.current(code);
          }
        } else {
          deduper.noteAbsence();
        }
      } catch {
        // رصد متقطع (إطار ضبابي) — نتجاهل ونكمل الحلقة، لا نكسر المسح.
        // لكن الفشل المتتالي المنهجي = محرك ميت → خطأ مرئي لا صمت.
        detectErrorStreak += 1;
        if (!engineErrorShown && detectErrorStreak >= DETECT_ERROR_THRESHOLD && !cancelled) {
          engineErrorShown = true;
          setError('engine');
        }
      } finally {
        scanning = false;
      }
      scheduleNext(detector);
    };

    const scheduleNext = (detector: { detect: (img: any) => Promise<any[]> }) => {
      if (cancelled) return;
      const video = videoRef.current as any;
      if (video && typeof video.requestVideoFrameCallback === 'function') {
        rvcbHandle = video.requestVideoFrameCallback(() => void loop(detector));
      } else {
        rafId = window.setTimeout(() => void loop(detector), 120);
      }
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) setError('nodriver');
          return;
        }
        // مطابقة المرجع العامل: تهيئة المحرك المحلي أولًا، ثم الكاميرا، ثم
        // إنشاء الماسح بعد video.play() — نفس الترتيب حرفيًا.
        const { BarcodeDetector, prepareZXingModule } =
          await import('barcode-detector/ponyfill');
        configureLocalZXingWasm(prepareZXingModule);
        if (cancelled) return;
        // درس 2026-09-18 (دقة VGA لا تكفي): iOS Safari يعطي 480x640 افتراضيًا
        // بلا قيود — قضبان Code128 الرفيعة تقع تحت البكسل الواحد فلا تُفك أبدًا
        // رغم وضوحها للعين. طلب 720p صراحة (ideal = تفضيل لا إجبار، بلا كسر
        // على الأجهزة الأضعف).
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const detector = new BarcodeDetector({ formats: [...SCAN_FORMATS] } as any);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!cancelled) {
          setIsScanning(true);
          scheduleNext(detector);
        }
      } catch (e: any) {
        if (cancelled) return;
        const name = String(e?.name ?? '');
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('permission');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('nodriver');
        } else {
          setError('generic');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (rvcbHandle !== null) {
        try {
          (videoEl as any)?.cancelVideoFrameCallback?.(rvcbHandle);
        } catch {
          /* ignore */
        }
      }
      window.clearTimeout(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
      setIsScanning(false);
    };
  }, [active, retryNonce, deduper]);

  return { videoRef, error, isScanning, retry };
};
