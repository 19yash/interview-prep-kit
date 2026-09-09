import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchPage, FetchError } from '../src/fetch/fetcher.js'

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body><p>hello</p></body></html>')
      return
    }
    if (path === '/pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end('%PDF-1.4')
      return
    }
    if (path === '/huge') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('x'.repeat(200_000))
      return
    }
    if (path === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('late')
      }, 500)
      return
    }
    if (path === '/redirect') {
      res.writeHead(302, { location: '/ok' })
      res.end()
      return
    }
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('missing')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const opts = { allowPrivate: true }

describe('fetchPage', () => {
  it('returns html for a successful response', async () => {
    const page = await fetchPage(`${base}/ok`, opts)
    expect(page.status).toBe(200)
    expect(page.html).toContain('hello')
    expect(page.contentType).toContain('text/html')
  })

  it('follows a redirect and reports the final url', async () => {
    const page = await fetchPage(`${base}/redirect`, opts)
    expect(page.html).toContain('hello')
    expect(page.finalUrl).toBe(`${base}/ok`)
  })

  it('rejects a disallowed content type', async () => {
    await expect(fetchPage(`${base}/pdf`, opts)).rejects.toMatchObject({ code: 'BAD_CONTENT_TYPE' })
  })

  it('rejects a body larger than the cap', async () => {
    await expect(fetchPage(`${base}/huge`, { ...opts, maxBytes: 1000 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('times out rather than hanging', async () => {
    await expect(fetchPage(`${base}/slow`, { ...opts, timeoutMs: 100 })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('reports an http error with its status', async () => {
    await expect(fetchPage(`${base}/missing`, opts)).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404 })
  })

  it('surfaces a network failure as a FetchError', async () => {
    await expect(fetchPage('http://127.0.0.1:1/nothing', opts)).rejects.toBeInstanceOf(FetchError)
  })

  it('refuses a private address when not explicitly allowed', async () => {
    await expect(fetchPage(`${base}/ok`)).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' })
  })
})
