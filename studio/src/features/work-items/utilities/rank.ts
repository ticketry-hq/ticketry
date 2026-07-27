// Fractional-index rank keys for *optimistic* within-column reorder (#626).
//
// This is a faithful port of `worktracker/ranking.py`'s `key_between`. The
// SERVER is the source of truth: the wire only ever carries neighbor ids (never
// a computed key), and the reorder response's authoritative `rank` replaces
// whatever this computes. This client copy exists solely to place the moved
// card *instantly* on drop, before the round-trip resolves.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 62
const MID = DIGITS[Math.floor(BASE / 2)];
const INDEX: Record<string, number> = {};
for (let i = 0; i < DIGITS.length; i++) INDEX[DIGITS[i]] = i;

function strip(digits: number[]): number[] {
  let end = digits.length;
  while (end > 0 && digits[end - 1] === 0) end -= 1;
  return digits.slice(0, end);
}

function fromDigits(digits: number[]): string {
  const s = strip(digits);
  return s.length ? s.map((d) => DIGITS[d]).join("") : MID;
}

// Halve `intPart.frac` (base-62), returning the result's fraction digits.
function half(intPart: number, frac: number[]): number[] {
  const out: number[] = [];
  let rem = 0;
  for (const d of [intPart, ...frac]) {
    const cur = rem * BASE + d;
    out.push(Math.floor(cur / 2));
    rem = cur % 2;
  }
  if (rem) out.push(Math.floor((rem * BASE) / 2));
  return out.slice(1); // drop the (always-zero) integer place
}

/**
 * A canonical key sorting strictly between `a` and `b` (either may be null for
 * "no lower / upper bound"). Throws if `a >= b` — callers pass ordered
 * neighbors, mirroring the server's `key_between`.
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a != null && b != null && a >= b) {
    throw new Error(`rankBetween needs a < b, got ${a}, ${b}`);
  }

  const lo = a ? [...a].map((c) => INDEX[c]) : [];
  let hiInt: number;
  let hi: number[];
  if (b == null) {
    hiInt = 1; // absent upper bound ⇒ the whole unit 1.0
    hi = [];
  } else {
    hiInt = 0;
    hi = [...b].map((c) => INDEX[c]);
  }

  const n = Math.max(lo.length, hi.length);
  while (lo.length < n) lo.push(0);
  while (hi.length < n) hi.push(0);

  const frac = new Array<number>(n).fill(0);
  let carry = 0;
  for (let i = n - 1; i >= 0; i--) {
    const total = lo[i] + hi[i] + carry;
    frac[i] = total % BASE;
    carry = Math.floor(total / BASE);
  }

  return fromDigits(half(hiInt + carry, frac));
}
