//! Handing one reviewed URL to the platform's own browser.
//!
//! The webview asks for this, so the webview is not trusted to have checked it.
//! A URL that reaches a platform opener reaches a shell-adjacent launcher on
//! every operating system Studio runs on, and `open`/`xdg-open` will happily
//! act on a `file:` path, a custom application scheme, or a
//! `javascript:` payload. So the scheme is not merely inspected here — it is
//! restricted to `https`, which is the only scheme any pull request Studio
//! could have created is served over.
//!
//! Validation is deliberately conservative rather than a general URL parser:
//! the accepted character set excludes whitespace, control characters, quotes,
//! and the shell metacharacters an opener could pass on, and the length is
//! capped. Anything a real GitHub pull request URL contains survives it; most
//! things a hostile string would need do not.

use std::process::Command;

use crate::process_spawn;

/// Longest URL this command will open. A GitHub pull request URL is far
/// shorter; the cap exists so an argument list cannot be grown without limit.
const MAX_URL_BYTES: usize = 2048;

const REQUIRED_PREFIX: &str = "https://";

/// Check one URL and hand it to the platform browser, or explain the refusal.
///
/// The error strings are stable and describe the rule that was broken, never
/// the URL: a rejected string is by definition one this side did not trust, and
/// echoing it back into a log or a dialog would carry it further than it got.
pub(crate) fn open(url: &str) -> Result<(), String> {
    let checked = validated(url)?;
    let mut command = opener(checked);
    let status = process_spawn::status(&mut command)
        .map_err(|_| "the system browser could not be started".to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err("the system browser refused to open the link".to_owned())
    }
}

/// The URL, if it is one this command is willing to spawn a process for.
pub(crate) fn validated(url: &str) -> Result<&str, String> {
    if url.len() > MAX_URL_BYTES {
        return Err("the link is too long to open".to_owned());
    }
    if !url.starts_with(REQUIRED_PREFIX) {
        return Err("only https links can be opened".to_owned());
    }
    let host_and_path = &url[REQUIRED_PREFIX.len()..];
    if host_and_path.is_empty() {
        return Err("the link has no host".to_owned());
    }
    // Credentials in the authority would be sent to the host by the browser,
    // and are never part of a link Studio produced.
    let host = host_and_path
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if host.is_empty() || host.contains('@') {
        return Err("the link has no plain host".to_owned());
    }
    if !url.chars().all(is_safe_url_character) {
        return Err("the link contains characters that cannot be opened".to_owned());
    }
    Ok(url)
}

/// Characters a URL may contain here: the unreserved and reserved sets from
/// RFC 3986 minus the ones an opener or a shell could act on.
fn is_safe_url_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(
            character,
            '-' | '.' | '_' | '~' | ':' | '/' | '?' | '#' | '[' | ']' | '@' | '!' | '$' | '&'
                | '\'' | '(' | ')' | '*' | '+' | ',' | ';' | '=' | '%'
        )
}

#[cfg(target_os = "macos")]
fn opener(url: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    // `--` so a URL can never be read as an option, even though the character
    // set above already excludes a leading dash after the scheme.
    command.arg("--").arg(url);
    command
}

#[cfg(target_os = "windows")]
fn opener(url: &str) -> Command {
    let mut command = Command::new("cmd");
    // The empty title argument is required: `start` treats a single quoted
    // argument as the window title rather than the target.
    command.args(["/C", "start", "", url]);
    command
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn opener(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pull_request_url_is_accepted() {
        let url = "https://github.com/ticketry-hq/ticketry/pull/984";
        assert_eq!(validated(url), Ok(url));
    }

    #[test]
    fn an_enterprise_host_and_a_query_are_accepted() {
        let url = "https://git.example.co.uk:8443/o/r/pull/12?files=1#diff-0";
        assert_eq!(validated(url), Ok(url));
    }

    #[test]
    fn only_https_can_be_opened() {
        for url in [
            "http://github.com/o/r/pull/1",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ticketry://open",
            "//github.com/o/r/pull/1",
        ] {
            assert!(validated(url).is_err(), "{url} should not be openable");
        }
    }

    #[test]
    fn credentials_in_the_authority_are_refused() {
        assert!(validated("https://user:token@github.com/o/r/pull/1").is_err());
    }

    #[test]
    fn whitespace_and_shell_characters_are_refused() {
        for url in [
            "https://github.com/o/r/pull/1 ; rm -rf /",
            "https://github.com/o/r/pull/1\nopen /Applications",
            "https://github.com/o/r/pull/1|tee",
            "https://github.com/o/r/pull/1`id`",
            "https://github.com/o/r/pull/1\"",
            "https://github.com/o/r/pull/1\\x",
            "https://github.com/o/r/pull/1<x",
            "https://github.com/o/r/pull/1\u{0}",
        ] {
            assert!(validated(url).is_err(), "{url:?} should not be openable");
        }
    }

    #[test]
    fn a_url_with_no_host_is_refused() {
        assert!(validated("https://").is_err());
        assert!(validated("https:///pull/1").is_err());
    }

    #[test]
    fn an_oversized_url_is_refused() {
        let url = format!("https://github.com/{}", "a".repeat(MAX_URL_BYTES));
        assert!(validated(&url).is_err());
    }
}
