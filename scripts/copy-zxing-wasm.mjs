// REQ-BARCODE: نسخ zxing_reader.wasm (محرك المسح المحلي) إلى public/
// حتى يعمل المسح بالكاميرا بلا إنترنت (لا CDN). يُستدعى من `postinstall`.
// لا يفشل البناء لو الحزمة غير مثبّتة (تحذير فقط) — بيئة CI بلا شبكة.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const destDir = join(root, 'public');
const dest = join(destDir, 'zxing_reader.wasm');

// المرشحون بالترتيب: export الرسمي أولًا، ثم مسار مباشر كاحتياطي
const candidates = [
  'zxing-wasm/reader/zxing_reader.wasm',
  'zxing-wasm/dist/reader/zxing_reader.wasm',
  'barcode-detector/zxing_reader.wasm',
];

try {
  const require = createRequire(join(root, 'package.json'));
  let copied = false;
  for (const spec of candidates) {
    try {
      const src = require.resolve(spec);
      if (src && existsSync(src)) {
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        copyFileSync(src, dest);
        console.log(`[REQ-BARCODE] copied ${spec} → public/zxing_reader.wasm`);
        copied = true;
        break;
      }
    } catch {
      // جرّب المرشح التالي
    }
  }
  if (!copied) {
    console.warn('[REQ-BARCODE] skipped zxing wasm copy: no candidate path resolved');
  }
} catch (e) {
  console.warn('[REQ-BARCODE] skipped zxing wasm copy:', String(e));
}
