export function isAbsoluteFolderPath(path: string): boolean {
  const value = path.trim();
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}
