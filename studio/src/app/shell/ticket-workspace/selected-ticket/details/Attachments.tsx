import { type Attachment } from "../../../../../shared/api/types";
import { formatBytes } from "../../../../../shared/utilities/display";
import { IconPaperclip } from "../../../../../shared/ui/icons";

interface AttachmentsProps {
  attachments: Attachment[];
}

export default function Attachments({ attachments }: AttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-8" data-testid="attachments">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-text-secondary">
          Attachments
        </span>
        <span className="text-xs text-text-muted">{attachments.length}</span>
      </div>
      <div className="overflow-hidden border border-pane-border">
        {attachments.map((a) => (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="attachment-row"
            className="flex items-center gap-2.5 border-b border-pane-border/60 px-3 py-2 last:border-b-0 hover:bg-pane-title"
          >
            <IconPaperclip size={14} className="flex-none text-text-muted" />
            <span className="flex-1 truncate text-base text-text-primary">{a.filename}</span>
            <span className="flex-none font-mono text-xs text-text-muted">
              {formatBytes(a.size)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
