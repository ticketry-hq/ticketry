//! Which profile file a legacy import is allowed to read.
//!
//! Only two shapes are supported: the live `profiles.json`, and the numbered
//! copies settings adoption preserved beside it before the settings cutover.
//! Nothing else in the data directory is considered, so an import can never be
//! aimed at a file a user happened to leave there.

use std::path::{Path, PathBuf};

use ticketry_settings::ProfileCatalog;

use super::ModuleLinkError;

/// The live profile file.
pub const LIVE_PROFILES: &str = "profiles.json";

/// The preserved copies settings adoption writes, newest first.
pub const PRESERVED_PROFILES: &[&str] = &[
    "profiles.json.pre-rust-settings.1",
    "profiles.json.pre-rust-settings.2",
    "profiles.json.pre-rust-settings.3",
];

/// The profile file an import read, named relative to the data directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacySource {
    pub name: String,
    pub path: PathBuf,
}

/// The supported profile file to import from, newest live copy first.
///
/// Returns `None` when the installation carries no profile file at all, which
/// is what a fresh install looks like and is not an error.
#[must_use]
pub fn locate(data_directory: &Path) -> Option<LegacySource> {
    std::iter::once(LIVE_PROFILES)
        .chain(PRESERVED_PROFILES.iter().copied())
        .map(|name| LegacySource {
            name: name.to_owned(),
            path: data_directory.join(name),
        })
        .find(|source| source.path.is_file())
}

/// Read `source` with the profile store's own normalization.
///
/// # Errors
///
/// Returns [`super::ModuleLinkErrorCode::UnreadableLegacySource`] when the file
/// is not readable configuration. The import then changes nothing, so a
/// malformed file is never partially adopted.
pub fn read(source: &LegacySource) -> Result<ProfileCatalog, ModuleLinkError> {
    ticketry_settings::read_profile_file(&source.path)
        .map_err(|_| ModuleLinkError::unreadable_legacy_source(&source.path))
}

/// Every legacy link in the order the importer resolves them.
///
/// The most recently selected profile is resolved first, so when two profiles
/// disagree about one Module the selection the user was last working in wins.
/// The remainder follow in file order, which makes the result depend only on
/// the file's contents.
#[must_use]
pub fn ordered_links(catalog: &ProfileCatalog) -> Vec<LegacyLink> {
    let selected = catalog
        .recent_profile_index
        .and_then(|index| usize::try_from(index).ok())
        .filter(|index| *index < catalog.profiles.len());
    let order = selected
        .into_iter()
        .chain((0..catalog.profiles.len()).filter(|index| Some(*index) != selected));
    order
        .flat_map(|index| {
            let profile = &catalog.profiles[index];
            profile.module_links.iter().map(move |link| LegacyLink {
                profile_index: index,
                module_id: link.module_id.clone(),
                path: link.path.clone(),
            })
        })
        .collect()
}

/// One `module_links` entry read out of a profile file.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyLink {
    pub profile_index: usize,
    pub module_id: String,
    pub path: String,
}
