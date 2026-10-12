#![deny(private_bounds, private_interfaces)]

//! The compiled edition and the capabilities it grants.
//!
//! Ticketry ships two editions from one source tree. Pocock is the absence of
//! the `edition-core` Cargo feature, so a plain build is Pocock; this crate is
//! the only one that declares or reads that feature. Every other crate asks
//! [`has`] rather than testing the feature itself.
//!
//! The capability table mirrors the checked-in manifest `config/editions.json`;
//! a parity test fails when the two disagree.

mod capability;
mod edition;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

pub use capability::EditionCapability;
pub use edition::Edition;

/// The edition this binary was compiled as: Core with `edition-core`, otherwise Pocock.
pub const EDITION: Edition = if cfg!(feature = "edition-core") {
    Edition::Core
} else {
    Edition::Pocock
};

/// Whether the compiled [`EDITION`] grants `capability`.
pub const fn has(capability: EditionCapability) -> bool {
    EDITION.has(capability)
}
