pub fn now() -> sea_orm::prelude::DateTime {
    chrono::Utc::now().naive_utc()
}
