import { DocViewer, type DesignDoc } from "../../../../../features/documents";

/**
 * Generated-document tab. Markdown flips in place between sanitized reading
 * and rich document edit mode; HTML keeps its sandboxed iframe. The reload
 * token refreshes either renderer when the underlying file is rewritten.
 *
 * The watcher live-reloads the tab when the file changes on disk.
 */
export function WorkspaceDocument({
  doc,
  focusSignal = 0,
}: {
  doc: DesignDoc;
  focusSignal?: number;
}) {
  return <DocViewer doc={doc} focusSignal={focusSignal} editable />;
}
