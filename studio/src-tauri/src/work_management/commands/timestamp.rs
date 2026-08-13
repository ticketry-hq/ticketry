pub fn now() -> sea_orm::prelude::DateTime {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the system clock predates the Unix epoch");
    sea_orm::prelude::DateTimeUtc::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("the system clock is outside SQLite's datetime range")
        .naive_utc()
}
