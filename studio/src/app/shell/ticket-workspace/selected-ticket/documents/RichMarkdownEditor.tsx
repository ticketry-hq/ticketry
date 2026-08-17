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
import "@mdxeditor/editor/style.css";
import "./richMarkdownEditor.css";
import { codeMirrorDarkExtensions } from "./codeMirrorDarkTheme";

export default function RichMarkdownEditor({
  markdown,
  onChange,
  onParseError,
  layout = "document",
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onParseError: (source: string) => void;
  layout?: "document" | "compact";
}) {
  const compact = layout === "compact";

  return (
    <div
      className={`${compact ? "min-h-[12rem]" : "min-h-[60vh]"} border border-pane-border bg-pane-panel`}
      data-testid="rich-markdown-editor-shell"
    >
      <MDXEditor
        className="dark-theme"
        markdown={markdown}
        onChange={onChange}
        onError={({ source }) => onParseError(source)}
        contentEditableClassName={`prose prose-invert mx-auto max-w-none focus:outline-none ${
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
            toolbarClassName:
              "sticky top-0 z-10 border-b border-pane-border bg-pane-title",
            toolbarContents: () => (
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
            ),
          }),
        ]}
      />
    </div>
  );
}
