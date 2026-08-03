import { useToastStore } from "../stores/toastStore";
import { IconAlertTriangle, IconCheckCircle, IconX } from "../../shared/ui/icons";
import { useModalStore } from "../modal/modalStore";

// C3 (#638) toast surface (G16). Mounted once at the app root and stacked
// bottom-right. Success toasts announce politely
// (role=status / aria-live=polite); errors assert (role=alert) so they're read
// even mid-action.
export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const settingsOpen = useModalStore((state) =>
    state.modalStack.some((modal) => modal.type === "settings"));

  if (!toasts.length || settingsOpen) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      data-testid="toast-host"
    >
      {toasts.map((t) => {
        const isError = t.kind === "error";
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            data-testid={`toast-${t.kind}`}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-lg ${
              isError
                ? "border-lifecycle-danger/40 bg-lifecycle-danger/15"
                : "border-lifecycle-success/40 bg-lifecycle-success/15"
            }`}
          >
            <span
              className={`mt-0.5 flex-none ${
                isError ? "text-lifecycle-danger" : "text-lifecycle-success"
              }`}
            >
              {isError ? <IconAlertTriangle size={16} /> : <IconCheckCircle size={16} />}
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
