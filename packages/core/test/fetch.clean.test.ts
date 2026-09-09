import { describe, expect, it } from 'vitest'
import { cleanHtml } from '../src/fetch/clean.js'

const html = `
<html>
  <head><title>Acme — Careers</title><style>body{color:red}</style></head>
  <body>
    <nav><a href="/about">About us</a><a href="/careers">Careers</a></nav>
    <script>window.tracking = true</script>
    <main>
      <h1>Work at Acme</h1>
      <p>We build   routing software.</p>
      <!-- ignore me -->
      <p>Our interview process has four stages.</p>
      <a href="hiring/process">Our hiring process</a>
      <a href="https://twitter.com/acme">Twitter</a>
      <a href="mailto:jobs@acme.test">Email us</a>
    </main>
  </body>
</html>`

describe('cleanHtml', () => {
  it('extracts the title', () => {
    expect(cleanHtml(html, 'https://acme.test/careers').title).toBe('Acme — Careers')
  })

  it('keeps visible prose and collapses whitespace', () => {
    const { text } = cleanHtml(html, 'https://acme.test/careers')
    expect(text).toContain('We build routing software.')
    expect(text).toContain('Our interview process has four stages.')
  })

  it('drops script, style and comment content', () => {
    const { text } = cleanHtml(html, 'https://acme.test/careers')
    expect(text).not.toContain('window.tracking')
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('ignore me')
  })

  it('resolves relative links against the base url', () => {
    const { links } = cleanHtml(html, 'https://acme.test/careers')
    const hrefs = links.map((l) => l.url)
    expect(hrefs).toContain('https://acme.test/hiring/process')
    expect(hrefs).toContain('https://acme.test/about')
  })

  it('records the anchor text and whether the link sat in navigation', () => {
    const { links } = cleanHtml(html, 'https://acme.test/careers')
    const about = links.find((l) => l.url === 'https://acme.test/about')
    expect(about?.anchor).toBe('About us')
    expect(about?.inNav).toBe(true)
    const hiring = links.find((l) => l.url === 'https://acme.test/hiring/process')
    expect(hiring?.inNav).toBe(false)
  })

  it('drops non-http links', () => {
    const { links } = cleanHtml(html, 'https://acme.test/careers')
    expect(links.some((l) => l.url.startsWith('mailto:'))).toBe(false)
  })

  it('deduplicates repeated links', () => {
    const repeated = '<a href="/x">X</a><a href="/x">X again</a>'
    const { links } = cleanHtml(repeated, 'https://acme.test/')
    expect(links.filter((l) => l.url === 'https://acme.test/x')).toHaveLength(1)
  })

  it('survives empty and malformed html', () => {
    expect(cleanHtml('', 'https://acme.test/').text).toBe('')
    expect(() => cleanHtml('<p>unclosed', 'https://acme.test/')).not.toThrow()
  })
})
