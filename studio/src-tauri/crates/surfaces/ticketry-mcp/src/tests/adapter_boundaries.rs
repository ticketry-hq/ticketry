//! Source-level boundaries the MCP adapters keep: no backend HTTP path, and
//! no SeaORM queries or domain sequencing inside tool handlers.

use super::*;

#[test]
fn mcp_dispatch_has_no_backend_http_authorization_path() {
    let module = include_str!("../lib.rs");
    let service = include_str!("../service.rs");
    let authority =
        include_str!("../../../../worktracking/ticketry-runs/src/authority/authority.rs");

    assert!(!module.contains("backend_base_url"));
    assert!(!module.contains("backend_api_key"));
    assert!(!service.contains("reqwest"));
    assert!(!authority.contains("reqwest"));
    assert!(!std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("backend_port.rs")
        .exists());
}

#[test]
fn mcp_write_adapters_do_not_own_seaorm_queries_or_domain_sequencing() {
    let dependency = include_str!("../dependency_tools.rs");
    let work_items = include_str!("../work_item_tools.rs");
    let workflow = include_str!("../workflow_policy_tools.rs");
    let launch_binding = include_str!("../workflow_policy_tools/launch_binding_upsert.rs");
    for (name, source) in [
        ("dependency_tools.rs", dependency),
        ("work_item_tools.rs", work_items),
        (
            "attachment_tools.rs",
            include_str!("../attachment_tools.rs"),
        ),
        ("launch_tools.rs", include_str!("../launch_tools.rs")),
        (
            "command_rejection.rs",
            include_str!("../tool_surface/command_rejection.rs"),
        ),
        ("workflow_policy_tools.rs", workflow),
        ("launch_binding_upsert.rs", launch_binding),
    ] {
        for forbidden in [
            "EntityTrait",
            "QueryFilter",
            "ActiveModelTrait",
            "::Entity::",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} imports SeaORM query capability {forbidden}"
            );
        }
    }
    assert!(!dependency.contains("blockers::replace"));
    assert_eq!(dependency.matches("blockers::change(").count(), 2);

    let append = work_items
        .split("async fn append_description")
        .nth(1)
        .unwrap()
        .split("async fn update_status")
        .next()
        .unwrap();
    assert_eq!(append.matches("work_items::append_description(").count(), 1);
    assert!(!append.contains("work_items::update("));

    let finding = work_items
        .split("async fn create_review_finding")
        .nth(1)
        .unwrap();
    assert_eq!(
        finding
            .matches("work_items::create_review_finding(")
            .count(),
        1
    );
    assert!(!finding.contains("read_queries"));

    let launch = launch_binding
        .split("pub(super) async fn upsert")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn ensure_profile_supported")
        .next()
        .unwrap();
    assert_eq!(launch.matches("workflow::patch_launch_binding(").count(), 1);
    assert!(!launch.contains("read_queries::launch_bindings"));
}

#[test]
fn a_launch_profile_is_refused_for_every_provider_but_codex() {
    use ticketry_work_management::commands::workflow::PatchValue;
    use workflow_policy_tools::ensure_profile_supported;

    let profile = PatchValue::Value("x".to_owned());
    for provider in ["claude", "gemini", "agy"] {
        let error = ensure_profile_supported(Some(provider), &profile)
            .expect_err("a non-Codex binding must refuse a launch profile");
        assert_eq!(error.code(), "incompatible_profile");
        assert_eq!(error.field_name(), Some("profile"));
        assert_eq!(error.to_string(), "Only Codex supports launch profiles.");
    }

    assert!(ensure_profile_supported(Some("codex"), &profile).is_ok());
    assert!(ensure_profile_supported(Some("codex"), &PatchValue::Value("  ".to_owned())).is_ok());
    assert!(ensure_profile_supported(None, &profile).is_ok());
    assert!(ensure_profile_supported(Some("claude"), &PatchValue::Null).is_ok());
    assert!(ensure_profile_supported(Some("claude"), &PatchValue::Unset).is_ok());
}
