//! Presentation state for an attached native Terminal viewer.
//!
//! Visibility is deliberately independent from attachment lifetime. Hiding a
//! viewer changes only this state; detachment remains owned by the native
//! terminal registry.

/// Presentation state plus the input focus a hide took away.
///
/// Hiding a native view makes AppKit resign its first responder status, and
/// showing it again does not give that back. A viewer that was carrying
/// keyboard focus when it was hidden therefore records a pending restoration,
/// which the reveal consumes so the terminal keeps the keyboard across a
/// hide/show cycle it never asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NativeTerminalVisibility {
    presented: bool,
    focus_restoration: bool,
}

impl NativeTerminalVisibility {
    pub(crate) const fn hidden() -> Self {
        Self {
            presented: false,
            focus_restoration: false,
        }
    }

    #[cfg(test)]
    pub(crate) const fn visible() -> Self {
        Self {
            presented: true,
            focus_restoration: false,
        }
    }

    pub(crate) fn hide(&mut self, focused: bool) -> bool {
        if !self.presented {
            return false;
        }
        self.presented = false;
        self.focus_restoration = focused;
        true
    }

    pub(crate) fn show_after_frame(
        &mut self,
        columns: u16,
        rows: u16,
    ) -> Result<bool, &'static str> {
        if columns == 0 || rows == 0 {
            return Err("native terminal show requires a non-empty grid");
        }
        let changed = !self.presented;
        self.presented = true;
        Ok(changed)
    }

    /// Consumes a pending restoration so one hide returns focus exactly once.
    pub(crate) fn take_focus_restoration(&mut self) -> bool {
        if !self.presented {
            return false;
        }
        let restore = self.focus_restoration;
        self.focus_restoration = false;
        restore
    }

    pub(crate) fn accepts_input(self) -> bool {
        self.presented
    }
}

#[cfg(test)]
mod tests {
    use super::NativeTerminalVisibility;

    #[test]
    fn hide_and_show_are_idempotent_without_becoming_detachment() {
        let mut visibility = NativeTerminalVisibility::visible();

        assert!(visibility.hide(false));
        assert!(!visibility.hide(false));
        assert!(!visibility.accepts_input());
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(!visibility.show_after_frame(120, 36).unwrap());
        assert!(visibility.accepts_input());
    }

    #[test]
    fn an_empty_grid_cannot_reveal_a_hidden_viewer() {
        let mut visibility = NativeTerminalVisibility::hidden();

        assert!(visibility.show_after_frame(0, 36).is_err());
        assert!(visibility.show_after_frame(120, 0).is_err());
        assert!(!visibility.accepts_input());
    }

    #[test]
    fn a_viewer_hidden_while_focused_reclaims_input_focus_once_it_is_shown() {
        let mut visibility = NativeTerminalVisibility::visible();

        assert!(visibility.hide(true));
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(visibility.take_focus_restoration());
        // Restoration is consumed once; a later reveal must not steal focus.
        assert!(!visibility.take_focus_restoration());
    }

    #[test]
    fn a_viewer_hidden_without_focus_does_not_steal_focus_when_shown() {
        let mut visibility = NativeTerminalVisibility::visible();

        assert!(visibility.hide(false));
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(!visibility.take_focus_restoration());
    }

    #[test]
    fn a_repeated_hide_keeps_the_focus_the_first_hide_recorded() {
        let mut visibility = NativeTerminalVisibility::visible();

        // The native view has already resigned first responder by the second
        // hide, so its answer must not erase what the first hide recorded.
        assert!(visibility.hide(true));
        assert!(!visibility.hide(false));
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(visibility.take_focus_restoration());
    }

    #[test]
    fn a_failed_reveal_keeps_the_focus_restoration_pending() {
        let mut visibility = NativeTerminalVisibility::visible();

        assert!(visibility.hide(true));
        assert!(visibility.show_after_frame(0, 36).is_err());
        assert!(!visibility.take_focus_restoration());
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(visibility.take_focus_restoration());
    }
}
