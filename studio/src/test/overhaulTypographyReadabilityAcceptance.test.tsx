import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("overhaul acceptance - typography readability", () => {
  it("[overhaul-160] preserves the established Studio face and native terminal readability", async () => {
    const [surfaceSource, ghosttyTheme, launchMaterializer] = await Promise.all([
      readFile(`${process.cwd()}/src/app/styles/studio-surface.css`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/native/ticketry-ghostty.conf`, "utf8"),
      readFile(`${process.cwd()}/src-tauri/src/launch/planning/materialize.rs`, "utf8"),
    ]);

    expect(surfaceSource).toMatch(
      /\.studio-surface\s*\{[^}]*font-mono[^}]*\}/s,
    );
    expect(surfaceSource).not.toMatch(
      /\.studio-surface\s*\{[^}]*font-sans[^}]*\}/s,
    );

    expect(ghosttyTheme).toContain("foreground = #d6deeb");
    expect(ghosttyTheme).toContain("font-family = Menlo");
    expect(ghosttyTheme).toContain("font-size = 14");
    expect(ghosttyTheme).toContain("font-thicken = true");
    expect(ghosttyTheme).toContain("faint-opacity = 1");
    expect(ghosttyTheme).toContain("minimum-contrast = 4.5");
    for (let index = 0; index < 16; index += 1) {
      expect(ghosttyTheme).toContain(`palette = ${index}=#`);
    }
    expect(launchMaterializer).toContain('(\"COLORTERM\".to_owned(), \"truecolor\".to_owned())');
    expect(launchMaterializer).toContain('(\"FORCE_COLOR\".to_owned(), \"1\".to_owned())');
  });
});
