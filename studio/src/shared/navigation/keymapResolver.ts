type KeymapResolver = (
  event: KeyboardEvent,
  actionIds: ReadonlySet<string>,
) => string | null;

let captureResolver: KeymapResolver | null = null;
let modalResolver: KeymapResolver | null = null;

/** Installs the app-owned keymap without making feature modules depend on app/. */
export function installCaptureKeymapResolver(resolver: KeymapResolver): void {
  captureResolver = resolver;
}

export function resolveCaptureKeymapAction(
  event: KeyboardEvent,
  actionIds: ReadonlySet<string>,
): string | null {
  return captureResolver?.(event, actionIds) ?? null;
}

/** Shares modal-context bindings with editable feature controls without an app dependency. */
export function installModalKeymapResolver(resolver: KeymapResolver): void {
  modalResolver = resolver;
}

export function resolveModalKeymapAction(
  event: KeyboardEvent,
  actionIds: ReadonlySet<string>,
): string | null {
  return modalResolver?.(event, actionIds) ?? null;
}
