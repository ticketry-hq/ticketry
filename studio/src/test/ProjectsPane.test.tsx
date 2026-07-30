import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost, useModalStore } from "../app/modal";
import { ApiError } from "../shared/api/client";
import { ProjectsPane } from "../features/studio/pages/projects/ProjectsPane";
import { useTasksStore } from "../features/studio/stores/tasksStore";

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  createProject: vi.fn(),
}));

import * as api from "../features/studio/lib/api";

const createProject = vi.mocked(api.createProject);

beforeEach(() => {
  createProject.mockReset();
  useModalStore.setState({ modalStack: [], activeBindings: null });
  useTasksStore.setState((state) => ({
    projects: [],
    selectedProjectId: null,
    loading: { ...state.loading, projects: false },
  }));
});

describe("ProjectsPane", () => {
  it("distinguishes an empty project list from loading", () => {
    render(<ProjectsPane />);

    expect(screen.getByText("No projects")).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();

    act(() => {
      useTasksStore.setState((state) => ({
        loading: { ...state.loading, projects: true },
      }));
    });

    expect(screen.getByText("…")).toBeInTheDocument();
    expect(screen.queryByText("No projects")).not.toBeInTheDocument();
  });

  it("always renders an anchored add affordance and opens the modal", async () => {
    const { rerender } = render(
      <>
        <ProjectsPane />
        <ModalHost />
      </>,
    );

    const emptyAdd = screen.getByRole("button", { name: "+ Add Project" });
    expect(emptyAdd).toHaveAttribute("data-coach-anchor", "project-add");
    fireEvent.click(emptyAdd);
    expect(
      await screen.findByRole("dialog", { name: "Add Project" }),
    ).toBeInTheDocument();

    act(() => {
      useModalStore.setState({ modalStack: [] });
      useTasksStore.setState({
        projects: [{ id: "existing", name: "Existing", identifier: "EX" }],
      });
    });
    rerender(
      <>
        <ProjectsPane />
        <ModalHost />
      </>,
    );

    expect(screen.getByRole("button", { name: "+ Add Project" })).toHaveAttribute(
      "data-coach-anchor",
      "project-add",
    );
  });

  it("creates through the live store and keeps a duplicate-key form editable", async () => {
    createProject.mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        detail: "Project slug 'DUP' already exists.",
      }),
    );
    createProject.mockResolvedValueOnce({
      id: "created",
      name: "Created project",
      identifier: "NEW",
    });

    render(
      <>
        <ProjectsPane />
        <ModalHost />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Project" }));

    const dialog = await screen.findByRole("dialog", { name: "Add Project" });
    const nameInput = within(dialog).getByPlaceholderText("Project name");
    const keyInput = within(dialog).getByPlaceholderText("Project key");
    expect(keyInput).toHaveAttribute("maxlength", "3");
    expect(dialog).toHaveTextContent(
      "Project key must be exactly three letters, using only A-Z.",
    );
    fireEvent.change(nameInput, { target: { value: "Created project" } });
    fireEvent.change(keyInput, { target: { value: "DUP" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("Project slug 'DUP' already exists.");
    expect(nameInput).toHaveValue("Created project");
    expect(keyInput).toHaveValue("DUP");

    fireEvent.change(keyInput, { target: { value: "NEW" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add Project" })).not.toBeInTheDocument(),
    );
    expect(createProject).toHaveBeenLastCalledWith({
      name: "Created project",
      slug: "NEW",
    });
    expect(useTasksStore.getState().projects).toEqual([
      { id: "created", name: "Created project", identifier: "NEW" },
    ]);
    expect(screen.getByText(/Created project/)).toBeInTheDocument();
  });
});
