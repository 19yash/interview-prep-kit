import { cleanHtml, type PageLink } from './clean.js'
import { fetchPage } from './fetcher.js'
import { isRobotsAllowed } from './robots.js'
import { assertFetchableUrl } from './url-guard.js'

export const MAX_PAGES_DEFAULT = 6

export type LinkKind = 'hiring' | 'about' | 'other'
export type ScoredLink = PageLink & { score: number; kind: LinkKind }
export type PipelineWarning = { step: string; source: string | null; reason: string }
export type RetrievedPage = { url: string; title: string; text: string; kind: LinkKind }
export type DiscoveryResult = { pages: RetrievedPage[]; warnings: PipelineWarning[]; rootReachable: boolean }
export type DiscoverOptions = { maxPages?: number; allowPrivate?: boolean }

/** Slug keywords are worth more than anchor keywords: authors choose slugs. */
const HIRING_KEYWORDS = [
  'hiring', 'interview', 'recruit', 'career', 'careers', 'jobs', 'job',
  'join', 'work-with-us', 'work-for-us', 'life-at', 'process', 'handbook',
]
const ABOUT_KEYWORDS = ['about', 'company', 'who-we-are', 'mission', 'team', 'culture', 'engineering', 'blog']
const NON_CONTENT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|css|js|mp4|woff2?)$/i

function slugOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  } catch {
    return ''
  }
}

function depthOf(url: string): number {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length
  } catch {
    return 9
  }
}

export function classifyLink(link: PageLink): LinkKind {
  const haystack = `${slugOf(link.url)} ${link.anchor.toLowerCase()}`
  if (HIRING_KEYWORDS.some((k) => haystack.includes(k))) return 'hiring'
  if (ABOUT_KEYWORDS.some((k) => haystack.includes(k))) return 'about'
  return 'other'
}

/**
 * A transparent additive score rather than a model call. The weights encode
 * the assumption that hiring information is what we most want, that the site
 * author's own slug is the strongest signal, and that useful pages sit near
 * the top of the tree.
 */
export function scoreLink(link: PageLink, baseUrl: string): number {
  const slug = slugOf(link.url)
  const anchor = link.anchor.toLowerCase()
  let score = 0

  for (const keyword of HIRING_KEYWORDS) {
    if (slug.includes(keyword)) score += 12
    if (anchor.includes(keyword)) score += 5
  }
  for (const keyword of ABOUT_KEYWORDS) {
    if (slug.includes(keyword)) score += 6
    if (anchor.includes(keyword)) score += 3
  }

  score -= depthOf(link.url) * 2
  if (link.inNav) score += 2
  if (link.url === baseUrl) score -= 50

  return score
}

export function rankLinks(links: PageLink[], baseUrl: string): ScoredLink[] {
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return []
  }

  return links
    .filter((link) => {
      try {
        return new URL(link.url).origin === origin && !NON_CONTENT.test(new URL(link.url).pathname)
      } catch {
        return false
      }
    })
    .map((link) => ({ ...link, score: scoreLink(link, baseUrl), kind: classifyLink(link) }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
}

/**
 * Crawls the company site: fetch the root, rank its links, fetch the best of
 * them, and follow one level deeper from a hiring page because the process
 * description often sits one click below the careers index. Every failure
 * becomes a warning and the crawl continues, because the brief requires an
 * unreachable source to be skipped and reported rather than fatal.
 */
export async function discoverPages(companyUrl: string, opts: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES_DEFAULT
  const warnings: PipelineWarning[] = []
  const pages: RetrievedPage[] = []

  let rootUrl: URL
  try {
    rootUrl = assertFetchableUrl(companyUrl, { allowPrivate: opts.allowPrivate })
  } catch (error) {
    warnings.push({ step: 'discoverPages', source: companyUrl, reason: describeError(error) })
    return { pages, warnings, rootReachable: false }
  }

  let rootCleaned
  try {
    const root = await fetchPage(rootUrl.href, { allowPrivate: opts.allowPrivate })
    rootCleaned = cleanHtml(root.html, root.finalUrl)
    pages.push({ url: rootUrl.href, title: rootCleaned.title, text: rootCleaned.text, kind: 'about' })
  } catch (error) {
    warnings.push({ step: 'discoverPages', source: rootUrl.href, reason: describeError(error) })
    return { pages, warnings, rootReachable: false }
  }

  const queue = rankLinks(rootCleaned.links, rootUrl.href).filter((link) => link.score > 0)
  const visited = new Set([rootUrl.href])
  let followedDeeper = false

  while (queue.length > 0 && pages.length < maxPages) {
    const link = queue.shift()!
    if (visited.has(link.url)) continue
    visited.add(link.url)

    if (!(await isRobotsAllowed(link.url, { allowPrivate: opts.allowPrivate }))) {
      warnings.push({ step: 'discoverPages', source: link.url, reason: 'disallowed by robots.txt' })
      continue
    }

    try {
      const fetched = await fetchPage(link.url, { allowPrivate: opts.allowPrivate })
      const cleaned = cleanHtml(fetched.html, fetched.finalUrl)
      pages.push({ url: link.url, title: cleaned.title, text: cleaned.text, kind: link.kind })

      // One level deeper, once, and only from a hiring page.
      if (link.kind === 'hiring' && !followedDeeper) {
        followedDeeper = true
        const deeper = rankLinks(cleaned.links, link.url)
          .filter((child) => child.kind === 'hiring' && child.score > 0 && !visited.has(child.url))
          .slice(0, 2)
        queue.unshift(...deeper)
      }
    } catch (error) {
      warnings.push({ step: 'discoverPages', source: link.url, reason: describeError(error) })
    }
  }

  return { pages, warnings, rootReachable: true }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
