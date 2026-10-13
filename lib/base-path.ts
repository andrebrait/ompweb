// Next inlines this at build time; next.config.ts uses the same value.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Restrict this to application routes/assets: a POSIX workspace path also
// starts with '/', but must never be rewritten as a browser application URL.
const APPLICATION_URL = /^\/(?:api(?:[/?#]|$)|_next\/|(?:login\/?|favicon\.ico|manifest\.webmanifest|icon\.svg|icon(?:-192)?\.png|omp-web-logo\.svg|omp-web\.ico)?(?:[?#]|$))/;

/** Prefix browser URLs, not Next router/Link targets or filesystem paths. */
export function withBasePath(path: string): string {
  if (!BASE_PATH || !APPLICATION_URL.test(path)) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`) || path.startsWith(`${BASE_PATH}#`)) return path;
  // Next's default canonical URL for the mounted root has no trailing slash.
  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}
