pub(super) fn hyphenate(value: &str) -> String {
    if value.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &value[..8],
            &value[8..12],
            &value[12..16],
            &value[16..20],
            &value[20..]
        )
    } else {
        value.to_owned()
    }
}

pub(super) fn public_id(value: &str) -> String {
    hyphenate(value)
}
