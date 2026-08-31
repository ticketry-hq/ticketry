//! The two spellings of a Work Item identity.
//!
//! Rows store compact hexadecimal UUIDs while the public graph speaks the
//! hyphenated form, so a caller may pass either and always receives the public
//! one back. A value that is not a UUID is passed through unchanged: it will
//! simply match no row, which is the same answer as an unknown identity.

pub fn compact_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identity| identity.simple().to_string())
        .unwrap_or_else(|_| value.replace('-', ""))
}

pub fn canonical_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identity| identity.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn either_spelling_resolves_to_the_same_row_identity() {
        assert_eq!(
            compact_uuid("00000000-0000-0000-0000-0000000002c1"),
            compact_uuid("000000000000000000000000000002c1")
        );
    }

    #[test]
    fn row_identities_are_returned_in_public_form() {
        assert_eq!(
            canonical_uuid("000000000000000000000000000002c1"),
            "00000000-0000-0000-0000-0000000002c1"
        );
    }
}
