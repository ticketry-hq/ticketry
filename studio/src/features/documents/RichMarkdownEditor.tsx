import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@mdxeditor/editor/style.css";
import "./richMarkdownEditor.css";
import { codeMirrorDarkExtensions } from "./codeMirrorDarkTheme";
import { observeEnabledRichTextEditable } from "./richMarkdownEditorReadiness";

export default function RichMarkdownEditor({
  markdown,
  onChange,
  onParseError,
  onEditableReady,
  onTrustedFocus,
  onTrustedInput,
  layout = "document",
  toolbarActions,
  quietUntilFocused = false,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onParseError: (source: string) => void;
  /** Reports that MDXEditor exposed an enabled contenteditable element. */
  onEditableReady?: () => void;
  /** Observational only: focus can be programmatic; input is filtered to trusted events. */
  onTrustedFocus?: () => void;
  onTrustedInput?: () => void;
  layout?: "document" | "compact";
  /** Rendered at the trailing end of the toolbar, e.g. Save/Cancel. */
  toolbarActions?: ReactNode;
  /** Hide the frame and toolbar until focus enters, so it reads like rendered text. */
  quietUntilFocused?: boolean;
}) {
  const compact = layout === "compact";
  const shellRef = useRef<HTMLDivElement>(null);
  // MDXEditor captures toolbarContents once, so actions are portaled into a
  // slot it renders; they then re-render with this component's props.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !onEditableReady || !shellRef.current) return;
    return observeEnabledRichTextEditable(shellRef.current, onEditableReady);
  }, [onEditableReady]);

  return (
    <div
      ref={shellRef}
      className={`${compact ? "min-h-[12rem]" : "min-h-[60vh]"} border ${
        quietUntilFocused
          ? "group border-transparent focus-within:border-pane-border focus-within:bg-pane-panel"
          : "border-pane-border bg-pane-panel"
      }`}
      data-testid="rich-markdown-editor-shell"
      onFocusCapture={(event) => {
        if (event.nativeEvent.isTrusted && event.target instanceof HTMLElement && event.target.isContentEditable) {
          onTrustedFocus?.();
        }
      }}
      onInputCapture={(event) => {
        if (event.nativeEvent.isTrusted && event.target instanceof HTMLElement && event.target.isContentEditable) {
          onTrustedInput?.();
        }
      }}
    >
      <MDXEditor
        className="dark-theme"
        markdown={markdown}
        // MDXEditor reports its own normalization of the initial Markdown as a
        // change; only edits count.
        onChange={(value, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) onChange(value);
        }}
        onError={({ source }) => onParseError(source)}
        contentEditableClassName={`prose prose-invert mx-auto max-w-none text-base focus:outline-none ${
          compact
            ? "min-h-[10rem] px-3 py-3"
            : "min-h-[55vh] px-8 py-10"
        }`}
        plugins={[
          headingsPlugin(),
          quotePlugin(),
          listsPlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin(),
          tablePlugin(),
          frontmatterPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
          codeMirrorPlugin({
            codeMirrorExtensions: codeMirrorDarkExtensions,
            codeBlockLanguages: {
              text: "Plain text",
              bash: "Bash",
              css: "CSS",
              html: "HTML",
              javascript: "JavaScript",
              json: "JSON",
              markdown: "Markdown",
              python: "Python",
              typescript: "TypeScript",
            },
          }),
          diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: markdown }),
          toolbarPlugin({
            toolbarClassName: `sticky top-0 z-10 border-b border-pane-border bg-pane-title ${
              quietUntilFocused
                ? "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                : ""
            }`,
            toolbarContents: () => (
              <>
              <DiffSourceToggleWrapper options={["rich-text", "source"]}>
                <UndoRedo />
                <Separator />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles />
                <StrikeThroughSupSubToggles options={["Strikethrough"]} />
                <CodeToggle />
                <Separator />
                <ListsToggle options={["bullet", "number", "check"]} />
                <CreateLink />
                <InsertImage />
                <InsertTable />
                <InsertThematicBreak />
                <InsertCodeBlock />
              </DiffSourceToggleWrapper>
              <div ref={setActionsSlot} className="ml-2 flex items-center" />
              </>
            ),
          }),
        ]}
      />
      {actionsSlot && toolbarActions && createPortal(toolbarActions, actionsSlot)}
    </div>
  );
}
