const attachTails = new Map<string, Promise<void>>();

/**
 * Serializes native surface creation for one durable run.
 *
 * React StrictMode deliberately mounts, cleans up, and remounts effects in
 * development. Native attachment crosses the WebView boundary and cannot be
 * cancelled mid-command, so the replacement must wait for the discarded
 * attempt to finish detaching before it creates another AppKit view.
 */
export async function serializeNativeAttach<T>(
  runId: string,
  attach: () => Promise<T>,
): Promise<T> {
  const previous = attachTails.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const ticket = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => ticket);
  attachTails.set(runId, tail);

  await previous.catch(() => {});
  try {
    return await attach();
  } finally {
    release();
    void tail.finally(() => {
      if (attachTails.get(runId) === tail) attachTails.delete(runId);
    });
  }
}
