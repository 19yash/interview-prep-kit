import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverPages, MAX_PAGES_DEFAULT, rankLinks, scoreLink } from '../src/fetch/discover.js'
import { clearRobotsCache } from '../src/fetch/robots.js'

describe('scoreLink and rankLinks', () => {
  const base = 'https://acme.test/'

  it('scores a hiring-process slug above an about slug', () => {
    const hiring = scoreLink({ url: 'https://acme.test/hiring-process', anchor: 'x', inNav: false }, base)
    const about = scoreLink({ url: 'https://acme.test/about', anchor: 'x', inNav: false }, base)
    expect(hiring).toBeGreaterThan(about)
  })

  it('scores an about slug above an unrelated slug', () => {
    const about = scoreLink({ url: 'https://acme.test/about', anchor: 'x', inNav: false }, base)
    const other = scoreLink({ url: 'https://acme.test/pricing', anchor: 'x', inNav: false }, base)
    expect(about).toBeGreaterThan(other)
  })

  it('credits keywords found only in the anchor text', () => {
    const anchored = scoreLink({ url: 'https://acme.test/x7', anchor: 'How we interview', inNav: false }, base)
    const bare = scoreLink({ url: 'https://acme.test/x7', anchor: 'Read more', inNav: false }, base)
    expect(anchored).toBeGreaterThan(bare)
  })

  it('prefers a shallower path when keywords are equal', () => {
    const shallow = scoreLink({ url: 'https://acme.test/careers', anchor: 'Careers', inNav: false }, base)
    const deep = scoreLink({ url: 'https://acme.test/a/b/c/careers', anchor: 'Careers', inNav: false }, base)
    expect(shallow).toBeGreaterThan(deep)
  })

  it('drops links to another origin', () => {
    const ranked = rankLinks(
      [
        { url: 'https://acme.test/careers', anchor: 'Careers', inNav: true },
        { url: 'https://twitter.com/acme', anchor: 'Twitter', inNav: true },
      ],
      base,
    )
    expect(ranked.map((l) => l.url)).toEqual(['https://acme.test/careers'])
  })

  it('drops obvious non-content links', () => {
    const ranked = rankLinks(
      [
        { url: 'https://acme.test/logo.png', anchor: '', inNav: false },
        { url: 'https://acme.test/brochure.pdf', anchor: '', inNav: false },
        { url: 'https://acme.test/careers', anchor: 'Careers', inNav: false },
      ],
      base,
    )
    expect(ranked.map((l) => l.url)).toEqual(['https://acme.test/careers'])
  })

  it('returns links in descending score order and labels their kind', () => {
    const ranked = rankLinks(
      [
        { url: 'https://acme.test/pricing', anchor: 'Pricing', inNav: false },
        { url: 'https://acme.test/about', anchor: 'About', inNav: false },
        { url: 'https://acme.test/careers/interview-process', anchor: 'Interview process', inNav: false },
      ],
      base,
    )
    expect(ranked[0]!.url).toBe('https://acme.test/careers/interview-process')
    expect(ranked[0]!.kind).toBe('hiring')
    expect(ranked.find((l) => l.url.endsWith('/about'))!.kind).toBe('about')
  })
})

describe('discoverPages', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      const send = (body: string) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(body)
      }
      if (path === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('User-agent: *\nDisallow: /secret\n')
        return
      }
      if (path === '/') {
        send(`<html><body><nav>
          <a href="/about">About</a>
          <a href="careers/">Careers</a>
          <a href="/pricing">Pricing</a>
          <a href="/secret">Careers secret handbook</a>
          <a href="/broken">Interview tips</a>
        </nav><main><p>Acme routes freight.</p></main></body></html>`)
        return
      }
      if (path === '/careers/') {
        send('<html><head><title>Careers</title></head><body><main><p>We run a take-home then a system design round.</p><a href="/careers/process">Process</a></main></body></html>')
        return
      }
      if (path === '/careers/process') {
        send('<html><head><title>Process</title></head><body><main><p>Four stages.</p></main></body></html>')
        return
      }
      if (path === '/about') {
        send('<html><head><title>About</title></head><body><main><p>Founded 2015.</p></main></body></html>')
        return
      }
      if (path === '/pricing') {
        send('<html><head><title>Pricing</title></head><body><main><p>Plans.</p></main></body></html>')
        return
      }
      if (path === '/secret') {
        send('<html><body>should never be fetched</body></html>')
        return
      }
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end('boom')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    clearRobotsCache()
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const opts = { allowPrivate: true }

  it('fetches the root and reports it reachable', async () => {
    const result = await discoverPages(`${base}/`, opts)
    expect(result.rootReachable).toBe(true)
    expect(result.pages.some((p) => p.url === `${base}/`)).toBe(true)
  })

  it('follows a relative link, which the batch command depends on', async () => {
    const result = await discoverPages(`${base}/`, opts)
    expect(result.pages.some((p) => p.url === `${base}/careers/`)).toBe(true)
  })

  it('prefers the hiring page over the pricing page', async () => {
    const result = await discoverPages(`${base}/`, { ...opts, maxPages: 3 })
    const urls = result.pages.map((p) => p.url)
    expect(urls).toContain(`${base}/careers/`)
    expect(urls).not.toContain(`${base}/pricing`)
  })

  it('honours robots.txt', async () => {
    const result = await discoverPages(`${base}/`, opts)
    expect(result.pages.some((p) => p.url.includes('/secret'))).toBe(false)
  })

  it('records an unreachable page as a warning and keeps going', async () => {
    const result = await discoverPages(`${base}/`, { ...opts, maxPages: MAX_PAGES_DEFAULT })
    expect(result.pages.length).toBeGreaterThan(1)
    expect(result.warnings.some((w) => w.source?.includes('/broken'))).toBe(true)
  })

  it('reports an unreachable root honestly rather than throwing', async () => {
    const result = await discoverPages('http://127.0.0.1:1/', opts)
    expect(result.rootReachable).toBe(false)
    expect(result.pages).toEqual([])
    expect(result.warnings[0]!.reason.length).toBeGreaterThan(0)
  })

  it('reports an invalid url honestly rather than throwing', async () => {
    const result = await discoverPages('not a url', opts)
    expect(result.rootReachable).toBe(false)
    expect(result.warnings).toHaveLength(1)
  })

  it('never exceeds the page budget', async () => {
    const result = await discoverPages(`${base}/`, { ...opts, maxPages: 2 })
    expect(result.pages.length).toBeLessThanOrEqual(2)
  })
})
