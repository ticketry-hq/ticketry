//! Two spellings of one identity.
//!
//! WorkTracker stores UUIDs compactly, Studio sends them hyphenated, and the
//! adopted Design Document registry carries whichever spelling wrote the row.
//! Comparisons therefore normalize rather than assume.

/// The compact spelling WorkTracker's own tables store.
pub(super) fn compact_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identity| identity.simple().to_string())
        .unwrap_or_else(|_| value.replace('-', ""))
}

/// The hyphenated spelling Studio and the Django-era registry rows use.
pub(super) fn canonical_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identity| identity.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

/// Both spellings of one identity, for a registry lookup that must match rows
/// written before and after the Rust handoff.
pub(super) fn identity_spellings(value: &str) -> Vec<String> {
    let canonical = canonical_uuid(value);
    let compact = compact_uuid(value);
    if canonical == compact {
        vec![canonical]
    } else {
        vec![canonical, compact]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_spellings_of_one_identity_are_offered_once_each() {
        assert_eq!(
            identity_spellings("cf2de16d-efbd-4106-b0e4-ceab58b90b22"),
            vec![
                "cf2de16d-efbd-4106-b0e4-ceab58b90b22".to_owned(),
                "cf2de16defbd4106b0e4ceab58b90b22".to_owned(),
            ]
        );
    }

    #[test]
    fn a_value_that_is_not_a_uuid_is_matched_verbatim() {
        assert_eq!(identity_spellings("scratch"), vec!["scratch".to_owned()]);
    }
}
