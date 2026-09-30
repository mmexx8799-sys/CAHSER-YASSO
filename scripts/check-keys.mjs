// check-keys.mjs — node check-keys.mjs backup.json
// READ-ONLY: parses an app backup JSON (as produced by backupData) and
// prints the distinct key-sets found in customers/suppliers docs (minus
// `id`). Gates AUDIT-SEC-1-FOLLOWUP: a future rules-level `hasOnly`
// allowlist is safe only if every production doc already matches it.
import fs from 'fs';
const b = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const c of ['customers', 'suppliers']) {
  const sets = {};
  for (const d of b[c]) {
    const k = Object.keys(d).filter(x => x !== 'id').sort().join(',');
    sets[k] = (sets[k] || 0) + 1;
  }
  console.log(c, sets);
}
