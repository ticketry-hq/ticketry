//! Bounded, single-line records for the development-only frontend log bridge.

const FRONTEND_LOG_MAX_BYTES: usize = 16 * 1024;

pub(crate) fn frontend_log_line(level: &str, message: &str) -> Result<String, String> {
    if !matches!(level, "debug" | "info" | "warn" | "error") {
        return Err("frontend log level must be debug, info, warn, or error".to_owned());
    }
    let flattened = message.replace('\r', "\\r").replace('\n', "\\n");
    let mut end = flattened.len().min(FRONTEND_LOG_MAX_BYTES);
    while !flattened.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    let suffix = if end < flattened.len() {
        " [truncated]"
    } else {
        ""
    };
    Ok(format!("[frontend][{level}] {}{suffix}", &flattened[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_log_records_are_bounded_single_lines_with_fixed_levels() {
        assert_eq!(
            frontend_log_line("warn", "first\nsecond\rthird"),
            Ok("[frontend][warn] first\\nsecond\\rthird".to_owned())
        );
        assert!(frontend_log_line("warning", "nope").is_err());

        let oversized = "é".repeat(FRONTEND_LOG_MAX_BYTES);
        let line = frontend_log_line("error", &oversized).expect("bounded frontend log");
        assert!(line.ends_with(" [truncated]"));
        assert!(line.is_char_boundary(line.len()));
    }
}
