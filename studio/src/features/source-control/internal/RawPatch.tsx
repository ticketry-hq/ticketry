/**
 * The fallback patch view: the unified diff exactly as git wrote it.
 *
 * A review surface must never go blank because a renderer choked on an
 * unusual patch, so this is what shows when the syntax-highlighting viewer
 * cannot load or cannot parse. The failure-open idea is taken from T3 Code
 * (MIT, © T3 Tools, Inc.), whose DiffPanel falls back to plain text when its
 * parser fails; the code here is Ticketry's own.
 */
export function RawPatch({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre
      data-testid="raw-patch"
      className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5"
    >
      {lines.map((line, index) => (
        <div key={index} className={rawPatchLineTone(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

export function rawPatchLineTone(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-text-muted";
  if (line.startsWith("+")) return "text-lifecycle-success";
  if (line.startsWith("-")) return "text-lifecycle-danger";
  if (line.startsWith("@@")) return "text-focus-accent";
  return "text-text-secondary";
}
