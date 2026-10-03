use super::output::{self, SuggestionOutput};

#[test]
fn parses_empty_and_tagged_results_and_rejects_invalid_or_duplicate_suggestions() {
    assert!(SuggestionOutput::parse(br#"{"suggestions":[]}"#).is_ok());
    let valid = br#"{"suggestions":[{"goal_id":"goal","story":{"kind":"existing","issue_id":"story"},"reason":"Fits"},{"goal_id":"goal","story":{"kind":"proposed","name":"New story","epic_id":"epic"},"reason":"Fills a gap"}]}"#;
    assert!(SuggestionOutput::parse(valid).is_ok());
    for invalid in [
        br#"{"suggestions":[],"status":"accepted"}"#.as_slice(),
        br#"{"suggestions":[{"goal_id":"goal","story":{"kind":"existing","issue_id":"story","name":"wrong"},"reason":"Fits"}]}"#,
        br#"{"suggestions":[{"goal_id":"goal","story":{"kind":"existing","issue_id":"story"},"reason":""}]}"#,
        br#"{"suggestions":[{"goal_id":"g","story":{"kind":"existing","issue_id":"s"},"reason":"fit"},{"goal_id":"g2","story":{"kind":"existing","issue_id":"s"},"reason":"fit"}]}"#,
    ] { assert!(SuggestionOutput::parse(invalid).is_err()); }
    let schema = output::schema();
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["required"], serde_json::json!(["suggestions"]));
}
