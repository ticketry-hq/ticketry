import { useMemo, useState } from "react";

type ConversationStatus =
  | "active"
  | "needs-input"
  | "resumable"
  | "terminated"
  | "killed";

type ConversationKind = "plan" | "instant" | "task-bound";

interface PrototypeConversation {
  id: string;
  title: string;
  preview: string;
  status: ConversationStatus;
  kind: ConversationKind;
  updatedAt: string;
  task?: string;
}

const MOCK_CONVERSATIONS: PrototypeConversation[] = [
  {
    id: "chat-1",
    title: "Untangle the release failure",
    preview: "I need your choice between the safe rollback and the manifest fix.",
    status: "needs-input",
    kind: "task-bound",
    task: "CODING-1376",
    updatedAt: "now",
  },
  {
    id: "chat-2",
    title: "Conversations redesign",
    preview: "Comparing an inbox hierarchy with the current Stories tree.",
    status: "active",
    kind: "plan",
    task: "CODING-1328",
    updatedAt: "2m",
  },
  {
    id: "chat-3",
    title: "Ghostty frame recovery",
    preview: "Acceptance checks are running against the wasm fallback.",
    status: "active",
    kind: "task-bound",
    task: "CODING-1514",
    updatedAt: "5m",
  },
  {
    id: "chat-4",
    title: "Quick architecture question",
    preview: "Stopped after mapping the cache ownership boundary.",
    status: "resumable",
    kind: "instant",
    updatedAt: "28m",
  },
  {
    id: "chat-5",
    title: "Workflow transition audit",
    preview: "The review notes are ready in the work item.",
    status: "terminated",
    kind: "plan",
    task: "CODING-1359",
    updatedAt: "1h",
  },
  {
    id: "chat-6",
    title: "Explore compact task rows",
    preview: "Compared identifier-first and title-first density.",
    status: "killed",
    kind: "instant",
    updatedAt: "3h",
  },
  {
    id: "chat-7",
    title: "GraphQL mutation naming",
    preview: "Settled on the restricted model-shaped update seam.",
    status: "terminated",
    kind: "task-bound",
    task: "CODING-1342",
    updatedAt: "Yesterday",
  },
  {
    id: "chat-8",
    title: "Terminal keyboard routing",
    preview: "Paused with two shortcuts left to verify.",
    status: "resumable",
    kind: "task-bound",
    task: "CODING-1321",
    updatedAt: "Yesterday",
  },
  {
    id: "chat-9",
    title: "Onboarding copy pass",
    preview: "Copy review finished without implementation changes.",
    status: "terminated",
    kind: "instant",
    updatedAt: "Mon",
  },
  {
    id: "chat-10",
    title: "Module tree drag target",
    preview: "The pointer seam now matches the ranked destination.",
    status: "terminated",
    kind: "task-bound",
    task: "CODING-1298",
    updatedAt: "Mon",
  },
  {
    id: "chat-11",
    title: "Provider setup notes",
    preview: "Discarded after the local provider was removed.",
    status: "killed",
    kind: "plan",
    updatedAt: "Fri",
  },
  {
    id: "chat-12",
    title: "Scratchpad",
    preview: "A short chat about focus behavior in narrow panes.",
    status: "terminated",
    kind: "instant",
    updatedAt: "Thu",
  },
];

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

function StatusLabel({ status }: { status: ConversationStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${presentation.textClass}`}>
      <span className={`size-1.5 ${presentation.dotClass}`} aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

interface ConversationRowProps {
  conversation: PrototypeConversation;
  selected: boolean;
  prominent?: boolean;
  onSelect: (id: string) => void;
  onTerminate: (id: string) => void;
}

function ConversationRow({
  conversation,
  selected,
  prominent = false,
  onSelect,
  onTerminate,
}: ConversationRowProps) {
  const canTerminate =
    conversation.status === "active" ||
    conversation.status === "needs-input" ||
    conversation.status === "resumable";

  return (
    <article
      data-testid="prototype-chat"
      className={`group grid grid-cols-[3px_minmax(0,1fr)_auto] border-b border-pane-border ${
        selected ? "bg-selection-bg" : "bg-pane-panel hover:bg-pane-title"
      }`}
    >
      <span
        className={STATUS_PRESENTATION[conversation.status].dotClass}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`min-w-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent ${
          prominent ? "px-3 py-3" : "px-3 py-2.5"
        }`}
        aria-pressed={selected}
        onClick={() => onSelect(conversation.id)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">
                {conversation.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-text-muted">
                {conversation.updatedAt}
              </span>
            </span>
            <span className={`mt-0.5 block truncate text-text-secondary ${prominent ? "text-sm" : "text-xs"}`}>
              {conversation.preview}
            </span>
            <span className="mt-1.5 flex items-center gap-2">
              <StatusLabel status={conversation.status} />
              <span className="border border-pane-border bg-pane-bg px-1.5 py-0.5 font-mono text-xs text-text-muted">
                {KIND_LABEL[conversation.kind]}
              </span>
              {conversation.task ? (
                <span className="font-mono text-xs text-text-muted">
                  {conversation.task}
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
      <div className="flex items-center pr-2">
        {canTerminate ? (
          <button
            type="button"
            className="border border-transparent px-2 py-1 text-xs text-text-muted opacity-0 transition-opacity hover:border-lifecycle-danger/60 hover:text-lifecycle-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent group-hover:opacity-100"
            aria-label={`Terminate ${conversation.title}`}
            title="Terminate"
            onClick={() => onTerminate(conversation.id)}
          >
            Terminate
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * PROTOTYPE: Variant B tests an attention-first inbox hierarchy for conversations.
 * It uses local mock state and must not be promoted directly to production.
 */
export function ConversationInboxVariant() {
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [selectedId, setSelectedId] = useState(MOCK_CONVERSATIONS[0].id);
  const [showAll, setShowAll] = useState(false);

  const ordered = useMemo(() => {
    const priority: Record<ConversationStatus, number> = {
      "needs-input": 0,
      active: 1,
      resumable: 2,
      terminated: 3,
      killed: 4,
    };
    return [...conversations].sort(
      (left, right) => priority[left.status] - priority[right.status],
    );
  }, [conversations]);

  const visible = showAll ? ordered : ordered.slice(0, 10);
  const needsInput = visible.filter((item) => item.status === "needs-input");
  const active = visible.filter((item) => item.status === "active");
  const later = visible.filter(
    (item) => item.status !== "needs-input" && item.status !== "active",
  );

  const terminate = (id: string) => {
    setConversations((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId("");
  };

  const createChat = () => {
    const id = `prototype-chat-${conversations.length + 1}`;
    const next: PrototypeConversation = {
      id,
      title: "New chat",
      preview: "A blank Instant conversation, ready for a first message.",
      status: "active",
      kind: "instant",
      updatedAt: "now",
    };
    setConversations((current) => [next, ...current]);
    setSelectedId(id);
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col border-r border-pane-border bg-pane-bg text-text-primary">
      <header className="border-b border-pane-border bg-pane-title px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-md font-semibold">Chats</h2>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {conversations.length} conversations in this module
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 border border-focus-accent bg-focus-accent px-3 py-1.5 text-sm font-semibold text-pane-bg hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pane-title"
            onClick={createChat}
          >
            + New chat
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {needsInput.length > 0 ? (
          <section aria-labelledby="needs-input-heading">
            <div className="flex items-center justify-between border-b border-lifecycle-attention/40 bg-lifecycle-attention/10 px-3 py-1.5">
              <h3 id="needs-input-heading" className="text-xs font-semibold uppercase tracking-wide text-lifecycle-attention">
                Needs you
              </h3>
              <span className="font-mono text-xs text-lifecycle-attention">
                {needsInput.length}
              </span>
            </div>
            {needsInput.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                prominent
                onSelect={setSelectedId}
                onTerminate={terminate}
              />
            ))}
          </section>
        ) : null}

        {active.length > 0 ? (
          <section aria-labelledby="live-heading">
            <div className="flex items-center gap-2 border-b border-pane-border bg-pane-title px-3 py-1.5">
              <span className="size-1.5 bg-lifecycle-active" aria-hidden="true" />
              <h3 id="live-heading" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Live now
              </h3>
              <span className="ml-auto font-mono text-xs text-text-muted">
                {active.length}
              </span>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2">
              {active.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  onSelect={setSelectedId}
                  onTerminate={terminate}
                />
              ))}
            </div>
          </section>
        ) : null}

        {later.length > 0 ? (
          <section aria-labelledby="inbox-heading">
            <div className="flex items-center justify-between border-b border-pane-border bg-pane-title px-3 py-1.5">
              <h3 id="inbox-heading" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Later and history
              </h3>
              <span className="text-xs text-text-muted">Newest first</span>
            </div>
            {later.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                onSelect={setSelectedId}
                onTerminate={terminate}
              />
            ))}
          </section>
        ) : null}

        {conversations.length > 10 ? (
          <div className="border-b border-pane-border bg-pane-panel p-2">
            <button
              type="button"
              className="w-full border border-pane-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent"
              aria-expanded={showAll}
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Hide" : `See all ${conversations.length}`}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
