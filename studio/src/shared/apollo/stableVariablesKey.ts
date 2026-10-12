/** A key for GraphQL variables that ignores property order and undefined values. */
export function stableVariablesKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableVariablesKey).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) =>
        `${JSON.stringify(key)}:${stableVariablesKey((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
