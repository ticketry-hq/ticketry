//! How a Module Link's stable identity is chosen.
//!
//! A link is a property of its Module, so its identity is derived from the
//! Module's rather than minted. Import, re-import after a rollback, and an
//! import replayed against a restored snapshot therefore all converge on the
//! same row identity, which is what lets the importer be idempotent without
//! consulting anything it wrote earlier.

use uuid::Uuid;

/// The namespace every Module Link identity is derived inside.
///
/// It is a constant of this contract: changing it would remint every existing
/// link, so it is stated once here and never computed.
const MODULE_LINK_NAMESPACE: Uuid = Uuid::from_u128(0x7f3d_9c1a_4e28_4b6d_9a05_6c2f_18b7_43e1);

/// The one spelling a Module identity is stored and matched under.
///
/// Rows carry compact hexadecimal UUIDs while the public graph, profile files,
/// and MCP callers all speak the hyphenated form. Normalizing here is what
/// lets a caller pass either and still address the same link. A value that is
/// not a UUID keeps its own spelling: it will match no Module, which is the
/// same answer as an unknown identity.
#[must_use]
pub fn compact_module_id(module_id: &str) -> String {
    uuid::Uuid::parse_str(module_id)
        .map(|identity| identity.simple().to_string())
        .unwrap_or_else(|_| module_id.replace('-', ""))
}

/// The identity the link for `module_id` always has.
///
/// Derived from the normalized Module identity, so the same Module reached by
/// either spelling always derives one link identity.
#[must_use]
pub fn link_id_for_module(module_id: &str) -> String {
    Uuid::new_v5(
        &MODULE_LINK_NAMESPACE,
        compact_module_id(module_id).as_bytes(),
    )
    .simple()
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_module_always_derives_one_identity() {
        let module = "b1c2d3e4f5a6978899aabbccddeeff00";
        assert_eq!(link_id_for_module(module), link_id_for_module(module));
        assert_ne!(
            link_id_for_module(module),
            link_id_for_module("00ffeeddccbbaa998897a6f5e4d3c2b1")
        );
    }

    #[test]
    fn either_module_spelling_derives_one_link() {
        assert_eq!(
            link_id_for_module("b1c2d3e4-f5a6-9788-99aa-bbccddeeff00"),
            link_id_for_module("b1c2d3e4f5a6978899aabbccddeeff00")
        );
    }

    #[test]
    fn an_identity_has_the_stored_column_shape() {
        let identity = link_id_for_module("b1c2d3e4f5a6978899aabbccddeeff00");
        assert_eq!(identity.len(), 32);
        assert!(identity.chars().all(|value| value.is_ascii_hexdigit()));
        assert!(identity.chars().all(|value| !value.is_ascii_uppercase()));
    }
}
