import { useEffect, useState } from "react";
import { useIssueStore } from "./internal/issueStore";
import { IconCheck, IconLink, IconX } from "../../../shared/ui/icons";
import { AgentStateBadge } from "../../agents/lifecycle";

interface IssueDrawerHeaderProps {
  drawerKey: string;
  close: () => void;
}

/**
 * Header component for the Issue Detail Drawer.
 * Renders drawer metadata, action links, copy link feature, and close triggers.
 */
export default function IssueDrawerHeader({ drawerKey, close }: IssueDrawerHeaderProps) {
  const openName = useIssueStore((s) => s.open?.task.name ?? null);
  const openId = useIssueStore((s) => s.open?.task.id ?? null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copyLink = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/issues/${drawerKey}`);
      setCopied(true);
    } catch {
      /* clipboard denied */
    }
  };

  return (
    <header className="flex flex-none items-center gap-3 border-b border-pane-border px-4 py-3">
      <span className="font-mono text-sm text-text-muted">{drawerKey}</span>
      {openName && (
        <span className="max-w-[280px] truncate text-sm text-text-primary">{openName}</span>
      )}
      <AgentStateBadge issueId={openId ?? ""} />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => void copyLink()}
        data-testid="copy-link"
        aria-label="Copy link to this issue"
        className="flex items-center gap-1.5 rounded-md border border-pane-border px-2.5 py-1.5 text-sm text-text-primary transition-colors hover:border-focus-accent hover:text-focus-accent"
      >
        {copied ? <IconCheck size={14} /> : <IconLink size={14} />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-pane-title hover:text-text-primary"
      >
        <IconX size={16} />
      </button>
    </header>
  );
}
