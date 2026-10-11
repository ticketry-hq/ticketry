import { importChunkUrl } from "./importChunkUrl";

/**
 * Browsers cache a failed module fetch by URL, so re-running the same
 * `import()` after the network recovers still rejects without a request
 * (CODING-2749). When a chunk fails, remember its URL with a fresh retry
 * query; the next load requests that new URL. A successful retry URL is kept
 * so later loads reuse the module the browser now has cached.
 */
const RETRY_PARAM = "chunk-retry";
let retryNonce = 0;

/** Chromium and Firefox name the failed module URL in the error message. */
function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:dynamically imported module|module script failed)[^:]*:\s*(\S+)/i.exec(
    message,
  );
  if (!match) return null;
  try {
    return new URL(match[1]).href;
  } catch {
    return null;
  }
}

function withRetryQuery(url: string): string {
  const next = new URL(url);
  retryNonce += 1;
  next.searchParams.set(RETRY_PARAM, `${Date.now()}-${retryNonce}`);
  return next.href;
}

export interface ChunkRecovery {
  /**
   * Loads `key`'s chunk and picks its export, re-requesting a fresh URL after
   * an earlier failure of the same key.
   */
  load<Module, Export>(
    key: string,
    load: () => Promise<Module>,
    pick: (module: Module) => Export,
  ): Promise<Export>;
}

export function createChunkRecovery(): ChunkRecovery {
  const replacementUrls = new Map<string, string>();
  return {
    async load(key, load, pick) {
      const replacement = replacementUrls.get(key);
      try {
        const module = replacement
          ? ((await importChunkUrl(replacement)) as Awaited<ReturnType<typeof load>>)
          : await load();
        return pick(module);
      } catch (error) {
        const failedUrl = failedModuleUrl(error);
        if (failedUrl) replacementUrls.set(key, withRetryQuery(failedUrl));
        throw error;
      }
    },
  };
}
