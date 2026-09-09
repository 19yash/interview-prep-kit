import robotsParser from 'robots-parser'
import { fetchPage, USER_AGENT } from './fetcher.js'
import { assertFetchableUrl } from './url-guard.js'

type CacheEntry = { isAllowed: (url: string, agent?: string) => boolean | undefined }
const cache = new Map<string, CacheEntry | null>()

/**
 * Fetches and caches robots.txt per origin. A missing or unreadable robots.txt
 * is treated as permission granted, which is the conventional reading; a
 * present rule that disallows the path is respected.
 */
export async function isRobotsAllowed(
  targetUrl: string,
  opts: { userAgent?: string; allowPrivate?: boolean } = {},
): Promise<boolean> {
  const agent = opts.userAgent ?? USER_AGENT
  let url: URL
  try {
    url = assertFetchableUrl(targetUrl, { allowPrivate: opts.allowPrivate })
  } catch {
    return false
  }

  const origin = url.origin
  if (!cache.has(origin)) {
    try {
      const robotsUrl = new URL('/robots.txt', origin).href
      const page = await fetchPage(robotsUrl, { allowPrivate: opts.allowPrivate, maxBytes: 200_000 })
      cache.set(origin, robotsParser(robotsUrl, page.html))
    } catch {
      cache.set(origin, null)
    }
  }

  const robots = cache.get(origin)
  if (!robots) return true
  // An unknown verdict means no rule matched, which is permission.
  return robots.isAllowed(url.href, agent) !== false
}

/** Exposed for tests, which must not share cached origins between cases. */
export function clearRobotsCache(): void {
  cache.clear()
}
