#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NativeOrderingOperation {
    Lower(String),
    Raise(String),
}

#[derive(Debug, Default)]
pub(crate) struct NativeWindowOrdering {
    generation: u64,
    selected_handle: Option<String>,
}

impl NativeWindowOrdering {
    pub(crate) fn transition<I, S>(
        &mut self,
        generation: u64,
        requested_handle: Option<&str>,
        selection_eligible: bool,
        handles: I,
    ) -> Vec<NativeOrderingOperation>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        if generation <= self.generation {
            return Vec::new();
        }
        self.generation = generation;
        self.selected_handle = requested_handle
            .filter(|_| selection_eligible)
            .map(str::to_owned);

        let mut operations = handles
            .into_iter()
            .map(|handle| NativeOrderingOperation::Lower(handle.as_ref().to_owned()))
            .collect::<Vec<_>>();
        if let Some(handle) = self.selected_handle.clone() {
            operations.push(NativeOrderingOperation::Raise(handle));
        }
        operations
    }

    pub(crate) fn is_selected(&self, handle: &str) -> bool {
        self.selected_handle.as_deref() == Some(handle)
    }

    pub(crate) fn clear_selected(&mut self, handle: &str) {
        if self.is_selected(handle) {
            self.selected_handle = None;
        }
    }

    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::{NativeOrderingOperation, NativeWindowOrdering};

    #[test]
    fn selecting_one_view_lowers_every_view_before_raising_the_target() {
        let mut ordering = NativeWindowOrdering::default();

        let operations = ordering.transition(
            1,
            Some("native-two"),
            true,
            ["native-one", "native-two", "native-three"],
        );

        assert_eq!(
            operations,
            vec![
                NativeOrderingOperation::Lower("native-one".to_owned()),
                NativeOrderingOperation::Lower("native-two".to_owned()),
                NativeOrderingOperation::Lower("native-three".to_owned()),
                NativeOrderingOperation::Raise("native-two".to_owned()),
            ]
        );
        assert!(ordering.is_selected("native-two"));
        assert!(!ordering.is_selected("native-one"));
    }

    #[test]
    fn stale_selection_cannot_replace_a_newer_selection() {
        let mut ordering = NativeWindowOrdering::default();
        ordering.transition(8, Some("native-new"), true, ["native-old", "native-new"]);

        let operations =
            ordering.transition(7, Some("native-old"), true, ["native-old", "native-new"]);

        assert!(operations.is_empty());
        assert!(ordering.is_selected("native-new"));
    }

    #[test]
    fn webview_ownership_lowers_all_views_and_clears_selection() {
        let mut ordering = NativeWindowOrdering::default();
        ordering.transition(1, Some("native-one"), true, ["native-one", "native-two"]);

        let operations = ordering.transition(2, None, false, ["native-one", "native-two"]);

        assert_eq!(
            operations,
            vec![
                NativeOrderingOperation::Lower("native-one".to_owned()),
                NativeOrderingOperation::Lower("native-two".to_owned()),
            ]
        );
        assert!(!ordering.is_selected("native-one"));
        assert!(!ordering.is_selected("native-two"));
    }

    #[test]
    fn an_ineligible_view_is_never_raised() {
        let mut ordering = NativeWindowOrdering::default();

        let operations = ordering.transition(
            1,
            Some("native-hidden"),
            false,
            ["native-visible", "native-hidden"],
        );

        assert_eq!(
            operations,
            vec![
                NativeOrderingOperation::Lower("native-visible".to_owned()),
                NativeOrderingOperation::Lower("native-hidden".to_owned()),
            ]
        );
        assert!(!ordering.is_selected("native-hidden"));
    }

    #[test]
    fn resetting_for_a_new_document_accepts_its_first_generation() {
        let mut ordering = NativeWindowOrdering::default();
        ordering.transition(42, Some("native-old"), true, ["native-old"]);
        ordering.reset();

        let operations = ordering.transition(1, Some("native-new"), true, ["native-new"]);

        assert_eq!(
            operations,
            vec![
                NativeOrderingOperation::Lower("native-new".to_owned()),
                NativeOrderingOperation::Raise("native-new".to_owned()),
            ]
        );
    }
}
