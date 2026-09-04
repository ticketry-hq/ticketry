const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE: usize = DIGITS.len();

/// Allocate the canonical base-62 midpoint between two lexical rank bounds.
pub fn between(lower: Option<&str>, upper: Option<&str>) -> Result<String, ()> {
    if lower
        .zip(upper)
        .is_some_and(|(lower, upper)| lower >= upper)
    {
        return Err(());
    }
    let mut low = digits(lower.unwrap_or_default())?;
    let mut high = digits(upper.unwrap_or_default())?;
    let high_integer = usize::from(upper.is_none());
    let length = low.len().max(high.len());
    low.resize(length, 0);
    high.resize(length, 0);

    let mut fraction = vec![0; length];
    let mut carry = 0;
    for index in (0..length).rev() {
        let total = low[index] + high[index] + carry;
        fraction[index] = total % BASE;
        carry = total / BASE;
    }
    let midpoint = encode(half(high_integer + carry, &fraction));
    Ok(shortest_prefix(&midpoint, lower, upper))
}

/// Evenly space a complete collection, matching Django's baseline repair.
pub fn rebalance(count: usize) -> Vec<String> {
    (1..=count)
        .map(|numerator| fraction(numerator, count + 1, 20))
        .collect()
}

fn digits(rank: &str) -> Result<Vec<usize>, ()> {
    rank.bytes()
        .map(|digit| {
            DIGITS
                .iter()
                .position(|candidate| *candidate == digit)
                .ok_or(())
        })
        .collect()
}

fn encode(mut digits: Vec<usize>) -> String {
    while digits.last() == Some(&0) {
        digits.pop();
    }
    if digits.is_empty() {
        return "V".to_owned();
    }
    digits
        .into_iter()
        .map(|index| DIGITS[index] as char)
        .collect()
}

fn shortest_prefix(midpoint: &str, lower: Option<&str>, upper: Option<&str>) -> String {
    for length in 1..midpoint.len() {
        let prefix = &midpoint[..length];
        if prefix.ends_with('0') {
            continue;
        }
        if lower.is_none_or(|bound| bound < prefix) && upper.is_none_or(|bound| prefix < bound) {
            return prefix.to_owned();
        }
    }
    midpoint.to_owned()
}

fn half(integer: usize, fraction: &[usize]) -> Vec<usize> {
    let mut output = Vec::with_capacity(fraction.len() + 1);
    let mut remainder = 0;
    for digit in std::iter::once(integer).chain(fraction.iter().copied()) {
        let current = remainder * BASE + digit;
        output.push(current / 2);
        remainder = current % 2;
    }
    if remainder != 0 {
        output.push((remainder * BASE) / 2);
    }
    output.remove(0);
    output
}

fn fraction(numerator: usize, denominator: usize, max_length: usize) -> String {
    let mut digits = Vec::new();
    let mut remainder = numerator;
    while remainder != 0 && digits.len() < max_length {
        remainder *= BASE;
        digits.push(remainder / denominator);
        remainder %= denominator;
    }
    encode(digits)
}

#[cfg(test)]
mod tests {
    use super::{between, rebalance};

    #[test]
    fn matches_django_boundaries_midpoints_and_rebalance() {
        assert_eq!(between(None, None).unwrap(), "V");
        assert_eq!(between(Some("V"), None).unwrap(), "k");
        assert_eq!(between(None, Some("V")).unwrap(), "F");
        assert_eq!(between(Some("V"), Some("kV")).unwrap(), "c");
        assert_eq!(
            rebalance(5),
            [
                "AKfKfKfKfKfKfKfKfKfK",
                "KfKfKfKfKfKfKfKfKfKf",
                "V",
                "fKfKfKfKfKfKfKfKfKfK",
                "pfKfKfKfKfKfKfKfKfKf",
            ]
        );
    }

    #[test]
    fn dense_midpoints_remain_unique_and_strictly_ordered() {
        let lower = between(None, None).unwrap();
        let upper = between(Some(&lower), None).unwrap();
        let mut previous = lower;
        for _ in 0..60 {
            let midpoint = between(Some(&previous), Some(&upper)).unwrap();
            assert!(previous < midpoint && midpoint < upper);
            previous = midpoint;
        }
        assert!(between(Some(&upper), Some(&upper)).is_err());
    }
}
