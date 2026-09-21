export interface ChangedFileRow {
  path: string;
  previous_path?: string | null;
  status: string;
  binary?: boolean;
  insertions?: number | null;
  deletions?: number | null;
}

export interface ChangedFileGroup {
  directory: string;
  files: readonly ChangedFileRow[];
}

/** Groups by immediate directory while preserving the backend's file order. */
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
    } else {
      const created = [file];
      byDirectory.set(directory, created);
      groups.push({ directory, files: created });
    }
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
