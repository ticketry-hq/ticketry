import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useClientStore } from "../state/clientStore";
import { fixture, workItem } from "./seam";

/** Mounts the global keymap beside typing targets that must not run work. */
export function NormalRunShortcutSurface() {
  useGlobalKeymap();
  return (
    <>
      <input aria-label="Typing target" />
      <textarea
        aria-label="Prompt target"
        onKeyDown={(event) => event.preventDefault()}
      />
      <select aria-label="Select target" />
      <div aria-label="Editor target" contentEditable />
      <button
        type="button"
        onKeyDown={(event) => event.preventDefault()}
      >
        Local Cmd+Enter
      </button>
    </>
  );
}

export function hasToast(kind: "success" | "error", text: string): boolean {
  return useClientStore
    .getState()
    .toasts.some((toast) => toast.kind === kind && toast.message.includes(text));
}

/** A Story root with one nested branch and one leaf child. */
export function campaignFixture() {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["story-1"],
    children: {
      "story-1": ["branch-1"],
      "branch-1": ["child-1"],
      "child-1": [],
    },
    order: ["story-1", "branch-1", "child-1"],
  });
  http.workItems([
    workItem({
      id: "story-1",
      name: "Campaign root",
      sub_issues_count: 1,
    }),
    workItem({
      id: "branch-1",
      name: "Nested branch",
      key: "MEML-2",
      parent_id: "story-1",
      sub_issues_count: 1,
    }),
    workItem({
      id: "child-1",
      name: "Implementation child",
      key: "MEML-3",
      parent_id: "branch-1",
    }),
  ]);
  return http;
}
