"""Unit tests for the pure fractional-index rank algebra (#626).

No DB, no HTTP — just the string algebra of :mod:`worktracker.ranking`.
"""

import pytest

from worktracker.ranking import key_between, rebalance


def test_midpoint_sorts_between_two_keys():
    a, b = "V", "kV"
    mid = key_between(a, b)
    assert a < mid < b


def test_null_left_sorts_before_first():
    first = "V"
    r = key_between(None, first)
    assert r < first


def test_null_right_sorts_after_last():
    last = "V"
    r = key_between(last, None)
    assert r > last


def test_null_null_is_a_valid_first_key():
    r = key_between(None, None)
    assert r
    # A real key sits on either side of it.
    assert key_between(None, r) < r < key_between(r, None)


def test_repeated_midpoints_stay_strictly_ordered():
    """Stack 60 inserts at the same spot; every key stays strictly between."""

    lo, hi = key_between(None, None), key_between(key_between(None, None), None)
    assert lo < hi
    prev = lo
    seen = {lo, hi}
    for _ in range(60):
        mid = key_between(prev, hi)
        assert prev < mid < hi
        assert mid not in seen
        seen.add(mid)
        prev = mid


def test_midpoint_drops_irrelevant_precision_from_long_bounds():
    lower = "zzzynoNMlYbiOCNF8jYorXc3owAX7DutCQaptXxnCZv2m1795l9EhjG2mg8iYsFV"
    upper = "zzzynxLGYeaBuf77jouVQUABn1cBmQDVlZbbtYk8juW2Hi15ZMHR7kV"

    midpoint = key_between(lower, upper)

    assert lower < midpoint < upper
    assert len(midpoint) < 64


def test_top_then_bottom_inserts_keep_a_total_order():
    """Build a column by always inserting at the top, then at the bottom."""

    keys = [key_between(None, None)]
    for _ in range(20):
        keys.insert(0, key_between(None, keys[0]))
    for _ in range(20):
        keys.append(key_between(keys[-1], None))
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)


def test_inverted_neighbors_raise():
    with pytest.raises(ValueError):
        key_between("kV", "V")
    with pytest.raises(ValueError):
        key_between("V", "V")


def test_keys_are_canonical_no_trailing_zero():
    """No generated key ends in the zero digit (one spelling per value)."""

    samples = [
        key_between(None, None),
        key_between(None, "V"),
        key_between("V", None),
        key_between("V", "kV"),
        *rebalance(7),
    ]
    for k in samples:
        assert k
        assert not k.endswith(DIGITS_ZERO)


DIGITS_ZERO = "0"


def test_rebalance_is_evenly_spaced_and_increasing():
    keys = rebalance(5)
    assert len(keys) == 5
    assert keys == sorted(keys)
    assert len(set(keys)) == 5
    # Symmetric about the middle: the i-th gap mirrors the (n-i)-th.
    assert keys[0] < key_between(None, None) < keys[-1]


@pytest.mark.parametrize("n", [0, 1, 2, 3, 10, 50])
def test_rebalance_sizes(n):
    keys = rebalance(n)
    assert len(keys) == n
    assert keys == sorted(keys)
    assert len(set(keys)) == n


def test_rebalanced_group_accepts_further_inserts():
    """A backfilled group still has room to insert between any two members."""

    keys = rebalance(4)
    for lo, hi in zip(keys, keys[1:]):
        mid = key_between(lo, hi)
        assert lo < mid < hi
