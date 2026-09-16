import type { StudioRuntime } from "../../runtime";
import { studioRuntime } from "../../runtime";

class ModuleFolderTrustError extends Error {}

const PROVIDERS = [
  { slug: "codex", label: "Codex", required: true },
  { slug: "gemini", label: "Gemini", required: true },
  { slug: "claude", label: "Claude", required: true },
] as const;

type Provider = (typeof PROVIDERS)[number];

function causeMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : typeof cause === "string" && cause.trim()
      ? cause
      : "Unknown provider error.";
}

function trustError(
  provider: Provider,
  operation: "inspect" | "prepare",
  cause: unknown,
): ModuleFolderTrustError {
  const message =
    `Could not ${operation} ${provider.label} folder trust: ${causeMessage(cause)}`;
  return new ModuleFolderTrustError(`${message} Retry to continue.`);
}

function providerFailure(
  provider: Provider,
  status: "denied" | "unsupported" | "approval_required",
): ModuleFolderTrustError {
  if (status === "denied") {
    return new ModuleFolderTrustError(
      `${provider.label} has denied trust for this folder. Change it in ${provider.label}, then retry.`,
    );
  }
  if (status === "unsupported") {
    return new ModuleFolderTrustError(
      `${provider.label} does not support durable folder trust.`,
    );
  }
  return new ModuleFolderTrustError(
    `The folder or provider approval changed before ${provider.label} trust was saved. Retry to inspect it again.`,
  );
}

function providerNames(providers: Provider[]): string {
  const names = providers.map(({ label }) => label);
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")}${names.length > 2 ? "," : ""} and ${names.at(-1)}`;
}

interface Inspection {
  canonicalDirectory: string;
  pending: Provider[];
  approvals: Map<string, string>;
}

interface DirectoryTrustCopy {
  title: string;
  subject: string;
  confirmLabel: string;
}

async function inspect(
  path: string,
  trust: NonNullable<StudioRuntime["prepareDirectoryTrust"]>,
): Promise<Inspection> {
  const pending: Provider[] = [];
  const approvals = new Map<string, string>();
  let canonicalDirectory = path;
  for (const provider of PROVIDERS) {
    let result;
    try {
      result = await trust(provider.slug, path, null);
    } catch (cause) {
      if (!provider.required) continue;
      throw trustError(provider, "inspect", cause);
    }
    if (provider.required && result.directory) {
      if (canonicalDirectory !== path && canonicalDirectory !== result.directory) {
        throw new ModuleFolderTrustError(
          "Providers resolved different canonical module folders. Retry after fixing the folder path.",
        );
      }
      canonicalDirectory = result.directory;
    }
    if (!provider.required) continue;
    if (result.status === "approval_required") {
      pending.push(provider);
      approvals.set(provider.slug, result.approval!);
    } else if (result.status === "denied" || result.status === "unsupported") {
      throw providerFailure(provider, result.status);
    }
  }
  return { canonicalDirectory, pending, approvals };
}

function sameScope(left: Inspection, right: Inspection): boolean {
  return left.canonicalDirectory === right.canonicalDirectory &&
    left.pending.map(({ slug }) => slug).join() ===
      right.pending.map(({ slug }) => slug).join();
}

/** Trust the folder when the desktop requires it. */
export async function prepareDirectoryTrust(
  path: string,
  runtime: StudioRuntime = studioRuntime(),
  copy: DirectoryTrustCopy = {
    title: "Trust module folder?",
    subject: "module folder",
    confirmLabel: "Trust folder",
  },
): Promise<boolean> {
  const trust = runtime.prepareDirectoryTrust;
  if (!trust) return true;

  let inspected = await inspect(path, trust);
  for (let attempts = 0; attempts < 3; attempts += 1) {
    if (inspected.pending.length === 0) return true;
    const { dialog } = await import("../../state/clientStore");
    const approved = await dialog.confirm({
      title: copy.title,
      body: `Trust ${inspected.canonicalDirectory} for ${providerNames(inspected.pending)}? This updates their directory trust settings. Only trust ${copy.subject}s whose code you trust.`,
      confirmLabel: copy.confirmLabel,
    });
    if (!approved) return false;

    const refreshed = await inspect(path, trust);
    if (!sameScope(inspected, refreshed)) {
      inspected = refreshed;
      continue;
    }
    for (const provider of refreshed.pending) {
      try {
        const prepared = await trust(
          provider.slug,
          path,
          refreshed.approvals.get(provider.slug)!,
        );
        if (prepared.status !== "prepared" && prepared.status !== "already_trusted") {
          throw providerFailure(provider, prepared.status);
        }
      } catch (cause) {
        if (cause instanceof ModuleFolderTrustError) throw cause;
        throw trustError(provider, "prepare", cause);
      }
    }
    return true;
  }
  throw new ModuleFolderTrustError(
    `The ${copy.subject} or provider approval changed repeatedly. Retry setup.`,
  );
}

export const prepareModuleFolderTrust = prepareDirectoryTrust;

export function moduleFolderSaveError(cause: unknown, fallback: string): string {
  return cause instanceof ModuleFolderTrustError ? cause.message : fallback;
}
