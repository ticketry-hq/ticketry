use super::super::CommandError;

pub(crate) fn valid_name(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CommandError::field("name", "This field may not be blank."));
    }
    if value.chars().count() > 512 {
        return Err(CommandError::field(
            "name",
            "Ensure this field has no more than 512 characters.",
        ));
    }
    Ok(value.to_owned())
}
