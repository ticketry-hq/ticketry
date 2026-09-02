import { useMemo, useState } from "react";

type ConversationStatus =
  | "active"
  | "needs-input"
  | "resumable"
  | "terminated"
  | "killed";

type ConversationKind = "plan" | "instant" | "task-bound";

interface MockConversation {
  id: string;
  title: string;
  preview: string;
  time: string;
  status: ConversationStatus;
  kind: ConversationKind;
  ephemeral: boolean;
}

const STATUS_PRESENTATION: Record<
  ConversationStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  active: {
    label: "Active",
    dotClass: "bg-lifecycle-active",
    textClass: "text-lifecycle-active",
  },
  "needs-input": {
    label: "Needs input",
    dotClass: "bg-lifecycle-attention",
    textClass: "text-lifecycle-attention",
  },
  resumable: {
    label: "Resumable",
    dotClass: "bg-lifecycle-idle",
    textClass: "text-lifecycle-idle",
  },
  terminated: {
    label: "Terminated",
    dotClass: "bg-text-muted",
    textClass: "text-text-muted",
  },
  killed: {
    label: "Killed",
    dotClass: "bg-lifecycle-danger",
    textClass: "text-lifecycle-danger",
  },
};

const KIND_LABEL: Record<ConversationKind, string> = {
  plan: "Plan",
  instant: "Instant",
  "task-bound": "Task-bound",
};

const INITIAL_CONVERSATIONS: MockConversation[] = [
  {
    id: "chat-1",
    title: "Conversations redesign",
    preview: "Comparing a familiar chat list with the current Stories pane.",
    time: "Now",
    status: "active",
    kind: "instant",
    ephemeral: true,
  },
  {
    id: "chat-2",
    title: "Release checklist",
    preview: "Which acceptance suite should I run before packaging?",
    time: "2m",
    status: "needs-input",
    kind: "task-bound",
    ephemeral: false,
  },
  {
    id: "chat-3",
    title: "Terminal recovery plan",
    preview: "Drafted the recovery states and failure boundaries.",
    time: "18m",
    status: "resumable",
    kind: "plan",
    ephemeral: true,
  },
  {
    id: "chat-4",
    title: "Fix module ordering",
    preview: "The reorder acceptance case now passes.",
    time: "41m",
    status: "terminated",
    kind: "task-bound",
    ephemeral: false,
  },
  {
    id: "chat-5",
    title: "Explore empty states",
    preview: "Run stopped before producing a final direction.",
    time: "1h",
    status: "killed",
    kind: "instant",
    ephemeral: true,
  },
  {
    id: "chat-6",
    title: "GraphQL contract audit",
    preview: "Checking restricted mutations against generated CRUD.",
    time: "1h",
    status: "active",
    kind: "task-bound",
    ephemeral: false,
  },
  {
    id: "chat-7",
    title: "Onboarding copy",
    preview: "I need a decision on the first-run heading.",
    time: "2h",
    status: "needs-input",
    kind: "instant",
    ephemeral: true,
  },
  {
    id: "chat-8",
    title: "Workspace navigation",
    preview: "Mapped selection restore across modules and tasks.",
    time: "3h",
    status: "resumable",
    kind: "plan",
    ephemeral: true,
  },
  {
    id: "chat-9",
    title: "Search keyboard flow",
    preview: "Arrow-key navigation is ready for review.",
    time: "Yesterday",
    status: "terminated",
    kind: "instant",
    ephemeral: true,
  },
  {
    id: "chat-10",
    title: "Investigate stale sessions",
    preview: "The host ended while the diagnostic run was attached.",
    time: "Yesterday",
    status: "killed",
    kind: "task-bound",
    ephemeral: false,
  },
  {
    id: "chat-11",
    title: "Agent settings cleanup",
    preview: "Grouped provider defaults by launch stage.",
    time: "Mon",
    status: "resumable",
    kind: "plan",
    ephemeral: true,
  },
  {
    id: "chat-12",
    title: "Dependency labels",
    preview: "Waiting for the final label set before implementation.",
    time: "Sun",
    status: "needs-input",
    kind: "task-bound",
    ephemeral: false,
  },
];

const VISIBLE_LIMIT = 10;

function ChatGlyph() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-4 w-5 border border-current after:absolute after:-bottom-1 after:left-0.5 after:h-1.5 after:w-1.5 after:border-b after:border-l after:border-current after:bg-inherit"
    />
  );
}

/** Throwaway CODING-1328 Variant A: a conventional, status-rich chat list. */
export function ConversationListVariant() {
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState(INITIAL_CONVERSATIONS[0].id);
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const visibleConversations = useMemo(
    () => showAll ? conversations : conversations.slice(0, VISIBLE_LIMIT),
    [conversations, showAll],
  );

  const terminate = (id: string) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === id
        ? {
            ...conversation,
            status: "terminated",
            preview: "This ephemeral chat was terminated.",
            time: "Now",
          }
        : conversation
    ));
  };

  return (
    <section
      aria-label="Chat list prototype"
      className="flex min-h-0 flex-1 flex-col bg-pane-panel text-text-primary"
    >
      <header className="flex items-center border-b border-pane-border bg-pane-title px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Chats</h2>
            <span className="font-mono text-xs text-text-muted">
              {conversations.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            Agent conversations in this module
          </p>
        </div>
      </header>

      <div className="border-b border-pane-border p-2">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 border border-focus-accent bg-focus-accent px-3 py-2 text-sm font-semibold text-pane-bg outline-none hover:brightness-110 focus-visible:ring-1 focus-visible:ring-focus-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pane-bg"
        >
          <span aria-hidden="true" className="text-md leading-none">+</span>
          New chat
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Chats">
        {visibleConversations.map((conversation) => {
          const status = STATUS_PRESENTATION[conversation.status];
          const selected = conversation.id === selectedId;
          const canTerminate = conversation.ephemeral && (
            conversation.status === "active" ||
            conversation.status === "needs-input"
          );

          return (
            <li
              key={conversation.id}
              data-testid="prototype-chat"
              className={`group relative border-b border-pane-border/70 ${
                selected ? "bg-selection-bg" : "hover:bg-pane-title"
              }`}
            >
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => setSelectedId(conversation.id)}
                className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-2 px-3 py-2.5 pr-10 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent"
              >
                <span
                  className={`mt-0.5 grid h-7 w-7 place-items-center border ${
                    selected
                      ? "border-focus-accent bg-pane-bg text-focus-accent"
                      : "border-pane-border bg-pane-bg text-text-muted"
                  }`}
                >
                  <ChatGlyph />
                </span>

                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-text-muted">
                      {conversation.time}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">
                    {conversation.preview}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs">
                    <span className={`inline-flex items-center gap-1 ${status.textClass}`}>
                      <span className={`h-1.5 w-1.5 ${status.dotClass}`} aria-hidden="true" />
                      {status.label}
                    </span>
                    <span className="text-text-muted" aria-hidden="true">·</span>
                    <span className="text-text-secondary">
                      {KIND_LABEL[conversation.kind]}
                    </span>
                  </span>
                </span>
              </button>

              {canTerminate ? (
                <button
                  type="button"
                  aria-label={`Terminate ephemeral chat ${conversation.title}`}
                  title="Terminate ephemeral chat"
                  onClick={() => terminate(conversation.id)}
                  className="absolute bottom-2.5 right-2 grid h-6 w-6 place-items-center border border-transparent text-xs text-text-muted opacity-0 outline-none hover:border-lifecycle-danger/60 hover:bg-pane-bg hover:text-lifecycle-danger focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-lifecycle-danger group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  ■
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {conversations.length > VISIBLE_LIMIT ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
          className="flex w-full items-center justify-center gap-1 border-t border-pane-border bg-pane-title px-3 py-2 text-xs font-medium text-focus-accent outline-none hover:bg-selection-bg focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent"
        >
          {showAll ? "Hide" : `See all ${conversations.length} chats`}
          <span aria-hidden="true">{showAll ? "↑" : "↓"}</span>
        </button>
      ) : null}
    </section>
  );
}
