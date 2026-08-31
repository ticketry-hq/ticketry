//! Taking ownership of the installation the user already has.
//!
//! Every other slice assumes it is running against a data directory Rust owns.
//! This crate is what makes that true, exactly once, on the way in.
//!
//! [`classification`] reads the data directory and returns one checked answer
//! about which installation it found — a current or recorded SQLite
//! generation, a PostgreSQL import source, an installation Rust already owns,
//! or nothing at all — refusing anything it cannot name. [`preflight`] then
//! asks the separate question of whether the contents can be carried forward,
//! reading through a single transaction so its report describes one committed
//! state. [`import`] copies a supported PostgreSQL source into canonical
//! SQLite. [`adoption`] performs the one irreversible step: it takes the
//! installation exclusively, snapshots it, records in one transaction that
//! Rust owns it, provisions the Rust-only journals the source never had, and
//! only then opens readiness. [`final_schema_migrations`] composes the 0044
//! through 0052 parity chain, which spans work management, settings and
//! worktree schemas and so belongs to none of them.

pub mod adoption;
pub mod classification;
pub mod final_schema_migrations;
pub mod import;
pub mod preflight;
