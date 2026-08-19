use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};

use super::{RunsPersistenceError, RunsPersistenceErrorCode};

pub(crate) fn parse(value: &str) -> Result<DateTime<Utc>, RunsPersistenceError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 64 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    if let Ok(value) = DateTime::parse_from_rfc3339(value) {
        return Ok(value.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"] {
        if let Ok(value) = NaiveDateTime::parse_from_str(value, format) {
            return Ok(value.and_utc());
        }
    }
    Err(invalid())
}

pub(crate) fn normalize(value: &str) -> Result<String, RunsPersistenceError> {
    parse(value).map(format)
}

pub(crate) fn format(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::AutoSi, false)
}

/// SQLite `datetime` literal shape. Lease expiry and outcome timestamps are
/// compared by the database itself, so they must sort against the
/// `CURRENT_TIMESTAMP` defaults the Runs schema writes.
pub(crate) fn database_format(value: DateTime<Utc>) -> String {
    value.naive_utc().format("%Y-%m-%d %H:%M:%S%.f").to_string()
}

pub(crate) fn database_now() -> String {
    database_format(Utc::now())
}

fn invalid() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::InvalidTimestamp,
        "The lifecycle timestamp is not a supported ISO-8601 value.",
    )
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn normalizes_offsets_and_naive_values_to_utc() {
        assert_eq!(
            normalize("2026-08-12T03:00:00-05:00").unwrap(),
            "2026-08-12T08:00:00+00:00"
        );
        assert_eq!(
            normalize("2026-08-12 08:00:00.123456").unwrap(),
            "2026-08-12T08:00:00.123456+00:00"
        );
    }
}
