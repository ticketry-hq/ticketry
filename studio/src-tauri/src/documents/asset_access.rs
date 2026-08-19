//! The one place a registered document turns into bytes.
//!
//! Every read starts from a registered authorized root and a root-relative
//! asset path. Resolution canonicalizes the target and proves it is still
//! inside that root after symlinks are followed. An unknown document,
//! traversal, a symlink escape, a directory, a missing file, an extensionless
//! file, and a disallowed media type all produce the same absent result, and
//! none of them reveals the local path that was rejected.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Media types servable from inside a registered design directory. Anything
/// else — including no extension at all — is uniformly absent.
const ASSET_MEDIA_TYPES: &[(&str, &str)] = &[
    ("html", "text/html"),
    ("css", "text/css"),
    ("js", "text/javascript"),
    ("mjs", "text/javascript"),
    ("json", "application/json"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("txt", "text/plain"),
    ("md", "text/markdown"),
];

pub const MARKDOWN_MEDIA_TYPE: &str = "text/markdown";

/// One authorized read: the bytes, how to render them, and — for Markdown —
/// the digest the editor's optimistic save is guarded by.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentAsset {
    pub bytes: Vec<u8>,
    pub media_type: &'static str,
    pub etag: Option<String>,
}

/// The media type for an allowed asset extension, ignoring case.
pub fn media_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    ASSET_MEDIA_TYPES
        .iter()
        .find(|(allowed, _)| *allowed == extension)
        .map(|(_, media)| *media)
}

/// Resolve one allowed asset inside a registered boundary.
///
/// `root` is the registered absolute design directory and `asset_path` is the
/// caller-supplied relative path. An absolute or traversing `asset_path`
/// simply fails containment, so it is not a special case.
pub fn resolve_asset(root: &Path, asset_path: &str) -> Option<(PathBuf, &'static str)> {
    let boundary = root.canonicalize().ok()?;
    let target = boundary.join(asset_path).canonicalize().ok()?;
    if !target.starts_with(&boundary) {
        return None;
    }
    if !target.is_file() {
        return None;
    }
    media_type(&target).map(|media| (target, media))
}

/// Read one allowed asset inside a registered boundary.
pub fn read_asset(root: &Path, asset_path: &str) -> Option<DocumentAsset> {
    let (target, media_type) = resolve_asset(root, asset_path)?;
    let bytes = std::fs::read(target).ok()?;
    let etag = (media_type == MARKDOWN_MEDIA_TYPE).then(|| digest(&bytes));
    Some(DocumentAsset {
        bytes,
        media_type,
        etag,
    })
}

/// The content digest a Markdown save is compared against.
pub fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::write(root.path().join("SPEC.md"), "# spec").expect("write the document");
        std::fs::create_dir_all(root.path().join("assets")).expect("create the asset directory");
        std::fs::write(root.path().join("assets/site.CSS"), "body{}").expect("write the asset");
        std::fs::write(root.path().join("assets/notes.bin"), "raw").expect("write the binary");
        root
    }

    #[test]
    fn allowed_media_types_are_matched_without_regard_to_case() {
        let root = root();

        let asset = read_asset(root.path(), "assets/site.CSS").expect("serve the stylesheet");
        assert_eq!(asset.media_type, "text/css");
        assert_eq!(asset.bytes, b"body{}");
        assert!(asset.etag.is_none());
    }

    #[test]
    fn markdown_carries_the_digest_its_save_is_guarded_by() {
        let root = root();

        let asset = read_asset(root.path(), "SPEC.md").expect("serve the document");
        assert_eq!(asset.media_type, MARKDOWN_MEDIA_TYPE);
        assert_eq!(asset.etag.as_deref(), Some(digest(b"# spec").as_str()));
    }

    #[test]
    fn traversal_absolute_paths_directories_and_unknown_types_are_all_absent() {
        let root = root();

        for rejected in [
            "../escape.md",
            "assets/../../escape.md",
            "/etc/hosts",
            "assets",
            "assets/notes.bin",
            "missing.md",
            "",
        ] {
            assert!(
                read_asset(root.path(), rejected).is_none(),
                "{rejected} must not be servable"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_escaping_the_boundary_is_absent() {
        let outside = tempfile::tempdir().expect("create an outside directory");
        std::fs::write(outside.path().join("secret.md"), "secret").expect("write outside content");
        let root = root();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), root.path().join("escape.md"))
            .expect("create the escaping symlink");

        assert!(read_asset(root.path(), "escape.md").is_none());
    }

    #[test]
    fn a_sibling_directory_sharing_the_boundary_prefix_is_absent() {
        let parent = tempfile::tempdir().expect("create a parent directory");
        let root = parent.path().join("design");
        let sibling = parent.path().join("design-notes");
        std::fs::create_dir_all(&root).expect("create the design directory");
        std::fs::create_dir_all(&sibling).expect("create the sibling directory");
        std::fs::write(sibling.join("secret.md"), "secret").expect("write the sibling document");

        assert!(read_asset(&root, "../design-notes/secret.md").is_none());
    }
}
