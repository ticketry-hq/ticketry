export const sections: string[];
export function linkPath(link: string): string | null;
export function markdownLinks(source: string, referenceSource?: string): string[];
export function sectionBodies(source: string): Map<string, string>;
export function validStructure(source: string): boolean;
