import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openModule } from "../e2e/support";
import { MODULE, seedDemo } from "./seed";

// Playwright's recording has no pointer, so draw one that follows the mouse.
const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 40ms linear";
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; }, true);
});`;

test("product tour", async ({ page, request }) => {
  const t0 = Date.now(); // the recording starts with the test
  await seedDemo(request);
  await page.addInitScript(CURSOR);
  const marks: Record<string, number> = {};
  const mark = (name: string) => { marks[name] = (Date.now() - t0) / 1000; };
  let mouse = { x: 800, y: 450 };
  const glide = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const k = 1 - (1 - i / steps) ** 3; // ease-out
      await page.mouse.move(mouse.x + (to.x - mouse.x) * k, mouse.y + (to.y - mouse.y) * k);
      await page.waitForTimeout(12);
    }
    mouse = to;
  };
  const click = async (target: Locator) => { await glide(target); await page.waitForTimeout(150); await target.click(); };
  const type = (page: Page, text: string) => page.keyboard.type(text, { delay: 55 });

  await openModule(page, MODULE);
  await page.mouse.move(mouse.x, mouse.y);
  await page.waitForTimeout(600);

  // 1. Capture an idea.
  mark("capture");
  const idea = page.getByRole("textbox", { name: "Capture an idea" });
  await click(idea);
  await type(page, "Express checkout on product pages");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /Express checkout/ })).toBeVisible();
  await page.waitForTimeout(1200);

  // 2. Open a planned story with child tasks.
  mark("story");
  await click(page.getByRole("treeitem", { name: /Apple Pay on the payment step/ }));
  await expect(page.getByTestId("issue-name")).toContainText("Apple Pay");
  await page.waitForTimeout(800);
  await glide(page.getByText("Payment sheet UI"));
  await page.waitForTimeout(1200);

  // 3. Move it through the workflow.
  mark("state");
  const picker = page.getByTestId("state-picker");
  await click(picker.getByRole("button"));
  await page.waitForTimeout(700);
  await click(page.getByRole("button", { name: "Grill", exact: true }));
  await expect(picker).toContainText("Grill");
  await page.waitForTimeout(1200);

  // 4. Give it an isolated Git worktree.
  mark("worktree");
  const worktree = page.getByTestId("worktree-block");
  await click(worktree.getByRole("button", { name: "+ Worktree" }));
  await expect(worktree).toContainText(/wt\//, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await click(worktree.getByRole("button", { name: "Show worktree details" }));
  await expect(worktree.getByTestId("worktree-details")).toContainText("Clean");
  await page.waitForTimeout(1800);
  await page.keyboard.press("Escape");

  // 5. Terminal: neutral prompt first (trimmed from the cut), then the demo.
  await page.getByTestId("footer-terminal-toggle").click();
  const terminal = page.getByTestId("terminal-host");
  await terminal.click();
  await page.keyboard.type("PROMPT='%F{blue}storefront%f %F{magenta}❯%f '; clear\n");
  await page.waitForTimeout(800);
  await expect(terminal).not.toContainText("clear");
  mark("terminal");
  await page.waitForTimeout(500);
  await type(page, "git branch\n");
  await page.waitForTimeout(1200);
  await type(page, "bin/check\n");
  await expect(terminal).toContainText("5 passed", { timeout: 10_000 });
  await page.waitForTimeout(2000);
  mark("end");

  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../video/public/marks.json"), JSON.stringify(marks, null, 2));
});
