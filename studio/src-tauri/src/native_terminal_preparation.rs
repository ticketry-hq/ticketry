//! Presentation gate for a native Terminal viewer.
//!
//! The host and terminal adapter can complete frame measurement, attachment,
//! and redraw asynchronously. This small state machine keeps the visibility
//! invariant independent of the order in which those facts arrive.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalGrid {
    pub columns: u16,
    pub rows: u16,
}

impl TerminalGrid {
    pub fn new(columns: u16, rows: u16) -> Result<Self, &'static str> {
        if columns == 0 || rows == 0 {
            return Err("native terminal renderer returned an empty grid");
        }
        Ok(Self { columns, rows })
    }
}

#[derive(Debug, Default)]
pub struct PreparationGate {
    framed: Option<TerminalGrid>,
    attached: Option<TerminalGrid>,
    redrawn: Option<TerminalGrid>,
    presented: bool,
    cleanup_claimed: bool,
}

impl PreparationGate {
    pub fn frame_applied(&mut self, grid: TerminalGrid) -> bool {
        self.framed = Some(grid);
        self.update_presented()
    }

    pub fn attachment_ready(&mut self, grid: TerminalGrid) -> bool {
        self.attached = Some(grid);
        self.update_presented()
    }

    pub fn redraw_ready(&mut self, grid: TerminalGrid) -> bool {
        self.redrawn = Some(grid);
        self.update_presented()
    }

    #[cfg(test)]
    pub fn is_presented(&self) -> bool {
        self.presented
    }

    /// Returns true only for the first failure/disposal path that claims
    /// cleanup. Callers use this to make view, attachment, and bridge cleanup
    /// idempotent when failure signals race.
    pub fn claim_cleanup(&mut self) -> bool {
        if self.cleanup_claimed {
            return false;
        }
        self.cleanup_claimed = true;
        true
    }

    fn update_presented(&mut self) -> bool {
        if self.cleanup_claimed || self.presented {
            return self.presented;
        }
        let Some(grid) = self.framed else {
            return false;
        };
        if self.attached == Some(grid) && self.redrawn == Some(grid) {
            self.presented = true;
        }
        self.presented
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(columns: u16, rows: u16) -> TerminalGrid {
        TerminalGrid::new(columns, rows).unwrap()
    }

    #[test]
    fn rejects_placeholder_or_empty_geometry() {
        assert!(TerminalGrid::new(0, 24).is_err());
        assert!(TerminalGrid::new(80, 0).is_err());
    }

    #[test]
    fn remains_hidden_until_all_exact_grid_facts_arrive_in_any_order() {
        let target = grid(117, 38);
        let mut gate = PreparationGate::default();

        assert!(!gate.redraw_ready(target));
        assert!(!gate.attachment_ready(target));
        assert!(gate.frame_applied(target));
        assert!(gate.is_presented());
    }

    #[test]
    fn a_redraw_or_attachment_for_an_old_grid_cannot_present() {
        let target = grid(117, 38);
        let old = grid(80, 24);
        let mut gate = PreparationGate::default();

        assert!(!gate.frame_applied(target));
        assert!(!gate.attachment_ready(old));
        assert!(!gate.redraw_ready(old));
        assert!(!gate.is_presented());
        assert!(!gate.attachment_ready(target));
        assert!(gate.redraw_ready(target));
    }

    #[test]
    fn cleanup_is_claimed_once_and_prevents_late_presentation() {
        let target = grid(117, 38);
        let mut gate = PreparationGate::default();

        assert!(gate.claim_cleanup());
        assert!(!gate.claim_cleanup());
        assert!(!gate.frame_applied(target));
        assert!(!gate.attachment_ready(target));
        assert!(!gate.redraw_ready(target));
        assert!(!gate.is_presented());
    }
}
