/// Why an interactive launch could not be resolved into authoritative
/// material. Every variant is a refusal to launch: the resolver never falls
/// back to what the caller submitted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchAuthorityErrorCode {
    /// Launch policy refused this Work Item. The rejection code from the
    /// policy ledger is carried in the message.
    PolicyRejected,
    /// The submitted identities do not name resolvable launch material.
    Unresolvable,
    /// The module has no usable local folder to launch in.
    UnusableFolder,
    Storage,
}

#[derive(Debug)]
pub struct LaunchAuthorityError {
    pub code: LaunchAuthorityErrorCode,
    message: String,
}

impl LaunchAuthorityError {
    pub(crate) fn new(code: LaunchAuthorityErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn unresolvable(message: impl Into<String>) -> Self {
        Self::new(LaunchAuthorityErrorCode::Unresolvable, message)
    }
}

impl std::fmt::Display for LaunchAuthorityError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LaunchAuthorityError {}

impl From<sea_orm::DbErr> for LaunchAuthorityError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::new(
            LaunchAuthorityErrorCode::Storage,
            format!("Launch material could not be read: {error}"),
        )
    }
}

impl From<crate::work_management::launch_policy::LaunchPolicyError> for LaunchAuthorityError {
    fn from(error: crate::work_management::launch_policy::LaunchPolicyError) -> Self {
        use crate::work_management::launch_policy::LaunchPolicyError as Policy;
        match error {
            Policy::Database(error) => Self::from(error),
            rejected => Self::new(
                LaunchAuthorityErrorCode::PolicyRejected,
                format!("{}: {rejected}", rejected.code()),
            ),
        }
    }
}
