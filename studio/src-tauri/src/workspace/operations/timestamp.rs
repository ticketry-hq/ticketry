//! SQLite-comparable timestamps.
//!
//! Lease expiry is compared by the database itself, so every value the journal
//! writes must sort against the `CURRENT_TIMESTAMP` defaults in its schema.

use chrono::{DateTime, Utc};

pub(crate) fn database_format(value: DateTime<Utc>) -> String {
    value.naive_utc().format("%Y-%m-%d %H:%M:%S%.f").to_string()
}

pub(crate) fn database_now() -> String {
    database_format(Utc::now())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::database_format;

    #[test]
    fn database_timestamps_sort_lexically_in_time_order() {
        let now = Utc::now();
        assert!(database_format(now) < database_format(now + Duration::seconds(1)));
    }
}
