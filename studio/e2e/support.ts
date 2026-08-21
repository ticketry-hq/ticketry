import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

export type ApiRow = {
  id: string;
  name: string;
  [key: string]: unknown;
};

export type ProjectRow = ApiRow & { slug: string };

export type ModuleRow = ApiRow & {
  key: string;
  sequence_id: number;
};

export type WorkItemRow = ApiRow & {
  key: string;
  sequence_id: number;
  issue_type: { id: string; name: string };
  state: { id: string; name: string };
};

export const CODEX_LUNA_MODEL = "gpt-5.6-luna";
export const CODEX_LUNA_REASONING = "medium";

export async function ensureCodexLunaModel(
  request: APIRequestContext,
): Promise<void> {
  const providers = await responseJson<Array<{
    id: string;
    slug: string;
  }>>(await request.get("/api/work-tracker/providers"));
  const codex = providers.find((provider) => provider.slug === "codex");
  expect(codex, "the seeded codex provider").toBeTruthy();

  const reasoningLevels = await responseJson<Array<{
    id: string;
    name: string;
  }>>(await request.get("/api/work-tracker/reasoning-levels"));
  const medium = reasoningLevels.find(
    (reasoning) => reasoning.name === CODEX_LUNA_REASONING,
  );
  expect(medium, "the seeded medium reasoning level").toBeTruthy();

  const models = await responseJson<Array<{
    id: string;
    provider: string;
    name: string;
    permitted_reasoning_levels?: string[];
  }>>(await request.get("/api/work-tracker/models"));
  const existing = models.find((model) =>
    (model.provider === codex!.id || model.provider === "codex")
    && model.name === CODEX_LUNA_MODEL
  );
  if (!existing) {
    const created = await responseJson<{
      provider: string;
      name: string;
      permitted_reasoning_levels?: string[];
    }>(await request.post("/api/work-tracker/models", {
      data: {
        provider: codex!.id,
        name: CODEX_LUNA_MODEL,
        permitted_reasoning_levels: [medium!.id],
      },
    }));
    expect(created.name).toBe(CODEX_LUNA_MODEL);
    expect(created.permitted_reasoning_levels).toContain(medium!.id);
    return;
  }

  if (!existing.permitted_reasoning_levels?.includes(medium!.id)) {
    const updated = await responseJson<{
      permitted_reasoning_levels?: string[];
    }>(await request.patch(`/api/work-tracker/models/${existing.id}`, {
      data: {
        permitted_reasoning_levels: [
          ...(existing.permitted_reasoning_levels ?? []),
          medium!.id,
        ],
      },
    }));
    expect(updated.permitted_reasoning_levels).toContain(medium!.id);
  }
}

export async function responseJson<T>(response: APIResponse): Promise<T> {
  expect(
    response.ok(),
    `${response.url()} -> ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return await response.json() as T;
}

export async function acknowledgeOnboarding(
  request: APIRequestContext,
): Promise<void> {
  await responseJson(
    await request.post("/api/work-tracker/workspace/onboarding/acknowledge"),
  );
}

/** Configure the deterministic model used by launch-surface assertions. */
export async function configureCodexDefault(
  request: APIRequestContext,
): Promise<void> {
  await ensureCodexLunaModel(request);
  const providers = await responseJson<Array<{
    id: string;
    slug: string;
    activated: boolean;
  }>>(await request.get("/api/work-tracker/providers"));
  const codex = providers.find((provider) => provider.slug === "codex");
  expect(codex, "the seeded codex provider").toBeTruthy();

  if (!codex!.activated) {
    await responseJson(await request.patch(
      `/api/work-tracker/providers/${codex!.id}`,
      { data: { activated: true } },
    ));
  }

  const saved = await responseJson<{
    value: {
      global_default: {
        provider: string;
        model: string | null;
        reasoning: string | null;
      } | null;
    };
  }>(await request.put("/api/settings/provider-catalog", {
    data: {
      value: {
        global_default: {
          provider: "codex",
          model: CODEX_LUNA_MODEL,
          reasoning: CODEX_LUNA_REASONING,
        },
      },
    },
  }));
  expect(saved.value.global_default).toEqual({
    provider: "codex",
    model: CODEX_LUNA_MODEL,
    reasoning: CODEX_LUNA_REASONING,
  });
}

export async function createWorkItem(
  request: APIRequestContext,
  projectId: string,
  body: Record<string, unknown>,
): Promise<WorkItemRow> {
  return await responseJson<WorkItemRow>(await request.post(
    `/api/work-tracker/projects/${projectId}/work-items`,
    { data: body },
  ));
}

export async function linkModuleFolder(
  request: APIRequestContext,
  moduleId: string,
  moduleFolder: string,
): Promise<void> {
  await responseJson(await request.put(`/api/module-links/${moduleId}`, {
    data: { local_path: moduleFolder },
  }));
}

export async function openModule(
  page: Page,
  moduleName: string,
): Promise<void> {
  await page.goto("/");
  // Module names are intentionally not unique. Prefer the most-recent tab so
  // a failed test's worker restart can still recover deterministically.
  const moduleTab = page.getByRole("tab", { name: moduleName }).last();
  await expect(moduleTab).toBeVisible();
  await moduleTab.click();
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

export async function openWorkItem(page: Page, name: string): Promise<void> {
  await page.getByRole("treeitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("issue-name")).toContainText(name);
}
