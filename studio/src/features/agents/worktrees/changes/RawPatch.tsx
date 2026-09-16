export function RawPatch({ patch }: { patch: string }) {
  return (
    <pre
      data-testid="raw-patch"
      className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5"
    >
      {patch.split("\n").map((line, index) => (
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
