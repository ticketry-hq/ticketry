/**
 * Building the URL a document's bytes are served from.
 *
 * The path is not decoration: an HTML document navigated to at
 * `.../<id>/notes/design.html` resolves `./diagram.png` to
 * `.../<id>/notes/diagram.png`, so the URL must mirror the document's own
 * directory levels. Each segment is encoded separately for exactly that
 * reason — encoding the whole relative path would collapse it to one segment.
 */

/** The read-only scheme the desktop shell serves document bytes on. */
export const DOCUMENT_SCHEME = "ticketrydoc";

export function encodeDocumentPath(relPath: string): string {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

/**
 * The origin a custom protocol is reachable at. Windows and Android proxy
 * custom schemes through `http://<scheme>.localhost`; every other platform
 * serves them as a scheme of their own.
 */
export function documentProtocolOrigin(
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): string {
  return /windows|android/i.test(userAgent)
    ? `http://${DOCUMENT_SCHEME}.localhost`
    : `${DOCUMENT_SCHEME}://localhost`;
}

/** The desktop document URL for one registered document or relative asset. */
export function desktopDocumentUrl(
  documentId: string,
  relPath: string,
  origin: string = documentProtocolOrigin(),
): string {
  return `${origin}/${encodeURIComponent(documentId)}/${encodeDocumentPath(relPath)}`;
}
