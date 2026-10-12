import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";

it("[overhaul-581] Escape closes the epic picker before leaving the mounted Plan workspace", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  await screen.findByTestId("plan-sprint");
  const addEpic = screen.getByRole("button", { name: "Add epic" });
  fireEvent.click(addEpic);
  fireEvent.click(screen.getByRole("button", { name: /^Roadmap,/ }));
  const selected = await screen.findByRole("tab", { name: /^Roadmap,/ });
  addEpic.focus();
  fireEvent.click(addEpic);
  expect(screen.getByRole("button", { name: "+ New epic" })).toBeVisible();
  fireEvent.keyDown(addEpic, { key: "Escape" });
  expect(screen.getByTestId("plan-sprint")).toBeVisible();
  expect(selected).toHaveAttribute("aria-selected", "true");
  expect(addEpic).toHaveAttribute("aria-expanded", "false");
  expect(addEpic).toHaveFocus();

  fireEvent.click(addEpic);
  fireEvent.click(screen.getByRole("button", { name: "+ New epic" }));
  const name = screen.getByRole("textbox", { name: "New epic name" });
  fireEvent.change(name, { target: { value: "Discarded draft" } });
  fireEvent.keyDown(name, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "New epic name" })).not.toBeInTheDocument();
  expect(addEpic).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(addEpic).toHaveAttribute("aria-expanded", "false");
  expect(addEpic).toHaveFocus();
  expect(screen.getByTestId("plan-sprint")).toBeVisible();

  fireEvent.keyDown(addEpic, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Open Module Manager" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
});

it("[overhaul-582] closing the final epic focuses Add epic and keeps the Plan visit recoverable", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  await screen.findByTestId("plan-sprint");
  const addEpic = screen.getByRole("button", { name: "Add epic" });
  fireEvent.click(addEpic);
  fireEvent.click(screen.getByRole("button", { name: /^Roadmap,/ }));
  const close = screen.getByRole("button", { name: "Close Roadmap" });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole("tab", { name: /^Roadmap,/ })).not.toBeInTheDocument();
  expect(screen.getByTestId("plan-sprint")).toBeVisible();
  expect(addEpic).toHaveFocus();
  fireEvent.click(addEpic);
  fireEvent.click(screen.getByRole("button", { name: /^Roadmap,/ }));
  expect(screen.getByRole("tab", { name: /^Roadmap,/ })).toHaveAttribute("aria-selected", "true");
});
