//! Checked ownership closure for the Slice 2 settings and launch-policy handoff.

/// Version of the checked Slice 2 ownership contract.
pub const VERSION: i32 = 1;

/// Every SQL table whose production writer transfers to Rust in Slice 2.
///
/// Exact columns are part of the cutover contract: startup refuses an unknown
/// shape instead of letting a newer Django migration write through a schema
/// the Rust runtime has not classified.
/// The ledger the Work Management entry-skill migration writes.
///
/// Settings' handoff runs before that migration chain, so adoption probes for
/// this table by name rather than depending on the slice that creates it.
/// `work_management::launch_binding_entry_skill_migration` owns the name; a
/// test there fails if the two ever drift.
pub const LAUNCH_BINDING_ENTRY_SKILL_LEDGER: &str =
    "ticketry_launch_binding_entry_skill_migration";

pub const OWNED_TABLES: &[(&str, &[&str])] = &[
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
    (
        "worktracker_launchbinding",
        &[
            "id",
            "issue_type_id",
            "state_id",
            "prompt",
            "required_skills",
            "auto_start",
            "created_at",
            "updated_at",
            "subtree_run_enabled",
            "model_id",
            "reasoning_id",
        ],
    ),
];

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
        let tables = OWNED_TABLES
            .iter()
            .map(|(table, _)| *table)
            .collect::<BTreeSet<_>>();
        assert_eq!(tables.len(), OWNED_TABLES.len());
        assert!(OWNED_TABLES.iter().all(|(_, columns)| !columns.is_empty()));

        let assets = OWNED_ASSETS.iter().copied().collect::<BTreeSet<_>>();
        assert_eq!(assets.len(), OWNED_ASSETS.len());
        assert!(assets.iter().all(|asset| asset.ends_with(".json")));
    }
}
