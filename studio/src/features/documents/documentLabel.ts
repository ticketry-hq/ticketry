/**
 * The tab label for a document is its filename without the extension, derived
 * wherever the document is rendered rather than stored beside it. A stored
 * label would drift the moment a file was renamed on disk.
 */
export function documentLabel(relPath: string): string {
  const filename = relPath.split("/").pop() ?? relPath;
  const extension = filename.lastIndexOf(".");
  return extension > 0 ? filename.slice(0, extension) : filename;
}
