const REQUEST_PREFIX: &str = "\n\nUser's request:\n  ";
const JOB_SUFFIX: &str = "\n\nYour job:\n";
const FALLBACK_TITLE: &str = "Untitled instant chat";
const MAX_TITLE_CHARACTERS: usize = 96;

pub(super) fn from_prompt(prompt: Option<&str>) -> String {
    let request = prompt
        .and_then(|prompt| prompt.rsplit_once(REQUEST_PREFIX).map(|(_, tail)| tail))
        .and_then(|tail| tail.rsplit_once(JOB_SUFFIX).map(|(request, _)| request));
    let normalized = request
        .map(|request| request.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|request| !request.is_empty())
        .unwrap_or_else(|| FALLBACK_TITLE.to_owned());
    truncate(normalized)
}

fn truncate(title: String) -> String {
    if title.chars().count() <= MAX_TITLE_CHARACTERS {
        return title;
    }
    let mut shortened = title
        .chars()
        .take(MAX_TITLE_CHARACTERS - 1)
        .collect::<String>();
    shortened.push('…');
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_contains_only_the_normalized_user_request() {
        let prompt = "Private /workspace context\n\nUser's request:\n  Add a first line\n  and a second line\n\nYour job:\n  1. Do not expose this";

        let title = from_prompt(Some(prompt));

        assert_eq!(title, "Add a first line and a second line");
        assert!(!title.contains("workspace"));
        assert!(!title.contains("Do not expose"));
    }

    #[test]
    fn title_uses_the_final_job_delimiter_when_the_request_mentions_one() {
        let prompt = "Context\n\nUser's request:\n  Preserve this text:\n\nYour job:\ninside the file\n\nYour job:\n  1. Implement";

        assert_eq!(
            from_prompt(Some(prompt)),
            "Preserve this text: Your job: inside the file"
        );
    }

    #[test]
    fn configured_instructions_cannot_be_mistaken_for_the_request() {
        let prompt = "Configured Instant instructions:\nprivate\n\nUser's request:\n  decoy\n\nUser's request:\n  Real request\n\nYour job:\n  1. Implement";

        assert_eq!(from_prompt(Some(prompt)), "Real request");
    }

    #[test]
    fn title_truncation_is_unicode_safe_and_includes_the_ellipsis_in_the_limit() {
        let request = "東".repeat(MAX_TITLE_CHARACTERS + 10);
        let prompt = format!("Context{REQUEST_PREFIX}{request}{JOB_SUFFIX}instructions");

        let title = from_prompt(Some(&prompt));

        assert_eq!(title.chars().count(), MAX_TITLE_CHARACTERS);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn missing_or_legacy_material_has_a_stable_fallback() {
        assert_eq!(from_prompt(None), FALLBACK_TITLE);
        assert_eq!(from_prompt(Some("legacy prompt")), FALLBACK_TITLE);
    }
}
