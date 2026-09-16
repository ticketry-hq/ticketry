use super::ViewerCommandError;

const MAX_SCROLL_LINES: u16 = 500;

pub(super) fn validate_run_id(run_id: &str) -> Result<(), ViewerCommandError> {
    let valid = !run_id.is_empty()
        && run_id.len() <= 128
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or(ViewerCommandError::InvalidRunId)
}

pub(super) fn validate_dimensions(columns: u16, rows: u16) -> Result<(), ViewerCommandError> {
    ((1..=500).contains(&columns) && (1..=500).contains(&rows))
        .then_some(())
        .ok_or(ViewerCommandError::InvalidSize { columns, rows })
}

pub(super) fn validate_scroll_lines(lines: u16) -> Result<(), ViewerCommandError> {
    (1..=MAX_SCROLL_LINES)
        .contains(&lines)
        .then_some(())
        .ok_or(ViewerCommandError::InvalidScrollLines { lines })
}

pub(super) fn validate_handle(handle: &str) -> Result<(), ViewerCommandError> {
    let valid = handle.len() == 39
        && handle.starts_with("viewer-")
        && handle[7..].bytes().all(|byte| byte.is_ascii_hexdigit());
    valid
        .then_some(())
        .ok_or(ViewerCommandError::InvalidViewerHandle)
}
