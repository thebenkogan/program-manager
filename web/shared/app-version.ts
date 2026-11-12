// A stale SPA is invisible: an open tab keeps running the bundle it booted with,
// so a deploy does not reach it until the user reloads. The server knows which
// build it is currently serving, so compare the two and say so.
//
// Pure and deterministic: callers pass filenames in, get a verdict out.

/** The entry bundle's basename, e.g. `/assets/index-C1plZ6Pp.js` -> `index-C1plZ6Pp.js`. */
export function bundleName(src: string | null | undefined): string | null {
  if (!src) return null
  const clean = src.split('?')[0].split('#')[0]
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  return name.length > 0 ? name : null
}

/**
 * True only when both names are known and differ. A server that cannot report
 * a version (missing build, older deploy) must never nag a working client.
 */
export function isStale(running: string | null, served: string | null): boolean {
  if (!running || !served) return false
  return running !== served
}
