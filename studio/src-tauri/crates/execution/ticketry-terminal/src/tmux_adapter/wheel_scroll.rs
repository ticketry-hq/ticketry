//! How one wheel gesture reaches a Ticketry-owned pane.
//!
//! Ticketry leaves tmux's own mouse handling off, so viewers deliver wheel
//! gestures as explicit scroll requests and this module reproduces tmux's
//! default wheel policy for them. A program that asked for mouse reports gets
//! wheel reports. A program on the alternate screen has no tmux history to
//! review, so it gets SGR wheel reports too: Codex decodes them without asking
//! for mouse reports, while cursor keys would recall its prompt history.
//! Everything else scrolls tmux history in copy mode.

use super::ScrollDirection;

/// The pane facts [`plan_wheel_delivery`] reads, one tab-separated line.
pub(super) const PANE_WHEEL_STATE_FORMAT: &str = "#{pane_in_mode}\t#{alternate_on}\t\
     #{mouse_any_flag}\t#{mouse_sgr_flag}\t#{pane_width}\t#{pane_height}";

const WHEEL_UP_BUTTON: u16 = 64;
const WHEEL_DOWN_BUTTON: u16 = 65;
/// Legacy mouse reports encode each coordinate as one byte offset by 32.
const LEGACY_MAX_COORDINATE: u16 = 223;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum WheelDelivery {
    CopyMode,
    MouseReports(Vec<u8>),
}

/// Chooses the delivery for `lines` wheel steps from the pane state line.
/// An unreadable state line falls back to copy-mode scrolling.
pub(super) fn plan_wheel_delivery(
    state: &str,
    direction: ScrollDirection,
    lines: u16,
) -> WheelDelivery {
    let Some(pane) = PaneWheelState::parse(state) else {
        return WheelDelivery::CopyMode;
    };
    if pane.in_mode {
        WheelDelivery::CopyMode
    } else if pane.mouse_reporting {
        WheelDelivery::MouseReports(pane.wheel_reports(direction, lines, pane.sgr_reports))
    } else if pane.alternate_screen {
        // ponytail: a non-mouse alternate-screen program that ignores SGR
        // reports (less, plain vim) sees them as input; per-program policy if that bites.
        WheelDelivery::MouseReports(pane.wheel_reports(direction, lines, true))
    } else {
        WheelDelivery::CopyMode
    }
}

/// Space-separated hex bytes, the form `send-keys -H` accepts.
pub(super) fn hex_key_arguments(bytes: &[u8]) -> Vec<String> {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

struct PaneWheelState {
    in_mode: bool,
    alternate_screen: bool,
    mouse_reporting: bool,
    sgr_reports: bool,
    columns: u16,
    rows: u16,
}

impl PaneWheelState {
    fn parse(state: &str) -> Option<Self> {
        let mut fields = state.trim_end().split('\t');
        let mut flag = || fields.next().map(|value| value == "1");
        let in_mode = flag()?;
        let alternate_screen = flag()?;
        let mouse_reporting = flag()?;
        let sgr_reports = flag()?;
        let mut size = || fields.next()?.parse::<u16>().ok();
        let columns = size()?;
        let rows = size()?;
        Some(Self {
            in_mode,
            alternate_screen,
            mouse_reporting,
            sgr_reports,
            columns,
            rows,
        })
    }

    /// One wheel report per step, aimed at the middle of the pane.
    fn wheel_reports(&self, direction: ScrollDirection, lines: u16, sgr: bool) -> Vec<u8> {
        let button = match direction {
            ScrollDirection::Up => WHEEL_UP_BUTTON,
            ScrollDirection::Down => WHEEL_DOWN_BUTTON,
        };
        let column = self.columns / 2 + 1;
        let row = self.rows / 2 + 1;
        let report = if sgr {
            format!("\x1b[<{button};{column};{row}M").into_bytes()
        } else {
            let encode = |value: u16| (value.min(LEGACY_MAX_COORDINATE) + 32) as u8;
            vec![
                0x1b,
                b'[',
                b'M',
                encode(button),
                encode(column),
                encode(row),
            ]
        };
        report.repeat(usize::from(lines))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(state: &str, direction: ScrollDirection, lines: u16) -> WheelDelivery {
        plan_wheel_delivery(state, direction, lines)
    }

    #[test]
    fn shell_history_scrolls_in_copy_mode() {
        assert_eq!(
            plan("0\t0\t0\t0\t120\t32\n", ScrollDirection::Up, 3),
            WheelDelivery::CopyMode
        );
    }

    #[test]
    fn an_open_copy_mode_keeps_scrolling_history() {
        assert_eq!(
            plan("1\t1\t1\t1\t120\t32", ScrollDirection::Up, 3),
            WheelDelivery::CopyMode
        );
    }

    #[test]
    fn alternate_screen_programs_receive_sgr_wheel_reports() {
        assert_eq!(
            plan("0\t1\t0\t0\t120\t32", ScrollDirection::Down, 2),
            WheelDelivery::MouseReports(b"\x1b[<65;61;17M\x1b[<65;61;17M".to_vec())
        );
    }

    #[test]
    fn mouse_reporting_programs_receive_sgr_wheel_reports() {
        assert_eq!(
            plan("0\t1\t1\t1\t120\t32", ScrollDirection::Up, 2),
            WheelDelivery::MouseReports(b"\x1b[<64;61;17M\x1b[<64;61;17M".to_vec())
        );
        assert_eq!(
            plan("0\t0\t1\t1\t80\t24", ScrollDirection::Down, 1),
            WheelDelivery::MouseReports(b"\x1b[<65;41;13M".to_vec())
        );
    }

    #[test]
    fn legacy_wheel_reports_clamp_coordinates_to_one_byte() {
        assert_eq!(
            plan("0\t1\t1\t0\t600\t40", ScrollDirection::Up, 1),
            WheelDelivery::MouseReports(vec![0x1b, b'[', b'M', 96, 255, 53])
        );
    }

    #[test]
    fn unreadable_state_falls_back_to_copy_mode() {
        assert_eq!(plan("", ScrollDirection::Up, 1), WheelDelivery::CopyMode);
        assert_eq!(
            plan("0\t1\t0\t0\twide\t32", ScrollDirection::Up, 1),
            WheelDelivery::CopyMode
        );
    }

    #[test]
    fn hex_arguments_match_send_keys_hex_form() {
        assert_eq!(hex_key_arguments(b"\x1b[<"), ["1b", "5b", "3c"]);
    }
}
