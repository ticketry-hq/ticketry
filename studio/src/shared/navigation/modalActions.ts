/** Shared action identities; the application registry owns their effective bindings. */
export const MODAL_ACTIONS = {
  close: "modal.close",
  next: "modal.next",
  previous: "modal.previous",
  confirm: "modal.confirm",
  submit: "modal.submit",
} as const;
