import * as cheerio from 'cheerio'

export type PageLink = { url: string; anchor: string; inNav: boolean }
export type CleanedPage = { title: string; text: string; links: PageLink[] }

const DROP_SELECTORS = 'script, style, noscript, template, svg, iframe, form'
const NAV_ANCESTORS = 'nav, header, footer'

/**
 * Turns a fetched page into the two things the pipeline needs from it: prose to
 * read, and links to consider fetching next. Executable and presentational
 * nodes are removed before any text is taken, which is both a cleanliness and a
 * prompt-injection measure.
 */
export function cleanHtml(html: string, baseUrl: string): CleanedPage {
  const $ = cheerio.load(html ?? '')

  $(DROP_SELECTORS).remove()
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove()

  const title = $('title').first().text().trim()

  const links: PageLink[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) return
    let resolved: URL
    try {
      resolved = new URL(href, baseUrl)
    } catch {
      return
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return
    resolved.hash = ''
    const url = resolved.href
    if (seen.has(url)) return
    seen.add(url)
    links.push({
      url,
      anchor: $(element).text().replace(/\s+/g, ' ').trim(),
      inNav: $(element).closest(NAV_ANCESTORS).length > 0,
    })
  })

  const raw = $('body').length > 0 ? $('body').text() : $.root().text()
  const text = raw.replace(/\s+/g, ' ').trim()

  return { title, text, links }
}
