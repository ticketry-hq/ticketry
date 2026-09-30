import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext } from "@playwright/test";
import {
  acknowledgeOnboarding,
  createModule,
  createWorkItem,
  getProjects,
  getWorkflowCatalog,
  selectModuleForProfile,
} from "../e2e/support";

const run = promisify(execFile);

export const MODULE = "Checkout";

// Stand-in test runner for the demo repository's terminal shot.
const CHECK_SCRIPT = `#!/bin/sh
g='\\033[32m'; d='\\033[2m'; b='\\033[1m'; r='\\033[0m'
printf "\${b}storefront\${r} checks\\n\\n"
for t in applePaySession paymentSheet merchantDomain cartSummary cardFallback; do
  sleep 0.35; printf "  \${g}✓\${r} \${t}.test.ts \${d}(\$(( (RANDOM % 80) + 12 ))ms)\${r}\\n"
done
sleep 0.3; printf "\\n  \${g}\${b}5 passed\${r} \${d}in 1.9s\${r}\\n"
`;

// Realistic-looking demo data for the product video.
const STORIES: Array<{ name: string; description: string; children?: string[] }> = [
  {
    name: "Apple Pay on the payment step",
    description:
      "## Goal\nOffer Apple Pay beside cards on Safari and iOS.\n\n- Show the button only when `canMakePayments()` is true\n- Reuse the existing order summary\n- Fall back to card entry on failure",
    children: ["Wire the Apple Pay session endpoint", "Payment sheet UI", "Merchant domain verification"],
  },
  { name: "Retry failed card charges once", description: "Retry soft declines after 2s with the same idempotency key." },
  { name: "Show delivery estimate in cart", description: "Use the carrier API estimate; hide when unavailable." },
  { name: "Guest checkout without an account", description: "Collect email only; offer account creation after purchase." },
  { name: "Promo code validation errors", description: "Explain why a code was rejected instead of a generic error." },
  { name: "Save address for next time", description: "Opt-in checkbox, stored per customer." },
];

export async function seedDemo(request: APIRequestContext): Promise<{ folder: string }> {
  const folder = await mkdtemp(join(tmpdir(), "storefront-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ticketry", GIT_AUTHOR_EMAIL: "demo@ticketry.invalid",
    GIT_COMMITTER_NAME: "Ticketry", GIT_COMMITTER_EMAIL: "demo@ticketry.invalid",
  };
  const git = (...args: string[]) => run("git", ["-C", folder, ...args], { env });
  await git("init", "-b", "main");
  await writeFile(join(folder, "README.md"), "# storefront\n");
  await git("add", ".");
  await git("commit", "-m", "Initial storefront");
  await writeFile(join(folder, "checkout.ts"), "export const provider = 'stripe';\n");
  await mkdir(join(folder, "bin"));
  await writeFile(join(folder, "bin", "check"), CHECK_SCRIPT, { mode: 0o755 });
  await git("add", ".");
  await git("commit", "-m", "Add checkout provider");

  await acknowledgeOnboarding(request);
  const project = (await getProjects(request))[0]!;
  const catalog = await getWorkflowCatalog(request, project.id);
  const types = catalog.issue_types.nodes;
  const moduleType = types.find((t) => t.level === "module" || t.name === "Module")!;
  const story = types.find((t) => t.name === "Story")!;
  const impl = types.find((t) => t.name === "Implementation")!;

  const checkout = await createModule(request, project.id, { name: MODULE, issue_type_id: moduleType.id });
  for (const other of ["Search", "Accounts", "Mobile app"]) {
    await createModule(request, project.id, { name: other, issue_type_id: moduleType.id });
  }
  await selectModuleForProfile(request, project.id, checkout.id, folder);

  for (const s of STORIES) {
    const parent = await createWorkItem(request, project.id, {
      name: s.name, description: s.description, parent_id: checkout.id, issue_type_id: story.id,
    });
    for (const child of s.children ?? []) {
      await createWorkItem(request, project.id, { name: child, parent_id: parent.id, issue_type_id: impl.id });
    }
  }
  return { folder };
}
