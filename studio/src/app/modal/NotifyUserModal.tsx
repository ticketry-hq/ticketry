import { useRef } from "react";
import type { UserNotice } from "../../runtime";
import { ModalShell } from "./ModalShell";
import { useModalStore } from "./modalStore";

const SEVERITY_STYLES: Record<
  UserNotice["severity"],
  { label: string; className: string }
> = {
  info: {
    label: "Information",
    className: "border-blue-500/50 bg-blue-500/10 text-blue-300",
  },
  warning: {
    label: "Warning",
    className: "border-amber-500/50 bg-amber-500/10 text-amber-300",
  },
  error: {
    label: "Error",
    className: "border-red-500/50 bg-red-500/10 text-red-300",
  },
};

export function NotifyUserModal({ notice }: { notice: UserNotice }) {
  const popModal = useModalStore((state) => state.popModal);
  const acknowledgementRef = useRef<HTMLButtonElement>(null);
  const treatment = SEVERITY_STYLES[notice.severity];

  return (
    <ModalShell
      title={notice.title}
      ariaLabel={notice.title}
      width="w-[60ch]"
      initialFocusRef={acknowledgementRef}
    >
      <div
        className={`inline-flex rounded border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${treatment.className}`}
        data-severity={notice.severity}
      >
        {treatment.label}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-text-primary">
        {notice.message}
      </p>
      <div className="mt-5 flex justify-end">
        <button
          ref={acknowledgementRef}
          type="button"
          onClick={popModal}
          className="rounded border border-focus-accent bg-pane-title px-3 py-1.5 text-sm font-semibold text-focus-accent"
        >
          {notice.acknowledgementLabel}
        </button>
      </div>
    </ModalShell>
  );
}
