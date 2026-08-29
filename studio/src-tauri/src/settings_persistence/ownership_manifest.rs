//! Checked ownership closure for the Slice 2 settings and launch-policy handoff.

/// Version of the checked Slice 2 ownership contract.
pub const VERSION: i32 = 1;

/// Re-exported so callers name one launch-binding shape across both manifests.
pub use crate::work_management::ownership_manifest::{launch_binding_table, LaunchBindingShape};

/// The settings tables whose production writer transfers to Rust in Slice 2.
///
/// Exact columns are part of the cutover contract: startup refuses an unknown
/// shape instead of letting a newer Django migration write through a schema
/// the Rust runtime has not classified.
pub const SETTINGS_TABLES: &[(&str, &[&str])] = &[
    ("app_settings", &["scope", "key", "value", "updated_at"]),
    (
        "worktracker_provider",
        &["id", "slug", "activated", "supports_unattended"],
    ),
    ("worktracker_agentmodel", &["id", "provider_id", "name"]),
    ("worktracker_reasoninglevel", &["id", "name"]),
    (
        "worktracker_agentmodelreasoninglevel",
        &["id", "agent_model_id", "reasoning_level_id"],
    ),
];

/// Every transferred table, in the launch-binding shape the database is in.
///
/// The launch binding is the one transferred row whose columns change after
/// the handoff, so it is named by shape rather than by a fixed list: this
/// preflight runs before the entry-skill migration on a first launch and after
/// it on every launch that follows.
#[must_use]
pub fn owned_tables(
    launch_binding: LaunchBindingShape,
) -> Vec<(&'static str, &'static [&'static str])> {
    let mut tables = SETTINGS_TABLES.to_vec();
    tables.push(launch_binding_table(launch_binding));
    tables
}

/// Non-SQL assets transferred with the same ownership decision.
pub const OWNED_ASSETS: &[&str] = &["profiles.json", "features.json"];

/// Code-owned launch adapters which must have exactly one persisted row.
pub const PROVIDER_ADAPTER_SLUGS: &[&str] = &["agy", "claude", "codex", "gemini"];

/// The only Python modules allowed to consume transferred policy in shipping.
/// Both are read/effect compatibility ports and contain no settings writer.
pub const DJANGO_COMPATIBILITY_PORTS: &[&str] = &[
    "apps.settings_store.compatibility",
    "apps.execution.launch_policy_port",
];

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn manifest_has_one_unique_entry_for_every_transferred_resource() {
        for shape in [
            LaunchBindingShape::WithoutEntrySkill,
            LaunchBindingShape::WithEntrySkill,
        ] {
            let owned = owned_tables(shape);
            let tables = owned
                .iter()
                .map(|(table, _)| *table)
                .collect::<BTreeSet<_>>();
            assert_eq!(tables.len(), owned.len());
            assert!(owned.iter().all(|(_, columns)| !columns.is_empty()));
            assert!(tables.contains("worktracker_launchbinding"));
        }

        let assets = OWNED_ASSETS.iter().copied().collect::<BTreeSet<_>>();
        assert_eq!(assets.len(), OWNED_ASSETS.len());
        assert!(assets.iter().all(|asset| asset.ends_with(".json")));
    }
}
