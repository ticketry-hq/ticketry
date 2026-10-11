/**
 * Imports a module by absolute URL, outside the bundler's static graph.
 * Kept separate so tests can stand in for the network at this boundary.
 */
export function importChunkUrl(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}
