type CaptureResolver = (
  event: KeyboardEvent,
  actionIds: ReadonlySet<string>,
) => string | null;

let captureResolver: CaptureResolver | null = null;

/** Installs the app-owned keymap without making feature modules depend on app/. */
export function installCaptureKeymapResolver(resolver: CaptureResolver): void {
  captureResolver = resolver;
}

export function resolveCaptureKeymapAction(
  event: KeyboardEvent,
  actionIds: ReadonlySet<string>,
): string | null {
  return captureResolver?.(event, actionIds) ?? null;
}
