import { beforeEach, describe, expect, it, vi } from "vitest";
import { docUrl as agentDocUrl } from "../../features/agents/api/agentApi";
import {
  docUrl as studioDocUrl,
  getProjects,
} from "../../features/studio/lib/api";

const fetchMock = vi.fn();

describe("runtime-routed connections", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("routes the Studio-local SDK through the WorkTracker API endpoint", async () => {
    vi.stubEnv(
      "VITE_WT_API_BASE",
      "https://tracker.example.test/work-tracker",
    );
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(getProjects()).resolves.toEqual([]);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://tracker.example.test/work-tracker/projects",
    );
  });

  it("routes document iframe URLs through the agent API endpoint", () => {
    vi.stubEnv("VITE_AGENT_API_BASE", "https://runtime.example.test/api");

    expect(agentDocUrl("doc 1", "design/HLD.html")).toBe(
      "https://runtime.example.test/api/docs/doc%201/design/HLD.html",
    );
    expect(studioDocUrl("doc 1", "design/HLD.html")).toBe(
      "https://runtime.example.test/api/docs/doc%201/design/HLD.html",
    );
  });
});
