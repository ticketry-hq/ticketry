import { agentApiUrl } from "../../runtime";

export function documentUrl(docId: string, relPath: string): string {
  const encodedPath = relPath.split("/").map(encodeURIComponent).join("/");
  return agentApiUrl(`/api/docs/${encodeURIComponent(docId)}/${encodedPath}`);
}
