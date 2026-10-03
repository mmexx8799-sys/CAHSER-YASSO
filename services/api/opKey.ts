// services/api/opKey.ts — TX3 (AUDIT-TX-3): stable operation idempotency key
// helpers. Pure module: NO firebase imports, NO Firestore contact, safe to
// unit-test without the emulator. Used by process* to (1) validate an
// optional caller-supplied key, (2) build order-independent request
// fingerprints, (3) compare them with stored docs on early return.
export const OP_KEY_MISMATCH_CODE = 'opkey-mismatch';

// UUID v4 (also matches crypto.randomUUID() output; never contains '/',
// hence always a legal document id).
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fail fast on a malformed key BEFORE any Firestore contact. `undefined`
// (old callers / old builds) passes through to the random-id path.
export function assertValidOpKey(opKey: string | undefined): void {
    if (opKey !== undefined && !UUID_V4_RE.test(opKey)) {
        throw new Error("مفتاح العملية غير صالح — لن تتم أي كتابة");
    }
}

// Thrown when a stable-key doc already exists but its content differs from
// the incoming request (operator edited the cart after an ambiguous
// failure and re-pressed with the stale key). Surfaced ONCE with its own
// Arabic text by the caller — never wrapped, never retried (code is not in
// RETRYABLE_TX_CODES), cart is NOT cleared by the caller.
export class OpKeyMismatchError extends Error {
    readonly code = OP_KEY_MISMATCH_CODE;
    constructor() {
        super("سُجّلت العملية مسبقًا بمحتوى مختلف، راجع آخر فاتورة");
        this.name = 'OpKeyMismatchError';
    }
}

export interface OpFingerprint {
    // Merged (same-id lines summed) + sorted (order-independent) pairs.
    pairs: Array<[string, number]>;
    total: number;
    subtotal?: number;
    discount?: number;
    // Missing party normalizes to null on BOTH sides before comparing.
    party: string | null;
}

// Build from an explicit parts bag so request and stored-doc sides share
// one code path. Totals round to 2 decimals (float-dust guard).
export function buildFingerprint(parts: {
    pairs: Array<readonly [string, unknown]>;
    total: unknown;
    subtotal?: unknown;
    discount?: unknown;
    party?: unknown;
}): OpFingerprint {
    const merged = new Map<string, number>();
    for (const [id, qty] of parts.pairs) {
        merged.set(String(id), (merged.get(String(id)) ?? 0) + (Number(qty) || 0));
    }
    const sorted: Array<[string, number]> = [...merged.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
    );
    const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
    const opt = (n: unknown) => (n === undefined ? undefined : round2(n));
    return {
        pairs: sorted,
        total: round2(parts.total),
        subtotal: opt(parts.subtotal),
        discount: opt(parts.discount),
        party: (parts.party as string | null | undefined) ?? null,
    };
}

export function fingerprintsEqual(a: OpFingerprint, b: OpFingerprint): boolean {
    if (a.total !== b.total) return false;
    if ((a.subtotal ?? null) !== (b.subtotal ?? null)) return false;
    if ((a.discount ?? null) !== (b.discount ?? null)) return false;
    if (a.party !== b.party) return false;
    if (a.pairs.length !== b.pairs.length) return false;
    return a.pairs.every(([id, q], i) => b.pairs[i][0] === id && b.pairs[i][1] === q);
}
