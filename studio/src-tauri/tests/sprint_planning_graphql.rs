use ticketry_graphql_schema::generated_schema_sdl;

fn output<'a>(sdl: &'a str, name: &str) -> &'a str {
    sdl.split(&format!("type {name} {{"))
        .nth(1)
        .and_then(|body| body.split('}').next())
        .unwrap_or_else(|| panic!("missing generated output {name}"))
}

#[tokio::test]
async fn sprint_planning_reads_use_the_generated_entity_graph() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");
    for query in [
        "worktrackerSprint",
        "worktrackerSprintGoal",
        "worktrackerSprintSuggestion",
    ] {
        assert!(
            sdl.contains(&format!("{query}(filters:")),
            "missing generated query {query}"
        );
    }
    let sprint = output(&sdl, "WorktrackerSprint");
    for field in [
        "id: String!",
        "projectId: String!",
        "name: String!",
        "status: String!",
        "suggestionRunId: String",
        "goalsRevisedAt: String",
        "project: WorktrackerProject",
        "suggestionRun: AgentRuns",
        "goals(",
        "suggestions(",
        "issues(",
    ] {
        assert!(sprint.contains(field), "missing sprint field {field}");
    }
    for field in ["goal:", "startDate:", "endDate:"] {
        assert!(
            !sprint.contains(field),
            "deferred sprint field {field} must stay absent"
        );
    }
    let goal = output(&sdl, "WorktrackerSprintGoal");
    for field in [
        "sprintId: String!",
        "position: Int!",
        "text: String!",
        "sprint: WorktrackerSprint",
    ] {
        assert!(goal.contains(field), "missing goal field {field}");
    }
    let suggestion = output(&sdl, "WorktrackerSprintSuggestion");
    for field in [
        "sprintId: String!",
        "goalId: String!",
        "issueId: String",
        "proposedName: String",
        "proposedEpicId: String",
        "reason: String!",
        "status: String!",
        "runId: String!",
        "issue: WorktrackerIssue",
        "goal: WorktrackerSprintGoal",
        "sprint: WorktrackerSprint",
    ] {
        assert!(
            suggestion.contains(field),
            "missing suggestion field {field}"
        );
    }
    assert!(output(&sdl, "WorktrackerIssue").contains("sprintId: String"));
    assert!(output(&sdl, "WorktrackerIssue").contains("sprint: WorktrackerSprint"));
    assert!(output(&sdl, "WorktrackerProject").contains("sprints("));
}
