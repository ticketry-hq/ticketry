/** A stable identity for one user intent. */
export function newOperationId(): string {
  return crypto.randomUUID();
}
