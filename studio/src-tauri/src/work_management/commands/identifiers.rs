use super::CommandError;

pub fn database_uuid(value: &str, field: &'static str) -> Result<String, CommandError> {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .map_err(|_| CommandError::field(field, "Enter a valid UUID."))
}

pub fn new_database_uuid() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
