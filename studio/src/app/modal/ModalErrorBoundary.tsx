import { Component, type ReactNode } from "react";
import { useModalStore } from "./modalStore";

interface ModalErrorBoundaryProps {
  /** Human label of the modal being rendered, e.g. "Settings". */
  label: string;
  /** Changing this discards a previous failure (new modal, or a retry). */
  resetKey: string;
  /** Re-attempts the render; the host recreates its lazy loaders. */
  onRetry: () => void;
  children: ReactNode;
}

interface ModalErrorBoundaryState {
  error: Error | null;
  resetKey: string;
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Contains modal render and chunk-load failures. Without it a rejected lazy
 * import propagates to the React root and unmounts the whole application,
 * which reads to the user as "the app went blank" (ticket #1371).
 */
export class ModalErrorBoundary extends Component<
  ModalErrorBoundaryProps,
  ModalErrorBoundaryState
> {
  state: ModalErrorBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(thrown: unknown): { error: Error } {
    return { error: asError(thrown) };
  }

  static getDerivedStateFromProps(
    props: ModalErrorBoundaryProps,
    state: ModalErrorBoundaryState,
  ): ModalErrorBoundaryState | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  private handleClose = (): void => {
    useModalStore.getState().popModal();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div
          role="alert"
          className="w-[60ch] max-w-full border border-pane-border bg-pane-panel p-4 text-text-primary"
        >
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            {this.props.label} could not be loaded
          </h2>
          <p className="mt-3 text-sm">
            {error.message ||
              "The window failed to load. Check your connection and retry."}
          </p>
          <p className="mt-2 text-xs text-text-muted">
            This usually means the application was updated in the background or
            the network dropped. Retrying reloads the window; closing returns
            you to Studio.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={this.handleClose}
              className="border border-pane-border px-3 py-1 text-sm hover:bg-pane-title"
            >
              Close
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="border border-pane-border bg-pane-title px-3 py-1 text-sm font-semibold hover:bg-pane-panel"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
