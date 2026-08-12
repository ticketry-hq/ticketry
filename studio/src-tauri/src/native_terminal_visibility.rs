//! Presentation state for an attached native Terminal viewer.
//!
//! Visibility is deliberately independent from attachment lifetime. Hiding a
//! viewer changes only this state; detachment remains owned by the native
//! terminal registry.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeTerminalVisibility {
    Hidden,
    Visible,
}

impl NativeTerminalVisibility {
    pub(crate) fn hide(&mut self) -> bool {
        let changed = *self == Self::Visible;
        *self = Self::Hidden;
        changed
    }

    pub(crate) fn show_after_frame(
        &mut self,
        columns: u16,
        rows: u16,
    ) -> Result<bool, &'static str> {
        if columns == 0 || rows == 0 {
            return Err("native terminal show requires a non-empty grid");
        }
        let changed = *self == Self::Hidden;
        *self = Self::Visible;
        Ok(changed)
    }

    pub(crate) fn accepts_input(self) -> bool {
        self == Self::Visible
    }
}

#[cfg(test)]
mod tests {
    use super::NativeTerminalVisibility;

    #[test]
    fn hide_and_show_are_idempotent_without_becoming_detachment() {
        let mut visibility = NativeTerminalVisibility::Visible;

        assert!(visibility.hide());
        assert!(!visibility.hide());
        assert!(!visibility.accepts_input());
        assert!(visibility.show_after_frame(120, 36).unwrap());
        assert!(!visibility.show_after_frame(120, 36).unwrap());
        assert!(visibility.accepts_input());
    }

    #[test]
    fn an_empty_grid_cannot_reveal_a_hidden_viewer() {
        let mut visibility = NativeTerminalVisibility::Hidden;

        assert!(visibility.show_after_frame(0, 36).is_err());
        assert!(visibility.show_after_frame(120, 0).is_err());
        assert!(!visibility.accepts_input());
    }
}
