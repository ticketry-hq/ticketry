mod sprint_planning_support;
use sprint_planning_support::*;

use seaography::async_graphql::Request;

#[tokio::test]
async fn work_item_update_renames_an_addressed_module() {
    let f = fixture().await;
    let renamed = f
        .schema
        .execute(Request::new(format!(
            r#"mutation {{ update_work_item(id: "{EPIC}", name: "  Renamed module  ") {{ id name type }} }}"#
        )))
        .await;
    assert!(renamed.errors.is_empty(), "{:?}", renamed.errors);
    let renamed = renamed.data.into_json().unwrap();
    assert_eq!(renamed["update_work_item"]["name"], "Renamed module");
    assert_eq!(renamed["update_work_item"]["type"], "module");

    let reread = f
        .schema
        .execute(Request::new(format!(
            r#"{{ worktrackerIssue(filters: {{ id: {{ eq: "{}" }} }}) {{ nodes {{ name }} }} }}"#,
            EPIC.replace('-', "")
        )))
        .await;
    assert!(reread.errors.is_empty(), "{:?}", reread.errors);
    assert_eq!(
        reread.data.into_json().unwrap()["worktrackerIssue"]["nodes"][0]["name"],
        "Renamed module"
    );
}

#[tokio::test]
async fn module_classification_must_stay_module_level() {
    let f = fixture().await;
    let refused = f
        .schema
        .execute(Request::new(format!(
            r#"mutation {{ update_work_item(id: "{EPIC}", issue_type_id: "70000000000000000000000000000001") {{ id }} }}"#
        )))
        .await;
    assert_eq!(refused.errors.len(), 1, "{:?}", refused.errors);
    assert!(
        refused.errors[0].message.contains("not 'module'"),
        "{}",
        refused.errors[0].message
    );
}
