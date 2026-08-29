//! `SeaORM` mappings for the settings store.
//!
//! `app_settings` is adopted from Django in place. `module_links` is authored
//! by Rust: it replaces the module folders that used to live inside
//! `profiles.json`, and [`crate::module_links`] owns its schema and writes.

pub mod app_settings;
pub mod module_link;

/// The generated GraphQL object name Seaography derives from `module_links`.
///
/// The read and write contract itself is registered by the runtime slice that
/// routes module-folder resolution through the typed link; declaring the name
/// once here keeps that registration and its audits addressing one spelling.
pub const MODULE_LINK_OBJECT: &str = "ModuleLinks";
