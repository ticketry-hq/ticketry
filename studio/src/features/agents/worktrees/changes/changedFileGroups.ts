export interface ChangedFileRow {
  path: string;
  previous_path?: string | null;
  status: string;
  binary?: boolean;
  insertions?: number | null;
  deletions?: number | null;
}

export interface ChangedFileGroup {
  /** Directory shared by every file in the group, without a trailing slash. */
  directory: string;
  files: readonly ChangedFileRow[];
}

/**
 * Group changed files by their immediate directory, preserving Git's order.
 *
 * A flat list of 34 rows reads as noise once the paths truncate; grouping by
 * directory restores the shape of the change without sorting the files away
 * from the order the backend chose.
 *
 * ponytail: groups by immediate directory only. A nested tree matters if a
 * single directory routinely holds more files than fit on screen.
 */
export function changedFileGroups(
  files: readonly ChangedFileRow[],
): readonly ChangedFileGroup[] {
  const groups: ChangedFileGroup[] = [];
  const byDirectory = new Map<string, ChangedFileRow[]>();
  for (const file of files) {
    const directory = fileDirectory(file.path);
    const existing = byDirectory.get(directory);
    if (existing) {
      existing.push(file);
      continue;
    }
    const created = [file];
    byDirectory.set(directory, created);
    groups.push({ directory, files: created });
  }
  return groups;
}

export function fileDirectory(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function fileName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
