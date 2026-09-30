export function compactWorktrackerId(value: string): string {
  const compact = value.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact) ? compact : value;
}

export function publicWorktrackerId(value: string): string {
  const compact = compactWorktrackerId(value);
  if (!/^[0-9a-f]{32}$/.test(compact)) return value;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function publicWorktrackerTimestamp(value: string): string {
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
