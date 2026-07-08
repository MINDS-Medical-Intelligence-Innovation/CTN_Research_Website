/**
 * Prefix an absolute site path with the configured BASE_PATH so links and
 * assets keep working under GitHub Pages-style project hosting
 * (astro.config.mjs sets `base: process.env.BASE_PATH || '/'`).
 *
 * Usage: withBase('/publications/') -> '/publications/' on root hosting,
 * or '/ctn-research-website/publications/' when BASE_PATH is set.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalisedPath}` || '/';
}
