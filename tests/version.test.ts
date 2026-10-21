import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_VERSION } from '../services/api/backup';

describe('REQ-FIX-1b: version consistency', () => {
  it('package.json version === APP_VERSION', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.version).toBe(APP_VERSION);
  });
});
