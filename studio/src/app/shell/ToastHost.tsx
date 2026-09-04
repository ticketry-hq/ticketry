import { useClientStore } from "../../state/clientStore";
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconInfo,
  IconX,
} from "../../shared/ui/icons";
import { useModalStore } from "../modal/modalStore";
import { useToastViewportPlacement } from "./useToastViewportPlacement";

// C3 (#638) toast surface (G16). Mounted once at the app root and stacked
// at the bottom-left, outside any presented native terminal. Success and
// informational toasts announce politely
// (role=status / aria-live=polite); errors assert (role=alert) so they're read
// even mid-action.
export default function ToastHost() {
  const toasts = useClientStore((s) => s.toasts);
  const dismiss = useClientStore((s) => s.dismissToast);
  const settingsOpen = useModalStore((state) =>
    state.modalStack.some((modal) => modal.type === "settings"));
  const placement = useToastViewportPlacement(toasts.length > 0 && !settingsOpen);

  if (!toasts.length || settingsOpen) return null;

  return (
    <div
      ref={placement.ref}
      style={placement.style}
      className="pointer-events-none fixed z-[100] flex flex-col gap-2 overflow-y-auto"
      data-testid="toast-host"
      data-native-terminal-focus-preserving
    >
      {toasts.map((t) => {
        const isError = t.kind === "error";
        const isInfo = t.kind === "info";
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            data-testid={`toast-${t.kind}`}
            onPointerDown={(event) => event.preventDefault()}
            className={`pointer-events-auto flex items-start gap-2.5 border px-3 py-2.5 shadow-lg ${
              isError
                ? "border-lifecycle-danger/40 bg-lifecycle-danger/15"
                : isInfo
                  ? "border-lifecycle-active/40 bg-lifecycle-active/10"
                  : "border-lifecycle-success/40 bg-lifecycle-success/15"
            }`}
          >
            <span
              className={`mt-0.5 flex-none ${
                isError
                  ? "text-lifecycle-danger"
                  : isInfo
                    ? "text-lifecycle-active"
                    : "text-lifecycle-success"
              }`}
            >
              {isError
                ? <IconAlertTriangle size={16} />
                : isInfo
                  ? <IconInfo size={16} />
                  : <IconCheckCircle size={16} />}
            </span>
            <span className="flex-1 text-sm leading-snug text-text-primary">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="flex-none text-text-muted transition-colors hover:text-text-primary"
            >
              <IconX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
