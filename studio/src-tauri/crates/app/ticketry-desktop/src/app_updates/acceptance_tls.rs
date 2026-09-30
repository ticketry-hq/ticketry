use std::{ffi::OsString, path::Path};

use reqwest::Certificate;
use rustls_pki_types::{pem::PemObject, CertificateDer};
use tauri_plugin_updater::Error as UpdaterError;

const ACCEPTANCE_CA_ENVIRONMENT: &str = "TICKETRY_DESKTOP_ACCEPTANCE_CA_CERT";

fn load_acceptance_ca_with<GetEnvironment, ReadFile>(
    environment: GetEnvironment,
    read_file: ReadFile,
) -> Result<Option<Certificate>, UpdaterError>
where
    GetEnvironment: FnOnce(&str) -> Option<OsString>,
    ReadFile: FnOnce(&Path) -> std::io::Result<Vec<u8>>,
{
    let Some(path) = environment(ACCEPTANCE_CA_ENVIRONMENT) else {
        return Ok(None);
    };
    let pem = read_file(Path::new(&path))?;
    CertificateDer::from_pem_slice(&pem).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid acceptance CA certificate: {error}"),
        )
    })?;
    Ok(Some(Certificate::from_pem(&pem)?))
}

pub(super) fn load_acceptance_ca() -> Result<Option<Certificate>, UpdaterError> {
    load_acceptance_ca_with(|name| std::env::var_os(name), |path| std::fs::read(path))
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, ffi::OsString, path::Path};

    use super::load_acceptance_ca_with;

    const TEST_CA: &[u8] = br#"-----BEGIN CERTIFICATE-----
MIICyDCCAbACCQD6RDUIY2w2fjANBgkqhkiG9w0BAQsFADAmMSQwIgYDVQQDDBtU
aWNrZXRyeSBBY2NlcHRhbmNlIFRlc3QgQ0EwHhcNMjYwOTA0MDQzOTU2WhcNMjYw
OTA1MDQzOTU2WjAmMSQwIgYDVQQDDBtUaWNrZXRyeSBBY2NlcHRhbmNlIFRlc3Qg
Q0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCnJi5UG0CdRi05jzfC
LrdGpYUd7LSDGxSxjBkikZyMfdVLMfAQqXIklkzJtP9EMvFYOeKRFt+Jirx301HD
hFCJXvDHKOPDypvD+9y8ZMVsMlGI/o01GzFdKaJgZPp51Wvybak1q/cAZJ8XloGD
tu/0NaUC0YrTcKTQa7Iid5i1hGycPau1N0+Ituaj9ByphiI/HwShJR93F1daJxxl
Rure3jtI1FVaH8SARYDYJN531sR3quH29xHzPs7N5Btxu/3aIbl3FNy2WqZYsPeO
NQolvWO+V0jWb3cPhIAJ5OpcG496QjiuoN9a6cdwcdLQiXrprYk4KDBBARt0+O8c
E3wzAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAFP42SDKaH1jOch0XEYl78VH2F4V
zffrKMmil+OnlHMbycTjRqxX8kS4v4LkMip/eWrw/Y9JDZFKaD0jcQUOWqP2ekf2
4q3yl/3VPep8u1d9b83Re7PCoN5F8kNAflQgifVTGuWra4H6v/C5aEAjXCKeaZNf
PwAvfrVaEI0t7IvmbJUXa6yxVzc2ED0PlMVpwj8HKmUZ+oeSQ+oD74lYjCo8Yhg/
OaOpVMaMGChZPvHwqXZklET8PEDIqtStZ1QztWp9H2jc2fxMU+wM/j0+unfm5NWj
y2TM14tHnDvcLWiFwlPAA70NKG99dNX8YaBNJQTYT/HfRbHQ/toPkC+fqd8=
-----END CERTIFICATE-----
"#;

    #[test]
    fn absent_acceptance_ca_does_not_read_a_file() {
        let reads = RefCell::new(Vec::new());

        let certificate = load_acceptance_ca_with(
            |_| None,
            |path| {
                reads.borrow_mut().push(path.to_owned());
                Ok(Vec::new())
            },
        )
        .expect("absence is valid");

        assert!(certificate.is_none());
        assert!(reads.borrow().is_empty());
    }

    #[test]
    fn configured_acceptance_ca_is_loaded_as_pem() {
        let requested_variable = RefCell::new(None);
        let requested_path = RefCell::new(None);

        let certificate = load_acceptance_ca_with(
            |name| {
                requested_variable.replace(Some(name.to_owned()));
                Some(OsString::from("/tmp/ticketry-acceptance-ca.pem"))
            },
            |path| {
                requested_path.replace(Some(path.to_owned()));
                Ok(TEST_CA.to_vec())
            },
        )
        .expect("valid PEM CA");

        assert!(certificate.is_some());
        assert_eq!(
            requested_variable.into_inner().as_deref(),
            Some("TICKETRY_DESKTOP_ACCEPTANCE_CA_CERT")
        );
        assert_eq!(
            requested_path.into_inner().as_deref(),
            Some(Path::new("/tmp/ticketry-acceptance-ca.pem"))
        );
    }

    #[test]
    fn malformed_acceptance_ca_is_rejected() {
        let error = load_acceptance_ca_with(
            |_| Some(OsString::from("/tmp/not-a-ca.pem")),
            |_| Ok(b"not a PEM certificate".to_vec()),
        )
        .expect_err("malformed PEM must fail closed");

        assert!(matches!(error, tauri_plugin_updater::Error::Io(_)));
    }
}
