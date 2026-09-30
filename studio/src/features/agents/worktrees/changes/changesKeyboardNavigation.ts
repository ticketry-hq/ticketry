export const CHANGES_CHECKOUT_ACTIONS = new Set([
  "changes.checkout.previous",
  "changes.checkout.next",
  "changes.checkout.first",
  "changes.checkout.last",
  "changes.checkout.select",
  "changes.checkout.cancel",
]);

export type ChangesCheckoutAction =
  | "changes.checkout.previous"
  | "changes.checkout.next"
  | "changes.checkout.first"
  | "changes.checkout.last"
  | "changes.checkout.select"
  | "changes.checkout.cancel";

export const CHANGES_FILE_ACTIONS = new Set([
  "changes.file.previous",
  "changes.file.next",
  "changes.file.first",
  "changes.file.last",
  "changes.file.activate",
  "changes.file.expand",
  "changes.file.collapse",
]);

export type ChangesFileAction =
  | "changes.file.previous"
  | "changes.file.next"
  | "changes.file.first"
  | "changes.file.last"
  | "changes.file.activate"
  | "changes.file.expand"
  | "changes.file.collapse";
