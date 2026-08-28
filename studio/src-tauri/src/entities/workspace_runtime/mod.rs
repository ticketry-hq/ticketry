//! Entities owned by the Workspace Runtime capability.
//!
//! `operation` is the durable bridge between a SQLite transaction and a local
//! filesystem or Git effect. It is deliberately **not** handed to the
//! Seaography builder: the journal carries immutable intent, lease ownership,
//! and external evidence, none of which may become a public query or mutation
//! bundle. Every caller reaches it through
//! [`crate::workspace::operations`], which is the only writer.

pub mod operation;
