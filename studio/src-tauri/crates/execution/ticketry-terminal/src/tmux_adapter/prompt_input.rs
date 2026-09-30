use super::{
    checked, current_runtime_namespace, session_name, validate_identifier, RuntimeIdentity,
    RuntimeObservation, TmuxAdapter, TmuxAdapterError,
};
use std::path::Path;

impl TmuxAdapter {
    pub fn verify_prompt_session(&self, run_id: &str) -> Result<(), TmuxAdapterError> {
        let namespace = current_runtime_namespace()?;
        let identity = RuntimeIdentity::new(run_id, &namespace)?;
        match self.observe(&identity) {
            RuntimeObservation::Running => Ok(()),
            observation => Err(TmuxAdapterError::Unavailable(format!(
                "prompt delivery refused for unverified session: {observation:?}"
            ))),
        }
    }

    pub(crate) fn set_prompt_buffer(
        &self,
        run_id: &str,
        buffer: &str,
        text: &str,
    ) -> Result<(), TmuxAdapterError> {
        validate_identifier(run_id)?;
        validate_identifier(buffer)?;
        checked(
            self.command_with(["set-buffer", "-b", buffer, "--", text]),
            "create prompt buffer",
        )?;
        Ok(())
    }

    pub(crate) fn load_prompt_buffer(
        &self,
        run_id: &str,
        buffer: &str,
        path: &Path,
    ) -> Result<(), TmuxAdapterError> {
        validate_identifier(run_id)?;
        validate_identifier(buffer)?;
        let mut command = self.command();
        command.args(["load-buffer", "-b", buffer]).arg(path);
        checked(command, "load prompt buffer")?;
        Ok(())
    }

    pub(crate) fn paste_prompt_buffer(
        &self,
        run_id: &str,
        buffer: &str,
    ) -> Result<(), TmuxAdapterError> {
        validate_identifier(run_id)?;
        validate_identifier(buffer)?;
        checked(
            self.command_with([
                "paste-buffer",
                "-d",
                "-p",
                "-r",
                "-b",
                buffer,
                "-t",
                &session_name(run_id),
            ]),
            "paste prompt buffer",
        )?;
        Ok(())
    }

    pub(crate) fn send_prompt_enter(&self, run_id: &str) -> Result<(), TmuxAdapterError> {
        validate_identifier(run_id)?;
        checked(
            self.command_with(["send-keys", "-t", &session_name(run_id), "Enter"]),
            "submit prompt",
        )?;
        Ok(())
    }
}
