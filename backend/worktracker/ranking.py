"""Fractional-index rank keys for within-column reorder (#626).

A *rank* is a short string over a fixed, ASCII-sorted base-62 alphabet read as
the fractional part of a number in ``[0, 1)``: ``"V"`` means 0.V, ``"FV"``
means 0.FV, and so on. Because the alphabet is sorted in ASCII order, a plain
lexicographic comparison (the database's ``ORDER BY`` and Python's ``<``)
agrees with numeric order — so callers store and sort the raw strings and never
decode them.

``key_between(a, b)`` returns a canonical key sorting strictly *between* its two
neighbors; either bound may be ``None`` for "before the first" / "after the
last". A drop therefore writes exactly one row. Keys stay canonical — no
trailing zero digit — so one value never wears two spellings and lexicographic
order is total.

The midpoint of two distinct fractions is always another fraction strictly
between them (just one digit longer at worst), so the string space never
structurally runs out: a "no key fits" rebalance is never needed at runtime.
:func:`rebalance` is still provided as a pure helper for the migration backfill
(evenly spacing a whole sibling group up front) and is unit-tested in isolation.

No Django, no I/O — pure functions.
"""

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE = len(DIGITS)  # 62
_INDEX = {c: i for i, c in enumerate(DIGITS)}

# The single middle digit, used for the very first key in an empty column.
_MID = DIGITS[BASE // 2]


def _to_digits(key):
    """Decode a key string into its list of base-62 digit values."""
    return [_INDEX[c] for c in key]


def _strip(digits):
    """Drop trailing zero digits so each value has one canonical spelling."""
    end = len(digits)
    while end > 0 and digits[end - 1] == 0:
        end -= 1
    return digits[:end]


def _from_digits(digits):
    """Encode a list of digit values back into a canonical key string."""
    stripped = _strip(digits)
    return "".join(DIGITS[d] for d in stripped) if stripped else _MID


def _half(int_part, frac):
    """Halve the fraction ``int_part.frac`` (base-62), returning frac digits.

    Long-divides the digit sequence by two. A leftover remainder appends one
    extra digit (``BASE / 2``), which is exactly how the midpoint of two
    adjacent keys grows by a single digit rather than running out of room.
    """

    out = []
    rem = 0
    for digit in [int_part, *frac]:
        cur = rem * BASE + digit
        out.append(cur // 2)
        rem = cur % 2
    if rem:
        out.append((rem * BASE) // 2)
    # out[0] is the result's integer part — always 0 since (a + b) / 2 < 1.
    return out[1:]


def key_between(a, b):
    """Return a canonical key sorting strictly between ``a`` and ``b``.

    ``a`` / ``b`` are existing keys or ``None`` (no lower / no upper bound). The
    result ``r`` satisfies ``a < r < b`` lexicographically. Each bound is read
    as a base-62 fraction (a missing lower bound is 0.0, a missing upper bound
    1.0); their midpoint is itself in ``(0, 1)``, hence a valid key.

    :raises ValueError: if ``a >= b`` — callers must pass ordered neighbors.
    """

    if a is not None and b is not None and a >= b:
        raise ValueError(f"key_between needs a < b, got {a!r}, {b!r}")

    lo = _to_digits(a) if a else []  # absent / "" ⇒ 0.0

    # Sum lo + hi with a carry into the integer place. The upper bound, when
    # absent, is the whole unit 1.0 (integer part 1, no fraction digits).
    if b is None:
        hi_int, hi = 1, []
    else:
        hi_int, hi = 0, _to_digits(b)

    n = max(len(lo), len(hi))
    lo += [0] * (n - len(lo))
    hi += [0] * (n - len(hi))

    frac = [0] * n
    carry = 0
    for i in range(n - 1, -1, -1):
        total = lo[i] + hi[i] + carry
        frac[i] = total % BASE
        carry = total // BASE

    return _from_digits(_half(hi_int + carry, frac))


def _fraction_to_key(num, den, max_len=20):
    """Encode the fraction ``num / den`` (``0 < num < den``) as a canonical key."""

    digits = []
    rem = num
    while rem and len(digits) < max_len:
        rem *= BASE
        digits.append(rem // den)
        rem %= den
    return _from_digits(digits)


def rebalance(count):
    """Return ``count`` evenly spaced, strictly increasing canonical keys.

    Used by the migration backfill to stamp a sibling group in one pass (and
    available as a re-spacing helper). The keys are the fractions
    ``i / (count + 1)`` for ``i`` in ``1..count``, so they sit symmetrically in
    ``(0, 1)`` with room on both ends for later inserts.
    """

    if count <= 0:
        return []
    return [_fraction_to_key(i, count + 1) for i in range(1, count + 1)]
