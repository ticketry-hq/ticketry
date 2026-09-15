use super::CommandError;

pub fn database_uuid(value: &str, field: &'static str) -> Result<String, CommandError> {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .map_err(|_| CommandError::field(field, "Enter a valid UUID."))
}

pub fn new_database_uuid() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Both spellings of one identity: work items store the compact form, while the
/// document registry stores the hyphenated form.
pub fn uuid_spellings(value: &str) -> Vec<String> {
    match uuid::Uuid::parse_str(value) {
        Ok(parsed) => vec![parsed.simple().to_string(), parsed.hyphenated().to_string()],
        Err(_) => vec![value.to_owned()],
    }
}
