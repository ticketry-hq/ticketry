import { useState } from "react";

// Throwaway CODING-1328 prototype. Variant C tests a chronological hierarchy
// instead of a flat chat list or attention-first inbox.
type ConversationStatus =
  | "active"
  | "needs-input"
  | "resumable"
  | "terminated"
  | "killed";
type ConversationKind = "plan" | "instant" | "task-bound";
type TimelineGroup = "now" | "today" | "previous";

interface MockConversation {
  id: string;
  title: string;
  preview: string;
  status: ConversationStatus;
  kind: ConversationKind;
  group: TimelineGroup;
  time: string;
  task?: string;
}

const VISIBLE_LIMIT = 10;

const INITIAL_CONVERSATIONS: MockConversation[] = [
  { id: "c1", title: "Conversation hierarchy", preview: "Which statuses belong in the first group?", status: "needs-input", kind: "task-bound", group: "now", time: "Now", task: "CODING-1328" },
  { id: "c2", title: "Timeline direction", preview: "Comparing the grouped timeline against the list.", status: "active", kind: "instant", group: "now", time: "2m" },
  { id: "c3", title: "Migration review", preview: "Checking the generated Seaography contract.", status: "active", kind: "plan", group: "now", time: "8m" },
  { id: "c4", title: "Renderer diagnosis", preview: "Session is dormant and can be terminated.", status: "resumable", kind: "task-bound", group: "now", time: "24m", task: "CODIN-1514" },
  { id: "c5", title: "Acceptance coverage", preview: "Writing the next overhaul scenario.", status: "active", kind: "task-bound", group: "now", time: "31m", task: "CODING-1328" },
  { id: "c6", title: "Workspace restoration", preview: "Exact terminal selection verified.", status: "terminated", kind: "instant", group: "today", time: "11:42" },
  { id: "c7", title: "Module filter plan", preview: "Outlined the module-scoped query changes.", status: "terminated", kind: "plan", group: "today", time: "10:18" },
  { id: "c8", title: "Old terminal cleanup", preview: "The host killed the terminal process.", status: "killed", kind: "instant", group: "today", time: "09:51" },
  { id: "c9", title: "Launch regression", preview: "Traced the failing launch state transition.", status: "terminated", kind: "task-bound", group: "today", time: "08:27", task: "CODING-1374" },
  { id: "c10", title: "Release notes", preview: "Captured the desktop renderer changes.", status: "terminated", kind: "task-bound", group: "previous", time: "Yesterday", task: "CODIN-1514" },
  { id: "c11", title: "Provider badges", preview: "Agent process exited before completion.", status: "killed", kind: "plan", group: "previous", time: "Mon" },
  { id: "c12", title: "Terminal fallback", preview: "Compared native and webview behavior.", status: "terminated", kind: "instant", group: "previous", time: "Sun" },
  { id: "c13", title: "Data migration", preview: "Worker was stopped during the audit.", status: "killed", kind: "task-bound", group: "previous", time: "Sat", task: "CODING-1361" },
];

const GROUPS: ReadonlyArray<{ key: TimelineGroup; label: string; hint: string }> = [
  { key: "now", label: "Live now", hint: "Running, waiting, or resumable" },
  { key: "today", label: "Earlier today", hint: "Completed activity" },
  { key: "previous", label: "Previous days", hint: "Recent history" },
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  active: "Active",
  "needs-input": "Needs input",
  resumable: "Resumable",
  terminated: "Terminated",
  killed: "Killed",
};

const STATUS_CLASS: Record<ConversationStatus, string> = {
  active: "border-lifecycle-active/60 text-lifecycle-active",
  "needs-input": "border-lifecycle-attention/70 bg-lifecycle-attention/10 text-lifecycle-attention",
  resumable: "border-lifecycle-idle/70 text-lifecycle-idle",
  terminated: "border-pane-border text-text-muted",
  killed: "border-lifecycle-danger/60 text-lifecycle-danger",
};

const DOT_CLASS: Record<ConversationStatus, string> = {
  active: "border-lifecycle-active bg-lifecycle-active",
  "needs-input": "border-lifecycle-attention bg-pane-bg",
  resumable: "border-lifecycle-idle bg-pane-bg",
  terminated: "border-text-muted bg-pane-bg",
  killed: "border-lifecycle-danger bg-lifecycle-danger",
};

const KIND_LABEL: Record<ConversationKind, string> = {
  plan: "Plan",
  instant: "Instant",
  "task-bound": "Task-bound",
};

function isTerminable(status: ConversationStatus): boolean {
  return status === "active" || status === "needs-input" || status === "resumable";
}

export function ConversationTimelineVariant() {
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState(INITIAL_CONVERSATIONS[0].id);

  const visibleConversations = showAll
    ? conversations
    : conversations.slice(0, VISIBLE_LIMIT);
  const liveCount = conversations.filter((conversation) =>
    isTerminable(conversation.status),
  ).length;

  const startChat = () => {
    const id = `new-${conversations.length + 1}`;
    setConversations((current) => [
      {
        id,
        title: "Untitled chat",
        preview: "New Instant conversation",
        status: "active",
        kind: "instant",
        group: "now",
        time: "Now",
      },
      ...current,
    ]);
    setSelectedId(id);
  };

  const terminate = (id: string) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === id
        ? { ...conversation, status: "terminated", group: "today", time: "Just ended" }
        : conversation
    ));
  };

  return (
    <section
      aria-label="Chat timeline prototype"
      className="flex min-h-0 flex-1 flex-col bg-pane-panel text-text-primary"
    >
      <header className="border-b border-pane-border bg-pane-title px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold">Chats</h2>
              <span className="font-mono text-xs text-text-muted">
                {liveCount} live / {conversations.length} total
              </span>
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">
              Follow work from the current moment back through recent history.
            </p>
          </div>
          <button
            type="button"
            onClick={startChat}
            className="shrink-0 border border-focus-accent bg-focus-accent px-3 py-1.5 text-sm font-semibold text-pane-bg hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent"
          >
            + New chat
          </button>
        </div>
      </header>

      <div className="hide-scrollbars min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {GROUPS.map((group) => {
          const entries = visibleConversations.filter(
            (conversation) => conversation.group === group.key,
          );
          if (entries.length === 0) return null;

          return (
            <section key={group.key} aria-labelledby={`timeline-${group.key}`}>
              <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-pane-border bg-pane-panel/95 py-2 backdrop-blur-sm">
                <h3
                  id={`timeline-${group.key}`}
                  className="text-xs font-semibold uppercase tracking-wide text-text-secondary"
                >
                  {group.label}
                </h3>
                <span className="text-xs text-text-muted">{group.hint}</span>
              </div>

              <ol className="relative ml-2 border-l border-pane-border py-1">
                {entries.map((conversation) => {
                  const selected = selectedId === conversation.id;
                  return (
                    <li
                      key={conversation.id}
                      data-testid="prototype-chat"
                      className="group relative pl-4"
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[5px] top-4 size-2 border ${DOT_CLASS[conversation.status]}`}
                      />
                      <div
                        className={`flex min-w-0 items-start border-b border-pane-border/70 ${
                          selected ? "bg-selection-bg" : "hover:bg-pane-title"
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSelectedId(conversation.id)}
                          className="min-w-0 flex-1 px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent"
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-medium">
                              {conversation.title}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-text-muted">
                              {conversation.time}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-text-muted">
                            {conversation.preview}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className={`border px-1.5 py-0.5 text-xs ${STATUS_CLASS[conversation.status]}`}>
                              {STATUS_LABEL[conversation.status]}
                            </span>
                            <span className="border border-pane-border px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                              {KIND_LABEL[conversation.kind]}
                            </span>
                            {conversation.task ? (
                              <span className="font-mono text-xs text-focus-accent">
                                {conversation.task}
                              </span>
                            ) : null}
                          </span>
                        </button>

                        {isTerminable(conversation.status) ? (
                          <button
                            type="button"
                            aria-label={`Terminate ${conversation.title}`}
                            title="Terminate"
                            onClick={() => terminate(conversation.id)}
                            className="mr-1 mt-2 shrink-0 border border-transparent px-2 py-1 text-xs text-text-muted opacity-0 hover:border-lifecycle-danger/60 hover:text-lifecycle-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lifecycle-danger group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            Terminate
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {conversations.length > VISIBLE_LIMIT ? (
        <div className="border-t border-pane-border bg-pane-title px-3 py-2 text-center">
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
            className="font-mono text-xs text-focus-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent"
          >
            {showAll
              ? "Hide"
              : `See all ${conversations.length} chats`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
