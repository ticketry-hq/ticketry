import { usePushPreview } from "../queries";
import type { CheckoutRef, PushPreview } from "../types";
import { actionFailureMessage } from "./actionPresentation";

/**
 * The one confirmation before anything leaves the machine (CODING-961 HLD).
 *
 * It shows three facts and no more: the branch, the remote, and how many
 * commits the push would publish. There is deliberately no generated commit
 * text here — not hidden behind a disclosure, but absent, because the message
 * is written inside the action after this point. Nothing shown here can
 * therefore disagree with what gets committed. The same is true of the pull
 * request: `opensPullRequest` changes what the confirmation *says will happen*,
 * never what it shows of the text, because that text does not exist yet either.
 *
 * A blocked checkout renders the reason in place of the count and offers no
 * confirm button. That is the same read answering a different question, which
 * is why being unable to push is data on the preview rather than an error.
 */
export function PushConfirmation({
  checkout,
  opensPullRequest,
  onConfirm,
  onCancel,
}: {
  checkout: CheckoutRef;
  /** Whether the action being confirmed goes on to open a pull request. */
  opensPullRequest: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const preview = usePushPreview(checkout, true);

  return (
    <section
      data-testid="push-confirmation"
      data-state={preview.data?.state ?? "loading"}
      data-opens-pull-request={opensPullRequest}
      aria-label={opensPullRequest ? "Confirm push and pull request" : "Confirm push"}
      className="mt-2 border border-pane-border px-2 py-2"
    >
      {preview.isLoading && (
        <p className="text-xs text-text-muted">Checking the remote…</p>
      )}

      {preview.isError && (
        <p
          data-testid="push-confirmation-failure"
          role="alert"
          className="text-xs text-lifecycle-danger"
        >
          {actionFailureMessage(preview.error)}
        </p>
      )}

      {preview.data && (
        <PreviewBody
          preview={preview.data}
          opensPullRequest={opensPullRequest}
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        {preview.data?.state === "ready" && (
          <button
            type="button"
            onClick={onConfirm}
            className="border border-pane-border px-2 py-1 text-xs text-text-primary hover:bg-pane-title"
          >
            {opensPullRequest
              ? `Push to ${preview.data.remote} & create PR`
              : `Push to ${preview.data.remote}`}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="border border-pane-border px-2 py-1 text-xs text-text-secondary hover:bg-pane-title"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function PreviewBody({
  preview,
  opensPullRequest,
}: {
  preview: PushPreview;
  opensPullRequest: boolean;
}) {
  if (preview.state !== "ready") {
    return (
      <>
        <Facts preview={preview} />
        <p
          data-testid="push-confirmation-blocked"
          role="alert"
          className="mt-1 text-xs text-lifecycle-attention"
        >
          {preview.detail}
        </p>
      </>
    );
  }

  const commits = preview.commit_count;
  return (
    <>
      <Facts preview={preview} />
      <p data-testid="push-confirmation-summary" className="mt-1 text-xs text-text-secondary">
        {`This will push ${commits} ${commits === 1 ? "commit" : "commits"} to ${
          preview.remote
        }/${preview.branch}.`}
        {preview.dirty
          ? " One of them is the commit this action is about to make."
          : ""}
      </p>
      {opensPullRequest && (
        <p
          data-testid="push-confirmation-pull-request"
          className="mt-1 text-xs text-text-secondary"
        >
          A pull request will then be opened with your own gh login and shown in
          your browser.
        </p>
      )}
      <p className="mt-1 text-xs text-text-muted">
        Push never forces, and never merges or rebases for you.
      </p>
    </>
  );
}

/** Branch and remote, side by side, whatever the state turns out to be. */
function Facts({ preview }: { preview: PushPreview }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      <div className="flex gap-1">
        <dt className="text-text-muted">Branch</dt>
        <dd
          data-testid="push-confirmation-branch"
          className="font-mono text-text-primary"
        >
          {preview.branch || "— none —"}
        </dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-text-muted">Remote</dt>
        <dd
          data-testid="push-confirmation-remote"
          className="font-mono text-text-primary"
        >
          {preview.remote ?? "— none —"}
        </dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-text-muted">Commits</dt>
        <dd
          data-testid="push-confirmation-commits"
          className="font-mono text-text-primary"
        >
          {preview.commit_count}
        </dd>
      </div>
    </dl>
  );
}
