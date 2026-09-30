pub(crate) fn resolve_build_commit(
    profile: &str,
    allow_dirty: bool,
    explicit_commit: Option<&str>,
    mut capture: impl FnMut(&[&str]) -> Result<String, String>,
) -> Result<String, String> {
    if profile == "release" {
        if !allow_dirty
            && !capture(&["status", "--porcelain", "--untracked-files=normal"])?
                .trim()
                .is_empty()
        {
            return Err("release source tree is dirty".to_owned());
        }
        let head = capture(&["rev-parse", "HEAD"])?;
        let commit = explicit_commit.unwrap_or(&head).trim();
        if !matches!(commit.len(), 40 | 64) || !commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("release commit must be a full Git object ID".to_owned());
        }
        if explicit_commit.is_some() && !commit.eq_ignore_ascii_case(head.trim()) {
            return Err("explicit release commit does not match HEAD".to_owned());
        }
        return Ok(head.trim().to_owned());
    }
    Ok(explicit_commit
        .filter(|commit| !commit.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| capture(&["rev-parse", "HEAD"]).ok())
        .map(|commit| commit.trim().to_owned())
        .filter(|commit| !commit.is_empty())
        .unwrap_or_else(|| "unknown".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::resolve_build_commit;

    const HEAD: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn clean_release_builds_stamp_the_current_head() {
        let uppercase_head = HEAD.to_uppercase();
        let commit =
            resolve_build_commit("release", false, Some(&uppercase_head), |args| {
                match args[0] {
                    "status" => Ok(String::new()),
                    "rev-parse" => Ok(HEAD.to_owned()),
                    command => panic!("unexpected git command: {command}"),
                }
            });

        assert_eq!(commit.unwrap(), HEAD);
    }

    #[test]
    fn release_builds_reject_dirty_source_trees() {
        let result = resolve_build_commit("release", false, None, |args| match args[0] {
            "status" => Ok(" M src/main.rs".to_owned()),
            "rev-parse" => Ok(HEAD.to_owned()),
            command => panic!("unexpected git command: {command}"),
        });

        assert_eq!(result.unwrap_err(), "release source tree is dirty");
    }

    #[test]
    fn local_release_builds_allow_dirty_source_trees_when_explicit() {
        let commit = resolve_build_commit("release", true, None, |args| match args[0] {
            "status" => Ok(" M src/main.rs".to_owned()),
            "rev-parse" => Ok(HEAD.to_owned()),
            command => panic!("unexpected git command: {command}"),
        });

        assert_eq!(commit.unwrap(), HEAD);
    }

    #[test]
    fn release_builds_reject_invalid_explicit_commits() {
        for commit in ["", "unknown", "release-candidate"] {
            let result =
                resolve_build_commit("release", false, Some(commit), |args| match args[0] {
                    "status" => Ok(String::new()),
                    "rev-parse" => Ok(HEAD.to_owned()),
                    command => panic!("unexpected git command: {command}"),
                });

            assert_eq!(
                result.unwrap_err(),
                "release commit must be a full Git object ID"
            );
        }
    }

    #[test]
    fn release_builds_reject_an_explicit_commit_that_is_not_head() {
        let other = "89abcdef0123456789abcdef0123456789abcdef";
        let result = resolve_build_commit("release", false, Some(other), |args| match args[0] {
            "status" => Ok(String::new()),
            "rev-parse" => Ok(HEAD.to_owned()),
            command => panic!("unexpected git command: {command}"),
        });

        assert_eq!(
            result.unwrap_err(),
            "explicit release commit does not match HEAD"
        );
    }

    #[test]
    fn debug_builds_allow_dirty_source_trees() {
        let commit = resolve_build_commit("debug", false, None, |args| match args[0] {
            "rev-parse" => Ok(HEAD.to_owned()),
            command => panic!("unexpected git command: {command}"),
        });

        assert_eq!(commit.unwrap(), HEAD);
    }
}
