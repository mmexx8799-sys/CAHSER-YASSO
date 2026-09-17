// REQ-BARCODE: ماسح الباركود بالكاميرا.
// getUserMedia + requestVideoFrameCallback + detector.detect + حارسا cooldown/leave.
// المحرك محلي (zxing wasm من public/) — لا طلب شبكي بعد أول تحميل (AC-10).

import { useEffect, useRef, useState, useCallback } from 'react';

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

export type ScannerError = 'permission' | 'nodriver' | 'generic' | null;

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
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        // استيراد كسول: لا يُحمَّل wasm إلا عند فتح الكاميرا فعلًا.
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const detector = new BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'],
        } as any);
        video.srcObject = stream;
        await video.play().catch(() => undefined);
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
