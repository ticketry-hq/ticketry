use ticketry_graphql_schema::generated_schema_sdl;

#[tokio::test]
async fn sprint_planning_raw_generated_writes_remain_private() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");
    for (query, model) in [
        ("worktrackerSprint", "WorktrackerSprint"),
        ("worktrackerSprintGoal", "WorktrackerSprintGoal"),
        ("worktrackerSprintSuggestion", "WorktrackerSprintSuggestion"),
    ] {
        assert!(
            sdl.contains(&format!("{query}(filters:")),
            "missing public generated query {query}"
        );
        for operation in ["CreateMany", "CreateBatch", "Update", "Delete"] {
            let mutation = format!("{query}{operation}(");
            assert!(
                !sdl.contains(&mutation),
                "protected raw mutation is public: {mutation}"
            );
        }
        assert!(
            !sdl.contains(&format!("input {model}UpdateInput {{")),
            "protected raw input is public: {model}UpdateInput"
        );
    }
}

#[tokio::test]
async fn suggestion_update_returns_the_generated_model_and_keeps_create_delete_private() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");
    let mutation = sdl
        .lines()
        .find(|line| line.trim_start().starts_with("update_sprint_suggestion("))
        .expect("missing suggestion update");
    for field in [
        "id: String!",
        "status: String!",
        "proposed_name: String",
        "): WorktrackerSprintSuggestion",
    ] {
        assert!(
            mutation.contains(field),
            "incorrect restricted suggestion contract: {mutation}"
        );
    }
    assert!(!sdl.contains("worktrackerSprintSuggestionCreateOne("));
    assert!(!sdl.contains("delete_sprint_suggestion("));
}
