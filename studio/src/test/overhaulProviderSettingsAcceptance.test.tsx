import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingProviders } from "../app/onboarding/OnboardingProviders";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const providers = [
  {
    id: "provider-claude",
    slug: "claude",
    activated: true,
    supports_unattended: true,
  },
  {
    id: "provider-codex",
    slug: "codex",
    activated: true,
    supports_unattended: true,
  },
  {
    id: "provider-gemini",
    slug: "gemini",
    activated: true,
    supports_unattended: true,
  },
];

describe("provider settings acceptance", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (method === "GET" && url.endsWith("/work-tracker/providers")) {
          return jsonResponse(providers);
        }
        if (method === "GET" && url.endsWith("/work-tracker/models")) {
          return jsonResponse([
            {
              id: "model-luna",
              provider: "provider-codex",
              name: "gpt-5.6-luna",
              permitted_reasoning_levels: ["reason-medium"],
            },
          ]);
        }
        if (
          method === "GET"
          && url.endsWith("/work-tracker/reasoning-levels")
        ) {
          return jsonResponse([{ id: "reason-medium", name: "medium" }]);
        }
        if (method === "GET" && url.endsWith("/settings/provider-catalog")) {
          return jsonResponse({ value: { global_default: null } });
        }
        if (method === "PATCH" && url.includes("/work-tracker/providers/")) {
          const provider = providers.find(({ id }) => url.endsWith(id));
          return jsonResponse({
            ...provider,
            activated: JSON.parse(String(init?.body)).activated,
          });
        }
        if (method === "PUT" && url.endsWith("/settings/provider-catalog")) {
          return jsonResponse({ value: JSON.parse(String(init?.body)).value });
        }
        throw new Error(`Unexpected ${method} request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-17] saves a Luna default during fresh provider onboarding", async () => {
    const onContinue = vi.fn();
    render(
      <OnboardingProviders
        continueLabel="Get started"
        onContinue={onContinue}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "I use codex" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I use claude" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "gpt-5.6-luna" },
    });

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    await waitFor(() => {
      expect(
        within(reasoning).getByRole("option", { name: "medium" }),
      ).toBeInTheDocument();
    });
    fireEvent.change(reasoning, { target: { value: "medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    const settingsWrite = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith("/settings/provider-catalog")
      && init?.method === "PUT"
    );
    expect(JSON.parse(String(settingsWrite?.[1]?.body))).toEqual({
      value: {
        global_default: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoning: "medium",
        },
      },
    });
    expect(screen.getByRole("heading", { name: "Your agents" })).toBeVisible();
  });
});
