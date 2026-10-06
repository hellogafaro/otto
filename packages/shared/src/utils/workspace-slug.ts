/**
 * Browser-safe workspace slug extraction (no Node.js dependencies).
 *
 * Use this module in renderer/browser contexts. For Node.js contexts that need
 * plugin manifest reading, use ./workspace.ts instead.
 */

/**
 * Extract workspace slug from a path (browser-safe, no filesystem access).
 *
 * Returns the last path component, or the fallback ID if the path has no components.
 */
export function extractWorkspaceSlugFromPath(rootPath: string, fallbackId: string): string {
  const pathParts = rootPath.split(/[\\/]/).filter(Boolean);
  return pathParts[pathParts.length - 1] || fallbackId;
}

/**
 * First URL segments the servers and the app own (`/{slug}/chats` is the app's URL scheme), so a
 * workspace slug can never be one of them. See docs/routing.md.
 */
const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  'assets', 'api', 'ws', 'login', 'health', 'index.html', 'manifest.json',
])

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.has(slug) || slug.startsWith('favicon.')
}
