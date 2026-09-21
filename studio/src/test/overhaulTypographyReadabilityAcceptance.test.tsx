import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("overhaul acceptance - typography readability", () => {
  it("[overhaul-160] keeps story descriptions at the terminal's 14px size", async () => {
    const [
      surfaceSource,
      tailwindConfig,
      descriptionEditor,
      richMarkdownEditor,
      ghosttyTheme,
      xtermSource,
      launchMaterializer,
      hostedCommand,
    ] =
      await Promise.all([
        readFile(`${process.cwd()}/src/app/styles/studio-surface.css`, "utf8"),
        readFile(`${process.cwd()}/tailwind.config.ts`, "utf8"),
        readFile(`${process.cwd()}/src/features/documents/DescriptionEditor.tsx`, "utf8"),
        readFile(`${process.cwd()}/src/features/documents/RichMarkdownEditor.tsx`, "utf8"),
        readFile(`${process.cwd()}/src-tauri/native/ticketry-ghostty.conf`, "utf8"),
        readFile(`${process.cwd()}/src/features/agents/terminal/internal/entryPool.ts`, "utf8"),
        readFile(
          `${process.cwd()}/src-tauri/crates/execution/ticketry-launch/src/planning/materialize.rs`,
          "utf8",
        ),
        readFile(
          `${process.cwd()}/src-tauri/crates/execution/ticketry-terminal/src/tmux_adapter/hosted_command.rs`,
          "utf8",
        ),
      ]);

    expect(surfaceSource).toMatch(
      /\.studio-surface\s*\{[^}]*font-mono[^}]*\}/s,
    );
    expect(surfaceSource).not.toMatch(
      /\.studio-surface\s*\{[^}]*font-sans[^}]*\}/s,
    );

    expect(tailwindConfig).toMatch(/base:\s*\["14px"/);
    expect(descriptionEditor).toContain("cursor-text px-2 py-1.5 text-base");
    expect(descriptionEditor).toMatch(/aria-label="Ticket description source"[\s\S]*?text-base/);
    expect(richMarkdownEditor).toMatch(/contentEditableClassName=\{`[^`]*text-base/);

    expect(ghosttyTheme).toContain("foreground = #d6deeb");
    expect(ghosttyTheme).toContain("font-family = Menlo");
    expect(ghosttyTheme).toContain("font-size = 14");
    expect(xtermSource).toContain("fontSize: 14");
    expect(ghosttyTheme).toContain("font-thicken = true");
    expect(ghosttyTheme).toContain("faint-opacity = 1");
    expect(ghosttyTheme).toContain("minimum-contrast = 4.5");
    for (let index = 0; index < 16; index += 1) {
      expect(ghosttyTheme).toContain(`palette = ${index}=#`);
    }
    expect(launchMaterializer).toContain('(\"COLORTERM\".to_owned(), \"truecolor\".to_owned())');
    expect(launchMaterializer).toContain('(\"FORCE_COLOR\".to_owned(), \"1\".to_owned())');
    expect(hostedCommand).toContain('OsString::from("NO_COLOR")');
  });
});
