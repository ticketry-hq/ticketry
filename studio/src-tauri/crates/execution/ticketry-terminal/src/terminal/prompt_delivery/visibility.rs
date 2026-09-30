//! Confirming that pasted text actually reached a provider's composer.
//!
//! A paste is acknowledged on screen in one of two ways, and the backend
//! cannot choose which. A pane that echoes input verbatim — a shell, or a
//! provider handed a short single-line invocation — renders the pasted
//! characters, so the payload's tail appearing more often than it did before
//! the paste is direct proof. Claude Code and Codex instead collapse a
//! bracketed multi-line paste into a placeholder such as
//! `[Pasted text #1 +12 lines]`, so the payload's tail never renders at all;
//! there the only available proof is that the composer region stopped looking
//! the way it did before the paste.
//!
//! Requiring the first form alone timed out every multi-line handoff prompt
//! after the text had in fact landed.

use ticketry_launch::ProviderContract;

const VISIBLE_TAIL_CHARACTERS: usize = 64;

/// What the pane showed before a paste, and what would count as the paste
/// having landed.
pub(super) struct PasteEvidence {
    contract: ProviderContract,
    tail: String,
    prior_tail_matches: usize,
    prior_composer: Option<String>,
}

impl PasteEvidence {
    /// Record the pre-paste capture the post-paste captures are judged against.
    pub(super) fn before(contract: ProviderContract, text: &str, baseline: &[u8]) -> Self {
        let tail = normalized_visible_tail(text);
        Self {
            prior_tail_matches: tail_matches(&tail, baseline),
            prior_composer: normalized_composer_region(contract, baseline),
            contract,
            tail,
        }
    }

    /// Whether this capture shows the paste under either acknowledgement.
    pub(super) fn is_visible(&self, screen: &[u8]) -> bool {
        self.echoed_verbatim(screen) || self.composer_changed(screen)
    }

    fn echoed_verbatim(&self, screen: &[u8]) -> bool {
        tail_matches(&self.tail, screen) > self.prior_tail_matches
    }

    /// A collapsed paste leaves the payload off-screen entirely, so a composer
    /// region that differs from the pre-paste one is the acknowledgement. The
    /// region is deliberately narrow: transcript churn above the composer, the
    /// usual reason a capture changes without any input landing, is excluded.
    ///
    /// Without a pre-paste region there is nothing to compare, so this form of
    /// proof is unavailable and verbatim echo is the only one left. A capture
    /// that rendered nothing at all is likewise not proof — a blank pane has
    /// lost its composer rather than filled it.
    fn composer_changed(&self, screen: &[u8]) -> bool {
        let Some(prior) = self.prior_composer.as_deref() else {
            return false;
        };
        let rendered = String::from_utf8_lossy(screen);
        if normalize_visible(&rendered).is_empty() {
            return false;
        }
        normalized_composer_region(self.contract, screen).as_deref() != Some(prior)
    }
}

fn tail_matches(tail: &str, screen: &[u8]) -> usize {
    normalize_visible(&String::from_utf8_lossy(screen))
        .matches(tail)
        .count()
}

fn normalized_composer_region(contract: ProviderContract, screen: &[u8]) -> Option<String> {
    contract
        .composer_region(screen)
        .map(|region| normalize_visible(&region))
}

fn normalize_visible(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalized_visible_tail(value: &str) -> String {
    let normalized = normalize_visible(value);
    let mut tail = normalized
        .chars()
        .rev()
        .take(VISIBLE_TAIL_CHARACTERS)
        .collect::<Vec<_>>();
    tail.reverse();
    tail.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ticketry_launch::{provider_contract, Provider};

    const CLAUDE_READY: &str = "\u{276f} ";

    fn claude(text: &str, baseline: &str) -> PasteEvidence {
        PasteEvidence::before(
            provider_contract(Provider::Claude),
            text,
            baseline.as_bytes(),
        )
    }

    /// The historical proof: a pane that echoes the payload renders its tail.
    #[test]
    fn a_pane_that_echoes_the_payload_is_visible() {
        let evidence = claude("continue", CLAUDE_READY);

        assert!(evidence.is_visible("\u{276f} continue".as_bytes()));
    }

    /// The regression this module exists for. Claude Code replaces a
    /// multi-line paste with a placeholder, so the payload's tail is never on
    /// screen; the composer holding the placeholder is what proves delivery.
    #[test]
    fn a_paste_collapsed_into_a_placeholder_is_visible() {
        let prompt = "Destination prompt.\nSecond line.\nThird line.";
        let evidence = claude(prompt, CLAUDE_READY);

        assert!(evidence.is_visible("\u{276f} [Pasted text #1 +3 lines]".as_bytes()));
    }

    /// Codex's marker is the empty composer's own placeholder text, so it
    /// disappears the moment the composer holds anything. That disappearance
    /// is a composer change, not missing evidence.
    #[test]
    fn a_marker_that_disappears_once_the_composer_holds_text_is_visible() {
        let evidence = PasteEvidence::before(
            provider_contract(Provider::Codex),
            "Destination prompt.\nSecond line.",
            "\u{203a} Ask Codex to do anything".as_bytes(),
        );

        assert!(evidence.is_visible("[Pasted 2 lines]".as_bytes()));
    }

    /// The check still refuses a paste that left no trace. Otherwise it would
    /// wave through the failures it was written to catch.
    #[test]
    fn an_unchanged_pane_is_not_visible() {
        let evidence = claude("Destination prompt.\nSecond line.", CLAUDE_READY);

        assert!(!evidence.is_visible(CLAUDE_READY.as_bytes()));
    }

    /// An agent still streaming output changes the capture without accepting
    /// any input, so churn above the composer is not proof.
    #[test]
    fn transcript_churn_above_an_unchanged_composer_is_not_visible() {
        let evidence = claude("Destination prompt.\nSecond line.", CLAUDE_READY);

        assert!(!evidence.is_visible(format!("streaming a tool result\n{CLAUDE_READY}").as_bytes()));
    }

    /// Terminal control sequences are stripped before comparison, so colour
    /// and cursor movement around an otherwise identical composer are not
    /// mistaken for a landed paste.
    #[test]
    fn control_sequences_around_an_unchanged_composer_are_not_visible() {
        let evidence = claude(
            "Destination prompt.\nSecond line.",
            "\u{1b}[32m\u{276f}\u{1b}[0m ",
        );

        assert!(!evidence.is_visible("\u{1b}[1m\u{276f}\u{1b}[0m ".as_bytes()));
    }

    /// A pane that rendered nothing has lost its composer rather than filled
    /// it, so a blank capture proves nothing either way.
    #[test]
    fn a_blank_capture_is_not_visible() {
        let evidence = claude("Destination prompt.\nSecond line.", CLAUDE_READY);

        assert!(!evidence.is_visible(b""));
        assert!(!evidence.is_visible(b"   \n  \n"));
    }

    /// A payload already on screen before the paste must still be counted, so
    /// a repeated submission is not mistaken for the previous one.
    #[test]
    fn a_payload_already_on_screen_needs_one_more_occurrence() {
        let evidence = claude("continue", "\u{276f} continue");

        assert!(!evidence.is_visible("\u{276f} continue".as_bytes()));
        assert!(evidence.is_visible("continue\n\u{276f} continue".as_bytes()));
    }

    /// Follow-on delivery captures its baseline mid-turn, when the composer
    /// may not be rendered at all. Verbatim echo is then the only proof
    /// available, and it still works.
    #[test]
    fn a_baseline_without_a_composer_falls_back_to_verbatim_echo() {
        let evidence = claude("/tdd", "working");

        assert!(!evidence.is_visible("still working".as_bytes()));
        assert!(evidence.is_visible("\u{276f} /tdd".as_bytes()));
    }
}
