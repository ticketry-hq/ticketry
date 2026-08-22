//! The read-only desktop transport for document bytes.
//!
//! Sandboxed HTML needs a URL, not a query result: an iframe navigates to one,
//! and every relative image, stylesheet, script, and font inside it resolves
//! against it. That is the only reason this protocol exists. It is not a second
//! model authority — it holds no listing, accepts no writes, and resolves every
//! byte through the same [`DocumentsService`] boundary GraphQL uses.
//!
//! `ticketrydoc://localhost/<document-id>/<relative-asset-path>`
//!
//! An unknown document, a traversal attempt, a symlink escape, an unsupported
//! media type, and an absent file are all the same empty `404`, and none of
//! them names the local path that was refused.

use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext};

use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::documents::{DocumentAsset, DocumentsService};

/// The URL scheme Studio builds document URLs on.
pub(crate) const DOCUMENT_SCHEME: &str = "ticketrydoc";

/// Serve one document or asset request.
pub(crate) fn serve_document_request<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let application = context.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let response = match resolve_service(&application) {
            Some(service) => respond(&service, request).await,
            None => not_found(),
        };
        responder.respond(response);
    });
}

/// Whether the protocol can currently resolve the Documents boundary it serves
/// bytes through. The Slice 4 readiness gate composes this: a registered scheme
/// that cannot reach a service would answer every asset request with a 404.
pub(crate) fn resolves_documents<R: Runtime>(application: &tauri::AppHandle<R>) -> bool {
    resolve_service(application).is_some()
}

fn resolve_service<R: Runtime>(application: &tauri::AppHandle<R>) -> Option<DocumentsService> {
    application
        .try_state::<DesktopLaunchRuntime>()
        .and_then(|runtime| runtime.documents().ok())
}

async fn respond(service: &DocumentsService, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Only reads exist. A write shaped like one is refused before any path is
    // resolved, so the protocol can never become a second save seam.
    if request.method() != tauri::http::Method::GET && request.method() != tauri::http::Method::HEAD
    {
        return not_found();
    }
    let Some((document_id, asset_path)) = document_target(request.uri().path()) else {
        return not_found();
    };
    match service.read_asset(&document_id, &asset_path).await {
        Ok(Some(asset)) => asset_response(asset),
        Ok(None) | Err(_) => not_found(),
    }
}

/// Split `/<document-id>/<relative-path>` into its two authorized parts.
///
/// Both are percent-decoded here, so an encoded traversal reaches the
/// containment check as the traversal it actually is.
fn document_target(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    let (identity, relative) = trimmed.split_once('/')?;
    let document_id = percent_decode(identity)?;
    if document_id.is_empty() {
        return None;
    }
    let mut segments = Vec::new();
    for segment in relative.split('/') {
        segments.push(percent_decode(segment)?);
    }
    let asset_path = segments.join("/");
    (!asset_path.is_empty()).then_some((document_id, asset_path))
}

/// Decode `%XX` escapes, refusing anything that is not valid UTF-8 or contains
/// an interior NUL. A malformed escape is not repaired — it simply has no
/// target.
fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = bytes.get(index + 1).and_then(|byte| hex_value(*byte))?;
            let low = bytes.get(index + 2).and_then(|byte| hex_value(*byte))?;
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    if decoded.contains(&0) {
        return None;
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn asset_response(asset: DocumentAsset) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", asset.media_type)
        // The webview document and this protocol are separate origins, so the
        // Markdown editor can only read its guard digest if the header is
        // deliberately exposed.
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "ETag")
        .header("Cache-Control", "no-store");
    if let Some(etag) = asset.etag.as_deref() {
        response = response.header("ETag", etag);
    }
    response.body(asset.bytes).unwrap_or_else(|_| not_found())
}

/// One shape for every refusal, carrying no body and no local path.
fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .expect("a constant not-found response is well formed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_url_splits_into_an_identity_and_a_relative_path() {
        assert_eq!(
            document_target("/doc-1/notes/Design.HTML"),
            Some(("doc-1".to_owned(), "notes/Design.HTML".to_owned()))
        );
    }

    #[test]
    fn percent_escapes_are_decoded_before_containment_is_judged() {
        assert_eq!(
            document_target("/doc%201/a%20b/SPEC.md"),
            Some(("doc 1".to_owned(), "a b/SPEC.md".to_owned()))
        );
        assert_eq!(
            document_target("/doc-1/%2e%2e/escape.md"),
            Some(("doc-1".to_owned(), "../escape.md".to_owned()))
        );
    }

    #[test]
    fn a_url_without_both_parts_has_no_target() {
        for path in ["/", "/doc-1", "/doc-1/", "//SPEC.md"] {
            assert_eq!(document_target(path), None, "{path} must have no target");
        }
    }

    #[test]
    fn a_malformed_or_nul_bearing_escape_has_no_target() {
        assert_eq!(document_target("/doc-1/%zz.md"), None);
        assert_eq!(document_target("/doc-1/spec%00.md"), None);
    }

    #[test]
    fn every_refusal_is_the_same_empty_not_found() {
        let response = not_found();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response.body().is_empty());
    }

    #[test]
    fn markdown_publishes_the_digest_its_editor_guards_on() {
        let response = asset_response(DocumentAsset {
            bytes: b"# spec".to_vec(),
            media_type: "text/markdown",
            etag: Some("digest".to_owned()),
        });

        assert_eq!(response.headers()["Content-Type"], "text/markdown");
        assert_eq!(response.headers()["ETag"], "digest");
        assert_eq!(response.headers()["Access-Control-Expose-Headers"], "ETag");
    }
}
