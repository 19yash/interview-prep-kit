import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api.js'

const originalFetch = globalThis.fetch

function mockFetch(response: { status?: number; body?: unknown; ok?: boolean }) {
  // Typed with fetch's own parameters so `mock.calls[n][1]` is a RequestInit
  // rather than an element of an empty tuple.
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: response.ok ?? (response.status ?? 200) < 400,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }))
  globalThis.fetch = fn as never
  return fn
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('api client', () => {
  it('sends credentials on every request, so the session cookie travels', async () => {
    const fetchMock = mockFetch({ body: { kits: [] } })
    await api.listKits()
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/kits', expect.objectContaining({ credentials: 'include' }))
  })

  it('builds urls from NEXT_PUBLIC_API_URL without doubling slashes', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test/'
    const fetchMock = mockFetch({ body: {} })
    await api.getKit('abc')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/abc')
  })

  it('sends json with the right content type on a post', async () => {
    const fetchMock = mockFetch({ status: 202, body: { id: 'k1', status: 'queued' } })
    await api.createKit({ jd: 'text', companyUrl: 'https://x.test/', days: 3 })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ jd: 'text', companyUrl: 'https://x.test/', days: 3 })
  })

  it('returns the parsed body on success', async () => {
    mockFetch({ body: { kits: [{ id: 'k1' }] } })
    await expect(api.listKits()).resolves.toEqual([{ id: 'k1' }])
  })

  it('throws an ApiError carrying the api’s own message', async () => {
    mockFetch({ status: 400, body: { error: { code: 'INVALID_INPUT', message: 'paste the job description' } } })
    await expect(api.createKit({ jd: '', companyUrl: 'x', days: 1 })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_INPUT',
      message: 'paste the job description',
    })
  })

  it('produces a readable error when the response is not json', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })) as never
    await expect(api.listKits()).rejects.toBeInstanceOf(ApiError)
  })

  it('produces a readable error when the network is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as never
    await expect(api.listKits()).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('reports a duplicate creation distinctly rather than as an error', async () => {
    mockFetch({ status: 200, body: { id: 'k1', status: 'running', duplicate: true } })
    await expect(api.createKit({ jd: 'x', companyUrl: 'y', days: 1 })).resolves.toMatchObject({ duplicate: true })
  })

  it('returns nothing for a 204 without trying to parse a body', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('should not be called')
      },
    })) as never
    await expect(api.deleteKit('k1')).resolves.toBeUndefined()
  })

  it('sends a patch with only the changed fields', async () => {
    const fetchMock = mockFetch({ body: {} })
    await api.patchQuestion('k1', 'q1', { prompt: 'new wording' })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'new wording' })
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/k1/questions/q1')
  })

  it('posts a regeneration to the section path', async () => {
    const fetchMock = mockFetch({ body: {} })
    await api.regenerate('k1', 'questions_technical')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/k1/regenerate/questions_technical')
  })
})
